-- El pase de guardia por QR (pendiente #113): el Asistente escanea el cartel del domicilio del
-- Paciente al llegar y al irse, y eso queda anotado junto con el GPS de siempre.
--
-- QUÉ PROBLEMA RESUELVE
-- Hasta hoy el check-in y el check-out sólo confiaban en el GPS del teléfono, que dice "estuvo
-- cerca" pero no "estuvo en la puerta de esta persona". El cartel con el código QR del Paciente
-- —igual en su idea al que ya tiene cada Asistente en su credencial, `asistentes.qr_token`— le
-- suma a la ubicación una segunda prueba: que el Asistente efectivamente leyó el cartel de esa
-- casa. Decisión del Desarrollador: QR y ubicación van juntos, nunca uno solo.
--
-- QUÉ NO HACE, Y ES A PROPÓSITO
--   1. No bloquea nunca la guardia. Si el cartel está roto, el teléfono no tiene cámara o no hay
--      luz para leerlo, el check-in o el check-out se marcan igual — lo que cambia es que ese
--      intento queda anotado como excepción (columna `excepcion_motivo`), no como si el escaneo
--      hubiera salido bien. Es el mismo principio que ya usa el check-in fuera de rango por GPS
--      (`configuracion_ausencia_automatica`): avisar, nunca trabar.
--   2. No cambia el ciclo de vida de la guardia. Sigue habiendo check-in y check-out, exactamente
--      como estaban: esta tabla sólo junta evidencia sobre uno de esos dos actos, nunca los une
--      ni crea un tercer estado. Cada fila nueva se para de un lado (`momento`): la guardia que
--      empieza (check-in) o la que termina (check-out). Cuando un relevo ocurre — un Asistente
--      se va y otro llega — quedan DOS filas, una por cada guardia, cada una con su propio
--      `guardia_id`: la evidencia queda contra las dos guardias sin que ninguna de las dos
--      cambie de ciclo de vida ni dependa de la otra.
--   3. No decide si un relevo cierra una guardia y abre la siguiente en un solo acto. Esa
--      decisión sigue sin tomarse (ver el informe de esta tarea) y esta migración no la
--      necesita: alcanza con que cada llamada a /checkin o /checkout siga siendo la que ya era,
--      y con que la evidencia de cada una se guarde por separado.
--   4. No inventa un catálogo nuevo en la base para los motivos de excepción. Son cuatro casos
--      técnicos fijos, en el mismo espíritu que los `motivo` que ya devuelve el motor en otros
--      endpoints (`falta_reporte`, `continuidad`): se listan en el CHECK de abajo y el texto que
--      lee el Asistente sale de i18n, no de una tabla.

-- ---------------------------------------------------------------------------------------
-- El cartel del Paciente: mismo mecanismo que ya tiene cada Asistente en su credencial
-- ---------------------------------------------------------------------------------------

ALTER TABLE public.pacientes
  ADD COLUMN IF NOT EXISTS qr_token text DEFAULT (gen_random_uuid())::text;

COMMENT ON COLUMN public.pacientes.qr_token IS
  'El código que lleva el cartel impreso en el domicilio de este Paciente. Lo escanea el Asistente al llegar y al irse (guardia_escaneos). Mismo mecanismo que asistentes.qr_token, que escanea la Familia para verificar identidad.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pacientes_qr_token_key' AND conrelid = 'public.pacientes'::regclass
  ) THEN
    ALTER TABLE public.pacientes ADD CONSTRAINT pacientes_qr_token_key UNIQUE (qr_token);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------------------
-- La evidencia de cada escaneo, uno por check-in y uno por check-out
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.guardia_escaneos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prestadora_id uuid NOT NULL,
    guardia_id uuid NOT NULL,
    asistente_id uuid NOT NULL,
    momento text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    qr_leido boolean NOT NULL,
    qr_token_leido text,
    qr_coincide boolean,
    excepcion_motivo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guardia_escaneos_pkey PRIMARY KEY (id),
    CONSTRAINT guardia_escaneos_momento_check CHECK (momento = ANY (ARRAY['checkin'::text, 'checkout'::text])),
    -- Cuatro casos técnicos fijos y nada más — ver "QUÉ NO HACE" arriba.
    CONSTRAINT guardia_escaneos_excepcion_motivo_check CHECK (
      excepcion_motivo IS NULL OR excepcion_motivo = ANY (ARRAY['sin_camara'::text, 'permiso_denegado'::text, 'no_legible'::text, 'otro'::text])
    ),
    -- O el QR se leyó (y entonces hay token leído, y puede haber o no coincidencia), o no se
    -- leyó (y entonces hay un motivo de excepción y no hay ni token ni coincidencia que evaluar).
    -- Media fila — un motivo sin excepción, o un "leído" sin token — es peor que ninguna: se lee
    -- como si dijera algo y no dice nada (mismo criterio que guardias_cierre_rastro_completo).
    CONSTRAINT guardia_escaneos_coherencia_check CHECK (
      (qr_leido = true AND excepcion_motivo IS NULL AND qr_token_leido IS NOT NULL)
      OR (qr_leido = false AND excepcion_motivo IS NOT NULL AND qr_token_leido IS NULL AND qr_coincide IS NULL)
    )
);

COMMENT ON TABLE public.guardia_escaneos IS
  'Evidencia de cada escaneo de QR intentado al marcar check-in o check-out (pendiente #113). Una fila por acto, nunca una guardia entera: cuando hay relevo, la guardia que termina y la que empieza quedan cada una con su propia fila.';
COMMENT ON COLUMN public.guardia_escaneos.momento IS
  'Contra qué acto de la guardia es esta evidencia: checkin (la guardia que empieza) o checkout (la guardia que termina).';
COMMENT ON COLUMN public.guardia_escaneos.qr_leido IS
  'Si el escaneo se pudo leer. En false, el check-in o el check-out se marcaron igual — el escaneo nunca traba la guardia — y esta fila es la constancia de que fue una excepción.';
COMMENT ON COLUMN public.guardia_escaneos.qr_token_leido IS
  'El contenido leído del QR, tal cual, cuando qr_leido es true. Nunca se guarda si no se pudo leer.';
COMMENT ON COLUMN public.guardia_escaneos.qr_coincide IS
  'Si el código leído es el del Paciente correspondiente a esta guardia. Puede dar false (se leyó un cartel que no era) sin que eso tampoco bloquee nada: es otro dato para el aviso automático al Coordinador, igual que el check-in fuera de rango por GPS.';
COMMENT ON COLUMN public.guardia_escaneos.excepcion_motivo IS
  'Por qué no se pudo leer, cuando qr_leido es false: sin_camara, permiso_denegado, no_legible (cartel roto, sin luz, etc.) u otro. El texto que ve el Asistente sale de i18n, esto es sólo el código.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'guardia_escaneos_momento_unico_por_guardia'
  ) THEN
    -- Un solo escaneo por acto: el check-in de una guardia se marca una vez, igual que
    -- checkin_at; si el cliente reintenta (Fase 9, cola offline) tiene que encontrar la fila que
    -- ya existe y no una segunda.
    ALTER TABLE public.guardia_escaneos
      ADD CONSTRAINT guardia_escaneos_momento_unico_por_guardia UNIQUE (guardia_id, momento);
  END IF;
END;
$$;

ALTER TABLE ONLY public.guardia_escaneos
  ADD CONSTRAINT guardia_escaneos_prestadora_id_fkey FOREIGN KEY (prestadora_id) REFERENCES public.prestadoras(id);

-- FK compuesta contra (id, prestadora_id): la misma forma que ya usa incidentes_relevo contra
-- guardias, para que una fila de esta tabla no pueda apuntar nunca a una guardia o un Asistente
-- de otra Prestadora, ni siquiera por un error de programación del lado del motor.
ALTER TABLE ONLY public.guardia_escaneos
  ADD CONSTRAINT guardia_escaneos_guardia_tenant_fk FOREIGN KEY (guardia_id, prestadora_id) REFERENCES public.guardias(id, prestadora_id);

ALTER TABLE ONLY public.guardia_escaneos
  ADD CONSTRAINT guardia_escaneos_asistente_tenant_fk FOREIGN KEY (asistente_id, prestadora_id) REFERENCES public.asistentes(id, prestadora_id);

CREATE INDEX IF NOT EXISTS idx_guardia_escaneos_guardia ON public.guardia_escaneos USING btree (guardia_id);

-- Para el aviso al Coordinador y para el día en que exista una pantalla de auditoría: las
-- excepciones son pocas comparadas con los escaneos que sí se leyeron, así que conviene un
-- índice parcial en vez de forzar a leer la tabla entera para encontrarlas.
CREATE INDEX IF NOT EXISTS idx_guardia_escaneos_excepciones ON public.guardia_escaneos USING btree (prestadora_id, created_at) WHERE (qr_leido = false);

-- ---------------------------------------------------------------------------------------
-- RLS estricta — "segunda red" (docs/MIGRACIONES.md, y el mismo criterio que
-- 20260904120000_las_dos_aplicaciones_leen_con_su_propio_pase.sql): el backend de las dos
-- aplicaciones de teléfono usa la clave maestra y aísla por ruta, así que estas políticas no son
-- el único freno — son el que queda si alguna vez algo lee esta tabla sin pasar por esa ruta.
-- ---------------------------------------------------------------------------------------

ALTER TABLE public.guardia_escaneos ENABLE ROW LEVEL SECURITY;

-- Las funciones que consultan las políticas viven en el esquema `interno` desde
-- 20260904090000_las_funciones_internas_salen_del_esquema_publicado.sql — no en `public`, que es
-- un esquema publicado como direcciones web. Estas tres políticas son el espejo exacto de las que
-- ya tiene `public.guardias` (`asistente_ve_sus_guardias`,
-- `coordinador_gestiona_guardias_de_su_zona`, `panel_gestiona_guardias`).
CREATE POLICY "asistente_ve_sus_escaneos" ON public.guardia_escaneos FOR SELECT USING (
  (prestadora_id = interno.current_tenant())
  AND EXISTS (SELECT 1 FROM public.guardias g WHERE g.id = guardia_escaneos.guardia_id AND g.asistente_id = auth.uid())
);

CREATE POLICY "coordinador_ve_escaneos_de_su_zona" ON public.guardia_escaneos FOR SELECT USING (
  (prestadora_id = interno.current_tenant())
  AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  AND EXISTS (SELECT 1 FROM public.guardias g WHERE g.id = guardia_escaneos.guardia_id AND interno.coordinador_alcanza_guardia(g.asistente_id))
);

CREATE POLICY "panel_gestiona_escaneos" ON public.guardia_escaneos USING (
  (interno.es_superadmin() AND prestadora_id = interno.current_tenant())
  OR (
    (prestadora_id = interno.current_tenant())
    AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  )
);

GRANT ALL ON TABLE public.guardia_escaneos TO anon;
GRANT ALL ON TABLE public.guardia_escaneos TO authenticated;
GRANT ALL ON TABLE public.guardia_escaneos TO service_role;

NOTIFY pgrst, 'reload schema';

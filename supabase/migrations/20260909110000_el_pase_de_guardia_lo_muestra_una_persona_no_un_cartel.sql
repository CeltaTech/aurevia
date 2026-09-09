-- El pase de guardia por QR (pendiente #113), rehecho.
--
-- QUÉ CAMBIÓ Y POR QUÉ
-- El 2026-09-08 se construyó el escaneo de un cartel impreso pegado en el domicilio del
-- Paciente. El 2026-09-09 el Desarrollador lo dio de baja con una sola frase: «nada de escanear
-- carteles que pueden ser fotografiados y usados desde cualquier lado». Un cartel impreso es un
-- secreto que no cambia nunca y que está a la vista de cualquiera que pase por la puerta: se lo
-- fotografía una vez y se lo escanea desde otra ciudad para siempre.
--
-- Lo que lo reemplaza tiene dos caminos, y ninguno de los dos usa papel:
--
--   Plan A — el código lo muestra una persona, en la pantalla de su teléfono. Quien está en la
--   casa —la Familia, o el Asistente que se va cuando hay relevo— abre su aplicación y muestra un
--   código de seis dígitos que se renueva solo cada pocos segundos. El Asistente que llega lo
--   escanea o lo tipea. Una foto de esa pantalla no sirve un minuto después. El GPS sigue
--   confirmando que el teléfono está en la dirección, igual que antes.
--
--   Plan B — el código lo suelta la Prestadora. Cuando no hay nadie que pueda mostrarlo —casa
--   vacía, Paciente durmiendo, el que salía ya se fue—, el Asistente escribe con sus palabras que
--   no tiene a quién pedírselo. Eso aparece en la pantalla de la Prestadora. Quien está de turno
--   lo resuelve como quiera —llamada, videollamada, lo que esa Prestadora decida— y si queda
--   conforme suelta un código de un solo uso, válido para esa guardia, ese momento y unos pocos
--   minutos. Queda anotado quién lo soltó y cuándo.
--
-- EL PISO, QUE NO SE NEGOCIA: LA GUARDIA NUNCA SE TRABA
-- Si en la Prestadora no atiende nadie, el Asistente registra igual la llegada eligiendo un
-- motivo de una lista corta, entra a trabajar, y esa llegada queda marcada como SIN COMPROBAR en
-- una lista que el Coordinador ve hasta cerrarla. Lo mismo para la salida. Es el mismo principio
-- que ya usaba el check-in fuera de rango por GPS: avisar, nunca trabar.
--
-- POR QUÉ EL CÓDIGO SE GUARDA HASHEADO Y NO SE CALCULA CON UNA CLAVE DE ENTORNO
-- Podría armarse el código rotativo con una firma HMAC sobre la hora, sin guardar nada. No se
-- hizo: obligaría a una variable de entorno nueva y obligatoria, y este producto ya se cayó
-- entero una vez por una clave de entorno que faltaba (pendiente #90, comentado en
-- backend/src/server.js). Se reusa en cambio el mecanismo de código de un solo uso con
-- vencimiento que el producto ya tiene para la firma del titular del círculo familiar
-- (instrucciones_acceso_circulo.codigo_huella / codigo_expira_en / codigo_intentos): seis dígitos
-- al azar, se guarda el hash y nunca el código, y vence solo. Un punto de verdad, no un quinto
-- mecanismo parecido.

-- ---------------------------------------------------------------------------------------
-- 1. Se borra lo del cartel. No se archiva: se suprime.
-- ---------------------------------------------------------------------------------------

DROP TABLE IF EXISTS public.guardia_escaneos;

ALTER TABLE public.pacientes DROP CONSTRAINT IF EXISTS pacientes_qr_token_key;
ALTER TABLE public.pacientes DROP COLUMN IF EXISTS qr_token;

-- ---------------------------------------------------------------------------------------
-- 2. Cuánto dura cada código. Las dos son decisiones de cada Prestadora, no del producto.
--    Van al lado de metros_tolerancia_checkin, que es su vecina exacta: las tres dicen con
--    cuánta holgura se da por buena una llegada al domicilio.
--
--    DEFAULT obligatorio en las dos: 20260819183000_prestadora_nueva_nace_configurada.sql
--    inserta la fila de toda tabla `configuracion\_%` con sólo (prestadora_id), así que una
--    columna NOT NULL sin DEFAULT rompe el alta de cualquier Prestadora nueva.
-- ---------------------------------------------------------------------------------------

ALTER TABLE public.configuracion_ausencia_automatica
  ADD COLUMN IF NOT EXISTS segundos_codigo_en_pantalla integer NOT NULL DEFAULT 30;

ALTER TABLE public.configuracion_ausencia_automatica
  ADD COLUMN IF NOT EXISTS minutos_codigo_de_la_prestadora integer NOT NULL DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'segundos_codigo_en_pantalla_razonable') THEN
    -- Menos de diez segundos no le da tiempo a nadie a apuntar la cámara; más de cinco minutos
    -- convierte la foto de la pantalla en un cartel, que es justo lo que se vino a sacar.
    ALTER TABLE public.configuracion_ausencia_automatica
      ADD CONSTRAINT segundos_codigo_en_pantalla_razonable
      CHECK (segundos_codigo_en_pantalla >= 10 AND segundos_codigo_en_pantalla <= 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'minutos_codigo_de_la_prestadora_razonable') THEN
    ALTER TABLE public.configuracion_ausencia_automatica
      ADD CONSTRAINT minutos_codigo_de_la_prestadora_razonable
      CHECK (minutos_codigo_de_la_prestadora >= 1 AND minutos_codigo_de_la_prestadora <= 120);
  END IF;
END;
$$;

COMMENT ON COLUMN public.configuracion_ausencia_automatica.segundos_codigo_en_pantalla IS
  'Cada cuántos segundos se renueva el código que la Familia —o el Asistente que se va— muestra en la pantalla de su teléfono para que lo lea el Asistente que llega. Decisión de cada Prestadora.';
COMMENT ON COLUMN public.configuracion_ausencia_automatica.minutos_codigo_de_la_prestadora IS
  'Cuántos minutos vale el código de un solo uso que suelta la Prestadora cuando no hay nadie en la casa que pueda mostrar el suyo. Decisión de cada Prestadora.';

-- ---------------------------------------------------------------------------------------
-- 3. El código que se muestra en pantalla (Plan A)
--
--    Una fila por sujeto —un círculo familiar, o un Asistente— y no más de una: pedir uno nuevo
--    pisa el anterior, que es exactamente lo que quiere decir "se renueva solo". Se guarda el
--    hash, nunca el código.
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.codigos_de_presencia (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prestadora_id uuid NOT NULL,
    sujeto_tipo text NOT NULL,
    sujeto_id uuid NOT NULL,
    codigo_huella text NOT NULL,
    expira_en timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT codigos_de_presencia_pkey PRIMARY KEY (id),
    CONSTRAINT codigos_de_presencia_sujeto_tipo_check CHECK (sujeto_tipo = ANY (ARRAY['familia'::text, 'asistente'::text])),
    CONSTRAINT codigos_de_presencia_sujeto_unico UNIQUE (sujeto_tipo, sujeto_id)
);

ALTER TABLE ONLY public.codigos_de_presencia
  ADD CONSTRAINT codigos_de_presencia_prestadora_id_fkey FOREIGN KEY (prestadora_id) REFERENCES public.prestadoras(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_codigos_de_presencia_vigencia ON public.codigos_de_presencia USING btree (prestadora_id, expira_en);

COMMENT ON TABLE public.codigos_de_presencia IS
  'El código de seis dígitos que una persona muestra en la pantalla de su teléfono para que el Asistente que llega compruebe que está en la casa (pendiente #113, Plan A). Se guarda hasheado y vence solo a los segundos que configuró la Prestadora.';
COMMENT ON COLUMN public.codigos_de_presencia.sujeto_tipo IS
  'Quién muestra el código: familia (el círculo familiar entero, cualquiera de sus miembros) o asistente (el que se va, cuando hay relevo). El Paciente no tiene cuenta en el producto y por eso no figura acá.';
COMMENT ON COLUMN public.codigos_de_presencia.codigo_huella IS
  'sha256 del código. El código en claro no se guarda en ningún lado: sólo viaja a la pantalla que lo muestra y de ahí a la que lo lee.';

-- RLS: nadie lee esta tabla desde una pantalla. El código lo pide la aplicación al motor, y el
-- motor entra con la llave de servicio. Así que acá el mínimo privilegio es literal: se revoca
-- todo a anon y a authenticated, no se escribe ninguna política, y con RLS encendida y sin
-- políticas cualquier sesión que llegara igual no ve ni una fila. Falla cerrado por construcción.
ALTER TABLE public.codigos_de_presencia ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.codigos_de_presencia FROM anon;
REVOKE ALL ON TABLE public.codigos_de_presencia FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.codigos_de_presencia TO service_role;

-- ---------------------------------------------------------------------------------------
-- 4. La comprobación de cada llegada y de cada salida
--
--    Una fila por acto —(guardia, momento)—, igual que la tabla del cartel a la que reemplaza.
--    Un relevo sigue siendo dos filas, una por cada guardia, porque son dos actos distintos.
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.guardia_comprobaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prestadora_id uuid NOT NULL,
    guardia_id uuid NOT NULL,
    asistente_id uuid NOT NULL,
    momento text NOT NULL,
    estado text NOT NULL,
    -- Con qué se comprobó, cuando se comprobó
    medio text,
    sujeto_tipo text,
    sujeto_id uuid,
    lat double precision,
    lng double precision,
    comprobada_en timestamp with time zone,
    -- Plan B: el pedido del Asistente y el código que suelta la Prestadora
    pedido_texto text,
    pedido_en timestamp with time zone,
    codigo_huella text,
    codigo_expira_en timestamp with time zone,
    codigo_intentos integer DEFAULT 0 NOT NULL,
    codigo_emitido_por uuid,
    codigo_emitido_en timestamp with time zone,
    -- El piso: se entró igual y quedó sin comprobar
    motivo_sin_comprobar text,
    motivo_detalle text,
    -- El cierre del Coordinador
    cerrada_en timestamp with time zone,
    cerrada_por uuid,
    cerrada_nota text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guardia_comprobaciones_pkey PRIMARY KEY (id),
    CONSTRAINT guardia_comprobaciones_momento_check CHECK (momento = ANY (ARRAY['checkin'::text, 'checkout'::text])),
    CONSTRAINT guardia_comprobaciones_estado_check CHECK (
      estado = ANY (ARRAY['pendiente_de_codigo'::text, 'comprobada'::text, 'sin_comprobar'::text])
    ),
    CONSTRAINT guardia_comprobaciones_medio_check CHECK (
      medio IS NULL OR medio = ANY (ARRAY['codigo_familia'::text, 'codigo_asistente_saliente'::text, 'codigo_prestadora'::text])
    ),
    CONSTRAINT guardia_comprobaciones_sujeto_tipo_check CHECK (
      sujeto_tipo IS NULL OR sujeto_tipo = ANY (ARRAY['familia'::text, 'asistente'::text])
    ),
    -- La lista corta que el Asistente elige cuando entra sin comprobar. Cuatro casos técnicos
    -- fijos, del mismo tipo que los `motivo` que ya devuelve el motor (falta_reporte,
    -- continuidad): el texto que lee el Asistente sale de i18n, no de una tabla.
    CONSTRAINT guardia_comprobaciones_motivo_check CHECK (
      motivo_sin_comprobar IS NULL OR motivo_sin_comprobar = ANY (
        ARRAY['nadie_para_mostrar'::text, 'prestadora_no_responde'::text, 'sin_camara'::text, 'sin_conexion'::text, 'otro'::text]
      )
    ),
    -- Media fila es peor que ninguna: se lee como si dijera algo y no dice nada (mismo criterio
    -- que guardias_cierre_rastro_completo). Cada estado exige lo suyo y nada más.
    CONSTRAINT guardia_comprobaciones_coherencia_check CHECK (
      (estado = 'comprobada' AND medio IS NOT NULL AND comprobada_en IS NOT NULL AND motivo_sin_comprobar IS NULL)
      OR (estado = 'sin_comprobar' AND motivo_sin_comprobar IS NOT NULL AND medio IS NULL)
      OR (estado = 'pendiente_de_codigo' AND medio IS NULL AND motivo_sin_comprobar IS NULL AND pedido_en IS NOT NULL)
    ),
    -- Si lo mostró una persona, se sabe cuál. Si lo soltó la Prestadora, no hay sujeto que mostrar.
    CONSTRAINT guardia_comprobaciones_sujeto_coherencia_check CHECK (
      (medio IN ('codigo_familia', 'codigo_asistente_saliente') AND sujeto_tipo IS NOT NULL AND sujeto_id IS NOT NULL)
      OR (medio = 'codigo_prestadora' AND sujeto_tipo IS NULL AND sujeto_id IS NULL)
      OR medio IS NULL
    ),
    CONSTRAINT guardia_comprobaciones_cierre_check CHECK (
      (cerrada_en IS NULL AND cerrada_por IS NULL)
      OR (cerrada_en IS NOT NULL AND cerrada_por IS NOT NULL)
    )
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardia_comprobaciones_momento_unico_por_guardia') THEN
    -- Una sola comprobación por acto. Si la cola sin conexión reintenta, tiene que encontrar la
    -- fila que ya existe y no crear una segunda.
    ALTER TABLE public.guardia_comprobaciones
      ADD CONSTRAINT guardia_comprobaciones_momento_unico_por_guardia UNIQUE (guardia_id, momento);
  END IF;
END;
$$;

ALTER TABLE ONLY public.guardia_comprobaciones
  ADD CONSTRAINT guardia_comprobaciones_prestadora_id_fkey FOREIGN KEY (prestadora_id) REFERENCES public.prestadoras(id);

-- FK compuesta contra (id, prestadora_id): así una fila no puede apuntar nunca a una guardia o a
-- un Asistente de otra Prestadora, ni siquiera por un error de programación del lado del motor.
ALTER TABLE ONLY public.guardia_comprobaciones
  ADD CONSTRAINT guardia_comprobaciones_guardia_tenant_fk FOREIGN KEY (guardia_id, prestadora_id) REFERENCES public.guardias(id, prestadora_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guardia_comprobaciones
  ADD CONSTRAINT guardia_comprobaciones_asistente_tenant_fk FOREIGN KEY (asistente_id, prestadora_id) REFERENCES public.asistentes(id, prestadora_id);

ALTER TABLE ONLY public.guardia_comprobaciones
  ADD CONSTRAINT guardia_comprobaciones_codigo_emitido_por_fkey FOREIGN KEY (codigo_emitido_por) REFERENCES public.usuarios(id);

ALTER TABLE ONLY public.guardia_comprobaciones
  ADD CONSTRAINT guardia_comprobaciones_cerrada_por_fkey FOREIGN KEY (cerrada_por) REFERENCES public.usuarios(id);

CREATE INDEX IF NOT EXISTS idx_guardia_comprobaciones_guardia ON public.guardia_comprobaciones USING btree (guardia_id);

-- Las dos listas que mira la Prestadora son cortas comparadas con el total, así que van con
-- índice parcial y no obligando a leer la tabla entera: los pedidos que esperan un código, y
-- las llegadas que quedaron sin comprobar y todavía nadie cerró.
CREATE INDEX IF NOT EXISTS idx_guardia_comprobaciones_pendientes
  ON public.guardia_comprobaciones USING btree (prestadora_id, pedido_en)
  WHERE (estado = 'pendiente_de_codigo');

CREATE INDEX IF NOT EXISTS idx_guardia_comprobaciones_sin_comprobar
  ON public.guardia_comprobaciones USING btree (prestadora_id, created_at)
  WHERE (estado = 'sin_comprobar' AND cerrada_en IS NULL);

COMMENT ON TABLE public.guardia_comprobaciones IS
  'Cómo se comprobó que el Asistente estaba realmente en el domicilio al llegar y al irse (pendiente #113). Una fila por acto: cuando hay relevo, la guardia que termina y la que empieza tienen cada una la suya.';
COMMENT ON COLUMN public.guardia_comprobaciones.estado IS
  'comprobada (alguien mostró el código, o lo soltó la Prestadora), pendiente_de_codigo (el Asistente avisó que no hay quién se lo muestre y espera), sin_comprobar (se entró igual, con un motivo, y el Coordinador lo tiene que cerrar).';
COMMENT ON COLUMN public.guardia_comprobaciones.medio IS
  'Con qué se comprobó: el código de la Familia, el del Asistente que se iba, o el que soltó la Prestadora. Es lo que decide si a la Familia se le avisa: se le avisa cuando ella no participó de la comprobación.';
COMMENT ON COLUMN public.guardia_comprobaciones.pedido_texto IS
  'Lo que el Asistente escribió con sus palabras al avisar que no tiene a quién pedirle el código. Aparece tal cual en la pantalla de la Prestadora.';
COMMENT ON COLUMN public.guardia_comprobaciones.codigo_huella IS
  'sha256 del código de un solo uso que soltó la Prestadora. El código en claro se muestra una vez a quien lo emitió y no se guarda.';
COMMENT ON COLUMN public.guardia_comprobaciones.motivo_sin_comprobar IS
  'Por qué se entró sin comprobar. La guardia nunca se traba: si en la Prestadora no atiende nadie, el Asistente elige un motivo, entra a trabajar, y esto queda en la lista del Coordinador.';

-- ---------------------------------------------------------------------------------------
-- 5. RLS estricta — la "segunda red"
--
--    El motor de las dos aplicaciones de teléfono entra con la llave de servicio y aísla por
--    ruta (CLAUDE.md del producto, §6). Estas políticas no son el único freno: son el que queda
--    si algún día algo lee esta tabla sin pasar por esa ruta. Son el espejo de las que ya tiene
--    public.guardias.
-- ---------------------------------------------------------------------------------------

ALTER TABLE public.guardia_comprobaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asistente_ve_sus_comprobaciones" ON public.guardia_comprobaciones FOR SELECT USING (
  (prestadora_id = interno.current_tenant())
  AND EXISTS (SELECT 1 FROM public.guardias g WHERE g.id = guardia_comprobaciones.guardia_id AND g.asistente_id = auth.uid())
);

CREATE POLICY "coordinador_gestiona_comprobaciones_de_su_zona" ON public.guardia_comprobaciones USING (
  (prestadora_id = interno.current_tenant())
  AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  AND EXISTS (SELECT 1 FROM public.guardias g WHERE g.id = guardia_comprobaciones.guardia_id AND interno.coordinador_alcanza_guardia(g.asistente_id))
);

CREATE POLICY "panel_gestiona_comprobaciones" ON public.guardia_comprobaciones USING (
  (interno.es_superadmin() AND prestadora_id = interno.current_tenant())
  OR (
    (prestadora_id = interno.current_tenant())
    AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  )
);

-- Supabase le da a toda tabla nueva de `public` todos los permisos para anon, authenticated y
-- service_role. Se revoca y se devuelve sólo lo que corresponde: anon no tiene nada que hacer
-- acá —nadie sin sesión mira una comprobación de guardia—, quien tiene sesión lee y escribe lo
-- que sus políticas le dejen, y el motor hace el resto con la llave de servicio.
REVOKE ALL ON TABLE public.guardia_comprobaciones FROM anon;
REVOKE ALL ON TABLE public.guardia_comprobaciones FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.guardia_comprobaciones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.guardia_comprobaciones TO service_role;

NOTIFY pgrst, 'reload schema';

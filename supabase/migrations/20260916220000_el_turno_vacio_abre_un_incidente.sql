-- El turno vacío abre un incidente, y queda abierto hasta que alguien diga cómo terminó.
-- =====================================================================
--
-- QUÉ FALTABA. Un turno sin nadie asignado producía un aviso y nada más. El aviso se lee o no se
-- lee; el turno, al día siguiente, sale de la lista que lo miraba y queda en `programada` para
-- siempre. Nadie tiene que dar cuenta de él. Un turno que nunca se cubrió es una falla del
-- servicio, y una falla del servicio no puede desaparecer sola.
--
-- QUÉ SE AGREGA. Una tabla donde el turno que llega a veinticuatro horas de empezar sin nadie deja
-- una fila abierta. Se le vuelve a recordar a quien lo puede tapar, y se cierra a mano eligiendo
-- cómo terminó. Los dos números —a cuántas horas se abre, cada cuánto se insiste— los decide cada
-- Prestadora, y viven en `panel/src/lib/incidenteTurnoSinCubrir.js`, que se copia al motor.
--
-- POR QUÉ NO SIRVE EL QUE YA EXISTE. `incidentes_relevo` es el incidente del relevo que no llegó:
-- exige la guardia entrante y el permiso de la Coordinadora se resuelve por las zonas del Asistente
-- asignado. En un turno vacío no hay Asistente asignado —ése es justamente el problema—, así que
-- ese permiso no se puede copiar. Acá se resuelve por la guardia, con la misma función que ya
-- decide qué turnos alcanza cada Coordinadora.
--
-- CERRAR NO ES UN TRÁMITE. Un turno que terminó en manos de la familia no es un turno cubierto: es
-- un defecto grave que no se pudo solucionar. La familia contrató para no tener que quedarse; que
-- se haya quedado igual puede costar el servicio. Por eso el final se elige de una lista corta, y
-- cuál de esos finales es un defecto grave no se guarda acá: lo dice la lista del archivo de
-- reglas, y guardarlo dos veces las haría divergir.
--
-- LO QUE NO DECIDE. Nada. No bloquea, no asigna y no reemplaza a la Coordinadora. Deja constancia.

BEGIN;

-- ---------------------------------------------------------------------------
-- El incidente
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.incidentes_turno_sin_cubrir (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  guardia_id uuid NOT NULL,
  abierto_at timestamptz NOT NULL DEFAULT now(),

  -- Que el recordatorio insista cada tantas horas y no en cada vuelta. Mismo molde que
  -- `guardias.aviso_sin_cubrir_at`.
  ultimo_recordatorio_at timestamptz,
  veces_recordado integer NOT NULL DEFAULT 0,

  resuelto_at timestamptz,
  resuelto_como text,
  resuelto_por uuid REFERENCES public.usuarios(id),
  -- Lo que la Coordinadora quiera dejar escrito de cómo terminó. Nunca datos de salud ni nada de
  -- la persona atendida: esto lo lee quien audita el servicio, no quien la cuida.
  nota text,

  CONSTRAINT incidentes_turno_sin_cubrir_guardia_tenant_fk
    FOREIGN KEY (guardia_id, prestadora_id) REFERENCES public.guardias(id, prestadora_id),

  CONSTRAINT incidentes_turno_sin_cubrir_final_conocido
    CHECK (resuelto_como IS NULL
           OR resuelto_como IN ('cubierto', 'quedo_en_la_familia', 'ya_no_hacia_falta')),

  -- Cerrado sin decir cómo no es cerrado: es una fila que se perdió. Las dos columnas viajan
  -- juntas o no viaja ninguna.
  CONSTRAINT incidentes_turno_sin_cubrir_cerrar_es_decir_como
    CHECK ((resuelto_at IS NULL) = (resuelto_como IS NULL))
);

COMMENT ON TABLE public.incidentes_turno_sin_cubrir IS
  'Un turno que llego a pocas horas de empezar sin nadie asignado. Queda abierto hasta que alguien elija como termino; quedo_en_la_familia es un defecto grave que no se pudo solucionar.';
COMMENT ON COLUMN public.incidentes_turno_sin_cubrir.resuelto_como IS
  'Como termino el turno. Cual de estos finales es un defecto grave lo dice panel/src/lib/incidenteTurnoSinCubrir.js, no esta tabla.';
COMMENT ON COLUMN public.incidentes_turno_sin_cubrir.nota IS
  'Lo que la Coordinadora dejo escrito al cerrar. Nunca datos de salud ni de la persona atendida.';

-- Un turno no puede tener dos incidentes abiertos a la vez. Sí puede tener uno cerrado y, si
-- vuelve a quedar vacío, otro nuevo: son dos fallas distintas.
CREATE UNIQUE INDEX IF NOT EXISTS incidentes_turno_sin_cubrir_uno_abierto_por_turno
  ON public.incidentes_turno_sin_cubrir (guardia_id)
  WHERE resuelto_at IS NULL;

-- El proceso de fondo recorre los incidentes abiertos de cada Prestadora en cada vuelta. Sin este
-- índice recorrería la tabla entera, que crece para siempre porque los cerrados no se borran.
CREATE INDEX IF NOT EXISTS incidentes_turno_sin_cubrir_abiertos
  ON public.incidentes_turno_sin_cubrir (prestadora_id, ultimo_recordatorio_at)
  WHERE resuelto_at IS NULL;

-- ---------------------------------------------------------------------------
-- Quién lo ve y quién lo cierra
-- ---------------------------------------------------------------------------
--
-- Lo abre el motor con la llave de servicio, que se saltea la protección por fila. Lo lee y lo
-- cierra el Panel con la sesión de la persona, así que acá la protección por fila es la única
-- defensa y no una segunda red.

ALTER TABLE public.incidentes_turno_sin_cubrir ENABLE ROW LEVEL SECURITY;

-- La Coordinadora alcanza el incidente si alcanza el turno, con la misma función que ya decide
-- eso para `guardias`. No se copia el permiso de `incidentes_relevo`, que se apoya en las zonas del
-- Asistente asignado: acá no hay ninguno.
CREATE POLICY coordinador_gestiona_incidentes_turno_sin_cubrir ON public.incidentes_turno_sin_cubrir
  FOR ALL
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (
      SELECT 1 FROM public.guardias g
       WHERE g.id = incidentes_turno_sin_cubrir.guardia_id
         AND g.prestadora_id = incidentes_turno_sin_cubrir.prestadora_id
         AND interno.coordinador_alcanza_guardia(g.asistente_id)
    )
  );

CREATE POLICY panel_gestiona_incidentes_turno_sin_cubrir ON public.incidentes_turno_sin_cubrir
  FOR ALL
  USING (
    (interno.es_superadmin() AND prestadora_id = interno.current_tenant())
    OR (
      prestadora_id = interno.current_tenant()
      AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

-- El permiso de tabla no es la protección por fila: sin esto, una política perfecta devuelve
-- «permiso denegado» con una sesión válida. Molde de tabla que escribe el navegador con sesión.
GRANT ALL ON TABLE public.incidentes_turno_sin_cubrir TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A cuántas horas se abre, y cada cuánto se insiste, lo decide la Prestadora
-- ---------------------------------------------------------------------------
--
-- Vacío mientras la Prestadora no toque nada, para que un cambio de valor de fábrica alcance a
-- todas salvo en lo que cada una decidió. Los valores de fábrica y los bordes viven en
-- `panel/src/lib/incidenteTurnoSinCubrir.js`, no acá: escribirlos dos veces los haría divergir.

CREATE TABLE IF NOT EXISTS public.configuracion_incidentes_turno_sin_cubrir (
  prestadora_id uuid PRIMARY KEY REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  regla jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracion_incidentes_turno_sin_cubrir_regla_es_objeto
    CHECK (jsonb_typeof(regla) = 'object')
);

COMMENT ON TABLE public.configuracion_incidentes_turno_sin_cubrir IS
  'A cuantas horas de empezar un turno sin nadie abre un incidente, y cada cuanto se insiste. Solo lo que esta Prestadora corrio; los valores de fabrica y los bordes viven en panel/src/lib/incidenteTurnoSinCubrir.js.';

ALTER TABLE public.configuracion_incidentes_turno_sin_cubrir ENABLE ROW LEVEL SECURITY;

-- Escribe el motor con la llave de servicio; esta política es la segunda red. Lee el Panel de esa
-- Prestadora, que tiene que poder mostrar con qué números se está abriendo el incidente.
CREATE POLICY panel_lee_configuracion_incidentes_turno_sin_cubrir ON public.configuracion_incidentes_turno_sin_cubrir
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

REVOKE ALL ON TABLE public.configuracion_incidentes_turno_sin_cubrir FROM anon;
REVOKE ALL ON TABLE public.configuracion_incidentes_turno_sin_cubrir FROM authenticated;
GRANT SELECT ON TABLE public.configuracion_incidentes_turno_sin_cubrir TO authenticated;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'incidentes_turno_sin_cubrir'
       AND policyname = 'coordinador_gestiona_incidentes_turno_sin_cubrir'
  ) THEN
    v_faltan := v_faltan || ' el permiso de la Coordinadora sobre el incidente;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'incidentes_turno_sin_cubrir_uno_abierto_por_turno'
  ) THEN
    v_faltan := v_faltan || ' la regla de un solo incidente abierto por turno;';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.incidentes_turno_sin_cubrir', 'UPDATE') THEN
    v_faltan := v_faltan || ' el permiso de tabla para cerrar el incidente desde el Panel;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La migracion no dejo lo que dice que deja:%', v_faltan;
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

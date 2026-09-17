-- «La tomo yo»: una alarma se puede tomar, y la toma vence.
-- =====================================================================
--
-- QUÉ FALTABA. Una alarma insiste hasta que el problema se resuelve, y nadie puede decir que la
-- está atendiendo. Pasaban las dos cosas peores a la vez: quien la estaba atendiendo seguía
-- recibiendo avisos de algo que ya tenía en la mano, y los demás no tenían cómo enterarse de que
-- alguien se había ocupado, así que o se ocupaban todos o no se ocupaba nadie.
--
-- QUÉ SE AGREGA. Una fila que dice quién se hizo cargo de qué alarma y a qué hora. Mientras esa
-- fila está en pie, el proceso de fondo no insiste con esa alarma. Tomarla no resuelve nada: el
-- problema se sigue resolviendo donde siempre.
--
-- LA TOMA VENCE, Y ÉSA ES LA PARTE IMPORTANTE. Una alarma que se calla para siempre porque alguien
-- apretó un botón es peor que una que insiste: se apagaría sola justo el día en que esa persona
-- tuvo que salir corriendo. Por eso cada toma nace con la hora en que se le termina el rato, y
-- cuando ese rato pasa la alarma vuelve como si nadie la hubiera tomado. Cuánto dura lo decide cada
-- Prestadora, y el valor de fábrica vive en `panel/src/lib/alarmasTomadas.js`, que se copia al
-- motor.
--
-- POR QUÉ UNA SOLA TABLA PARA CUATRO CLASES DE ALARMA. Las cuatro —la alerta temprana, el incidente
-- de relevo, el turno que terminó sin cerrar y el turno que se acerca sin nadie— viven en tablas
-- distintas y no se parecen en nada salvo en esto: insisten hasta que alguien las atiende. Una
-- columna «tomada por» en cada una de las cuatro sería la misma decisión escrita cuatro veces, y la
-- quinta clase de alarma que aparezca la escribiría una quinta.
--
-- NO SE PISA LA TOMA ANTERIOR. Cada vez que alguien se hace cargo queda una fila nueva. Quién
-- atendió qué y cuándo es justamente lo que había que poder reconstruir, y un renglón que se
-- sobreescribe no reconstruye nada.

BEGIN;

-- ---------------------------------------------------------------------------
-- Quién se hizo cargo de qué
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.alarmas_tomadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,

  -- Qué clase de alarma y cuál. No hay clave foránea posible: el identificador apunta a una tabla
  -- distinta según el tipo. Los nombres de tipo son los de `panel/src/lib/alarmasTomadas.js`.
  tipo text NOT NULL,
  referencia_id uuid NOT NULL,

  tomada_por uuid NOT NULL REFERENCES public.usuarios(id),
  tomada_at timestamptz NOT NULL DEFAULT now(),
  -- Cuándo vuelve la alarma si el problema sigue abierto. Sin esto la toma sería un apagador.
  vence_at timestamptz NOT NULL,
  -- La soltó a mano antes de que se le cumpliera el rato.
  soltada_at timestamptz,
  -- Lo que quiera dejar escrito de qué está haciendo. Nunca datos de salud ni de la persona
  -- atendida: esto lo lee quien audita el servicio.
  nota text,

  CONSTRAINT alarmas_tomadas_tipo_conocido
    CHECK (tipo IN ('alerta_temprana_guardia', 'incidente_relevo', 'guardia_sin_cerrar',
                    'incidente_turno_sin_cubrir')),

  CONSTRAINT alarmas_tomadas_vence_despues_de_tomarse
    CHECK (vence_at > tomada_at)
);

COMMENT ON TABLE public.alarmas_tomadas IS
  'Quien se hizo cargo de una alarma y hasta cuando. Mientras la toma esta en pie el proceso de fondo no insiste con esa alarma. Tomarla no la resuelve.';
COMMENT ON COLUMN public.alarmas_tomadas.referencia_id IS
  'La fila alarmada. La tabla a la que apunta depende del tipo: no hay clave foranea posible.';
COMMENT ON COLUMN public.alarmas_tomadas.vence_at IS
  'Cuando vuelve la alarma si el problema sigue abierto. Cuanto dura la toma lo decide cada Prestadora; el valor de fabrica vive en panel/src/lib/alarmasTomadas.js.';
COMMENT ON COLUMN public.alarmas_tomadas.nota IS
  'Lo que quien la tomo dejo escrito. Nunca datos de salud ni de la persona atendida.';

-- El proceso de fondo pregunta, por Prestadora y por clase de alarma, cuáles están tomadas en este
-- momento. Sin este índice recorrería la tabla entera, que crece con cada alarma atendida.
CREATE INDEX IF NOT EXISTS alarmas_tomadas_en_pie
  ON public.alarmas_tomadas (prestadora_id, tipo, vence_at)
  WHERE soltada_at IS NULL;

-- ---------------------------------------------------------------------------
-- Quién puede tomar una alarma
-- ---------------------------------------------------------------------------
--
-- Cualquiera que coordina en esa Prestadora, y la administración. No se ancla en el turno como el
-- incidente del turno vacío, y es a propósito: los avisos de alarma no salen filtrados por zona
-- —van al destino general de la Prestadora—, así que la persona que reacciona puede no ser la que
-- tiene ese turno a cargo. Impedirle tomarla sería impedirle avisar que se está ocupando de algo
-- que ya le llegó.

ALTER TABLE public.alarmas_tomadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY coordinador_gestiona_alarmas_tomadas ON public.alarmas_tomadas
  FOR ALL
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

CREATE POLICY panel_gestiona_alarmas_tomadas ON public.alarmas_tomadas
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
GRANT ALL ON TABLE public.alarmas_tomadas TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La misma lista, con el nombre de quien la tomó
-- ---------------------------------------------------------------------------
--
-- El nombre vive en `usuarios`, y la única política de esa tabla deja que cada persona lea su
-- propia fila y ninguna otra: la pantalla dibujaría un guión en el único dato que importa, que es
-- quién se está ocupando. Misma salida que los avisos de cierre de servicio: una vista que muestra
-- exactamente las mismas filas —se evalúa con los permisos de quien consulta— y agrega una sola
-- columna calculada. Para escribir se usa la tabla.

CREATE OR REPLACE VIEW public.alarmas_tomadas_quien_la_tomo
  WITH (security_invoker = 'true') AS
SELECT
  a.id,
  a.prestadora_id,
  a.tipo,
  a.referencia_id,
  a.tomada_por,
  a.tomada_at,
  a.vence_at,
  a.soltada_at,
  a.nota,
  interno.nombre_de_usuario(a.tomada_por) AS tomada_por_nombre
FROM public.alarmas_tomadas a;

ALTER VIEW public.alarmas_tomadas_quien_la_tomo OWNER TO postgres;

-- Mínimo privilegio, y hay que pedirlo dos veces: los privilegios por defecto del esquema `public`
-- le dan a los tres roles todos los permisos sobre cualquier vista nueva, y una vista de una sola
-- tabla sigue siendo actualizable. Sin sesión no se lee, así que `anon` no recibe nada.
REVOKE ALL ON TABLE public.alarmas_tomadas_quien_la_tomo FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.alarmas_tomadas_quien_la_tomo TO authenticated, service_role;

COMMENT ON VIEW public.alarmas_tomadas_quien_la_tomo IS
  'Las tomas de alarma con el nombre de quien la tomo ya resuelto. Muestra exactamente las mismas filas que alarmas_tomadas: lo unico que agrega es el nombre. Para escribir se usa la tabla.';

-- ---------------------------------------------------------------------------
-- Cuánto dura hacerse cargo lo decide la Prestadora
-- ---------------------------------------------------------------------------
--
-- Vacío mientras la Prestadora no toque nada, para que un cambio de valor de fábrica alcance a
-- todas salvo en lo que cada una decidió. Los valores de fábrica y los bordes viven en
-- `panel/src/lib/alarmasTomadas.js`, no acá: escribirlos dos veces los haría divergir.

CREATE TABLE IF NOT EXISTS public.configuracion_alarmas_tomadas (
  prestadora_id uuid PRIMARY KEY REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  regla jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracion_alarmas_tomadas_regla_es_objeto
    CHECK (jsonb_typeof(regla) = 'object')
);

COMMENT ON TABLE public.configuracion_alarmas_tomadas IS
  'Cuanto dura hacerse cargo de una alarma. Solo lo que esta Prestadora corrio; los valores de fabrica y los bordes viven en panel/src/lib/alarmasTomadas.js.';

ALTER TABLE public.configuracion_alarmas_tomadas ENABLE ROW LEVEL SECURITY;

-- Escribe el motor con la llave de servicio; esta política es la segunda red. Lee el Panel de esa
-- Prestadora, que tiene que poder mostrar cuánto dura una toma antes de que la alarma vuelva.
CREATE POLICY panel_lee_configuracion_alarmas_tomadas ON public.configuracion_alarmas_tomadas
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

REVOKE ALL ON TABLE public.configuracion_alarmas_tomadas FROM anon;
REVOKE ALL ON TABLE public.configuracion_alarmas_tomadas FROM authenticated;
GRANT SELECT ON TABLE public.configuracion_alarmas_tomadas TO authenticated;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'alarmas_tomadas'
       AND policyname = 'coordinador_gestiona_alarmas_tomadas'
  ) THEN
    v_faltan := v_faltan || ' el permiso de la Coordinadora para tomar una alarma;';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.alarmas_tomadas', 'INSERT') THEN
    v_faltan := v_faltan || ' el permiso de tabla para tomarla desde el Panel;';
  END IF;

  IF has_table_privilege('authenticated', 'public.alarmas_tomadas_quien_la_tomo', 'UPDATE') THEN
    v_faltan := v_faltan || ' la vista quedo abierta a escritura;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La migracion no dejo lo que dice que deja:%', v_faltan;
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

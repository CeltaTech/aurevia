-- ============================================================================================
-- Dónde se atiende al Paciente ese día (pendiente #153)
--
-- EL PROBLEMA. El Paciente tiene una sola dirección, la de su ficha, y hay temporadas en que no
-- está ahí: el verano en la casa de un hijo, una internación, una mudanza mientras arreglan el
-- departamento. La tabla `domicilios_temporales_paciente` existe desde el principio con sus
-- columnas y su regla de acceso, pero nadie la escribe ni la lee, así que el sistema no se
-- entera. Lo que se rompe con eso no es prolijidad: el Asistente va a un lugar distinto del que
-- figura, el check-in mide la distancia contra la casa de siempre, lo da por fuera de rango y le
-- manda al Coordinador un aviso automático que es un falso positivo.
--
-- LA DECISIÓN. Mientras dura, la dirección temporal **reemplaza** a la de la ficha; no conviven.
-- La ficha no se toca —sigue siendo la casa del Paciente, y ahí vuelve cuando el período
-- termina—, pero todo lo que pregunta "¿dónde se atiende hoy?" recibe la temporal. Y la carga el
-- Panel, no la Familia: es la Prestadora la que tiene que saber a dónde manda a su gente.
--
-- QUÉ AGREGA ESTA MIGRACIÓN
--   1. Que un mismo Paciente no pueda tener dos direcciones temporales pisadas en el mismo día.
--      Sin eso, "¿cuál vale?" no tiene respuesta y cada pantalla contestaría distinto.
--   2. La función que contesta esa pregunta, escrita **una sola vez** (regla 12 de CLAUDE.md §7):
--      la usan el check-in, la aplicación del Asistente y el Panel. Si estuviera escrita tres
--      veces, el día que cambie el criterio dos de las tres se quedarían con el viejo.
--
-- QUÉ NO AGREGA. Ninguna dirección se geocodifica acá: las coordenadas llegan cargadas, igual
-- que las de la ficha del Paciente.
-- ============================================================================================

-- --------------------------------------------------------------------------------------------
-- 1. Un período no se pisa con otro
-- --------------------------------------------------------------------------------------------

-- `btree_gist` es lo que permite mezclar en una misma restricción una igualdad común (el
-- Paciente) con un solapamiento de fechas. Va en el esquema `extensions`, que es donde esta base
-- guarda las extensiones.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- Un período que termina antes de empezar no es un período.
ALTER TABLE public.domicilios_temporales_paciente
  DROP CONSTRAINT IF EXISTS domicilios_temp_fechas_coherentes;
ALTER TABLE public.domicilios_temporales_paciente
  ADD CONSTRAINT domicilios_temp_fechas_coherentes
  CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio);

-- Dos direcciones temporales del mismo Paciente no pueden compartir ni un día. `fecha_fin` vacía
-- significa "sigue abierta", y por eso se lee como un período sin final.
ALTER TABLE public.domicilios_temporales_paciente
  DROP CONSTRAINT IF EXISTS domicilios_temp_sin_superposicion;
ALTER TABLE public.domicilios_temporales_paciente
  ADD CONSTRAINT domicilios_temp_sin_superposicion
  EXCLUDE USING gist (
    paciente_id WITH =,
    daterange(fecha_inicio, COALESCE(fecha_fin, 'infinity'::date), '[]') WITH &&
  );

COMMENT ON CONSTRAINT domicilios_temp_sin_superposicion ON public.domicilios_temporales_paciente IS
  'Un Paciente no puede estar en dos lados el mismo día. Sin esto, "¿dónde se atiende hoy?" no tendría una sola respuesta.';

-- Buscar por Paciente ya tiene índice; lo que falta es entrar por Prestadora y por fecha, que es
-- como la va a mirar el Panel ("qué direcciones temporales hay abiertas hoy").
CREATE INDEX IF NOT EXISTS idx_domicilios_temp_prestadora_fechas
  ON public.domicilios_temporales_paciente (prestadora_id, fecha_inicio DESC);

-- --------------------------------------------------------------------------------------------
-- 2. La pregunta contestada en un solo lugar
-- --------------------------------------------------------------------------------------------

-- Devuelve, para cada Paciente pedido, dónde se lo atiende ese día: la dirección temporal si hay
-- una vigente, y si no la de su ficha. El que llama no decide nada — pregunta y recibe una sola
-- dirección, ya resuelta.
--
-- `SECURITY INVOKER` a propósito: quien consulta ve lo que las reglas de acceso de `pacientes` y
-- de `domicilios_temporales_paciente` le dejan ver, ni una fila más. El motor entra con la clave
-- de servicio y por lo tanto sin esas reglas, así que del lado del motor el aislamiento entre
-- Prestadoras lo garantiza el filtro de cada consulta, como en todo el resto.
CREATE OR REPLACE FUNCTION public.domicilios_de_pacientes_en(
  p_pacientes uuid[],
  p_fecha date
)
RETURNS TABLE (
  paciente_id uuid,
  domicilio_temporal_id uuid,
  domicilio text,
  lat double precision,
  lng double precision,
  es_temporal boolean,
  motivo text,
  desde date,
  hasta date
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    p.id AS paciente_id,
    -- Cuál es la fila que está mandando, para que quien la muestre pueda señalarla sin volver a
    -- resolver la regla por su cuenta. Vacío cuando manda la dirección de la ficha.
    d.id AS domicilio_temporal_id,
    COALESCE(d.domicilio, p.domicilio) AS domicilio,
    COALESCE(d.lat, p.lat) AS lat,
    COALESCE(d.lng, p.lng) AS lng,
    d.id IS NOT NULL AS es_temporal,
    d.motivo,
    d.fecha_inicio AS desde,
    d.fecha_fin AS hasta
  FROM public.pacientes p
  LEFT JOIN LATERAL (
    SELECT t.id, t.domicilio, t.lat, t.lng, t.motivo, t.fecha_inicio, t.fecha_fin
    FROM public.domicilios_temporales_paciente t
    WHERE t.paciente_id = p.id
      AND t.fecha_inicio <= p_fecha
      AND (t.fecha_fin IS NULL OR t.fecha_fin >= p_fecha)
    -- La restricción de arriba garantiza que haya una sola; el orden y el tope son la red por si
    -- alguna vez se afloja esa restricción.
    ORDER BY t.fecha_inicio DESC
    LIMIT 1
  ) d ON true
  WHERE p.id = ANY (p_pacientes);
$$;

COMMENT ON FUNCTION public.domicilios_de_pacientes_en(uuid[], date) IS
  'Único lugar donde se decide dónde se atiende a un Paciente un día dado: la dirección temporal vigente, o la de la ficha. La usan el check-in, la aplicación del Asistente y el Panel.';

-- La misma pregunta para uno solo, que es como se lee mejor en el código que atiende una guardia.
-- No repite el criterio: llama a la de arriba.
CREATE OR REPLACE FUNCTION public.domicilio_del_paciente_en(
  p_paciente_id uuid,
  p_fecha date
)
RETURNS TABLE (
  paciente_id uuid,
  domicilio_temporal_id uuid,
  domicilio text,
  lat double precision,
  lng double precision,
  es_temporal boolean,
  motivo text,
  desde date,
  hasta date
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT * FROM public.domicilios_de_pacientes_en(ARRAY[p_paciente_id], p_fecha);
$$;

COMMENT ON FUNCTION public.domicilio_del_paciente_en(uuid, date) IS
  'Dónde se atiende a un Paciente un día dado. Forma corta de domicilios_de_pacientes_en para un solo Paciente.';

GRANT EXECUTE ON FUNCTION public.domicilios_de_pacientes_en(uuid[], date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.domicilio_del_paciente_en(uuid, date) TO authenticated, service_role;

-- --------------------------------------------------------------------------------------------
-- 3. Que la Familia pueda ver dónde se está atendiendo a los suyos
-- --------------------------------------------------------------------------------------------

-- La regla de acceso que ya estaba deja escribir y leer al Panel. Falta la lectura de la Familia:
-- si el Paciente está pasando una temporada en otro lado, la Familia tiene que poder verlo en su
-- aplicación igual que ve la dirección de la ficha. Solo lectura, y solo de los suyos.
--
-- "Los suyos" se pregunta con `familia_id_de_usuario`, que es la misma función con la que la
-- Familia lee sus Pacientes (`familia_ve_sus_pacientes`). La condición no se vuelve a escribir
-- acá: si mañana cambia quién pertenece a una Familia, cambia en un solo lugar.
DROP POLICY IF EXISTS familia_lee_domicilios_temporales ON public.domicilios_temporales_paciente;
CREATE POLICY familia_lee_domicilios_temporales
  ON public.domicilios_temporales_paciente
  FOR SELECT
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1
      FROM public.pacientes p
      WHERE p.id = domicilios_temporales_paciente.paciente_id
        AND p.familia_id = familia_id_de_usuario(auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';

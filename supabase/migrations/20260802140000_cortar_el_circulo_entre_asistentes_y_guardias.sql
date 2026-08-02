-- ============================================================================
-- Cortar el círculo entre asistentes y guardias
--
-- EL PROBLEMA, en criollo. Las reglas de acceso de la base (RLS) dicen quién
-- puede ver cada fila. Dos de ellas se preguntaban cosas la una a la otra:
--
--   * Para saber si alguien puede ver un Asistente, la regla
--     "familia_ve_asistente_asignado" iba a mirar la tabla `guardias`.
--   * Para saber si alguien puede ver una guardia, la regla
--     "asistente_ve_guardias_ofrecidas" iba a mirar la tabla `asistentes`.
--
-- Resultado: la base preguntaba A para contestar B y B para contestar A, sin
-- final. Postgres lo corta solo y devuelve el error
-- `infinite recursion detected in policy for relation "asistentes"`.
-- En el Panel eso salía como una franja roja en "Actividad de esta semana" y
-- en "Alertas y continuidad": ninguna consulta que tocara Asistentes andaba.
--
-- LA SOLUCIÓN, que es la misma que ya usa este proyecto en otros lados
-- (`current_tenant()`, `es_superadmin()`, `coordinador_alcanza_guardia()`):
-- se saca la consulta de adentro de la regla y se la mete en una función
-- SECURITY DEFINER. Una función así corre con los permisos de quien la creó,
-- así que cuando mira la otra tabla NO vuelve a disparar las reglas de esa
-- tabla — y el círculo se corta. Es también lo que recomienda la propia
-- documentación de Supabase para este error.
--
-- Se corta por los dos lados a propósito. Con arreglar uno solo alcanzaría
-- hoy, pero la primera regla nueva que alguien escriba mañana volvería a armar
-- el círculo sin que nadie se dé cuenta.
--
-- QUÉ NO CAMBIA: quién ve qué. Las dos reglas siguen dejando pasar y frenando
-- exactamente a la misma gente que antes; lo único que cambia es por dónde
-- pasa la pregunta.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. ¿Quien está usando el sistema ahora mismo es un Asistente?
--
--    Sin argumento, igual que `es_superadmin()`: pregunta siempre por la
--    persona de la sesión y por nadie más. Si recibiera un id cualquiera,
--    serviría para averiguar de afuera si tal o cual usuario es Asistente.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION es_asistente()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM asistentes a WHERE a.id = auth.uid()
  );
$$;

COMMENT ON FUNCTION es_asistente() IS
  'Única fuente de verdad para saber si quien tiene la sesión abierta es un Asistente. Va por función y no dentro de la política para no volver a disparar las reglas de la tabla asistentes (recursión infinita).';

GRANT EXECUTE ON FUNCTION es_asistente() TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. ¿Este Asistente atiende a algún Paciente de la Familia de la sesión?
--
--    La función mira `guardias` y `pacientes` sin pasar por las reglas de esas
--    tablas, pero el filtro de adentro la ata a la Familia de quien pregunta
--    (`familia_id_de_usuario(auth.uid())`): no puede contestar nada sobre otra
--    Familia aunque se la llame con cualquier id. Y devuelve solo sí o no,
--    nunca datos.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION asistente_asignado_a_familia(p_asistente_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM guardias g
    JOIN pacientes p ON p.id = g.paciente_id
    WHERE g.asistente_id = p_asistente_id
      AND p.familia_id = familia_id_de_usuario(auth.uid())
  );
$$;

COMMENT ON FUNCTION asistente_asignado_a_familia(UUID) IS
  'Única fuente de verdad para saber si un Asistente atiende a un Paciente de la Familia de la sesión. Va por función y no dentro de la política para no armar un círculo entre asistentes y guardias.';

GRANT EXECUTE ON FUNCTION asistente_asignado_a_familia(UUID) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3. Las dos políticas, reescritas con las funciones
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "familia_ve_asistente_asignado" ON asistentes;

CREATE POLICY "familia_ve_asistente_asignado" ON asistentes
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND asistente_asignado_a_familia(asistentes.id)
  );


DROP POLICY IF EXISTS "asistente_ve_guardias_ofrecidas" ON guardias;

CREATE POLICY "asistente_ve_guardias_ofrecidas" ON guardias
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND asistente_id IS NULL
    AND ofrecida_at IS NOT NULL
    AND es_asistente()
  );


NOTIFY pgrst, 'reload schema';

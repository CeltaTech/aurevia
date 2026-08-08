-- Las reglas de la base miran a todos los Pacientes del turno, no a uno
--
-- La migración 20260807190000 puso la lista de Pacientes de una guardia en `guardia_pacientes`,
-- pero siete reglas de acceso (RLS) siguieron preguntando por la columna vieja
-- `guardias.paciente_id`, que guarda uno solo. El efecto era grave y silencioso: para la Familia
-- del segundo Paciente de un turno compartido, la base contestaba "acá no hay nada". Sin
-- guardias, sin reportes, sin poder calificar al Asistente que estuvo en su casa. No era un
-- error en pantalla —era la base diciendo que esa Familia no tenía derecho a ver eso.
--
-- Acá se reescriben las siete contra la lista. La condición "¿a quiénes atiende esta guardia?"
-- no se copia regla por regla: vive en una función y todas la usan (CLAUDE.md §7 regla 12).
--
-- Las funciones son SECURITY DEFINER a propósito. `guardia_pacientes` tiene su propia RLS, que
-- deja ver la lista de una guardia visible; si una regla sobre guardias preguntara por la lista,
-- y la lista preguntara por la guardia, quedaría dando vueltas sin salida. La función corta ese
-- círculo: contesta a quiénes atiende el turno, y quien la llama sigue teniendo que demostrar
-- que esa gente es suya.

-- ---------------------------------------------------------------------------
-- El punto único de verdad, del lado de la base
-- ---------------------------------------------------------------------------

-- A quiénes atiende esta guardia. Es el gemelo en SQL de `pacientesDeGuardia` en el backend y
-- en el Panel.
CREATE OR REPLACE FUNCTION pacientes_de_la_guardia(p_guardia_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT paciente_id FROM guardia_pacientes WHERE guardia_id = p_guardia_id
$$;

-- Lo mismo para la serie, la plantilla desde la que se generan las guardias.
CREATE OR REPLACE FUNCTION pacientes_de_la_serie(p_serie_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT paciente_id FROM series_guardias_pacientes WHERE serie_id = p_serie_id
$$;

-- Al revés: en qué turnos aparece este Paciente.
CREATE OR REPLACE FUNCTION guardias_del_paciente(p_paciente_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT guardia_id FROM guardia_pacientes WHERE paciente_id = p_paciente_id
$$;

-- ¿Este Asistente atendió alguna vez a alguien de esta Familia? Se pregunta entera y de una vez
-- porque la regla de los certificados la necesita así, y armarla a mano ahí adentro obligaría a
-- que una regla de acceso consulte la lista de otra tabla que a su vez tiene reglas.
CREATE OR REPLACE FUNCTION asistente_atiende_a_la_familia(p_asistente_id uuid, p_familia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM guardia_pacientes gp
    JOIN guardias g ON g.id = gp.guardia_id
    JOIN pacientes p ON p.id = gp.paciente_id
    WHERE g.asistente_id = p_asistente_id
      AND p.familia_id = p_familia_id
  )
$$;

COMMENT ON FUNCTION pacientes_de_la_guardia(uuid) IS
  'A quiénes atiende una guardia. Punto único de verdad de las reglas de acceso (CLAUDE.md §7 regla 12).';
COMMENT ON FUNCTION pacientes_de_la_serie(uuid) IS
  'A quiénes atiende una serie de guardias. Punto único de verdad de las reglas de acceso.';
COMMENT ON FUNCTION guardias_del_paciente(uuid) IS
  'En qué guardias aparece un Paciente. Punto único de verdad de las reglas de acceso.';
COMMENT ON FUNCTION asistente_atiende_a_la_familia(uuid, uuid) IS
  'Si un Asistente tiene alguna guardia con algún Paciente de esa Familia.';

-- ---------------------------------------------------------------------------
-- Las siete reglas
-- ---------------------------------------------------------------------------

-- 1. La Familia ve las guardias de sus Pacientes.
DROP POLICY IF EXISTS familia_ve_guardias_de_sus_pacientes ON guardias;
CREATE POLICY familia_ve_guardias_de_sus_pacientes ON guardias
  FOR SELECT
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM pacientes p
      WHERE p.id IN (SELECT pacientes_de_la_guardia(guardias.id))
        AND p.familia_id = familia_id_de_usuario(auth.uid())
    )
  );

-- 2. La Familia ve los reportes de sus Pacientes. El reporte todavía no dice de qué Paciente
--    habla —lo dice a través de la guardia— así que alcanza con que alguno del turno sea suyo.
--    Cuando el reporte tenga su propio Paciente (tarea 93h), esta regla se vuelve directa.
DROP POLICY IF EXISTS familia_ve_reportes_de_sus_pacientes ON reportes;
CREATE POLICY familia_ve_reportes_de_sus_pacientes ON reportes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pacientes p
      WHERE p.id IN (SELECT pacientes_de_la_guardia(reportes.guardia_id))
        AND p.familia_id = familia_id_de_usuario(auth.uid())
    )
  );

-- 3. La Familia califica al Asistente de una guardia suya. Además de que el turno sea suyo, se
--    exige que el Paciente que se escribe en la calificación sea uno de los del turno: si no,
--    una Familia podría dejarle una estrella a un Asistente en nombre de un Paciente que ese
--    Asistente nunca atendió.
DROP POLICY IF EXISTS familia_crea_su_calificacion ON calificaciones_asistente;
CREATE POLICY familia_crea_su_calificacion ON calificaciones_asistente
  FOR INSERT
  WITH CHECK (
    familia_id = auth.uid()
    AND prestadora_id = current_tenant()
    AND calificaciones_asistente.paciente_id IN (
      SELECT pacientes_de_la_guardia(calificaciones_asistente.guardia_id)
    )
    AND EXISTS (
      SELECT 1 FROM pacientes p
      WHERE p.id = calificaciones_asistente.paciente_id
        AND p.familia_id = auth.uid()
    )
  );

-- 4. La Familia ve los certificados del Asistente que le mandan a la casa.
DROP POLICY IF EXISTS familia_ve_certificado_asistente_asignado ON certificados;
CREATE POLICY familia_ve_certificado_asistente_asignado ON certificados
  FOR SELECT
  USING (
    asistente_atiende_a_la_familia(certificados.asistente_id, familia_id_de_usuario(auth.uid()))
  );

-- 5. El Coordinador toca las guardias de un Servicio que se está cerrando. Basta con que alguno
--    de los Pacientes del turno tenga el cierre abierto: el turno se cae igual.
DROP POLICY IF EXISTS coordinador_cierra_servicio_guardias ON guardias;
CREATE POLICY coordinador_cierra_servicio_guardias ON guardias
  FOR ALL
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (
      SELECT 1 FROM cierres_servicio_paciente c
      WHERE c.paciente_id IN (SELECT pacientes_de_la_guardia(guardias.id))
    )
  )
  WITH CHECK (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (
      SELECT 1 FROM cierres_servicio_paciente c
      WHERE c.paciente_id IN (SELECT pacientes_de_la_guardia(guardias.id))
    )
  );

-- 6. Lo mismo, sobre la plantilla que genera esas guardias.
DROP POLICY IF EXISTS coordinador_cierra_servicio_series_guardias ON series_guardias;
CREATE POLICY coordinador_cierra_servicio_series_guardias ON series_guardias
  FOR ALL
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (
      SELECT 1 FROM cierres_servicio_paciente c
      WHERE c.paciente_id IN (SELECT pacientes_de_la_serie(series_guardias.id))
    )
  )
  WITH CHECK (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (
      SELECT 1 FROM cierres_servicio_paciente c
      WHERE c.paciente_id IN (SELECT pacientes_de_la_serie(series_guardias.id))
    )
  );

-- 7. El Coordinador administra los informes de Obra Social de los Pacientes de su zona. La zona
--    se deduce de quién los atiende, y eso se lee de la lista del turno.
DROP POLICY IF EXISTS coordinador_gestiona_informes_obra_social_de_su_zona ON informes_obra_social;
CREATE POLICY coordinador_gestiona_informes_obra_social_de_su_zona ON informes_obra_social
  FOR ALL
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1
      FROM usuarios u, guardias g, asistentes a
      WHERE u.id = auth.uid()
        AND u.rol = 'coordinador'
        AND g.id IN (SELECT guardias_del_paciente(informes_obra_social.paciente_id))
        AND a.id = g.asistente_id
        AND u.zonas && a.zonas
    )
  );

NOTIFY pgrst, 'reload schema';

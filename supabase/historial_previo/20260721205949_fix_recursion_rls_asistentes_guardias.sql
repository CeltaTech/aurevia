-- Corta la referencia circular entre las policies de RLS de asistentes y guardias:
-- asistentes.familia_ve_asistente_asignado hace JOIN contra guardias, y
-- guardias.coordinador_gestiona_guardias_de_su_zona hacía JOIN directo contra asistentes.
-- Evaluar una disparaba la otra en loop ("infinite recursion detected in policy for
-- relation asistentes"). Se resuelve leyendo las zonas del Asistente con una función
-- SECURITY DEFINER (mismo patrón ya usado por current_tenant()/es_superadmin()), que al
-- ser propiedad de postgres (dueño de la tabla, sin FORCE ROW LEVEL SECURITY) no dispara
-- la evaluación de RLS de asistentes.

CREATE OR REPLACE FUNCTION zonas_de_asistente(p_asistente_id UUID) RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT zonas FROM asistentes WHERE id = p_asistente_id
$$;

DROP POLICY IF EXISTS "coordinador_gestiona_guardias_de_su_zona" ON guardias;

CREATE POLICY "coordinador_gestiona_guardias_de_su_zona" ON guardias
  FOR ALL USING (
    guardias.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && zonas_de_asistente(guardias.asistente_id)
    )
  );

NOTIFY pgrst, 'reload schema';
;

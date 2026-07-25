-- Pendiente #85 (docs/PENDIENTES.md), Grupo 3 Marketplace — mitigante de diseño "no
-- opcional" del riesgo legal invertido (docs/PRD_07_Modalidad_Marketplace.md:115-117):
-- derecho de descargo del Asistente ante una calificación/queja, cargado una sola vez, no
-- editable después (mismo criterio de inmutabilidad que la calificación misma).

ALTER TABLE calificaciones_asistente
  ADD COLUMN IF NOT EXISTS descargo_asistente TEXT,
  ADD COLUMN IF NOT EXISTS descargo_en TIMESTAMPTZ;

-- El Asistente carga su propio descargo una sola vez (WITH CHECK impide pisar uno ya
-- cargado, validado también en la ruta del backend por ser más legible que expresarlo acá).
DROP POLICY IF EXISTS "asistente_carga_su_descargo" ON calificaciones_asistente;
CREATE POLICY "asistente_carga_su_descargo" ON calificaciones_asistente
  FOR UPDATE USING (
    asistente_id = auth.uid()
    AND descargo_asistente IS NULL
  )
  WITH CHECK (
    asistente_id = auth.uid()
  );

NOTIFY pgrst, 'reload schema';

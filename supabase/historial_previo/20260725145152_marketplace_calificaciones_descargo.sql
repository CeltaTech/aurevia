ALTER TABLE calificaciones_asistente
  ADD COLUMN IF NOT EXISTS descargo_asistente TEXT,
  ADD COLUMN IF NOT EXISTS descargo_en TIMESTAMPTZ;

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
;

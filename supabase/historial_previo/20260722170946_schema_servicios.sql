-- Entidad Servicio (Fase 6). Un Servicio pertenece siempre a UNA sola Familia.
CREATE TABLE IF NOT EXISTS servicios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  familia_id UUID NOT NULL REFERENCES familias(id),
  etiqueta TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'de_baja')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE servicios ADD CONSTRAINT servicios_id_prestadora_unique UNIQUE (id, prestadora_id);

CREATE INDEX IF NOT EXISTS idx_servicios_familia ON servicios (familia_id);

ALTER TABLE servicios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "panel_gestiona_servicios" ON servicios
  FOR ALL USING (
    es_superadmin() OR (
      servicios.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

CREATE POLICY "familia_ve_sus_servicios" ON servicios
  FOR SELECT USING (servicios.familia_id = auth.uid());

ALTER TABLE prestaciones ADD COLUMN IF NOT EXISTS servicio_id UUID REFERENCES servicios(id);
ALTER TABLE guardias ADD COLUMN IF NOT EXISTS servicio_id UUID REFERENCES servicios(id);

CREATE OR REPLACE FUNCTION validar_servicio_misma_familia()
RETURNS TRIGGER AS $$
DECLARE
  familia_paciente UUID;
  familia_servicio UUID;
BEGIN
  IF NEW.servicio_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT familia_id INTO familia_paciente FROM pacientes WHERE id = NEW.paciente_id;
  SELECT familia_id INTO familia_servicio FROM servicios WHERE id = NEW.servicio_id;

  IF familia_paciente IS NULL OR familia_servicio IS NULL OR familia_paciente <> familia_servicio THEN
    RAISE EXCEPTION 'El Servicio indicado no pertenece a la misma Familia que el Paciente';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS validar_servicio_prestaciones ON prestaciones;
CREATE TRIGGER validar_servicio_prestaciones
  BEFORE INSERT OR UPDATE OF servicio_id, paciente_id ON prestaciones
  FOR EACH ROW EXECUTE FUNCTION validar_servicio_misma_familia();

DROP TRIGGER IF EXISTS validar_servicio_guardias ON guardias;
CREATE TRIGGER validar_servicio_guardias
  BEFORE INSERT OR UPDATE OF servicio_id, paciente_id ON guardias
  FOR EACH ROW EXECUTE FUNCTION validar_servicio_misma_familia();

ALTER TABLE facturas_familia_items ADD COLUMN IF NOT EXISTS servicio_id UUID REFERENCES servicios(id);

NOTIFY pgrst, 'reload schema';
;

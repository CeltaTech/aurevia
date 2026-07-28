-- Etapa 5 — Informe para Obra Social (ex "Planillas IOMA"), plan aprobado 2026-07-21.
-- Generaliza el campo de afiliado (antes acoplado a IOMA específicamente) y agrega la tabla
-- que guarda, de forma inmutable, cada informe validado por la Prestadora — trazabilidad y
-- posible respaldo de facturación.

-- 0. Generalización de "afiliado" en pacientes — de IOMA-específico a obra social genérica.
ALTER TABLE pacientes RENAME COLUMN ioma_afiliado TO numero_afiliado;
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS obra_social TEXT;

-- 1. INFORMES_OBRA_SOCIAL — snapshot inmutable de cada informe validado por la Prestadora.
CREATE TABLE IF NOT EXISTS informes_obra_social (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  paciente_id UUID NOT NULL,
  familia_id UUID NOT NULL REFERENCES familias(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('planilla_asistencia', 'resumen_mensual')),
  periodo_desde DATE NOT NULL,
  periodo_hasta DATE NOT NULL,
  contenido JSONB NOT NULL,
  estado TEXT NOT NULL DEFAULT 'validado' CHECK (estado IN ('validado', 'anulado')),
  motivo_anulacion TEXT,
  generado_por UUID NOT NULL REFERENCES usuarios(id),
  validado_por UUID NOT NULL REFERENCES usuarios(id),
  validado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  anulado_por UUID REFERENCES usuarios(id),
  anulado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT informes_obra_social_paciente_tenant_fk
    FOREIGN KEY (paciente_id, prestadora_id) REFERENCES pacientes (id, prestadora_id),
  CONSTRAINT informes_obra_social_anulacion_check
    CHECK (estado = 'anulado' OR (anulado_por IS NULL AND anulado_en IS NULL AND motivo_anulacion IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_informes_obra_social_paciente ON informes_obra_social (paciente_id, periodo_desde DESC);
CREATE INDEX IF NOT EXISTS idx_informes_obra_social_prestadora ON informes_obra_social (prestadora_id, periodo_desde DESC);

ALTER TABLE informes_obra_social ENABLE ROW LEVEL SECURITY;

CREATE POLICY "panel_gestiona_informes_obra_social" ON informes_obra_social
  FOR ALL USING (
    es_superadmin() OR (
      informes_obra_social.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_gestiona_informes_obra_social_de_su_zona" ON informes_obra_social
  FOR ALL USING (
    informes_obra_social.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      JOIN guardias g ON g.paciente_id = informes_obra_social.paciente_id
      JOIN asistentes a ON a.id = g.asistente_id
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && a.zonas
    )
  );

NOTIFY pgrst, 'reload schema';
;

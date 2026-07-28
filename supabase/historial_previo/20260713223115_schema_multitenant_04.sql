-- ============================================================================
-- schema_multitenant_04.sql
-- Bloque 4 del plan (docs/PLAN_MULTITENANT_PLM.md, ver también
-- schema_multitenant_01.sql:9-11): reemplaza el singleton `configuracion_empresa`
-- (fila única `id=1`, sin tenant) por `configuracion_prestadora`, con una fila
-- por prestadora y RLS real vía current_tenant()/es_superadmin().
-- ============================================================================

CREATE TABLE IF NOT EXISTS configuracion_prestadora (
  prestadora_id UUID PRIMARY KEY REFERENCES prestadoras(id),
  nombre TEXT NOT NULL,
  telefono TEXT,
  whatsapp_numero TEXT,
  email TEXT,
  dominio TEXT UNIQUE,
  zona_cobertura_texto TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO configuracion_prestadora (prestadora_id, nombre, telefono, whatsapp_numero, email, dominio, zona_cobertura_texto)
SELECT '874f54d7-4383-4d54-8b9f-f51d02f0dd11', nombre, telefono, whatsapp_numero, email, dominio, zona_cobertura_texto
FROM configuracion_empresa WHERE id = 1
ON CONFLICT (prestadora_id) DO NOTHING;

ALTER TABLE configuracion_prestadora ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prestadora_lee_su_configuracion" ON configuracion_prestadora
  FOR SELECT USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "prestadora_edita_su_configuracion" ON configuracion_prestadora
  FOR UPDATE USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

NOTIFY pgrst, 'reload schema';
;

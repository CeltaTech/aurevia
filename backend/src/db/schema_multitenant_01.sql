-- Migración multi-tenant (CeltaTech) — paso 01, Bloque 1 del kickoff de implementación
-- (docs/Documentos Obsoletos/Prompt_Claude_Code_Kickoff_Implementacion.md), pasos 1-4 de la sección 2 de
-- docs/PLAN_MULTITENANT_CELTATECH.md: crear la entidad `prestadoras`, agregar `prestadora_id`
-- (nullable → backfill → NOT NULL) a las tablas de negocio existentes.
--
-- Excluidas de este archivo (ver decisión del usuario, 2026-07-09):
--   - `verificaciones_asistente` — hereda tenant vía `asistente_id`, no necesita columna propia.
--   - `escalas_legales` — queda global hasta que exista un tenant fuera de Argentina (diseño 3.7).
--   - `configuracion_empresa`, `configuracion_notificaciones` — se reemplazan enteras por
--     `configuracion_prestadora` en el Bloque 4 (diseño 3.2); agregarles prestadora_id ahora
--     sería trabajo descartado en un par de pasos.
--   - `aspirantes` — verificado: no existe en Supabase real, se eliminó como código muerto en
--     `schema_etapa2k.sql`. La sección 1.1 del plan no tiene un hueco, la omitió a propósito.
--
-- El rename de rol admin → admin_prestadora (paso 5 del Bloque 1) NO está en este archivo:
-- se detectó que ~60 policies RLS en schema_etapa2*.sql comparan literalmente `rol = 'admin'`
-- (o `IN ('admin', ...)`) — renombrar el dato sin reescribir esas policies rompe el acceso de
-- todo admin de inmediato. Queda reportado aparte antes de ejecutar ese paso.
--
-- Ejecutar una sola vez contra Supabase real (conexión directa vía script Node de un solo
-- uso con `pg`, mismo mecanismo ya usado para schema_etapa2j/k/l.sql).

-- ============================================================================
-- ENTIDAD PRESTADORAS
-- ============================================================================
CREATE TYPE estado_prestadora AS ENUM (
  'prospecto', 'en_certificacion', 'certificada', 'suspendida', 'dada_de_baja'
);

CREATE TABLE IF NOT EXISTS prestadoras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  razon_social TEXT NOT NULL,
  nombre_fantasia TEXT NOT NULL,
  identificacion_fiscal TEXT,  -- NULL hasta que la prestadora lo cargue (ver 4.6 del plan) — nunca un placeholder de relleno
  pais TEXT NOT NULL DEFAULT 'AR',
  estado estado_prestadora NOT NULL DEFAULT 'prospecto',
  zonas_operacion TEXT[],
  plan_licencia TEXT,
  fecha_alta DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE prestadoras ENABLE ROW LEVEL SECURITY;

-- Solo superadmin (PLM) ve/gestiona el catálogo de prestadoras — es el dato cross-tenant
-- por excelencia, ninguna prestadora debe ver a otra.
CREATE POLICY "superadmin_gestiona_prestadoras" ON prestadoras
  FOR ALL USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'superadmin')
  );

-- identificacion_fiscal queda en NULL — no hay CUIT real documentado en el repo todavía
-- (regla 1 de CLAUDE.md: nunca inventar datos fiscales/de contacto reales; un placeholder de
-- texto como '[DEFINIR]' hubiera sido igual de inventado que un CUIT falso). Se carga cuando
-- exista una pantalla real para hacerlo (ver 4.6 del plan).
INSERT INTO prestadoras (id, razon_social, nombre_fantasia, identificacion_fiscal, pais, estado, fecha_alta)
VALUES ('874f54d7-4383-4d54-8b9f-f51d02f0dd11', 'Prestadora Demo', 'Prestadora Demo', NULL, 'AR', 'certificada', CURRENT_DATE)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- prestadora_id: nullable → backfill → NOT NULL, tabla por tabla
-- ============================================================================

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE usuarios SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE usuarios ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE asistentes ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE asistentes SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE asistentes ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE ausencias ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE ausencias SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE ausencias ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE guardias_cobertura ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE guardias_cobertura SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE guardias_cobertura ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE ceses ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE ceses SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE ceses ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE familias ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE familias SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE familias ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE pacientes SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE pacientes ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE lista_precios ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE lista_precios SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE lista_precios ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE prestaciones ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE prestaciones SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE prestaciones ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE paquetes_prestaciones ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE paquetes_prestaciones SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE paquetes_prestaciones ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE paquete_prestacion_items ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE paquete_prestacion_items SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE paquete_prestacion_items ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE certificados ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE certificados SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE certificados ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE zonas_cobertura ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE zonas_cobertura SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE zonas_cobertura ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE solicitudes SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE solicitudes ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE postulaciones ADD COLUMN IF NOT EXISTS prestadora_id UUID REFERENCES prestadoras(id);
UPDATE postulaciones SET prestadora_id = '874f54d7-4383-4d54-8b9f-f51d02f0dd11' WHERE prestadora_id IS NULL;
ALTER TABLE postulaciones ALTER COLUMN prestadora_id SET NOT NULL;

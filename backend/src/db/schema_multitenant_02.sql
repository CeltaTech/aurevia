-- Migración multi-tenant (CeltaTech) — paso 02, Bloque 2 del kickoff de implementación
-- (docs/Documentos Obsoletos/Prompt_Claude_Code_Kickoff_Implementacion.md), paso 5 de la sección 2 de
-- docs/PLAN_MULTITENANT_CELTATECH.md, ejecutado junto con el diseño 3.6 (current_tenant()/
-- es_superadmin()) por decisión del usuario (2026-07-09): reescribir el rename de rol
-- admin → admin_prestadora Y las ~28 policies RLS que dependen de ese valor en un solo
-- paso, en vez de tocarlas dos veces.
--
-- Orden de este archivo (importa, cada paso depende del anterior):
--   1. Funciones current_tenant()/es_superadmin() (diseño 3.6).
--   2. CHECK de usuarios.rol: reemplaza 'admin' por 'admin_prestadora' en la lista
--      permitida — tiene que pasar ANTES del UPDATE de datos, o el UPDATE viola el
--      CHECK viejo (que todavía no incluye 'admin_prestadora', ver Bloque 1: se dejó
--      así a propósito para no romper filas existentes antes de este paso).
--   3. UPDATE usuarios SET rol = 'admin_prestadora' WHERE rol = 'admin'.
--   4. Reescritura de las 28 policies vigentes que comparaban `rol = 'admin'` (inventario
--      completo relevado contra las 20 tablas con RLS activa, cruzando cada
--      DROP POLICY/CREATE POLICY posterior para tomar solo la versión vigente hoy).
--
-- Tablas con prestadora_id (Bloque 1, schema_multitenant_01.sql): la condición de tenant se
-- agrega vía `tabla.prestadora_id = current_tenant()`. Tablas sin la columna
-- (verificaciones_asistente hereda vía join a asistentes; escalas_legales,
-- configuracion_empresa, configuracion_notificaciones quedan sin filtro de tenant
-- todavía — excluidas del Bloque 1 a propósito, ver comentario de schema_multitenant_01.sql).
--
-- Ejecutar una sola vez contra Supabase real (mismo mecanismo: script Node de un solo
-- uso con `pg`, borrado después de usarlo).

-- ============================================================================
-- 1. FUNCIONES DE TENANT (diseño 3.6 del plan)
-- ============================================================================

CREATE OR REPLACE FUNCTION current_tenant() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT prestadora_id FROM usuarios WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION es_superadmin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol = 'superadmin')
$$;

-- ============================================================================
-- 2-3. RENAME DE ROL: admin → admin_prestadora (CHECK primero, después el dato)
-- ============================================================================

-- Paso intermedio: el CHECK viejo no permite 'admin_prestadora' y el UPDATE de abajo
-- lo necesita antes de existir en ninguna fila — se ensancha el CHECK primero (acepta
-- los dos valores un instante), se corren los datos, y recién después se angosta al
-- valor final. Hacerlo en un solo ALTER (viejo → nuevo directo) falla: ADD CONSTRAINT
-- valida contra las filas ya existentes, que en ese momento todavía dicen 'admin'.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin', 'admin_prestadora', 'coordinador', 'asistente', 'familia', 'superadmin'));

UPDATE usuarios SET rol = 'admin_prestadora' WHERE rol = 'admin';

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin_prestadora', 'coordinador', 'asistente', 'familia', 'superadmin'));

-- ============================================================================
-- 4. REESCRITURA DE POLICIES — admin_prestadora + current_tenant()/es_superadmin()
-- ============================================================================

-- ---- postulaciones (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "panel_lee_postulaciones" ON postulaciones;
CREATE POLICY "panel_lee_postulaciones" ON postulaciones
  FOR SELECT USING (
    es_superadmin() OR (
      postulaciones.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

DROP POLICY IF EXISTS "panel_edita_postulaciones" ON postulaciones;
CREATE POLICY "panel_edita_postulaciones" ON postulaciones
  FOR UPDATE USING (
    es_superadmin() OR (
      postulaciones.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

-- ---- solicitudes (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "panel_lee_solicitudes" ON solicitudes;
CREATE POLICY "panel_lee_solicitudes" ON solicitudes
  FOR SELECT USING (
    es_superadmin() OR (
      solicitudes.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

DROP POLICY IF EXISTS "panel_edita_solicitudes" ON solicitudes;
CREATE POLICY "panel_edita_solicitudes" ON solicitudes
  FOR UPDATE USING (
    es_superadmin() OR (
      solicitudes.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

-- ---- asistentes (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "admin_lee_asistentes" ON asistentes;
CREATE POLICY "admin_lee_asistentes" ON asistentes
  FOR SELECT USING (
    es_superadmin() OR (
      asistentes.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

DROP POLICY IF EXISTS "panel_edita_asistentes" ON asistentes;
CREATE POLICY "panel_edita_asistentes" ON asistentes
  FOR ALL USING (
    es_superadmin() OR (
      asistentes.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

DROP POLICY IF EXISTS "coordinador_lee_asistentes_de_su_zona" ON asistentes;
CREATE POLICY "coordinador_lee_asistentes_de_su_zona" ON asistentes
  FOR SELECT USING (
    asistentes.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && asistentes.zonas)
  );

DROP POLICY IF EXISTS "coordinador_edita_asistentes_de_su_zona" ON asistentes;
CREATE POLICY "coordinador_edita_asistentes_de_su_zona" ON asistentes
  FOR UPDATE USING (
    asistentes.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && asistentes.zonas)
  );

-- ---- verificaciones_asistente (sin columna propia, hereda tenant vía asistente_id) ----
DROP POLICY IF EXISTS "admin_gestiona_verificaciones" ON verificaciones_asistente;
CREATE POLICY "admin_gestiona_verificaciones" ON verificaciones_asistente
  FOR ALL USING (
    es_superadmin() OR EXISTS (
      SELECT 1 FROM usuarios u
      JOIN asistentes a ON a.id = verificaciones_asistente.asistente_id
      WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora' AND a.prestadora_id = current_tenant()
    )
  );

DROP POLICY IF EXISTS "coordinador_gestiona_verificaciones_de_su_zona" ON verificaciones_asistente;
CREATE POLICY "coordinador_gestiona_verificaciones_de_su_zona" ON verificaciones_asistente
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      JOIN asistentes a ON a.id = verificaciones_asistente.asistente_id
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && a.zonas AND a.prestadora_id = current_tenant()
    )
  );

-- ---- escalas_legales (global, sin filtro de tenant — ver diseño 3.7) ----
DROP POLICY IF EXISTS "admin_gestiona_escalas_legales" ON escalas_legales;
CREATE POLICY "admin_gestiona_escalas_legales" ON escalas_legales
  FOR ALL USING (
    es_superadmin() OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  );

-- ---- ausencias (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "admin_gestiona_ausencias" ON ausencias;
CREATE POLICY "admin_gestiona_ausencias" ON ausencias
  FOR ALL USING (
    es_superadmin() OR (
      ausencias.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

DROP POLICY IF EXISTS "coordinador_gestiona_ausencias_de_su_zona" ON ausencias;
CREATE POLICY "coordinador_gestiona_ausencias_de_su_zona" ON ausencias
  FOR ALL USING (
    ausencias.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      JOIN asistentes a ON a.id = ausencias.asistente_id
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && a.zonas
    )
  );

-- ---- guardias_cobertura (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "admin_gestiona_guardias_cobertura" ON guardias_cobertura;
CREATE POLICY "admin_gestiona_guardias_cobertura" ON guardias_cobertura
  FOR ALL USING (
    es_superadmin() OR (
      guardias_cobertura.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

DROP POLICY IF EXISTS "coordinador_gestiona_guardias_cobertura_de_su_zona" ON guardias_cobertura;
CREATE POLICY "coordinador_gestiona_guardias_cobertura_de_su_zona" ON guardias_cobertura
  FOR ALL USING (
    guardias_cobertura.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      JOIN asistentes a ON a.id = guardias_cobertura.asistente_sustituto_id
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && a.zonas
    )
  );

-- ---- ceses (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "admin_gestiona_ceses" ON ceses;
CREATE POLICY "admin_gestiona_ceses" ON ceses
  FOR ALL USING (
    es_superadmin() OR (
      ceses.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

-- ---- familias (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "panel_gestiona_familias" ON familias;
CREATE POLICY "panel_gestiona_familias" ON familias
  FOR ALL USING (
    es_superadmin() OR (
      familias.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

-- ---- pacientes (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "panel_gestiona_pacientes" ON pacientes;
CREATE POLICY "panel_gestiona_pacientes" ON pacientes
  FOR ALL USING (
    es_superadmin() OR (
      pacientes.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

-- ---- lista_precios (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "panel_lee_lista_precios" ON lista_precios;
CREATE POLICY "panel_lee_lista_precios" ON lista_precios
  FOR SELECT USING (
    es_superadmin() OR (
      lista_precios.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

DROP POLICY IF EXISTS "admin_edita_lista_precios" ON lista_precios;
CREATE POLICY "admin_edita_lista_precios" ON lista_precios
  FOR INSERT WITH CHECK (
    es_superadmin() OR (
      lista_precios.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

DROP POLICY IF EXISTS "admin_actualiza_lista_precios" ON lista_precios;
CREATE POLICY "admin_actualiza_lista_precios" ON lista_precios
  FOR UPDATE USING (
    es_superadmin() OR (
      lista_precios.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

DROP POLICY IF EXISTS "admin_borra_lista_precios" ON lista_precios;
CREATE POLICY "admin_borra_lista_precios" ON lista_precios
  FOR DELETE USING (
    es_superadmin() OR (
      lista_precios.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

-- ---- prestaciones (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "panel_gestiona_prestaciones" ON prestaciones;
CREATE POLICY "panel_gestiona_prestaciones" ON prestaciones
  FOR ALL USING (
    es_superadmin() OR (
      prestaciones.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

-- ---- paquetes_prestaciones (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "panel_gestiona_paquetes" ON paquetes_prestaciones;
CREATE POLICY "panel_gestiona_paquetes" ON paquetes_prestaciones
  FOR ALL USING (
    es_superadmin() OR (
      paquetes_prestaciones.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

-- ---- paquete_prestacion_items (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "panel_gestiona_paquete_items" ON paquete_prestacion_items;
CREATE POLICY "panel_gestiona_paquete_items" ON paquete_prestacion_items
  FOR ALL USING (
    es_superadmin() OR (
      paquete_prestacion_items.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

-- ---- certificados (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "admin_gestiona_certificados" ON certificados;
CREATE POLICY "admin_gestiona_certificados" ON certificados
  FOR ALL USING (
    es_superadmin() OR (
      certificados.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

DROP POLICY IF EXISTS "coordinador_gestiona_certificados_de_su_zona" ON certificados;
CREATE POLICY "coordinador_gestiona_certificados_de_su_zona" ON certificados
  FOR ALL USING (
    certificados.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      JOIN asistentes a ON a.id = certificados.asistente_id
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && a.zonas
    )
  );

-- ---- configuracion_empresa (sin prestadora_id todavía — CHECK (id=1), reemplazo
--      completo por configuracion_prestadora en el Bloque 4; acá solo se renombra el
--      rol, no se agrega tenant) ----
DROP POLICY IF EXISTS "panel_lee_configuracion_empresa" ON configuracion_empresa;
CREATE POLICY "panel_lee_configuracion_empresa" ON configuracion_empresa
  FOR SELECT USING (
    es_superadmin() OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  );

DROP POLICY IF EXISTS "panel_edita_configuracion_empresa" ON configuracion_empresa;
CREATE POLICY "panel_edita_configuracion_empresa" ON configuracion_empresa
  FOR UPDATE USING (
    es_superadmin() OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  );

-- ---- zonas_cobertura (prestadora_id agregado en Bloque 1) ----
DROP POLICY IF EXISTS "panel_gestiona_zonas_cobertura" ON zonas_cobertura;
CREATE POLICY "panel_gestiona_zonas_cobertura" ON zonas_cobertura
  FOR ALL USING (
    es_superadmin() OR (
      zonas_cobertura.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

-- ---- configuracion_notificaciones (sin prestadora_id todavía, mismo motivo que
--      configuracion_empresa) ----
DROP POLICY IF EXISTS "panel_gestiona_configuracion_notificaciones" ON configuracion_notificaciones;
CREATE POLICY "panel_gestiona_configuracion_notificaciones" ON configuracion_notificaciones
  FOR ALL USING (
    es_superadmin() OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  );

-- ---- prestadoras (ya usaba solo 'superadmin', se alinea a es_superadmin() por
--      consistencia con el resto — sin cambio de comportamiento) ----
DROP POLICY IF EXISTS "superadmin_gestiona_prestadoras" ON prestadoras;
CREATE POLICY "superadmin_gestiona_prestadoras" ON prestadoras
  FOR ALL USING (es_superadmin());

-- ============================================================================
-- 5. PARCHE — bug real encontrado al escribir este archivo, no del diseño de RLS:
--    el Bloque 1 puso `prestadora_id` en NOT NULL en 15 tablas, pero ningún insert
--    de hoy (backend con Service Role Key ni panel con anon key) setea esa columna.
--    Sin este DEFAULT, cualquier alta nueva (cuenta, familia, paciente, ausencia,
--    guardia, certificado, cese, precio, prestación, zona, solicitud, postulación)
--    falla por violar el NOT NULL. Mismo mecanismo que ya usó el backfill del
--    Bloque 1 (UUID literal de la Prestadora Demo) — no es una regla de negocio hardcodeada en
--    código de aplicación (regla 1 de CLAUDE.md), es un default a nivel de schema,
--    igual de explícito que el `CHECK (id = 1)` de `configuracion_empresa`.
--    TEMPORAL: el Bloque 3 (filtrado real de tenant en rutas del backend con
--    Service Role Key) reemplaza esto por el prestadora_id real de quien hace el
--    alta en cada request — no está diseñado ni aprobado todavía, se reporta aparte.
-- ============================================================================

ALTER TABLE usuarios ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE asistentes ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE ausencias ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE guardias_cobertura ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE ceses ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE familias ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE pacientes ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE lista_precios ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE prestaciones ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE paquetes_prestaciones ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE paquete_prestacion_items ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE certificados ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE zonas_cobertura ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE solicitudes ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';
ALTER TABLE postulaciones ALTER COLUMN prestadora_id SET DEFAULT '874f54d7-4383-4d54-8b9f-f51d02f0dd11';

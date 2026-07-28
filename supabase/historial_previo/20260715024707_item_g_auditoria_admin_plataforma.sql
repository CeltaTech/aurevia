-- Ítem G del pendiente #30 (docs/PENDIENTES.md, docs/PLAN_MULTITENANT_PLM.md 3.4.1) — log
-- de auditoría de todo login/acción sensible de admin_plataforma dentro de una prestadora.
--
-- Cobertura elegida por el Desarrollador: completa, con triggers de base de datos —
-- pero el backend Express conecta a Supabase con la service role key
-- (backend/src/db/connection.js:5), sin JWT de usuario, así que auth.uid() es NULL dentro
-- de cualquier trigger disparado por una escritura que pasa por el backend. Los triggers
-- de este archivo cubren las escrituras directas a Supabase desde el Panel (RLS con JWT
-- de usuario); las escrituras que pasan por rutas Express las audita
-- backend/src/middleware/requiereRolPanel.js (mutaciones genéricas) y
-- backend/src/routes/panelSesionTenant.js (login/logout/renovación) directamente desde
-- el código del backend, con service role — ambas piezas juntas son "cobertura completa"
-- dado cómo está partido el sistema entre RLS directo y rutas Express.

-- ============================================================================
-- 1. Tabla de auditoría
-- ============================================================================

CREATE TABLE IF NOT EXISTS auditoria_admin_plataforma (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES usuarios(id),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  tipo_evento TEXT NOT NULL CHECK (tipo_evento IN ('login', 'logout', 'renovacion', 'mutacion')),
  tabla_afectada TEXT,
  operacion TEXT CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE')),
  registro_id UUID,
  detalle JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_admin_plataforma_prestadora
  ON auditoria_admin_plataforma (prestadora_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_admin_plataforma_admin
  ON auditoria_admin_plataforma (admin_id, created_at DESC);

ALTER TABLE auditoria_admin_plataforma ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_lee_toda_la_auditoria" ON auditoria_admin_plataforma
  FOR SELECT USING (es_superadmin());

CREATE POLICY "admin_prestadora_lee_auditoria_de_su_prestadora" ON auditoria_admin_plataforma
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora' AND u.prestadora_id = auditoria_admin_plataforma.prestadora_id
    )
  );

-- ============================================================================
-- 2. Helper: ¿hay sesión de tenant admin_plataforma vigente para auth.uid()?
-- ============================================================================

CREATE OR REPLACE FUNCTION es_sesion_tenant_admin_plataforma_activa() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM sesiones_tenant_admin_plataforma s
      WHERE s.admin_id = auth.uid()
        AND s.salida_at IS NULL
        AND s.expira_at > NOW()
        AND s.ultima_actividad_at > NOW() - INTERVAL '5 minutes'
  )
$$;

-- ============================================================================
-- 3. Trigger genérico de auditoría de mutaciones (escrituras directas a Supabase)
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_auditoria_admin_plataforma_mutacion() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registro_id UUID;
BEGIN
  IF NOT es_sesion_tenant_admin_plataforma_activa() THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    BEGIN
      v_registro_id := OLD.id;
    EXCEPTION WHEN undefined_column THEN
      v_registro_id := NULL;
    END;
  ELSE
    BEGIN
      v_registro_id := NEW.id;
    EXCEPTION WHEN undefined_column THEN
      v_registro_id := NULL;
    END;
  END IF;

  INSERT INTO auditoria_admin_plataforma (admin_id, prestadora_id, tipo_evento, tabla_afectada, operacion, registro_id)
  VALUES (auth.uid(), current_tenant(), 'mutacion', TG_TABLE_NAME, TG_OP, v_registro_id);

  RETURN NULL;
END;
$$;

-- ============================================================================
-- 4. Trigger aplicado a las 35 tablas cuyas policies RLS usan current_tenant()
-- ============================================================================

DO $$
DECLARE
  tabla TEXT;
BEGIN
  FOREACH tabla IN ARRAY ARRAY[
    'alertas_tempranas_guardia', 'asistentes', 'ausencias', 'calificaciones_asistente', 'certificados',
    'ceses', 'cierres_servicio_paciente', 'configuracion_ausencia_automatica', 'configuracion_escalada_coordinador',
    'configuracion_escalada_relevo', 'configuracion_notificaciones', 'configuracion_prestadora',
    'configuracion_whatsapp_prestadora', 'conversaciones_whatsapp', 'documentos_asistente',
    'domicilios_temporales_paciente', 'excepciones_familiar_relevo', 'familias', 'guardias',
    'guardias_cobertura', 'guardias_tracking_gps', 'incidentes_relevo', 'lista_precios',
    'mensajes_whatsapp', 'notificaciones_cierre_servicio', 'pacientes', 'paquete_prestacion_items',
    'paquetes_prestaciones', 'personal_emergencia', 'plantillas_whatsapp', 'postulaciones',
    'prestaciones', 'prestadoras', 'series_guardias', 'solicitudes', 'tipos_documento_asistente',
    'zonas_cobertura'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria_admin_plataforma ON %I', tabla);
    EXECUTE format(
      'CREATE TRIGGER trg_auditoria_admin_plataforma AFTER INSERT OR UPDATE OR DELETE ON %I ' ||
      'FOR EACH ROW EXECUTE FUNCTION fn_auditoria_admin_plataforma_mutacion()',
      tabla
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
;

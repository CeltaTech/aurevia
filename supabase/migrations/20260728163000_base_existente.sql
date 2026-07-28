


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."causal_cese" AS ENUM (
    'renuncia',
    'mutuo_acuerdo',
    'despido_con_justa_causa',
    'despido_sin_causa',
    'abandono_de_trabajo',
    'muerte_del_trabajador',
    'muerte_del_empleador',
    'muerte_persona_cuidada',
    'periodo_de_prueba',
    'incapacidad_absoluta',
    'jubilacion',
    'despido_por_embarazo_o_matrimonio',
    'fin_contrato_comercial'
);


ALTER TYPE "public"."causal_cese" OWNER TO "postgres";


CREATE TYPE "public"."estado_prestadora" AS ENUM (
    'prospecto',
    'en_certificacion',
    'certificada',
    'suspendida',
    'dada_de_baja'
);


ALTER TYPE "public"."estado_prestadora" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bloquear_edicion_laboral_coordinador"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  rol_actual TEXT;
BEGIN
  SELECT rol INTO rol_actual FROM usuarios WHERE id = auth.uid();

  IF rol_actual = 'coordinador' THEN
    IF NEW.tipo_vinculo IS DISTINCT FROM OLD.tipo_vinculo
      OR NEW.categoria_cct IS DISTINCT FROM OLD.categoria_cct
      OR NEW.valor_hora IS DISTINCT FROM OLD.valor_hora
      OR NEW.sueldo_basico IS DISTINCT FROM OLD.sueldo_basico
      OR NEW.horas_semanales IS DISTINCT FROM OLD.horas_semanales
      OR NEW.causal_baja IS DISTINCT FROM OLD.causal_baja
      OR NEW.fecha_baja IS DISTINCT FROM OLD.fecha_baja
      OR NEW.score_riesgo_reclasificacion IS DISTINCT FROM OLD.score_riesgo_reclasificacion
      OR NEW.indicadores_riesgo IS DISTINCT FROM OLD.indicadores_riesgo
    THEN
      RAISE EXCEPTION 'Coordinador no puede modificar datos laborales internos del Asistente (regla 8 de CLAUDE.md)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bloquear_edicion_laboral_coordinador"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_tenant"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT s.prestadora_id FROM sesiones_tenant_admin_plataforma s
      WHERE s.admin_id = auth.uid()
        AND s.salida_at IS NULL
        AND s.expira_at > NOW()
        AND s.ultima_actividad_at > NOW() - INTERVAL '5 minutes'
      ORDER BY s.entrada_at DESC LIMIT 1),
    (SELECT prestadora_id FROM usuarios WHERE id = auth.uid())
  )
$$;


ALTER FUNCTION "public"."current_tenant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."es_admin_plataforma"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol = 'admin_plataforma')
$$;


ALTER FUNCTION "public"."es_admin_plataforma"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."es_sesion_tenant_admin_plataforma_activa"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM sesiones_tenant_admin_plataforma s
      WHERE s.admin_id = auth.uid()
        AND s.salida_at IS NULL
        AND s.expira_at > NOW()
        AND s.ultima_actividad_at > NOW() - INTERVAL '5 minutes'
  )
$$;


ALTER FUNCTION "public"."es_sesion_tenant_admin_plataforma_activa"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."es_superadmin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_mfa_obligatorio BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol = 'superadmin') THEN
    RETURN FALSE;
  END IF;

  SELECT mfa_admin_obligatorio INTO v_mfa_obligatorio FROM configuracion_plataforma LIMIT 1;

  IF COALESCE(v_mfa_obligatorio, FALSE) THEN
    RETURN (auth.jwt() ->> 'aal') = 'aal2';
  END IF;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."es_superadmin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."familia_id_de_usuario"("p_usuario_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT id FROM familias WHERE id = p_usuario_id),
    (SELECT familia_id FROM miembros_familia WHERE usuario_id = p_usuario_id)
  )
$$;


ALTER FUNCTION "public"."familia_id_de_usuario"("p_usuario_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guardar_credencial_pasarela_pago"("p_prestadora_id" "uuid", "p_proveedor" "text", "p_credencial" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT credencial_secret_id INTO v_secret_id
  FROM credenciales_pasarela_pago
  WHERE prestadora_id = p_prestadora_id AND proveedor = p_proveedor;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(p_credencial, 'pasarela_' || p_proveedor || '_' || p_prestadora_id::text);
    INSERT INTO credenciales_pasarela_pago (prestadora_id, proveedor, credencial_secret_id)
    VALUES (p_prestadora_id, p_proveedor, v_secret_id)
    ON CONFLICT (prestadora_id, proveedor)
    DO UPDATE SET credencial_secret_id = EXCLUDED.credencial_secret_id, updated_at = NOW();
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_credencial);
    UPDATE credenciales_pasarela_pago SET updated_at = NOW()
    WHERE prestadora_id = p_prestadora_id AND proveedor = p_proveedor;
  END IF;

  RETURN v_secret_id;
END;
$$;


ALTER FUNCTION "public"."guardar_credencial_pasarela_pago"("p_prestadora_id" "uuid", "p_proveedor" "text", "p_credencial" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guardar_credencial_smtp_prestadora"("p_prestadora_id" "uuid", "p_password" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT credencial_secret_id INTO v_secret_id
  FROM configuracion_email_prestadora
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(p_password, 'smtp_credencial_' || p_prestadora_id::text);
    UPDATE configuracion_email_prestadora
    SET credencial_secret_id = v_secret_id, updated_at = NOW()
    WHERE prestadora_id = p_prestadora_id;
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_password);
    UPDATE configuracion_email_prestadora SET updated_at = NOW() WHERE prestadora_id = p_prestadora_id;
  END IF;

  RETURN v_secret_id;
END;
$$;


ALTER FUNCTION "public"."guardar_credencial_smtp_prestadora"("p_prestadora_id" "uuid", "p_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guardar_token_whatsapp"("p_prestadora_id" "uuid", "p_token" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT token_secret_id INTO v_secret_id
  FROM configuracion_whatsapp_prestadora
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(p_token, 'whatsapp_token_' || p_prestadora_id::text);
    UPDATE configuracion_whatsapp_prestadora
    SET token_secret_id = v_secret_id, updated_at = NOW()
    WHERE prestadora_id = p_prestadora_id;
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_token);
    UPDATE configuracion_whatsapp_prestadora SET updated_at = NOW() WHERE prestadora_id = p_prestadora_id;
  END IF;

  RETURN v_secret_id;
END;
$$;


ALTER FUNCTION "public"."guardar_token_whatsapp"("p_prestadora_id" "uuid", "p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."intercambiar_orden_etapas_incorporacion"("p_id_a" "uuid", "p_orden_a" smallint, "p_id_b" "uuid", "p_orden_b" smallint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  UPDATE etapas_incorporacion_asistente SET orden = p_orden_a WHERE id = p_id_a;
  UPDATE etapas_incorporacion_asistente SET orden = p_orden_b WHERE id = p_id_b;
END;
$$;


ALTER FUNCTION "public"."intercambiar_orden_etapas_incorporacion"("p_id_a" "uuid", "p_orden_a" smallint, "p_id_b" "uuid", "p_orden_b" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leer_credencial_pasarela_pago"("p_prestadora_id" "uuid", "p_proveedor" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
  v_credencial TEXT;
BEGIN
  SELECT credencial_secret_id INTO v_secret_id
  FROM credenciales_pasarela_pago
  WHERE prestadora_id = p_prestadora_id AND proveedor = p_proveedor;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_credencial FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_credencial;
END;
$$;


ALTER FUNCTION "public"."leer_credencial_pasarela_pago"("p_prestadora_id" "uuid", "p_proveedor" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leer_credencial_smtp_prestadora"("p_prestadora_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
  v_password TEXT;
BEGIN
  SELECT credencial_secret_id INTO v_secret_id
  FROM configuracion_email_prestadora
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_password FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_password;
END;
$$;


ALTER FUNCTION "public"."leer_credencial_smtp_prestadora"("p_prestadora_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leer_token_whatsapp"("p_prestadora_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
  v_token TEXT;
BEGIN
  SELECT token_secret_id INTO v_secret_id
  FROM configuracion_whatsapp_prestadora
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_token;
END;
$$;


ALTER FUNCTION "public"."leer_token_whatsapp"("p_prestadora_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marcar_prestaciones_a_revisar"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.precio IS DISTINCT FROM OLD.precio THEN
    UPDATE prestaciones
    SET requiere_revision = true
    WHERE precio_lista_id = NEW.id AND estado = 'vigente';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."marcar_prestaciones_a_revisar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prestadora_tiene_modalidad_activa"("p_prestadora_id" "uuid", "p_modalidad" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM prestadora_modalidades
    WHERE prestadora_id = p_prestadora_id AND modalidad = p_modalidad AND activa = true
  );
$$;


ALTER FUNCTION "public"."prestadora_tiene_modalidad_activa"("p_prestadora_id" "uuid", "p_modalidad" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tiene_permiso"("p_accion" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_rol TEXT;
  v_prestadora_id UUID;
  v_cfg permisos_prestadora;
BEGIN
  SELECT rol, prestadora_id INTO v_rol, v_prestadora_id FROM usuarios WHERE id = auth.uid();

  IF v_rol IN ('admin_prestadora', 'superadmin') THEN
    RETURN TRUE;
  END IF;
  IF v_rol IS DISTINCT FROM 'coordinador' THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_cfg FROM permisos_prestadora
    WHERE prestadora_id = v_prestadora_id AND accion = p_accion;

  IF NOT FOUND THEN
    RETURN p_accion NOT IN ('alta_manual_asistente', 'alta_manual_familia');
  END IF;

  IF auth.uid() = ANY(v_cfg.excepciones_denegar) THEN RETURN FALSE; END IF;
  IF auth.uid() = ANY(v_cfg.excepciones_permitir) THEN RETURN TRUE; END IF;
  RETURN v_cfg.alcance = 'admin_y_coordinador';
END;
$$;


ALTER FUNCTION "public"."tiene_permiso"("p_accion" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_servicio_misma_familia"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."validar_servicio_misma_familia"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."zonas_de_asistente"("p_asistente_id" "uuid") RETURNS "text"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT zonas FROM asistentes WHERE id = p_asistente_id
$$;


ALTER FUNCTION "public"."zonas_de_asistente"("p_asistente_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."advertencias_legales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "jurisdiccion" "text" NOT NULL,
    "funcion_clave" "text" NOT NULL,
    "texto_advertencia" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."advertencias_legales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alertas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "nivel" "text" NOT NULL,
    "descripcion" "text",
    "detalle_coordinador" "text",
    "campos_preocupantes" "text"[],
    "resuelta" boolean DEFAULT false NOT NULL,
    "resuelta_por" "uuid",
    "resuelta_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reportes_relacionados" "uuid"[],
    CONSTRAINT "alertas_nivel_check" CHECK (("nivel" = ANY (ARRAY['verde'::"text", 'amarilla'::"text", 'roja'::"text"])))
);


ALTER TABLE "public"."alertas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alertas_contingencia_hospitalizacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "hospitalizacion_id" "uuid" NOT NULL,
    "paciente_hospitalizado_id" "uuid" NOT NULL,
    "paciente_conviviente_id" "uuid" NOT NULL,
    "detectado_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resuelto_at" timestamp with time zone,
    "resuelto_nota" "text"
);


ALTER TABLE "public"."alertas_contingencia_hospitalizacion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alertas_tempranas_guardia" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "guardia_id" "uuid" NOT NULL,
    "fuente" "text" NOT NULL,
    "motivo" "text",
    "reportado_por" "uuid",
    "detectado_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resuelto_at" timestamp with time zone,
    "resuelto_nota" "text",
    "ultima_notificacion_at" timestamp with time zone,
    "veces_notificado" integer DEFAULT 0 NOT NULL,
    "backup_notificado_at" timestamp with time zone
);


ALTER TABLE "public"."alertas_tempranas_guardia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asistentes" (
    "id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "telefono" "text",
    "email" "text",
    "foto_url" "text",
    "especialidades" "text"[],
    "zonas" "text"[],
    "disponibilidad" "jsonb",
    "estado" "text" DEFAULT 'activo'::"text" NOT NULL,
    "qr_token" "text" DEFAULT ("gen_random_uuid"())::"text",
    "tipo_vinculo" "text" DEFAULT 'monotributo'::"text" NOT NULL,
    "categoria_cct" "text",
    "fecha_alta" "date" DEFAULT CURRENT_DATE NOT NULL,
    "fecha_baja" "date",
    "causal_baja" "text",
    "valor_hora" numeric(12,2),
    "sueldo_basico" numeric(12,2),
    "horas_semanales" numeric(5,2),
    "score_riesgo_reclasificacion" integer DEFAULT 0 NOT NULL,
    "indicadores_riesgo" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "dni" "text",
    "prestadora_id" "uuid" NOT NULL,
    "canales" "text"[] DEFAULT ARRAY['directo'::"text", 'marketplace'::"text"] NOT NULL,
    "motivo_exclusion_directo" "text",
    "motivo_exclusion_marketplace" "text",
    "importacion_id" "uuid",
    "pendiente_conformidad" boolean DEFAULT false NOT NULL,
    CONSTRAINT "asistentes_canales_valido" CHECK ((("canales" <@ ARRAY['directo'::"text", 'marketplace'::"text"]) AND ("array_length"("canales", 1) > 0))),
    CONSTRAINT "asistentes_estado_check" CHECK (("estado" = ANY (ARRAY['activo'::"text", 'inactivo'::"text", 'cesado'::"text"]))),
    CONSTRAINT "asistentes_score_riesgo_reclasificacion_check" CHECK ((("score_riesgo_reclasificacion" >= 0) AND ("score_riesgo_reclasificacion" <= 100))),
    CONSTRAINT "asistentes_tipo_vinculo_check" CHECK (("tipo_vinculo" = ANY (ARRAY['monotributo'::"text", 'dependencia'::"text"])))
);


ALTER TABLE "public"."asistentes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."asistentes_coordinador" WITH ("security_invoker"='true') AS
 SELECT "id",
    "nombre",
    "telefono",
    "email",
    "foto_url",
    "especialidades",
    "zonas",
    "disponibilidad",
    "estado",
    "qr_token",
    "fecha_alta",
    "created_at",
    "updated_at",
    "deleted_at",
    "dni"
   FROM "public"."asistentes";


ALTER VIEW "public"."asistentes_coordinador" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."auditoria_admin_plataforma" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid" NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "tipo_evento" "text" NOT NULL,
    "tabla_afectada" "text",
    "operacion" "text",
    "registro_id" "uuid",
    "detalle" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auditoria_admin_plataforma_operacion_check" CHECK (("operacion" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text"]))),
    CONSTRAINT "auditoria_admin_plataforma_tipo_evento_check" CHECK (("tipo_evento" = ANY (ARRAY['login'::"text", 'logout'::"text", 'renovacion'::"text", 'mutacion'::"text"])))
);


ALTER TABLE "public"."auditoria_admin_plataforma" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."auditoria_advertencias_legales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "funcion_clave" "text" NOT NULL,
    "jurisdiccion" "text" NOT NULL,
    "texto_mostrado" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."auditoria_advertencias_legales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ausencias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "fecha_inicio" "date" NOT NULL,
    "fecha_fin" "date",
    "certificado_url" "text",
    "dias_computados" numeric(5,1),
    "guardias_afectadas" "uuid"[],
    "observaciones" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "prestadora_id" "uuid" NOT NULL,
    CONSTRAINT "ausencias_tipo_check" CHECK (("tipo" = ANY (ARRAY['enfermedad_inculpable'::"text", 'accidente_inculpable'::"text", 'otra_licencia'::"text", 'ausencia_no_justificada'::"text"])))
);


ALTER TABLE "public"."ausencias" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."autorizaciones_monitoreo_paciente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "nombre_avala" "text" NOT NULL,
    "rol_avala" "text" NOT NULL,
    "tipo_firma" "text" NOT NULL,
    "archivo_url" "text" NOT NULL,
    "fecha_autorizacion" "date" NOT NULL,
    "vigente" boolean DEFAULT true NOT NULL,
    "registrado_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "autorizaciones_monitoreo_paciente_rol_avala_check" CHECK (("rol_avala" = ANY (ARRAY['profesional'::"text", 'familiar'::"text"]))),
    CONSTRAINT "autorizaciones_monitoreo_paciente_tipo_firma_check" CHECK (("tipo_firma" = ANY (ARRAY['fisica'::"text", 'digital'::"text"])))
);


ALTER TABLE "public"."autorizaciones_monitoreo_paciente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calificaciones_asistente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "familia_id" "uuid" NOT NULL,
    "guardia_id" "uuid" NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "estrellas" integer NOT NULL,
    "comentario" "text",
    "visible_publica" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "descargo_asistente" "text",
    "descargo_en" timestamp with time zone,
    CONSTRAINT "calificaciones_asistente_estrellas_check" CHECK ((("estrellas" >= 1) AND ("estrellas" <= 5)))
);


ALTER TABLE "public"."calificaciones_asistente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cambios_precio_ia_pendientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "proveedor" "text" NOT NULL,
    "modelo" "text" NOT NULL,
    "precio_entrada_actual" numeric(10,4),
    "precio_salida_actual" numeric(10,4),
    "precio_entrada_detectado" numeric(10,4) NOT NULL,
    "precio_salida_detectado" numeric(10,4) NOT NULL,
    "fuente_url" "text" NOT NULL,
    "detectado_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "resuelto_at" timestamp with time zone,
    "resuelto_por" "uuid",
    CONSTRAINT "cambios_precio_ia_pendientes_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'confirmado'::"text", 'descartado'::"text"])))
);


ALTER TABLE "public"."cambios_precio_ia_pendientes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalogo_modulos" (
    "key" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "precio_addon" numeric(12,2),
    "moneda_addon" "text" DEFAULT 'USD'::"text" NOT NULL
);


ALTER TABLE "public"."catalogo_modulos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."certificados" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asistente_id" "uuid",
    "fecha_emision" "date" NOT NULL,
    "fecha_vencimiento" "date",
    "activo" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "prestadora_id" "uuid" NOT NULL
);


ALTER TABLE "public"."certificados" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ceses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "fecha_cese" "date" NOT NULL,
    "causal" "public"."causal_cese" NOT NULL,
    "detalle_calculo" "jsonb",
    "monto_total" numeric(14,2),
    "documentos_generados" "jsonb",
    "revisado_por_abogado" boolean DEFAULT false NOT NULL,
    "creado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "prestadora_id" "uuid" NOT NULL
);


ALTER TABLE "public"."ceses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cierre_servicio_asistentes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "cierre_id" "uuid" NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "avisado_verbalmente_at" timestamp with time zone,
    "avisado_verbalmente_por" "uuid",
    "aviso_automatico_enviado_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cierre_servicio_asistentes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cierres_servicio_paciente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "motivo" "text" NOT NULL,
    "motivo_detalle" "text",
    "cerrado_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cierres_servicio_paciente_motivo_check" CHECK (("motivo" = ANY (ARRAY['fin_demanda'::"text", 'fallecimiento'::"text", 'otro'::"text"]))),
    CONSTRAINT "cierres_servicio_paciente_motivo_detalle_check" CHECK ((("motivo" <> 'otro'::"text") OR ("motivo_detalle" IS NOT NULL)))
);


ALTER TABLE "public"."cierres_servicio_paciente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cobros_marketplace" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "suscripcion_id" "uuid" NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "medio" "text" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "periodo" "date" NOT NULL,
    "estado_cobro" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "referencia_externa" "text",
    "fecha_cobro" "date" DEFAULT CURRENT_DATE NOT NULL,
    "registrado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cobros_marketplace_estado_cobro_check" CHECK (("estado_cobro" = ANY (ARRAY['pendiente'::"text", 'exitoso'::"text", 'fallido'::"text"])))
);


ALTER TABLE "public"."cobros_marketplace" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_alertas_ia" (
    "prestadora_id" "uuid" NOT NULL,
    "palabras_clave" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."configuracion_alertas_ia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_ausencia_automatica" (
    "prestadora_id" "uuid" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "minutos_tolerancia_checkin" integer DEFAULT 15 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metros_tolerancia_checkin" integer DEFAULT 150 NOT NULL
);


ALTER TABLE "public"."configuracion_ausencia_automatica" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_aviso_cese_asistente" (
    "prestadora_id" "uuid" NOT NULL,
    "horas_plazo_aviso_verbal" smallint DEFAULT 24 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activo" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."configuracion_aviso_cese_asistente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_email_prestadora" (
    "prestadora_id" "uuid" NOT NULL,
    "activo" boolean DEFAULT false NOT NULL,
    "direccion_remitente" "text",
    "usuario_smtp" "text",
    "host" "text" DEFAULT 'smtp.gmail.com'::"text" NOT NULL,
    "puerto" integer DEFAULT 465 NOT NULL,
    "credencial_secret_id" "uuid",
    "verificado_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."configuracion_email_prestadora" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_escalada_coordinador" (
    "prestadora_id" "uuid" NOT NULL,
    "coordinador_backup_id" "uuid",
    "minutos_antes_backup" integer DEFAULT 15 NOT NULL,
    "umbrales_premura" "jsonb" DEFAULT '[{"maximo_minutos": 60, "intervalo_minutos": 10}, {"maximo_minutos": 240, "intervalo_minutos": 30}, {"maximo_minutos": null, "intervalo_minutos": 60}]'::"jsonb" NOT NULL,
    "fase_automatica_activa" boolean DEFAULT false NOT NULL,
    "minutos_antes_fase_automatica" integer DEFAULT 120 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."configuracion_escalada_coordinador" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_escalada_relevo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "nivel" integer NOT NULL,
    "minutos_demora" integer,
    "orden_prioridad" "text"[],
    "plantilla_mensaje" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."configuracion_escalada_relevo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_habilitacion_via_medicacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "via_administracion" "text" NOT NULL,
    "tipo_habilitacion_requerida" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."configuracion_habilitacion_via_medicacion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_notificaciones" (
    "evento" "text" NOT NULL,
    "descripcion" "text" NOT NULL,
    "emails" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "whatsapp_activo" boolean DEFAULT false NOT NULL,
    "notificar_familia" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."configuracion_notificaciones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_plataforma" (
    "id" boolean DEFAULT true NOT NULL,
    "mfa_admin_obligatorio" boolean DEFAULT false NOT NULL,
    "actualizado_por" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "umbral_alerta_prestadoras" integer DEFAULT 5 NOT NULL,
    CONSTRAINT "configuracion_plataforma_id_check" CHECK (("id" = true))
);


ALTER TABLE "public"."configuracion_plataforma" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_prestadora" (
    "prestadora_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "telefono" "text",
    "whatsapp_numero" "text",
    "email" "text",
    "dominio" "text",
    "zona_cobertura_texto" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."configuracion_prestadora" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_whatsapp_prestadora" (
    "prestadora_id" "uuid" NOT NULL,
    "activo" boolean DEFAULT false NOT NULL,
    "numero_telefono" "text",
    "waba_id" "text",
    "phone_number_id" "text",
    "token_secret_id" "uuid",
    "verificado_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."configuracion_whatsapp_prestadora" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversaciones_whatsapp" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "telefono" "text" NOT NULL,
    "asistente_id" "uuid",
    "ultimo_mensaje_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "requiere_atencion_coordinador" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."conversaciones_whatsapp" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credenciales_pasarela_pago" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "proveedor" "text" NOT NULL,
    "credencial_secret_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."credenciales_pasarela_pago" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documentos_asistente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "tipo_documento_id" "uuid" NOT NULL,
    "fecha_vencimiento" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."documentos_asistente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."domicilios_temporales_paciente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "domicilio" "text" NOT NULL,
    "lat" double precision NOT NULL,
    "lng" double precision NOT NULL,
    "motivo" "text" NOT NULL,
    "fecha_inicio" "date" NOT NULL,
    "fecha_fin" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."domicilios_temporales_paciente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."escalas_legales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tipo" "text" NOT NULL,
    "categoria" "text",
    "valor" numeric(14,4) NOT NULL,
    "unidad" "text" NOT NULL,
    "vigencia_desde" "date" NOT NULL,
    "vigencia_hasta" "date",
    "fuente" "text",
    "cargado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "jurisdiccion" "text" NOT NULL,
    CONSTRAINT "escalas_legales_unidad_check" CHECK (("unidad" = ANY (ARRAY['monto_fijo_mensual'::"text", 'porcentaje'::"text", 'dias'::"text", 'meses'::"text", 'monto_por_hora'::"text"])))
);


ALTER TABLE "public"."escalas_legales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."etapas_incorporacion_asistente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "clave" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "orden" smallint NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."etapas_incorporacion_asistente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."excepciones_familiar_relevo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "incidente_id" "uuid" NOT NULL,
    "familiar_nombre" "text" NOT NULL,
    "autorizado_por" "uuid" NOT NULL,
    "motivo" "text" NOT NULL,
    "desde_at" timestamp with time zone NOT NULL,
    "hasta_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."excepciones_familiar_relevo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."facturas_familia" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "familia_id" "uuid" NOT NULL,
    "periodo" "date" NOT NULL,
    "monto_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "fecha_emision" "date" DEFAULT CURRENT_DATE NOT NULL,
    "fecha_vencimiento" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "facturas_familia_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'pagada'::"text", 'vencida'::"text"])))
);


ALTER TABLE "public"."facturas_familia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."facturas_familia_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "factura_id" "uuid" NOT NULL,
    "paciente_id" "uuid",
    "descripcion" "text" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "servicio_id" "uuid"
);


ALTER TABLE "public"."facturas_familia_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."facturas_licencia" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "concepto" "text" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "moneda" "text" DEFAULT 'ARS'::"text" NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "fecha_emision" "date" DEFAULT CURRENT_DATE NOT NULL,
    "fecha_vencimiento" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "facturas_licencia_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'pagada'::"text", 'vencida'::"text"])))
);


ALTER TABLE "public"."facturas_licencia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."familias" (
    "id" "uuid" NOT NULL,
    "solicitud_id" bigint,
    "plan" "text" DEFAULT 'directo'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "prestadora_id" "uuid" NOT NULL,
    "importacion_id" "uuid",
    "pendiente_conformidad" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."familias" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."formulas_cese" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "jurisdiccion" "text" NOT NULL,
    "causal" "text" NOT NULL,
    "definicion" "jsonb" NOT NULL,
    "vigencia_desde" "date" NOT NULL,
    "vigencia_hasta" "date",
    "fuente" "text",
    "cargado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."formulas_cese" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guardias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "serie_id" "uuid",
    "coordinador_id" "uuid",
    "fecha" "date" NOT NULL,
    "hora_inicio" time without time zone NOT NULL,
    "hora_fin" time without time zone NOT NULL,
    "modalidad" "text" NOT NULL,
    "estado" "text" DEFAULT 'programada'::"text" NOT NULL,
    "cancelacion_origen" "text",
    "cancelacion_alcance" "text",
    "salida_checkin_at" timestamp with time zone,
    "salida_lat" double precision,
    "salida_lng" double precision,
    "medio_transporte" "text",
    "checkin_at" timestamp with time zone,
    "checkin_lat" double precision,
    "checkin_lng" double precision,
    "checkout_at" timestamp with time zone,
    "checkout_lat" double precision,
    "checkout_lng" double precision,
    "checkout_bloqueado" boolean DEFAULT false NOT NULL,
    "checkout_excepcion_motivo" "text",
    "checkout_excepcion_autorizado_por" "uuid",
    "checkout_excepcion_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "push_asignacion_enviado_at" timestamp with time zone,
    "push_recordatorio_enviado_at" timestamp with time zone,
    "ubicacion_actual_lat" double precision,
    "ubicacion_actual_lng" double precision,
    "ubicacion_actual_at" timestamp with time zone,
    "push_llegada_enviado_at" timestamp with time zone,
    "push_reporte_enviado_at" timestamp with time zone,
    "servicio_id" "uuid",
    "canal_modalidad" "text" DEFAULT 'directa'::"text" NOT NULL,
    CONSTRAINT "guardias_canal_modalidad_check" CHECK (("canal_modalidad" = ANY (ARRAY['directa'::"text", 'marketplace'::"text", 'cooperativa'::"text"]))),
    CONSTRAINT "guardias_cancelacion_alcance_check" CHECK (("cancelacion_alcance" = ANY (ARRAY['parcial'::"text", 'total'::"text"]))),
    CONSTRAINT "guardias_cancelacion_check" CHECK ((("estado" = 'cancelada'::"text") OR (("cancelacion_origen" IS NULL) AND ("cancelacion_alcance" IS NULL)))),
    CONSTRAINT "guardias_cancelacion_origen_check" CHECK (("cancelacion_origen" = ANY (ARRAY['familia'::"text", 'prestadora'::"text"]))),
    CONSTRAINT "guardias_checkout_bloqueado_requiere_excepcion" CHECK ((("checkout_at" IS NULL) OR (NOT "checkout_bloqueado") OR (("checkout_excepcion_motivo" IS NOT NULL) AND ("checkout_excepcion_autorizado_por" IS NOT NULL) AND ("checkout_excepcion_at" IS NOT NULL)))),
    CONSTRAINT "guardias_estado_check" CHECK (("estado" = ANY (ARRAY['programada'::"text", 'activa'::"text", 'completada'::"text", 'cancelada'::"text", 'ausente'::"text", 'pausada'::"text"])))
);


ALTER TABLE "public"."guardias" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guardias_cobertura" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "guardia_original_id" "uuid",
    "ausencia_id" "uuid",
    "asistente_sustituto_id" "uuid" NOT NULL,
    "costo_adicional" numeric(12,2),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "prestadora_id" "uuid" NOT NULL
);


ALTER TABLE "public"."guardias_cobertura" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guardias_tracking_gps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "guardia_id" "uuid" NOT NULL,
    "lat" double precision NOT NULL,
    "lng" double precision NOT NULL,
    "registrado_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."guardias_tracking_gps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."habilitaciones_asistente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "numero_matricula" "text",
    "vigente_desde" "date" NOT NULL,
    "vigente_hasta" "date",
    "archivo_url" "text",
    "registrado_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."habilitaciones_asistente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hospitalizaciones_paciente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "institucion" "text" NOT NULL,
    "motivo" "text",
    "fecha_inicio" "date" DEFAULT CURRENT_DATE NOT NULL,
    "fecha_fin" "date",
    "registrado_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."hospitalizaciones_paciente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."importaciones_prestadora" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "archivo_nombre" "text",
    "filas_totales" integer DEFAULT 0 NOT NULL,
    "filas_creadas" integer DEFAULT 0 NOT NULL,
    "filas_error" integer DEFAULT 0 NOT NULL,
    "errores" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "estado_conformidad" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "revisada_en" timestamp with time zone,
    "revisada_por" "uuid",
    CONSTRAINT "importaciones_prestadora_estado_conformidad_check" CHECK (("estado_conformidad" = ANY (ARRAY['pendiente'::"text", 'confirmada'::"text", 'rechazada'::"text"]))),
    CONSTRAINT "importaciones_prestadora_tipo_check" CHECK (("tipo" = ANY (ARRAY['asistente'::"text", 'familia'::"text"])))
);


ALTER TABLE "public"."importaciones_prestadora" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incidentes_relevo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "guardia_saliente_id" "uuid",
    "guardia_entrante_id" "uuid" NOT NULL,
    "nivel_actual" integer DEFAULT 1 NOT NULL,
    "iniciado_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resuelto_at" timestamp with time zone,
    "resuelto_por_tipo" "text",
    "resuelto_por_id" "uuid",
    "ultima_notificacion_at" timestamp with time zone,
    "veces_notificado" integer DEFAULT 0 NOT NULL,
    "backup_notificado_at" timestamp with time zone,
    "fase_automatica_notificada_at" timestamp with time zone,
    CONSTRAINT "incidentes_relevo_resuelto_por_check" CHECK ((("resuelto_por_id" IS NULL) = (("resuelto_por_tipo" = 'familiar'::"text") OR ("resuelto_por_tipo" IS NULL)))),
    CONSTRAINT "incidentes_relevo_resuelto_por_tipo_check" CHECK (("resuelto_por_tipo" = ANY (ARRAY['suplente'::"text", 'franquero'::"text", 'emergencia'::"text", 'familiar'::"text"])))
);


ALTER TABLE "public"."incidentes_relevo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."indicaciones_medicacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "familia_id" "uuid" NOT NULL,
    "medicamento" "text" NOT NULL,
    "dosis" "text" NOT NULL,
    "frecuencia" "text" NOT NULL,
    "via_administracion" "text" NOT NULL,
    "prescripcion_archivo_url" "text",
    "fecha_desde" "date" NOT NULL,
    "fecha_hasta" "date",
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "motivo_rechazo" "text",
    "solicitado_por" "uuid" NOT NULL,
    "revisado_por" "uuid",
    "revisado_en" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "indicaciones_medicacion_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'aceptada'::"text", 'rechazada'::"text", 'finalizada'::"text"])))
);


ALTER TABLE "public"."indicaciones_medicacion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."informes_obra_social" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "familia_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "periodo_desde" "date" NOT NULL,
    "periodo_hasta" "date" NOT NULL,
    "contenido" "jsonb" NOT NULL,
    "estado" "text" DEFAULT 'validado'::"text" NOT NULL,
    "motivo_anulacion" "text",
    "generado_por" "uuid" NOT NULL,
    "validado_por" "uuid" NOT NULL,
    "validado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "anulado_por" "uuid",
    "anulado_en" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "informes_obra_social_anulacion_check" CHECK ((("estado" = 'anulado'::"text") OR (("anulado_por" IS NULL) AND ("anulado_en" IS NULL) AND ("motivo_anulacion" IS NULL)))),
    CONSTRAINT "informes_obra_social_estado_check" CHECK (("estado" = ANY (ARRAY['validado'::"text", 'anulado'::"text"]))),
    CONSTRAINT "informes_obra_social_tipo_check" CHECK (("tipo" = ANY (ARRAY['planilla_asistencia'::"text", 'resumen_mensual'::"text"])))
);


ALTER TABLE "public"."informes_obra_social" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lista_precios" (
    "id" bigint NOT NULL,
    "tipo_servicio" "text" NOT NULL,
    "modalidad" "text" NOT NULL,
    "precio" numeric(12,2) NOT NULL,
    "vigente_desde" "date" DEFAULT CURRENT_DATE NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "prestadora_id" "uuid" NOT NULL
);


ALTER TABLE "public"."lista_precios" OWNER TO "postgres";


ALTER TABLE "public"."lista_precios" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lista_precios_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."mensajes_asistente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "mensaje" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "push_enviado_at" timestamp with time zone
);


ALTER TABLE "public"."mensajes_asistente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mensajes_whatsapp" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "conversacion_id" "uuid" NOT NULL,
    "direccion" "text" NOT NULL,
    "texto" "text" NOT NULL,
    "generado_por_ia" boolean DEFAULT false NOT NULL,
    "enviado_automaticamente" boolean DEFAULT false NOT NULL,
    "revisado_por_coordinador_at" timestamp with time zone,
    "meta_message_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mensajes_whatsapp_direccion_check" CHECK (("direccion" = ANY (ARRAY['entrante'::"text", 'saliente'::"text"])))
);


ALTER TABLE "public"."mensajes_whatsapp" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mfa_codigos_recuperacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "codigo_hash" "text" NOT NULL,
    "expira_at" timestamp with time zone NOT NULL,
    "usado" boolean DEFAULT false NOT NULL,
    "usado_en" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mfa_codigos_recuperacion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."miembros_familia" (
    "usuario_id" "uuid" NOT NULL,
    "familia_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "rol" "text" DEFAULT 'solo_lectura'::"text" NOT NULL,
    "creado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "miembros_familia_rol_check" CHECK (("rol" = 'solo_lectura'::"text"))
);


ALTER TABLE "public"."miembros_familia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."motivos_aviso_previo_guardia" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."motivos_aviso_previo_guardia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notificaciones_cierre_servicio" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "cierre_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "cerrado_por" "uuid" NOT NULL,
    "motivo" "text" NOT NULL,
    "motivo_detalle" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "visto_at" timestamp with time zone,
    "visto_por" "uuid"
);


ALTER TABLE "public"."notificaciones_cierre_servicio" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pacientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "familia_id" "uuid",
    "nombre" "text" NOT NULL,
    "fecha_nacimiento" "date",
    "patologias" "text"[],
    "medicacion_habitual" "jsonb",
    "nivel_complejidad" "text",
    "domicilio" "text",
    "lat" double precision,
    "lng" double precision,
    "numero_afiliado" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "prestadora_id" "uuid" NOT NULL,
    "ultimo_analisis_ia_at" timestamp with time zone,
    "obra_social" "text",
    "importacion_id" "uuid",
    "pendiente_conformidad" boolean DEFAULT false NOT NULL,
    CONSTRAINT "pacientes_nivel_complejidad_check" CHECK (("nivel_complejidad" = ANY (ARRAY['I'::"text", 'II'::"text", 'III'::"text"])))
);


ALTER TABLE "public"."pacientes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paquete_prestacion_items" (
    "paquete_id" bigint NOT NULL,
    "prestacion_id" bigint NOT NULL,
    "prestadora_id" "uuid" NOT NULL
);


ALTER TABLE "public"."paquete_prestacion_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paquetes_prestaciones" (
    "id" bigint NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "nombre" "text",
    "precio_paquete" numeric(12,2) NOT NULL,
    "nota" "text",
    "estado" "text" DEFAULT 'vigente'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "prestadora_id" "uuid" NOT NULL,
    CONSTRAINT "paquetes_prestaciones_estado_check" CHECK (("estado" = ANY (ARRAY['vigente'::"text", 'de_baja'::"text"])))
);


ALTER TABLE "public"."paquetes_prestaciones" OWNER TO "postgres";


ALTER TABLE "public"."paquetes_prestaciones" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."paquetes_prestaciones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."permisos_prestadora" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "accion" "text" NOT NULL,
    "alcance" "text" DEFAULT 'solo_admin'::"text" NOT NULL,
    "excepciones_permitir" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "excepciones_denegar" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "actualizado_por" "uuid",
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "permisos_prestadora_alcance_check" CHECK (("alcance" = ANY (ARRAY['solo_admin'::"text", 'admin_y_coordinador'::"text"])))
);


ALTER TABLE "public"."permisos_prestadora" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."personal_emergencia" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "personal_emergencia_tipo_check" CHECK (("tipo" = ANY (ARRAY['franquero'::"text", 'emergencia'::"text"])))
);


ALTER TABLE "public"."personal_emergencia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plan_modulos" (
    "plan_id" "uuid" NOT NULL,
    "modulo_key" "text" NOT NULL
);


ALTER TABLE "public"."plan_modulos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."planes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "precio" numeric(12,2) NOT NULL,
    "moneda" "text" DEFAULT 'ARS'::"text" NOT NULL,
    "vigente_desde" "date" DEFAULT CURRENT_DATE NOT NULL,
    "vigente_hasta" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."planes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plantillas_whatsapp" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "nombre_interno" "text" NOT NULL,
    "categoria" "text" NOT NULL,
    "idioma" "text" DEFAULT 'es-AR'::"text" NOT NULL,
    "cuerpo_texto" "text" NOT NULL,
    "estado" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "meta_template_id" "text",
    "motivo_rechazo" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "plantillas_whatsapp_estado_check" CHECK (("estado" = ANY (ARRAY['borrador'::"text", 'enviada_meta'::"text", 'aprobada'::"text", 'rechazada'::"text"])))
);


ALTER TABLE "public"."plantillas_whatsapp" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."postulaciones" (
    "id" bigint NOT NULL,
    "nombre" character varying(100) NOT NULL,
    "telefono" character varying(30) NOT NULL,
    "email" character varying(100) NOT NULL,
    "especialidades" "text" NOT NULL,
    "zonas" "text" NOT NULL,
    "disponibilidad" "text" NOT NULL,
    "anios_experiencia" character varying(20),
    "situacion_fiscal" character varying(50) NOT NULL,
    "como_conocio" character varying(100),
    "mensaje" "text",
    "estado" character varying(30) DEFAULT 'pendiente'::character varying,
    "canal" character varying(50) DEFAULT 'web'::character varying,
    "creado_en" timestamp with time zone DEFAULT "now"(),
    "nota_interna" "text",
    "asistente_id" "uuid",
    "dni" "text",
    "idioma" "text" DEFAULT 'es-AR'::"text" NOT NULL,
    "prestadora_id" "uuid" NOT NULL
);


ALTER TABLE "public"."postulaciones" OWNER TO "postgres";


ALTER TABLE "public"."postulaciones" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."postulaciones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."precios_ia_modelo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "proveedor" "text" NOT NULL,
    "modelo" "text" NOT NULL,
    "precio_entrada_usd_por_millon" numeric(10,4) NOT NULL,
    "precio_salida_usd_por_millon" numeric(10,4) NOT NULL,
    "vigente_desde" "date" NOT NULL,
    "verificado_at" timestamp with time zone,
    "fuente" "text" NOT NULL,
    "creado_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "precios_ia_modelo_proveedor_check" CHECK (("proveedor" = ANY (ARRAY['anthropic'::"text", 'google'::"text", 'openai'::"text"])))
);


ALTER TABLE "public"."precios_ia_modelo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prestaciones" (
    "id" bigint NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "tipo_servicio" "text" NOT NULL,
    "configuracion" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "precio_lista_id" bigint,
    "precio_lista_snapshot" numeric(12,2),
    "tipo_descuento" "text",
    "valor_descuento" numeric(12,2),
    "precio_final" numeric(12,2) NOT NULL,
    "nota" "text",
    "estado" "text" DEFAULT 'vigente'::"text" NOT NULL,
    "requiere_revision" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "prestadora_id" "uuid" NOT NULL,
    "servicio_id" "uuid",
    CONSTRAINT "prestaciones_estado_check" CHECK (("estado" = ANY (ARRAY['vigente'::"text", 'de_baja'::"text"]))),
    CONSTRAINT "prestaciones_tipo_descuento_check" CHECK (("tipo_descuento" = ANY (ARRAY['porcentaje'::"text", 'monto_fijo'::"text"])))
);


ALTER TABLE "public"."prestaciones" OWNER TO "postgres";


ALTER TABLE "public"."prestaciones" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."prestaciones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."prestadora_modalidades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "modalidad" "text" NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "activada_por" "uuid",
    "activada_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "desactivada_por" "uuid",
    "desactivada_en" timestamp with time zone,
    CONSTRAINT "prestadora_modalidades_modalidad_check" CHECK (("modalidad" = ANY (ARRAY['directa'::"text", 'marketplace'::"text", 'cooperativa'::"text"])))
);


ALTER TABLE "public"."prestadora_modalidades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prestadora_modulos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "modulo_key" "text" NOT NULL,
    "origen" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prestadora_modulos_origen_check" CHECK (("origen" = ANY (ARRAY['plan'::"text", 'addon'::"text"])))
);


ALTER TABLE "public"."prestadora_modulos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prestadora_pasarela_pago" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "proveedor" "text" NOT NULL,
    "estado_conexion" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "activada_por" "uuid",
    "conectada_en" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prestadora_pasarela_pago_estado_conexion_check" CHECK (("estado_conexion" = ANY (ARRAY['pendiente'::"text", 'conectada'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."prestadora_pasarela_pago" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prestadora_planes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "vigente_desde" "date" DEFAULT CURRENT_DATE NOT NULL,
    "vigente_hasta" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."prestadora_planes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prestadoras" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "razon_social" "text" NOT NULL,
    "nombre_fantasia" "text" NOT NULL,
    "identificacion_fiscal" "text",
    "pais" "text" DEFAULT 'AR'::"text" NOT NULL,
    "estado" "public"."estado_prestadora" DEFAULT 'prospecto'::"public"."estado_prestadora" NOT NULL,
    "zonas_operacion" "text"[],
    "plan_licencia" "text",
    "fecha_alta" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "dias_aviso_vencimiento_documentos" smallint DEFAULT 30 NOT NULL,
    "dias_generacion_series_guardia" smallint DEFAULT 90 NOT NULL,
    "politica_verificacion_alta_manual" "text" DEFAULT 'omitir'::"text" NOT NULL,
    CONSTRAINT "prestadoras_politica_verificacion_alta_manual_check" CHECK (("politica_verificacion_alta_manual" = ANY (ARRAY['omitir'::"text", 'pendiente'::"text", 'aprobado'::"text"])))
);


ALTER TABLE "public"."prestadoras" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "asistente_id" "uuid",
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "familia_id" "uuid",
    CONSTRAINT "push_subscriptions_una_audiencia" CHECK ((("asistente_id" IS NOT NULL) <> ("familia_id" IS NOT NULL)))
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."qr_cobro_efectivo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "suscripcion_id" "uuid" NOT NULL,
    "familia_id" "uuid" NOT NULL,
    "periodo" "date" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "token" "text" NOT NULL,
    "expira_en" timestamp with time zone NOT NULL,
    "usado_en" timestamp with time zone,
    "usado_por" "uuid",
    "cobro_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."qr_cobro_efectivo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rangos_referencia_vitales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "paciente_id" "uuid",
    "signo" "text" NOT NULL,
    "valor_min" numeric NOT NULL,
    "valor_max" numeric NOT NULL,
    "unidad" "text" NOT NULL,
    "fuente" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "rangos_referencia_vitales_signo_check" CHECK (("signo" = ANY (ARRAY['presion_sistolica'::"text", 'presion_diastolica'::"text", 'temperatura'::"text", 'saturacion'::"text", 'glucemia'::"text"])))
);


ALTER TABLE "public"."rangos_referencia_vitales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reportes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "guardia_id" "uuid" NOT NULL,
    "texto_libre" "text",
    "alimentacion" "jsonb",
    "medicacion" "jsonb",
    "signos_vitales" "jsonb",
    "estado_animo" "text",
    "incidentes" "text",
    "observaciones" "text",
    "foto_url" "text",
    "ia_procesado" boolean DEFAULT false NOT NULL,
    "confirmado_asistente" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reportes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."series_guardias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "dias_semana" "text"[] NOT NULL,
    "hora_inicio" time without time zone NOT NULL,
    "hora_fin" time without time zone NOT NULL,
    "modalidad" "text" NOT NULL,
    "vigente_desde" "date" NOT NULL,
    "vigente_hasta" "date",
    "estado" "text" DEFAULT 'activa'::"text" NOT NULL,
    "cancelacion_origen" "text",
    "cancelado_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "canal_modalidad" "text" DEFAULT 'directa'::"text" NOT NULL,
    CONSTRAINT "series_guardias_canal_modalidad_check" CHECK (("canal_modalidad" = ANY (ARRAY['directa'::"text", 'marketplace'::"text", 'cooperativa'::"text"]))),
    CONSTRAINT "series_guardias_cancelacion_check" CHECK ((("estado" = 'cancelada'::"text") OR (("cancelacion_origen" IS NULL) AND ("cancelado_at" IS NULL)))),
    CONSTRAINT "series_guardias_cancelacion_origen_check" CHECK (("cancelacion_origen" = ANY (ARRAY['familia'::"text", 'prestadora'::"text"]))),
    CONSTRAINT "series_guardias_estado_check" CHECK (("estado" = ANY (ARRAY['activa'::"text", 'cancelada'::"text", 'pausada'::"text"])))
);


ALTER TABLE "public"."series_guardias" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."servicios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "familia_id" "uuid" NOT NULL,
    "etiqueta" "text" NOT NULL,
    "estado" "text" DEFAULT 'vigente'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "servicios_estado_check" CHECK (("estado" = ANY (ARRAY['vigente'::"text", 'de_baja'::"text"])))
);


ALTER TABLE "public"."servicios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sesiones_tenant_admin_plataforma" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid" NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "entrada_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ultima_actividad_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expira_at" timestamp with time zone NOT NULL,
    "salida_at" timestamp with time zone
);


ALTER TABLE "public"."sesiones_tenant_admin_plataforma" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."solicitudes" (
    "id" bigint NOT NULL,
    "nombre" character varying(100) NOT NULL,
    "telefono" character varying(30) NOT NULL,
    "email" character varying(100) NOT NULL,
    "nombre_paciente" character varying(100),
    "localidad" character varying(100) NOT NULL,
    "tipo_servicio" character varying(100) NOT NULL,
    "modalidad" character varying(50) NOT NULL,
    "dias_horario" character varying(200) NOT NULL,
    "descripcion" "text",
    "canal" character varying(50) DEFAULT 'web'::character varying,
    "creado_en" timestamp with time zone DEFAULT "now"(),
    "estado" character varying(30) DEFAULT 'nueva'::character varying,
    "nota_interna" "text",
    "familia_id" "uuid",
    "prestadora_id" "uuid" NOT NULL
);


ALTER TABLE "public"."solicitudes" OWNER TO "postgres";


ALTER TABLE "public"."solicitudes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."solicitudes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."suscripciones_marketplace" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "familia_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "estado" "text" DEFAULT 'trial'::"text" NOT NULL,
    "monto_mensual" numeric(12,2) NOT NULL,
    "trial_inicio" "date" DEFAULT CURRENT_DATE NOT NULL,
    "trial_fin" "date" NOT NULL,
    "proximo_cobro" "date",
    "cancelada_en" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "suscripciones_marketplace_estado_check" CHECK (("estado" = ANY (ARRAY['trial'::"text", 'activa'::"text", 'vencida'::"text", 'cancelada'::"text"])))
);


ALTER TABLE "public"."suscripciones_marketplace" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tipos_documento_asistente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "requiere_vencimiento" boolean DEFAULT true NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tipos_documento_asistente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tokens_activacion_cuenta" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "expira_en" timestamp with time zone NOT NULL,
    "usado_en" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tokens_activacion_cuenta" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."uso_ia" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "modulo" "text" NOT NULL,
    "proveedor" "text" NOT NULL,
    "modelo" "text" NOT NULL,
    "tokens_entrada" integer NOT NULL,
    "tokens_salida" integer NOT NULL,
    "costo_usd" numeric(12,6) NOT NULL,
    "creado_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "uso_ia_modulo_check" CHECK (("modulo" = ANY (ARRAY['alertas'::"text", 'reporte'::"text", 'importacion'::"text", 'whatsapp'::"text"])))
);


ALTER TABLE "public"."uso_ia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios" (
    "id" "uuid" NOT NULL,
    "rol" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "telefono" "text",
    "zonas" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "prestadora_id" "uuid",
    CONSTRAINT "usuarios_prestadora_id_solo_admin_plataforma_null" CHECK ((("prestadora_id" IS NOT NULL) OR ("rol" = 'admin_plataforma'::"text"))),
    CONSTRAINT "usuarios_rol_check" CHECK (("rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text", 'asistente'::"text", 'familia'::"text", 'superadmin'::"text", 'admin_plataforma'::"text"])))
);


ALTER TABLE "public"."usuarios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."verificaciones_asistente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "etapa" "text" NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "notas" "text",
    "revisado_por" "uuid",
    "documento_url" "text",
    "referencia_externa" character varying(200),
    "completado_en" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "verificaciones_asistente_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'aprobada'::"text", 'rechazada'::"text"])))
);


ALTER TABLE "public"."verificaciones_asistente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."zonas_cobertura" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codigo" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "categoria" "text" NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "orden" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "prestadora_id" "uuid" NOT NULL
);


ALTER TABLE "public"."zonas_cobertura" OWNER TO "postgres";


ALTER TABLE ONLY "public"."advertencias_legales"
    ADD CONSTRAINT "advertencias_legales_jurisdiccion_funcion_clave_key" UNIQUE ("jurisdiccion", "funcion_clave");



ALTER TABLE ONLY "public"."advertencias_legales"
    ADD CONSTRAINT "advertencias_legales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alertas_contingencia_hospitalizacion"
    ADD CONSTRAINT "alertas_contingencia_hospitalizacion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alertas"
    ADD CONSTRAINT "alertas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alertas_tempranas_guardia"
    ADD CONSTRAINT "alertas_tempranas_guardia_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asistentes"
    ADD CONSTRAINT "asistentes_id_prestadora_unique" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."asistentes"
    ADD CONSTRAINT "asistentes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asistentes"
    ADD CONSTRAINT "asistentes_qr_token_key" UNIQUE ("qr_token");



ALTER TABLE ONLY "public"."auditoria_admin_plataforma"
    ADD CONSTRAINT "auditoria_admin_plataforma_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auditoria_advertencias_legales"
    ADD CONSTRAINT "auditoria_advertencias_legales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ausencias"
    ADD CONSTRAINT "ausencias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."autorizaciones_monitoreo_paciente"
    ADD CONSTRAINT "autorizaciones_monitoreo_paciente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calificaciones_asistente"
    ADD CONSTRAINT "calificaciones_asistente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cambios_precio_ia_pendientes"
    ADD CONSTRAINT "cambios_precio_ia_pendientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalogo_modulos"
    ADD CONSTRAINT "catalogo_modulos_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."certificados"
    ADD CONSTRAINT "certificados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ceses"
    ADD CONSTRAINT "ceses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cierre_servicio_asistentes"
    ADD CONSTRAINT "cierre_servicio_asistentes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cierres_servicio_paciente"
    ADD CONSTRAINT "cierres_servicio_paciente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cobros_marketplace"
    ADD CONSTRAINT "cobros_marketplace_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracion_alertas_ia"
    ADD CONSTRAINT "configuracion_alertas_ia_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."configuracion_ausencia_automatica"
    ADD CONSTRAINT "configuracion_ausencia_automatica_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."configuracion_aviso_cese_asistente"
    ADD CONSTRAINT "configuracion_aviso_cese_asistente_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."configuracion_email_prestadora"
    ADD CONSTRAINT "configuracion_email_prestadora_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."configuracion_escalada_coordinador"
    ADD CONSTRAINT "configuracion_escalada_coordinador_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."configuracion_escalada_relevo"
    ADD CONSTRAINT "configuracion_escalada_relevo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracion_escalada_relevo"
    ADD CONSTRAINT "configuracion_escalada_relevo_prestadora_id_nivel_key" UNIQUE ("prestadora_id", "nivel");



ALTER TABLE ONLY "public"."configuracion_habilitacion_via_medicacion"
    ADD CONSTRAINT "configuracion_habilitacion_vi_prestadora_id_via_administrac_key" UNIQUE ("prestadora_id", "via_administracion");



ALTER TABLE ONLY "public"."configuracion_habilitacion_via_medicacion"
    ADD CONSTRAINT "configuracion_habilitacion_via_medicacion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracion_notificaciones"
    ADD CONSTRAINT "configuracion_notificaciones_pkey" PRIMARY KEY ("evento", "prestadora_id");



ALTER TABLE ONLY "public"."configuracion_plataforma"
    ADD CONSTRAINT "configuracion_plataforma_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracion_prestadora"
    ADD CONSTRAINT "configuracion_prestadora_dominio_key" UNIQUE ("dominio");



ALTER TABLE ONLY "public"."configuracion_prestadora"
    ADD CONSTRAINT "configuracion_prestadora_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."configuracion_whatsapp_prestadora"
    ADD CONSTRAINT "configuracion_whatsapp_prestadora_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."conversaciones_whatsapp"
    ADD CONSTRAINT "conversaciones_whatsapp_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversaciones_whatsapp"
    ADD CONSTRAINT "conversaciones_whatsapp_prestadora_id_telefono_key" UNIQUE ("prestadora_id", "telefono");



ALTER TABLE ONLY "public"."credenciales_pasarela_pago"
    ADD CONSTRAINT "credenciales_pasarela_pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credenciales_pasarela_pago"
    ADD CONSTRAINT "credenciales_pasarela_pago_prestadora_id_proveedor_key" UNIQUE ("prestadora_id", "proveedor");



ALTER TABLE ONLY "public"."documentos_asistente"
    ADD CONSTRAINT "documentos_asistente_asistente_id_tipo_documento_id_key" UNIQUE ("asistente_id", "tipo_documento_id");



ALTER TABLE ONLY "public"."documentos_asistente"
    ADD CONSTRAINT "documentos_asistente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domicilios_temporales_paciente"
    ADD CONSTRAINT "domicilios_temporales_paciente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."escalas_legales"
    ADD CONSTRAINT "escalas_legales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."etapas_incorporacion_asistente"
    ADD CONSTRAINT "etapas_incorporacion_asistente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."etapas_incorporacion_asistente"
    ADD CONSTRAINT "etapas_incorporacion_asistente_prestadora_id_clave_key" UNIQUE ("prestadora_id", "clave");



ALTER TABLE ONLY "public"."etapas_incorporacion_asistente"
    ADD CONSTRAINT "etapas_incorporacion_asistente_prestadora_id_orden_key" UNIQUE ("prestadora_id", "orden") DEFERRABLE;



ALTER TABLE ONLY "public"."excepciones_familiar_relevo"
    ADD CONSTRAINT "excepciones_familiar_relevo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."facturas_familia"
    ADD CONSTRAINT "facturas_familia_familia_id_periodo_key" UNIQUE ("familia_id", "periodo");



ALTER TABLE ONLY "public"."facturas_familia_items"
    ADD CONSTRAINT "facturas_familia_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."facturas_familia"
    ADD CONSTRAINT "facturas_familia_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."facturas_licencia"
    ADD CONSTRAINT "facturas_licencia_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."familias"
    ADD CONSTRAINT "familias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."formulas_cese"
    ADD CONSTRAINT "formulas_cese_jurisdiccion_causal_vigencia_desde_key" UNIQUE ("jurisdiccion", "causal", "vigencia_desde");



ALTER TABLE ONLY "public"."formulas_cese"
    ADD CONSTRAINT "formulas_cese_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guardias_cobertura"
    ADD CONSTRAINT "guardias_cobertura_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guardias"
    ADD CONSTRAINT "guardias_id_prestadora_unique" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."guardias"
    ADD CONSTRAINT "guardias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guardias_tracking_gps"
    ADD CONSTRAINT "guardias_tracking_gps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."habilitaciones_asistente"
    ADD CONSTRAINT "habilitaciones_asistente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hospitalizaciones_paciente"
    ADD CONSTRAINT "hospitalizaciones_paciente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."importaciones_prestadora"
    ADD CONSTRAINT "importaciones_prestadora_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incidentes_relevo"
    ADD CONSTRAINT "incidentes_relevo_id_prestadora_unique" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."incidentes_relevo"
    ADD CONSTRAINT "incidentes_relevo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."indicaciones_medicacion"
    ADD CONSTRAINT "indicaciones_medicacion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."informes_obra_social"
    ADD CONSTRAINT "informes_obra_social_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lista_precios"
    ADD CONSTRAINT "lista_precios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mensajes_asistente"
    ADD CONSTRAINT "mensajes_asistente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mensajes_whatsapp"
    ADD CONSTRAINT "mensajes_whatsapp_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mfa_codigos_recuperacion"
    ADD CONSTRAINT "mfa_codigos_recuperacion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."miembros_familia"
    ADD CONSTRAINT "miembros_familia_pkey" PRIMARY KEY ("usuario_id");



ALTER TABLE ONLY "public"."motivos_aviso_previo_guardia"
    ADD CONSTRAINT "motivos_aviso_previo_guardia_id_prestadora_id_key" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."motivos_aviso_previo_guardia"
    ADD CONSTRAINT "motivos_aviso_previo_guardia_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."motivos_aviso_previo_guardia"
    ADD CONSTRAINT "motivos_aviso_previo_guardia_prestadora_id_nombre_key" UNIQUE ("prestadora_id", "nombre");



ALTER TABLE ONLY "public"."notificaciones_cierre_servicio"
    ADD CONSTRAINT "notificaciones_cierre_servicio_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pacientes"
    ADD CONSTRAINT "pacientes_id_prestadora_unique" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."pacientes"
    ADD CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."paquete_prestacion_items"
    ADD CONSTRAINT "paquete_prestacion_items_pkey" PRIMARY KEY ("paquete_id", "prestacion_id");



ALTER TABLE ONLY "public"."paquetes_prestaciones"
    ADD CONSTRAINT "paquetes_prestaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permisos_prestadora"
    ADD CONSTRAINT "permisos_prestadora_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permisos_prestadora"
    ADD CONSTRAINT "permisos_prestadora_prestadora_id_accion_key" UNIQUE ("prestadora_id", "accion");



ALTER TABLE ONLY "public"."personal_emergencia"
    ADD CONSTRAINT "personal_emergencia_id_prestadora_unique" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."personal_emergencia"
    ADD CONSTRAINT "personal_emergencia_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plan_modulos"
    ADD CONSTRAINT "plan_modulos_pkey" PRIMARY KEY ("plan_id", "modulo_key");



ALTER TABLE ONLY "public"."planes"
    ADD CONSTRAINT "planes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plantillas_whatsapp"
    ADD CONSTRAINT "plantillas_whatsapp_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plantillas_whatsapp"
    ADD CONSTRAINT "plantillas_whatsapp_prestadora_id_nombre_interno_key" UNIQUE ("prestadora_id", "nombre_interno");



ALTER TABLE ONLY "public"."postulaciones"
    ADD CONSTRAINT "postulaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."precios_ia_modelo"
    ADD CONSTRAINT "precios_ia_modelo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."precios_ia_modelo"
    ADD CONSTRAINT "precios_ia_modelo_proveedor_modelo_vigente_desde_key" UNIQUE ("proveedor", "modelo", "vigente_desde");



ALTER TABLE ONLY "public"."prestaciones"
    ADD CONSTRAINT "prestaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prestadora_modalidades"
    ADD CONSTRAINT "prestadora_modalidades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prestadora_modalidades"
    ADD CONSTRAINT "prestadora_modalidades_prestadora_id_modalidad_key" UNIQUE ("prestadora_id", "modalidad");



ALTER TABLE ONLY "public"."prestadora_modulos"
    ADD CONSTRAINT "prestadora_modulos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prestadora_modulos"
    ADD CONSTRAINT "prestadora_modulos_prestadora_id_modulo_key_key" UNIQUE ("prestadora_id", "modulo_key");



ALTER TABLE ONLY "public"."prestadora_pasarela_pago"
    ADD CONSTRAINT "prestadora_pasarela_pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prestadora_pasarela_pago"
    ADD CONSTRAINT "prestadora_pasarela_pago_prestadora_id_proveedor_key" UNIQUE ("prestadora_id", "proveedor");



ALTER TABLE ONLY "public"."prestadora_planes"
    ADD CONSTRAINT "prestadora_planes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prestadoras"
    ADD CONSTRAINT "prestadoras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."qr_cobro_efectivo"
    ADD CONSTRAINT "qr_cobro_efectivo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."qr_cobro_efectivo"
    ADD CONSTRAINT "qr_cobro_efectivo_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."rangos_referencia_vitales"
    ADD CONSTRAINT "rangos_referencia_vitales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rangos_referencia_vitales"
    ADD CONSTRAINT "rangos_referencia_vitales_prestadora_id_paciente_id_signo_key" UNIQUE ("prestadora_id", "paciente_id", "signo");



ALTER TABLE ONLY "public"."reportes"
    ADD CONSTRAINT "reportes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."series_guardias"
    ADD CONSTRAINT "series_guardias_id_prestadora_unique" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."series_guardias"
    ADD CONSTRAINT "series_guardias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_id_prestadora_unique" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sesiones_tenant_admin_plataforma"
    ADD CONSTRAINT "sesiones_tenant_admin_plataforma_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."solicitudes"
    ADD CONSTRAINT "solicitudes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suscripciones_marketplace"
    ADD CONSTRAINT "suscripciones_marketplace_familia_id_paciente_id_asistente__key" UNIQUE ("familia_id", "paciente_id", "asistente_id");



ALTER TABLE ONLY "public"."suscripciones_marketplace"
    ADD CONSTRAINT "suscripciones_marketplace_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tipos_documento_asistente"
    ADD CONSTRAINT "tipos_documento_asistente_id_prestadora_id_key" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."tipos_documento_asistente"
    ADD CONSTRAINT "tipos_documento_asistente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tipos_documento_asistente"
    ADD CONSTRAINT "tipos_documento_asistente_prestadora_id_nombre_key" UNIQUE ("prestadora_id", "nombre");



ALTER TABLE ONLY "public"."tokens_activacion_cuenta"
    ADD CONSTRAINT "tokens_activacion_cuenta_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tokens_activacion_cuenta"
    ADD CONSTRAINT "tokens_activacion_cuenta_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."uso_ia"
    ADD CONSTRAINT "uso_ia_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verificaciones_asistente"
    ADD CONSTRAINT "verificaciones_asistente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."zonas_cobertura"
    ADD CONSTRAINT "zonas_cobertura_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."zonas_cobertura"
    ADD CONSTRAINT "zonas_cobertura_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_alertas_contingencia_hosp_hospitalizacion" ON "public"."alertas_contingencia_hospitalizacion" USING "btree" ("hospitalizacion_id");



CREATE INDEX "idx_alertas_paciente" ON "public"."alertas" USING "btree" ("paciente_id");



CREATE INDEX "idx_alertas_tempranas_guardia_guardia" ON "public"."alertas_tempranas_guardia" USING "btree" ("guardia_id");



CREATE INDEX "idx_auditoria_admin_plataforma_admin" ON "public"."auditoria_admin_plataforma" USING "btree" ("admin_id", "created_at" DESC);



CREATE INDEX "idx_auditoria_admin_plataforma_prestadora" ON "public"."auditoria_admin_plataforma" USING "btree" ("prestadora_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_autorizacion_monitoreo_vigente_unica" ON "public"."autorizaciones_monitoreo_paciente" USING "btree" ("paciente_id") WHERE "vigente";



CREATE INDEX "idx_cambios_precio_ia_pendientes_estado" ON "public"."cambios_precio_ia_pendientes" USING "btree" ("estado", "detectado_at" DESC);



CREATE INDEX "idx_cierre_servicio_asistentes_cierre" ON "public"."cierre_servicio_asistentes" USING "btree" ("cierre_id");



CREATE INDEX "idx_cierre_servicio_asistentes_pendientes" ON "public"."cierre_servicio_asistentes" USING "btree" ("prestadora_id") WHERE (("avisado_verbalmente_at" IS NULL) AND ("aviso_automatico_enviado_at" IS NULL));



CREATE INDEX "idx_cierres_servicio_paciente_paciente" ON "public"."cierres_servicio_paciente" USING "btree" ("paciente_id");



CREATE INDEX "idx_cobros_marketplace_prestadora" ON "public"."cobros_marketplace" USING "btree" ("prestadora_id", "periodo" DESC);



CREATE INDEX "idx_cobros_marketplace_suscripcion" ON "public"."cobros_marketplace" USING "btree" ("suscripcion_id", "periodo" DESC);



CREATE INDEX "idx_domicilios_temp_paciente" ON "public"."domicilios_temporales_paciente" USING "btree" ("paciente_id");



CREATE INDEX "idx_escalas_jurisdiccion_tipo_vigencia" ON "public"."escalas_legales" USING "btree" ("jurisdiccion", "tipo", "categoria", "vigencia_desde");



CREATE INDEX "idx_excepciones_familiar_relevo_incidente" ON "public"."excepciones_familiar_relevo" USING "btree" ("incidente_id");



CREATE INDEX "idx_facturas_familia_prestadora" ON "public"."facturas_familia" USING "btree" ("prestadora_id", "periodo" DESC);



CREATE INDEX "idx_facturas_licencia_prestadora" ON "public"."facturas_licencia" USING "btree" ("prestadora_id", "fecha_emision" DESC);



CREATE INDEX "idx_formulas_cese_jurisdiccion_causal" ON "public"."formulas_cese" USING "btree" ("jurisdiccion", "causal", "vigencia_desde");



CREATE INDEX "idx_guardias_asistente" ON "public"."guardias" USING "btree" ("asistente_id");



CREATE INDEX "idx_guardias_canal_modalidad" ON "public"."guardias" USING "btree" ("prestadora_id", "canal_modalidad");



CREATE INDEX "idx_guardias_fecha" ON "public"."guardias" USING "btree" ("fecha");



CREATE INDEX "idx_guardias_paciente" ON "public"."guardias" USING "btree" ("paciente_id");



CREATE INDEX "idx_guardias_serie" ON "public"."guardias" USING "btree" ("serie_id");



CREATE INDEX "idx_guardias_tracking_gps_guardia" ON "public"."guardias_tracking_gps" USING "btree" ("guardia_id");



CREATE INDEX "idx_habilitaciones_asistente_asistente" ON "public"."habilitaciones_asistente" USING "btree" ("asistente_id");



CREATE INDEX "idx_hospitalizaciones_paciente" ON "public"."hospitalizaciones_paciente" USING "btree" ("paciente_id");



CREATE UNIQUE INDEX "idx_hospitalizaciones_paciente_activa_unica" ON "public"."hospitalizaciones_paciente" USING "btree" ("paciente_id") WHERE ("fecha_fin" IS NULL);



CREATE INDEX "idx_incidentes_relevo_entrante" ON "public"."incidentes_relevo" USING "btree" ("guardia_entrante_id");



CREATE INDEX "idx_incidentes_relevo_saliente" ON "public"."incidentes_relevo" USING "btree" ("guardia_saliente_id");



CREATE INDEX "idx_indicaciones_medicacion_estado" ON "public"."indicaciones_medicacion" USING "btree" ("estado");



CREATE INDEX "idx_indicaciones_medicacion_paciente" ON "public"."indicaciones_medicacion" USING "btree" ("paciente_id");



CREATE INDEX "idx_indicaciones_medicacion_prestadora" ON "public"."indicaciones_medicacion" USING "btree" ("prestadora_id");



CREATE INDEX "idx_informes_obra_social_paciente" ON "public"."informes_obra_social" USING "btree" ("paciente_id", "periodo_desde" DESC);



CREATE INDEX "idx_informes_obra_social_prestadora" ON "public"."informes_obra_social" USING "btree" ("prestadora_id", "periodo_desde" DESC);



CREATE INDEX "idx_mensajes_asistente_hilo" ON "public"."mensajes_asistente" USING "btree" ("asistente_id", "created_at");



CREATE INDEX "idx_mensajes_whatsapp_conversacion" ON "public"."mensajes_whatsapp" USING "btree" ("conversacion_id");



CREATE INDEX "idx_miembros_familia_familia" ON "public"."miembros_familia" USING "btree" ("familia_id");



CREATE INDEX "idx_notificaciones_cierre_servicio_asistente" ON "public"."notificaciones_cierre_servicio" USING "btree" ("asistente_id");



CREATE INDEX "idx_notificaciones_cierre_servicio_cierre" ON "public"."notificaciones_cierre_servicio" USING "btree" ("cierre_id");



CREATE INDEX "idx_precios_ia_modelo_lookup" ON "public"."precios_ia_modelo" USING "btree" ("proveedor", "modelo", "vigente_desde" DESC);



CREATE INDEX "idx_prestadora_modalidades_prestadora" ON "public"."prestadora_modalidades" USING "btree" ("prestadora_id");



CREATE INDEX "idx_prestadora_pasarela_pago_prestadora" ON "public"."prestadora_pasarela_pago" USING "btree" ("prestadora_id");



CREATE INDEX "idx_prestadora_planes_prestadora" ON "public"."prestadora_planes" USING "btree" ("prestadora_id", "vigente_desde" DESC);



CREATE UNIQUE INDEX "idx_prestadora_planes_vigente_unica" ON "public"."prestadora_planes" USING "btree" ("prestadora_id") WHERE ("vigente_hasta" IS NULL);



CREATE INDEX "idx_push_subscriptions_asistente" ON "public"."push_subscriptions" USING "btree" ("asistente_id");



CREATE INDEX "idx_push_subscriptions_familia" ON "public"."push_subscriptions" USING "btree" ("familia_id");



CREATE INDEX "idx_qr_cobro_efectivo_token" ON "public"."qr_cobro_efectivo" USING "btree" ("token");



CREATE INDEX "idx_rangos_referencia_vitales_paciente" ON "public"."rangos_referencia_vitales" USING "btree" ("paciente_id");



CREATE INDEX "idx_rangos_referencia_vitales_prestadora" ON "public"."rangos_referencia_vitales" USING "btree" ("prestadora_id");



CREATE INDEX "idx_reportes_guardia" ON "public"."reportes" USING "btree" ("guardia_id");



CREATE INDEX "idx_series_guardias_asistente" ON "public"."series_guardias" USING "btree" ("asistente_id");



CREATE INDEX "idx_series_guardias_paciente" ON "public"."series_guardias" USING "btree" ("paciente_id");



CREATE INDEX "idx_servicios_familia" ON "public"."servicios" USING "btree" ("familia_id");



CREATE INDEX "idx_sesion_tenant_admin_plataforma_admin" ON "public"."sesiones_tenant_admin_plataforma" USING "btree" ("admin_id");



CREATE UNIQUE INDEX "idx_sesion_tenant_admin_plataforma_vigente_unica" ON "public"."sesiones_tenant_admin_plataforma" USING "btree" ("admin_id") WHERE ("salida_at" IS NULL);



CREATE INDEX "idx_suscripciones_marketplace_familia" ON "public"."suscripciones_marketplace" USING "btree" ("familia_id");



CREATE INDEX "idx_suscripciones_marketplace_prestadora" ON "public"."suscripciones_marketplace" USING "btree" ("prestadora_id");



CREATE INDEX "idx_tokens_activacion_usuario" ON "public"."tokens_activacion_cuenta" USING "btree" ("usuario_id");



CREATE INDEX "idx_uso_ia_prestadora_fecha" ON "public"."uso_ia" USING "btree" ("prestadora_id", "creado_at" DESC);



CREATE INDEX "idx_verif_asistente" ON "public"."verificaciones_asistente" USING "btree" ("asistente_id");



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."alertas_tempranas_guardia" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."asistentes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."ausencias" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."calificaciones_asistente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."certificados" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."ceses" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."cierres_servicio_paciente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_ausencia_automatica" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_escalada_coordinador" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_escalada_relevo" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_notificaciones" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_prestadora" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_whatsapp_prestadora" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."conversaciones_whatsapp" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."documentos_asistente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."domicilios_temporales_paciente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."excepciones_familiar_relevo" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."familias" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."guardias" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."guardias_cobertura" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."guardias_tracking_gps" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."incidentes_relevo" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."lista_precios" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."mensajes_whatsapp" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."notificaciones_cierre_servicio" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."pacientes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."paquete_prestacion_items" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."paquetes_prestaciones" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."personal_emergencia" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."plantillas_whatsapp" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."postulaciones" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."prestaciones" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."prestadoras" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."series_guardias" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."solicitudes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."tipos_documento_asistente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_admin_plataforma" AFTER INSERT OR DELETE OR UPDATE ON "public"."zonas_cobertura" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"();



CREATE OR REPLACE TRIGGER "trigger_bloquear_edicion_laboral_coordinador" BEFORE UPDATE ON "public"."asistentes" FOR EACH ROW EXECUTE FUNCTION "public"."bloquear_edicion_laboral_coordinador"();



CREATE OR REPLACE TRIGGER "trigger_precio_lista_actualizado" AFTER UPDATE ON "public"."lista_precios" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_prestaciones_a_revisar"();



CREATE OR REPLACE TRIGGER "validar_servicio_guardias" BEFORE INSERT OR UPDATE OF "servicio_id", "paciente_id" ON "public"."guardias" FOR EACH ROW EXECUTE FUNCTION "public"."validar_servicio_misma_familia"();



CREATE OR REPLACE TRIGGER "validar_servicio_prestaciones" BEFORE INSERT OR UPDATE OF "servicio_id", "paciente_id" ON "public"."prestaciones" FOR EACH ROW EXECUTE FUNCTION "public"."validar_servicio_misma_familia"();



ALTER TABLE ONLY "public"."alertas_contingencia_hospitalizacion"
    ADD CONSTRAINT "alertas_contingencia_hosp_conviviente_tenant_fk" FOREIGN KEY ("paciente_conviviente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."alertas_contingencia_hospitalizacion"
    ADD CONSTRAINT "alertas_contingencia_hosp_hospitalizado_tenant_fk" FOREIGN KEY ("paciente_hospitalizado_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."alertas_contingencia_hospitalizacion"
    ADD CONSTRAINT "alertas_contingencia_hospitalizacion_hospitalizacion_id_fkey" FOREIGN KEY ("hospitalizacion_id") REFERENCES "public"."hospitalizaciones_paciente"("id");



ALTER TABLE ONLY "public"."alertas_contingencia_hospitalizacion"
    ADD CONSTRAINT "alertas_contingencia_hospitalizacion_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."alertas"
    ADD CONSTRAINT "alertas_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."alertas"
    ADD CONSTRAINT "alertas_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."alertas"
    ADD CONSTRAINT "alertas_resuelta_por_fkey" FOREIGN KEY ("resuelta_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."alertas_tempranas_guardia"
    ADD CONSTRAINT "alertas_tempranas_guardia_guardia_tenant_fk" FOREIGN KEY ("guardia_id", "prestadora_id") REFERENCES "public"."guardias"("id", "prestadora_id");



ALTER TABLE ONLY "public"."alertas_tempranas_guardia"
    ADD CONSTRAINT "alertas_tempranas_guardia_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."alertas_tempranas_guardia"
    ADD CONSTRAINT "alertas_tempranas_guardia_reportado_por_fkey" FOREIGN KEY ("reportado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."asistentes"
    ADD CONSTRAINT "asistentes_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."asistentes"
    ADD CONSTRAINT "asistentes_importacion_id_fkey" FOREIGN KEY ("importacion_id") REFERENCES "public"."importaciones_prestadora"("id");



ALTER TABLE ONLY "public"."asistentes"
    ADD CONSTRAINT "asistentes_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."auditoria_admin_plataforma"
    ADD CONSTRAINT "auditoria_admin_plataforma_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."auditoria_admin_plataforma"
    ADD CONSTRAINT "auditoria_admin_plataforma_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."auditoria_advertencias_legales"
    ADD CONSTRAINT "auditoria_advertencias_legales_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."auditoria_advertencias_legales"
    ADD CONSTRAINT "auditoria_advertencias_legales_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."ausencias"
    ADD CONSTRAINT "ausencias_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id");



ALTER TABLE ONLY "public"."ausencias"
    ADD CONSTRAINT "ausencias_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."autorizaciones_monitoreo_paciente"
    ADD CONSTRAINT "autorizaciones_monitoreo_paciente_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."autorizaciones_monitoreo_paciente"
    ADD CONSTRAINT "autorizaciones_monitoreo_paciente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."autorizaciones_monitoreo_paciente"
    ADD CONSTRAINT "autorizaciones_monitoreo_paciente_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."calificaciones_asistente"
    ADD CONSTRAINT "calificaciones_asistente_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id");



ALTER TABLE ONLY "public"."calificaciones_asistente"
    ADD CONSTRAINT "calificaciones_asistente_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."calificaciones_asistente"
    ADD CONSTRAINT "calificaciones_asistente_guardia_id_fkey" FOREIGN KEY ("guardia_id") REFERENCES "public"."guardias"("id");



ALTER TABLE ONLY "public"."calificaciones_asistente"
    ADD CONSTRAINT "calificaciones_asistente_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id");



ALTER TABLE ONLY "public"."calificaciones_asistente"
    ADD CONSTRAINT "calificaciones_asistente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."cambios_precio_ia_pendientes"
    ADD CONSTRAINT "cambios_precio_ia_pendientes_resuelto_por_fkey" FOREIGN KEY ("resuelto_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."certificados"
    ADD CONSTRAINT "certificados_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id");



ALTER TABLE ONLY "public"."certificados"
    ADD CONSTRAINT "certificados_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."ceses"
    ADD CONSTRAINT "ceses_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id");



ALTER TABLE ONLY "public"."ceses"
    ADD CONSTRAINT "ceses_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."ceses"
    ADD CONSTRAINT "ceses_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."cierre_servicio_asistentes"
    ADD CONSTRAINT "cierre_servicio_asistentes_avisado_verbalmente_por_fkey" FOREIGN KEY ("avisado_verbalmente_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."cierre_servicio_asistentes"
    ADD CONSTRAINT "cierre_servicio_asistentes_cierre_id_fkey" FOREIGN KEY ("cierre_id") REFERENCES "public"."cierres_servicio_paciente"("id");



ALTER TABLE ONLY "public"."cierre_servicio_asistentes"
    ADD CONSTRAINT "cierre_servicio_asistentes_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."cierre_servicio_asistentes"
    ADD CONSTRAINT "cierre_servicio_asistentes_tenant_fk" FOREIGN KEY ("asistente_id", "prestadora_id") REFERENCES "public"."asistentes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."cierres_servicio_paciente"
    ADD CONSTRAINT "cierres_servicio_paciente_cerrado_por_fkey" FOREIGN KEY ("cerrado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."cierres_servicio_paciente"
    ADD CONSTRAINT "cierres_servicio_paciente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."cierres_servicio_paciente"
    ADD CONSTRAINT "cierres_servicio_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."cobros_marketplace"
    ADD CONSTRAINT "cobros_marketplace_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."cobros_marketplace"
    ADD CONSTRAINT "cobros_marketplace_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."cobros_marketplace"
    ADD CONSTRAINT "cobros_marketplace_suscripcion_id_fkey" FOREIGN KEY ("suscripcion_id") REFERENCES "public"."suscripciones_marketplace"("id");



ALTER TABLE ONLY "public"."configuracion_alertas_ia"
    ADD CONSTRAINT "configuracion_alertas_ia_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_ausencia_automatica"
    ADD CONSTRAINT "configuracion_ausencia_automatica_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_aviso_cese_asistente"
    ADD CONSTRAINT "configuracion_aviso_cese_asistente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_email_prestadora"
    ADD CONSTRAINT "configuracion_email_prestadora_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_escalada_coordinador"
    ADD CONSTRAINT "configuracion_escalada_coordinador_coordinador_backup_id_fkey" FOREIGN KEY ("coordinador_backup_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."configuracion_escalada_coordinador"
    ADD CONSTRAINT "configuracion_escalada_coordinador_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_escalada_relevo"
    ADD CONSTRAINT "configuracion_escalada_relevo_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_habilitacion_via_medicacion"
    ADD CONSTRAINT "configuracion_habilitacion_via_medicacion_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_notificaciones"
    ADD CONSTRAINT "configuracion_notificaciones_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_plataforma"
    ADD CONSTRAINT "configuracion_plataforma_actualizado_por_fkey" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."configuracion_prestadora"
    ADD CONSTRAINT "configuracion_prestadora_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_whatsapp_prestadora"
    ADD CONSTRAINT "configuracion_whatsapp_prestadora_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."conversaciones_whatsapp"
    ADD CONSTRAINT "conversaciones_whatsapp_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id");



ALTER TABLE ONLY "public"."conversaciones_whatsapp"
    ADD CONSTRAINT "conversaciones_whatsapp_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."credenciales_pasarela_pago"
    ADD CONSTRAINT "credenciales_pasarela_pago_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."documentos_asistente"
    ADD CONSTRAINT "documentos_asistente_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documentos_asistente"
    ADD CONSTRAINT "documentos_asistente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."documentos_asistente"
    ADD CONSTRAINT "documentos_asistente_tipo_documento_id_prestadora_id_fkey" FOREIGN KEY ("tipo_documento_id", "prestadora_id") REFERENCES "public"."tipos_documento_asistente"("id", "prestadora_id");



ALTER TABLE ONLY "public"."domicilios_temporales_paciente"
    ADD CONSTRAINT "domicilios_temp_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."domicilios_temporales_paciente"
    ADD CONSTRAINT "domicilios_temporales_paciente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."escalas_legales"
    ADD CONSTRAINT "escalas_legales_cargado_por_fkey" FOREIGN KEY ("cargado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."etapas_incorporacion_asistente"
    ADD CONSTRAINT "etapas_incorporacion_asistente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."excepciones_familiar_relevo"
    ADD CONSTRAINT "excepciones_familiar_relevo_autorizado_por_fkey" FOREIGN KEY ("autorizado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."excepciones_familiar_relevo"
    ADD CONSTRAINT "excepciones_familiar_relevo_incidente_tenant_fk" FOREIGN KEY ("incidente_id", "prestadora_id") REFERENCES "public"."incidentes_relevo"("id", "prestadora_id");



ALTER TABLE ONLY "public"."excepciones_familiar_relevo"
    ADD CONSTRAINT "excepciones_familiar_relevo_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."facturas_familia"
    ADD CONSTRAINT "facturas_familia_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."familias"("id");



ALTER TABLE ONLY "public"."facturas_familia_items"
    ADD CONSTRAINT "facturas_familia_items_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "public"."facturas_familia"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."facturas_familia_items"
    ADD CONSTRAINT "facturas_familia_items_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id");



ALTER TABLE ONLY "public"."facturas_familia_items"
    ADD CONSTRAINT "facturas_familia_items_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "public"."servicios"("id");



ALTER TABLE ONLY "public"."facturas_familia"
    ADD CONSTRAINT "facturas_familia_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."facturas_licencia"
    ADD CONSTRAINT "facturas_licencia_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."familias"
    ADD CONSTRAINT "familias_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."familias"
    ADD CONSTRAINT "familias_importacion_id_fkey" FOREIGN KEY ("importacion_id") REFERENCES "public"."importaciones_prestadora"("id");



ALTER TABLE ONLY "public"."familias"
    ADD CONSTRAINT "familias_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."familias"
    ADD CONSTRAINT "familias_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "public"."solicitudes"("id");



ALTER TABLE ONLY "public"."formulas_cese"
    ADD CONSTRAINT "formulas_cese_cargado_por_fkey" FOREIGN KEY ("cargado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."guardias"
    ADD CONSTRAINT "guardias_asistente_tenant_fk" FOREIGN KEY ("asistente_id", "prestadora_id") REFERENCES "public"."asistentes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."guardias"
    ADD CONSTRAINT "guardias_checkout_excepcion_autorizado_por_fkey" FOREIGN KEY ("checkout_excepcion_autorizado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."guardias_cobertura"
    ADD CONSTRAINT "guardias_cobertura_asistente_sustituto_id_fkey" FOREIGN KEY ("asistente_sustituto_id") REFERENCES "public"."asistentes"("id");



ALTER TABLE ONLY "public"."guardias_cobertura"
    ADD CONSTRAINT "guardias_cobertura_ausencia_id_fkey" FOREIGN KEY ("ausencia_id") REFERENCES "public"."ausencias"("id");



ALTER TABLE ONLY "public"."guardias_cobertura"
    ADD CONSTRAINT "guardias_cobertura_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."guardias"
    ADD CONSTRAINT "guardias_coordinador_id_fkey" FOREIGN KEY ("coordinador_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."guardias"
    ADD CONSTRAINT "guardias_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."guardias"
    ADD CONSTRAINT "guardias_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."guardias"
    ADD CONSTRAINT "guardias_serie_tenant_fk" FOREIGN KEY ("serie_id", "prestadora_id") REFERENCES "public"."series_guardias"("id", "prestadora_id");



ALTER TABLE ONLY "public"."guardias"
    ADD CONSTRAINT "guardias_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "public"."servicios"("id");



ALTER TABLE ONLY "public"."guardias_tracking_gps"
    ADD CONSTRAINT "guardias_tracking_gps_guardia_tenant_fk" FOREIGN KEY ("guardia_id", "prestadora_id") REFERENCES "public"."guardias"("id", "prestadora_id");



ALTER TABLE ONLY "public"."guardias_tracking_gps"
    ADD CONSTRAINT "guardias_tracking_gps_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."habilitaciones_asistente"
    ADD CONSTRAINT "habilitaciones_asistente_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."habilitaciones_asistente"
    ADD CONSTRAINT "habilitaciones_asistente_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."hospitalizaciones_paciente"
    ADD CONSTRAINT "hospitalizaciones_paciente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."hospitalizaciones_paciente"
    ADD CONSTRAINT "hospitalizaciones_paciente_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."hospitalizaciones_paciente"
    ADD CONSTRAINT "hospitalizaciones_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."importaciones_prestadora"
    ADD CONSTRAINT "importaciones_prestadora_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."importaciones_prestadora"
    ADD CONSTRAINT "importaciones_prestadora_revisada_por_fkey" FOREIGN KEY ("revisada_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."importaciones_prestadora"
    ADD CONSTRAINT "importaciones_prestadora_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."incidentes_relevo"
    ADD CONSTRAINT "incidentes_relevo_entrante_tenant_fk" FOREIGN KEY ("guardia_entrante_id", "prestadora_id") REFERENCES "public"."guardias"("id", "prestadora_id");



ALTER TABLE ONLY "public"."incidentes_relevo"
    ADD CONSTRAINT "incidentes_relevo_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."incidentes_relevo"
    ADD CONSTRAINT "incidentes_relevo_resuelto_tenant_fk" FOREIGN KEY ("resuelto_por_id", "prestadora_id") REFERENCES "public"."asistentes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."incidentes_relevo"
    ADD CONSTRAINT "incidentes_relevo_saliente_tenant_fk" FOREIGN KEY ("guardia_saliente_id", "prestadora_id") REFERENCES "public"."guardias"("id", "prestadora_id");



ALTER TABLE ONLY "public"."indicaciones_medicacion"
    ADD CONSTRAINT "indicaciones_medicacion_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."familias"("id");



ALTER TABLE ONLY "public"."indicaciones_medicacion"
    ADD CONSTRAINT "indicaciones_medicacion_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."indicaciones_medicacion"
    ADD CONSTRAINT "indicaciones_medicacion_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."indicaciones_medicacion"
    ADD CONSTRAINT "indicaciones_medicacion_revisado_por_fkey" FOREIGN KEY ("revisado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."indicaciones_medicacion"
    ADD CONSTRAINT "indicaciones_medicacion_solicitado_por_fkey" FOREIGN KEY ("solicitado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."informes_obra_social"
    ADD CONSTRAINT "informes_obra_social_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."informes_obra_social"
    ADD CONSTRAINT "informes_obra_social_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."familias"("id");



ALTER TABLE ONLY "public"."informes_obra_social"
    ADD CONSTRAINT "informes_obra_social_generado_por_fkey" FOREIGN KEY ("generado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."informes_obra_social"
    ADD CONSTRAINT "informes_obra_social_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."informes_obra_social"
    ADD CONSTRAINT "informes_obra_social_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."informes_obra_social"
    ADD CONSTRAINT "informes_obra_social_validado_por_fkey" FOREIGN KEY ("validado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."lista_precios"
    ADD CONSTRAINT "lista_precios_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."mensajes_asistente"
    ADD CONSTRAINT "mensajes_asistente_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mensajes_asistente"
    ADD CONSTRAINT "mensajes_asistente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."mensajes_asistente"
    ADD CONSTRAINT "mensajes_asistente_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."mensajes_whatsapp"
    ADD CONSTRAINT "mensajes_whatsapp_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "public"."conversaciones_whatsapp"("id");



ALTER TABLE ONLY "public"."mensajes_whatsapp"
    ADD CONSTRAINT "mensajes_whatsapp_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."mfa_codigos_recuperacion"
    ADD CONSTRAINT "mfa_codigos_recuperacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."miembros_familia"
    ADD CONSTRAINT "miembros_familia_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."miembros_familia"
    ADD CONSTRAINT "miembros_familia_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."familias"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."miembros_familia"
    ADD CONSTRAINT "miembros_familia_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."motivos_aviso_previo_guardia"
    ADD CONSTRAINT "motivos_aviso_previo_guardia_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."notificaciones_cierre_servicio"
    ADD CONSTRAINT "notificaciones_cierre_servicio_asistente_tenant_fk" FOREIGN KEY ("asistente_id", "prestadora_id") REFERENCES "public"."asistentes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."notificaciones_cierre_servicio"
    ADD CONSTRAINT "notificaciones_cierre_servicio_cerrado_por_fkey" FOREIGN KEY ("cerrado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."notificaciones_cierre_servicio"
    ADD CONSTRAINT "notificaciones_cierre_servicio_cierre_id_fkey" FOREIGN KEY ("cierre_id") REFERENCES "public"."cierres_servicio_paciente"("id");



ALTER TABLE ONLY "public"."notificaciones_cierre_servicio"
    ADD CONSTRAINT "notificaciones_cierre_servicio_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."notificaciones_cierre_servicio"
    ADD CONSTRAINT "notificaciones_cierre_servicio_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."notificaciones_cierre_servicio"
    ADD CONSTRAINT "notificaciones_cierre_servicio_visto_por_fkey" FOREIGN KEY ("visto_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."pacientes"
    ADD CONSTRAINT "pacientes_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."familias"("id");



ALTER TABLE ONLY "public"."pacientes"
    ADD CONSTRAINT "pacientes_importacion_id_fkey" FOREIGN KEY ("importacion_id") REFERENCES "public"."importaciones_prestadora"("id");



ALTER TABLE ONLY "public"."pacientes"
    ADD CONSTRAINT "pacientes_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."paquete_prestacion_items"
    ADD CONSTRAINT "paquete_prestacion_items_paquete_id_fkey" FOREIGN KEY ("paquete_id") REFERENCES "public"."paquetes_prestaciones"("id");



ALTER TABLE ONLY "public"."paquete_prestacion_items"
    ADD CONSTRAINT "paquete_prestacion_items_prestacion_id_fkey" FOREIGN KEY ("prestacion_id") REFERENCES "public"."prestaciones"("id");



ALTER TABLE ONLY "public"."paquete_prestacion_items"
    ADD CONSTRAINT "paquete_prestacion_items_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."paquetes_prestaciones"
    ADD CONSTRAINT "paquetes_prestaciones_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id");



ALTER TABLE ONLY "public"."paquetes_prestaciones"
    ADD CONSTRAINT "paquetes_prestaciones_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."permisos_prestadora"
    ADD CONSTRAINT "permisos_prestadora_actualizado_por_fkey" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."permisos_prestadora"
    ADD CONSTRAINT "permisos_prestadora_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."personal_emergencia"
    ADD CONSTRAINT "personal_emergencia_asistente_tenant_fk" FOREIGN KEY ("asistente_id", "prestadora_id") REFERENCES "public"."asistentes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."personal_emergencia"
    ADD CONSTRAINT "personal_emergencia_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."plan_modulos"
    ADD CONSTRAINT "plan_modulos_modulo_key_fkey" FOREIGN KEY ("modulo_key") REFERENCES "public"."catalogo_modulos"("key");



ALTER TABLE ONLY "public"."plan_modulos"
    ADD CONSTRAINT "plan_modulos_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."planes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plantillas_whatsapp"
    ADD CONSTRAINT "plantillas_whatsapp_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."plantillas_whatsapp"
    ADD CONSTRAINT "plantillas_whatsapp_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."postulaciones"
    ADD CONSTRAINT "postulaciones_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id");



ALTER TABLE ONLY "public"."postulaciones"
    ADD CONSTRAINT "postulaciones_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."prestaciones"
    ADD CONSTRAINT "prestaciones_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id");



ALTER TABLE ONLY "public"."prestaciones"
    ADD CONSTRAINT "prestaciones_precio_lista_id_fkey" FOREIGN KEY ("precio_lista_id") REFERENCES "public"."lista_precios"("id");



ALTER TABLE ONLY "public"."prestaciones"
    ADD CONSTRAINT "prestaciones_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."prestaciones"
    ADD CONSTRAINT "prestaciones_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "public"."servicios"("id");



ALTER TABLE ONLY "public"."prestadora_modalidades"
    ADD CONSTRAINT "prestadora_modalidades_activada_por_fkey" FOREIGN KEY ("activada_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."prestadora_modalidades"
    ADD CONSTRAINT "prestadora_modalidades_desactivada_por_fkey" FOREIGN KEY ("desactivada_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."prestadora_modalidades"
    ADD CONSTRAINT "prestadora_modalidades_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."prestadora_modulos"
    ADD CONSTRAINT "prestadora_modulos_modulo_key_fkey" FOREIGN KEY ("modulo_key") REFERENCES "public"."catalogo_modulos"("key");



ALTER TABLE ONLY "public"."prestadora_modulos"
    ADD CONSTRAINT "prestadora_modulos_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."prestadora_pasarela_pago"
    ADD CONSTRAINT "prestadora_pasarela_pago_activada_por_fkey" FOREIGN KEY ("activada_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."prestadora_pasarela_pago"
    ADD CONSTRAINT "prestadora_pasarela_pago_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."prestadora_planes"
    ADD CONSTRAINT "prestadora_planes_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."planes"("id");



ALTER TABLE ONLY "public"."prestadora_planes"
    ADD CONSTRAINT "prestadora_planes_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."familias"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."qr_cobro_efectivo"
    ADD CONSTRAINT "qr_cobro_efectivo_cobro_id_fkey" FOREIGN KEY ("cobro_id") REFERENCES "public"."cobros_marketplace"("id");



ALTER TABLE ONLY "public"."qr_cobro_efectivo"
    ADD CONSTRAINT "qr_cobro_efectivo_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."familias"("id");



ALTER TABLE ONLY "public"."qr_cobro_efectivo"
    ADD CONSTRAINT "qr_cobro_efectivo_suscripcion_id_fkey" FOREIGN KEY ("suscripcion_id") REFERENCES "public"."suscripciones_marketplace"("id");



ALTER TABLE ONLY "public"."qr_cobro_efectivo"
    ADD CONSTRAINT "qr_cobro_efectivo_usado_por_fkey" FOREIGN KEY ("usado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."rangos_referencia_vitales"
    ADD CONSTRAINT "rangos_referencia_vitales_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rangos_referencia_vitales"
    ADD CONSTRAINT "rangos_referencia_vitales_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."reportes"
    ADD CONSTRAINT "reportes_guardia_tenant_fk" FOREIGN KEY ("guardia_id", "prestadora_id") REFERENCES "public"."guardias"("id", "prestadora_id");



ALTER TABLE ONLY "public"."reportes"
    ADD CONSTRAINT "reportes_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."series_guardias"
    ADD CONSTRAINT "series_guardias_asistente_tenant_fk" FOREIGN KEY ("asistente_id", "prestadora_id") REFERENCES "public"."asistentes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."series_guardias"
    ADD CONSTRAINT "series_guardias_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."series_guardias"
    ADD CONSTRAINT "series_guardias_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."familias"("id");



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."sesiones_tenant_admin_plataforma"
    ADD CONSTRAINT "sesiones_tenant_admin_plataforma_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."sesiones_tenant_admin_plataforma"
    ADD CONSTRAINT "sesiones_tenant_admin_plataforma_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."solicitudes"
    ADD CONSTRAINT "solicitudes_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."familias"("id");



ALTER TABLE ONLY "public"."solicitudes"
    ADD CONSTRAINT "solicitudes_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."suscripciones_marketplace"
    ADD CONSTRAINT "suscripciones_marketplace_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id");



ALTER TABLE ONLY "public"."suscripciones_marketplace"
    ADD CONSTRAINT "suscripciones_marketplace_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."familias"("id");



ALTER TABLE ONLY "public"."suscripciones_marketplace"
    ADD CONSTRAINT "suscripciones_marketplace_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id");



ALTER TABLE ONLY "public"."suscripciones_marketplace"
    ADD CONSTRAINT "suscripciones_marketplace_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."tipos_documento_asistente"
    ADD CONSTRAINT "tipos_documento_asistente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."tokens_activacion_cuenta"
    ADD CONSTRAINT "tokens_activacion_cuenta_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."uso_ia"
    ADD CONSTRAINT "uso_ia_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."verificaciones_asistente"
    ADD CONSTRAINT "verificaciones_asistente_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verificaciones_asistente"
    ADD CONSTRAINT "verificaciones_asistente_revisado_por_fkey" FOREIGN KEY ("revisado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."zonas_cobertura"
    ADD CONSTRAINT "zonas_cobertura_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



CREATE POLICY "admin_actualiza_lista_precios" ON "public"."lista_precios" FOR UPDATE USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_borra_lista_precios" ON "public"."lista_precios" FOR DELETE USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_edita_lista_precios" ON "public"."lista_precios" FOR INSERT WITH CHECK ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_ausencias" ON "public"."ausencias" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_certificados" ON "public"."certificados" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_ceses" ON "public"."ceses" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_circulo_familia" ON "public"."miembros_familia" USING (("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."familias" "f"
  WHERE (("f"."id" = "miembros_familia"."familia_id") AND ("f"."prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
           FROM "public"."usuarios" "u"
          WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))))));



CREATE POLICY "admin_gestiona_configuracion_alertas_ia" ON "public"."configuracion_alertas_ia" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



CREATE POLICY "admin_gestiona_configuracion_ausencia_automatica" ON "public"."configuracion_ausencia_automatica" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_configuracion_aviso_cese_asistente" ON "public"."configuracion_aviso_cese_asistente" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_configuracion_email_prestadora" ON "public"."configuracion_email_prestadora" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_configuracion_escalada_coordinador" ON "public"."configuracion_escalada_coordinador" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_configuracion_escalada_relevo" ON "public"."configuracion_escalada_relevo" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_configuracion_notificaciones" ON "public"."configuracion_notificaciones" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_configuracion_whatsapp_prestadora" ON "public"."configuracion_whatsapp_prestadora" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_conversaciones_whatsapp" ON "public"."conversaciones_whatsapp" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_familias" ON "public"."familias" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_guardias_cobertura" ON "public"."guardias_cobertura" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_mensajes_whatsapp" ON "public"."mensajes_whatsapp" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_pacientes" ON "public"."pacientes" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_permisos_prestadora" ON "public"."permisos_prestadora" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_personal_emergencia" ON "public"."personal_emergencia" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_plantillas_whatsapp" ON "public"."plantillas_whatsapp" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_gestiona_verificaciones" ON "public"."verificaciones_asistente" USING ((("public"."es_superadmin"() AND (EXISTS ( SELECT 1
   FROM "public"."asistentes" "a"
  WHERE (("a"."id" = "verificaciones_asistente"."asistente_id") AND ("a"."prestadora_id" = "public"."current_tenant"()))))) OR (EXISTS ( SELECT 1
   FROM ("public"."usuarios" "u"
     JOIN "public"."asistentes" "a" ON (("a"."id" = "verificaciones_asistente"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text") AND ("a"."prestadora_id" = "public"."current_tenant"()))))));



CREATE POLICY "admin_lee_asistentes" ON "public"."asistentes" FOR SELECT USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_lee_importaciones_de_su_prestadora" ON "public"."importaciones_prestadora" FOR SELECT USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_plataforma_gestiona_cambios_precio_ia_pendientes" ON "public"."cambios_precio_ia_pendientes" USING ("public"."es_admin_plataforma"());



CREATE POLICY "admin_plataforma_gestiona_catalogo_modulos" ON "public"."catalogo_modulos" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text")))));



CREATE POLICY "admin_plataforma_gestiona_facturas_licencia" ON "public"."facturas_licencia" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text")))));



CREATE POLICY "admin_plataforma_gestiona_plan_modulos" ON "public"."plan_modulos" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text")))));



CREATE POLICY "admin_plataforma_gestiona_planes" ON "public"."planes" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text")))));



CREATE POLICY "admin_plataforma_gestiona_precios_ia_modelo" ON "public"."precios_ia_modelo" USING ("public"."es_admin_plataforma"());



CREATE POLICY "admin_plataforma_gestiona_prestadora_modulos" ON "public"."prestadora_modulos" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text")))));



CREATE POLICY "admin_plataforma_gestiona_prestadora_planes" ON "public"."prestadora_planes" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text")))));



CREATE POLICY "admin_plataforma_gestiona_su_propia_sesion" ON "public"."sesiones_tenant_admin_plataforma" USING ((("admin_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text")))))) WITH CHECK ((("admin_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text"))))));



CREATE POLICY "admin_plataforma_lee_auditoria_de_su_sesion_activa" ON "public"."auditoria_admin_plataforma" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text")))) AND ("prestadora_id" = "public"."current_tenant"())));



CREATE POLICY "admin_plataforma_lee_modalidades" ON "public"."prestadora_modalidades" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text")))));



CREATE POLICY "admin_plataforma_lee_pasarela" ON "public"."prestadora_pasarela_pago" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text")))));



CREATE POLICY "admin_plataforma_lee_prestadoras" ON "public"."prestadoras" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_plataforma'::"text")))));



CREATE POLICY "admin_plataforma_lee_uso_ia" ON "public"."uso_ia" USING ("public"."es_admin_plataforma"());



CREATE POLICY "admin_prestadora_actualiza_visibilidad" ON "public"."calificaciones_asistente" FOR UPDATE USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"])))))));



CREATE POLICY "admin_prestadora_gestiona_autorizaciones_monitoreo" ON "public"."autorizaciones_monitoreo_paciente" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_config_habilitacion_via" ON "public"."configuracion_habilitacion_via_medicacion" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_documentos_asistente" ON "public"."documentos_asistente" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_etapas_incorporacion" ON "public"."etapas_incorporacion_asistente" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_habilitaciones_asistente" ON "public"."habilitaciones_asistente" USING (("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM ("public"."asistentes" "a"
     JOIN "public"."usuarios" "u" ON (("u"."id" = "auth"."uid"())))
  WHERE (("a"."id" = "habilitaciones_asistente"."asistente_id") AND ("a"."prestadora_id" = "public"."current_tenant"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



CREATE POLICY "admin_prestadora_gestiona_indicaciones_medicacion" ON "public"."indicaciones_medicacion" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_mensajes_asistente" ON "public"."mensajes_asistente" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))))) WITH CHECK ((("usuario_id" = "auth"."uid"()) AND ("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))))));



CREATE POLICY "admin_prestadora_gestiona_motivos_aviso_previo" ON "public"."motivos_aviso_previo_guardia" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_rangos_vitales" ON "public"."rangos_referencia_vitales" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_su_pasarela" ON "public"."prestadora_pasarela_pago" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



CREATE POLICY "admin_prestadora_gestiona_sus_modalidades" ON "public"."prestadora_modalidades" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



CREATE POLICY "admin_prestadora_gestiona_tipos_documento" ON "public"."tipos_documento_asistente" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_lee_auditoria_de_su_prestadora" ON "public"."auditoria_admin_plataforma" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text") AND ("u"."prestadora_id" = "auditoria_admin_plataforma"."prestadora_id")))));



CREATE POLICY "admin_prestadora_lee_su_auditoria_legal" ON "public"."auditoria_advertencias_legales" FOR SELECT USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_lee_su_plan" ON "public"."prestadora_planes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text") AND ("u"."prestadora_id" = "prestadora_planes"."prestadora_id")))));



CREATE POLICY "admin_prestadora_lee_su_prestadora" ON "public"."prestadoras" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text") AND ("u"."prestadora_id" = "prestadoras"."id")))));



CREATE POLICY "admin_prestadora_lee_sus_facturas_licencia" ON "public"."facturas_licencia" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text") AND ("u"."prestadora_id" = "facturas_licencia"."prestadora_id")))));



CREATE POLICY "admin_prestadora_lee_sus_modulos" ON "public"."prestadora_modulos" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text") AND ("u"."prestadora_id" = "prestadora_modulos"."prestadora_id")))));



ALTER TABLE "public"."advertencias_legales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alertas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alertas_contingencia_hospitalizacion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alertas_tempranas_guardia" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "asistente_actualiza_su_guardia" ON "public"."guardias" FOR UPDATE USING ((("prestadora_id" = "public"."current_tenant"()) AND ("asistente_id" = "auth"."uid"())));



CREATE POLICY "asistente_carga_su_descargo" ON "public"."calificaciones_asistente" FOR UPDATE USING ((("asistente_id" = "auth"."uid"()) AND ("descargo_asistente" IS NULL))) WITH CHECK (("asistente_id" = "auth"."uid"()));



CREATE POLICY "asistente_gestiona_reportes_de_su_guardia" ON "public"."reportes" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."guardias" "g"
  WHERE (("g"."id" = "reportes"."guardia_id") AND ("g"."asistente_id" = "auth"."uid"()))))));



CREATE POLICY "asistente_gestiona_sus_push_subscriptions" ON "public"."push_subscriptions" USING (("asistente_id" = "auth"."uid"())) WITH CHECK (("asistente_id" = "auth"."uid"()));



CREATE POLICY "asistente_ve_sus_guardias" ON "public"."guardias" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND ("asistente_id" = "auth"."uid"())));



ALTER TABLE "public"."asistentes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auditoria_admin_plataforma" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auditoria_advertencias_legales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ausencias" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."autorizaciones_monitoreo_paciente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calificaciones_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cambios_precio_ia_pendientes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catalogo_modulos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."certificados" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ceses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cierre_servicio_asistentes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cierres_servicio_paciente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cobros_marketplace" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_alertas_ia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_ausencia_automatica" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_aviso_cese_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_email_prestadora" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_escalada_coordinador" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_escalada_relevo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_habilitacion_via_medicacion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_notificaciones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_plataforma" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_prestadora" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_whatsapp_prestadora" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversaciones_whatsapp" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coordinador_agrega_pacientes" ON "public"."pacientes" FOR INSERT WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND "public"."tiene_permiso"('editar_datos_paciente'::"text")));



CREATE POLICY "coordinador_cierra_servicio_guardias" ON "public"."guardias" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."cierres_servicio_paciente" "c"
  WHERE ("c"."paciente_id" = "guardias"."paciente_id"))))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."cierres_servicio_paciente" "c"
  WHERE ("c"."paciente_id" = "guardias"."paciente_id")))));



CREATE POLICY "coordinador_cierra_servicio_series_guardias" ON "public"."series_guardias" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."cierres_servicio_paciente" "c"
  WHERE ("c"."paciente_id" = "series_guardias"."paciente_id"))))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."cierres_servicio_paciente" "c"
  WHERE ("c"."paciente_id" = "series_guardias"."paciente_id")))));



CREATE POLICY "coordinador_conversa_mensajes_asistente_de_su_zona" ON "public"."mensajes_asistente" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM ("public"."usuarios" "u"
     JOIN "public"."asistentes" "a" ON (("a"."id" = "mensajes_asistente"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas")))))) WITH CHECK ((("usuario_id" = "auth"."uid"()) AND ("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM ("public"."usuarios" "u"
     JOIN "public"."asistentes" "a" ON (("a"."id" = "mensajes_asistente"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_edita_asistentes_de_su_zona" ON "public"."asistentes" FOR UPDATE USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "asistentes"."zonas")))) AND "public"."tiene_permiso"('editar_identidad_asistente'::"text")));



CREATE POLICY "coordinador_edita_familias" ON "public"."familias" FOR UPDATE USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND "public"."tiene_permiso"('editar_datos_familia'::"text")));



CREATE POLICY "coordinador_edita_pacientes" ON "public"."pacientes" FOR UPDATE USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND "public"."tiene_permiso"('editar_datos_paciente'::"text")));



CREATE POLICY "coordinador_gestiona_alertas" ON "public"."alertas" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_gestiona_alertas_tempranas_guardia_de_su_zona" ON "public"."alertas_tempranas_guardia" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM (("public"."usuarios" "u"
     JOIN "public"."guardias" "g" ON (("g"."id" = "alertas_tempranas_guardia"."guardia_id")))
     JOIN "public"."asistentes" "a" ON (("a"."id" = "g"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_gestiona_ausencias_de_su_zona" ON "public"."ausencias" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM ("public"."usuarios" "u"
     JOIN "public"."asistentes" "a" ON (("a"."id" = "ausencias"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_gestiona_certificados_de_su_zona" ON "public"."certificados" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM ("public"."usuarios" "u"
     JOIN "public"."asistentes" "a" ON (("a"."id" = "certificados"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_gestiona_circulo_familia" ON "public"."miembros_familia" USING (((EXISTS ( SELECT 1
   FROM "public"."familias" "f"
  WHERE (("f"."id" = "miembros_familia"."familia_id") AND ("f"."prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
           FROM "public"."usuarios" "u"
          WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))))) AND "public"."tiene_permiso"('editar_datos_familia'::"text")));



CREATE POLICY "coordinador_gestiona_conversaciones_whatsapp" ON "public"."conversaciones_whatsapp" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_gestiona_excepciones_familiar_relevo_de_su_zona" ON "public"."excepciones_familiar_relevo" USING ((("prestadora_id" = "public"."current_tenant"()) AND ((EXISTS ( SELECT 1
   FROM ((("public"."usuarios" "u"
     JOIN "public"."incidentes_relevo" "ir" ON (("ir"."id" = "excepciones_familiar_relevo"."incidente_id")))
     JOIN "public"."guardias" "ge" ON (("ge"."id" = "ir"."guardia_entrante_id")))
     JOIN "public"."asistentes" "ae" ON (("ae"."id" = "ge"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "ae"."zonas")))) OR (EXISTS ( SELECT 1
   FROM ((("public"."usuarios" "u"
     JOIN "public"."incidentes_relevo" "ir" ON (("ir"."id" = "excepciones_familiar_relevo"."incidente_id")))
     JOIN "public"."guardias" "gs" ON (("gs"."id" = "ir"."guardia_saliente_id")))
     JOIN "public"."asistentes" "as2" ON (("as2"."id" = "gs"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "as2"."zonas")))))));



CREATE POLICY "coordinador_gestiona_guardias_cobertura_de_su_zona" ON "public"."guardias_cobertura" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM ("public"."usuarios" "u"
     JOIN "public"."asistentes" "a" ON (("a"."id" = "guardias_cobertura"."asistente_sustituto_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_gestiona_guardias_de_su_zona" ON "public"."guardias" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "public"."zonas_de_asistente"("guardias"."asistente_id")))))));



CREATE POLICY "coordinador_gestiona_guardias_tracking_gps_de_su_zona" ON "public"."guardias_tracking_gps" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM (("public"."usuarios" "u"
     JOIN "public"."guardias" "g" ON (("g"."id" = "guardias_tracking_gps"."guardia_id")))
     JOIN "public"."asistentes" "a" ON (("a"."id" = "g"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_gestiona_incidentes_relevo_de_su_zona" ON "public"."incidentes_relevo" USING ((("prestadora_id" = "public"."current_tenant"()) AND ((EXISTS ( SELECT 1
   FROM (("public"."usuarios" "u"
     JOIN "public"."guardias" "ge" ON (("ge"."id" = "incidentes_relevo"."guardia_entrante_id")))
     JOIN "public"."asistentes" "ae" ON (("ae"."id" = "ge"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "ae"."zonas")))) OR (("guardia_saliente_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (("public"."usuarios" "u"
     JOIN "public"."guardias" "gs" ON (("gs"."id" = "incidentes_relevo"."guardia_saliente_id")))
     JOIN "public"."asistentes" "as2" ON (("as2"."id" = "gs"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "as2"."zonas"))))))));



CREATE POLICY "coordinador_gestiona_informes_obra_social_de_su_zona" ON "public"."informes_obra_social" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM (("public"."usuarios" "u"
     JOIN "public"."guardias" "g" ON (("g"."paciente_id" = "informes_obra_social"."paciente_id")))
     JOIN "public"."asistentes" "a" ON (("a"."id" = "g"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_gestiona_mensajes_whatsapp" ON "public"."mensajes_whatsapp" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_gestiona_reportes_de_su_zona" ON "public"."reportes" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM (("public"."usuarios" "u"
     JOIN "public"."guardias" "g" ON (("g"."id" = "reportes"."guardia_id")))
     JOIN "public"."asistentes" "a" ON (("a"."id" = "g"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_gestiona_series_guardias_de_su_zona" ON "public"."series_guardias" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM ("public"."usuarios" "u"
     JOIN "public"."asistentes" "a" ON (("a"."id" = "series_guardias"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_gestiona_verificaciones_de_su_zona" ON "public"."verificaciones_asistente" USING ((EXISTS ( SELECT 1
   FROM ("public"."usuarios" "u"
     JOIN "public"."asistentes" "a" ON (("a"."id" = "verificaciones_asistente"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas") AND ("a"."prestadora_id" = "public"."current_tenant"())))));



CREATE POLICY "coordinador_inserta_notificaciones_cierre_servicio" ON "public"."notificaciones_cierre_servicio" FOR INSERT WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND ("cerrado_por" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_asistentes_de_su_zona" ON "public"."asistentes" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "asistentes"."zonas"))))));



CREATE POLICY "coordinador_lee_autorizaciones_monitoreo" ON "public"."autorizaciones_monitoreo_paciente" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_config_habilitacion_via" ON "public"."configuracion_habilitacion_via_medicacion" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_configuracion_alertas_ia" ON "public"."configuracion_alertas_ia" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_configuracion_ausencia_automatica" ON "public"."configuracion_ausencia_automatica" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_configuracion_aviso_cese_asistente" ON "public"."configuracion_aviso_cese_asistente" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_configuracion_escalada_coordinador" ON "public"."configuracion_escalada_coordinador" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_configuracion_escalada_relevo" ON "public"."configuracion_escalada_relevo" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_configuracion_notificaciones" ON "public"."configuracion_notificaciones" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_documentos_asistente_de_su_zona" ON "public"."documentos_asistente" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM ("public"."usuarios" "u"
     JOIN "public"."asistentes" "a" ON (("a"."id" = "documentos_asistente"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_lee_etapas_incorporacion" ON "public"."etapas_incorporacion_asistente" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_familias" ON "public"."familias" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_habilitaciones_asistente" ON "public"."habilitaciones_asistente" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."asistentes" "a"
     JOIN "public"."usuarios" "u" ON (("u"."id" = "auth"."uid"())))
  WHERE (("a"."id" = "habilitaciones_asistente"."asistente_id") AND ("a"."prestadora_id" = "public"."current_tenant"()) AND ("u"."rol" = 'coordinador'::"text")))));



CREATE POLICY "coordinador_lee_indicaciones_medicacion" ON "public"."indicaciones_medicacion" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_motivos_aviso_previo" ON "public"."motivos_aviso_previo_guardia" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_pacientes" ON "public"."pacientes" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_personal_emergencia" ON "public"."personal_emergencia" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_plantillas_whatsapp" ON "public"."plantillas_whatsapp" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_rangos_vitales" ON "public"."rangos_referencia_vitales" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_su_prestadora" ON "public"."prestadoras" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."prestadora_id" = "prestadoras"."id")))));



CREATE POLICY "coordinador_lee_tipos_documento" ON "public"."tipos_documento_asistente" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_ve_notificaciones_cierre_servicio_de_su_zona" ON "public"."notificaciones_cierre_servicio" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM ("public"."usuarios" "u"
     JOIN "public"."asistentes" "a" ON (("a"."id" = "notificaciones_cierre_servicio"."asistente_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_y_admin_gestionan_cierre_servicio_asistentes" ON "public"."cierre_servicio_asistentes" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"])))))));



CREATE POLICY "coordinador_y_admin_gestionan_cierres_servicio_paciente" ON "public"."cierres_servicio_paciente" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"])))))));



ALTER TABLE "public"."credenciales_pasarela_pago" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documentos_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."domicilios_temporales_paciente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."escalas_legales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."etapas_incorporacion_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."excepciones_familiar_relevo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."facturas_familia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."facturas_familia_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."facturas_licencia" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "familia_crea_su_calificacion" ON "public"."calificaciones_asistente" FOR INSERT WITH CHECK ((("familia_id" = "auth"."uid"()) AND ("prestadora_id" = "public"."current_tenant"()) AND ("guardia_id" IN ( SELECT "g"."id"
   FROM ("public"."guardias" "g"
     JOIN "public"."pacientes" "p" ON (("p"."id" = "g"."paciente_id")))
  WHERE ("p"."familia_id" = "auth"."uid"())))));



CREATE POLICY "familia_genera_su_qr_cobro" ON "public"."qr_cobro_efectivo" FOR INSERT WITH CHECK ((("familia_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."suscripciones_marketplace" "s"
  WHERE (("s"."id" = "qr_cobro_efectivo"."suscripcion_id") AND ("s"."familia_id" = "auth"."uid"()))))));



CREATE POLICY "familia_gestiona_sus_calificaciones" ON "public"."calificaciones_asistente" USING ((("familia_id" = "public"."familia_id_de_usuario"("auth"."uid"())) OR (EXISTS ( SELECT 1
   FROM "public"."pacientes" "p"
  WHERE (("p"."id" = "calificaciones_asistente"."paciente_id") AND ("p"."familia_id" = "public"."familia_id_de_usuario"("auth"."uid"()))))))) WITH CHECK (("familia_id" = "public"."familia_id_de_usuario"("auth"."uid"())));



CREATE POLICY "familia_gestiona_sus_push_subscriptions" ON "public"."push_subscriptions" USING (("familia_id" = "auth"."uid"())) WITH CHECK (("familia_id" = "auth"."uid"()));



CREATE POLICY "familia_ve_alertas_de_sus_pacientes" ON "public"."alertas" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."pacientes" "p"
  WHERE (("p"."id" = "alertas"."paciente_id") AND ("p"."familia_id" = "public"."familia_id_de_usuario"("auth"."uid"()))))));



CREATE POLICY "familia_ve_asistente_asignado" ON "public"."asistentes" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM ("public"."guardias" "g"
     JOIN "public"."pacientes" "p" ON (("p"."id" = "g"."paciente_id")))
  WHERE (("g"."asistente_id" = "asistentes"."id") AND ("p"."familia_id" = "public"."familia_id_de_usuario"("auth"."uid"())))))));



CREATE POLICY "familia_ve_certificado_asistente_asignado" ON "public"."certificados" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."guardias" "g"
     JOIN "public"."pacientes" "p" ON (("p"."id" = "g"."paciente_id")))
  WHERE (("g"."asistente_id" = "certificados"."asistente_id") AND ("p"."familia_id" = "public"."familia_id_de_usuario"("auth"."uid"()))))));



CREATE POLICY "familia_ve_guardias_de_sus_pacientes" ON "public"."guardias" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."pacientes" "p"
  WHERE (("p"."id" = "guardias"."paciente_id") AND ("p"."familia_id" = "public"."familia_id_de_usuario"("auth"."uid"())))))));



CREATE POLICY "familia_ve_hospitalizaciones_de_su_paciente" ON "public"."hospitalizaciones_paciente" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."pacientes" "p"
  WHERE (("p"."id" = "hospitalizaciones_paciente"."paciente_id") AND ("p"."familia_id" = "auth"."uid"())))));



CREATE POLICY "familia_ve_items_de_sus_facturas" ON "public"."facturas_familia_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."facturas_familia" "f"
  WHERE (("f"."id" = "facturas_familia_items"."factura_id") AND ("f"."familia_id" = "public"."familia_id_de_usuario"("auth"."uid"()))))));



CREATE POLICY "familia_ve_reportes_de_sus_pacientes" ON "public"."reportes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."guardias" "g"
     JOIN "public"."pacientes" "p" ON (("p"."id" = "g"."paciente_id")))
  WHERE (("g"."id" = "reportes"."guardia_id") AND ("p"."familia_id" = "public"."familia_id_de_usuario"("auth"."uid"()))))));



CREATE POLICY "familia_ve_su_propia_fila" ON "public"."familias" FOR SELECT USING (("id" = "public"."familia_id_de_usuario"("auth"."uid"())));



CREATE POLICY "familia_ve_su_qr_cobro" ON "public"."qr_cobro_efectivo" FOR SELECT USING (("familia_id" = "auth"."uid"()));



CREATE POLICY "familia_ve_su_suscripcion_marketplace" ON "public"."suscripciones_marketplace" FOR SELECT USING (("familia_id" = "auth"."uid"()));



CREATE POLICY "familia_ve_sus_cobros_marketplace" ON "public"."cobros_marketplace" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."suscripciones_marketplace" "s"
  WHERE (("s"."id" = "cobros_marketplace"."suscripcion_id") AND ("s"."familia_id" = "auth"."uid"())))));



CREATE POLICY "familia_ve_sus_facturas" ON "public"."facturas_familia" FOR SELECT USING (("familia_id" = "public"."familia_id_de_usuario"("auth"."uid"())));



CREATE POLICY "familia_ve_sus_facturas_items" ON "public"."facturas_familia_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."facturas_familia" "f"
  WHERE (("f"."id" = "facturas_familia_items"."factura_id") AND ("f"."familia_id" = "auth"."uid"())))));



CREATE POLICY "familia_ve_sus_pacientes" ON "public"."pacientes" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND ("familia_id" = "public"."familia_id_de_usuario"("auth"."uid"()))));



CREATE POLICY "familia_ve_sus_servicios" ON "public"."servicios" FOR SELECT USING (("familia_id" = "auth"."uid"()));



ALTER TABLE "public"."familias" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."formulas_cese" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."guardias" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."guardias_cobertura" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."guardias_tracking_gps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."habilitaciones_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hospitalizaciones_paciente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."importaciones_prestadora" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."incidentes_relevo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."indicaciones_medicacion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."informes_obra_social" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lectura_configuracion_plataforma" ON "public"."configuracion_plataforma" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."lista_precios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mensajes_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mensajes_whatsapp" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mfa_codigos_recuperacion" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "miembro_lee_su_propia_fila" ON "public"."miembros_familia" FOR SELECT USING (("usuario_id" = "auth"."uid"()));



ALTER TABLE "public"."miembros_familia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."motivos_aviso_previo_guardia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notificaciones_cierre_servicio" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "oculta_pendientes_de_conformidad" ON "public"."asistentes" AS RESTRICTIVE USING ((NOT "pendiente_conformidad")) WITH CHECK ((NOT "pendiente_conformidad"));



CREATE POLICY "oculta_pendientes_de_conformidad" ON "public"."familias" AS RESTRICTIVE USING ((NOT "pendiente_conformidad")) WITH CHECK ((NOT "pendiente_conformidad"));



CREATE POLICY "oculta_pendientes_de_conformidad" ON "public"."pacientes" AS RESTRICTIVE USING ((NOT "pendiente_conformidad")) WITH CHECK ((NOT "pendiente_conformidad"));



ALTER TABLE "public"."pacientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "panel_edita_asistentes" ON "public"."asistentes" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_edita_postulaciones" ON "public"."postulaciones" FOR UPDATE USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_edita_solicitudes" ON "public"."solicitudes" FOR UPDATE USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_gestiona_alertas" ON "public"."alertas" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_gestiona_alertas_contingencia_hospitalizacion" ON "public"."alertas_contingencia_hospitalizacion" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_gestiona_alertas_tempranas_guardia" ON "public"."alertas_tempranas_guardia" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_gestiona_domicilios_temporales" ON "public"."domicilios_temporales_paciente" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_gestiona_excepciones_familiar_relevo" ON "public"."excepciones_familiar_relevo" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_gestiona_facturas_familia" ON "public"."facturas_familia" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_gestiona_facturas_familia_items" ON "public"."facturas_familia_items" USING ((EXISTS ( SELECT 1
   FROM "public"."facturas_familia" "f"
  WHERE (("f"."id" = "facturas_familia_items"."factura_id") AND (("public"."es_superadmin"() AND ("f"."prestadora_id" = "public"."current_tenant"())) OR (("f"."prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
           FROM "public"."usuarios" "u"
          WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"])))))))))));



CREATE POLICY "panel_gestiona_guardias" ON "public"."guardias" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_gestiona_guardias_tracking_gps" ON "public"."guardias_tracking_gps" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_gestiona_hospitalizaciones_paciente" ON "public"."hospitalizaciones_paciente" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_gestiona_incidentes_relevo" ON "public"."incidentes_relevo" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_gestiona_informes_obra_social" ON "public"."informes_obra_social" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_gestiona_notificaciones_cierre_servicio" ON "public"."notificaciones_cierre_servicio" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_gestiona_paquete_items" ON "public"."paquete_prestacion_items" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_gestiona_paquetes" ON "public"."paquetes_prestaciones" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_gestiona_prestaciones" ON "public"."prestaciones" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_gestiona_reportes" ON "public"."reportes" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_gestiona_series_guardias" ON "public"."series_guardias" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_gestiona_servicios" ON "public"."servicios" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_gestiona_zonas_cobertura" ON "public"."zonas_cobertura" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "panel_lee_advertencias_legales" ON "public"."advertencias_legales" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'admin_plataforma'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "panel_lee_escalas_legales" ON "public"."escalas_legales" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'admin_plataforma'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "panel_lee_formulas_cese" ON "public"."formulas_cese" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'admin_plataforma'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "panel_lee_lista_precios" ON "public"."lista_precios" FOR SELECT USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_lee_postulaciones" ON "public"."postulaciones" FOR SELECT USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_lee_solicitudes" ON "public"."solicitudes" FOR SELECT USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_registra_advertencia_mostrada" ON "public"."auditoria_advertencias_legales" FOR INSERT WITH CHECK ((("usuario_id" = "auth"."uid"()) AND ("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



CREATE POLICY "panel_registra_cobro_efectivo_manual" ON "public"."cobros_marketplace" FOR INSERT WITH CHECK ((("medio" = 'efectivo_manual'::"text") AND ("registrado_por" = "auth"."uid"()) AND ("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"])))))));



ALTER TABLE "public"."paquete_prestacion_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."paquetes_prestaciones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permisos_prestadora" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."personal_emergencia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plan_modulos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."planes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plantillas_whatsapp" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."postulaciones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."precios_ia_modelo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prestaciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prestadora_edita_su_configuracion" ON "public"."configuracion_prestadora" FOR UPDATE USING ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "prestadora_lee_su_configuracion" ON "public"."configuracion_prestadora" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



ALTER TABLE "public"."prestadora_modalidades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prestadora_modulos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prestadora_pasarela_pago" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prestadora_planes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prestadora_ve_calificaciones" ON "public"."calificaciones_asistente" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) OR ("familia_id" = "auth"."uid"()) OR ("asistente_id" = "auth"."uid"())));



CREATE POLICY "prestadora_ve_cobros_marketplace" ON "public"."cobros_marketplace" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"])))))));



CREATE POLICY "prestadora_ve_qr_cobro" ON "public"."qr_cobro_efectivo" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."suscripciones_marketplace" "s"
  WHERE (("s"."id" = "qr_cobro_efectivo"."suscripcion_id") AND ("s"."prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
           FROM "public"."usuarios" "u"
          WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"])))))))));



CREATE POLICY "prestadora_ve_suscripciones_marketplace" ON "public"."suscripciones_marketplace" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"])))))));



ALTER TABLE "public"."prestadoras" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."qr_cobro_efectivo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rangos_referencia_vitales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reportes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."series_guardias" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."servicios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sesiones_tenant_admin_plataforma" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."solicitudes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "superadmin_escribe_configuracion_plataforma" ON "public"."configuracion_plataforma" FOR UPDATE USING ("public"."es_superadmin"()) WITH CHECK ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_advertencias_legales" ON "public"."advertencias_legales" USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_escalas_legales" ON "public"."escalas_legales" USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_formulas_cese" ON "public"."formulas_cese" USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_prestadoras" ON "public"."prestadoras" USING (("public"."es_superadmin"() AND ("id" = "public"."current_tenant"())));



CREATE POLICY "superadmin_lee_toda_la_auditoria" ON "public"."auditoria_admin_plataforma" FOR SELECT USING ("public"."es_superadmin"());



ALTER TABLE "public"."suscripciones_marketplace" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tipos_documento_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tokens_activacion_cuenta" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."uso_ia" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuario_ve_su_propia_fila" ON "public"."usuarios" FOR SELECT USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuarios_prestadora_leen_su_pasarela" ON "public"."prestadora_pasarela_pago" FOR SELECT USING (("prestadora_id" = "public"."current_tenant"()));



CREATE POLICY "usuarios_prestadora_leen_sus_modalidades" ON "public"."prestadora_modalidades" FOR SELECT USING (("prestadora_id" = "public"."current_tenant"()));



ALTER TABLE "public"."verificaciones_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."zonas_cobertura" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."bloquear_edicion_laboral_coordinador"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bloquear_edicion_laboral_coordinador"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_tenant"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_tenant"() TO "service_role";
GRANT ALL ON FUNCTION "public"."current_tenant"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_tenant"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."es_admin_plataforma"() TO "anon";
GRANT ALL ON FUNCTION "public"."es_admin_plataforma"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."es_admin_plataforma"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."es_sesion_tenant_admin_plataforma_activa"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."es_sesion_tenant_admin_plataforma_activa"() TO "service_role";
GRANT ALL ON FUNCTION "public"."es_sesion_tenant_admin_plataforma_activa"() TO "anon";
GRANT ALL ON FUNCTION "public"."es_sesion_tenant_admin_plataforma_activa"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."es_superadmin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."es_superadmin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."es_superadmin"() TO "anon";
GRANT ALL ON FUNCTION "public"."es_superadmin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."familia_id_de_usuario"("p_usuario_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."familia_id_de_usuario"("p_usuario_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."familia_id_de_usuario"("p_usuario_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."familia_id_de_usuario"("p_usuario_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_auditoria_admin_plataforma_mutacion"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guardar_credencial_pasarela_pago"("p_prestadora_id" "uuid", "p_proveedor" "text", "p_credencial" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guardar_credencial_pasarela_pago"("p_prestadora_id" "uuid", "p_proveedor" "text", "p_credencial" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."guardar_credencial_smtp_prestadora"("p_prestadora_id" "uuid", "p_password" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guardar_credencial_smtp_prestadora"("p_prestadora_id" "uuid", "p_password" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."guardar_token_whatsapp"("p_prestadora_id" "uuid", "p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guardar_token_whatsapp"("p_prestadora_id" "uuid", "p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."intercambiar_orden_etapas_incorporacion"("p_id_a" "uuid", "p_orden_a" smallint, "p_id_b" "uuid", "p_orden_b" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."intercambiar_orden_etapas_incorporacion"("p_id_a" "uuid", "p_orden_a" smallint, "p_id_b" "uuid", "p_orden_b" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."leer_credencial_pasarela_pago"("p_prestadora_id" "uuid", "p_proveedor" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."leer_credencial_pasarela_pago"("p_prestadora_id" "uuid", "p_proveedor" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."leer_credencial_smtp_prestadora"("p_prestadora_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."leer_credencial_smtp_prestadora"("p_prestadora_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."leer_token_whatsapp"("p_prestadora_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."leer_token_whatsapp"("p_prestadora_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."marcar_prestaciones_a_revisar"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."marcar_prestaciones_a_revisar"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prestadora_tiene_modalidad_activa"("p_prestadora_id" "uuid", "p_modalidad" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prestadora_tiene_modalidad_activa"("p_prestadora_id" "uuid", "p_modalidad" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."prestadora_tiene_modalidad_activa"("p_prestadora_id" "uuid", "p_modalidad" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prestadora_tiene_modalidad_activa"("p_prestadora_id" "uuid", "p_modalidad" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."tiene_permiso"("p_accion" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tiene_permiso"("p_accion" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."tiene_permiso"("p_accion" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tiene_permiso"("p_accion" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_servicio_misma_familia"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_servicio_misma_familia"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_servicio_misma_familia"() TO "service_role";



GRANT ALL ON FUNCTION "public"."zonas_de_asistente"("p_asistente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."zonas_de_asistente"("p_asistente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."zonas_de_asistente"("p_asistente_id" "uuid") TO "service_role";


















GRANT ALL ON TABLE "public"."advertencias_legales" TO "anon";
GRANT ALL ON TABLE "public"."advertencias_legales" TO "authenticated";
GRANT ALL ON TABLE "public"."advertencias_legales" TO "service_role";



GRANT ALL ON TABLE "public"."alertas" TO "anon";
GRANT ALL ON TABLE "public"."alertas" TO "authenticated";
GRANT ALL ON TABLE "public"."alertas" TO "service_role";



GRANT ALL ON TABLE "public"."alertas_contingencia_hospitalizacion" TO "anon";
GRANT ALL ON TABLE "public"."alertas_contingencia_hospitalizacion" TO "authenticated";
GRANT ALL ON TABLE "public"."alertas_contingencia_hospitalizacion" TO "service_role";



GRANT ALL ON TABLE "public"."alertas_tempranas_guardia" TO "anon";
GRANT ALL ON TABLE "public"."alertas_tempranas_guardia" TO "authenticated";
GRANT ALL ON TABLE "public"."alertas_tempranas_guardia" TO "service_role";



GRANT ALL ON TABLE "public"."asistentes" TO "anon";
GRANT ALL ON TABLE "public"."asistentes" TO "authenticated";
GRANT ALL ON TABLE "public"."asistentes" TO "service_role";



GRANT ALL ON TABLE "public"."asistentes_coordinador" TO "anon";
GRANT ALL ON TABLE "public"."asistentes_coordinador" TO "authenticated";
GRANT ALL ON TABLE "public"."asistentes_coordinador" TO "service_role";



GRANT ALL ON TABLE "public"."auditoria_admin_plataforma" TO "anon";
GRANT ALL ON TABLE "public"."auditoria_admin_plataforma" TO "authenticated";
GRANT ALL ON TABLE "public"."auditoria_admin_plataforma" TO "service_role";



GRANT ALL ON TABLE "public"."auditoria_advertencias_legales" TO "anon";
GRANT ALL ON TABLE "public"."auditoria_advertencias_legales" TO "authenticated";
GRANT ALL ON TABLE "public"."auditoria_advertencias_legales" TO "service_role";



GRANT ALL ON TABLE "public"."ausencias" TO "anon";
GRANT ALL ON TABLE "public"."ausencias" TO "authenticated";
GRANT ALL ON TABLE "public"."ausencias" TO "service_role";



GRANT ALL ON TABLE "public"."autorizaciones_monitoreo_paciente" TO "anon";
GRANT ALL ON TABLE "public"."autorizaciones_monitoreo_paciente" TO "authenticated";
GRANT ALL ON TABLE "public"."autorizaciones_monitoreo_paciente" TO "service_role";



GRANT ALL ON TABLE "public"."calificaciones_asistente" TO "anon";
GRANT ALL ON TABLE "public"."calificaciones_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."calificaciones_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."cambios_precio_ia_pendientes" TO "anon";
GRANT ALL ON TABLE "public"."cambios_precio_ia_pendientes" TO "authenticated";
GRANT ALL ON TABLE "public"."cambios_precio_ia_pendientes" TO "service_role";



GRANT ALL ON TABLE "public"."catalogo_modulos" TO "anon";
GRANT ALL ON TABLE "public"."catalogo_modulos" TO "authenticated";
GRANT ALL ON TABLE "public"."catalogo_modulos" TO "service_role";



GRANT ALL ON TABLE "public"."certificados" TO "anon";
GRANT ALL ON TABLE "public"."certificados" TO "authenticated";
GRANT ALL ON TABLE "public"."certificados" TO "service_role";



GRANT ALL ON TABLE "public"."ceses" TO "anon";
GRANT ALL ON TABLE "public"."ceses" TO "authenticated";
GRANT ALL ON TABLE "public"."ceses" TO "service_role";



GRANT ALL ON TABLE "public"."cierre_servicio_asistentes" TO "anon";
GRANT ALL ON TABLE "public"."cierre_servicio_asistentes" TO "authenticated";
GRANT ALL ON TABLE "public"."cierre_servicio_asistentes" TO "service_role";



GRANT ALL ON TABLE "public"."cierres_servicio_paciente" TO "anon";
GRANT ALL ON TABLE "public"."cierres_servicio_paciente" TO "authenticated";
GRANT ALL ON TABLE "public"."cierres_servicio_paciente" TO "service_role";



GRANT ALL ON TABLE "public"."cobros_marketplace" TO "anon";
GRANT ALL ON TABLE "public"."cobros_marketplace" TO "authenticated";
GRANT ALL ON TABLE "public"."cobros_marketplace" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_alertas_ia" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_alertas_ia" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_alertas_ia" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_ausencia_automatica" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_ausencia_automatica" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_ausencia_automatica" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_aviso_cese_asistente" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_aviso_cese_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_aviso_cese_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_email_prestadora" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_email_prestadora" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_email_prestadora" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_escalada_coordinador" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_escalada_coordinador" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_escalada_coordinador" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_escalada_relevo" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_escalada_relevo" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_escalada_relevo" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_habilitacion_via_medicacion" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_habilitacion_via_medicacion" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_habilitacion_via_medicacion" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_notificaciones" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_notificaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_notificaciones" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_plataforma" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_plataforma" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_plataforma" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_prestadora" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_prestadora" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_prestadora" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_whatsapp_prestadora" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_whatsapp_prestadora" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_whatsapp_prestadora" TO "service_role";



GRANT ALL ON TABLE "public"."conversaciones_whatsapp" TO "anon";
GRANT ALL ON TABLE "public"."conversaciones_whatsapp" TO "authenticated";
GRANT ALL ON TABLE "public"."conversaciones_whatsapp" TO "service_role";



GRANT ALL ON TABLE "public"."credenciales_pasarela_pago" TO "anon";
GRANT ALL ON TABLE "public"."credenciales_pasarela_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."credenciales_pasarela_pago" TO "service_role";



GRANT ALL ON TABLE "public"."documentos_asistente" TO "anon";
GRANT ALL ON TABLE "public"."documentos_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."documentos_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."domicilios_temporales_paciente" TO "anon";
GRANT ALL ON TABLE "public"."domicilios_temporales_paciente" TO "authenticated";
GRANT ALL ON TABLE "public"."domicilios_temporales_paciente" TO "service_role";



GRANT ALL ON TABLE "public"."escalas_legales" TO "anon";
GRANT ALL ON TABLE "public"."escalas_legales" TO "authenticated";
GRANT ALL ON TABLE "public"."escalas_legales" TO "service_role";



GRANT ALL ON TABLE "public"."etapas_incorporacion_asistente" TO "anon";
GRANT ALL ON TABLE "public"."etapas_incorporacion_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."etapas_incorporacion_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."excepciones_familiar_relevo" TO "anon";
GRANT ALL ON TABLE "public"."excepciones_familiar_relevo" TO "authenticated";
GRANT ALL ON TABLE "public"."excepciones_familiar_relevo" TO "service_role";



GRANT ALL ON TABLE "public"."facturas_familia" TO "anon";
GRANT ALL ON TABLE "public"."facturas_familia" TO "authenticated";
GRANT ALL ON TABLE "public"."facturas_familia" TO "service_role";



GRANT ALL ON TABLE "public"."facturas_familia_items" TO "anon";
GRANT ALL ON TABLE "public"."facturas_familia_items" TO "authenticated";
GRANT ALL ON TABLE "public"."facturas_familia_items" TO "service_role";



GRANT ALL ON TABLE "public"."facturas_licencia" TO "anon";
GRANT ALL ON TABLE "public"."facturas_licencia" TO "authenticated";
GRANT ALL ON TABLE "public"."facturas_licencia" TO "service_role";



GRANT ALL ON TABLE "public"."familias" TO "anon";
GRANT ALL ON TABLE "public"."familias" TO "authenticated";
GRANT ALL ON TABLE "public"."familias" TO "service_role";



GRANT ALL ON TABLE "public"."formulas_cese" TO "anon";
GRANT ALL ON TABLE "public"."formulas_cese" TO "authenticated";
GRANT ALL ON TABLE "public"."formulas_cese" TO "service_role";



GRANT ALL ON TABLE "public"."guardias" TO "anon";
GRANT ALL ON TABLE "public"."guardias" TO "authenticated";
GRANT ALL ON TABLE "public"."guardias" TO "service_role";



GRANT ALL ON TABLE "public"."guardias_cobertura" TO "anon";
GRANT ALL ON TABLE "public"."guardias_cobertura" TO "authenticated";
GRANT ALL ON TABLE "public"."guardias_cobertura" TO "service_role";



GRANT ALL ON TABLE "public"."guardias_tracking_gps" TO "anon";
GRANT ALL ON TABLE "public"."guardias_tracking_gps" TO "authenticated";
GRANT ALL ON TABLE "public"."guardias_tracking_gps" TO "service_role";



GRANT ALL ON TABLE "public"."habilitaciones_asistente" TO "anon";
GRANT ALL ON TABLE "public"."habilitaciones_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."habilitaciones_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."hospitalizaciones_paciente" TO "anon";
GRANT ALL ON TABLE "public"."hospitalizaciones_paciente" TO "authenticated";
GRANT ALL ON TABLE "public"."hospitalizaciones_paciente" TO "service_role";



GRANT ALL ON TABLE "public"."importaciones_prestadora" TO "anon";
GRANT ALL ON TABLE "public"."importaciones_prestadora" TO "authenticated";
GRANT ALL ON TABLE "public"."importaciones_prestadora" TO "service_role";



GRANT ALL ON TABLE "public"."incidentes_relevo" TO "anon";
GRANT ALL ON TABLE "public"."incidentes_relevo" TO "authenticated";
GRANT ALL ON TABLE "public"."incidentes_relevo" TO "service_role";



GRANT ALL ON TABLE "public"."indicaciones_medicacion" TO "anon";
GRANT ALL ON TABLE "public"."indicaciones_medicacion" TO "authenticated";
GRANT ALL ON TABLE "public"."indicaciones_medicacion" TO "service_role";



GRANT ALL ON TABLE "public"."informes_obra_social" TO "anon";
GRANT ALL ON TABLE "public"."informes_obra_social" TO "authenticated";
GRANT ALL ON TABLE "public"."informes_obra_social" TO "service_role";



GRANT ALL ON TABLE "public"."lista_precios" TO "anon";
GRANT ALL ON TABLE "public"."lista_precios" TO "authenticated";
GRANT ALL ON TABLE "public"."lista_precios" TO "service_role";



GRANT ALL ON SEQUENCE "public"."lista_precios_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lista_precios_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lista_precios_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."mensajes_asistente" TO "anon";
GRANT ALL ON TABLE "public"."mensajes_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."mensajes_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."mensajes_whatsapp" TO "anon";
GRANT ALL ON TABLE "public"."mensajes_whatsapp" TO "authenticated";
GRANT ALL ON TABLE "public"."mensajes_whatsapp" TO "service_role";



GRANT ALL ON TABLE "public"."mfa_codigos_recuperacion" TO "anon";
GRANT ALL ON TABLE "public"."mfa_codigos_recuperacion" TO "authenticated";
GRANT ALL ON TABLE "public"."mfa_codigos_recuperacion" TO "service_role";



GRANT ALL ON TABLE "public"."miembros_familia" TO "anon";
GRANT ALL ON TABLE "public"."miembros_familia" TO "authenticated";
GRANT ALL ON TABLE "public"."miembros_familia" TO "service_role";



GRANT ALL ON TABLE "public"."motivos_aviso_previo_guardia" TO "anon";
GRANT ALL ON TABLE "public"."motivos_aviso_previo_guardia" TO "authenticated";
GRANT ALL ON TABLE "public"."motivos_aviso_previo_guardia" TO "service_role";



GRANT ALL ON TABLE "public"."notificaciones_cierre_servicio" TO "anon";
GRANT ALL ON TABLE "public"."notificaciones_cierre_servicio" TO "authenticated";
GRANT ALL ON TABLE "public"."notificaciones_cierre_servicio" TO "service_role";



GRANT ALL ON TABLE "public"."pacientes" TO "anon";
GRANT ALL ON TABLE "public"."pacientes" TO "authenticated";
GRANT ALL ON TABLE "public"."pacientes" TO "service_role";



GRANT ALL ON TABLE "public"."paquete_prestacion_items" TO "anon";
GRANT ALL ON TABLE "public"."paquete_prestacion_items" TO "authenticated";
GRANT ALL ON TABLE "public"."paquete_prestacion_items" TO "service_role";



GRANT ALL ON TABLE "public"."paquetes_prestaciones" TO "anon";
GRANT ALL ON TABLE "public"."paquetes_prestaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."paquetes_prestaciones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."paquetes_prestaciones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."paquetes_prestaciones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."paquetes_prestaciones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."permisos_prestadora" TO "anon";
GRANT ALL ON TABLE "public"."permisos_prestadora" TO "authenticated";
GRANT ALL ON TABLE "public"."permisos_prestadora" TO "service_role";



GRANT ALL ON TABLE "public"."personal_emergencia" TO "anon";
GRANT ALL ON TABLE "public"."personal_emergencia" TO "authenticated";
GRANT ALL ON TABLE "public"."personal_emergencia" TO "service_role";



GRANT ALL ON TABLE "public"."plan_modulos" TO "anon";
GRANT ALL ON TABLE "public"."plan_modulos" TO "authenticated";
GRANT ALL ON TABLE "public"."plan_modulos" TO "service_role";



GRANT ALL ON TABLE "public"."planes" TO "anon";
GRANT ALL ON TABLE "public"."planes" TO "authenticated";
GRANT ALL ON TABLE "public"."planes" TO "service_role";



GRANT ALL ON TABLE "public"."plantillas_whatsapp" TO "anon";
GRANT ALL ON TABLE "public"."plantillas_whatsapp" TO "authenticated";
GRANT ALL ON TABLE "public"."plantillas_whatsapp" TO "service_role";



GRANT ALL ON TABLE "public"."postulaciones" TO "anon";
GRANT ALL ON TABLE "public"."postulaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."postulaciones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."postulaciones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."postulaciones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."postulaciones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."precios_ia_modelo" TO "anon";
GRANT ALL ON TABLE "public"."precios_ia_modelo" TO "authenticated";
GRANT ALL ON TABLE "public"."precios_ia_modelo" TO "service_role";



GRANT ALL ON TABLE "public"."prestaciones" TO "anon";
GRANT ALL ON TABLE "public"."prestaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."prestaciones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."prestaciones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."prestaciones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."prestaciones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."prestadora_modalidades" TO "anon";
GRANT ALL ON TABLE "public"."prestadora_modalidades" TO "authenticated";
GRANT ALL ON TABLE "public"."prestadora_modalidades" TO "service_role";



GRANT ALL ON TABLE "public"."prestadora_modulos" TO "anon";
GRANT ALL ON TABLE "public"."prestadora_modulos" TO "authenticated";
GRANT ALL ON TABLE "public"."prestadora_modulos" TO "service_role";



GRANT ALL ON TABLE "public"."prestadora_pasarela_pago" TO "anon";
GRANT ALL ON TABLE "public"."prestadora_pasarela_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."prestadora_pasarela_pago" TO "service_role";



GRANT ALL ON TABLE "public"."prestadora_planes" TO "anon";
GRANT ALL ON TABLE "public"."prestadora_planes" TO "authenticated";
GRANT ALL ON TABLE "public"."prestadora_planes" TO "service_role";



GRANT ALL ON TABLE "public"."prestadoras" TO "anon";
GRANT ALL ON TABLE "public"."prestadoras" TO "authenticated";
GRANT ALL ON TABLE "public"."prestadoras" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."qr_cobro_efectivo" TO "anon";
GRANT ALL ON TABLE "public"."qr_cobro_efectivo" TO "authenticated";
GRANT ALL ON TABLE "public"."qr_cobro_efectivo" TO "service_role";



GRANT ALL ON TABLE "public"."rangos_referencia_vitales" TO "anon";
GRANT ALL ON TABLE "public"."rangos_referencia_vitales" TO "authenticated";
GRANT ALL ON TABLE "public"."rangos_referencia_vitales" TO "service_role";



GRANT ALL ON TABLE "public"."reportes" TO "anon";
GRANT ALL ON TABLE "public"."reportes" TO "authenticated";
GRANT ALL ON TABLE "public"."reportes" TO "service_role";



GRANT ALL ON TABLE "public"."series_guardias" TO "anon";
GRANT ALL ON TABLE "public"."series_guardias" TO "authenticated";
GRANT ALL ON TABLE "public"."series_guardias" TO "service_role";



GRANT ALL ON TABLE "public"."servicios" TO "anon";
GRANT ALL ON TABLE "public"."servicios" TO "authenticated";
GRANT ALL ON TABLE "public"."servicios" TO "service_role";



GRANT ALL ON TABLE "public"."sesiones_tenant_admin_plataforma" TO "anon";
GRANT ALL ON TABLE "public"."sesiones_tenant_admin_plataforma" TO "authenticated";
GRANT ALL ON TABLE "public"."sesiones_tenant_admin_plataforma" TO "service_role";



GRANT ALL ON TABLE "public"."solicitudes" TO "anon";
GRANT ALL ON TABLE "public"."solicitudes" TO "authenticated";
GRANT ALL ON TABLE "public"."solicitudes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."solicitudes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."solicitudes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."solicitudes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."suscripciones_marketplace" TO "anon";
GRANT ALL ON TABLE "public"."suscripciones_marketplace" TO "authenticated";
GRANT ALL ON TABLE "public"."suscripciones_marketplace" TO "service_role";



GRANT ALL ON TABLE "public"."tipos_documento_asistente" TO "anon";
GRANT ALL ON TABLE "public"."tipos_documento_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."tipos_documento_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."tokens_activacion_cuenta" TO "anon";
GRANT ALL ON TABLE "public"."tokens_activacion_cuenta" TO "authenticated";
GRANT ALL ON TABLE "public"."tokens_activacion_cuenta" TO "service_role";



GRANT ALL ON TABLE "public"."uso_ia" TO "anon";
GRANT ALL ON TABLE "public"."uso_ia" TO "authenticated";
GRANT ALL ON TABLE "public"."uso_ia" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios" TO "anon";
GRANT ALL ON TABLE "public"."usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios" TO "service_role";



GRANT ALL ON TABLE "public"."verificaciones_asistente" TO "anon";
GRANT ALL ON TABLE "public"."verificaciones_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."verificaciones_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."zonas_cobertura" TO "anon";
GRANT ALL ON TABLE "public"."zonas_cobertura" TO "authenticated";
GRANT ALL ON TABLE "public"."zonas_cobertura" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































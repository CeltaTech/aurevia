-- Foto de la base entera al 2026-08-19.
--
-- Qué hace: arma desde cero todo el esquema (tablas, columnas, reglas de acceso,
-- funciones, disparadores, restricciones, índices, permisos y enumerados) y siembra
-- las filas del catálogo de la plataforma, que son las que el producto trae de fábrica
-- y sin las cuales el Panel no arranca.
--
-- Por qué existe: reemplaza a las 29 migraciones anteriores, que ya estaban todas
-- aplicadas en producción. Una carpeta de migraciones es la receta para armar la base
-- desde cero, así que no se borran de a una: se saca una foto del resultado y esa foto
-- pasa a ser la única hoja de la receta. Es lo mismo que se hizo el 2026-07-28.
--
-- Se conserva el número 20260819160000 a propósito: es el de la última migración de la
-- tanda, el que producción ya tiene anotado como aplicado.
--
-- Comprobado armando una base vacía desde cero con este archivo y verificando que queda
-- idéntica a la anterior en las nueve dimensiones del esquema y en las filas del catálogo.
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


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






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


CREATE OR REPLACE FUNCTION "public"."asistente_asignado_a_familia"("p_asistente_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM guardias g
    JOIN pacientes p ON p.id = g.paciente_id
    WHERE g.asistente_id = p_asistente_id
      AND p.familia_id = familia_id_de_usuario(auth.uid())
  );
$$;


ALTER FUNCTION "public"."asistente_asignado_a_familia"("p_asistente_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."asistente_asignado_a_familia"("p_asistente_id" "uuid") IS 'Única fuente de verdad para saber si un Asistente atiende a un Paciente de la Familia de la sesión. Va por función y no dentro de la política para no armar un círculo entre asistentes y guardias.';



CREATE OR REPLACE FUNCTION "public"."asistente_atiende_a_la_familia"("p_asistente_id" "uuid", "p_familia_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM guardia_pacientes gp
    JOIN guardias g ON g.id = gp.guardia_id
    JOIN pacientes p ON p.id = gp.paciente_id
    WHERE g.asistente_id = p_asistente_id
      AND p.familia_id = p_familia_id
  )
$$;


ALTER FUNCTION "public"."asistente_atiende_a_la_familia"("p_asistente_id" "uuid", "p_familia_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."asistente_atiende_a_la_familia"("p_asistente_id" "uuid", "p_familia_id" "uuid") IS 'Si un Asistente tiene alguna guardia con algún Paciente de esa Familia.';



CREATE OR REPLACE FUNCTION "public"."bloquear_edicion_laboral_coordinador"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  rol_actual TEXT;
BEGIN
  SELECT rol INTO rol_actual FROM usuarios WHERE id = auth.uid();

  IF rol_actual = 'coordinador' THEN
    IF NEW.tipo_vinculo IS DISTINCT FROM OLD.tipo_vinculo
      OR NEW.horas_semanales IS DISTINCT FROM OLD.horas_semanales
      OR NEW.fecha_baja IS DISTINCT FROM OLD.fecha_baja
    THEN
      RAISE EXCEPTION 'Coordinador no puede modificar datos laborales internos del Asistente (regla 8 de CLAUDE.md)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bloquear_edicion_laboral_coordinador"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consentimiento_seguimiento_vigente"("p_asistente_id" "uuid", "p_clave" "text" DEFAULT 'seguimiento_ubicacion'::"text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM consentimientos_asistente c
    JOIN textos_consentimiento tx ON tx.id = c.texto_consentimiento_id
    WHERE c.asistente_id = p_asistente_id
      AND c.clave = p_clave
      AND c.retirado_at IS NULL
      AND c.decision = 'otorgado'
      AND tx.es_borrador = FALSE
      AND tx.vigente_hasta IS NULL
  );
$$;


ALTER FUNCTION "public"."consentimiento_seguimiento_vigente"("p_asistente_id" "uuid", "p_clave" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."consentimiento_seguimiento_vigente"("p_asistente_id" "uuid", "p_clave" "text") IS 'Pendiente #102. Única fuente de verdad para saber si se puede registrar la ubicación de un Asistente. Devuelve FALSE si no consintió, si lo retiró, si el texto que firmó quedó desactualizado, o si firmó sobre un texto de relleno.';



CREATE OR REPLACE FUNCTION "public"."coordinador_alcanza_guardia"("p_asistente_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT p_asistente_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM usuarios u
        WHERE u.id = auth.uid()
          AND u.zonas && zonas_de_asistente(p_asistente_id)
      );
$$;


ALTER FUNCTION "public"."coordinador_alcanza_guardia"("p_asistente_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."coordinador_alcanza_guardia"("p_asistente_id" "uuid") IS 'Única fuente de verdad para saber si un Coordinador alcanza una guardia. TRUE siempre que la guardia esté sin cubrir; si tiene Asistente, exige zona compartida.';



CREATE OR REPLACE FUNCTION "public"."current_tenant"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT s.prestadora_id FROM sesiones_soporte_tecnico s
      WHERE s.admin_id = auth.uid()
        AND s.salida_at IS NULL
        AND s.expira_at > NOW()
        AND s.ultima_actividad_at > NOW() - INTERVAL '5 minutes'
      ORDER BY s.entrada_at DESC LIMIT 1),
    (SELECT prestadora_id FROM usuarios WHERE id = auth.uid())
  )
$$;


ALTER FUNCTION "public"."current_tenant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dia_en_que_termina_guardia"("p_fecha" "date", "p_hora_inicio" time without time zone, "p_hora_fin" time without time zone) RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE
           WHEN p_hora_fin IS NULL OR p_hora_inicio IS NULL THEN p_fecha
           WHEN p_hora_fin <= p_hora_inicio                 THEN p_fecha + 1
           ELSE p_fecha
         END;
$$;


ALTER FUNCTION "public"."dia_en_que_termina_guardia"("p_fecha" "date", "p_hora_inicio" time without time zone, "p_hora_fin" time without time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."dia_en_que_termina_guardia"("p_fecha" "date", "p_hora_inicio" time without time zone, "p_hora_fin" time without time zone) IS 'El día en que termina una guardia. La de noche cruza la medianoche: 22:00 a 06:00 del 10 termina el 11.';



CREATE OR REPLACE FUNCTION "public"."es_admin_prestadora"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
  );
$$;


ALTER FUNCTION "public"."es_admin_prestadora"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."es_admin_prestadora"() IS 'Verdadero si quien consulta es el administrador de una Prestadora. Única definición: las reglas de acceso la llaman en lugar de repetir la consulta.';



CREATE OR REPLACE FUNCTION "public"."es_asistente"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM asistentes a WHERE a.id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."es_asistente"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."es_asistente"() IS 'Única fuente de verdad para saber si quien tiene la sesión abierta es un Asistente. Va por función y no dentro de la política para no volver a disparar las reglas de la tabla asistentes (recursión infinita).';



CREATE OR REPLACE FUNCTION "public"."es_sesion_soporte_activa"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM sesiones_soporte_tecnico s
      WHERE s.admin_id = auth.uid()
        AND s.salida_at IS NULL
        AND s.expira_at > NOW()
        AND s.ultima_actividad_at > NOW() - INTERVAL '5 minutes'
  )
$$;


ALTER FUNCTION "public"."es_sesion_soporte_activa"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."exigir_matricula_en_guardia"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_motivo text;
BEGIN
  IF NEW.asistente_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.asistente_id IS NOT DISTINCT FROM OLD.asistente_id THEN
    RETURN NEW;
  END IF;

  v_motivo := public.motivo_bloqueo_matricula(
    NEW.asistente_id,
    public.dia_en_que_termina_guardia(NEW.fecha, NEW.hora_inicio, NEW.hora_fin)
  );

  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION 'matricula_bloquea:%:', v_motivo
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."exigir_matricula_en_guardia"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."exigir_matricula_en_oferta"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_motivo text;
  v_dia    date;
BEGIN
  -- Al invitar se mira contra hoy; al aceptar, contra el final de la guardia.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.respuesta IS DISTINCT FROM 'acepta'
       OR NEW.respuesta IS NOT DISTINCT FROM OLD.respuesta THEN
      RETURN NEW;
    END IF;

    SELECT public.dia_en_que_termina_guardia(g.fecha, g.hora_inicio, g.hora_fin)
      INTO v_dia
      FROM public.guardias g
     WHERE g.id = NEW.guardia_id;
  ELSE
    v_dia := CURRENT_DATE;
  END IF;

  v_motivo := public.motivo_bloqueo_matricula(NEW.asistente_id, COALESCE(v_dia, CURRENT_DATE));

  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION 'matricula_bloquea:%:', v_motivo
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."exigir_matricula_en_oferta"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."exigir_paciente_del_turno"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM guardia_pacientes gp
    WHERE gp.guardia_id = NEW.guardia_id AND gp.paciente_id = NEW.paciente_id
  ) THEN
    RAISE EXCEPTION 'El reporte habla de un Paciente que este turno no atiende';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."exigir_paciente_del_turno"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."exigir_paciente_y_servicio_de_la_misma_familia"("p_paciente_id" "uuid", "p_servicio_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  familia_paciente UUID;
  familia_servicio UUID;
BEGIN
  IF p_servicio_id IS NULL THEN
    RETURN;
  END IF;

  SELECT familia_id INTO familia_paciente FROM pacientes WHERE id = p_paciente_id;
  SELECT familia_id INTO familia_servicio FROM servicios WHERE id = p_servicio_id;

  IF familia_paciente IS NULL OR familia_servicio IS NULL OR familia_paciente <> familia_servicio THEN
    RAISE EXCEPTION 'El Servicio indicado no pertenece a la misma Familia que el Paciente';
  END IF;
END;
$$;


ALTER FUNCTION "public"."exigir_paciente_y_servicio_de_la_misma_familia"("p_paciente_id" "uuid", "p_servicio_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."exigir_paciente_y_servicio_de_la_misma_familia"("p_paciente_id" "uuid", "p_servicio_id" "uuid") IS 'La regla de que un Servicio solo factura Pacientes de su propia Familia, escrita una sola vez. La llaman los disparadores de guardias, guardia_pacientes y series_guardias_pacientes.';



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


CREATE OR REPLACE FUNCTION "public"."fn_auditoria_soporte_mutacion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_registro_id UUID;
BEGIN
  IF NOT es_sesion_soporte_activa() THEN
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

  INSERT INTO auditoria_soporte_tecnico (admin_id, prestadora_id, tipo_evento, tabla_afectada, operacion, registro_id)
  VALUES (auth.uid(), current_tenant(), 'mutacion', TG_TABLE_NAME, TG_OP, v_registro_id);

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."fn_auditoria_soporte_mutacion"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."guardias_del_paciente"("p_paciente_id" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT guardia_id FROM guardia_pacientes WHERE paciente_id = p_paciente_id
$$;


ALTER FUNCTION "public"."guardias_del_paciente"("p_paciente_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."guardias_del_paciente"("p_paciente_id" "uuid") IS 'En qué guardias aparece un Paciente. Punto único de verdad de las reglas de acceso.';



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


CREATE OR REPLACE FUNCTION "public"."motivo_bloqueo_matricula"("p_asistente_id" "uuid", "p_dia" "date" DEFAULT CURRENT_DATE) RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_prestadora_id  uuid;
  v_requiere       boolean;
  v_tipo_matricula text;
  v_modo           text;
  v_tiene_alguna   boolean;
  v_vigente        public.matriculas_asistente%ROWTYPE;
BEGIN
  IF p_asistente_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT a.prestadora_id, t.requiere_matricula, t.tipo_matricula
    INTO v_prestadora_id, v_requiere, v_tipo_matricula
    FROM public.asistentes a
    LEFT JOIN public.tipos_asistente t ON t.id = a.tipo_asistente_id
   WHERE a.id = p_asistente_id;

  -- No existe, no tiene tipo cargado, o su tipo no exige matrícula: la regla no
  -- lo alcanza. Ver el encabezado sobre por qué la falta de tipo no bloquea.
  IF v_requiere IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  SELECT p.modo_control_matricula INTO v_modo
    FROM public.prestadoras p
   WHERE p.id = v_prestadora_id;
  v_modo := COALESCE(v_modo, 'estricto');

  -- ¿Tiene alguna matrícula del tipo que su tipo de Asistente exige? Se
  -- pregunta por separado de "¿tiene una vigente?" porque los dos casos se
  -- resuelven distinto: uno hay que pedirlo, el otro hay que renovarlo.
  SELECT EXISTS (
    SELECT 1 FROM public.matriculas_asistente m
     WHERE m.asistente_id = p_asistente_id
       AND m.tipo = v_tipo_matricula
  ) INTO v_tiene_alguna;

  IF NOT v_tiene_alguna THEN
    RETURN 'sin_matricula';
  END IF;

  -- La que está vigente ese día. Si hubiera varias —pasa cuando se carga la
  -- renovación antes de que caiga la anterior— manda la que vence más tarde, y
  -- la que no vence nunca gana siempre.
  SELECT m.* INTO v_vigente
    FROM public.matriculas_asistente m
   WHERE m.asistente_id = p_asistente_id
     AND m.tipo = v_tipo_matricula
     AND (m.vigente_desde IS NULL OR m.vigente_desde <= p_dia)
     AND (m.vigente_hasta IS NULL OR m.vigente_hasta >= p_dia)
   ORDER BY (m.vigente_hasta IS NULL) DESC, m.vigente_hasta DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'vencida';
  END IF;

  -- ACÁ ESTÁ EL CAMBIO. Antes decía solamente `v_modo = 'estricto'`. Ahora la
  -- verificación también se exige cuando la matrícula la subió el propio
  -- Asistente, porque en modo flexible cargarla sería habilitarse solo.
  IF (v_modo = 'estricto' OR v_vigente.cargada_por_el_asistente)
     AND v_vigente.verificada_at IS NULL THEN
    RETURN 'sin_verificar';
  END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."motivo_bloqueo_matricula"("p_asistente_id" "uuid", "p_dia" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."motivo_bloqueo_matricula"("p_asistente_id" "uuid", "p_dia" "date") IS 'Punto único de verdad de la regla dura de matrícula. NULL = ese día puede trabajar. Si no: sin_matricula, vencida o sin_verificar. Devuelve la palabra, nunca el texto: la traducción vive en el Panel.';



CREATE OR REPLACE FUNCTION "public"."pacientes_de_la_guardia"("p_guardia_id" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT paciente_id FROM guardia_pacientes WHERE guardia_id = p_guardia_id
$$;


ALTER FUNCTION "public"."pacientes_de_la_guardia"("p_guardia_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."pacientes_de_la_guardia"("p_guardia_id" "uuid") IS 'A quiénes atiende una guardia. Punto único de verdad de las reglas de acceso (CLAUDE.md §7 regla 12).';



CREATE OR REPLACE FUNCTION "public"."pacientes_de_la_serie"("p_serie_id" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT paciente_id FROM series_guardias_pacientes WHERE serie_id = p_serie_id
$$;


ALTER FUNCTION "public"."pacientes_de_la_serie"("p_serie_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."pacientes_de_la_serie"("p_serie_id" "uuid") IS 'A quiénes atiende una serie de guardias. Punto único de verdad de las reglas de acceso.';



CREATE OR REPLACE FUNCTION "public"."permisos_efectivos_de"("p_usuario" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(jsonb_object_agg(c.accion, tiene_permiso_de(p_usuario, c.accion)), '{}'::JSONB)
  FROM catalogo_acciones_permisos c;
$$;


ALTER FUNCTION "public"."permisos_efectivos_de"("p_usuario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prestadora_oculta_marca_producto"("p_prestadora_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM prestadora_modulos pm
    WHERE pm.prestadora_id = p_prestadora_id
      AND pm.modulo_key = 'aurevia.marca.personalizada'
      AND pm.activo
  )
$$;


ALTER FUNCTION "public"."prestadora_oculta_marca_producto"("p_prestadora_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prestadora_oculta_marca_producto"("p_prestadora_id" "uuid") IS 'Devuelve verdadero solo si esa Prestadora tiene contratada la función que apaga la línea del producto al pie. Ausente = no contratada = la línea se muestra.';



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


CREATE OR REPLACE FUNCTION "public"."sincronizar_paciente_principal_de_guardia"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.paciente_id IS DISTINCT FROM NEW.paciente_id THEN
    DELETE FROM guardia_pacientes
    WHERE guardia_id = NEW.id AND paciente_id = OLD.paciente_id;
  END IF;

  IF NEW.paciente_id IS NOT NULL THEN
    INSERT INTO guardia_pacientes (guardia_id, paciente_id, prestadora_id)
    VALUES (NEW.id, NEW.paciente_id, NEW.prestadora_id)
    ON CONFLICT (guardia_id, paciente_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sincronizar_paciente_principal_de_guardia"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sincronizar_paciente_principal_de_guardia"() IS 'Puente temporal: mantiene en guardia_pacientes al Paciente escrito en la columna vieja guardias.paciente_id. Se borra junto con esa columna.';



CREATE OR REPLACE FUNCTION "public"."sincronizar_paciente_principal_de_serie"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.paciente_id IS DISTINCT FROM NEW.paciente_id THEN
    DELETE FROM series_guardias_pacientes
    WHERE serie_id = NEW.id AND paciente_id = OLD.paciente_id;
  END IF;

  IF NEW.paciente_id IS NOT NULL THEN
    INSERT INTO series_guardias_pacientes (serie_id, paciente_id, prestadora_id)
    VALUES (NEW.id, NEW.paciente_id, NEW.prestadora_id)
    ON CONFLICT (serie_id, paciente_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sincronizar_paciente_principal_de_serie"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sincronizar_paciente_principal_de_serie"() IS 'Puente temporal: mantiene en series_guardias_pacientes al Paciente escrito en la columna vieja series_guardias.paciente_id. Se borra junto con esa columna.';



CREATE OR REPLACE FUNCTION "public"."tiene_permiso"("p_accion" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT tiene_permiso_de(auth.uid(), p_accion);
$$;


ALTER FUNCTION "public"."tiene_permiso"("p_accion" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tiene_permiso_de"("p_usuario" "uuid", "p_accion" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_rol           TEXT;
  v_prestadora_id UUID;
  v_cfg           permisos_prestadora;
  v_solo_admin    BOOLEAN;
BEGIN
  SELECT rol, prestadora_id INTO v_rol, v_prestadora_id FROM usuarios WHERE id = p_usuario;

  IF v_rol IN ('admin_prestadora', 'superadmin') THEN
    RETURN TRUE;
  END IF;
  IF v_rol IS DISTINCT FROM 'coordinador' THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_cfg FROM permisos_prestadora
    WHERE prestadora_id = v_prestadora_id AND accion = p_accion;

  -- La Prestadora no configuró nada para esta acción: manda el valor por defecto del
  -- catálogo. Si la acción ni siquiera está en el catálogo, la respuesta es que no: un
  -- nombre mal escrito no puede terminar abriendo un permiso.
  IF NOT FOUND THEN
    SELECT default_solo_admin INTO v_solo_admin
      FROM catalogo_acciones_permisos WHERE accion = p_accion;
    RETURN NOT COALESCE(v_solo_admin, TRUE);
  END IF;

  IF p_usuario = ANY(v_cfg.excepciones_denegar)  THEN RETURN FALSE; END IF;
  IF p_usuario = ANY(v_cfg.excepciones_permitir) THEN RETURN TRUE;  END IF;
  RETURN v_cfg.alcance = 'admin_y_coordinador';
END;
$$;


ALTER FUNCTION "public"."tiene_permiso_de"("p_usuario" "uuid", "p_accion" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."tiene_permiso_de"("p_usuario" "uuid", "p_accion" "text") IS 'Si un usuario tiene permitida una acción. Único lugar donde está programada esa decisión: la usan las reglas de acceso de la base y también el motor (pendiente #127).';



CREATE OR REPLACE FUNCTION "public"."validar_paciente_de_guardia_misma_familia"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  servicio UUID;
BEGIN
  SELECT servicio_id INTO servicio FROM guardias WHERE id = NEW.guardia_id;
  PERFORM exigir_paciente_y_servicio_de_la_misma_familia(NEW.paciente_id, servicio);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_paciente_de_guardia_misma_familia"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_paciente_de_serie_misma_familia"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  familia_de_la_serie UUID;
  familia_del_paciente UUID;
BEGIN
  SELECT p.familia_id INTO familia_de_la_serie
    FROM series_guardias s JOIN pacientes p ON p.id = s.paciente_id
   WHERE s.id = NEW.serie_id;

  SELECT familia_id INTO familia_del_paciente FROM pacientes WHERE id = NEW.paciente_id;

  IF familia_de_la_serie IS NULL OR familia_del_paciente IS NULL
     OR familia_de_la_serie <> familia_del_paciente THEN
    RAISE EXCEPTION 'Todos los Pacientes de una serie tienen que ser de la misma Familia';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_paciente_de_serie_misma_familia"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_servicio_misma_familia"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM exigir_paciente_y_servicio_de_la_misma_familia(NEW.paciente_id, NEW.servicio_id);
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
    "fecha_alta" "date" DEFAULT CURRENT_DATE NOT NULL,
    "fecha_baja" "date",
    "horas_semanales" numeric(5,2),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "dni" "text",
    "prestadora_id" "uuid" NOT NULL,
    "canales" "text"[] DEFAULT ARRAY['directo'::"text", 'marketplace'::"text"] NOT NULL,
    "importacion_id" "uuid",
    "pendiente_conformidad" boolean DEFAULT false NOT NULL,
    "tipo_asistente_id" "uuid",
    CONSTRAINT "asistentes_canales_valido" CHECK ((("canales" <@ ARRAY['directo'::"text", 'marketplace'::"text"]) AND ("array_length"("canales", 1) > 0))),
    CONSTRAINT "asistentes_estado_check" CHECK (("estado" = ANY (ARRAY['activo'::"text", 'inactivo'::"text", 'cesado'::"text"]))),
    CONSTRAINT "asistentes_tipo_vinculo_check" CHECK (("tipo_vinculo" = ANY (ARRAY['monotributo'::"text", 'dependencia'::"text"])))
);


ALTER TABLE "public"."asistentes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."asistentes"."especialidades" IS 'RETIRADA (2026-08-11). Texto libre de la época en que el tipo de Asistente se escribia a mano. Se conserva tal cual se cargo; no se escribe mas. Lo vigente es asistentes.tipo_asistente_id, que apunta al catalogo tipos_asistente.';



COMMENT ON COLUMN "public"."asistentes"."tipo_asistente_id" IS 'Que ES este Asistente: cuidador/a, enfermero/a, kinesiologo/a, medico/a o el tipo que haya creado su Prestadora. Decide sus Tareas y si se le exige Matricula vigente para atender.';



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
    "dni",
    "tipo_asistente_id"
   FROM "public"."asistentes";


ALTER VIEW "public"."asistentes_coordinador" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."auditoria_soporte_tecnico" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid" NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "tipo_evento" "text" NOT NULL,
    "tabla_afectada" "text",
    "operacion" "text",
    "registro_id" "uuid",
    "detalle" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auditoria_soporte_tecnico_operacion_check" CHECK (("operacion" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text"]))),
    CONSTRAINT "auditoria_soporte_tecnico_tipo_evento_check" CHECK (("tipo_evento" = ANY (ARRAY['login'::"text", 'logout'::"text", 'renovacion'::"text", 'mutacion'::"text"])))
);


ALTER TABLE "public"."auditoria_soporte_tecnico" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."catalogo_acciones_permisos" (
    "accion" "text" NOT NULL,
    "default_solo_admin" boolean NOT NULL,
    "orden" smallint NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."catalogo_acciones_permisos" OWNER TO "postgres";


COMMENT ON TABLE "public"."catalogo_acciones_permisos" IS 'Las acciones que una Prestadora puede reservar al administrador, y qué pasa cuando no configuró nada. Punto único de verdad del valor por defecto (pendiente #127).';



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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reportes_a_analizar" integer DEFAULT 7 NOT NULL,
    "roja_avisa_familia" boolean DEFAULT true NOT NULL,
    "amarilla_avisa_familia" boolean DEFAULT false NOT NULL,
    "amarilla_avisa_coordinador" boolean DEFAULT true NOT NULL,
    CONSTRAINT "configuracion_alertas_ia_reportes_a_analizar_check" CHECK ((("reportes_a_analizar" >= 1) AND ("reportes_a_analizar" <= 30)))
);


ALTER TABLE "public"."configuracion_alertas_ia" OWNER TO "postgres";


COMMENT ON TABLE "public"."configuracion_alertas_ia" IS 'Cómo revisa esta Prestadora los reportes de sus Pacientes con inteligencia artificial: qué palabras adelantan la revisión, cuánto material mira y a quién le avisa según lo que encuentra. Sin fila, valen los valores de fábrica que están en backend/src/routes/panelConfiguracion.js.';



COMMENT ON COLUMN "public"."configuracion_alertas_ia"."palabras_clave" IS 'Palabras que, si aparecen en un reporte, disparan la revisión en el momento en vez de esperar al horario de siempre (por ejemplo: caída, sangrado, no responde). Las lee backend/src/routes/appAsistentes.js al recibir el reporte.';



COMMENT ON COLUMN "public"."configuracion_alertas_ia"."reportes_a_analizar" IS 'Cuántos de los últimos reportes de ese Paciente mira la revisión. De fábrica, 7. Cuantos más mire, más contexto tiene y más cuesta cada revisión.';



COMMENT ON COLUMN "public"."configuracion_alertas_ia"."roja_avisa_familia" IS 'Si una alerta roja —lo urgente— también le llega a la Familia del Paciente. De fábrica, sí. Al Coordinador le llega siempre, eso no se configura.';



COMMENT ON COLUMN "public"."configuracion_alertas_ia"."amarilla_avisa_familia" IS 'Si una alerta amarilla —lo que conviene mirar, sin urgencia— también le llega a la Familia. De fábrica, no: la amarilla es material de trabajo de la Prestadora, no una noticia para dar.';



COMMENT ON COLUMN "public"."configuracion_alertas_ia"."amarilla_avisa_coordinador" IS 'Si una alerta amarilla le llega al Coordinador. De fábrica, sí. Se puede apagar en una Prestadora que prefiera revisarlas por pantalla en vez de recibirlas de a una.';



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


CREATE TABLE IF NOT EXISTS "public"."configuracion_aviso_guardia_sin_cubrir" (
    "prestadora_id" "uuid" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "horas_antes" smallint DEFAULT 48 NOT NULL,
    "horas_entre_avisos" smallint DEFAULT 12 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "configuracion_aviso_guardia_sin_cubrir_horas_antes_check" CHECK ((("horas_antes" > 0) AND ("horas_antes" <= 720))),
    CONSTRAINT "configuracion_aviso_guardia_sin_cubrir_horas_entre_avisos_check" CHECK ((("horas_entre_avisos" > 0) AND ("horas_entre_avisos" <= 720)))
);


ALTER TABLE "public"."configuracion_aviso_guardia_sin_cubrir" OWNER TO "postgres";


COMMENT ON TABLE "public"."configuracion_aviso_guardia_sin_cubrir" IS 'Cuándo avisarle al Coordinador que una guardia próxima sigue sin Asistente. Una fila por Prestadora; sin fila no se manda ningún aviso.';



COMMENT ON COLUMN "public"."configuracion_aviso_guardia_sin_cubrir"."horas_antes" IS 'Con cuánta anticipación avisar. El aviso arranca cuando faltan estas horas para que empiece la guardia.';



COMMENT ON COLUMN "public"."configuracion_aviso_guardia_sin_cubrir"."horas_entre_avisos" IS 'Cada cuánto repetir el aviso mientras el hueco siga abierto. Evita que el proceso, que corre cada 5 minutos, mande el mismo correo doce veces por hora.';



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


CREATE TABLE IF NOT EXISTS "public"."configuracion_matricula_via_medicacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "via_administracion" "text" NOT NULL,
    "tipo_matricula_requerida" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."configuracion_matricula_via_medicacion" OWNER TO "postgres";


COMMENT ON TABLE "public"."configuracion_matricula_via_medicacion" IS 'Qué matrícula exige cada vía de administración de medicación, por Prestadora. Ejemplo: los inyectables piden matrícula de enfermería.';



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


COMMENT ON COLUMN "public"."configuracion_notificaciones"."descripcion" IS 'Texto histórico, en español, de cuando la lista de avisos vivía en esta tabla. El Panel ya no lo muestra: el nombre y la explicación de cada aviso salen traducidos de panel/src/i18n/translations.js, y la lista de avisos que existen es la de backend/src/utils/catalogoAvisos.js. Se conserva como respaldo por si llegara una fila de un aviso que el catálogo no conoce.';



CREATE TABLE IF NOT EXISTS "public"."configuracion_plataforma" (
    "id" boolean DEFAULT true NOT NULL,
    "mfa_admin_obligatorio" boolean DEFAULT false NOT NULL,
    "actualizado_por" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
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


CREATE TABLE IF NOT EXISTS "public"."configuracion_visibilidad_app" (
    "prestadora_id" "uuid" NOT NULL,
    "clave" "text" NOT NULL,
    "visible" boolean NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."configuracion_visibilidad_app" OWNER TO "postgres";


COMMENT ON TABLE "public"."configuracion_visibilidad_app" IS 'Qué muestran las aplicaciones de la Familia y del Asistente en cada Prestadora. Solo guarda lo que se cambió respecto del valor de fábrica; la lista de claves posibles vive en backend/src/utils/catalogoVisibilidad.js.';



COMMENT ON COLUMN "public"."configuracion_visibilidad_app"."clave" IS 'Identificador permanente de la cosa que se prende o se apaga. Nombrado por su función, nunca por la pantalla donde aparece hoy, y no se renombra jamás (CLAUDE.md §7 regla 13).';



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


CREATE TABLE IF NOT EXISTS "public"."consentimientos_asistente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "clave" "text" NOT NULL,
    "texto_consentimiento_id" "uuid" NOT NULL,
    "version_mostrada" integer NOT NULL,
    "idioma_mostrado" "text" NOT NULL,
    "texto_mostrado" "text" NOT NULL,
    "decision" "text" NOT NULL,
    "decidido_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "retirado_at" timestamp with time zone,
    "motivo_retiro" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "consentimientos_asistente_decision_check" CHECK (("decision" = ANY (ARRAY['otorgado'::"text", 'rechazado'::"text"]))),
    CONSTRAINT "consentimientos_asistente_retiro_coherente" CHECK ((("retirado_at" IS NULL) OR ("decision" = 'otorgado'::"text")))
);


ALTER TABLE "public"."consentimientos_asistente" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."datos_reservados_asistente" (
    "asistente_id" "uuid" NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "causal_baja" "text",
    "score_riesgo_reclasificacion" integer DEFAULT 0 NOT NULL,
    "indicadores_riesgo" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "motivo_exclusion_directo" "text",
    "motivo_exclusion_marketplace" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "datos_reservados_asistente_score_riesgo_reclasificacion_check" CHECK ((("score_riesgo_reclasificacion" >= 0) AND ("score_riesgo_reclasificacion" <= 100)))
);


ALTER TABLE "public"."datos_reservados_asistente" OWNER TO "postgres";


COMMENT ON TABLE "public"."datos_reservados_asistente" IS 'Lo reservado de la ficha del Asistente: por qué se lo dio de baja, su puntaje de riesgo con los motivos que lo forman, y por qué quedó excluido de recibir trabajo. Vive separado de `asistentes` porque las reglas de acceso de la base filtran filas, no columnas: solo en una tabla propia se puede exigir el permiso `ver_datos_reservados_asistente` para leerlo.';



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


CREATE TABLE IF NOT EXISTS "public"."matriculas_asistente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "numero_matricula" "text",
    "vigente_desde" "date" NOT NULL,
    "vigente_hasta" "date",
    "archivo_url" "text",
    "registrado_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "verificada_at" timestamp with time zone,
    "verificada_por" "uuid",
    "metodo_verificacion" "text",
    "nota_verificacion" "text",
    "cargada_por_el_asistente" boolean DEFAULT false NOT NULL,
    CONSTRAINT "matriculas_asistente_metodo_verificacion_valido" CHECK ((("metodo_verificacion" IS NULL) OR ("metodo_verificacion" = ANY (ARRAY['documento_a_la_vista'::"text", 'constancia_del_organismo'::"text", 'registro_oficial_en_linea'::"text"])))),
    CONSTRAINT "matriculas_asistente_verificacion_completa" CHECK (((("verificada_at" IS NULL) AND ("verificada_por" IS NULL) AND ("metodo_verificacion" IS NULL)) OR (("verificada_at" IS NOT NULL) AND ("verificada_por" IS NOT NULL) AND ("metodo_verificacion" IS NOT NULL))))
);


ALTER TABLE "public"."matriculas_asistente" OWNER TO "postgres";


COMMENT ON TABLE "public"."matriculas_asistente" IS 'El papel que autoriza legalmente a un Asistente a ejercer: número, vigencia y archivo. No guarda tareas ni tipo de Asistente — son otras tres cosas.';



COMMENT ON COLUMN "public"."matriculas_asistente"."verificada_at" IS 'Cuándo se verificó. Mientras esté vacía, la matrícula está cargada pero no aprobada, y el Asistente sigue bloqueado.';



COMMENT ON COLUMN "public"."matriculas_asistente"."verificada_por" IS 'Quién la verificó. Es una persona con nombre, no "el sistema": si mañana se descubre que una matrícula no era válida, tiene que saberse quién la dio por buena.';



COMMENT ON COLUMN "public"."matriculas_asistente"."metodo_verificacion" IS 'Por qué medio se verificó. Existe por el pendiente #107: si la ley termina exigiendo comprobación contra el registro oficial, esta columna dice cuáles hay que volver a mirar.';



COMMENT ON COLUMN "public"."matriculas_asistente"."nota_verificacion" IS 'Aclaración libre de quien verificó. Para el caso raro que no entra en ninguna de las tres formas.';



COMMENT ON COLUMN "public"."matriculas_asistente"."cargada_por_el_asistente" IS 'Verdadero si la subió el propio Asistente desde su aplicación. Esas siempre necesitan verificación, aunque la Prestadora esté en modo flexible: el interesado no se aprueba a sí mismo.';



CREATE TABLE IF NOT EXISTS "public"."prestadoras" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "razon_social" "text" NOT NULL,
    "nombre_fantasia" "text" NOT NULL,
    "identificacion_fiscal" "text",
    "pais" "text" DEFAULT 'AR'::"text" NOT NULL,
    "estado" "public"."estado_prestadora" DEFAULT 'prospecto'::"public"."estado_prestadora" NOT NULL,
    "zonas_operacion" "text"[],
    "fecha_alta" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "dias_aviso_vencimiento_documentos" smallint DEFAULT 30 NOT NULL,
    "dias_generacion_series_guardia" smallint DEFAULT 90 NOT NULL,
    "politica_verificacion_alta_manual" "text" DEFAULT 'omitir'::"text" NOT NULL,
    "modo_control_matricula" "text" DEFAULT 'estricto'::"text" NOT NULL,
    "logo_url" "text",
    "minutos_aviso_previo_guardia" integer DEFAULT 60 NOT NULL,
    CONSTRAINT "prestadoras_minutos_aviso_previo_guardia_check" CHECK ((("minutos_aviso_previo_guardia" >= 5) AND ("minutos_aviso_previo_guardia" <= 1440))),
    CONSTRAINT "prestadoras_modo_control_matricula_check" CHECK (("modo_control_matricula" = ANY (ARRAY['estricto'::"text", 'flexible'::"text"]))),
    CONSTRAINT "prestadoras_politica_verificacion_alta_manual_check" CHECK (("politica_verificacion_alta_manual" = ANY (ARRAY['omitir'::"text", 'pendiente'::"text", 'aprobado'::"text"])))
);


ALTER TABLE "public"."prestadoras" OWNER TO "postgres";


COMMENT ON COLUMN "public"."prestadoras"."modo_control_matricula" IS 'Si para trabajar hace falta que la matrícula esté verificada (estricto) o alcanza con que esté cargada y vigente (flexible). Lo lee una sola función: motivo_bloqueo_matricula().';



COMMENT ON COLUMN "public"."prestadoras"."logo_url" IS 'Dirección del logo de la Prestadora, la marca que ven la Familia y el Asistente. Vacío significa que todavía no lo subió: en ese caso las pantallas muestran nombre_fantasia escrito. Los archivos viven en el depósito marca-prestadoras, en la carpeta de esa Prestadora.';



COMMENT ON COLUMN "public"."prestadoras"."minutos_aviso_previo_guardia" IS 'Cuántos minutos antes de que empiece la guardia se le manda el recordatorio al Asistente. De fábrica, 60. El tope es un día entero; menos de cinco minutos no llegaría a tiempo de servir para nada.';



CREATE TABLE IF NOT EXISTS "public"."tipos_asistente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid",
    "clave" "text",
    "nombre" "text",
    "descripcion" "text",
    "requiere_matricula" boolean DEFAULT false NOT NULL,
    "tipo_matricula" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "orden" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tipos_asistente_matricula_con_tipo" CHECK ((("requiere_matricula" = false) OR ("tipo_matricula" IS NOT NULL))),
    CONSTRAINT "tipos_asistente_nombre_segun_nivel" CHECK (((("prestadora_id" IS NULL) AND ("clave" IS NOT NULL) AND ("nombre" IS NULL)) OR (("prestadora_id" IS NOT NULL) AND ("clave" IS NULL) AND ("nombre" IS NOT NULL))))
);


ALTER TABLE "public"."tipos_asistente" OWNER TO "postgres";


COMMENT ON TABLE "public"."tipos_asistente" IS 'Qué ES un Asistente: cuidador/a, enfermero/a, kinesiólogo/a, médico/a y los que agregue cada Prestadora. Distinto de sus Tareas (qué hace) y de su Matrícula (qué lo autoriza).';



COMMENT ON COLUMN "public"."tipos_asistente"."prestadora_id" IS 'NULL = tipo general de CeltaTech, lo ven todas las Prestadoras y ninguna lo puede tocar. Con dato = lo creó esa Prestadora y solo lo ve ella.';



COMMENT ON COLUMN "public"."tipos_asistente"."clave" IS 'Solo para los tipos generales. El nombre visible sale de los archivos de traducción, buscándolo por esta clave, para que el Panel en inglés no muestre "enfermero".';



COMMENT ON COLUMN "public"."tipos_asistente"."nombre" IS 'Solo para los tipos que crea una Prestadora. Es información suya, escrita por ella, y no se traduce.';



COMMENT ON COLUMN "public"."tipos_asistente"."requiere_matricula" IS 'Si está en verdadero, un Asistente de este tipo sin matrícula cargada, vigente y verificada no puede atender a ningún Paciente.';



COMMENT ON COLUMN "public"."tipos_asistente"."tipo_matricula" IS 'Qué matrícula exige. Se compara contra matriculas_asistente.tipo y contra configuracion_matricula_via_medicacion.tipo_matricula_requerida — los tres tienen que hablar el mismo idioma o la regla no engancha.';



CREATE OR REPLACE VIEW "public"."estado_matricula_asistente" WITH ("security_invoker"='true') AS
 SELECT "a"."id" AS "asistente_id",
    "a"."prestadora_id",
    "a"."nombre",
    "a"."tipo_asistente_id",
    "t"."requiere_matricula",
    "t"."tipo_matricula",
    "p"."modo_control_matricula",
    "public"."motivo_bloqueo_matricula"("a"."id") AS "motivo_bloqueo",
    "m"."id" AS "matricula_id",
    "m"."vigente_hasta",
    "m"."verificada_at",
        CASE
            WHEN ("m"."vigente_hasta" IS NULL) THEN NULL::integer
            ELSE ("m"."vigente_hasta" - CURRENT_DATE)
        END AS "dias_para_vencer"
   FROM ((("public"."asistentes" "a"
     JOIN "public"."prestadoras" "p" ON (("p"."id" = "a"."prestadora_id")))
     LEFT JOIN "public"."tipos_asistente" "t" ON (("t"."id" = "a"."tipo_asistente_id")))
     LEFT JOIN LATERAL ( SELECT "mm"."id",
            "mm"."asistente_id",
            "mm"."tipo",
            "mm"."numero_matricula",
            "mm"."vigente_desde",
            "mm"."vigente_hasta",
            "mm"."archivo_url",
            "mm"."registrado_por",
            "mm"."created_at",
            "mm"."verificada_at",
            "mm"."verificada_por",
            "mm"."metodo_verificacion",
            "mm"."nota_verificacion"
           FROM "public"."matriculas_asistente" "mm"
          WHERE (("mm"."asistente_id" = "a"."id") AND ("mm"."tipo" = "t"."tipo_matricula") AND (("mm"."vigente_desde" IS NULL) OR ("mm"."vigente_desde" <= CURRENT_DATE)))
          ORDER BY ("mm"."vigente_hasta" IS NULL) DESC, "mm"."vigente_hasta" DESC
         LIMIT 1) "m" ON (true))
  WHERE ("a"."deleted_at" IS NULL);


ALTER VIEW "public"."estado_matricula_asistente" OWNER TO "postgres";


COMMENT ON VIEW "public"."estado_matricula_asistente" IS 'Cómo está la matrícula de cada Asistente, ya resuelta: si le hace falta, si está bloqueado hoy y por qué, cuándo vence, cuántos días faltan y si su Prestadora exige verificación. La consultan el Estado actual de la Prestadora, el panel para cubrir una vacante y la aplicación del Asistente, para que ninguno vuelva a escribir la regla por su cuenta.';



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


CREATE TABLE IF NOT EXISTS "public"."guardia_pacientes" (
    "guardia_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."guardia_pacientes" OWNER TO "postgres";


COMMENT ON TABLE "public"."guardia_pacientes" IS 'A quiénes atiende una guardia. Una fila por Paciente. Una guardia puede tener varias: un matrimonio en su casa, o todo un piso de un asilo.';



CREATE TABLE IF NOT EXISTS "public"."guardias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "asistente_id" "uuid",
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
    "ofrecida_at" timestamp with time zone,
    "ofrecida_por" "uuid",
    "oferta_limite_at" timestamp with time zone,
    "aviso_sin_cubrir_at" timestamp with time zone,
    "aviso_sin_cubrir_veces" smallint DEFAULT 0 NOT NULL,
    CONSTRAINT "guardias_canal_modalidad_check" CHECK (("canal_modalidad" = ANY (ARRAY['directa'::"text", 'marketplace'::"text", 'subcontratacion'::"text"]))),
    CONSTRAINT "guardias_cancelacion_alcance_check" CHECK (("cancelacion_alcance" = ANY (ARRAY['parcial'::"text", 'total'::"text"]))),
    CONSTRAINT "guardias_cancelacion_check" CHECK ((("estado" = 'cancelada'::"text") OR (("cancelacion_origen" IS NULL) AND ("cancelacion_alcance" IS NULL)))),
    CONSTRAINT "guardias_cancelacion_origen_check" CHECK (("cancelacion_origen" = ANY (ARRAY['familia'::"text", 'prestadora'::"text"]))),
    CONSTRAINT "guardias_checkout_bloqueado_requiere_excepcion" CHECK ((("checkout_at" IS NULL) OR (NOT "checkout_bloqueado") OR (("checkout_excepcion_motivo" IS NOT NULL) AND ("checkout_excepcion_autorizado_por" IS NOT NULL) AND ("checkout_excepcion_at" IS NOT NULL)))),
    CONSTRAINT "guardias_estado_check" CHECK (("estado" = ANY (ARRAY['programada'::"text", 'activa'::"text", 'completada'::"text", 'cancelada'::"text", 'ausente'::"text", 'pausada'::"text"]))),
    CONSTRAINT "guardias_limite_solo_si_ofrecida_check" CHECK ((("oferta_limite_at" IS NULL) OR ("ofrecida_at" IS NOT NULL))),
    CONSTRAINT "guardias_ofrecida_solo_sin_cubrir_check" CHECK ((("ofrecida_at" IS NULL) OR ("asistente_id" IS NULL))),
    CONSTRAINT "guardias_sin_cubrir_estado_check" CHECK ((("asistente_id" IS NOT NULL) OR ("estado" = ANY (ARRAY['programada'::"text", 'cancelada'::"text"])))),
    CONSTRAINT "guardias_sin_cubrir_sin_marcas_check" CHECK ((("asistente_id" IS NOT NULL) OR (("checkin_at" IS NULL) AND ("checkout_at" IS NULL) AND ("salida_checkin_at" IS NULL))))
);


ALTER TABLE "public"."guardias" OWNER TO "postgres";


COMMENT ON COLUMN "public"."guardias"."asistente_id" IS 'NULL = guardia sin cubrir. Es un estado normal y esperado, no un dato faltante.';



COMMENT ON COLUMN "public"."guardias"."paciente_id" IS 'EN RETIRO. Guarda a uno solo de los Pacientes de la guardia, el primero. La lista completa vive en guardia_pacientes. Sigue acá únicamente para que las pantallas todavía sin actualizar no se rompan; se elimina cuando ninguna la lea.';



COMMENT ON COLUMN "public"."guardias"."ofrecida_at" IS 'Fecha en que la guardia se publicó como disponible para los Asistentes. NULL = no publicada.';



COMMENT ON COLUMN "public"."guardias"."ofrecida_por" IS 'Usuario del Panel que la publicó.';



COMMENT ON COLUMN "public"."guardias"."oferta_limite_at" IS 'Fecha y hora hasta la que se espera respuesta de los Asistentes invitados. NULL = se publicó sin plazo.';



COMMENT ON COLUMN "public"."guardias"."aviso_sin_cubrir_at" IS 'Última vez que se le avisó al Coordinador que esta guardia sigue sin cubrir. NULL = nunca se avisó.';



COMMENT ON COLUMN "public"."guardias"."aviso_sin_cubrir_veces" IS 'Cuántas veces se avisó. Sirve para que el aviso repetido diga que ya es la tercera vez, no para decidir si mandarlo.';



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


CREATE TABLE IF NOT EXISTS "public"."ofertas_guardia" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "guardia_id" "uuid" NOT NULL,
    "asistente_id" "uuid" NOT NULL,
    "invitado_por" "uuid",
    "invitado_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "respuesta" "text",
    "respuesta_at" timestamp with time zone,
    "motivo" "text",
    CONSTRAINT "ofertas_guardia_respuesta_check" CHECK (("respuesta" = ANY (ARRAY['acepta'::"text", 'rechaza'::"text"]))),
    CONSTRAINT "ofertas_guardia_respuesta_completa_check" CHECK ((("respuesta" IS NULL) = ("respuesta_at" IS NULL)))
);


ALTER TABLE "public"."ofertas_guardia" OWNER TO "postgres";


COMMENT ON TABLE "public"."ofertas_guardia" IS 'Invitaciones a tomar una guardia sin cubrir. Una fila por Asistente invitado, con su respuesta individual.';



COMMENT ON COLUMN "public"."ofertas_guardia"."respuesta" IS 'NULL = todavía no contestó. Es distinto de "rechaza", y esa diferencia es la que mira el mostrador.';



COMMENT ON COLUMN "public"."ofertas_guardia"."motivo" IS 'Lo que el Asistente escribió al rechazar. Opcional.';



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
    CONSTRAINT "prestadora_modalidades_modalidad_check" CHECK (("modalidad" = ANY (ARRAY['directa'::"text", 'marketplace'::"text", 'subcontratacion'::"text"])))
);


ALTER TABLE "public"."prestadora_modalidades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prestadora_modulos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "modulo_key" "text" NOT NULL,
    "origen" "text" DEFAULT 'celtatech'::"text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "version" bigint,
    "sincronizado_at" timestamp with time zone,
    CONSTRAINT "prestadora_modulos_origen_check" CHECK (("origen" = ANY (ARRAY['celtatech'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."prestadora_modulos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."prestadora_modulos"."origen" IS 'celtatech = lo mando la empresa; manual = lo prendio un tecnico a mano, temporalmente.';



COMMENT ON COLUMN "public"."prestadora_modulos"."version" IS 'Numero de version que trae CeltaTech con cada actualizacion. Sirve para no pisar una copia nueva con una vieja que llego tarde.';



COMMENT ON COLUMN "public"."prestadora_modulos"."sincronizado_at" IS 'Cuando se recibio esta fila de CeltaTech por ultima vez. Si esta muy vieja, la copia local dejo de ser confiable.';



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


CREATE TABLE IF NOT EXISTS "public"."remuneraciones_asistente" (
    "asistente_id" "uuid" NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "valor_hora" numeric(12,2),
    "sueldo_basico" numeric(12,2),
    "categoria_cct" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."remuneraciones_asistente" OWNER TO "postgres";


COMMENT ON TABLE "public"."remuneraciones_asistente" IS 'Lo que cobra cada Asistente. Vive separado de `asistentes` porque las reglas de acceso de la base filtran filas, no columnas: solo en una tabla propia se puede exigir el permiso `ver_pagos_asistente` para leerlo.';



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
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paciente_id" "uuid" NOT NULL
);


ALTER TABLE "public"."reportes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."reportes"."paciente_id" IS 'De qué Paciente habla este reporte. Un turno que cubre a varios tiene un reporte por cada uno.';



CREATE TABLE IF NOT EXISTS "public"."series_guardias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "asistente_id" "uuid",
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
    CONSTRAINT "series_guardias_canal_modalidad_check" CHECK (("canal_modalidad" = ANY (ARRAY['directa'::"text", 'marketplace'::"text", 'subcontratacion'::"text"]))),
    CONSTRAINT "series_guardias_cancelacion_check" CHECK ((("estado" = 'cancelada'::"text") OR (("cancelacion_origen" IS NULL) AND ("cancelado_at" IS NULL)))),
    CONSTRAINT "series_guardias_cancelacion_origen_check" CHECK (("cancelacion_origen" = ANY (ARRAY['familia'::"text", 'prestadora'::"text"]))),
    CONSTRAINT "series_guardias_estado_check" CHECK (("estado" = ANY (ARRAY['activa'::"text", 'cancelada'::"text", 'pausada'::"text"])))
);


ALTER TABLE "public"."series_guardias" OWNER TO "postgres";


COMMENT ON COLUMN "public"."series_guardias"."asistente_id" IS 'NULL = serie sin Asistente fijo. Las guardias que genera nacen sin cubrir.';



COMMENT ON COLUMN "public"."series_guardias"."paciente_id" IS 'EN RETIRO. Guarda a uno solo de los Pacientes de la serie, el primero. La lista completa vive en series_guardias_pacientes. Sigue acá únicamente para que las pantallas todavía sin actualizar no se rompan.';



CREATE TABLE IF NOT EXISTS "public"."series_guardias_pacientes" (
    "serie_id" "uuid" NOT NULL,
    "paciente_id" "uuid" NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."series_guardias_pacientes" OWNER TO "postgres";


COMMENT ON TABLE "public"."series_guardias_pacientes" IS 'A quiénes cubre una serie de guardias. Cada guardia que la serie genera nace con esta misma lista de Pacientes.';



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


CREATE TABLE IF NOT EXISTS "public"."sesiones_soporte_tecnico" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid" NOT NULL,
    "prestadora_id" "uuid" NOT NULL,
    "entrada_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ultima_actividad_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expira_at" timestamp with time zone NOT NULL,
    "salida_at" timestamp with time zone
);


ALTER TABLE "public"."sesiones_soporte_tecnico" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."tareas_tipo_asistente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tipo_asistente_id" "uuid" NOT NULL,
    "prestadora_id" "uuid",
    "clase" "text" NOT NULL,
    "clave" "text",
    "texto" "text",
    "orden" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tareas_tipo_asistente_clase_valida" CHECK (("clase" = ANY (ARRAY['corresponde'::"text", 'no_corresponde'::"text"]))),
    CONSTRAINT "tareas_tipo_asistente_texto_segun_nivel" CHECK (((("prestadora_id" IS NULL) AND ("clave" IS NOT NULL) AND ("texto" IS NULL)) OR (("prestadora_id" IS NOT NULL) AND ("clave" IS NULL) AND ("texto" IS NOT NULL))))
);


ALTER TABLE "public"."tareas_tipo_asistente" OWNER TO "postgres";


COMMENT ON TABLE "public"."tareas_tipo_asistente" IS 'Qué HACE y qué NO HACE cada tipo de Asistente. Dos listas separadas a propósito: la segunda es la que evita la confusión con las Familias.';



COMMENT ON COLUMN "public"."tareas_tipo_asistente"."prestadora_id" IS 'Se repite acá aunque se podría llegar a él por el tipo: las políticas de aislamiento comparan contra current_tenant() y salir a buscar el tipo en cada lectura costaría una consulta más y dejaría la regla escrita en dos lugares (CLAUDE.md §7.12).';



COMMENT ON COLUMN "public"."tareas_tipo_asistente"."clase" IS 'corresponde = le toca hacerlo. no_corresponde = no le toca, y conviene que la Familia lo sepa antes de pedirlo.';



CREATE TABLE IF NOT EXISTS "public"."textos_consentimiento" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "jurisdiccion" "text" NOT NULL,
    "clave" "text" NOT NULL,
    "modalidad" "text" NOT NULL,
    "version" integer NOT NULL,
    "idioma" "text" NOT NULL,
    "titulo" "text" NOT NULL,
    "cuerpo" "text" NOT NULL,
    "puntos_clave" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "es_borrador" boolean DEFAULT false NOT NULL,
    "vigente_desde" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vigente_hasta" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "textos_consentimiento_idioma_check" CHECK (("idioma" = ANY (ARRAY['es-AR'::"text", 'en'::"text", 'pt-BR'::"text"]))),
    CONSTRAINT "textos_consentimiento_modalidad_check" CHECK (("modalidad" = ANY (ARRAY['dependencia'::"text", 'autonomo'::"text"]))),
    CONSTRAINT "textos_consentimiento_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."textos_consentimiento" OWNER TO "postgres";


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
    CONSTRAINT "usuarios_prestadora_id_solo_superadmin_null" CHECK ((("prestadora_id" IS NOT NULL) OR ("rol" = 'superadmin'::"text"))),
    CONSTRAINT "usuarios_rol_check" CHECK (("rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text", 'asistente'::"text", 'familia'::"text", 'superadmin'::"text"])))
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



ALTER TABLE ONLY "public"."auditoria_advertencias_legales"
    ADD CONSTRAINT "auditoria_advertencias_legales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auditoria_soporte_tecnico"
    ADD CONSTRAINT "auditoria_soporte_tecnico_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ausencias"
    ADD CONSTRAINT "ausencias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."autorizaciones_monitoreo_paciente"
    ADD CONSTRAINT "autorizaciones_monitoreo_paciente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calificaciones_asistente"
    ADD CONSTRAINT "calificaciones_asistente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cambios_precio_ia_pendientes"
    ADD CONSTRAINT "cambios_precio_ia_pendientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalogo_acciones_permisos"
    ADD CONSTRAINT "catalogo_acciones_permisos_pkey" PRIMARY KEY ("accion");



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



ALTER TABLE ONLY "public"."configuracion_aviso_guardia_sin_cubrir"
    ADD CONSTRAINT "configuracion_aviso_guardia_sin_cubrir_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."configuracion_email_prestadora"
    ADD CONSTRAINT "configuracion_email_prestadora_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."configuracion_escalada_coordinador"
    ADD CONSTRAINT "configuracion_escalada_coordinador_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."configuracion_escalada_relevo"
    ADD CONSTRAINT "configuracion_escalada_relevo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracion_escalada_relevo"
    ADD CONSTRAINT "configuracion_escalada_relevo_prestadora_id_nivel_key" UNIQUE ("prestadora_id", "nivel");



ALTER TABLE ONLY "public"."configuracion_matricula_via_medicacion"
    ADD CONSTRAINT "configuracion_matricula_via_medicacion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracion_matricula_via_medicacion"
    ADD CONSTRAINT "configuracion_matricula_via_prestadora_via_administracion_key" UNIQUE ("prestadora_id", "via_administracion");



ALTER TABLE ONLY "public"."configuracion_notificaciones"
    ADD CONSTRAINT "configuracion_notificaciones_pkey" PRIMARY KEY ("evento", "prestadora_id");



ALTER TABLE ONLY "public"."configuracion_plataforma"
    ADD CONSTRAINT "configuracion_plataforma_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracion_prestadora"
    ADD CONSTRAINT "configuracion_prestadora_dominio_key" UNIQUE ("dominio");



ALTER TABLE ONLY "public"."configuracion_prestadora"
    ADD CONSTRAINT "configuracion_prestadora_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."configuracion_visibilidad_app"
    ADD CONSTRAINT "configuracion_visibilidad_app_pkey" PRIMARY KEY ("prestadora_id", "clave");



ALTER TABLE ONLY "public"."configuracion_whatsapp_prestadora"
    ADD CONSTRAINT "configuracion_whatsapp_prestadora_pkey" PRIMARY KEY ("prestadora_id");



ALTER TABLE ONLY "public"."consentimientos_asistente"
    ADD CONSTRAINT "consentimientos_asistente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversaciones_whatsapp"
    ADD CONSTRAINT "conversaciones_whatsapp_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversaciones_whatsapp"
    ADD CONSTRAINT "conversaciones_whatsapp_prestadora_id_telefono_key" UNIQUE ("prestadora_id", "telefono");



ALTER TABLE ONLY "public"."credenciales_pasarela_pago"
    ADD CONSTRAINT "credenciales_pasarela_pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credenciales_pasarela_pago"
    ADD CONSTRAINT "credenciales_pasarela_pago_prestadora_id_proveedor_key" UNIQUE ("prestadora_id", "proveedor");



ALTER TABLE ONLY "public"."datos_reservados_asistente"
    ADD CONSTRAINT "datos_reservados_asistente_pkey" PRIMARY KEY ("asistente_id");



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



ALTER TABLE ONLY "public"."familias"
    ADD CONSTRAINT "familias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."formulas_cese"
    ADD CONSTRAINT "formulas_cese_jurisdiccion_causal_vigencia_desde_key" UNIQUE ("jurisdiccion", "causal", "vigencia_desde");



ALTER TABLE ONLY "public"."formulas_cese"
    ADD CONSTRAINT "formulas_cese_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guardia_pacientes"
    ADD CONSTRAINT "guardia_pacientes_pkey" PRIMARY KEY ("guardia_id", "paciente_id");



ALTER TABLE ONLY "public"."guardias_cobertura"
    ADD CONSTRAINT "guardias_cobertura_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guardias"
    ADD CONSTRAINT "guardias_id_prestadora_unique" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."guardias"
    ADD CONSTRAINT "guardias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guardias_tracking_gps"
    ADD CONSTRAINT "guardias_tracking_gps_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."matriculas_asistente"
    ADD CONSTRAINT "matriculas_asistente_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."ofertas_guardia"
    ADD CONSTRAINT "ofertas_guardia_guardia_id_asistente_id_key" UNIQUE ("guardia_id", "asistente_id");



ALTER TABLE ONLY "public"."ofertas_guardia"
    ADD CONSTRAINT "ofertas_guardia_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."remuneraciones_asistente"
    ADD CONSTRAINT "remuneraciones_asistente_pkey" PRIMARY KEY ("asistente_id");



ALTER TABLE ONLY "public"."reportes"
    ADD CONSTRAINT "reportes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."series_guardias"
    ADD CONSTRAINT "series_guardias_id_prestadora_unique" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."series_guardias_pacientes"
    ADD CONSTRAINT "series_guardias_pacientes_pkey" PRIMARY KEY ("serie_id", "paciente_id");



ALTER TABLE ONLY "public"."series_guardias"
    ADD CONSTRAINT "series_guardias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_id_prestadora_unique" UNIQUE ("id", "prestadora_id");



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sesiones_soporte_tecnico"
    ADD CONSTRAINT "sesiones_soporte_tecnico_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."solicitudes"
    ADD CONSTRAINT "solicitudes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suscripciones_marketplace"
    ADD CONSTRAINT "suscripciones_marketplace_familia_id_paciente_id_asistente__key" UNIQUE ("familia_id", "paciente_id", "asistente_id");



ALTER TABLE ONLY "public"."suscripciones_marketplace"
    ADD CONSTRAINT "suscripciones_marketplace_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tareas_tipo_asistente"
    ADD CONSTRAINT "tareas_tipo_asistente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."textos_consentimiento"
    ADD CONSTRAINT "textos_consentimiento_jurisdiccion_clave_modalidad_version__key" UNIQUE ("jurisdiccion", "clave", "modalidad", "version", "idioma");



ALTER TABLE ONLY "public"."textos_consentimiento"
    ADD CONSTRAINT "textos_consentimiento_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tipos_asistente"
    ADD CONSTRAINT "tipos_asistente_pkey" PRIMARY KEY ("id");



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



CREATE INDEX "idx_asistentes_tipo" ON "public"."asistentes" USING "btree" ("tipo_asistente_id") WHERE ("tipo_asistente_id" IS NOT NULL);



CREATE INDEX "idx_auditoria_soporte_admin" ON "public"."auditoria_soporte_tecnico" USING "btree" ("admin_id", "created_at" DESC);



CREATE INDEX "idx_auditoria_soporte_prestadora" ON "public"."auditoria_soporte_tecnico" USING "btree" ("prestadora_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_autorizacion_monitoreo_vigente_unica" ON "public"."autorizaciones_monitoreo_paciente" USING "btree" ("paciente_id") WHERE "vigente";



CREATE INDEX "idx_cambios_precio_ia_pendientes_estado" ON "public"."cambios_precio_ia_pendientes" USING "btree" ("estado", "detectado_at" DESC);



CREATE INDEX "idx_cierre_servicio_asistentes_cierre" ON "public"."cierre_servicio_asistentes" USING "btree" ("cierre_id");



CREATE INDEX "idx_cierre_servicio_asistentes_pendientes" ON "public"."cierre_servicio_asistentes" USING "btree" ("prestadora_id") WHERE (("avisado_verbalmente_at" IS NULL) AND ("aviso_automatico_enviado_at" IS NULL));



CREATE INDEX "idx_cierres_servicio_paciente_paciente" ON "public"."cierres_servicio_paciente" USING "btree" ("paciente_id");



CREATE INDEX "idx_cobros_marketplace_prestadora" ON "public"."cobros_marketplace" USING "btree" ("prestadora_id", "periodo" DESC);



CREATE INDEX "idx_cobros_marketplace_suscripcion" ON "public"."cobros_marketplace" USING "btree" ("suscripcion_id", "periodo" DESC);



CREATE INDEX "idx_consentimientos_asistente_prestadora" ON "public"."consentimientos_asistente" USING "btree" ("prestadora_id", "clave");



CREATE UNIQUE INDEX "idx_consentimientos_asistente_vivo" ON "public"."consentimientos_asistente" USING "btree" ("asistente_id", "clave") WHERE ("retirado_at" IS NULL);



CREATE INDEX "idx_datos_reservados_asistente_prestadora" ON "public"."datos_reservados_asistente" USING "btree" ("prestadora_id");



CREATE INDEX "idx_domicilios_temp_paciente" ON "public"."domicilios_temporales_paciente" USING "btree" ("paciente_id");



CREATE INDEX "idx_escalas_jurisdiccion_tipo_vigencia" ON "public"."escalas_legales" USING "btree" ("jurisdiccion", "tipo", "categoria", "vigencia_desde");



CREATE INDEX "idx_excepciones_familiar_relevo_incidente" ON "public"."excepciones_familiar_relevo" USING "btree" ("incidente_id");



CREATE INDEX "idx_facturas_familia_prestadora" ON "public"."facturas_familia" USING "btree" ("prestadora_id", "periodo" DESC);



CREATE INDEX "idx_formulas_cese_jurisdiccion_causal" ON "public"."formulas_cese" USING "btree" ("jurisdiccion", "causal", "vigencia_desde");



CREATE INDEX "idx_guardia_pacientes_paciente" ON "public"."guardia_pacientes" USING "btree" ("paciente_id");



CREATE INDEX "idx_guardias_asistente" ON "public"."guardias" USING "btree" ("asistente_id");



CREATE INDEX "idx_guardias_canal_modalidad" ON "public"."guardias" USING "btree" ("prestadora_id", "canal_modalidad");



CREATE INDEX "idx_guardias_fecha" ON "public"."guardias" USING "btree" ("fecha");



CREATE INDEX "idx_guardias_paciente" ON "public"."guardias" USING "btree" ("paciente_id");



CREATE INDEX "idx_guardias_serie" ON "public"."guardias" USING "btree" ("serie_id");



CREATE INDEX "idx_guardias_sin_cubrir" ON "public"."guardias" USING "btree" ("prestadora_id", "fecha") WHERE ("asistente_id" IS NULL);



CREATE INDEX "idx_guardias_tracking_gps_guardia" ON "public"."guardias_tracking_gps" USING "btree" ("guardia_id");



CREATE INDEX "idx_hospitalizaciones_paciente" ON "public"."hospitalizaciones_paciente" USING "btree" ("paciente_id");



CREATE UNIQUE INDEX "idx_hospitalizaciones_paciente_activa_unica" ON "public"."hospitalizaciones_paciente" USING "btree" ("paciente_id") WHERE ("fecha_fin" IS NULL);



CREATE INDEX "idx_incidentes_relevo_entrante" ON "public"."incidentes_relevo" USING "btree" ("guardia_entrante_id");



CREATE INDEX "idx_incidentes_relevo_saliente" ON "public"."incidentes_relevo" USING "btree" ("guardia_saliente_id");



CREATE INDEX "idx_indicaciones_medicacion_estado" ON "public"."indicaciones_medicacion" USING "btree" ("estado");



CREATE INDEX "idx_indicaciones_medicacion_paciente" ON "public"."indicaciones_medicacion" USING "btree" ("paciente_id");



CREATE INDEX "idx_indicaciones_medicacion_prestadora" ON "public"."indicaciones_medicacion" USING "btree" ("prestadora_id");



CREATE INDEX "idx_informes_obra_social_paciente" ON "public"."informes_obra_social" USING "btree" ("paciente_id", "periodo_desde" DESC);



CREATE INDEX "idx_informes_obra_social_prestadora" ON "public"."informes_obra_social" USING "btree" ("prestadora_id", "periodo_desde" DESC);



CREATE INDEX "idx_matriculas_asistente_asistente" ON "public"."matriculas_asistente" USING "btree" ("asistente_id");



CREATE INDEX "idx_matriculas_asistente_vencimiento" ON "public"."matriculas_asistente" USING "btree" ("vigente_hasta") WHERE ("vigente_hasta" IS NOT NULL);



CREATE INDEX "idx_mensajes_asistente_hilo" ON "public"."mensajes_asistente" USING "btree" ("asistente_id", "created_at");



CREATE INDEX "idx_mensajes_whatsapp_conversacion" ON "public"."mensajes_whatsapp" USING "btree" ("conversacion_id");



CREATE INDEX "idx_miembros_familia_familia" ON "public"."miembros_familia" USING "btree" ("familia_id");



CREATE INDEX "idx_notificaciones_cierre_servicio_asistente" ON "public"."notificaciones_cierre_servicio" USING "btree" ("asistente_id");



CREATE INDEX "idx_notificaciones_cierre_servicio_cierre" ON "public"."notificaciones_cierre_servicio" USING "btree" ("cierre_id");



CREATE INDEX "idx_ofertas_guardia_por_asistente" ON "public"."ofertas_guardia" USING "btree" ("asistente_id", "invitado_at" DESC);



CREATE INDEX "idx_ofertas_guardia_sin_responder" ON "public"."ofertas_guardia" USING "btree" ("prestadora_id", "guardia_id") WHERE ("respuesta" IS NULL);



CREATE INDEX "idx_precios_ia_modelo_lookup" ON "public"."precios_ia_modelo" USING "btree" ("proveedor", "modelo", "vigente_desde" DESC);



CREATE INDEX "idx_prestadora_modalidades_prestadora" ON "public"."prestadora_modalidades" USING "btree" ("prestadora_id");



CREATE INDEX "idx_prestadora_pasarela_pago_prestadora" ON "public"."prestadora_pasarela_pago" USING "btree" ("prestadora_id");



CREATE INDEX "idx_push_subscriptions_asistente" ON "public"."push_subscriptions" USING "btree" ("asistente_id");



CREATE INDEX "idx_push_subscriptions_familia" ON "public"."push_subscriptions" USING "btree" ("familia_id");



CREATE INDEX "idx_qr_cobro_efectivo_token" ON "public"."qr_cobro_efectivo" USING "btree" ("token");



CREATE INDEX "idx_rangos_referencia_vitales_paciente" ON "public"."rangos_referencia_vitales" USING "btree" ("paciente_id");



CREATE INDEX "idx_rangos_referencia_vitales_prestadora" ON "public"."rangos_referencia_vitales" USING "btree" ("prestadora_id");



CREATE INDEX "idx_remuneraciones_asistente_prestadora" ON "public"."remuneraciones_asistente" USING "btree" ("prestadora_id");



CREATE INDEX "idx_reportes_guardia" ON "public"."reportes" USING "btree" ("guardia_id");



CREATE INDEX "idx_reportes_paciente" ON "public"."reportes" USING "btree" ("paciente_id");



CREATE INDEX "idx_series_guardias_asistente" ON "public"."series_guardias" USING "btree" ("asistente_id");



CREATE INDEX "idx_series_guardias_paciente" ON "public"."series_guardias" USING "btree" ("paciente_id");



CREATE INDEX "idx_series_guardias_pacientes_paciente" ON "public"."series_guardias_pacientes" USING "btree" ("paciente_id");



CREATE INDEX "idx_servicios_familia" ON "public"."servicios" USING "btree" ("familia_id");



CREATE INDEX "idx_sesion_soporte_admin" ON "public"."sesiones_soporte_tecnico" USING "btree" ("admin_id");



CREATE UNIQUE INDEX "idx_sesion_soporte_vigente_unica" ON "public"."sesiones_soporte_tecnico" USING "btree" ("admin_id") WHERE ("salida_at" IS NULL);



CREATE INDEX "idx_suscripciones_marketplace_familia" ON "public"."suscripciones_marketplace" USING "btree" ("familia_id");



CREATE INDEX "idx_suscripciones_marketplace_prestadora" ON "public"."suscripciones_marketplace" USING "btree" ("prestadora_id");



CREATE INDEX "idx_tareas_tipo_asistente_tipo" ON "public"."tareas_tipo_asistente" USING "btree" ("tipo_asistente_id", "clase", "orden");



CREATE INDEX "idx_textos_consentimiento_busqueda" ON "public"."textos_consentimiento" USING "btree" ("jurisdiccion", "clave", "modalidad", "idioma") WHERE ("vigente_hasta" IS NULL);



CREATE UNIQUE INDEX "idx_tipos_asistente_clave_general" ON "public"."tipos_asistente" USING "btree" ("clave") WHERE ("prestadora_id" IS NULL);



CREATE UNIQUE INDEX "idx_tipos_asistente_nombre_prestadora" ON "public"."tipos_asistente" USING "btree" ("prestadora_id", "lower"("nombre")) WHERE ("prestadora_id" IS NOT NULL);



CREATE INDEX "idx_tipos_asistente_prestadora" ON "public"."tipos_asistente" USING "btree" ("prestadora_id") WHERE ("activo" = true);



CREATE INDEX "idx_tokens_activacion_usuario" ON "public"."tokens_activacion_cuenta" USING "btree" ("usuario_id");



CREATE INDEX "idx_uso_ia_prestadora_fecha" ON "public"."uso_ia" USING "btree" ("prestadora_id", "creado_at" DESC);



CREATE INDEX "idx_verif_asistente" ON "public"."verificaciones_asistente" USING "btree" ("asistente_id");



CREATE UNIQUE INDEX "reportes_uno_por_paciente_y_guardia" ON "public"."reportes" USING "btree" ("guardia_id", "paciente_id");



CREATE OR REPLACE TRIGGER "sincronizar_paciente_principal" AFTER INSERT OR UPDATE OF "paciente_id" ON "public"."guardias" FOR EACH ROW EXECUTE FUNCTION "public"."sincronizar_paciente_principal_de_guardia"();



CREATE OR REPLACE TRIGGER "sincronizar_paciente_principal" AFTER INSERT OR UPDATE OF "paciente_id" ON "public"."series_guardias" FOR EACH ROW EXECUTE FUNCTION "public"."sincronizar_paciente_principal_de_serie"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."alertas_tempranas_guardia" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."asistentes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."ausencias" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."calificaciones_asistente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."certificados" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."ceses" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."cierres_servicio_paciente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_ausencia_automatica" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_escalada_coordinador" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_escalada_relevo" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_notificaciones" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_prestadora" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_visibilidad_app" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."configuracion_whatsapp_prestadora" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."conversaciones_whatsapp" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."datos_reservados_asistente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."documentos_asistente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."domicilios_temporales_paciente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."excepciones_familiar_relevo" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."familias" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."guardias" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."guardias_cobertura" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."guardias_tracking_gps" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."incidentes_relevo" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."lista_precios" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."mensajes_whatsapp" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."notificaciones_cierre_servicio" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."pacientes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."paquete_prestacion_items" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."paquetes_prestaciones" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."personal_emergencia" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."plantillas_whatsapp" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."postulaciones" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."prestaciones" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."prestadoras" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."remuneraciones_asistente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."series_guardias" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."solicitudes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."tipos_documento_asistente" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_auditoria_soporte" AFTER INSERT OR DELETE OR UPDATE ON "public"."zonas_cobertura" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditoria_soporte_mutacion"();



CREATE OR REPLACE TRIGGER "trg_exigir_matricula_en_guardia" BEFORE INSERT OR UPDATE ON "public"."guardias" FOR EACH ROW EXECUTE FUNCTION "public"."exigir_matricula_en_guardia"();



CREATE OR REPLACE TRIGGER "trg_exigir_matricula_en_oferta" BEFORE INSERT OR UPDATE ON "public"."ofertas_guardia" FOR EACH ROW EXECUTE FUNCTION "public"."exigir_matricula_en_oferta"();



CREATE OR REPLACE TRIGGER "trg_reporte_paciente_del_turno" BEFORE INSERT OR UPDATE OF "guardia_id", "paciente_id" ON "public"."reportes" FOR EACH ROW EXECUTE FUNCTION "public"."exigir_paciente_del_turno"();



CREATE OR REPLACE TRIGGER "trigger_bloquear_edicion_laboral_coordinador" BEFORE UPDATE ON "public"."asistentes" FOR EACH ROW EXECUTE FUNCTION "public"."bloquear_edicion_laboral_coordinador"();



CREATE OR REPLACE TRIGGER "trigger_precio_lista_actualizado" AFTER UPDATE ON "public"."lista_precios" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_prestaciones_a_revisar"();



CREATE OR REPLACE TRIGGER "validar_familia_guardia_pacientes" BEFORE INSERT OR UPDATE ON "public"."guardia_pacientes" FOR EACH ROW EXECUTE FUNCTION "public"."validar_paciente_de_guardia_misma_familia"();



CREATE OR REPLACE TRIGGER "validar_familia_series_guardias_pacientes" BEFORE INSERT OR UPDATE ON "public"."series_guardias_pacientes" FOR EACH ROW EXECUTE FUNCTION "public"."validar_paciente_de_serie_misma_familia"();



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



ALTER TABLE ONLY "public"."asistentes"
    ADD CONSTRAINT "asistentes_tipo_asistente_id_fkey" FOREIGN KEY ("tipo_asistente_id") REFERENCES "public"."tipos_asistente"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."auditoria_advertencias_legales"
    ADD CONSTRAINT "auditoria_advertencias_legales_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."auditoria_advertencias_legales"
    ADD CONSTRAINT "auditoria_advertencias_legales_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."auditoria_soporte_tecnico"
    ADD CONSTRAINT "auditoria_soporte_tecnico_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."auditoria_soporte_tecnico"
    ADD CONSTRAINT "auditoria_soporte_tecnico_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



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



ALTER TABLE ONLY "public"."configuracion_aviso_guardia_sin_cubrir"
    ADD CONSTRAINT "configuracion_aviso_guardia_sin_cubrir_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."configuracion_email_prestadora"
    ADD CONSTRAINT "configuracion_email_prestadora_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_escalada_coordinador"
    ADD CONSTRAINT "configuracion_escalada_coordinador_coordinador_backup_id_fkey" FOREIGN KEY ("coordinador_backup_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."configuracion_escalada_coordinador"
    ADD CONSTRAINT "configuracion_escalada_coordinador_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_escalada_relevo"
    ADD CONSTRAINT "configuracion_escalada_relevo_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_matricula_via_medicacion"
    ADD CONSTRAINT "configuracion_matricula_via_medicacion_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_notificaciones"
    ADD CONSTRAINT "configuracion_notificaciones_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_plataforma"
    ADD CONSTRAINT "configuracion_plataforma_actualizado_por_fkey" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."configuracion_prestadora"
    ADD CONSTRAINT "configuracion_prestadora_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_visibilidad_app"
    ADD CONSTRAINT "configuracion_visibilidad_app_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."configuracion_whatsapp_prestadora"
    ADD CONSTRAINT "configuracion_whatsapp_prestadora_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."consentimientos_asistente"
    ADD CONSTRAINT "consentimientos_asistente_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id");



ALTER TABLE ONLY "public"."consentimientos_asistente"
    ADD CONSTRAINT "consentimientos_asistente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."consentimientos_asistente"
    ADD CONSTRAINT "consentimientos_asistente_texto_consentimiento_id_fkey" FOREIGN KEY ("texto_consentimiento_id") REFERENCES "public"."textos_consentimiento"("id");



ALTER TABLE ONLY "public"."conversaciones_whatsapp"
    ADD CONSTRAINT "conversaciones_whatsapp_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id");



ALTER TABLE ONLY "public"."conversaciones_whatsapp"
    ADD CONSTRAINT "conversaciones_whatsapp_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."credenciales_pasarela_pago"
    ADD CONSTRAINT "credenciales_pasarela_pago_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."datos_reservados_asistente"
    ADD CONSTRAINT "datos_reservados_asistente_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."datos_reservados_asistente"
    ADD CONSTRAINT "datos_reservados_asistente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



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



ALTER TABLE ONLY "public"."guardia_pacientes"
    ADD CONSTRAINT "guardia_pacientes_guardia_tenant_fk" FOREIGN KEY ("guardia_id", "prestadora_id") REFERENCES "public"."guardias"("id", "prestadora_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guardia_pacientes"
    ADD CONSTRAINT "guardia_pacientes_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."guardia_pacientes"
    ADD CONSTRAINT "guardia_pacientes_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



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
    ADD CONSTRAINT "guardias_ofrecida_por_fkey" FOREIGN KEY ("ofrecida_por") REFERENCES "public"."usuarios"("id");



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



ALTER TABLE ONLY "public"."matriculas_asistente"
    ADD CONSTRAINT "matriculas_asistente_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."matriculas_asistente"
    ADD CONSTRAINT "matriculas_asistente_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."matriculas_asistente"
    ADD CONSTRAINT "matriculas_asistente_verificada_por_fkey" FOREIGN KEY ("verificada_por") REFERENCES "public"."usuarios"("id");



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



ALTER TABLE ONLY "public"."ofertas_guardia"
    ADD CONSTRAINT "ofertas_guardia_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ofertas_guardia"
    ADD CONSTRAINT "ofertas_guardia_guardia_id_fkey" FOREIGN KEY ("guardia_id") REFERENCES "public"."guardias"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ofertas_guardia"
    ADD CONSTRAINT "ofertas_guardia_invitado_por_fkey" FOREIGN KEY ("invitado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."ofertas_guardia"
    ADD CONSTRAINT "ofertas_guardia_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id") ON DELETE CASCADE;



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
    ADD CONSTRAINT "permisos_prestadora_accion_fkey" FOREIGN KEY ("accion") REFERENCES "public"."catalogo_acciones_permisos"("accion");



ALTER TABLE ONLY "public"."permisos_prestadora"
    ADD CONSTRAINT "permisos_prestadora_actualizado_por_fkey" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."permisos_prestadora"
    ADD CONSTRAINT "permisos_prestadora_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."personal_emergencia"
    ADD CONSTRAINT "personal_emergencia_asistente_tenant_fk" FOREIGN KEY ("asistente_id", "prestadora_id") REFERENCES "public"."asistentes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."personal_emergencia"
    ADD CONSTRAINT "personal_emergencia_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



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



ALTER TABLE ONLY "public"."remuneraciones_asistente"
    ADD CONSTRAINT "remuneraciones_asistente_asistente_id_fkey" FOREIGN KEY ("asistente_id") REFERENCES "public"."asistentes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."remuneraciones_asistente"
    ADD CONSTRAINT "remuneraciones_asistente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."reportes"
    ADD CONSTRAINT "reportes_guardia_tenant_fk" FOREIGN KEY ("guardia_id", "prestadora_id") REFERENCES "public"."guardias"("id", "prestadora_id");



ALTER TABLE ONLY "public"."reportes"
    ADD CONSTRAINT "reportes_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."reportes"
    ADD CONSTRAINT "reportes_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."series_guardias"
    ADD CONSTRAINT "series_guardias_asistente_tenant_fk" FOREIGN KEY ("asistente_id", "prestadora_id") REFERENCES "public"."asistentes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."series_guardias"
    ADD CONSTRAINT "series_guardias_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."series_guardias_pacientes"
    ADD CONSTRAINT "series_guardias_pacientes_paciente_tenant_fk" FOREIGN KEY ("paciente_id", "prestadora_id") REFERENCES "public"."pacientes"("id", "prestadora_id");



ALTER TABLE ONLY "public"."series_guardias_pacientes"
    ADD CONSTRAINT "series_guardias_pacientes_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."series_guardias_pacientes"
    ADD CONSTRAINT "series_guardias_pacientes_serie_tenant_fk" FOREIGN KEY ("serie_id", "prestadora_id") REFERENCES "public"."series_guardias"("id", "prestadora_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."series_guardias"
    ADD CONSTRAINT "series_guardias_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "public"."familias"("id");



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



ALTER TABLE ONLY "public"."sesiones_soporte_tecnico"
    ADD CONSTRAINT "sesiones_soporte_tecnico_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."sesiones_soporte_tecnico"
    ADD CONSTRAINT "sesiones_soporte_tecnico_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id");



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



ALTER TABLE ONLY "public"."tareas_tipo_asistente"
    ADD CONSTRAINT "tareas_tipo_asistente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tareas_tipo_asistente"
    ADD CONSTRAINT "tareas_tipo_asistente_tipo_asistente_id_fkey" FOREIGN KEY ("tipo_asistente_id") REFERENCES "public"."tipos_asistente"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tipos_asistente"
    ADD CONSTRAINT "tipos_asistente_prestadora_id_fkey" FOREIGN KEY ("prestadora_id") REFERENCES "public"."prestadoras"("id") ON DELETE CASCADE;



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



CREATE POLICY "admin_gestiona_configuracion_aviso_guardia_sin_cubrir" ON "public"."configuracion_aviso_guardia_sin_cubrir" USING ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR (EXISTS ( SELECT 1
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



CREATE POLICY "admin_gestiona_visibilidad_app" ON "public"."configuracion_visibilidad_app" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



CREATE POLICY "admin_lee_asistentes" ON "public"."asistentes" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR "public"."es_admin_prestadora"())));



CREATE POLICY "admin_lee_importaciones_de_su_prestadora" ON "public"."importaciones_prestadora" FOR SELECT USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_actualiza_visibilidad" ON "public"."calificaciones_asistente" FOR UPDATE USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"])))))));



CREATE POLICY "admin_prestadora_gestiona_autorizaciones_monitoreo" ON "public"."autorizaciones_monitoreo_paciente" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_config_matricula_via" ON "public"."configuracion_matricula_via_medicacion" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_documentos_asistente" ON "public"."documentos_asistente" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_etapas_incorporacion" ON "public"."etapas_incorporacion_asistente" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_indicaciones_medicacion" ON "public"."indicaciones_medicacion" USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_gestiona_matriculas_asistente" ON "public"."matriculas_asistente" USING (("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM ("public"."asistentes" "a"
     JOIN "public"."usuarios" "u" ON (("u"."id" = "auth"."uid"())))
  WHERE (("a"."id" = "matriculas_asistente"."asistente_id") AND ("a"."prestadora_id" = "public"."current_tenant"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



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



CREATE POLICY "admin_prestadora_gestiona_tareas_tipo_propias" ON "public"."tareas_tipo_asistente" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



CREATE POLICY "admin_prestadora_gestiona_tipos_asistente_propios" ON "public"."tipos_asistente" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



CREATE POLICY "admin_prestadora_gestiona_tipos_documento" ON "public"."tipos_documento_asistente" USING ((("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())) OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_lee_auditoria_de_su_prestadora" ON "public"."auditoria_soporte_tecnico" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text") AND ("u"."prestadora_id" = "auditoria_soporte_tecnico"."prestadora_id")))));



CREATE POLICY "admin_prestadora_lee_su_auditoria_legal" ON "public"."auditoria_advertencias_legales" FOR SELECT USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text")))))));



CREATE POLICY "admin_prestadora_lee_su_prestadora" ON "public"."prestadoras" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text") AND ("u"."prestadora_id" = "prestadoras"."id")))));



CREATE POLICY "admin_prestadora_lee_sus_modulos" ON "public"."prestadora_modulos" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text") AND ("u"."prestadora_id" = "prestadora_modulos"."prestadora_id")))));



ALTER TABLE "public"."advertencias_legales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alertas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alertas_contingencia_hospitalizacion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alertas_tempranas_guardia" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "asistente_actualiza_su_guardia" ON "public"."guardias" FOR UPDATE USING ((("prestadora_id" = "public"."current_tenant"()) AND ("asistente_id" = "auth"."uid"())));



CREATE POLICY "asistente_carga_su_descargo" ON "public"."calificaciones_asistente" FOR UPDATE USING ((("asistente_id" = "auth"."uid"()) AND ("descargo_asistente" IS NULL))) WITH CHECK (("asistente_id" = "auth"."uid"()));



CREATE POLICY "asistente_contesta_su_invitacion" ON "public"."ofertas_guardia" FOR UPDATE USING ((("prestadora_id" = "public"."current_tenant"()) AND ("asistente_id" = "auth"."uid"()))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND ("asistente_id" = "auth"."uid"())));



CREATE POLICY "asistente_gestiona_reportes_de_su_guardia" ON "public"."reportes" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."guardias" "g"
  WHERE (("g"."id" = "reportes"."guardia_id") AND ("g"."asistente_id" = "auth"."uid"()))))));



CREATE POLICY "asistente_gestiona_sus_push_subscriptions" ON "public"."push_subscriptions" USING (("asistente_id" = "auth"."uid"())) WITH CHECK (("asistente_id" = "auth"."uid"()));



CREATE POLICY "asistente_lee_sus_consentimientos" ON "public"."consentimientos_asistente" FOR SELECT USING (("asistente_id" = "auth"."uid"()));



CREATE POLICY "asistente_ve_guardias_ofrecidas" ON "public"."guardias" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND ("asistente_id" IS NULL) AND ("ofrecida_at" IS NOT NULL) AND "public"."es_asistente"()));



CREATE POLICY "asistente_ve_sus_guardias" ON "public"."guardias" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND ("asistente_id" = "auth"."uid"())));



CREATE POLICY "asistente_ve_sus_invitaciones" ON "public"."ofertas_guardia" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND ("asistente_id" = "auth"."uid"())));



ALTER TABLE "public"."asistentes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auditoria_advertencias_legales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auditoria_soporte_tecnico" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ausencias" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."autorizaciones_monitoreo_paciente" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "borra_datos_reservados_solo_la_administracion" ON "public"."datos_reservados_asistente" FOR DELETE USING ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR "public"."es_admin_prestadora"())));



CREATE POLICY "borra_remuneraciones_solo_la_administracion" ON "public"."remuneraciones_asistente" FOR DELETE USING ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR "public"."es_admin_prestadora"())));



ALTER TABLE "public"."calificaciones_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cambios_precio_ia_pendientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "carga_datos_reservados_solo_la_administracion" ON "public"."datos_reservados_asistente" FOR INSERT WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR "public"."es_admin_prestadora"())));



CREATE POLICY "carga_remuneraciones_solo_la_administracion" ON "public"."remuneraciones_asistente" FOR INSERT WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR "public"."es_admin_prestadora"())));



ALTER TABLE "public"."catalogo_acciones_permisos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catalogo_modulos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."certificados" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ceses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cierre_servicio_asistentes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cierres_servicio_paciente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cobros_marketplace" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_alertas_ia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_ausencia_automatica" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_aviso_cese_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_aviso_guardia_sin_cubrir" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_email_prestadora" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_escalada_coordinador" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_escalada_relevo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_matricula_via_medicacion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_notificaciones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_plataforma" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_prestadora" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_visibilidad_app" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_whatsapp_prestadora" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."consentimientos_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversaciones_whatsapp" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coordinador_agrega_pacientes" ON "public"."pacientes" FOR INSERT WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND "public"."tiene_permiso"('editar_datos_paciente'::"text")));



CREATE POLICY "coordinador_cierra_servicio_guardias" ON "public"."guardias" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."cierres_servicio_paciente" "c"
  WHERE ("c"."paciente_id" IN ( SELECT "public"."pacientes_de_la_guardia"("guardias"."id") AS "pacientes_de_la_guardia")))))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."cierres_servicio_paciente" "c"
  WHERE ("c"."paciente_id" IN ( SELECT "public"."pacientes_de_la_guardia"("guardias"."id") AS "pacientes_de_la_guardia"))))));



CREATE POLICY "coordinador_cierra_servicio_series_guardias" ON "public"."series_guardias" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."cierres_servicio_paciente" "c"
  WHERE ("c"."paciente_id" IN ( SELECT "public"."pacientes_de_la_serie"("series_guardias"."id") AS "pacientes_de_la_serie")))))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."cierres_servicio_paciente" "c"
  WHERE ("c"."paciente_id" IN ( SELECT "public"."pacientes_de_la_serie"("series_guardias"."id") AS "pacientes_de_la_serie"))))));



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
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND "public"."coordinador_alcanza_guardia"("asistente_id")));



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
   FROM "public"."usuarios" "u",
    "public"."guardias" "g",
    "public"."asistentes" "a"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text") AND ("g"."id" IN ( SELECT "public"."guardias_del_paciente"("informes_obra_social"."paciente_id") AS "guardias_del_paciente")) AND ("a"."id" = "g"."asistente_id") AND ("u"."zonas" && "a"."zonas"))))));



CREATE POLICY "coordinador_gestiona_mensajes_whatsapp" ON "public"."mensajes_whatsapp" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_gestiona_ofertas_de_su_zona" ON "public"."ofertas_guardia" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."guardias" "g"
  WHERE (("g"."id" = "ofertas_guardia"."guardia_id") AND "public"."coordinador_alcanza_guardia"("g"."asistente_id")))))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
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



CREATE POLICY "coordinador_lee_config_matricula_via" ON "public"."configuracion_matricula_via_medicacion" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
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



CREATE POLICY "coordinador_lee_configuracion_aviso_guardia_sin_cubrir" ON "public"."configuracion_aviso_guardia_sin_cubrir" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
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



CREATE POLICY "coordinador_lee_indicaciones_medicacion" ON "public"."indicaciones_medicacion" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'coordinador'::"text"))))));



CREATE POLICY "coordinador_lee_matriculas_asistente" ON "public"."matriculas_asistente" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."asistentes" "a"
     JOIN "public"."usuarios" "u" ON (("u"."id" = "auth"."uid"())))
  WHERE (("a"."id" = "matriculas_asistente"."asistente_id") AND ("a"."prestadora_id" = "public"."current_tenant"()) AND ("u"."rol" = 'coordinador'::"text")))));



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



CREATE POLICY "coordinador_lee_visibilidad_app" ON "public"."configuracion_visibilidad_app" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
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


CREATE POLICY "cualquiera_lee_catalogo_acciones_permisos" ON "public"."catalogo_acciones_permisos" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."datos_reservados_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documentos_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."domicilios_temporales_paciente" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "edita_datos_reservados_solo_la_administracion" ON "public"."datos_reservados_asistente" FOR UPDATE USING ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR "public"."es_admin_prestadora"()))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR "public"."es_admin_prestadora"())));



CREATE POLICY "edita_remuneraciones_solo_la_administracion" ON "public"."remuneraciones_asistente" FOR UPDATE USING ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR "public"."es_admin_prestadora"()))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR "public"."es_admin_prestadora"())));



CREATE POLICY "el_panel_arma_la_lista_de_pacientes" ON "public"."guardia_pacientes" USING (((EXISTS ( SELECT 1
   FROM "public"."guardias" "g"
  WHERE ("g"."id" = "guardia_pacientes"."guardia_id"))) AND ("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"])))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."guardias" "g"
  WHERE ("g"."id" = "guardia_pacientes"."guardia_id"))) AND ("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "el_panel_arma_la_lista_de_pacientes_de_la_serie" ON "public"."series_guardias_pacientes" USING (((EXISTS ( SELECT 1
   FROM "public"."series_guardias" "s"
  WHERE ("s"."id" = "series_guardias_pacientes"."serie_id"))) AND ("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"])))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."series_guardias" "s"
  WHERE ("s"."id" = "series_guardias_pacientes"."serie_id"))) AND ("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



ALTER TABLE "public"."escalas_legales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."etapas_incorporacion_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."excepciones_familiar_relevo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."facturas_familia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."facturas_familia_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "familia_crea_su_calificacion" ON "public"."calificaciones_asistente" FOR INSERT WITH CHECK ((("familia_id" = "auth"."uid"()) AND ("prestadora_id" = "public"."current_tenant"()) AND ("paciente_id" IN ( SELECT "public"."pacientes_de_la_guardia"("calificaciones_asistente"."guardia_id") AS "pacientes_de_la_guardia")) AND (EXISTS ( SELECT 1
   FROM "public"."pacientes" "p"
  WHERE (("p"."id" = "calificaciones_asistente"."paciente_id") AND ("p"."familia_id" = "auth"."uid"()))))));



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



CREATE POLICY "familia_ve_certificado_asistente_asignado" ON "public"."certificados" FOR SELECT USING ("public"."asistente_atiende_a_la_familia"("asistente_id", "public"."familia_id_de_usuario"("auth"."uid"())));



CREATE POLICY "familia_ve_guardias_de_sus_pacientes" ON "public"."guardias" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."pacientes" "p"
  WHERE (("p"."id" IN ( SELECT "public"."pacientes_de_la_guardia"("guardias"."id") AS "pacientes_de_la_guardia")) AND ("p"."familia_id" = "public"."familia_id_de_usuario"("auth"."uid"())))))));



CREATE POLICY "familia_ve_hospitalizaciones_de_su_paciente" ON "public"."hospitalizaciones_paciente" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."pacientes" "p"
  WHERE (("p"."id" = "hospitalizaciones_paciente"."paciente_id") AND ("p"."familia_id" = "auth"."uid"())))));



CREATE POLICY "familia_ve_items_de_sus_facturas" ON "public"."facturas_familia_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."facturas_familia" "f"
  WHERE (("f"."id" = "facturas_familia_items"."factura_id") AND ("f"."familia_id" = "public"."familia_id_de_usuario"("auth"."uid"()))))));



CREATE POLICY "familia_ve_reportes_de_sus_pacientes" ON "public"."reportes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."pacientes" "p"
  WHERE (("p"."id" = "reportes"."paciente_id") AND ("p"."familia_id" = "public"."familia_id_de_usuario"("auth"."uid"()))))));



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


ALTER TABLE "public"."guardia_pacientes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."guardias" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."guardias_cobertura" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."guardias_tracking_gps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hospitalizaciones_paciente" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "identificados_leen_textos_consentimiento" ON "public"."textos_consentimiento" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."importaciones_prestadora" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."incidentes_relevo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."indicaciones_medicacion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."informes_obra_social" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lectura_configuracion_plataforma" ON "public"."configuracion_plataforma" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "lee_datos_reservados_quien_tiene_el_permiso" ON "public"."datos_reservados_asistente" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND "public"."tiene_permiso"('ver_datos_reservados_asistente'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."asistentes" "a"
  WHERE ("a"."id" = "datos_reservados_asistente"."asistente_id")))));



CREATE POLICY "lee_remuneraciones_quien_tiene_el_permiso" ON "public"."remuneraciones_asistente" FOR SELECT USING ((("prestadora_id" = "public"."current_tenant"()) AND "public"."tiene_permiso"('ver_pagos_asistente'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."asistentes" "a"
  WHERE ("a"."id" = "remuneraciones_asistente"."asistente_id")))));



ALTER TABLE "public"."lista_precios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."matriculas_asistente" ENABLE ROW LEVEL SECURITY;


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



ALTER TABLE "public"."ofertas_guardia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pacientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "panel_edita_asistentes" ON "public"."asistentes" USING ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR "public"."es_admin_prestadora"()))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND ("public"."es_superadmin"() OR "public"."es_admin_prestadora"())));



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



CREATE POLICY "panel_gestiona_ofertas_de_su_prestadora" ON "public"."ofertas_guardia" USING ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'superadmin'::"text"]))))))) WITH CHECK ((("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'superadmin'::"text"])))))));



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



CREATE POLICY "panel_lee_advertencias_legales" ON "public"."advertencias_legales" FOR SELECT USING (("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



CREATE POLICY "panel_lee_consentimientos_de_su_prestadora" ON "public"."consentimientos_asistente" FOR SELECT USING (("public"."es_superadmin"() OR (("prestadora_id" = "public"."current_tenant"()) AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin_prestadora'::"text", 'coordinador'::"text"]))))))));



CREATE POLICY "panel_lee_escalas_legales" ON "public"."escalas_legales" FOR SELECT USING (("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



CREATE POLICY "panel_lee_formulas_cese" ON "public"."formulas_cese" FOR SELECT USING (("public"."es_superadmin"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin_prestadora'::"text"))))));



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


ALTER TABLE "public"."remuneraciones_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reportes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "se_ven_los_pacientes_de_una_guardia_visible" ON "public"."guardia_pacientes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."guardias" "g"
  WHERE ("g"."id" = "guardia_pacientes"."guardia_id"))));



CREATE POLICY "se_ven_los_pacientes_de_una_serie_visible" ON "public"."series_guardias_pacientes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."series_guardias" "s"
  WHERE ("s"."id" = "series_guardias_pacientes"."serie_id"))));



ALTER TABLE "public"."series_guardias" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."series_guardias_pacientes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."servicios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sesiones_soporte_tecnico" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."solicitudes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "superadmin_escribe_configuracion_plataforma" ON "public"."configuracion_plataforma" FOR UPDATE USING ("public"."es_superadmin"()) WITH CHECK ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_advertencias_legales" ON "public"."advertencias_legales" USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_cambios_precio_ia_pendientes" ON "public"."cambios_precio_ia_pendientes" USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_catalogo_modulos" ON "public"."catalogo_modulos" USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_escalas_legales" ON "public"."escalas_legales" USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_formulas_cese" ON "public"."formulas_cese" USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_precios_ia_modelo" ON "public"."precios_ia_modelo" USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_prestadoras" ON "public"."prestadoras" USING (("public"."es_superadmin"() AND ("id" = "public"."current_tenant"())));



CREATE POLICY "superadmin_gestiona_su_propia_sesion_de_soporte" ON "public"."sesiones_soporte_tecnico" USING ((("admin_id" = "auth"."uid"()) AND "public"."es_superadmin"())) WITH CHECK ((("admin_id" = "auth"."uid"()) AND "public"."es_superadmin"()));



CREATE POLICY "superadmin_gestiona_tareas_tipo_asistente" ON "public"."tareas_tipo_asistente" USING ("public"."es_superadmin"()) WITH CHECK ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_textos_consentimiento" ON "public"."textos_consentimiento" USING ("public"."es_superadmin"()) WITH CHECK ("public"."es_superadmin"());



CREATE POLICY "superadmin_gestiona_tipos_asistente" ON "public"."tipos_asistente" USING ("public"."es_superadmin"()) WITH CHECK ("public"."es_superadmin"());



CREATE POLICY "superadmin_lee_auditoria_de_su_sesion_activa" ON "public"."auditoria_soporte_tecnico" FOR SELECT USING (("public"."es_superadmin"() AND ("prestadora_id" = "public"."current_tenant"())));



CREATE POLICY "superadmin_lee_modalidades" ON "public"."prestadora_modalidades" FOR SELECT USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_lee_pasarela" ON "public"."prestadora_pasarela_pago" FOR SELECT USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_lee_prestadora_modulos" ON "public"."prestadora_modulos" FOR SELECT USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_lee_prestadoras" ON "public"."prestadoras" FOR SELECT USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_lee_toda_la_auditoria" ON "public"."auditoria_soporte_tecnico" FOR SELECT USING ("public"."es_superadmin"());



CREATE POLICY "superadmin_lee_uso_ia" ON "public"."uso_ia" USING ("public"."es_superadmin"());



ALTER TABLE "public"."suscripciones_marketplace" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tareas_tipo_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."textos_consentimiento" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tipos_asistente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tipos_documento_asistente" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "todos_leen_tareas_tipo_asistente_visibles" ON "public"."tareas_tipo_asistente" FOR SELECT USING ((("prestadora_id" IS NULL) OR ("prestadora_id" = "public"."current_tenant"())));



CREATE POLICY "todos_leen_tipos_asistente_visibles" ON "public"."tipos_asistente" FOR SELECT USING ((("prestadora_id" IS NULL) OR ("prestadora_id" = "public"."current_tenant"())));



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




























































































































































GRANT ALL ON FUNCTION "public"."asistente_asignado_a_familia"("p_asistente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."asistente_asignado_a_familia"("p_asistente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."asistente_asignado_a_familia"("p_asistente_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."asistente_atiende_a_la_familia"("p_asistente_id" "uuid", "p_familia_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."asistente_atiende_a_la_familia"("p_asistente_id" "uuid", "p_familia_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."asistente_atiende_a_la_familia"("p_asistente_id" "uuid", "p_familia_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bloquear_edicion_laboral_coordinador"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bloquear_edicion_laboral_coordinador"() TO "service_role";



GRANT ALL ON FUNCTION "public"."consentimiento_seguimiento_vigente"("p_asistente_id" "uuid", "p_clave" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."consentimiento_seguimiento_vigente"("p_asistente_id" "uuid", "p_clave" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."consentimiento_seguimiento_vigente"("p_asistente_id" "uuid", "p_clave" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."coordinador_alcanza_guardia"("p_asistente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."coordinador_alcanza_guardia"("p_asistente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."coordinador_alcanza_guardia"("p_asistente_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_tenant"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_tenant"() TO "service_role";
GRANT ALL ON FUNCTION "public"."current_tenant"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_tenant"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."dia_en_que_termina_guardia"("p_fecha" "date", "p_hora_inicio" time without time zone, "p_hora_fin" time without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."dia_en_que_termina_guardia"("p_fecha" "date", "p_hora_inicio" time without time zone, "p_hora_fin" time without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dia_en_que_termina_guardia"("p_fecha" "date", "p_hora_inicio" time without time zone, "p_hora_fin" time without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."es_admin_prestadora"() TO "anon";
GRANT ALL ON FUNCTION "public"."es_admin_prestadora"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."es_admin_prestadora"() TO "service_role";



GRANT ALL ON FUNCTION "public"."es_asistente"() TO "anon";
GRANT ALL ON FUNCTION "public"."es_asistente"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."es_asistente"() TO "service_role";



GRANT ALL ON FUNCTION "public"."es_sesion_soporte_activa"() TO "anon";
GRANT ALL ON FUNCTION "public"."es_sesion_soporte_activa"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."es_sesion_soporte_activa"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."es_superadmin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."es_superadmin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."es_superadmin"() TO "anon";
GRANT ALL ON FUNCTION "public"."es_superadmin"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."exigir_matricula_en_guardia"() TO "anon";
GRANT ALL ON FUNCTION "public"."exigir_matricula_en_guardia"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."exigir_matricula_en_guardia"() TO "service_role";



GRANT ALL ON FUNCTION "public"."exigir_matricula_en_oferta"() TO "anon";
GRANT ALL ON FUNCTION "public"."exigir_matricula_en_oferta"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."exigir_matricula_en_oferta"() TO "service_role";



GRANT ALL ON FUNCTION "public"."exigir_paciente_del_turno"() TO "anon";
GRANT ALL ON FUNCTION "public"."exigir_paciente_del_turno"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."exigir_paciente_del_turno"() TO "service_role";



GRANT ALL ON FUNCTION "public"."exigir_paciente_y_servicio_de_la_misma_familia"("p_paciente_id" "uuid", "p_servicio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."exigir_paciente_y_servicio_de_la_misma_familia"("p_paciente_id" "uuid", "p_servicio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."exigir_paciente_y_servicio_de_la_misma_familia"("p_paciente_id" "uuid", "p_servicio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."familia_id_de_usuario"("p_usuario_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."familia_id_de_usuario"("p_usuario_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."familia_id_de_usuario"("p_usuario_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."familia_id_de_usuario"("p_usuario_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_auditoria_soporte_mutacion"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_auditoria_soporte_mutacion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_auditoria_soporte_mutacion"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guardar_credencial_pasarela_pago"("p_prestadora_id" "uuid", "p_proveedor" "text", "p_credencial" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guardar_credencial_pasarela_pago"("p_prestadora_id" "uuid", "p_proveedor" "text", "p_credencial" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."guardar_credencial_smtp_prestadora"("p_prestadora_id" "uuid", "p_password" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guardar_credencial_smtp_prestadora"("p_prestadora_id" "uuid", "p_password" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."guardar_token_whatsapp"("p_prestadora_id" "uuid", "p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guardar_token_whatsapp"("p_prestadora_id" "uuid", "p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."guardias_del_paciente"("p_paciente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."guardias_del_paciente"("p_paciente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."guardias_del_paciente"("p_paciente_id" "uuid") TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."motivo_bloqueo_matricula"("p_asistente_id" "uuid", "p_dia" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."motivo_bloqueo_matricula"("p_asistente_id" "uuid", "p_dia" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."motivo_bloqueo_matricula"("p_asistente_id" "uuid", "p_dia" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."motivo_bloqueo_matricula"("p_asistente_id" "uuid", "p_dia" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."pacientes_de_la_guardia"("p_guardia_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."pacientes_de_la_guardia"("p_guardia_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pacientes_de_la_guardia"("p_guardia_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."pacientes_de_la_serie"("p_serie_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."pacientes_de_la_serie"("p_serie_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pacientes_de_la_serie"("p_serie_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."permisos_efectivos_de"("p_usuario" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."permisos_efectivos_de"("p_usuario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."permisos_efectivos_de"("p_usuario" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."prestadora_oculta_marca_producto"("p_prestadora_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."prestadora_oculta_marca_producto"("p_prestadora_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prestadora_oculta_marca_producto"("p_prestadora_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prestadora_tiene_modalidad_activa"("p_prestadora_id" "uuid", "p_modalidad" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prestadora_tiene_modalidad_activa"("p_prestadora_id" "uuid", "p_modalidad" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."prestadora_tiene_modalidad_activa"("p_prestadora_id" "uuid", "p_modalidad" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prestadora_tiene_modalidad_activa"("p_prestadora_id" "uuid", "p_modalidad" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sincronizar_paciente_principal_de_guardia"() TO "anon";
GRANT ALL ON FUNCTION "public"."sincronizar_paciente_principal_de_guardia"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sincronizar_paciente_principal_de_guardia"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sincronizar_paciente_principal_de_serie"() TO "anon";
GRANT ALL ON FUNCTION "public"."sincronizar_paciente_principal_de_serie"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sincronizar_paciente_principal_de_serie"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tiene_permiso"("p_accion" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tiene_permiso"("p_accion" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."tiene_permiso"("p_accion" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tiene_permiso"("p_accion" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."tiene_permiso_de"("p_usuario" "uuid", "p_accion" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."tiene_permiso_de"("p_usuario" "uuid", "p_accion" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tiene_permiso_de"("p_usuario" "uuid", "p_accion" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_paciente_de_guardia_misma_familia"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_paciente_de_guardia_misma_familia"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_paciente_de_guardia_misma_familia"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_paciente_de_serie_misma_familia"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_paciente_de_serie_misma_familia"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_paciente_de_serie_misma_familia"() TO "service_role";



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



GRANT ALL ON TABLE "public"."auditoria_advertencias_legales" TO "anon";
GRANT ALL ON TABLE "public"."auditoria_advertencias_legales" TO "authenticated";
GRANT ALL ON TABLE "public"."auditoria_advertencias_legales" TO "service_role";



GRANT ALL ON TABLE "public"."auditoria_soporte_tecnico" TO "anon";
GRANT ALL ON TABLE "public"."auditoria_soporte_tecnico" TO "authenticated";
GRANT ALL ON TABLE "public"."auditoria_soporte_tecnico" TO "service_role";



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



GRANT ALL ON TABLE "public"."catalogo_acciones_permisos" TO "anon";
GRANT ALL ON TABLE "public"."catalogo_acciones_permisos" TO "authenticated";
GRANT ALL ON TABLE "public"."catalogo_acciones_permisos" TO "service_role";



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



GRANT ALL ON TABLE "public"."configuracion_aviso_guardia_sin_cubrir" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_aviso_guardia_sin_cubrir" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_aviso_guardia_sin_cubrir" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_email_prestadora" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_email_prestadora" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_email_prestadora" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_escalada_coordinador" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_escalada_coordinador" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_escalada_coordinador" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_escalada_relevo" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_escalada_relevo" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_escalada_relevo" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_matricula_via_medicacion" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_matricula_via_medicacion" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_matricula_via_medicacion" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_notificaciones" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_notificaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_notificaciones" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_plataforma" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_plataforma" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_plataforma" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_prestadora" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_prestadora" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_prestadora" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_visibilidad_app" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_visibilidad_app" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_visibilidad_app" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_whatsapp_prestadora" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_whatsapp_prestadora" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_whatsapp_prestadora" TO "service_role";



GRANT ALL ON TABLE "public"."consentimientos_asistente" TO "anon";
GRANT ALL ON TABLE "public"."consentimientos_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."consentimientos_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."conversaciones_whatsapp" TO "anon";
GRANT ALL ON TABLE "public"."conversaciones_whatsapp" TO "authenticated";
GRANT ALL ON TABLE "public"."conversaciones_whatsapp" TO "service_role";



GRANT ALL ON TABLE "public"."credenciales_pasarela_pago" TO "anon";
GRANT ALL ON TABLE "public"."credenciales_pasarela_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."credenciales_pasarela_pago" TO "service_role";



GRANT ALL ON TABLE "public"."datos_reservados_asistente" TO "anon";
GRANT ALL ON TABLE "public"."datos_reservados_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."datos_reservados_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."documentos_asistente" TO "anon";
GRANT ALL ON TABLE "public"."documentos_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."documentos_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."domicilios_temporales_paciente" TO "anon";
GRANT ALL ON TABLE "public"."domicilios_temporales_paciente" TO "authenticated";
GRANT ALL ON TABLE "public"."domicilios_temporales_paciente" TO "service_role";



GRANT ALL ON TABLE "public"."escalas_legales" TO "anon";
GRANT ALL ON TABLE "public"."escalas_legales" TO "authenticated";
GRANT ALL ON TABLE "public"."escalas_legales" TO "service_role";



GRANT ALL ON TABLE "public"."matriculas_asistente" TO "anon";
GRANT ALL ON TABLE "public"."matriculas_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."matriculas_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."prestadoras" TO "anon";
GRANT ALL ON TABLE "public"."prestadoras" TO "authenticated";
GRANT ALL ON TABLE "public"."prestadoras" TO "service_role";



GRANT ALL ON TABLE "public"."tipos_asistente" TO "anon";
GRANT ALL ON TABLE "public"."tipos_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."tipos_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."estado_matricula_asistente" TO "anon";
GRANT ALL ON TABLE "public"."estado_matricula_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."estado_matricula_asistente" TO "service_role";



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



GRANT ALL ON TABLE "public"."familias" TO "anon";
GRANT ALL ON TABLE "public"."familias" TO "authenticated";
GRANT ALL ON TABLE "public"."familias" TO "service_role";



GRANT ALL ON TABLE "public"."formulas_cese" TO "anon";
GRANT ALL ON TABLE "public"."formulas_cese" TO "authenticated";
GRANT ALL ON TABLE "public"."formulas_cese" TO "service_role";



GRANT ALL ON TABLE "public"."guardia_pacientes" TO "anon";
GRANT ALL ON TABLE "public"."guardia_pacientes" TO "authenticated";
GRANT ALL ON TABLE "public"."guardia_pacientes" TO "service_role";



GRANT ALL ON TABLE "public"."guardias" TO "anon";
GRANT ALL ON TABLE "public"."guardias" TO "authenticated";
GRANT ALL ON TABLE "public"."guardias" TO "service_role";



GRANT ALL ON TABLE "public"."guardias_cobertura" TO "anon";
GRANT ALL ON TABLE "public"."guardias_cobertura" TO "authenticated";
GRANT ALL ON TABLE "public"."guardias_cobertura" TO "service_role";



GRANT ALL ON TABLE "public"."guardias_tracking_gps" TO "anon";
GRANT ALL ON TABLE "public"."guardias_tracking_gps" TO "authenticated";
GRANT ALL ON TABLE "public"."guardias_tracking_gps" TO "service_role";



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



GRANT ALL ON TABLE "public"."ofertas_guardia" TO "anon";
GRANT ALL ON TABLE "public"."ofertas_guardia" TO "authenticated";
GRANT ALL ON TABLE "public"."ofertas_guardia" TO "service_role";



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



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."qr_cobro_efectivo" TO "anon";
GRANT ALL ON TABLE "public"."qr_cobro_efectivo" TO "authenticated";
GRANT ALL ON TABLE "public"."qr_cobro_efectivo" TO "service_role";



GRANT ALL ON TABLE "public"."rangos_referencia_vitales" TO "anon";
GRANT ALL ON TABLE "public"."rangos_referencia_vitales" TO "authenticated";
GRANT ALL ON TABLE "public"."rangos_referencia_vitales" TO "service_role";



GRANT ALL ON TABLE "public"."remuneraciones_asistente" TO "anon";
GRANT ALL ON TABLE "public"."remuneraciones_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."remuneraciones_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."reportes" TO "anon";
GRANT ALL ON TABLE "public"."reportes" TO "authenticated";
GRANT ALL ON TABLE "public"."reportes" TO "service_role";



GRANT ALL ON TABLE "public"."series_guardias" TO "anon";
GRANT ALL ON TABLE "public"."series_guardias" TO "authenticated";
GRANT ALL ON TABLE "public"."series_guardias" TO "service_role";



GRANT ALL ON TABLE "public"."series_guardias_pacientes" TO "anon";
GRANT ALL ON TABLE "public"."series_guardias_pacientes" TO "authenticated";
GRANT ALL ON TABLE "public"."series_guardias_pacientes" TO "service_role";



GRANT ALL ON TABLE "public"."servicios" TO "anon";
GRANT ALL ON TABLE "public"."servicios" TO "authenticated";
GRANT ALL ON TABLE "public"."servicios" TO "service_role";



GRANT ALL ON TABLE "public"."sesiones_soporte_tecnico" TO "anon";
GRANT ALL ON TABLE "public"."sesiones_soporte_tecnico" TO "authenticated";
GRANT ALL ON TABLE "public"."sesiones_soporte_tecnico" TO "service_role";



GRANT ALL ON TABLE "public"."solicitudes" TO "anon";
GRANT ALL ON TABLE "public"."solicitudes" TO "authenticated";
GRANT ALL ON TABLE "public"."solicitudes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."solicitudes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."solicitudes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."solicitudes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."suscripciones_marketplace" TO "anon";
GRANT ALL ON TABLE "public"."suscripciones_marketplace" TO "authenticated";
GRANT ALL ON TABLE "public"."suscripciones_marketplace" TO "service_role";



GRANT ALL ON TABLE "public"."tareas_tipo_asistente" TO "anon";
GRANT ALL ON TABLE "public"."tareas_tipo_asistente" TO "authenticated";
GRANT ALL ON TABLE "public"."tareas_tipo_asistente" TO "service_role";



GRANT ALL ON TABLE "public"."textos_consentimiento" TO "anon";
GRANT ALL ON TABLE "public"."textos_consentimiento" TO "authenticated";
GRANT ALL ON TABLE "public"."textos_consentimiento" TO "service_role";



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
































--
-- Dumped schema changes for auth and storage
--

CREATE POLICY "marca_prestadoras_borra_su_propio_logo" ON "storage"."objects" FOR DELETE USING ((("bucket_id" = 'marca-prestadoras'::"text") AND (("storage"."foldername"("name"))[1] = ("public"."current_tenant"())::"text")));



CREATE POLICY "marca_prestadoras_lectura_publica" ON "storage"."objects" FOR SELECT USING (("bucket_id" = 'marca-prestadoras'::"text"));



CREATE POLICY "marca_prestadoras_reemplaza_su_propio_logo" ON "storage"."objects" FOR UPDATE USING ((("bucket_id" = 'marca-prestadoras'::"text") AND (("storage"."foldername"("name"))[1] = ("public"."current_tenant"())::"text"))) WITH CHECK ((("bucket_id" = 'marca-prestadoras'::"text") AND (("storage"."foldername"("name"))[1] = ("public"."current_tenant"())::"text")));



CREATE POLICY "marca_prestadoras_sube_su_propio_logo" ON "storage"."objects" FOR INSERT WITH CHECK ((("bucket_id" = 'marca-prestadoras'::"text") AND (("storage"."foldername"("name"))[1] = ("public"."current_tenant"())::"text")));


--
-- Catálogo de la plataforma
--
-- Las filas que el producto trae de fábrica. No hay acá ni un dato de una Prestadora ni
-- de una persona: eso lo siembra `seed.sql` y solo en la base local de pruebas.
-- Todas las altas son `ON CONFLICT ... DO NOTHING`, así que volver a correr este archivo
-- sobre una base que ya las tiene no cambia nada.
--

-- La fila única de configuración de la plataforma. Existe siempre; sus valores se
-- cambian desde el Panel, no acá.
INSERT INTO public.configuracion_plataforma (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- Los módulos del producto, tal como se ven en el Panel.
INSERT INTO public.catalogo_modulos (key, nombre, descripcion) VALUES
  ('aurevia.marca.personalizada', 'Marca sin la línea del producto',
   'Apaga la línea del producto al pie de las pantallas que ven la Familia y el Asistente. Sin esta función contratada, la línea se muestra, que es el comportamiento por defecto.')
ON CONFLICT (key) DO NOTHING;

-- Las acciones del Panel que se pueden repartir entre Admin y Coordinador, con el
-- reparto que trae el producto de fábrica. Cada Prestadora lo cambia desde su Panel.
INSERT INTO public.catalogo_acciones_permisos (accion, default_solo_admin, orden) VALUES
  ('alta_manual_asistente', TRUE, 1),
  ('alta_manual_familia', TRUE, 2),
  ('editar_identidad_asistente', FALSE, 3),
  ('editar_datos_familia', FALSE, 4),
  ('editar_datos_paciente', FALSE, 5),
  ('importar_datos_masivos', TRUE, 6),
  ('validar_informe_obra_social', TRUE, 7),
  ('ver_pagos_asistente', TRUE, 8),
  ('ver_datos_reservados_asistente', TRUE, 9)
ON CONFLICT (accion) DO NOTHING;

-- La advertencia que se muestra al activar una función con riesgo legal conocido
-- (CLAUDE.md §3). Solo Argentina, que es la única jurisdicción con documento legal:
-- sin fila no hay advertencia, y eso es a propósito — no se inventa una por analogía.
INSERT INTO public.advertencias_legales (jurisdiccion, funcion_clave, texto_advertencia) VALUES
  ('AR', 'horarios_fijos',
   'Imponer horarios fijos (en vez de que el Asistente decida su disponibilidad) es uno de los indicios más fuertes de subordinación bajo el art. 23 de la LCT.'),
  ('AR', 'limite_oportunidades_rechazos',
   'Limitar a un Asistente autónomo por rechazar Guardias reduce su libertad real de decidir su participación, un elemento central para sostener que la relación es autónoma y no dependiente (art. 23 LCT).'),
  ('AR', 'niveles_categorias',
   'Establecer niveles o categorías jerárquicas puede interpretarse como una estructura organizativa propia de relación de dependencia (art. 23 LCT).'),
  ('AR', 'penalizacion_inasistencias',
   'Penalizar inasistencias o inconductas de un Asistente autónomo puede interpretarse como ejercicio de poder disciplinario, un indicio de subordinación bajo el art. 23 de la LCT. Conviene evaluar si esta función es coherente con la modalidad de vínculo de los Asistentes.'),
  ('AR', 'puntuacion_aceptacion_guardia',
   'Puntuar la aceptación de Guardias y usarlo para asignar futuras oportunidades puede funcionar como una exigencia de disponibilidad, un indicio de subordinación (art. 23 LCT) más que de autonomía real del Asistente.'),
  ('AR', 'puntuacion_calificacion_familia',
   'Condicionar oportunidades futuras a una calificación de terceros puede interpretarse como una forma de evaluación de desempeño propia de una relación laboral (art. 23 LCT).'),
  ('AR', 'rankings',
   'Publicar rankings que condicionan el acceso futuro a Guardias puede interpretarse como una forma de control jerárquico propia de una relación de dependencia (art. 23 LCT).')
ON CONFLICT (jurisdiccion, funcion_clave) DO NOTHING;

-- Lo que lee y acepta el Asistente antes de que se le registre la ubicación.
-- TEXTOS DE RELLENO, SIN VALIDEZ LEGAL: van con es_borrador = TRUE, así que ninguna
-- aceptación sobre ellos habilita nada. Cuando llegue la redacción del abogado entra
-- como versión 2 en una migración nueva, y esta versión 1 queda vencida.
INSERT INTO public.textos_consentimiento
  (jurisdiccion, clave, modalidad, version, idioma, titulo, cuerpo, puntos_clave, es_borrador) VALUES
  ('AR', 'seguimiento_ubicacion', 'autonomo', 1, 'en',
   'DRAFT TEXT — Recording your location on your way to a shift',
   'THIS IS PLACEHOLDER TEXT AND HAS NO LEGAL VALIDITY.

Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
   '{"DRAFT — Placeholder point, pending legal wording."}',
   TRUE),
  ('AR', 'seguimiento_ubicacion', 'autonomo', 1, 'es-AR',
   'TEXTO PROVISORIO — Registro de la ubicación en el trayecto hacia una guardia',
   'ESTE TEXTO ES DE RELLENO Y NO TIENE VALIDEZ LEGAL. Está acá para poder construir y probar la pantalla mientras se consigue la redacción profesional.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Esta versión es la de quien trabaja de forma autónoma y acepta guardias por su cuenta.

Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Acá va a ir la diferencia con la versión de relación de dependencia: este seguimiento se acepta como parte de un servicio que se ofrece, no como condición de un empleo.',
   '{"PROVISORIO — Qué se registra: solo el recorrido hacia la guardia aceptada.","PROVISORIO — Quién lo ve: la Prestadora que publicó la guardia.","PROVISORIO — Cuánto se guarda: [pendiente de definir con el abogado].","PROVISORIO — Se puede retirar en cualquier momento, desde Mi Perfil."}',
   TRUE),
  ('AR', 'seguimiento_ubicacion', 'autonomo', 1, 'pt-BR',
   'TEXTO PROVISÓRIO — Registro da sua localização a caminho do plantão',
   'ESTE TEXTO É DE PREENCHIMENTO E NÃO TEM VALIDADE LEGAL.

Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
   '{"PROVISÓRIO — Ponto de preenchimento, aguardando redação legal."}',
   TRUE),
  ('AR', 'seguimiento_ubicacion', 'dependencia', 1, 'en',
   'DRAFT TEXT — Recording your location on your way to a shift',
   'THIS IS PLACEHOLDER TEXT AND HAS NO LEGAL VALIDITY. It exists so the screen can be built and tested while the professional wording is obtained.

Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
   '{"DRAFT — Placeholder point, pending legal wording."}',
   TRUE),
  ('AR', 'seguimiento_ubicacion', 'dependencia', 1, 'es-AR',
   'TEXTO PROVISORIO — Registro de la ubicación en el trayecto hacia una guardia',
   'ESTE TEXTO ES DE RELLENO Y NO TIENE VALIDEZ LEGAL. Está acá para poder construir y probar la pantalla mientras se consigue la redacción profesional.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Esta sección va a explicar, en palabras simples, qué se registra del recorrido hacia una guardia y para qué se usa ese dato.

Sed do eiusmod tempor incididunt ut labore. Acá va a ir la finalidad concreta: saber con tiempo si una guardia se va a poder cubrir, y nada más que eso.

Ut enim ad minim veniam, quis nostrud exercitation. Acá va a ir qué NO se hace con el dato: no se comparte con la Familia, no se usa fuera del horario del trayecto, no se guarda para siempre.

Duis aute irure dolor in reprehenderit in voluptate velit esse. Acá va a ir cómo se retira este consentimiento y qué pasa cuando se retira.',
   '{"PROVISORIO — Qué se registra: solo el recorrido hacia la guardia.","PROVISORIO — Cuándo empieza: al avisar la salida. Cuándo termina: al llegar.","PROVISORIO — Quién lo ve: la Prestadora. La Familia ve solo la hora estimada de llegada, nunca el lugar exacto.","PROVISORIO — Cuánto se guarda: [pendiente de definir con el abogado].","PROVISORIO — Se puede retirar en cualquier momento, desde Mi Perfil."}',
   TRUE),
  ('AR', 'seguimiento_ubicacion', 'dependencia', 1, 'pt-BR',
   'TEXTO PROVISÓRIO — Registro da sua localização a caminho do plantão',
   'ESTE TEXTO É DE PREENCHIMENTO E NÃO TEM VALIDADE LEGAL. Está aqui para permitir construir e testar a tela enquanto se obtém a redação profissional.

Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
   '{"PROVISÓRIO — Ponto de preenchimento, aguardando redação legal."}',
   TRUE)
ON CONFLICT (jurisdiccion, clave, modalidad, version, idioma) DO NOTHING;

-- El catálogo general de tipos de Asistente, el que trae el producto. Cada Prestadora
-- suma los suyos con su `prestadora_id`. El nombre visible no está acá: sale de las
-- traducciones, por la clave (CLAUDE.md §7 regla 1).
INSERT INTO public.tipos_asistente (clave, requiere_matricula, tipo_matricula, orden) VALUES
  ('cuidador', FALSE, NULL, 10),
  ('enfermero', TRUE, 'enfermeria', 20),
  ('kinesiologo', TRUE, 'kinesiologia', 30),
  ('medico', TRUE, 'medicina', 40)
ON CONFLICT DO NOTHING;

-- El depósito donde cada Prestadora sube su logo.
INSERT INTO storage.buckets (id, name, public) VALUES ('marca-prestadoras', 'marca-prestadoras', TRUE) ON CONFLICT (id) DO NOTHING;

--
-- El volcado arranca poniendo `search_path` en vacío, que obliga a nombrar el esquema
-- delante de cada tabla. Se lo devuelve a su valor normal para que lo que corra después
-- en la misma sesión —la siembra de la base local, por ejemplo— encuentre las tablas
-- sin tener que escribir `public.` adelante.
--
RESET search_path;

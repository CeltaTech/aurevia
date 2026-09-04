-- =============================================================================
-- Las dos aplicaciones leen con su propio pase  (pendiente #170)
-- =============================================================================
--
-- QUÉ PROBLEMA CIERRA
--
-- El motor atiende a las aplicaciones de Asistente y de Familia con la clave maestra, que se
-- saltea la protección por fila. El aislamiento entre Prestadoras existe, pero vive entero en el
-- código de cada ruta: un filtro olvidado en una consulta nueva devuelve datos de otra
-- Organización sin que nada abajo lo impida. La segunda red no está puesta.
--
-- Esta migración pone la segunda red: escribe las políticas que faltaban para que un Asistente y
-- una Familia, consultando con su propio pase, lean exactamente lo suyo y nada más. Las tablas
-- que ya las tenían no se tocan.
--
-- NO cambia quién consulta. El motor sigue usando la clave maestra hoy; el cambio de pase es una
-- decisión aparte, porque obliga a publicar dos funciones que hoy no lo están. Lo que cambia acá
-- es que la base deja de depender de que la pantalla se acuerde de filtrar.
--
-- CÓMO SE RESUELVE LA ORGANIZACIÓN
--
-- Siempre con `interno.current_tenant()`, que la saca de la membresía de quien inició sesión,
-- nunca de un valor que venga en el pedido. La identidad de las dos aplicaciones es directa:
-- `asistentes.id` y `familias.id` son el identificador de la sesión, y `miembros_familia`
-- alcanza al resto del grupo familiar por `interno.familia_id_de_usuario()`.
--
-- PUNTO ÚNICO DE VERDAD
--
-- Tres condiciones se repetían en más de una política y por eso se convierten en función:
-- «los Pacientes de las Guardias de este Asistente», «los Pacientes de esta Familia» y «quien
-- consulta es una Familia». Ninguna política copia esas condiciones: todas llaman a la función.
-- Nacen en el esquema `interno`, que no se publica, según la regla del 2026-09-04.
--
-- LO QUE DELIBERADAMENTE NO RECIBE POLÍTICA
--
-- Estas escrituras las hace el sistema, no la persona, y se quedan solamente al alcance de la
-- clave maestra. Darles política sería dejar que la persona auditada firme su propia auditoría:
--
--   `uso_ia` (alta) y `precios_ia_modelo` (lectura)  — contabilidad de costos del sistema.
--   `auditoria_cambio_dueno_push` (alta)             — un registro de auditoría no se falsifica.
--   `alertas` (alta) y `pacientes` (modificación) desde el análisis con IA — actúa el sistema.
--   `tokens_activacion_cuenta`                       — todavía no hay sesión que evaluar.
--
-- DEPÓSITOS DE ARCHIVOS
--
-- Al escribir esto se encontró que `reportes-fotos` y `prescripciones-medicacion` no existen: no
-- los crea ninguna migración y no están en la base. Las tres subidas que los usan sólo pueden
-- estar fallando. Se crean acá, privados, con la ruta empezando por la Organización y la
-- política exigiéndolo, como manda la regla de la empresa.
--
-- ROL DE LAS POLÍTICAS NUEVAS
--
-- Todas van `TO authenticated`. Quien no inició sesión no llega ni a evaluar la condición.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Los tres puntos únicos de verdad
-- -----------------------------------------------------------------------------

-- Los Pacientes de las Guardias del Asistente que consulta.
-- `guardia_pacientes` es la fuente completa: hoy no hay ninguna Guardia sin fila ahí, y es la
-- misma que ya usa `interno.asistente_atiende_a_la_familia`.
CREATE OR REPLACE FUNCTION "interno"."pacientes_del_asistente"()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, interno
AS $$
  SELECT gp.paciente_id
  FROM guardia_pacientes gp
  JOIN guardias g ON g.id = gp.guardia_id
  WHERE g.asistente_id = auth.uid()
$$;

-- Los Pacientes de la Familia que consulta, ya acotados a su Organización.
CREATE OR REPLACE FUNCTION "interno"."pacientes_de_la_familia"()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, interno
AS $$
  SELECT p.id
  FROM pacientes p
  WHERE p.prestadora_id = interno.current_tenant()
    AND p.familia_id = interno.familia_id_de_usuario(auth.uid())
$$;

-- Quien consulta pertenece a un grupo familiar. El espejo de `interno.es_asistente()`.
CREATE OR REPLACE FUNCTION "interno"."es_familia"()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, interno
AS $$
  SELECT interno.familia_id_de_usuario(auth.uid()) IS NOT NULL
$$;

DO $$
DECLARE
  firma text;
BEGIN
  FOREACH firma IN ARRAY ARRAY[
    'interno.pacientes_del_asistente()',
    'interno.pacientes_de_la_familia()',
    'interno.es_familia()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, "anon";', firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO "authenticated", "service_role";', firma);
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Quién es quién: la ficha propia y la contraparte asignada
-- -----------------------------------------------------------------------------

-- El Asistente lee su propia ficha. Es lo primero que pide su aplicación al entrar.
DROP POLICY IF EXISTS "asistente_lee_su_ficha" ON "public"."asistentes";
CREATE POLICY "asistente_lee_su_ficha" ON "public"."asistentes"
  FOR SELECT TO "authenticated"
  USING (id = auth.uid());

-- La Familia lee la ficha del Asistente que atiende a alguno de sus Pacientes, y de ninguno más.
DROP POLICY IF EXISTS "familia_lee_asistente_asignado" ON "public"."asistentes";
CREATE POLICY "familia_lee_asistente_asignado" ON "public"."asistentes"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.asistente_atiende_a_la_familia(id, interno.familia_id_de_usuario(auth.uid()))
  );

-- El Asistente lee los Pacientes de sus Guardias. La Familia ya tenía la suya.
DROP POLICY IF EXISTS "asistente_lee_pacientes_de_sus_guardias" ON "public"."pacientes";
CREATE POLICY "asistente_lee_pacientes_de_sus_guardias" ON "public"."pacientes"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND id IN (SELECT interno.pacientes_del_asistente())
  );

-- Las dos aplicaciones leen la Prestadora en la que están, para la marca y la configuración.
DROP POLICY IF EXISTS "asistente_o_familia_lee_su_prestadora" ON "public"."prestadoras";
CREATE POLICY "asistente_o_familia_lee_su_prestadora" ON "public"."prestadoras"
  FOR SELECT TO "authenticated"
  USING (
    id = interno.current_tenant()
    AND (interno.es_asistente() OR interno.es_familia())
  );

-- -----------------------------------------------------------------------------
-- 3. Lo del Asistente sobre sí mismo
-- -----------------------------------------------------------------------------

-- Sus calificaciones. Ya podía cargar el descargo; faltaba poder leerlas.
DROP POLICY IF EXISTS "asistente_lee_sus_calificaciones" ON "public"."calificaciones_asistente";
CREATE POLICY "asistente_lee_sus_calificaciones" ON "public"."calificaciones_asistente"
  FOR SELECT TO "authenticated"
  USING (asistente_id = auth.uid());

-- Sus certificados.
DROP POLICY IF EXISTS "asistente_lee_sus_certificados" ON "public"."certificados";
CREATE POLICY "asistente_lee_sus_certificados" ON "public"."certificados"
  FOR SELECT TO "authenticated"
  USING (asistente_id = auth.uid());

-- Sus matrículas: las lee y carga las suyas. Esta tabla no tiene columna de Organización; la
-- Organización queda acotada por el Asistente, que sí la tiene.
DROP POLICY IF EXISTS "asistente_lee_sus_matriculas" ON "public"."matriculas_asistente";
CREATE POLICY "asistente_lee_sus_matriculas" ON "public"."matriculas_asistente"
  FOR SELECT TO "authenticated"
  USING (asistente_id = auth.uid());

DROP POLICY IF EXISTS "asistente_carga_su_matricula" ON "public"."matriculas_asistente";
CREATE POLICY "asistente_carga_su_matricula" ON "public"."matriculas_asistente"
  FOR INSERT TO "authenticated"
  WITH CHECK (asistente_id = auth.uid());

-- Sus mensajes con la Prestadora: los lee y escribe los propios.
DROP POLICY IF EXISTS "asistente_lee_sus_mensajes" ON "public"."mensajes_asistente";
CREATE POLICY "asistente_lee_sus_mensajes" ON "public"."mensajes_asistente"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND asistente_id = auth.uid()
  );

DROP POLICY IF EXISTS "asistente_escribe_sus_mensajes" ON "public"."mensajes_asistente";
CREATE POLICY "asistente_escribe_sus_mensajes" ON "public"."mensajes_asistente"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND asistente_id = auth.uid()
  );

-- Sus consentimientos. Ya los leía; faltaba registrarlos.
DROP POLICY IF EXISTS "asistente_registra_su_consentimiento" ON "public"."consentimientos_asistente";
CREATE POLICY "asistente_registra_su_consentimiento" ON "public"."consentimientos_asistente"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND asistente_id = auth.uid()
  );

DROP POLICY IF EXISTS "asistente_retira_su_consentimiento" ON "public"."consentimientos_asistente";
CREATE POLICY "asistente_retira_su_consentimiento" ON "public"."consentimientos_asistente"
  FOR UPDATE TO "authenticated"
  USING (asistente_id = auth.uid())
  WITH CHECK (asistente_id = auth.uid());

-- El borrado se acota a lo único que el código borra: un rechazo que se reemplaza por una
-- decisión nueva. Un consentimiento otorgado es prueba de que se autorizó algo, y no se borra
-- ni siquiera cambiando de opinión: se retira, que queda registrado.
DROP POLICY IF EXISTS "asistente_reemplaza_su_rechazo" ON "public"."consentimientos_asistente";
CREATE POLICY "asistente_reemplaza_su_rechazo" ON "public"."consentimientos_asistente"
  FOR DELETE TO "authenticated"
  USING (
    asistente_id = auth.uid()
    AND decision = 'rechazado'
  );

-- -----------------------------------------------------------------------------
-- 4. Lo clínico del Paciente, cada lado por su vínculo
-- -----------------------------------------------------------------------------

-- Autorizaciones de monitoreo: el Asistente por sus Guardias, la Familia por sus Pacientes.
DROP POLICY IF EXISTS "asistente_lee_autorizaciones_de_sus_pacientes" ON "public"."autorizaciones_monitoreo_paciente";
CREATE POLICY "asistente_lee_autorizaciones_de_sus_pacientes" ON "public"."autorizaciones_monitoreo_paciente"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND paciente_id IN (SELECT interno.pacientes_del_asistente())
  );

DROP POLICY IF EXISTS "familia_lee_autorizaciones_de_sus_pacientes" ON "public"."autorizaciones_monitoreo_paciente";
CREATE POLICY "familia_lee_autorizaciones_de_sus_pacientes" ON "public"."autorizaciones_monitoreo_paciente"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND paciente_id IN (SELECT interno.pacientes_de_la_familia())
  );

-- Rangos de referencia de los signos vitales.
DROP POLICY IF EXISTS "asistente_lee_rangos_de_sus_pacientes" ON "public"."rangos_referencia_vitales";
CREATE POLICY "asistente_lee_rangos_de_sus_pacientes" ON "public"."rangos_referencia_vitales"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND paciente_id IN (SELECT interno.pacientes_del_asistente())
  );

DROP POLICY IF EXISTS "familia_lee_rangos_de_sus_pacientes" ON "public"."rangos_referencia_vitales";
CREATE POLICY "familia_lee_rangos_de_sus_pacientes" ON "public"."rangos_referencia_vitales"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND paciente_id IN (SELECT interno.pacientes_de_la_familia())
  );

-- Indicaciones de medicación: las dos aplicaciones las leen, y la Familia carga las de sus
-- Pacientes. El Asistente no las carga: él registra lo que administró, no lo que se indica.
DROP POLICY IF EXISTS "asistente_lee_indicaciones_de_sus_pacientes" ON "public"."indicaciones_medicacion";
CREATE POLICY "asistente_lee_indicaciones_de_sus_pacientes" ON "public"."indicaciones_medicacion"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND paciente_id IN (SELECT interno.pacientes_del_asistente())
  );

DROP POLICY IF EXISTS "familia_lee_indicaciones_de_sus_pacientes" ON "public"."indicaciones_medicacion";
CREATE POLICY "familia_lee_indicaciones_de_sus_pacientes" ON "public"."indicaciones_medicacion"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND paciente_id IN (SELECT interno.pacientes_de_la_familia())
  );

DROP POLICY IF EXISTS "familia_carga_indicaciones_de_sus_pacientes" ON "public"."indicaciones_medicacion";
CREATE POLICY "familia_carga_indicaciones_de_sus_pacientes" ON "public"."indicaciones_medicacion"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND paciente_id IN (SELECT interno.pacientes_de_la_familia())
  );

-- -----------------------------------------------------------------------------
-- 5. La configuración que las dos aplicaciones consultan
-- -----------------------------------------------------------------------------
-- Son cuatro tablas de una fila por Prestadora, sin nada de ninguna persona. Alcanza con estar
-- adentro de la Organización, y por eso el filtro es la Organización y el vínculo.

DROP POLICY IF EXISTS "asistente_lee_configuracion_alertas_ia" ON "public"."configuracion_alertas_ia";
CREATE POLICY "asistente_lee_configuracion_alertas_ia" ON "public"."configuracion_alertas_ia"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.es_asistente()
  );

DROP POLICY IF EXISTS "asistente_lee_configuracion_ausencia_automatica" ON "public"."configuracion_ausencia_automatica";
CREATE POLICY "asistente_lee_configuracion_ausencia_automatica" ON "public"."configuracion_ausencia_automatica"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.es_asistente()
  );

DROP POLICY IF EXISTS "asistente_o_familia_lee_config_matricula_via" ON "public"."configuracion_matricula_via_medicacion";
CREATE POLICY "asistente_o_familia_lee_config_matricula_via" ON "public"."configuracion_matricula_via_medicacion"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND (interno.es_asistente() OR interno.es_familia())
  );

DROP POLICY IF EXISTS "asistente_o_familia_lee_visibilidad_app" ON "public"."configuracion_visibilidad_app";
CREATE POLICY "asistente_o_familia_lee_visibilidad_app" ON "public"."configuracion_visibilidad_app"
  FOR SELECT TO "authenticated"
  USING (
    prestadora_id = interno.current_tenant()
    AND (interno.es_asistente() OR interno.es_familia())
  );

-- -----------------------------------------------------------------------------
-- 6. Los dos depósitos de archivos que faltaban
-- -----------------------------------------------------------------------------
-- Privados: se sirven con dirección firmada y vencimiento, nunca con dirección pública.
-- La ruta empieza siempre por la Organización, y todas las políticas de acá lo exigen.

INSERT INTO storage.buckets (id, name, public)
VALUES ('reportes-fotos', 'reportes-fotos', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('prescripciones-medicacion', 'prescripciones-medicacion', false)
ON CONFLICT (id) DO NOTHING;

-- Fotos de reporte: la ruta es <Organización>/<Guardia>/<archivo>.
-- La comparación es entre textos a propósito: convertir el tramo de la ruta a identificador
-- fallaría con un error de la base ante una ruta inventada, y un error no es una respuesta.

DROP POLICY IF EXISTS "reportes_asistente_sube_foto_de_su_guardia" ON "storage"."objects";
CREATE POLICY "reportes_asistente_sube_foto_de_su_guardia" ON "storage"."objects"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    bucket_id = 'reportes-fotos'
    AND (storage.foldername(name))[1] = (interno.current_tenant())::text
    AND EXISTS (
      SELECT 1 FROM guardias g
      WHERE g.asistente_id = auth.uid()
        AND (storage.foldername(name))[2] = g.id::text
    )
  );

DROP POLICY IF EXISTS "reportes_asistente_lee_fotos_de_sus_guardias" ON "storage"."objects";
CREATE POLICY "reportes_asistente_lee_fotos_de_sus_guardias" ON "storage"."objects"
  FOR SELECT TO "authenticated"
  USING (
    bucket_id = 'reportes-fotos'
    AND (storage.foldername(name))[1] = (interno.current_tenant())::text
    AND EXISTS (
      SELECT 1 FROM guardias g
      WHERE g.asistente_id = auth.uid()
        AND (storage.foldername(name))[2] = g.id::text
    )
  );

DROP POLICY IF EXISTS "reportes_familia_lee_fotos_de_sus_pacientes" ON "storage"."objects";
CREATE POLICY "reportes_familia_lee_fotos_de_sus_pacientes" ON "storage"."objects"
  FOR SELECT TO "authenticated"
  USING (
    bucket_id = 'reportes-fotos'
    AND (storage.foldername(name))[1] = (interno.current_tenant())::text
    AND EXISTS (
      SELECT 1
      FROM guardia_pacientes gp
      WHERE gp.paciente_id IN (SELECT interno.pacientes_de_la_familia())
        AND (storage.foldername(name))[2] = gp.guardia_id::text
    )
  );

-- Prescripciones y matrículas comparten depósito y se distinguen por la ruta:
--   <Organización>/matriculas/<Asistente>/<archivo>   la matrícula del Asistente
--   <Organización>/<Paciente>/<archivo>               la prescripción de un Paciente

DROP POLICY IF EXISTS "prescripciones_asistente_sube_su_matricula" ON "storage"."objects";
CREATE POLICY "prescripciones_asistente_sube_su_matricula" ON "storage"."objects"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    bucket_id = 'prescripciones-medicacion'
    AND (storage.foldername(name))[1] = (interno.current_tenant())::text
    AND (storage.foldername(name))[2] = 'matriculas'
    AND (storage.foldername(name))[3] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "prescripciones_asistente_lee_su_matricula" ON "storage"."objects";
CREATE POLICY "prescripciones_asistente_lee_su_matricula" ON "storage"."objects"
  FOR SELECT TO "authenticated"
  USING (
    bucket_id = 'prescripciones-medicacion'
    AND (storage.foldername(name))[1] = (interno.current_tenant())::text
    AND (storage.foldername(name))[2] = 'matriculas'
    AND (storage.foldername(name))[3] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "prescripciones_familia_sube_la_de_su_paciente" ON "storage"."objects";
CREATE POLICY "prescripciones_familia_sube_la_de_su_paciente" ON "storage"."objects"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    bucket_id = 'prescripciones-medicacion'
    AND (storage.foldername(name))[1] = (interno.current_tenant())::text
    AND (storage.foldername(name))[2] IN (
      SELECT (interno.pacientes_de_la_familia())::text
    )
  );

DROP POLICY IF EXISTS "prescripciones_familia_lee_la_de_su_paciente" ON "storage"."objects";
CREATE POLICY "prescripciones_familia_lee_la_de_su_paciente" ON "storage"."objects"
  FOR SELECT TO "authenticated"
  USING (
    bucket_id = 'prescripciones-medicacion'
    AND (storage.foldername(name))[1] = (interno.current_tenant())::text
    AND (storage.foldername(name))[2] IN (
      SELECT (interno.pacientes_de_la_familia())::text
    )
  );

DROP POLICY IF EXISTS "prescripciones_asistente_lee_la_de_sus_pacientes" ON "storage"."objects";
CREATE POLICY "prescripciones_asistente_lee_la_de_sus_pacientes" ON "storage"."objects"
  FOR SELECT TO "authenticated"
  USING (
    bucket_id = 'prescripciones-medicacion'
    AND (storage.foldername(name))[1] = (interno.current_tenant())::text
    AND (storage.foldername(name))[2] IN (
      SELECT (interno.pacientes_del_asistente())::text
    )
  );

NOTIFY pgrst, 'reload schema';

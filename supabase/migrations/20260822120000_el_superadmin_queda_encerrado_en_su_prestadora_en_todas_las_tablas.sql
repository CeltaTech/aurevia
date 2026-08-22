-- ============================================================================
-- Qué hace: corrige 24 políticas de seguridad que dejaban pasar filas de una
-- Prestadora a quien no debía verlas. Es el mismo defecto que se corrigió ayer
-- en `servicios`, que resultó no ser un caso aislado sino el resto de una
-- tanda escrita con la forma equivocada.
--
-- Por qué: `CLAUDE.md` §5 pone una restricción dura — fuera de una sesión de
-- soporte técnico, un Superadmin tiene acceso de Panel únicamente a la
-- Organización Sandbox. Y §6 cierra con que un error de configuración nunca
-- debe permitir que una Prestadora acceda a información de otra.
--
-- Son dos defectos distintos, no uno.
--
-- ── Defecto 1: el `OR` mal puesto (22 políticas) ────────────────────────────
--
--   mal:  es_superadmin() OR (prestadora_id = current_tenant() AND rol = …)
--   bien: (es_superadmin() AND prestadora_id = current_tenant())
--         OR (prestadora_id = current_tenant() AND rol = …)
--
-- En la forma de arriba `es_superadmin()` alcanza sola para pasar, y esa
-- función no mira la Prestadora: solo mira el rol y, si la Prestadora exige
-- doble factor, que la sesión lo tenga. O sea que un Superadmin veía —y en
-- casi todas podía escribir— las filas de todas las Prestadoras a la vez, sin
-- sesión de soporte abierta y sin que quedara registrado como acceso a
-- ninguna. Entre esas tablas están los Pacientes, las Familias, los reportes
-- diarios, las indicaciones de medicación y las hospitalizaciones.
--
-- La forma correcta ya era la del resto del proyecto (`prestaciones`,
-- `guardias`, `ausencias`, `ceses`, `lista_precios` y unas treinta más). Estas
-- 22 quedaron atrás; acá se las alinea.
--
-- ── Defecto 2: no se comprobaba la Prestadora en absoluto (2 políticas) ─────
--
-- `guardia_pacientes` y `series_guardias_pacientes` —las tablas que dicen qué
-- Pacientes atiende cada guardia— tenían una condición que comprueba que la
-- guardia exista, pero no que sea de la Prestadora de quien pregunta:
--
--   mal:  EXISTS (SELECT 1 FROM guardias g WHERE g.id = guardia_id)
--         AND (es_superadmin() OR rol = …)
--
-- Medido antes de tocar nada: hoy NO se escapa ninguna fila por acá. Lo que
-- las salva es que la RLS de `guardias` y de `series_guardias` también se
-- aplica adentro de esa consulta interna, y esas dos sí están bien acotadas,
-- así que la guardia ajena no aparece y la condición falla. O sea que estas
-- dos tablas están protegidas de rebote, por una tabla vecina, y no por lo
-- que dice su propia política.
--
-- Se arreglan igual, por dos motivos: una protección que depende de otra tabla
-- se cae sin aviso el día que esa otra tabla cambie, y las dos tienen su
-- propia columna `prestadora_id` desde que se crearon, que sencillamente no se
-- estaba usando. No es una fuga tapada: es una fuga que todavía no ocurrió.
--
-- ── Qué NO se toca ──────────────────────────────────────────────────────────
--
-- `advertencias_legales`, `escalas_legales` y `formulas_cese` también dicen
-- `es_superadmin() OR …`, y ahí está bien: no tienen `prestadora_id` porque no
-- son de nadie en particular. Son catálogos de CeltaTech, iguales para todas
-- las Prestadoras, organizados por jurisdicción. No hay Prestadora de la cual
-- aislarlas.
--
-- Cómo se vuelve atrás: con una migración nueva hacia adelante que vuelva a
-- crear las políticas con el texto anterior, que queda escrito acá arriba.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 1 — Tablas con columna `prestadora_id` propia, rol admin_prestadora.
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS panel_gestiona_alertas ON public.alertas;
CREATE POLICY panel_gestiona_alertas ON public.alertas
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_prestadora_lee_su_auditoria_legal ON public.auditoria_advertencias_legales;
CREATE POLICY admin_prestadora_lee_su_auditoria_legal ON public.auditoria_advertencias_legales
  FOR SELECT
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_prestadora_gestiona_autorizaciones_monitoreo ON public.autorizaciones_monitoreo_paciente;
CREATE POLICY admin_prestadora_gestiona_autorizaciones_monitoreo ON public.autorizaciones_monitoreo_paciente
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_gestiona_configuracion_aviso_cese_asistente ON public.configuracion_aviso_cese_asistente;
CREATE POLICY admin_gestiona_configuracion_aviso_cese_asistente ON public.configuracion_aviso_cese_asistente
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_gestiona_configuracion_email_prestadora ON public.configuracion_email_prestadora;
CREATE POLICY admin_gestiona_configuracion_email_prestadora ON public.configuracion_email_prestadora
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_prestadora_gestiona_config_matricula_via ON public.configuracion_matricula_via_medicacion;
CREATE POLICY admin_prestadora_gestiona_config_matricula_via ON public.configuracion_matricula_via_medicacion
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_prestadora_gestiona_etapas_incorporacion ON public.etapas_incorporacion_asistente;
CREATE POLICY admin_prestadora_gestiona_etapas_incorporacion ON public.etapas_incorporacion_asistente
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_gestiona_familias ON public.familias;
CREATE POLICY admin_gestiona_familias ON public.familias
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_lee_importaciones_de_su_prestadora ON public.importaciones_prestadora;
CREATE POLICY admin_lee_importaciones_de_su_prestadora ON public.importaciones_prestadora
  FOR SELECT
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_prestadora_gestiona_indicaciones_medicacion ON public.indicaciones_medicacion;
CREATE POLICY admin_prestadora_gestiona_indicaciones_medicacion ON public.indicaciones_medicacion
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS panel_gestiona_informes_obra_social ON public.informes_obra_social;
CREATE POLICY panel_gestiona_informes_obra_social ON public.informes_obra_social
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_prestadora_gestiona_mensajes_asistente ON public.mensajes_asistente;
CREATE POLICY admin_prestadora_gestiona_mensajes_asistente ON public.mensajes_asistente
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_prestadora_gestiona_motivos_aviso_previo ON public.motivos_aviso_previo_guardia;
CREATE POLICY admin_prestadora_gestiona_motivos_aviso_previo ON public.motivos_aviso_previo_guardia
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_gestiona_pacientes ON public.pacientes;
CREATE POLICY admin_gestiona_pacientes ON public.pacientes
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_gestiona_permisos_prestadora ON public.permisos_prestadora;
CREATE POLICY admin_gestiona_permisos_prestadora ON public.permisos_prestadora
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS admin_prestadora_gestiona_rangos_vitales ON public.rangos_referencia_vitales;
CREATE POLICY admin_prestadora_gestiona_rangos_vitales ON public.rangos_referencia_vitales
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );

DROP POLICY IF EXISTS panel_gestiona_reportes ON public.reportes;
CREATE POLICY panel_gestiona_reportes ON public.reportes
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text))
  );


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — Igual que la parte 1, pero el Coordinador también entra.
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS panel_gestiona_alertas_contingencia_hospitalizacion ON public.alertas_contingencia_hospitalizacion;
CREATE POLICY panel_gestiona_alertas_contingencia_hospitalizacion ON public.alertas_contingencia_hospitalizacion
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid()
                      AND u.rol = ANY (ARRAY['admin_prestadora'::text, 'coordinador'::text])))
  );

DROP POLICY IF EXISTS panel_lee_consentimientos_de_su_prestadora ON public.consentimientos_asistente;
CREATE POLICY panel_lee_consentimientos_de_su_prestadora ON public.consentimientos_asistente
  FOR SELECT
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid()
                      AND u.rol = ANY (ARRAY['admin_prestadora'::text, 'coordinador'::text])))
  );

DROP POLICY IF EXISTS panel_gestiona_hospitalizaciones_paciente ON public.hospitalizaciones_paciente;
CREATE POLICY panel_gestiona_hospitalizaciones_paciente ON public.hospitalizaciones_paciente
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid()
                      AND u.rol = ANY (ARRAY['admin_prestadora'::text, 'coordinador'::text])))
  );


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 3 — Tablas sin columna propia, que se aíslan por la tabla de al lado.
--           Se copia la forma de `admin_gestiona_verificaciones`, que es la
--           que está bien escrita.
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS admin_prestadora_gestiona_matriculas_asistente ON public.matriculas_asistente;
CREATE POLICY admin_prestadora_gestiona_matriculas_asistente ON public.matriculas_asistente
  FOR ALL
  USING (
    (es_superadmin()
     AND EXISTS (SELECT 1 FROM asistentes a
                 WHERE a.id = matriculas_asistente.asistente_id
                   AND a.prestadora_id = current_tenant()))
    OR EXISTS (SELECT 1 FROM asistentes a
               JOIN usuarios u ON u.id = auth.uid()
               WHERE a.id = matriculas_asistente.asistente_id
                 AND a.prestadora_id = current_tenant()
                 AND u.rol = 'admin_prestadora'::text)
  );

DROP POLICY IF EXISTS admin_gestiona_circulo_familia ON public.miembros_familia;
CREATE POLICY admin_gestiona_circulo_familia ON public.miembros_familia
  FOR ALL
  USING (
    (es_superadmin()
     AND EXISTS (SELECT 1 FROM familias f
                 WHERE f.id = miembros_familia.familia_id
                   AND f.prestadora_id = current_tenant()))
    OR EXISTS (SELECT 1 FROM familias f
               WHERE f.id = miembros_familia.familia_id
                 AND f.prestadora_id = current_tenant()
                 AND EXISTS (SELECT 1 FROM usuarios u
                             WHERE u.id = auth.uid()
                               AND u.rol = 'admin_prestadora'::text))
  );


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 4 — Las dos que no comprobaban la Prestadora en absoluto.
--           Tienen `prestadora_id` propio desde que se crearon; se usa.
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS el_panel_arma_la_lista_de_pacientes ON public.guardia_pacientes;
CREATE POLICY el_panel_arma_la_lista_de_pacientes ON public.guardia_pacientes
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid()
                      AND u.rol = ANY (ARRAY['admin_prestadora'::text, 'coordinador'::text])))
  )
  WITH CHECK (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid()
                      AND u.rol = ANY (ARRAY['admin_prestadora'::text, 'coordinador'::text])))
  );

DROP POLICY IF EXISTS el_panel_arma_la_lista_de_pacientes_de_la_serie ON public.series_guardias_pacientes;
CREATE POLICY el_panel_arma_la_lista_de_pacientes_de_la_serie ON public.series_guardias_pacientes
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid()
                      AND u.rol = ANY (ARRAY['admin_prestadora'::text, 'coordinador'::text])))
  )
  WITH CHECK (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u
                    WHERE u.id = auth.uid()
                      AND u.rol = ANY (ARRAY['admin_prestadora'::text, 'coordinador'::text])))
  );


NOTIFY pgrst, 'reload schema';

-- Pendiente #72 (docs/PENDIENTES.md): calcularCese.js tenía hardcodeada, en un
-- switch(causal) de JS, no solo los valores legales (ya parametrizados en escalas_legales)
-- sino la ESTRUCTURA de cálculo (qué componentes sumar, en qué orden, qué causales
-- existen) — siempre asumiendo la ley argentina (LCT). El Desarrollador exigió que nada
-- quede hardcodeado por país: "coloquemos en variables todos los valores, formula
-- incluida, que indica la legislacion argentina, y cuando se venda en otro pais habra que
-- investigar su legislacion". Esta migración agrega jurisdicción a escalas_legales y una
-- tabla nueva `formulas_cese` que describe, como datos, la fórmula completa de cada
-- causal por jurisdicción — panel/src/lib/calcularCese.js pasa a ser un intérprete
-- genérico de esos datos (vocabulario cerrado de "tipo" de paso + "combinar") en vez de
-- un switch por país.

-- ============================================================================
-- 1. escalas_legales gana jurisdicción (mismo código que prestadoras.pais /
--    advertencias_legales.jurisdiccion — ISO 3166-1 alpha-2, cruza directo sin mapeo)
-- ============================================================================
ALTER TABLE escalas_legales ADD COLUMN IF NOT EXISTS jurisdiccion TEXT;
UPDATE escalas_legales SET jurisdiccion = 'AR' WHERE jurisdiccion IS NULL;
ALTER TABLE escalas_legales ALTER COLUMN jurisdiccion SET NOT NULL;

DROP INDEX IF EXISTS idx_escalas_tipo_vigencia;
CREATE INDEX IF NOT EXISTS idx_escalas_jurisdiccion_tipo_vigencia
  ON escalas_legales (jurisdiccion, tipo, categoria, vigencia_desde);

-- Endurecer RLS: escalas_legales pasa de "admin_prestadora o superadmin" a
-- "solo superadmin" — decisión confirmada explícitamente por el Desarrollador en esta
-- sesión, mismo criterio ya usado en advertencias_legales (contenido legal curado por
-- Xeitra tras investigar la jurisdicción, nunca una decisión de una Prestadora individual).
DROP POLICY IF EXISTS "admin_gestiona_escalas_legales" ON escalas_legales;
CREATE POLICY "superadmin_gestiona_escalas_legales" ON escalas_legales
  FOR ALL USING (es_superadmin());
CREATE POLICY "panel_lee_escalas_legales" ON escalas_legales
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'admin_plataforma', 'superadmin'))
  );

-- ============================================================================
-- 2. formulas_cese — la fórmula misma como dato, no como código.
--    "definicion" describe una lista ordenada de "pasos" (vocabulario cerrado, ver
--    panel/src/lib/calcularCese.js: preaviso_prorrateado, indemnizacion_por_anio_con_tope_y_piso,
--    integracion_mes_despido, multiplicador_fijo_sobre_remuneracion, mitad_de_componente,
--    verificar_periodo_prueba) y un "combinar" que dice cómo se agregan
--    (sumar / sumar_sobre_base / usar_paso / monto_fijo / monto_fijo_cero /
--    sin_calculo_automatico). Cada "tipo" de paso mapea 1:1 a una función pura que ya
--    existía en JS. Sin fila para (jurisdiccion, causal) = sin cálculo automático,
--    requiereRevisionAbogado = true — nunca se aproxima con la fórmula de otro país
--    (mismo principio que advertencias_legales, CLAUDE.md §3).
-- ============================================================================
CREATE TABLE IF NOT EXISTS formulas_cese (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiccion TEXT NOT NULL,
  causal TEXT NOT NULL,
  definicion JSONB NOT NULL,
  vigencia_desde DATE NOT NULL,
  vigencia_hasta DATE,
  fuente TEXT,
  cargado_por UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (jurisdiccion, causal, vigencia_desde)
);

CREATE INDEX IF NOT EXISTS idx_formulas_cese_jurisdiccion_causal
  ON formulas_cese (jurisdiccion, causal, vigencia_desde);

ALTER TABLE formulas_cese ENABLE ROW LEVEL SECURITY;

CREATE POLICY "panel_lee_formulas_cese" ON formulas_cese
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'admin_plataforma', 'superadmin'))
  );
CREATE POLICY "superadmin_gestiona_formulas_cese" ON formulas_cese
  FOR ALL USING (es_superadmin());

-- ============================================================================
-- 3. Seed — las 8 causales con cálculo automático de Argentina, con exactamente la misma
--    estructura y los mismos valores que hoy tenía el switch(causal) de calcularCese.js.
--    El comportamiento observable para Argentina no cambia, solo pasa de código a dato.
--    (Las causales sin cálculo automático en ninguna jurisdicción — incapacidad_absoluta,
--    jubilacion, fin_contrato_comercial, muerte_persona_cuidada — siguen resueltas
--    directamente en calcularCese.js vía CAUSALES_SIN_CALCULO_AUTOMATICO, no necesitan
--    fila acá porque no dependen de la ley de un país en particular.)
-- ============================================================================
INSERT INTO formulas_cese (jurisdiccion, causal, vigencia_desde, fuente, definicion) VALUES

('AR', 'renuncia', '2026-01-01', 'Migración pendiente #72 — art. 231/232 LCT', '{
  "pasos": [{"id": "preaviso", "tipo": "preaviso_prorrateado", "parametros": {
      "escala_menos_1_anio": {"tipo": "preaviso_dias", "categoria": "menos_1_anio"},
      "escala_mas_1_anio": {"tipo": "preaviso_dias", "categoria": "mas_1_anio"}},
    "renombrar": {"diasPreaviso": "diasPreavisoAdeudadosPorAsistente", "sustitutivoPreaviso": "valorReferenciaPreaviso"}}],
  "combinar": {"operacion": "monto_fijo", "valor": 0, "detalle_de_paso": "preaviso"},
  "requiere_revision_abogado": false
}'::jsonb),

('AR', 'mutuo_acuerdo', '2026-01-01', 'Migración pendiente #72 — art. 241 LCT', '{
  "pasos": [],
  "combinar": {"operacion": "sin_calculo_automatico", "motivo": "Monto a definir por acuerdo entre las partes — el sistema solo registra."},
  "requiere_revision_abogado": false
}'::jsonb),

('AR', 'periodo_de_prueba', '2026-01-01', 'Migración pendiente #72 — art. 92 bis LCT', '{
  "pasos": [{"id": "verificacion", "tipo": "verificar_periodo_prueba", "parametros": {
    "escala_dias_prueba": {"tipo": "periodo_prueba_dias", "categoria": "general"}}}],
  "combinar": {"operacion": "usar_paso", "paso": "verificacion"},
  "requiere_revision_abogado": false
}'::jsonb),

('AR', 'despido_sin_causa', '2026-01-01', 'Migración pendiente #72 — arts. 232/233/245 LCT', '{
  "pasos": [
    {"id": "antiguedad", "tipo": "indemnizacion_por_anio_con_tope_y_piso", "parametros": {
      "escala_meses_por_anio": {"tipo": "indemnizacion_antiguedad", "categoria": "meses_por_anio"},
      "escala_tope": {"tipo": "tope_indemnizatorio", "categoria": "general"},
      "escala_piso_meses": {"tipo": "piso_minimo_indemnizacion", "categoria": "meses"},
      "escala_umbral_fraccion": {"tipo": "fraccion_computable_antiguedad", "categoria": "general"}}},
    {"id": "preaviso", "tipo": "preaviso_prorrateado", "parametros": {
      "escala_menos_1_anio": {"tipo": "preaviso_dias", "categoria": "menos_1_anio"},
      "escala_mas_1_anio": {"tipo": "preaviso_dias", "categoria": "mas_1_anio"}}},
    {"id": "integracion", "tipo": "integracion_mes_despido", "parametros": {}}
  ],
  "combinar": {"operacion": "sumar", "pasos": ["antiguedad", "preaviso", "integracion"]},
  "advertencia_umbral_antiguedad": {"tipo": "fraccion_computable_antiguedad", "categoria": "general"},
  "requiere_revision_abogado": false
}'::jsonb),

('AR', 'despido_por_embarazo_o_matrimonio', '2026-01-01', 'Migración pendiente #72 — arts. 178/182 LCT', '{
  "compone_sobre_causal": "despido_sin_causa",
  "pasos": [{"id": "agravamiento", "tipo": "multiplicador_fijo_sobre_remuneracion", "parametros": {
    "escala": {"tipo": "multiplicador_agravado", "categoria": "embarazo_matrimonio"}}}],
  "combinar": {"operacion": "sumar_sobre_base", "pasos": ["agravamiento"]},
  "requiere_revision_abogado": false,
  "requiere_revision_abogado_si_incompleto": true
}'::jsonb),

('AR', 'despido_con_justa_causa', '2026-01-01', 'Migración pendiente #72 — art. 242 LCT', '{
  "pasos": [],
  "combinar": {"operacion": "monto_fijo_cero",
    "motivo": "Sin indemnización — requiere revisión de abogado obligatoria antes de cerrar el registro.",
    "advertencia": "Este cese requiere revisado_por_abogado = true antes de poder cerrarse."},
  "requiere_revision_abogado": true
}'::jsonb),

('AR', 'abandono_de_trabajo', '2026-01-01', 'Migración pendiente #72 — art. 244 LCT', '{
  "pasos": [],
  "combinar": {"operacion": "monto_fijo_cero",
    "motivo": "Sin indemnización — requiere revisión de abogado obligatoria antes de cerrar el registro.",
    "advertencia": "Este cese requiere revisado_por_abogado = true antes de poder cerrarse."},
  "requiere_revision_abogado": true
}'::jsonb),

('AR', 'muerte_del_trabajador', '2026-01-01', 'Migración pendiente #72 — art. 248 LCT', '{
  "pasos": [
    {"id": "antiguedad", "tipo": "indemnizacion_por_anio_con_tope_y_piso", "parametros": {
      "escala_meses_por_anio": {"tipo": "indemnizacion_antiguedad", "categoria": "meses_por_anio"},
      "escala_tope": {"tipo": "tope_indemnizatorio", "categoria": "general"},
      "escala_piso_meses": {"tipo": "piso_minimo_indemnizacion", "categoria": "meses"},
      "escala_umbral_fraccion": {"tipo": "fraccion_computable_antiguedad", "categoria": "general"}}},
    {"id": "mitad", "tipo": "mitad_de_componente", "parametros": {"referencia": "antiguedad"}}
  ],
  "combinar": {"operacion": "usar_paso", "paso": "mitad"},
  "requiere_revision_abogado": true
}'::jsonb),

('AR', 'muerte_del_empleador', '2026-01-01', 'Migración pendiente #72 — art. 249 LCT', '{
  "pasos": [
    {"id": "antiguedad", "tipo": "indemnizacion_por_anio_con_tope_y_piso", "parametros": {
      "escala_meses_por_anio": {"tipo": "indemnizacion_antiguedad", "categoria": "meses_por_anio"},
      "escala_tope": {"tipo": "tope_indemnizatorio", "categoria": "general"},
      "escala_piso_meses": {"tipo": "piso_minimo_indemnizacion", "categoria": "meses"},
      "escala_umbral_fraccion": {"tipo": "fraccion_computable_antiguedad", "categoria": "general"}}},
    {"id": "mitad", "tipo": "mitad_de_componente", "parametros": {"referencia": "antiguedad"}}
  ],
  "combinar": {"operacion": "usar_paso", "paso": "mitad"},
  "advertencia_si_no_dependencia": "Esta causal solo aplica cuando el empleador es la familia directamente (vínculo por dependencia), no a la prestadora.",
  "requiere_revision_abogado": true
}'::jsonb)

ON CONFLICT (jurisdiccion, causal, vigencia_desde) DO NOTHING;

NOTIFY pgrst, 'reload schema';

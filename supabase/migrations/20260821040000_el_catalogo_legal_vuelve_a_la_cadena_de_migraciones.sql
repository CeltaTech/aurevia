-- =========================================================================================
-- El catálogo legal vuelve a la cadena de migraciones
--
-- QUÉ ESTABA MAL. Las escalas legales de Argentina y las fórmulas de cese se cargaron a mano
-- en la base de la nube, allá por julio, y nunca entraron a ninguna migración. El 2026-08-19
-- se consolidó todo el historial en una sola foto de la base, y esa foto guardó la forma de
-- las tablas pero no su contenido. Resultado: una base recién construida —la local, la de un
-- entorno de prueba, o la de la nube si algún día hay que rehacerla— tiene las dos tablas
-- vacías. Y con las dos tablas vacías el cálculo de cese no da un número equivocado: no da
-- ninguno, porque el sistema está bien hecho y prefiere callarse antes que estimar.
--
-- POR QUÉ IMPORTA MÁS DE LO QUE PARECE. Un catálogo que existe en un solo lugar y fuera del
-- control de versiones no se puede reproducir, no se puede revisar y no se puede volver
-- atrás. La regla 12 pide un solo punto de verdad, y para el contenido de la plataforma ese
-- punto es la cadena de migraciones, no una base en particular.
--
-- DE DÓNDE SALEN ESTOS VALORES. No están inventados acá: son exactamente los mismos que se
-- cargaron en su momento, recuperados del historial de git, con su marca de provisorios
-- intacta. Ninguno cambió. Siguen esperando que un abogado laboralista los confirme o los
-- corrija, que es el pendiente #130.
--
-- QUÉ PASA SI LA BASE YA LOS TIENE. Nada. Cada bloque mira primero si la jurisdicción ya
-- está cargada y, si lo está, no toca una sola fila. Esto no es una precaución de más: si el
-- abogado ya corrigió un valor en la nube, esta migración no puede pisárselo.
--
-- DOS ESCALAS QUE NO ESTÁN ACÁ. Las fórmulas de despido nombran `piso_minimo_indemnizacion`
-- y `fraccion_computable_antiguedad`, y esos dos valores no figuran en ningún archivo del
-- historial: se cargaron directo en la nube o nunca se cargaron. No se inventan (regla 10):
-- quedan anotados en el pendiente #130 para que los cargue el abogado junto con el resto.
-- Hasta entonces, el cálculo que los necesita se detiene y pide revisión, que es lo correcto.
-- =========================================================================================

-- -----------------------------------------------------------------------------------------
-- 1. Las quince escalas legales de Argentina
-- -----------------------------------------------------------------------------------------
-- La moneda va solo en la única fila que guarda plata (el tope indemnizatorio); las demás
-- son días, meses o porcentajes, y un porcentaje sin moneda es lo correcto.
DO $bloque$
BEGIN
  IF EXISTS (SELECT 1 FROM public.escalas_legales WHERE jurisdiccion = 'AR') THEN
    RAISE NOTICE 'escalas_legales ya tiene filas de AR: no se toca nada.';
  ELSE
    INSERT INTO public.escalas_legales (jurisdiccion, tipo, categoria, valor, unidad, moneda, vigencia_desde, fuente) VALUES
      ('AR', 'preaviso_dias', 'menos_1_anio', 10, 'dias', NULL, '2026-01-01', 'PROVISORIO — validar con abogado laboralista'),
      ('AR', 'preaviso_dias', 'mas_1_anio', 30, 'dias', NULL, '2026-01-01', 'PROVISORIO — validar con abogado laboralista'),
      ('AR', 'periodo_prueba_dias', 'general', 90, 'dias', NULL, '2026-01-01', 'PROVISORIO — validar con abogado laboralista'),
      ('AR', 'indemnizacion_antiguedad', 'meses_por_anio', 1, 'meses', NULL, '2026-01-01', 'PROVISORIO — validar con abogado laboralista'),
      ('AR', 'tope_indemnizatorio', 'general', 3000000, 'monto_fijo_mensual', 'ARS', '2026-01-01', 'PROVISORIO — validar con abogado laboralista'),
      ('AR', 'multiplicador_agravado', 'embarazo_matrimonio', 13, 'meses', NULL, '2026-01-01', 'PROVISORIO — validar con abogado laboralista (art. 178/182 LCT: 1 año de remuneraciones)'),
      ('AR', 'tope_licencia_paga_dias', 'antiguedad_menor_5_anios', 90, 'dias', NULL, '2026-01-01', 'PROVISORIO — validar con abogado laboralista'),
      ('AR', 'tope_licencia_paga_dias', 'antiguedad_mayor_5_anios', 180, 'dias', NULL, '2026-01-01', 'PROVISORIO — validar con abogado laboralista'),
      ('AR', 'indicador_riesgo_dependencia', 'exclusividad_facturacion', 20, 'porcentaje', NULL, '2026-01-01', 'Peso relativo del indicador, sobre 100 — PROVISORIO'),
      ('AR', 'indicador_riesgo_dependencia', 'antiguedad_vinculo', 10, 'porcentaje', NULL, '2026-01-01', 'Peso relativo del indicador, sobre 100 — PROVISORIO'),
      ('AR', 'indicador_riesgo_dependencia', 'horas_semanales_promedio', 20, 'porcentaje', NULL, '2026-01-01', 'Peso relativo del indicador, sobre 100 — PROVISORIO'),
      ('AR', 'indicador_riesgo_dependencia', 'herramientas_provistas', 10, 'porcentaje', NULL, '2026-01-01', 'Peso relativo del indicador, sobre 100 — PROVISORIO'),
      ('AR', 'indicador_riesgo_dependencia', 'horario_fijo_impuesto', 15, 'porcentaje', NULL, '2026-01-01', 'Peso relativo del indicador, sobre 100 — PROVISORIO'),
      ('AR', 'indicador_riesgo_dependencia', 'exclusividad_zona', 10, 'porcentaje', NULL, '2026-01-01', 'Peso relativo del indicador, sobre 100 — PROVISORIO'),
      ('AR', 'indicador_riesgo_dependencia', 'supervision_directa', 15, 'porcentaje', NULL, '2026-01-01', 'Peso relativo del indicador, sobre 100 — PROVISORIO');
  END IF;
END
$bloque$;


-- -----------------------------------------------------------------------------------------
-- 2. Las nueve fórmulas de cese de Argentina
-- -----------------------------------------------------------------------------------------
-- Cada fila describe, como dato y no como código, los pasos que compone una causal. Las
-- causales que no dependen de la ley de ningún país en particular no tienen fila acá.
DO $bloque$
BEGIN
  IF EXISTS (SELECT 1 FROM public.formulas_cese WHERE jurisdiccion = 'AR') THEN
    RAISE NOTICE 'formulas_cese ya tiene filas de AR: no se toca nada.';
  ELSE
    INSERT INTO public.formulas_cese (jurisdiccion, causal, vigencia_desde, fuente, definicion) VALUES

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
}'::jsonb);
  END IF;
END
$bloque$;

-- Sin esto, la capa que sirve los datos puede seguir contestando 404 en tablas que sí
-- existen (§8 de `CLAUDE.md`).
NOTIFY pgrst, 'reload schema';

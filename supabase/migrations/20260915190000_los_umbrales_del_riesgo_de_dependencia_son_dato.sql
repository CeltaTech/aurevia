-- ---------------------------------------------------------------------------------------
-- Los umbrales del riesgo de dependencia son dato, no código
--
-- Tres de los siete indicadores del puntaje de riesgo de reclasificación salen de datos que
-- la ficha del Asistente ya tiene: hace cuánto entró, cuántas horas hace por semana y en
-- cuántas zonas trabaja. Para leer esos datos como indicio hace falta saber a partir de qué
-- número el indicio está pleno, y ese número es un valor legal: cambia por jurisdicción y
-- cambia con el tiempo. Va a `escalas_legales`, como los pesos, y nunca escrito en el código.
--
-- El indicador de zona no lleva umbral: trabajar en una sola zona asignada es el indicio, y
-- eso no depende de ningún número.
--
-- Si un umbral no está vigente a la fecha, el indicador no se deduce: queda como esté cargado
-- a mano y la pantalla avisa. Nunca se inventa un valor de reemplazo.
-- ---------------------------------------------------------------------------------------
-- Una de las dos unidades nuevas no estaba en la lista de unidades permitidas: hasta hoy
-- ninguna escala se medía en horas por semana.
ALTER TABLE public.escalas_legales DROP CONSTRAINT IF EXISTS escalas_legales_unidad_check;
ALTER TABLE public.escalas_legales ADD CONSTRAINT escalas_legales_unidad_check
  CHECK (unidad = ANY (ARRAY['monto_fijo_mensual', 'porcentaje', 'dias', 'meses', 'horas', 'monto_por_hora']));

DO $bloque$
BEGIN
  IF EXISTS (SELECT 1 FROM public.escalas_legales WHERE tipo = 'umbral_riesgo_dependencia' AND jurisdiccion = 'AR') THEN
    RAISE NOTICE 'escalas_legales ya tiene umbrales de riesgo para AR: no se toca nada.';
  ELSE
    INSERT INTO public.escalas_legales (jurisdiccion, tipo, categoria, valor, unidad, moneda, vigencia_desde, fuente) VALUES
      ('AR', 'umbral_riesgo_dependencia', 'antiguedad_vinculo', 12, 'meses', NULL, '2026-01-01', 'Antigüedad a partir de la cual el indicio se considera pleno — PROVISORIO, validar con abogado laboralista'),
      ('AR', 'umbral_riesgo_dependencia', 'horas_semanales_promedio', 30, 'horas', NULL, '2026-01-01', 'Horas semanales a partir de las cuales el indicio se considera pleno — PROVISORIO, validar con abogado laboralista');
  END IF;
END
$bloque$;

NOTIFY pgrst, 'reload schema';

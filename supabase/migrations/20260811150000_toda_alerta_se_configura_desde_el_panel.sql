-- ============================================================================
-- Toda alerta se configura desde el Panel de la Prestadora
-- (pendiente #64).
--
-- QUÉ HACE
-- Le agrega a `configuracion_alertas_ia` cuatro datos que hasta hoy estaban
-- escritos a mano dentro del código: cuántos reportes mira la revisión, y quién
-- se entera de lo que encuentra según sea una alerta roja o una amarilla. Y le
-- agrega a `prestadoras` con cuánta anticipación se le recuerda al Asistente la
-- guardia que tiene por delante, que estaba en la misma situación.
--
-- POR QUÉ (esto es lo que no se puede reconstruir leyendo el esquema)
-- El producto revisa cada tanto los últimos reportes de un Paciente con
-- inteligencia artificial y, si encuentra un patrón preocupante, avisa. Esa
-- revisión vivía entera en backend/src/utils/revisarAlertasIA.js con dos
-- decisiones tomadas de antemano para todo el mundo: miraba siempre los últimos
-- siete reportes, y repartía el aviso siempre igual —la alerta roja al
-- Coordinador y a la Familia, la amarilla solo al Coordinador—.
--
-- Ninguna de las dos es una decisión de programación; son decisiones del
-- negocio, y cambian de una Prestadora a otra. Siete reportes son una semana
-- larga en un Paciente que se atiende todos los días, y son cuatro meses en uno
-- que se atiende una vez por semana: el mismo número mira períodos que no se
-- parecen en nada. Y avisarle a la Familia de una alerta roja es correcto en
-- una Prestadora que trabaja con familias presentes, y es un problema en una
-- que atiende por convenio con una obra social, donde el interlocutor no es la
-- familia. Eso es exactamente lo que prohíbe la regla de CLAUDE.md §2,
-- "Configuración sobre programación".
--
-- LO QUE NO SE PUEDE APAGAR
-- Que una alerta ROJA le llegue al Coordinador no se configura, y por eso no
-- hay columna para eso. Es el piso del producto: si la revisión encontró algo
-- urgente sobre un Paciente, alguien de la Prestadora tiene que enterarse. Todo
-- lo demás alrededor de ese piso sí se elige.
--
-- POR QUÉ NO SE SIEMBRA NINGUNA FILA
-- Esta migración no le crea la fila a nadie, a propósito. El backend devuelve
-- los valores de fábrica cuando no encuentra fila, y recién la escribe cuando
-- una persona guarda un cambio desde el Panel. Sembrar filas iguales a los
-- valores de fábrica sería guardar dos veces la misma información —una en la
-- base y otra en el código— y después habría que acordarse de cambiar las dos.
-- Los valores de fábrica de acá abajo (DEFAULT) y los del backend son los
-- mismos justamente para que la fila no haga falta.
--
-- LO MISMO VALE PARA LA LISTA DE AVISOS
-- Hasta hoy, la pantalla de Avisos del Panel mostraba solamente los avisos que
-- tenían fila en `configuracion_notificaciones`. Un aviso sin fila era invisible
-- y no se podía apagar: le pasaba a `alerta_ia_nivel2`, que nunca se sembró en
-- ningún esquema. Eso no se arregla sembrando filas —la próxima Prestadora
-- volvería a nacer sin ellas—, sino poniendo la lista de avisos en un único
-- lugar del código (backend/src/utils/catalogoAvisos.js) y mostrándola entera,
-- exista o no la fila. Por eso acá tampoco se siembra nada de esa tabla.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Los cuatro datos que faltaban
-- ----------------------------------------------------------------------------
ALTER TABLE public.configuracion_alertas_ia
  ADD COLUMN IF NOT EXISTS reportes_a_analizar INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS roja_avisa_familia BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS amarilla_avisa_familia BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS amarilla_avisa_coordinador BOOLEAN NOT NULL DEFAULT true;

-- El tope de 30 no es capricho: cada revisión le cuesta plata a la Prestadora
-- (se le paga al proveedor de inteligencia artificial por la cantidad de texto
-- que se le manda) y el costo crece con la cantidad de reportes. Ver la pantalla
-- de costos de IA del Panel. Abajo de 1 no tiene sentido: sería no revisar nada.
ALTER TABLE public.configuracion_alertas_ia
  DROP CONSTRAINT IF EXISTS configuracion_alertas_ia_reportes_a_analizar_check;
ALTER TABLE public.configuracion_alertas_ia
  ADD CONSTRAINT configuracion_alertas_ia_reportes_a_analizar_check
  CHECK (reportes_a_analizar BETWEEN 1 AND 30);

-- ----------------------------------------------------------------------------
-- 2. Qué significa cada columna, para el que la lea dentro de dos años
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.configuracion_alertas_ia IS
  'Cómo revisa esta Prestadora los reportes de sus Pacientes con inteligencia artificial: qué palabras adelantan la revisión, cuánto material mira y a quién le avisa según lo que encuentra. Sin fila, valen los valores de fábrica que están en backend/src/routes/panelConfiguracion.js.';

COMMENT ON COLUMN public.configuracion_alertas_ia.palabras_clave IS
  'Palabras que, si aparecen en un reporte, disparan la revisión en el momento en vez de esperar al horario de siempre (por ejemplo: caída, sangrado, no responde). Las lee backend/src/routes/appAsistentes.js al recibir el reporte.';

COMMENT ON COLUMN public.configuracion_alertas_ia.reportes_a_analizar IS
  'Cuántos de los últimos reportes de ese Paciente mira la revisión. De fábrica, 7. Cuantos más mire, más contexto tiene y más cuesta cada revisión.';

COMMENT ON COLUMN public.configuracion_alertas_ia.roja_avisa_familia IS
  'Si una alerta roja —lo urgente— también le llega a la Familia del Paciente. De fábrica, sí. Al Coordinador le llega siempre, eso no se configura.';

COMMENT ON COLUMN public.configuracion_alertas_ia.amarilla_avisa_familia IS
  'Si una alerta amarilla —lo que conviene mirar, sin urgencia— también le llega a la Familia. De fábrica, no: la amarilla es material de trabajo de la Prestadora, no una noticia para dar.';

COMMENT ON COLUMN public.configuracion_alertas_ia.amarilla_avisa_coordinador IS
  'Si una alerta amarilla le llega al Coordinador. De fábrica, sí. Se puede apagar en una Prestadora que prefiera revisarlas por pantalla en vez de recibirlas de a una.';

-- ----------------------------------------------------------------------------
-- 3. La descripción guardada de cada aviso deja de ser la que manda
-- ----------------------------------------------------------------------------
-- La columna se conserva (los identificadores no se borran, CLAUDE.md §7 regla
-- 13) y sigue guardando lo que se sembró en su momento, pero ya no es de donde
-- sale lo que se ve en pantalla.
COMMENT ON COLUMN public.configuracion_notificaciones.descripcion IS
  'Texto histórico, en español, de cuando la lista de avisos vivía en esta tabla. El Panel ya no lo muestra: el nombre y la explicación de cada aviso salen traducidos de panel/src/i18n/translations.js, y la lista de avisos que existen es la de backend/src/utils/catalogoAvisos.js. Se conserva como respaldo por si llegara una fila de un aviso que el catálogo no conoce.';

-- ----------------------------------------------------------------------------
-- 4. Con cuánta anticipación se le recuerda al Asistente su guardia
-- ----------------------------------------------------------------------------
-- Estaba escrito en backend/src/utils/revisarRecordatoriosPush.js como una hora
-- fija para todo el mundo. Una hora le sirve a una Prestadora cuyas Asistentes
-- viven cerca y trabajan siempre en la misma zona; a una que cubre el conurbano
-- con dos colectivos de por medio le queda corta, y a una de guardias nocturnas
-- fijas le sobra. El dato va en `prestadoras` y no en una tabla nueva porque es
-- exactamente la misma clase de número que los dos que ya viven ahí:
-- `dias_aviso_vencimiento_documentos` y `dias_generacion_series_guardia`.
--
-- Por regla de la base, esta tabla solo la escribe el superadministrador; el
-- Panel la edita a través del backend, que usa la clave de servicio y acota
-- siempre a la Prestadora de quien pide. Es el mismo camino que ya usan los
-- otros dos números.
ALTER TABLE public.prestadoras
  ADD COLUMN IF NOT EXISTS minutos_aviso_previo_guardia INTEGER NOT NULL DEFAULT 60;

ALTER TABLE public.prestadoras
  DROP CONSTRAINT IF EXISTS prestadoras_minutos_aviso_previo_guardia_check;
ALTER TABLE public.prestadoras
  ADD CONSTRAINT prestadoras_minutos_aviso_previo_guardia_check
  CHECK (minutos_aviso_previo_guardia BETWEEN 5 AND 1440);

COMMENT ON COLUMN public.prestadoras.minutos_aviso_previo_guardia IS
  'Cuántos minutos antes de que empiece la guardia se le manda el recordatorio al Asistente. De fábrica, 60. El tope es un día entero; menos de cinco minutos no llegaría a tiempo de servir para nada.';

NOTIFY pgrst, 'reload schema';

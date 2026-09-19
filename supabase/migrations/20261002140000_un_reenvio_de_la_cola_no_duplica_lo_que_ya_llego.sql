-- Un reenvío de la cola no duplica lo que ya llegó.
-- =================================================
--
-- QUÉ FALTABA. El teléfono anota lo que no pudo mandar y lo vuelve a intentar cuando hay señal.
-- Si el primer intento llegó a la base y lo que se perdió fue la respuesta, el segundo intento
-- escribe una fila más: dos emergencias de la misma emergencia, dos descansos del mismo descanso.
-- Nadie del otro lado tiene forma de saber que son el mismo hecho.
--
-- La mayoría de los avisos ya estaban a salvo por su propio estado: una guardia no tiene dos
-- llegadas, ni dos cierres, ni dos Reportes del mismo Paciente en el mismo turno, así que el
-- reenvío se reconoce solo y el motor contesta que ya estaba registrado. Los que quedaban afuera
-- son los que SÍ pueden pasar dos veces de verdad en la misma guardia: una emergencia y un
-- descanso. Para ésos el estado no alcanza, porque dos filas iguales pueden ser dos hechos.
--
-- LO QUE RESUELVE ESTO. El identificador lo pone el teléfono ANTES del primer intento y no cambia
-- entre reintentos, así que dos llegadas con el mismo identificador son el mismo hecho, y la
-- segunda no escribe nada. Es el mismo identificador que el teléfono ya venía mandando en el
-- cuerpo del pedido y que hasta hoy nadie leía.
--
-- LA HORA DEL HECHO Y LA HORA DE LLEGADA YA SON DOS COLUMNAS DISTINTAS, y esta migración no las
-- toca. `emergencias_guardia.reportado_at` y `descansos_guardia.inicio_at` guardan cuándo pasó
-- —el momento que pone el teléfono, aceptado sólo hacia atrás—, y `created_at` guarda cuándo
-- llegó el dato a la base, puesto por ella misma. Están separadas desde que nacieron las dos
-- tablas y no se mezclan.
--
-- POR QUÉ NO HAY BLOQUE DE PERMISOS. No se crea ninguna tabla ni ningún depósito de archivos:
-- se agrega una columna a dos tablas que ya existen, con su protección por fila ya encendida y
-- sus políticas ya escritas en las migraciones que las crearon. Las políticas son por fila y no
-- por columna, así que alcanzan a la columna nueva sin tocar nada. Un `REVOKE ALL` acá le sacaría
-- a `authenticated` el `SELECT` que aquellas migraciones le dieron a propósito.

-- ---------------------------------------------------------------------------
-- 1. La emergencia
-- ---------------------------------------------------------------------------

ALTER TABLE public.emergencias_guardia
  ADD COLUMN IF NOT EXISTS cliente_uuid uuid;

COMMENT ON COLUMN public.emergencias_guardia.cliente_uuid IS
  'El identificador que pone el telefono antes del primer intento. Dos llegadas con el mismo identificador son el mismo hecho: la segunda no escribe nada.';

-- Único por guardia y no por Prestadora: el identificador lo genera el teléfono, y lo que hace
-- falta impedir es la fila repetida del mismo hecho. Parcial, porque lo cargado desde el Panel no
-- viene de ningún teléfono y no lleva identificador: sin el `WHERE`, la segunda fila sin
-- identificador chocaría contra la primera.
CREATE UNIQUE INDEX IF NOT EXISTS idx_emergencias_guardia_sin_repetir
  ON public.emergencias_guardia (guardia_id, cliente_uuid)
  WHERE cliente_uuid IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. El descanso
-- ---------------------------------------------------------------------------

ALTER TABLE public.descansos_guardia
  ADD COLUMN IF NOT EXISTS cliente_uuid uuid;

COMMENT ON COLUMN public.descansos_guardia.cliente_uuid IS
  'El identificador que pone el telefono antes del primer intento, para el que abre el descanso. Dos llegadas con el mismo identificador son el mismo hecho.';

-- El que cierra el descanso tiene su propio identificador, y es otro hecho distinto del que lo
-- abrió. Se guarda aparte para que el reenvío del cierre tampoco tenga que adivinar nada.
ALTER TABLE public.descansos_guardia
  ADD COLUMN IF NOT EXISTS cliente_uuid_fin uuid;

COMMENT ON COLUMN public.descansos_guardia.cliente_uuid_fin IS
  'El identificador del aviso que cerro el descanso. Un reenvio del cierre se reconoce por aca y no vuelve a escribir la hora de fin.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_descansos_guardia_sin_repetir
  ON public.descansos_guardia (guardia_id, cliente_uuid)
  WHERE cliente_uuid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_descansos_guardia_cierre_sin_repetir
  ON public.descansos_guardia (guardia_id, cliente_uuid_fin)
  WHERE cliente_uuid_fin IS NOT NULL;

NOTIFY pgrst, 'reload schema';

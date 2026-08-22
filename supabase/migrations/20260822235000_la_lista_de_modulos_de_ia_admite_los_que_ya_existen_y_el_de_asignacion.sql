-- La lista de módulos de IA no coincidía con los módulos que el código ya usa.
--
-- `uso_ia` es la tabla donde queda anotado cuánto costó cada llamada a la IA: cuántos tokens
-- entraron, cuántos salieron y cuántos dólares fue eso. La columna `modulo` dice qué parte del
-- producto gastó, y tenía una lista cerrada de cuatro valores.
--
-- El problema: la capa de viabilidad de la importación (backend/src/utils/importacionIA.js)
-- registra su gasto como `importacion_viabilidad`, que no estaba en esa lista. Postgres
-- rechazaba la fila, y el rechazo quedaba en el log sin cortar nada, porque registrar el costo
-- nunca puede voltear la operación que el usuario pidió (backend/src/utils/registrarUsoIA.js).
-- Resultado: es la llamada más cara de todas —4000 tokens de tope contra 1000 del resto— y era
-- la única cuyo costo no se contaba en ningún lado. Se agrega el valor en vez de fusionarlo con
-- `importacion`, porque son dos llamadas distintas y saber cuál es la cara es justamente el
-- punto de tener la tabla.
--
-- Se agrega además `asignacion`, para la propuesta de Asistentes que la IA le acerca a la
-- Coordinadora cuando hay que cubrir una guardia (pendiente #128 b).
--
-- La lista sigue siendo cerrada a propósito: un módulo nuevo que gasta plata pasa por acá, y
-- eso obliga a que alguien lo mire. Un `text` libre habría dejado entrar cualquier cosa mal
-- escrita y el resumen de costos mostraría dos módulos donde hay uno.

ALTER TABLE public.uso_ia DROP CONSTRAINT IF EXISTS uso_ia_modulo_check;

ALTER TABLE public.uso_ia ADD CONSTRAINT uso_ia_modulo_check
  CHECK (modulo = ANY (ARRAY[
    'alertas'::text,
    'reporte'::text,
    'importacion'::text,
    'importacion_viabilidad'::text,
    'whatsapp'::text,
    'asignacion'::text
  ]));

COMMENT ON COLUMN public.uso_ia.modulo IS
  'Qué parte del producto gastó en IA. Lista cerrada: sumar un valor acá es la forma de que un módulo nuevo pueda anotar su costo.';

NOTIFY pgrst, 'reload schema';

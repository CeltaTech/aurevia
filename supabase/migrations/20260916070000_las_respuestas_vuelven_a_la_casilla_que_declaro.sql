-- Las respuestas vuelven a la casilla que declaró la Prestadora
--
-- QUÉ FALTA HOY
-- Cada Prestadora ya manda sus avisos desde una dirección suya bajo el dominio del
-- producto, pero esa dirección sólo manda: no hay ninguna casilla detrás. Quien le
-- conteste a un aviso le escribe a un buzón que no existe y la respuesta se pierde.
-- El reenvío hacia la casilla que la Prestadora declaró lo hace un servicio de
-- afuera, y cada reenvío abierto allá tiene un identificador que hay que guardar
-- para poder cortarlo el día que la Prestadora se va.
--
-- QUÉ HACE
-- Agrega `prestadoras.regla_reenvio`: el identificador que el servicio de correo le
-- dio al reenvío de esa Prestadora. Es un nombre puesto por un tercero y se guarda
-- tal como él lo da. Vacío significa que esa Prestadora no tiene reenvío abierto, y
-- entonces sus respuestas se pierden: eso se muestra en el Panel.
--
-- QUÉ NO HACE
-- No guarda si el dueño de la casilla de destino ya confirmó que quiere recibir ahí.
-- Ese clic lo da una persona cuando quiere, así que un valor escrito en el alta
-- diría «sin confirmar» para siempre; se pregunta en el momento en que se muestra.
--
-- CÓMO SE VUELVE ATRÁS
-- Borrando la columna. Los reenvíos ya abiertos siguen funcionando: viven del otro
-- lado, y lo que se pierde es la forma de cortarlos desde acá.

ALTER TABLE "public"."prestadoras"
  ADD COLUMN IF NOT EXISTS "regla_reenvio" "text";

COMMENT ON COLUMN "public"."prestadoras"."regla_reenvio" IS
  'Identificador del reenvío de las respuestas de esta Prestadora, tal como lo da el servicio de correo. Se abre al darla de alta y se corta cuando se va. Vacío: no hay reenvío y las respuestas se pierden.';

NOTIFY pgrst, 'reload schema';

-- Cada Prestadora manda desde su propia casilla
--
-- QUÉ FALTA HOY
-- Todas las Prestadoras mandan sus avisos desde la misma dirección del producto, y
-- lo único que cambia de una a otra es el nombre que se lee en el buzón de quien lo
-- recibe. Quedó decidido que cada una tenga la suya bajo el dominio del producto
-- (`docs/MARCA.md`, sección 0), así que hace falta un lugar donde guardarla y una
-- forma de elegir el nombre sin que dos Prestadoras terminen con el mismo.
--
-- QUÉ HACE
-- 1. `prestadoras.casilla_envio`: el nombre de la casilla, sin el dominio. Se guarda
--    sólo la parte de la izquierda a propósito: el dominio del producto vive en una
--    variable de entorno, y guardar la dirección entera lo metería adentro de los
--    datos, de modo que cambiarlo sería una migración de datos y no un cambio de
--    configuración.
-- 2. Un índice único sobre esa columna: dos Prestadoras no pueden mandar desde la
--    misma dirección. Compara en minúsculas, como el del nombre de fantasía, porque
--    una dirección de correo no distingue mayúsculas de minúsculas.
-- 3. El catálogo `dominios_de_correo_gratuitos`: qué dominios son de una casilla
--    gratuita y no de una empresa. Con él, el alta sabe si la dirección que declaró
--    la Prestadora le sirve para nombrar su casilla —`cuidadosdellitoral.com.ar`
--    sí— o si tiene que armarla con su nombre de fantasía —`gmail.com` no—. Va a la
--    base y no al código: la lista se amplía agregando filas.
--
-- QUÉ NO HACE
-- No completa la casilla de las Prestadoras que ya existen. La columna queda vacía y
-- esas siguen mandando desde la dirección común, que es lo que hacían: llenarla
-- desde acá obligaría a inventar el nombre de cada una sin que nadie lo mire.
--
-- CÓMO SE VUELVE ATRÁS
-- Borrando el índice, la columna y la tabla del catálogo.

-- 1. Dónde se guarda la casilla de cada Prestadora ---------------------------

ALTER TABLE "public"."prestadoras"
  ADD COLUMN IF NOT EXISTS "casilla_envio" "text";

COMMENT ON COLUMN "public"."prestadoras"."casilla_envio" IS
  'Nombre de la casilla desde la que esta Prestadora manda sus avisos, sin el dominio. Se fija al darla de alta y no cambia: es la dirección que la gente ya tiene en su buzón. El dominio lo pone el motor.';

CREATE UNIQUE INDEX IF NOT EXISTS "prestadoras_casilla_envio_unica"
  ON "public"."prestadoras" (lower("casilla_envio"));

COMMENT ON INDEX "public"."prestadoras_casilla_envio_unica" IS
  'Dos Prestadoras no mandan desde la misma dirección. Se compara en minúsculas porque una dirección de correo no distingue mayúsculas.';

-- 2. Qué dominios son de una casilla gratuita --------------------------------

CREATE TABLE IF NOT EXISTS "public"."dominios_de_correo_gratuitos" (
  "dominio" "text" PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT "now"()
);

COMMENT ON TABLE "public"."dominios_de_correo_gratuitos" IS
  'Catálogo de plataforma: dominios de casillas gratuitas. Lo usa el alta de una Prestadora para distinguir una dirección de empresa de una personal, y así saber de dónde sacar el nombre de su casilla de envío. Se amplía agregando filas, nunca tocando código.';

ALTER TABLE "public"."dominios_de_correo_gratuitos" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "panel_lee_dominios_de_correo_gratuitos" ON "public"."dominios_de_correo_gratuitos";
CREATE POLICY "panel_lee_dominios_de_correo_gratuitos" ON "public"."dominios_de_correo_gratuitos"
  FOR SELECT TO "authenticated" USING (true);

DROP POLICY IF EXISTS "superadmin_gestiona_dominios_de_correo_gratuitos" ON "public"."dominios_de_correo_gratuitos";
CREATE POLICY "superadmin_gestiona_dominios_de_correo_gratuitos" ON "public"."dominios_de_correo_gratuitos"
  FOR ALL USING ("interno"."es_superadmin"());

INSERT INTO "public"."dominios_de_correo_gratuitos" ("dominio") VALUES
  ('gmail.com'), ('googlemail.com'),
  ('hotmail.com'), ('hotmail.com.ar'), ('hotmail.es'), ('hotmail.com.br'),
  ('outlook.com'), ('outlook.com.ar'), ('outlook.es'), ('outlook.com.br'),
  ('live.com'), ('live.com.ar'), ('msn.com'),
  ('yahoo.com'), ('yahoo.com.ar'), ('yahoo.com.br'), ('yahoo.es'), ('ymail.com'),
  ('icloud.com'), ('me.com'), ('mac.com'),
  ('aol.com'), ('gmx.com'), ('gmx.es'), ('mail.com'), ('zoho.com'),
  ('proton.me'), ('protonmail.com'), ('pm.me'),
  ('yandex.com'), ('tutanota.com'),
  ('fibertel.com.ar'), ('speedy.com.ar'), ('arnet.com.ar'), ('ciudad.com.ar'),
  ('sinectis.com.ar'), ('datafull.com'), ('uol.com.br'), ('bol.com.br'),
  ('terra.com.br'), ('ig.com.br'), ('globo.com'), ('adinet.com.uy')
ON CONFLICT ("dominio") DO NOTHING;

NOTIFY pgrst, 'reload schema';

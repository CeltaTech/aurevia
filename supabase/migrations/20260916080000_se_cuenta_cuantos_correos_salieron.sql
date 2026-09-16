-- Se cuenta cuántos correos salieron
--
-- QUÉ FALTA HOY
-- El correo del producto sale por un despachante de afuera que tiene un tope: hasta
-- 3.000 por mes y **como mucho 100 por día**. Pasado ese tope el despachante deja de
-- aceptar envíos, y hoy no hay forma de verlo venir: el motor no anota en ningún lado
-- que mandó algo, así que el tope se descubre el día que un aviso no sale.
--
-- QUÉ HACE
-- Una tabla con un renglón por correo despachado: cuándo, de qué Prestadora, y si el
-- despachante lo aceptó o lo rechazó. Con eso el Panel muestra cuánto va del día y
-- cuánto del mes, antes de que apriete.
--
-- QUÉ NO GUARDA, Y ES A PROPÓSITO
-- Ni a quién iba, ni el asunto, ni una línea de lo que decía. Un registro de actividad
-- no lleva información sensible adentro (`celtatech/CLAUDE.md` §6), y para contar
-- contra un tope nada de eso hace falta. Tampoco guarda el texto del rechazo, que
-- repite el mensaje entero con sus destinatarios: queda el hecho de que fue rechazado.
--
-- CÓMO SE VUELVE ATRÁS
-- Borrando la tabla. Lo que se pierde es la cuenta, no ningún correo.

CREATE TABLE IF NOT EXISTS "public"."envios_de_correo" (
  "id" "uuid" PRIMARY KEY DEFAULT "gen_random_uuid"(),
  "prestadora_id" "uuid" REFERENCES "public"."prestadoras"("id") ON DELETE SET NULL,
  "aceptado" boolean NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "now"()
);

COMMENT ON TABLE "public"."envios_de_correo" IS
  'Un renglón por correo despachado, para contar contra el tope del despachante. No guarda destinatario, asunto ni contenido: para contar no hacen falta, y un registro no lleva información sensible adentro.';

COMMENT ON COLUMN "public"."envios_de_correo"."prestadora_id" IS
  'De qué Prestadora era el correo. Vacío cuando el envío no sale de ninguna en particular, como la recuperación de una cuenta. Si la Prestadora se borra, el renglón queda: la cuenta del mes ya pasó.';

COMMENT ON COLUMN "public"."envios_de_correo"."aceptado" IS
  'Si el despachante lo tomó. Falso es un correo que no salió, y muchos seguidos son la señal de que se llegó al tope.';

CREATE INDEX IF NOT EXISTS "envios_de_correo_por_fecha"
  ON "public"."envios_de_correo" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "envios_de_correo_por_prestadora"
  ON "public"."envios_de_correo" ("prestadora_id", "created_at" DESC);

ALTER TABLE "public"."envios_de_correo" ENABLE ROW LEVEL SECURITY;

-- Cada Prestadora ve lo suyo y nada de las demás. Los renglones sin Prestadora no los
-- ve nadie con sesión de Prestadora: no son de ninguna.
DROP POLICY IF EXISTS "la_prestadora_ve_sus_envios_de_correo" ON "public"."envios_de_correo";
CREATE POLICY "la_prestadora_ve_sus_envios_de_correo" ON "public"."envios_de_correo"
  FOR SELECT TO "authenticated"
  USING ("prestadora_id" = "interno"."current_tenant"());

-- El tope es de la cuenta entera del despachante, así que la cuenta completa —con los
-- envíos que no son de ninguna Prestadora— la mira quien administra la plataforma.
DROP POLICY IF EXISTS "superadmin_ve_todos_los_envios_de_correo" ON "public"."envios_de_correo";
CREATE POLICY "superadmin_ve_todos_los_envios_de_correo" ON "public"."envios_de_correo"
  FOR SELECT USING ("interno"."es_superadmin"());

NOTIFY pgrst, 'reload schema';

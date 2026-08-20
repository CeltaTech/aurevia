-- ---------------------------------------------------------------------------
-- Todo importe se guarda con su moneda — regla 14 de CLAUDE.md §7
--
-- QUÉ PASABA
-- Doce tablas guardaban cifras de dinero y una sola decía en qué moneda estaban
-- (`catalogo_modulos.moneda_addon`). El precio de una lista, lo que se le cobra a
-- un Cliente, lo que se le paga por hora a un Asistente, el monto de un cese: todos
-- eran números pelados. Careonys se vende en más de un país desde el día uno, así
-- que un número sin moneda, leído un año después, no se sabe cuánto vale y no hay
-- forma de reconstruirlo. En la pantalla el problema ya era visible: el peso
-- argentino estaba escrito a mano en el código, de modo que el saldo de una
-- Prestadora brasileña se mostraba en pesos argentinos.
--
-- QUÉ HACE
-- 1. Crea el tipo `moneda_iso`: tres letras mayúsculas, la forma del código ISO
--    4217. Se define una sola vez y lo usan todas las columnas (regla 12).
-- 2. Crea el catálogo `monedas_por_pais`, que dice qué moneda le corresponde a
--    cada país. Es configurable, no está escrito en el código (regla 1).
-- 3. Le da a cada Prestadora su moneda (`prestadoras.moneda`), que nace del país
--    que tenga configurado y después se cambia desde Configuración.
-- 4. Le agrega la columna `moneda` a cada tabla con importes, y un disparador que
--    la completa sola con la de la Prestadora que crea la fila. Nadie tiene que
--    acordarse de mandarla.
--
-- QUÉ NO HACE, Y POR QUÉ
-- No agrega nada fiscal: ni tipo de comprobante, ni punto de venta, ni numeración
-- autorizada, ni impuestos discriminados, ni cotización de referencia. Careonys no
-- emite comprobantes fiscales y no está previsto que lo haga — lo que guarda son
-- cuentas internas. El límite está escrito en la regla 14 para que no se estire.
--
-- Tampoco toca los importes que son gasto propio de CeltaTech y siempre están en
-- dólares (`uso_ia.costo_usd`, `precios_ia_modelo.precio_entrada_usd_por_millon`):
-- esos ya llevan la moneda en el nombre del campo y un identificador guardado no se
-- renombra (regla 13).
--
-- CÓMO SE VUELVE ATRÁS
-- Borrando los disparadores `trg_completar_moneda_*`, las columnas `moneda` que
-- agrega, la tabla `monedas_por_pais`, las funciones `moneda_de_prestadora` y
-- `fn_completar_moneda*`, y el tipo `moneda_iso`.
-- ---------------------------------------------------------------------------

-- 1. La forma de un código de moneda, definida una sola vez ------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'moneda_iso') THEN
    CREATE DOMAIN "public"."moneda_iso" AS "text"
      CONSTRAINT "moneda_iso_tres_letras" CHECK (VALUE ~ '^[A-Z]{3}$');
  END IF;
END
$$;

COMMENT ON DOMAIN "public"."moneda_iso" IS
  'Código de moneda de tres letras mayúsculas (ISO 4217): ARS, BRL, UYU, USD. Regla 14 de CLAUDE.md §7.';

-- 2. Qué moneda usa cada país ------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."monedas_por_pais" (
  "pais" "text" PRIMARY KEY,
  "moneda" "public"."moneda_iso" NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "now"()
);

COMMENT ON TABLE "public"."monedas_por_pais" IS
  'Catálogo de plataforma: qué moneda le corresponde a cada país. Lo usa el alta de una Prestadora para saber en qué moneda carga sus precios. Se amplía agregando filas, nunca tocando código.';

ALTER TABLE "public"."monedas_por_pais" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "panel_lee_monedas_por_pais" ON "public"."monedas_por_pais";
CREATE POLICY "panel_lee_monedas_por_pais" ON "public"."monedas_por_pais"
  FOR SELECT TO "authenticated" USING (true);

DROP POLICY IF EXISTS "superadmin_gestiona_monedas_por_pais" ON "public"."monedas_por_pais";
CREATE POLICY "superadmin_gestiona_monedas_por_pais" ON "public"."monedas_por_pais"
  FOR ALL USING ("public"."es_superadmin"());

INSERT INTO "public"."monedas_por_pais" ("pais", "moneda") VALUES
  ('AR', 'ARS'), ('BR', 'BRL'), ('UY', 'UYU'), ('CL', 'CLP'), ('PY', 'PYG'),
  ('BO', 'BOB'), ('PE', 'PEN'), ('CO', 'COP'), ('MX', 'MXN'), ('EC', 'USD'),
  ('US', 'USD'), ('ES', 'EUR')
ON CONFLICT ("pais") DO NOTHING;

-- 3. La moneda de cada Prestadora --------------------------------------------

ALTER TABLE "public"."prestadoras" ADD COLUMN IF NOT EXISTS "moneda" "public"."moneda_iso";

COMMENT ON COLUMN "public"."prestadoras"."moneda" IS
  'Moneda en la que esta Prestadora carga sus precios y cobra. Nace del país configurado y se cambia desde Configuración.';

UPDATE "public"."prestadoras" p
SET "moneda" = m."moneda"
FROM "public"."monedas_por_pais" m
WHERE m."pais" = p."pais" AND p."moneda" IS NULL;

-- Si quedó alguna Prestadora de un país que todavía no está en el catálogo, la
-- migración no puede adivinar su moneda: se detiene diciendo cuál es el país.
DO $$
DECLARE
  v_paises TEXT;
BEGIN
  SELECT string_agg(DISTINCT "pais", ', ') INTO v_paises
  FROM "public"."prestadoras" WHERE "moneda" IS NULL;

  IF v_paises IS NOT NULL THEN
    RAISE EXCEPTION
      'Hay Prestadoras de países que no están en el catálogo de monedas: %. Agregue una fila a monedas_por_pais por cada uno y vuelva a aplicar la migración.',
      v_paises;
  END IF;
END
$$;

ALTER TABLE "public"."prestadoras" ALTER COLUMN "moneda" SET NOT NULL;

CREATE OR REPLACE FUNCTION "public"."fn_moneda_de_prestadora_nueva"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_moneda public.moneda_iso;
BEGIN
  IF NEW.moneda IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT m.moneda INTO v_moneda FROM public.monedas_por_pais m WHERE m.pais = NEW.pais;

  IF v_moneda IS NULL THEN
    RAISE EXCEPTION
      'No se sabe en qué moneda trabaja una Prestadora del país %. Agregue ese país al catálogo monedas_por_pais, o indique la moneda al dar de alta la Prestadora.',
      NEW.pais;
  END IF;

  NEW.moneda := v_moneda;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_moneda_de_prestadora_nueva" ON "public"."prestadoras";
CREATE TRIGGER "trg_moneda_de_prestadora_nueva"
  BEFORE INSERT ON "public"."prestadoras"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_moneda_de_prestadora_nueva"();

-- 4. La moneda de un importe, completada sola --------------------------------

-- Un solo punto de verdad para la pregunta "¿en qué moneda trabaja esta
-- Prestadora?" (regla 12). Es SECURITY DEFINER porque los disparadores de abajo
-- corren en el contexto de quien inserta —una Coordinadora, el motor— y esa
-- consulta tiene que responder igual para todos; lo único que devuelve es un
-- código de tres letras, no un dato de la Prestadora.
CREATE OR REPLACE FUNCTION "public"."moneda_de_prestadora"("p_prestadora_id" "uuid")
  RETURNS "public"."moneda_iso"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT p.moneda FROM public.prestadoras p WHERE p.id = p_prestadora_id;
$$;

CREATE OR REPLACE FUNCTION "public"."fn_completar_moneda"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.moneda IS NULL AND NEW.prestadora_id IS NOT NULL THEN
    NEW.moneda := public.moneda_de_prestadora(NEW.prestadora_id);
  END IF;
  RETURN NEW;
END;
$$;

-- Las nueve tablas de importes que cuelgan directo de una Prestadora.
-- La lista está escrita a mano a propósito: agregar la columna a todo lo que
-- "parezca dinero" por el nombre metería también cantidades de filas y contadores.
DO $$
DECLARE
  v_tabla TEXT;
  v_prestadora_obligatoria BOOLEAN;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY[
    'ceses', 'cobros_marketplace', 'facturas_familia', 'guardias_cobertura',
    'lista_precios', 'paquetes_prestaciones', 'prestaciones',
    'remuneraciones_asistente', 'suscripciones_marketplace'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS moneda public.moneda_iso', v_tabla);

    EXECUTE format(
      'UPDATE public.%I t SET moneda = public.moneda_de_prestadora(t.prestadora_id) WHERE t.moneda IS NULL',
      v_tabla
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_completar_moneda ON public.%I', v_tabla
    );
    EXECUTE format(
      'CREATE TRIGGER trg_completar_moneda BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_completar_moneda()',
      v_tabla
    );

    -- La columna se vuelve obligatoria solo si la Prestadora también lo es en esa
    -- tabla; si no, no habría de dónde sacar la moneda y la fila quedaría trabada.
    SELECT c.is_nullable = 'NO' INTO v_prestadora_obligatoria
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = v_tabla AND c.column_name = 'prestadora_id';

    IF v_prestadora_obligatoria THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN moneda SET NOT NULL', v_tabla);
    END IF;
  END LOOP;
END
$$;

-- Los renglones de un saldo heredan la moneda del saldo al que pertenecen.
ALTER TABLE "public"."facturas_familia_items" ADD COLUMN IF NOT EXISTS "moneda" "public"."moneda_iso";

UPDATE "public"."facturas_familia_items" i
SET "moneda" = f."moneda"
FROM "public"."facturas_familia" f
WHERE f."id" = i."factura_id" AND i."moneda" IS NULL;

CREATE OR REPLACE FUNCTION "public"."fn_completar_moneda_desde_factura"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.moneda IS NULL THEN
    SELECT f.moneda INTO NEW.moneda FROM public.facturas_familia f WHERE f.id = NEW.factura_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_completar_moneda" ON "public"."facturas_familia_items";
CREATE TRIGGER "trg_completar_moneda"
  BEFORE INSERT ON "public"."facturas_familia_items"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_completar_moneda_desde_factura"();

ALTER TABLE "public"."facturas_familia_items" ALTER COLUMN "moneda" SET NOT NULL;

-- El cobro en efectivo por QR llega por la Familia, no por la Prestadora.
ALTER TABLE "public"."qr_cobro_efectivo" ADD COLUMN IF NOT EXISTS "moneda" "public"."moneda_iso";

UPDATE "public"."qr_cobro_efectivo" q
SET "moneda" = "public"."moneda_de_prestadora"(f."prestadora_id")
FROM "public"."familias" f
WHERE f."id" = q."familia_id" AND q."moneda" IS NULL;

CREATE OR REPLACE FUNCTION "public"."fn_completar_moneda_desde_familia"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.moneda IS NULL THEN
    SELECT public.moneda_de_prestadora(f.prestadora_id) INTO NEW.moneda
    FROM public.familias f WHERE f.id = NEW.familia_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_completar_moneda" ON "public"."qr_cobro_efectivo";
CREATE TRIGGER "trg_completar_moneda"
  BEFORE INSERT ON "public"."qr_cobro_efectivo"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_completar_moneda_desde_familia"();

ALTER TABLE "public"."qr_cobro_efectivo" ALTER COLUMN "moneda" SET NOT NULL;

-- Los precios de los modelos de inteligencia artificial son gasto propio de
-- CeltaTech y están siempre en dólares: no cuelgan de ninguna Prestadora.
ALTER TABLE "public"."cambios_precio_ia_pendientes"
  ADD COLUMN IF NOT EXISTS "moneda" "public"."moneda_iso" NOT NULL DEFAULT 'USD';

NOTIFY pgrst, 'reload schema';

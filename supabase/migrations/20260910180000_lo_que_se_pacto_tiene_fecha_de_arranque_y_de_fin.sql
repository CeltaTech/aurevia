-- ---------------------------------------------------------------------------
-- Lo que se pactó tiene fecha de arranque y de fin
--
-- QUÉ ESTABA MAL. Una prestación —lo que se le presta a un Paciente y se le
-- cobra al Cliente— no guardaba ninguna fecha de negocio. Lo único que decía si
-- seguía en pie era `estado`, que tiene dos valores y ninguna fecha: al darla de
-- baja no quedaba registrado cuándo. De ahí salen dos problemas concretos:
--
--   - No se puede pactar algo que arranca más adelante. Un acuerdo firmado hoy
--     que empieza el mes que viene se cargaba hoy y ya contaba como vigente.
--   - No se puede facturar un período. La factura arma el total con todo lo que
--     está en `vigente` y ningún filtro de fecha, así que una prestación dada de
--     baja a mitad de mes se cobra entera o no se cobra, según cuándo se emita.
--
-- QUÉ AGREGA. Dos columnas, `vigente_desde` y `vigente_hasta`, con la misma
-- forma y el mismo significado que ya tienen en el resto de la base —
-- `series_guardias`, `matriculas_asistente`, `indicaciones_medicacion`—:
-- `vigente_desde` es el primer día en que corre, `vigente_hasta` es el último
-- día en que corre —incluido—, y en `NULL` quiere decir que sigue abierta.
-- La forma de preguntarlo ya está escrita en el motor y no se cambia
-- (`backend/src/utils/medicacionIndicaciones.js:40-41`):
--     vigente_desde <= fecha  AND  (vigente_hasta IS NULL OR vigente_hasta >= fecha)
--
-- QUÉ NO CAMBIA. `estado` se queda, y no dice lo mismo: las fechas son el
-- período que se pactó, y `estado` es si se dio de baja antes de que ese período
-- terminara. Para que las dos no puedan contestar cosas distintas, la pregunta
-- «¿esto se cobra el día X?» se responde en un solo lugar, mirando las dos
-- cosas a la vez: `panel/src/lib/vigenciaPrestacion.js`.
--
-- EL RELLENO DE LO QUE YA ESTÁ CARGADO. `vigente_desde` toma el día en que la
-- fila se dio de alta, que es el único dato que hay. Para `vigente_hasta` no hay
-- ningún dato: la base nunca guardó cuándo se dio de baja una prestación, y
-- `updated_at` no sirve de sustituto porque ningún disparador lo mantiene —vale
-- lo mismo que `created_at`—. Se usa igual, porque deja la prestación fuera de
-- toda facturación de acá en adelante, que es lo que la baja quiso decir. Es una
-- decisión, no un dato recuperado, y por eso está escrita acá.
--
-- Y DE ACÁ EN ADELANTE NO SE VUELVE A PERDER: un disparador le pone fecha de fin
-- a toda prestación que pase a `de_baja` sin traerla. Se hace en la base y no en
-- la pantalla porque la pantalla no es el único que escribe esta tabla.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Las dos columnas
--
-- Nacen aceptando vacío para poder rellenarlas con lo que hay; recién después se
-- exige que `vigente_desde` esté siempre y se le pone el valor de fábrica. Al
-- revés —agregarla ya obligatoria y con valor de fábrica— Postgres le estampa
-- la fecha de hoy a todas las filas viejas de una, y el dato que se quería
-- rescatar se pierde antes de poder mirarlo.
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."prestaciones"
  ADD COLUMN IF NOT EXISTS "vigente_desde" date,
  ADD COLUMN IF NOT EXISTS "vigente_hasta" date;

UPDATE "public"."prestaciones"
   SET "vigente_desde" = COALESCE("created_at", now())::date
 WHERE "vigente_desde" IS NULL;

UPDATE "public"."prestaciones"
   SET "vigente_hasta" = GREATEST(
         "vigente_desde",
         COALESCE("updated_at", "created_at", now())::date
       )
 WHERE "estado" = 'de_baja'
   AND "vigente_hasta" IS NULL;

-- ---------------------------------------------------------------------------
-- 2. La comprobación, fila por fila, antes de seguir
--
-- Si algo de esto no cuadra, la migración se corta y la base queda como estaba:
-- vale más no avanzar que avanzar con fechas inventadas.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  sin_arranque bigint;
  mal_rellenadas bigint;
  al_reves bigint;
  de_baja_sin_fin bigint;
BEGIN
  SELECT count(*) INTO sin_arranque
    FROM public.prestaciones WHERE vigente_desde IS NULL;
  IF sin_arranque > 0 THEN
    RAISE EXCEPTION 'quedaron % prestacion(es) sin fecha de arranque', sin_arranque;
  END IF;

  -- No alcanza con que esté llena: tiene que ser la fecha del alta y no la de
  -- hoy. Sin esta comprobación, un relleno que no llegó a correr pasaría igual.
  SELECT count(*) INTO mal_rellenadas
    FROM public.prestaciones
   WHERE vigente_desde IS DISTINCT FROM COALESCE(created_at, now())::date;
  IF mal_rellenadas > 0 THEN
    RAISE EXCEPTION '% prestacion(es) no arrancan el dia en que se dieron de alta', mal_rellenadas;
  END IF;

  SELECT count(*) INTO al_reves
    FROM public.prestaciones
   WHERE vigente_hasta IS NOT NULL AND vigente_hasta < vigente_desde;
  IF al_reves > 0 THEN
    RAISE EXCEPTION '% prestacion(es) terminan antes de empezar', al_reves;
  END IF;

  SELECT count(*) INTO de_baja_sin_fin
    FROM public.prestaciones
   WHERE estado = 'de_baja' AND vigente_hasta IS NULL;
  IF de_baja_sin_fin > 0 THEN
    RAISE EXCEPTION '% prestacion(es) dadas de baja sin fecha de fin', de_baja_sin_fin;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Recién ahora, obligatoria y con valor de fábrica
--
-- El valor de fábrica es lo que deja seguir funcionando a todo lo que ya escribe
-- en esta tabla sin nombrar la columna nueva —la semilla, el script de prueba
-- del cierre de servicio— y lo que hace que la base se pueda volver a construir
-- desde cero. Lo que arranca hoy no tiene que decirlo.
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."prestaciones"
  ALTER COLUMN "vigente_desde" SET DEFAULT CURRENT_DATE,
  ALTER COLUMN "vigente_desde" SET NOT NULL;

ALTER TABLE "public"."prestaciones"
  DROP CONSTRAINT IF EXISTS "prestaciones_vigencia_coherente";

ALTER TABLE "public"."prestaciones"
  ADD CONSTRAINT "prestaciones_vigencia_coherente"
  CHECK ("vigente_hasta" IS NULL OR "vigente_hasta" >= "vigente_desde");

COMMENT ON COLUMN "public"."prestaciones"."vigente_desde" IS
  'Primer dia en que corre lo pactado. Puede ser posterior al alta: un acuerdo se firma antes de arrancar.';
COMMENT ON COLUMN "public"."prestaciones"."vigente_hasta" IS
  'Ultimo dia en que corre lo pactado, incluido. Vacio quiere decir que sigue abierta.';

-- El indice sirve la unica consulta que hace la facturacion: las prestaciones en
-- pie de un puñado de Pacientes dentro de un periodo. Va con la condicion de
-- `estado` adentro porque las dadas de baja no se facturan nunca y no hace falta
-- que ocupen lugar en el indice.
CREATE INDEX IF NOT EXISTS "idx_prestaciones_vigencia"
  ON "public"."prestaciones" ("paciente_id", "vigente_desde", "vigente_hasta")
  WHERE "estado" = 'vigente';

-- ---------------------------------------------------------------------------
-- 4. La fecha de fin se pone sola al dar de baja
--
-- Va en el esquema `interno`, que no se publica como direccion web, igual que el
-- resto de las funciones que solo usa la base (`CLAUDE.md` del producto, §6).
--
-- La regla es una sola: una prestacion dada de baja termina el dia en que se la
-- dio de baja. Y por eso el disparador tiene que pisar la fecha que hubiera, no
-- solo llenar la que falta: lo pactado hasta fin de año que se corta en junio
-- termina en junio, y si se dejara el fin de año la facturacion la seguiria
-- cobrando seis meses despues de que nadie fue mas a esa casa.
--
-- La unica fecha que respeta es la que el mismo movimiento trae escrita, que es
-- como se carga una baja que ocurrio antes de que alguien llegara a anotarla.
--
-- Solo mira el lado del cierre. Volver a poner en pie una prestacion dada de
-- baja no lo hace hoy ninguna pantalla ni ningun script, y escribir el caso al
-- revés seria construir un control para vigilar cero casos: el dia que exista,
-- se agrega acá.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "interno"."cerrar_vigencia_de_la_prestacion"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, interno
AS $$
DECLARE
  recien_se_da_de_baja boolean;
  la_trae_escrita boolean;
BEGIN
  IF NEW.estado <> 'de_baja' THEN
    RETURN NEW;
  END IF;

  recien_se_da_de_baja := TG_OP = 'INSERT' OR OLD.estado <> 'de_baja';
  la_trae_escrita := CASE
    WHEN TG_OP = 'INSERT' THEN NEW.vigente_hasta IS NOT NULL
    ELSE NEW.vigente_hasta IS DISTINCT FROM OLD.vigente_hasta
  END;

  IF recien_se_da_de_baja AND NOT la_trae_escrita THEN
    -- `GREATEST` cubre la prestacion que se da de baja antes de arrancar: no
    -- puede terminar antes de empezar, y la restriccion de mas arriba lo exige.
    NEW.vigente_hasta := GREATEST(NEW.vigente_desde, CURRENT_DATE);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "cerrar_vigencia_prestaciones" ON "public"."prestaciones";

-- Sin lista de columnas a proposito: la baja se escribe tocando `estado`, pero
-- tambien llega en un `UPDATE` que cambia otras cosas a la vez, y una lista deja
-- afuera justo el caso que no se previo.
CREATE TRIGGER "cerrar_vigencia_prestaciones"
  BEFORE INSERT OR UPDATE
  ON "public"."prestaciones"
  FOR EACH ROW EXECUTE FUNCTION "interno"."cerrar_vigencia_de_la_prestacion"();

REVOKE ALL ON FUNCTION "interno"."cerrar_vigencia_de_la_prestacion"() FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "interno"."cerrar_vigencia_de_la_prestacion"() TO "authenticated", "service_role";

NOTIFY pgrst, 'reload schema';

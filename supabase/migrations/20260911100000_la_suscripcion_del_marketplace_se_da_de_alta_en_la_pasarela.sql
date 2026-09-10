-- La suscripción del Marketplace se da de alta en la pasarela, y cada período tiene su cobro
--
-- QUÉ PASABA. Las seis pasarelas de cobro están escritas y probadas (`backend/src/pasarelas/`),
-- pero a tres de sus funciones no las llamaba nadie: `crearSuscripcion`, `generarCobroQr` y
-- `generarCupon`. La consecuencia práctica es que ninguna suscripción existía del lado del
-- proveedor —no había con qué cobrarle a nadie— y que todo cobro se cargaba a mano desde el
-- Panel. El aviso de cobro que manda el proveedor tampoco encontraba nunca su fila, porque
-- `backend/src/routes/webhooksPasarelas.js` buscaba siempre por la referencia de un cobro, y las
-- pasarelas que cobran solas mandan la referencia de la **suscripción**.
--
-- QUÉ HACE ESTA. Le da a la base las cuatro columnas que faltaban para que una suscripción sepa
-- en qué pasarela está dada de alta, y a cada cobro las dos con las que la Familia efectivamente
-- paga ese período. Y agrega los índices que hacen que las tres búsquedas nuevas —la del aviso
-- entrante, la del trabajo diario y la que evita cobrar dos veces el mismo período— no recorran
-- la tabla entera.
--
-- LAS DOS FORMAS DE COBRAR, QUE SON LAS QUE EXPLICAN LAS COLUMNAS. Los seis rieles se parten en
-- dos grupos, y la diferencia no es de detalle:
--
--   * **La pasarela cobra sola, mes a mes** (`mercadopago`, `stripe`, `debin`). Se da de alta la
--     suscripción una vez, el proveedor devuelve un identificador que es de la suscripción, y
--     desde ahí manda un aviso por cada período que cobra. Eso va en
--     `suscripciones_marketplace.referencia_externa`.
--   * **Se arma el cobro período por período** (`modo`, `cobranza_efectivo`). En el proveedor no
--     queda nada recurrente: cada mes hay que pedirle un QR o un cupón, y cada uno trae su propio
--     identificador. Eso va en `cobros_marketplace.referencia_externa`, que ya existía, junto con
--     la dirección del QR o el código del cupón, que son las dos columnas nuevas de esa tabla.
--
-- `efectivo_manual` no es ninguno de los dos: no hay proveedor, la carga la hace una persona
-- desde el Panel, y eso ya funcionaba.
--
-- POR QUÉ `proveedor` NO LLEVA CLAVE FORÁNEA NI LISTA CERRADA. La lista de rieles vive en el
-- código (`backend/src/pasarelas/index.js`), que es quien sabe cómo hablarle a cada uno. Una
-- clave foránea contra `prestadora_pasarela_pago` haría que desconectar una pasarela rompiera las
-- suscripciones que se dieron de alta con ella —justamente las que hay que seguir cobrando o dar
-- de baja—, y una lista escrita acá adentro obligaría a una migración por cada riel nuevo. Lo que
-- valida es la ruta, contra `proveedoresDisponibles()`. Es el mismo criterio con el que ya vive
-- `cobros_marketplace.medio`, que tampoco tiene lista cerrada.
--
-- POR QUÉ EL ÍNDICE ÚNICO PARCIAL DE `cobros_marketplace`. El trabajo diario que arma los cobros
-- corre todos los días, y un período que ya tiene su cobro pendiente no tiene que volver a
-- armarse: si se armara dos veces, la Familia vería dos QR vivos por el mismo mes y podría pagar
-- dos veces. El índice deja pasar un solo cobro `pendiente` por suscripción y período, y no toca
-- los que ya se resolvieron —una suscripción puede tener un cobro fallido y otro exitoso del
-- mismo mes, que es exactamente lo que pasa cuando el primer intento no entra y el segundo sí.
--
-- SI HAY QUE VOLVER ATRÁS. Se agrega otra migración adelante que suelte los cuatro índices y las
-- seis columnas. Nunca se edita ésta.

BEGIN;

-- ----------------------------------------------------------------------------
-- La suscripción: dónde está dada de alta
-- ----------------------------------------------------------------------------

ALTER TABLE public.suscripciones_marketplace
  -- Con qué riel se dio de alta. Nulo mientras no se haya dado de alta en ninguno, que es el
  -- estado de toda suscripción recién creada.
  ADD COLUMN IF NOT EXISTS proveedor text,
  -- El identificador que devolvió el proveedor. Es el que trae el aviso de cobro de los rieles
  -- que cobran solos, y por eso se busca por él.
  ADD COLUMN IF NOT EXISTS referencia_externa text,
  -- Adónde tiene que ir la Familia para autorizar el cobro, cuando el riel lo pide. Mercado Pago
  -- devuelve su `init_point` y DEBIN su dirección de autorización; Stripe no devuelve ninguna.
  ADD COLUMN IF NOT EXISTS url_accion text,
  -- Cuándo quedó dada de alta. Es lo que hace que el alta no se repita: con esta fecha puesta, la
  -- suscripción ya existe del lado del proveedor y volver a crearla generaría una segunda.
  ADD COLUMN IF NOT EXISTS alta_en_pasarela timestamptz;

COMMENT ON COLUMN public.suscripciones_marketplace.proveedor IS
  'Riel de cobro con el que se dio de alta esta suscripción. Nulo si todavía no se dio de alta. La lista válida vive en backend/src/pasarelas/index.js.';
COMMENT ON COLUMN public.suscripciones_marketplace.referencia_externa IS
  'Identificador de la suscripción del lado del proveedor. Por acá la encuentra el aviso de cobro de los rieles que cobran solos.';
COMMENT ON COLUMN public.suscripciones_marketplace.alta_en_pasarela IS
  'Cuándo quedó dada de alta en el proveedor. Con esta fecha puesta, el alta no se vuelve a intentar.';

-- ----------------------------------------------------------------------------
-- El cobro de un período: con qué paga la Familia
-- ----------------------------------------------------------------------------

ALTER TABLE public.cobros_marketplace
  -- La dirección del QR que devolvió MODO para este período.
  ADD COLUMN IF NOT EXISTS url_accion text,
  -- El código del cupón que devolvió la cobranza en efectivo para este período.
  ADD COLUMN IF NOT EXISTS codigo_cupon text;

COMMENT ON COLUMN public.cobros_marketplace.url_accion IS
  'Dirección del QR con el que la Familia paga este período, en los rieles que la devuelven.';
COMMENT ON COLUMN public.cobros_marketplace.codigo_cupon IS
  'Código del cupón con el que la Familia paga este período, en los rieles de cobranza en efectivo.';

-- ----------------------------------------------------------------------------
-- Los índices de las tres búsquedas nuevas
-- ----------------------------------------------------------------------------

-- 1. El aviso de un riel que cobra solo llega con la referencia de la suscripción.
CREATE INDEX IF NOT EXISTS idx_suscripciones_marketplace_referencia
  ON public.suscripciones_marketplace (prestadora_id, referencia_externa)
  WHERE referencia_externa IS NOT NULL;

-- 2. El aviso de un riel que se arma período por período llega con la referencia del cobro. Esta
--    búsqueda ya existía en el código desde el primer día y no tenía índice ninguno.
CREATE INDEX IF NOT EXISTS idx_cobros_marketplace_referencia
  ON public.cobros_marketplace (prestadora_id, referencia_externa)
  WHERE referencia_externa IS NOT NULL;

-- 3. El trabajo diario busca las suscripciones vivas cuyo próximo cobro ya venció.
CREATE INDEX IF NOT EXISTS idx_suscripciones_marketplace_por_cobrar
  ON public.suscripciones_marketplace (prestadora_id, proximo_cobro)
  WHERE estado IN ('trial', 'activa') AND proximo_cobro IS NOT NULL;

-- Y el candado: un solo cobro pendiente por suscripción y período.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cobros_marketplace_periodo_pendiente
  ON public.cobros_marketplace (suscripcion_id, periodo)
  WHERE estado_cobro = 'pendiente';

-- ----------------------------------------------------------------------------
-- Comprobación de salida
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_columnas integer;
  v_indices integer;
  v_duplicados integer;
BEGIN
  SELECT count(*) INTO v_columnas
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'suscripciones_marketplace'
           AND column_name IN ('proveedor', 'referencia_externa', 'url_accion', 'alta_en_pasarela'))
       OR (table_name = 'cobros_marketplace'
           AND column_name IN ('url_accion', 'codigo_cupon')));

  IF v_columnas <> 6 THEN
    RAISE EXCEPTION 'faltan_columnas_de_alta_en_pasarela:%', v_columnas;
  END IF;

  SELECT count(*) INTO v_indices
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN ('idx_suscripciones_marketplace_referencia',
                       'idx_cobros_marketplace_referencia',
                       'idx_suscripciones_marketplace_por_cobrar',
                       'uq_cobros_marketplace_periodo_pendiente');

  IF v_indices <> 4 THEN
    RAISE EXCEPTION 'faltan_indices_de_alta_en_pasarela:%', v_indices;
  END IF;

  -- El índice único no se puede crear si ya hay dos cobros pendientes del mismo período, así que
  -- si llegamos hasta acá no los había. Se comprueba igual, porque una comprobación que no puede
  -- fallar no prueba nada y ésta sí puede: en la nube la tabla puede tener filas que acá no.
  SELECT count(*) INTO v_duplicados
    FROM (
      SELECT suscripcion_id, periodo
        FROM public.cobros_marketplace
       WHERE estado_cobro = 'pendiente'
       GROUP BY suscripcion_id, periodo
      HAVING count(*) > 1
    ) AS repetidos;

  IF v_duplicados > 0 THEN
    RAISE EXCEPTION 'cobros_pendientes_repetidos_por_periodo:%', v_duplicados;
  END IF;

  RAISE NOTICE 'La suscripción del Marketplace ya puede darse de alta en una pasarela, y cada período tiene dónde guardar su cobro.';
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

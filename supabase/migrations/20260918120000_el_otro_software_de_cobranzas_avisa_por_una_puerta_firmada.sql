-- ---------------------------------------------------------------------------
-- El otro software de creditos y cobranzas avisa por una puerta firmada
--
-- DE DONDE VIENE. La migracion anterior dejo que cada Prestadora decida si el seguimiento de la
-- cobranza es suyo o de otro software, y creo la tabla donde se anotan los avisos de restriccion.
-- Faltaba la puerta: por donde entra ese aviso y como se sabe que lo mando quien dice.
--
-- COMO SE SABE QUE EL AVISO ES DE VERDAD. Igual que los avisos de cobro de las pasarelas: la
-- Prestadora viaja en la direccion, el aviso viene firmado con un secreto que solo conocen ella y
-- su software, y el secreto se guarda en la caja fuerte de la base, nunca en una columna de texto.
-- Sin secreto cargado no entra ningun aviso, que es lo correcto: mejor no recibir ninguno que
-- recibir cualquiera.
--
-- DONDE VIVE EL SECRETO. En la misma fila donde ya vive el interruptor, porque es la misma
-- decision: como cobra esta Prestadora. Lo que se guarda ahi es el numero de referencia de la caja
-- fuerte; el texto del secreto no queda en ninguna columna y no se puede leer desde el Panel.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.configuracion_facturacion_familias
  ADD COLUMN IF NOT EXISTS secreto_del_aviso_secret_id uuid;

COMMENT ON COLUMN public.configuracion_facturacion_familias.secreto_del_aviso_secret_id IS
  'Referencia a vault.secrets con el secreto con el que el software de creditos y cobranzas de esta Prestadora firma sus avisos de restriccion. El texto nunca se guarda aca. Vacio quiere decir que no entra ningun aviso.';

-- ---------------------------------------------------------------------------
-- Guardar el secreto, y leerlo
--
-- Calcadas de las de la firma de las pasarelas: si ya hay caja fuerte se le cambia el contenido en
-- vez de abrir otra, asi rotar el secreto no va dejando cajas viejas sin dueno.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guardar_secreto_del_aviso_de_cobranza(
  p_prestadora_id uuid,
  p_secreto text
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT secreto_del_aviso_secret_id INTO v_secret_id
  FROM configuracion_facturacion_familias
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(p_secreto, 'aviso_de_cobranza_' || p_prestadora_id::text);
    INSERT INTO configuracion_facturacion_familias (prestadora_id, secreto_del_aviso_secret_id)
    VALUES (p_prestadora_id, v_secret_id)
    ON CONFLICT (prestadora_id)
    DO UPDATE SET secreto_del_aviso_secret_id = EXCLUDED.secreto_del_aviso_secret_id, updated_at = NOW();
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_secreto);
    UPDATE configuracion_facturacion_familias SET updated_at = NOW()
    WHERE prestadora_id = p_prestadora_id;
  END IF;

  RETURN v_secret_id;
END;
$$;

ALTER FUNCTION public.guardar_secreto_del_aviso_de_cobranza(uuid, text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.leer_secreto_del_aviso_de_cobranza(
  p_prestadora_id uuid
) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
  v_secreto TEXT;
BEGIN
  SELECT secreto_del_aviso_secret_id INTO v_secret_id
  FROM configuracion_facturacion_familias
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secreto FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_secreto;
END;
$$;

ALTER FUNCTION public.leer_secreto_del_aviso_de_cobranza(uuid) OWNER TO postgres;

-- Las dos se le sacan a todo el mundo y se le dan solamente al motor. Nadie con sesion en el Panel
-- llega al texto de un secreto, ni siquiera quien lo cargo.
REVOKE ALL ON FUNCTION public.guardar_secreto_del_aviso_de_cobranza(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_secreto_del_aviso_de_cobranza(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.guardar_secreto_del_aviso_de_cobranza(uuid, text) FROM authenticated;
GRANT ALL ON FUNCTION public.guardar_secreto_del_aviso_de_cobranza(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.leer_secreto_del_aviso_de_cobranza(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leer_secreto_del_aviso_de_cobranza(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.leer_secreto_del_aviso_de_cobranza(uuid) FROM authenticated;
GRANT ALL ON FUNCTION public.leer_secreto_del_aviso_de_cobranza(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Un aviso se atiende una sola vez
--
-- La firma lleva un instante y se rechaza lo que llego tarde, pero adentro de esos minutos un
-- aviso autentico copiado se puede volver a mandar. El numero que le pone quien avisa corta eso:
-- el segundo intento con el mismo numero no entra.
--
-- Es por Prestadora a proposito: dos software distintos pueden numerar igual y no tienen por que
-- saberlo.
-- ---------------------------------------------------------------------------

ALTER TABLE public.restricciones_de_cobranza
  ADD COLUMN IF NOT EXISTS numero_del_aviso text;

COMMENT ON COLUMN public.restricciones_de_cobranza.numero_del_aviso IS
  'Como numero el aviso quien lo mando. Sirve para no atender dos veces el mismo. Vacio en los avisos cargados a mano desde el Panel.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_restricciones_de_cobranza_aviso_unico
  ON public.restricciones_de_cobranza (prestadora_id, numero_del_aviso)
  WHERE numero_del_aviso IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'configuracion_facturacion_familias'
      AND column_name = 'secreto_del_aviso_secret_id'
  ) THEN
    RAISE EXCEPTION 'La Prestadora quedo sin donde guardar el secreto del aviso';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'leer_secreto_del_aviso_de_cobranza'
  ) THEN
    RAISE EXCEPTION 'El motor quedo sin poder leer el secreto del aviso';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public'
      AND routine_name = 'leer_secreto_del_aviso_de_cobranza'
      AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'El secreto del aviso quedo al alcance de una sesion del Panel';
  END IF;

  RAISE NOTICE 'La puerta del aviso de restriccion queda firmada y el secreto en la caja fuerte.';
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

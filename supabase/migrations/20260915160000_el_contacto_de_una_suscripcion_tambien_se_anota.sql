-- El contacto de un acceso que se sostiene por fecha también se anota
-- ============================================================================
--
-- QUÉ ESTABA PASANDO. `consumir_contacto_marketplace` se escribió antes de que existiera quien la
-- llamara, y por eso dejó un caso abierto: un acceso sin saldo cargado —el que se sostiene por
-- fecha, como una suscripción— devolvía `acceso_sin_saldo` y no anotaba nada, con el comentario de
-- que la regla la decidía quien llamara. Quien llama ya existe, y su regla es la única que puede
-- ser: **el contacto se abre igual.** La suscripción no tiene tope de contactos —`contactos_
-- incluidos` vacío es exactamente eso—, así que negárselo sería cobrarle un servicio que después
-- no se le presta.
--
-- POR QUÉ SE ANOTA IGUAL SI NO SE DESCUENTA NADA. La fila de `contactos_vistos_marketplace` no es
-- sólo el recibo del descuento: es lo que le dice al resto del producto que esa pareja de Familia
-- y Asistente ya puede verse los datos, y lo que destapa el chat. Sin ella, quien paga una
-- suscripción tendría el contacto tapado para siempre.
--
-- Y SE HACE ACÁ Y NO DEL LADO DEL MOTOR por dos motivos. Uno es que la fila del acceso ya está
-- tomada desde arriba de esta función, así que dos pedidos simultáneos de la misma Familia se
-- ordenan solos; el otro es que anotar un contacto abierto es una decisión sola y tiene que vivir
-- en un solo lugar.
--
-- QUÉ NO CAMBIA. El acceso que no existe, el que no está vigente y el que se quedó sin saldo
-- contestan lo mismo que antes. `acceso_sin_saldo` deja de salir de acá, y el motor lo sigue
-- reconociendo por si alguna vez vuelve.

CREATE OR REPLACE FUNCTION public.consumir_contacto_marketplace(p_acceso_id uuid, p_asistente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_acceso public.accesos_marketplace%ROWTYPE;
  v_ya_estaba boolean;
  v_saldo integer;
BEGIN
  -- Tomada la fila del acceso, el que llegue segundo espera acá. Sin esto, dos pedidos leen el
  -- mismo saldo y los dos descuentan sobre ese número: de dos contactos se cobra uno.
  SELECT * INTO v_acceso
    FROM public.accesos_marketplace
   WHERE id = p_acceso_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'acceso_inexistente');
  END IF;

  -- Falla cerrado: un acceso vencido o dado de baja no abre nada, aunque le haya quedado saldo.
  IF v_acceso.estado <> 'vigente' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'acceso_no_vigente');
  END IF;

  -- Ya abierto antes: se contesta que sí y no se cobra de nuevo. El contacto de un Asistente se
  -- paga una sola vez por Familia, y mirarlo otra vez no es un contacto nuevo.
  SELECT EXISTS (
    SELECT 1 FROM public.contactos_vistos_marketplace
     WHERE familia_id = v_acceso.familia_id AND asistente_id = p_asistente_id
  ) INTO v_ya_estaba;

  IF v_ya_estaba THEN
    RETURN jsonb_build_object(
      'ok', true, 'ya_estaba', true, 'saldo_contactos', v_acceso.saldo_contactos
    );
  END IF;

  IF v_acceso.saldo_contactos IS NOT NULL AND v_acceso.saldo_contactos <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'saldo_agotado', 'saldo_contactos', 0);
  END IF;

  -- Se anota primero y se descuenta después, en ese orden y no al revés: así el candado de la
  -- tabla es el que decide, y no queda ninguna forma de descontar sin haber anotado. La misma
  -- Familia con dos paquetes abriendo el mismo Asistente a la vez llega hasta acá por dos filas
  -- de acceso distintas, que el candado de más arriba no cruza; el segundo choca contra éste.
  BEGIN
    INSERT INTO public.contactos_vistos_marketplace
      (prestadora_id, familia_id, asistente_id, acceso_id)
    VALUES
      (v_acceso.prestadora_id, v_acceso.familia_id, p_asistente_id, p_acceso_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', true, 'ya_estaba', true, 'saldo_contactos', v_acceso.saldo_contactos
    );
  END;

  -- El que se sostiene por fecha no tiene qué descontar: queda anotado y el saldo sigue vacío.
  IF v_acceso.saldo_contactos IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'ya_estaba', false, 'saldo_contactos', NULL);
  END IF;

  UPDATE public.accesos_marketplace
     SET saldo_contactos = saldo_contactos - 1,
         updated_at = now()
   WHERE id = p_acceso_id
  RETURNING saldo_contactos INTO v_saldo;

  RETURN jsonb_build_object('ok', true, 'ya_estaba', false, 'saldo_contactos', v_saldo);
END;
$$;

COMMENT ON FUNCTION public.consumir_contacto_marketplace(uuid, uuid) IS
  'Anota a qué Asistente se le abrió el contacto y, si el acceso se sostiene por saldo, le descuenta uno, en la misma transacción. Un Asistente ya abierto no vuelve a descontar. El acceso que se sostiene por fecha se anota sin descontar nada. Devuelve ok y el saldo que queda, o el motivo por el que no se pudo.';

NOTIFY pgrst, 'reload schema';

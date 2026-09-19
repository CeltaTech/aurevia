-- ---------------------------------------------------------------------------
-- La conexion con el software de facturacion y con el de creditos y cobranzas
--
-- QUE ES Y QUE NO ES. Careonys no emite comprobantes, no calcula impuestos, no reclama y no
-- gestiona la mora. Las dos tareas son software aparte, comprado por la Prestadora, y esto es
-- apenas la libreta donde ella anota cual es el suyo y con que credencial se entra. Aca no se
-- emite, no se calcula y no se liquida nada.
--
-- POR QUE HACE FALTA. Hasta hoy la unica conexion escrita era la de vuelta: el software de afuera
-- avisandole a Careonys lo que emitio, firmado con un secreto por Prestadora
-- (20260918120000 y 20260919100000). La de ida no tiene donde apoyarse: para llamar al software de
-- la Prestadora hay que saber cual es y con que credencial se entra, y eso no estaba guardado en
-- ningun lado.
--
-- COMO SE GUARDA LA CREDENCIAL. Igual que el secreto de la firma, sin una segunda forma: en la
-- caja fuerte de Supabase (`vault`). La tabla guarda unicamente el numero de referencia de la
-- caja, nunca el texto. Dos funciones SECURITY DEFINER —una para guardar, otra para leer— son las
-- unicas que la tocan, y se le sacan a todo el mundo menos al motor. Nadie con sesion en el Panel
-- llega al texto de una credencial, ni siquiera el Admin de la propia Prestadora que la cargo. La
-- clave con la que la caja fuerte cifra es de Supabase, distinta por ambiente, y no vive en este
-- repositorio.
--
-- CUAL ES EL SOFTWARE SALE DE LA BASE. Es un catalogo, no una lista escrita adentro de una
-- pantalla: agregar uno es una fila, no una version nueva del producto. Los cinco de facturacion
-- que se seleccionan de fabrica son los que estan investigados en
-- docs/FACTURADORES_Y_COMO_SE_CONECTAN.md. Para creditos y cobranzas no se siembra ninguno a
-- proposito: no hay ninguno investigado todavia, y poner nombres a ojo seria inventar.
--
-- CADA PRESTADORA CON LO SUYO. Una conexion es de una Prestadora y nunca alcanza los datos de
-- otra. Lo impone la base: RLS por `interno.current_tenant()`, y el permiso de lectura no incluye
-- la columna que apunta a la caja fuerte.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El catalogo: con que software se puede conectar
--
-- Molde de `catalogo_periodos_cobro` (20260911170000): lista global, igual para todas las
-- Prestadoras, sin un solo dato de ninguna. La diferencia es que el texto que se lee en pantalla
-- si vive aca, porque son nombres comerciales de productos de terceros: no se traducen
-- (`celtatech/CLAUDE.md` §4, excepcion de los nombres comerciales) y la lista crece sin publicar
-- una version nueva.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalogo_software_externo (
  -- Lo que queda guardado en la conexion. Se nombra por lo que es y no se renombra nunca.
  clave text PRIMARY KEY,
  -- Para que sirve ese software: facturar, o llevar los creditos y las cobranzas.
  clase text NOT NULL,
  -- Como se llama el producto de ese tercero, tal como lo escribe el tercero.
  nombre text NOT NULL,
  orden smallint NOT NULL DEFAULT 0,
  -- Apagado deja de ofrecerse sin romper las conexiones que ya lo eligieron.
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalogo_software_externo_clase_check
    CHECK (clase IN ('facturacion', 'creditos_y_cobranzas')),
  CONSTRAINT catalogo_software_externo_nombre_check
    CHECK (length(btrim(nombre)) > 0),
  -- Para que la conexion pueda exigir con la clave foranea que el software elegido sea de la
  -- clase que se esta configurando: un facturador no puede quedar anotado como el de cobranzas.
  CONSTRAINT catalogo_software_externo_clave_clase_unica UNIQUE (clave, clase)
);

COMMENT ON TABLE public.catalogo_software_externo IS
  'Con que software de afuera se puede conectar una Prestadora: los de facturacion y los de creditos y cobranzas. Ninguna de las dos tareas se hace aca; esto dice unicamente con quien se habla.';

COMMENT ON COLUMN public.catalogo_software_externo.clase IS
  'Para que sirve ese software: facturacion, o creditos_y_cobranzas.';

COMMENT ON COLUMN public.catalogo_software_externo.nombre IS
  'El nombre comercial del producto de ese tercero. No se traduce: es una marca.';

-- Los cinco de facturacion investigados en docs/FACTURADORES_Y_COMO_SE_CONECTAN.md §2.
-- De creditos y cobranzas no se siembra ninguno: no hay ninguno investigado, y la pantalla
-- muestra el estado vacio hasta que se cargue el primero. Agregarlo es una fila.
INSERT INTO public.catalogo_software_externo (clave, clase, nombre, orden) VALUES
  ('tusfacturasapp', 'facturacion', 'TusFacturasAPP', 1),
  ('xubio',          'facturacion', 'Xubio',          2),
  ('colppy',         'facturacion', 'Colppy',         3),
  ('contabilium',    'facturacion', 'Contabilium',    4),
  ('sistemas360',    'facturacion', 'Sistemas 360',   5)
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE public.catalogo_software_externo ENABLE ROW LEVEL SECURITY;

-- Lo lee cualquiera que haya iniciado sesion en el Panel: es una lista de nombres de productos de
-- terceros, sin un solo dato de ninguna Prestadora.
CREATE POLICY lectura_del_catalogo_de_software_externo ON public.catalogo_software_externo
  FOR SELECT TO authenticated USING (true);

-- Escribirlo es cambiar el producto, no la configuracion de una Prestadora.
CREATE POLICY superadmin_gestiona_catalogo_de_software_externo ON public.catalogo_software_externo
  FOR ALL USING (interno.es_superadmin()) WITH CHECK (interno.es_superadmin());

REVOKE ALL ON TABLE public.catalogo_software_externo FROM anon;
REVOKE ALL ON TABLE public.catalogo_software_externo FROM authenticated;
GRANT SELECT ON TABLE public.catalogo_software_externo TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.catalogo_software_externo TO service_role;

-- ---------------------------------------------------------------------------
-- 2. La conexion de cada Prestadora
--
-- Una por Prestadora y por clase: una Prestadora tiene un software de facturacion y uno de
-- creditos y cobranzas, y pueden ser de dos proveedores que no se conocen. Por eso tambien son
-- dos credenciales distintas y no una compartida: cambiar la de uno no le puede romper la
-- conexion al otro, que es el mismo motivo por el que los dos secretos de firma son dos.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conexiones_con_software_externo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  clase text NOT NULL,
  software text NOT NULL,
  -- El numero de referencia de la caja fuerte donde esta la credencial. El texto nunca se guarda
  -- aca. Vacio quiere decir que todavia no se cargo ninguna, y sin credencial no se entra a
  -- ningun lado.
  credencial_secret_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conexiones_con_software_externo_clase_check
    CHECK (clase IN ('facturacion', 'creditos_y_cobranzas')),
  CONSTRAINT conexiones_con_software_externo_una_por_clase
    UNIQUE (prestadora_id, clase),
  -- La clase viaja en la clave foranea a proposito: asi la base impide que el software de
  -- facturacion quede anotado como el de cobranzas.
  CONSTRAINT conexiones_con_software_externo_software_del_catalogo
    FOREIGN KEY (software, clase)
    REFERENCES public.catalogo_software_externo (clave, clase)
);

COMMENT ON TABLE public.conexiones_con_software_externo IS
  'Cual es el software de facturacion y cual el de creditos y cobranzas de cada Prestadora, y la referencia a la caja fuerte con la credencial con la que se entra. Aca no se factura ni se cobra: esto dice unicamente con quien habla.';

COMMENT ON COLUMN public.conexiones_con_software_externo.credencial_secret_id IS
  'Referencia a vault.secrets con la credencial con la que se entra a ese software. El texto nunca se guarda aca y nunca sale hacia el navegador.';

CREATE INDEX IF NOT EXISTS idx_conexiones_con_software_externo_prestadora
  ON public.conexiones_con_software_externo (prestadora_id);

ALTER TABLE public.conexiones_con_software_externo ENABLE ROW LEVEL SECURITY;

-- La Prestadora la resuelve la membresia verificada de quien inicio sesion, nunca un valor que
-- venga en el pedido. Escribe el motor con la llave de servicio; esta politica es la segunda red.
CREATE POLICY panel_lee_conexiones_con_software_externo ON public.conexiones_con_software_externo
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

REVOKE ALL ON TABLE public.conexiones_con_software_externo FROM anon;
REVOKE ALL ON TABLE public.conexiones_con_software_externo FROM authenticated;

-- Permiso columna por columna, y `credencial_secret_id` queda afuera. La politica de mas arriba
-- ya acota las filas a la Prestadora de la sesion; esto acota ademas las columnas, para que la
-- referencia a la caja fuerte no pueda salir hacia el navegador ni siquiera preguntando por la
-- direccion de la API. Que este cargada o no se contesta con un si o un no, del lado del motor.
GRANT SELECT (id, prestadora_id, clase, software, created_at, updated_at)
  ON TABLE public.conexiones_con_software_externo TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conexiones_con_software_externo TO service_role;

-- Toda mano que la toque durante una sesion de soporte queda registrada, igual que en las demas
-- tablas sensibles.
DROP TRIGGER IF EXISTS trg_auditoria_soporte ON public.conexiones_con_software_externo;
CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.conexiones_con_software_externo
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_soporte_mutacion();

-- Los tres datos con nombre que el registro de actividad va a necesitar para anotar un cambio de
-- conexion. La tabla `registro_actividad` solo admite adentro de `detalle` las claves de este
-- catalogo, y lo que no figura ahi hace fallar la escritura (20261001110000). Ninguno de los tres
-- es una credencial: son cual clase de software se toco y con cual quedo.
INSERT INTO public.catalogo_datos_del_registro (clave, orden) VALUES
  ('clase_de_software', 10),
  ('software_anterior', 11),
  ('software_nuevo',    12)
ON CONFLICT (clave) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Guardar la credencial, y leerla
--
-- Calcadas de `guardar_secreto_del_aviso_de_facturacion` y `leer_secreto_del_aviso_de_facturacion`
-- (20260919100000). Si ya hay caja fuerte se le cambia el contenido en vez de abrir otra, asi
-- reemplazar la credencial no va dejando cajas viejas sin dueno.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guardar_conexion_con_software_externo(
  p_prestadora_id uuid,
  p_clase text,
  p_software text,
  p_credencial text DEFAULT NULL
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_software_anterior TEXT;
  v_secret_id UUID;
BEGIN
  SELECT software, credencial_secret_id
    INTO v_software_anterior, v_secret_id
  FROM conexiones_con_software_externo
  WHERE prestadora_id = p_prestadora_id AND clase = p_clase;

  INSERT INTO conexiones_con_software_externo (prestadora_id, clase, software)
  VALUES (p_prestadora_id, p_clase, p_software)
  ON CONFLICT (prestadora_id, clase)
  DO UPDATE SET software = EXCLUDED.software, updated_at = NOW();

  -- Cambiar de software deja sin valor la credencial anterior: es la llave de otra puerta. Se
  -- borra la caja fuerte en vez de dejarla ahi, para que la pantalla no diga que hay una
  -- credencial cargada cuando la que hay no sirve.
  IF v_secret_id IS NOT NULL AND v_software_anterior IS DISTINCT FROM p_software THEN
    UPDATE conexiones_con_software_externo
       SET credencial_secret_id = NULL, updated_at = NOW()
     WHERE prestadora_id = p_prestadora_id AND clase = p_clase;
    DELETE FROM vault.secrets WHERE id = v_secret_id;
    v_secret_id := NULL;
  END IF;

  -- Vacio quiere decir «no se toca la que hay», no «borrala». Para sacarla se cambia de software.
  IF p_credencial IS NULL OR length(btrim(p_credencial)) = 0 THEN
    RETURN v_secret_id;
  END IF;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(
      p_credencial,
      'software_externo_' || p_clase || '_' || p_prestadora_id::text
    );
    UPDATE conexiones_con_software_externo
       SET credencial_secret_id = v_secret_id, updated_at = NOW()
     WHERE prestadora_id = p_prestadora_id AND clase = p_clase;
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_credencial);
    UPDATE conexiones_con_software_externo SET updated_at = NOW()
     WHERE prestadora_id = p_prestadora_id AND clase = p_clase;
  END IF;

  RETURN v_secret_id;
END;
$$;

ALTER FUNCTION public.guardar_conexion_con_software_externo(uuid, text, text, text) OWNER TO postgres;

COMMENT ON FUNCTION public.guardar_conexion_con_software_externo(uuid, text, text, text) IS
  'Anota cual es el software de esa clase para esa Prestadora y, si se le pasa una, guarda la credencial en la caja fuerte. Devuelve la referencia a la caja, nunca el texto.';

-- Devuelve la credencial en claro para que el motor pueda entrar a ese software. Nulo si esa
-- conexion no tiene ninguna cargada, y ese nulo es el que hace que no se llame a nadie.
CREATE OR REPLACE FUNCTION public.leer_credencial_de_software_externo(
  p_prestadora_id uuid,
  p_clase text
) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
  v_credencial TEXT;
BEGIN
  SELECT credencial_secret_id INTO v_secret_id
  FROM conexiones_con_software_externo
  WHERE prestadora_id = p_prestadora_id AND clase = p_clase;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_credencial FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_credencial;
END;
$$;

ALTER FUNCTION public.leer_credencial_de_software_externo(uuid, text) OWNER TO postgres;

-- Las dos se le sacan a todo el mundo y se le dan solamente al motor. Nadie con sesion en el
-- Panel llega al texto de una credencial, ni siquiera quien la cargo.
REVOKE ALL ON FUNCTION public.guardar_conexion_con_software_externo(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_conexion_con_software_externo(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.guardar_conexion_con_software_externo(uuid, text, text, text) FROM authenticated;
GRANT ALL ON FUNCTION public.guardar_conexion_con_software_externo(uuid, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.leer_credencial_de_software_externo(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leer_credencial_de_software_externo(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.leer_credencial_de_software_externo(uuid, text) FROM authenticated;
GRANT ALL ON FUNCTION public.leer_credencial_de_software_externo(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname = 'public' AND tablename = 'conexiones_con_software_externo'
  ) THEN
    faltan := faltan || 'conexiones_con_software_externo; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'conexiones_con_software_externo'
       AND c.relrowsecurity
  ) THEN
    faltan := faltan || 'la conexion quedo sin proteccion por fila; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'conexiones_con_software_externo'
  ) THEN
    faltan := faltan || 'la conexion quedo sin ninguna politica; ';
  END IF;

  -- Lo que esta prueba mira de verdad: que la columna que apunta a la caja fuerte no haya
  -- quedado al alcance de una sesion del Panel. Con el sistema roto -un GRANT SELECT a secas
  -- sobre la tabla entera- esta comprobacion falla, que es la unica forma de que sirva.
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
     WHERE table_schema = 'public'
       AND table_name = 'conexiones_con_software_externo'
       AND column_name = 'credencial_secret_id'
       AND grantee IN ('anon', 'authenticated')
  ) THEN
    faltan := faltan || 'la referencia a la caja fuerte quedo al alcance del navegador; ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
     WHERE routine_schema = 'public'
       AND routine_name IN (
         'guardar_conexion_con_software_externo',
         'leer_credencial_de_software_externo'
       )
       AND grantee IN ('anon', 'authenticated')
  ) THEN
    faltan := faltan || 'la credencial quedo al alcance de una sesion del Panel; ';
  END IF;

  IF (SELECT count(*) FROM public.catalogo_software_externo WHERE clase = 'facturacion') = 0 THEN
    faltan := faltan || 'el catalogo de software de facturacion quedo vacio; ';
  END IF;

  IF faltan <> '' THEN
    RAISE EXCEPTION 'La migracion no dejo lo que dice: %', faltan;
  END IF;

  RAISE NOTICE 'La Prestadora ya puede anotar con que software de afuera se conecta.';
END
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

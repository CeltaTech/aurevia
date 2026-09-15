-- ENTRAR CON HUELLA O CON CARA, EN LAS DOS APLICACIONES
-- =====================================================
--
-- QUE RESUELVE. Para entrar a la aplicacion del Asistente o a la de la Familia hoy hay que
-- escribir el correo y la contrasena en el teclado de un telefono, muchas veces parado en la
-- puerta de una casa. Lo que eso produce es conocido: contrasenas cortas, contrasenas repetidas
-- y sesiones que nunca se cierran para no tener que volver a escribirlas. La llave que guarda el
-- propio telefono saca el teclado del medio sin bajar la seguridad: la sube.
--
-- NINGUNA HUELLA NI NINGUNA CARA SE GUARDA ACA, Y ESO NO ES UN DETALLE. El telefono genera una
-- llave privada adentro de su propio hardware y la destraba mirando o tocando a quien la usa. Lo
-- unico que llega al producto es la mitad publica de esa llave y las firmas hechas con la otra
-- mitad. Por eso las tablas se llaman por lo que guardan -llaves de un dispositivo- y no por como
-- el dueno las abre: no hay dato biometrico adentro, y el nombre no debe sugerir que lo hay.
--
-- SIN POLITICAS, A PROPOSITO. Las dos tablas habilitan RLS y no declaran ninguna politica: nadie
-- las lee ni las escribe salvo el motor, que entra con la llave de servicio. Es el mismo trato
-- que tiene tokens_activacion_cuenta, y por el mismo motivo: son credenciales, y una credencial
-- no se consulta desde el navegador ni siquiera para verla propia. Lo que la pantalla muestra lo
-- arma el motor y deja afuera la mitad publica y el identificador de la credencial.
--
-- LA BAJA DEJA CONSTANCIA EN VEZ DE BORRAR. revocada_en marca la llave que alguien saco y la fila
-- se queda: si manana aparece una firma hecha con esa llave, hay con que saber que era una que se
-- dio de baja, y cuando. Una fila borrada no cuenta nada.

CREATE TABLE IF NOT EXISTS public.llaves_de_dispositivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  rol text NOT NULL CHECK (rol IN ('asistente', 'familia')),
  credencial_id text NOT NULL UNIQUE,
  clave_publica text NOT NULL,
  contador bigint NOT NULL DEFAULT 0,
  transportes text[],
  creada_en timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_en timestamptz,
  revocada_en timestamptz
);

COMMENT ON TABLE public.llaves_de_dispositivo IS
  'Llaves que cada persona guarda en su propio telefono para entrar sin escribir la contrasena. '
  'Se guarda la mitad publica de la llave; la privada nunca sale del aparato y ningun dato '
  'biometrico entra aca.';
COMMENT ON COLUMN public.llaves_de_dispositivo.rol IS
  'En cual de las dos aplicaciones nacio la llave. Una llave del Asistente no sirve para entrar a '
  'la de la Familia: son dos aplicaciones con permisos distintos.';
COMMENT ON COLUMN public.llaves_de_dispositivo.credencial_id IS
  'Como el telefono nombra a esta llave. Unico en todo el producto, porque asi llega la firma '
  'cuando la pantalla de ingreso todavia no sabe quien esta entrando.';
COMMENT ON COLUMN public.llaves_de_dispositivo.contador IS
  'Cuantas veces el aparato dice haber usado esta llave. Si baja, hay dos copias de la misma '
  'llave dando vueltas. Muchos telefonos no llevan cuenta y lo dejan siempre en cero.';
COMMENT ON COLUMN public.llaves_de_dispositivo.revocada_en IS
  'Cuando se dio de baja. La fila no se borra: deja constancia de que esa llave existio.';

-- Buscar por credencial_id es lo primero que pasa en cada entrada, y lo unico que hay para buscar
-- cuando todavia no se sabe de quien es la llave. El indice sale solo del UNIQUE.
-- Este otro es para la pantalla que lista las llaves propias: solo las que siguen vivas.
CREATE INDEX IF NOT EXISTS llaves_de_dispositivo_por_persona
  ON public.llaves_de_dispositivo (usuario_id, creada_en DESC)
  WHERE revocada_en IS NULL;

ALTER TABLE public.llaves_de_dispositivo ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.llaves_de_dispositivo FROM anon;
REVOKE ALL ON TABLE public.llaves_de_dispositivo FROM authenticated;


-- EL DESAFIO: UN NUMERO AL AZAR QUE VALE UNA SOLA VEZ Y POR DOS MINUTOS
--
-- Sin esto, quien grabara una firma podria volver a presentarla mas tarde y entrar. El motor
-- inventa un numero, lo guarda, el telefono lo firma, y al verificarlo el numero queda marcado
-- como usado. Vencido o usado, no sirve mas.
--
-- prestadora_id acepta nulo por una razon precisa: en la entrada todavia no se sabe quien esta
-- entrando, asi que tampoco se sabe de que Prestadora es. Recien la firma lo dice. El CHECK exige
-- la Prestadora en el unico caso donde si se conoce -el alta, que se hace con la sesion abierta-,
-- y asi la columna de la Organizacion falta solamente donde es imposible tenerla.

CREATE TABLE IF NOT EXISTS public.desafios_de_llave (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  desafio text NOT NULL UNIQUE,
  para text NOT NULL CHECK (para IN ('alta', 'entrada')),
  rol text NOT NULL CHECK (rol IN ('asistente', 'familia')),
  prestadora_id uuid REFERENCES public.prestadoras(id),
  usuario_id uuid REFERENCES public.usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  vence_en timestamptz NOT NULL,
  usado_en timestamptz,
  CONSTRAINT desafios_de_llave_el_alta_sabe_de_quien_es
    CHECK (para <> 'alta' OR (prestadora_id IS NOT NULL AND usuario_id IS NOT NULL))
);

COMMENT ON TABLE public.desafios_de_llave IS
  'Numeros al azar de un solo uso que el telefono firma para probar que tiene la llave. Vencen a '
  'los pocos minutos y quedan marcados al usarse, para que una firma grabada no sirva dos veces.';
COMMENT ON COLUMN public.desafios_de_llave.para IS
  'Si es para agregar una llave nueva -con la sesion ya abierta- o para entrar.';
COMMENT ON COLUMN public.desafios_de_llave.prestadora_id IS
  'Queda nulo en los desafios de entrada: ahi todavia no se sabe quien esta entrando. En los de '
  'alta es obligatorio, porque la sesion ya lo dice.';
COMMENT ON COLUMN public.desafios_de_llave.usado_en IS
  'Cuando se gasto. Un desafio usado no vuelve a servir, aunque no haya vencido.';

-- Los desafios se buscan por su valor -el UNIQUE ya da ese indice- y se limpian por vencimiento.
CREATE INDEX IF NOT EXISTS desafios_de_llave_vencidos
  ON public.desafios_de_llave (vence_en)
  WHERE usado_en IS NULL;

ALTER TABLE public.desafios_de_llave ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.desafios_de_llave FROM anon;
REVOKE ALL ON TABLE public.desafios_de_llave FROM authenticated;

NOTIFY pgrst, 'reload schema';

-- La Familia y el Asistente se hablan por adentro, y el dato de contacto queda tapado.
-- ==========================================================================================
--
-- QUÉ FALTABA. En la modalidad marketplace la Familia ya puede buscar un Asistente y mirar su
-- perfil público, y no tiene ninguna forma de hablarle. La única tabla de mensajes que existía
-- era `mensajes_asistente`, que va del Panel hacia el Asistente y no tiene dos puntas: no hay
-- dónde guardar lo que contesta, ni de qué Familia es la conversación.
--
-- POR QUÉ EL CHAT NO SE COBRA. Lo dice el documento del producto
-- (`docs/PRD_07_Modalidad_Marketplace.md:69`): la búsqueda, los perfiles, el chat interno y la
-- videollamada son libres. Lo que se vende es llegar a la persona por afuera —el teléfono, el
-- correo, la dirección—, y eso tiene su propio circuito, que ya existe
-- (`contactos_vistos_marketplace`).
--
-- Y POR ESO EL DATO DE CONTACTO VA TAPADO ADENTRO DEL CHAT. Un chat libre donde se puede
-- escribir un teléfono es la misma venta regalada por otra puerta. Mientras el contacto de esa
-- pareja no esté abierto, lo que el motor manda a las dos pantallas sale tapado. El texto se
-- guarda entero: el día que ese contacto se abre, se abre lo que ya se dijo, porque es
-- exactamente el dato que se pagó. Quién tapa es una sola función del motor
-- (`backend/src/utils/contactoTapado.js`), y no una decisión repetida ruta por ruta.
--
-- SE TAPA PARA LOS DOS LADOS. La pareja es la unidad: si se tapara nada más lo que escribe el
-- Asistente, la Familia pondría su propio número y la llamada saldría igual. Abierto el
-- contacto, se abre para los dos, porque una conversación tiene dos puntas.
--
-- LO QUE ESTO NO HACE, Y SE DICE EN LA PANTALLA. Tapa lo que se puede reconocer —números de
-- teléfono, correos, direcciones web, nombres de usuario—. Una dirección de una casa escrita en
-- palabras no se reconoce, y el producto no va a fingir que sí. Avisa, que es lo que corresponde
-- (`celtatech/CLAUDE.md` §7): la pantalla dice que el chat tapa los datos de contacto y que lo
-- que se escriba de más queda a la vista de la otra persona.
--
-- LA VIDEOLLAMADA NO TRAE PROVEEDOR ESCRITO EN EL CÓDIGO. `prestadoras.videollamada_base_url`
-- guarda la dirección de la sala que use esa Prestadora —la suya, la de quien contrate—, y el
-- producto le agrega una sala nueva de nombre imposible de adivinar cada vez que alguien llama.
-- Donde esa dirección está vacía, el botón no se ofrece: no hay proveedor, no hay videollamada,
-- y nadie ve un botón que lleva a ningún lado. No hace falta ninguna credencial, así que no hay
-- ninguna guardada.
--
-- LA SALA NO ES PERMANENTE. Cada llamada estrena una, y la anterior deja de valer en el momento.
-- Una sala fija sería una dirección que, una vez vista, entra para siempre.

-- ---------------------------------------------------------------------------
-- 1. Dónde se hace la videollamada
-- ---------------------------------------------------------------------------

ALTER TABLE public.prestadoras
  ADD COLUMN IF NOT EXISTS videollamada_base_url text;

COMMENT ON COLUMN public.prestadoras.videollamada_base_url IS
  'Direccion base de las salas de videollamada de esta Prestadora, sin barra final. El producto le agrega el nombre de sala. Vacia: esta Prestadora no ofrece videollamada y el boton no aparece. No lleva ninguna credencial.';

-- ---------------------------------------------------------------------------
-- 2. La conversación: una por pareja
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conversaciones_marketplace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  familia_id uuid NOT NULL REFERENCES public.familias(id),
  asistente_id uuid NOT NULL REFERENCES public.asistentes(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Para ordenar la lista sin contar los mensajes de cada hilo en cada pantalla.
  ultimo_mensaje_at timestamptz,
  -- La sala que vale hoy. Se reemplaza en cada llamada; la anterior deja de valer ahí mismo.
  sala_videollamada text,
  sala_abierta_at timestamptz,

  -- Una sola conversación por pareja. Dos hilos con la misma persona serían dos historias de lo
  -- mismo, y el tapado tendría que decidir contra cuál de las dos.
  CONSTRAINT conversaciones_mkt_una_por_pareja UNIQUE (familia_id, asistente_id)
);

CREATE INDEX IF NOT EXISTS idx_conversaciones_mkt_familia
  ON public.conversaciones_marketplace (familia_id, ultimo_mensaje_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversaciones_mkt_asistente
  ON public.conversaciones_marketplace (asistente_id, ultimo_mensaje_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversaciones_mkt_prestadora
  ON public.conversaciones_marketplace (prestadora_id);

COMMENT ON TABLE public.conversaciones_marketplace IS
  'El hilo entre una Familia y un Asistente del Marketplace, antes de contratarlo. Una por pareja. El chat es libre; lo que se cobra es el dato de contacto, que viaja tapado hasta que ese contacto se abre.';

-- ---------------------------------------------------------------------------
-- 3. Los mensajes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mensajes_marketplace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  conversacion_id uuid NOT NULL REFERENCES public.conversaciones_marketplace(id) ON DELETE CASCADE,
  -- De qué lado salió. No se deduce del autor: el círculo familiar tiene varias personas y
  -- cualquiera de ellas puede escribir, así que el lado es un dato y no una cuenta.
  lado text NOT NULL CHECK (lado IN ('familia', 'asistente')),
  -- Quién lo escribió, para la constancia. No sale hacia la otra punta: del lado del Asistente
  -- se ve «la Familia», no cuál de sus integrantes.
  autor_usuario_id uuid NOT NULL,
  -- El texto tal como se escribió. Tapar al guardar dejaría tapado para siempre lo que después
  -- se paga, y el dato que se pagó es justamente ése.
  cuerpo text NOT NULL CHECK (btrim(cuerpo) <> ''),
  -- Un mensaje que el producto escribió solo: hoy, el aviso de que empezó una videollamada.
  -- Su texto no es texto visible sino una clave, porque se muestra traducido.
  automatico boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  leido_at timestamptz,
  push_enviado_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mensajes_mkt_conversacion
  ON public.mensajes_marketplace (conversacion_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mensajes_mkt_prestadora
  ON public.mensajes_marketplace (prestadora_id);

COMMENT ON TABLE public.mensajes_marketplace IS
  'Los mensajes de un hilo del Marketplace. Se guardan enteros y salen tapados mientras el contacto de esa pareja no este abierto: el tapado lo hace el motor en una sola funcion, no la base.';

COMMENT ON COLUMN public.mensajes_marketplace.automatico IS
  'Lo escribio el producto, no una persona. El cuerpo es una clave de traduccion, no texto visible.';

-- ---------------------------------------------------------------------------
-- 4. Quién ve qué
-- ---------------------------------------------------------------------------
--
-- Las cuatro políticas son de lectura. Escribe el motor, con la llave de servicio, que es el
-- único que sabe de qué lado salió cada mensaje y el único que tapa lo que corresponde
-- (`productos/careonys/CLAUDE.md` §6). Una fila puesta desde una pantalla sería un mensaje sin
-- lado y sin tapar.
--
-- La Prestadora no aparece acá, y es a propósito: recluta, admite y configura, y no ve lo que se
-- hablan la Familia y el Asistente. Es la misma línea que ya vale en todo el producto.

ALTER TABLE public.conversaciones_marketplace ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensajes_marketplace ENABLE ROW LEVEL SECURITY;

CREATE POLICY familia_ve_sus_conversaciones
  ON public.conversaciones_marketplace
  FOR SELECT
  USING (familia_id = interno.familia_id_de_usuario(auth.uid()));

CREATE POLICY asistente_ve_sus_conversaciones
  ON public.conversaciones_marketplace
  FOR SELECT
  USING (asistente_id = auth.uid());

CREATE POLICY familia_ve_los_mensajes_de_sus_conversaciones
  ON public.mensajes_marketplace
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversaciones_marketplace c
      WHERE c.id = mensajes_marketplace.conversacion_id
        AND c.familia_id = interno.familia_id_de_usuario(auth.uid())
    )
  );

CREATE POLICY asistente_ve_los_mensajes_de_sus_conversaciones
  ON public.mensajes_marketplace
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversaciones_marketplace c
      WHERE c.id = mensajes_marketplace.conversacion_id
        AND c.asistente_id = auth.uid()
    )
  );

-- El permiso de tabla no es la RLS, y en este esquema una tabla nueva nace con todo dado a
-- `anon` y a `authenticated` (`ALTER DEFAULT PRIVILEGES`, en la foto de la base). Las políticas
-- de arriba ya niegan toda escritura porque no existe ninguna de escribir, pero un permiso que
-- sobra no se deja puesto esperando que otra cosa lo tape.
REVOKE ALL ON TABLE public.conversaciones_marketplace FROM anon;
REVOKE ALL ON TABLE public.mensajes_marketplace FROM anon;
REVOKE ALL ON TABLE public.conversaciones_marketplace FROM authenticated;
REVOKE ALL ON TABLE public.mensajes_marketplace FROM authenticated;
GRANT SELECT ON TABLE public.conversaciones_marketplace TO authenticated;
GRANT SELECT ON TABLE public.mensajes_marketplace TO authenticated;

NOTIFY pgrst, 'reload schema';

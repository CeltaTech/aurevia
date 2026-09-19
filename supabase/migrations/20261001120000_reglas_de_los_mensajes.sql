-- Las reglas de qué no se puede mandar en un mensaje
-- ==========================================================================================
--
-- QUÉ ESTABA MAL. La regla ya estaba escrita y vale para todo el desarrollo
-- (`celtatech/docs/REGLAS_PRODUCTOS_CAREONYS.md` §4): lo que no puede viajar en un mensaje se
-- tapa, qué se tapa es dato y no código, y se tapa **antes de guardar, del lado de la base**.
-- Lo construido hacía las tres cosas al revés: cuatro expresiones escritas adentro de
-- `backend/src/utils/contactoTapado.js`, el texto guardado entero y tapado recién al salir hacia
-- la pantalla. Quien llegara al dato por cualquier otra vía —otra ruta del motor, una consulta
-- directa, un respaldo— lo veía completo.
--
-- QUÉ QUEDA. Un cuerpo de reglas guardado como dato, con su motivo en los tres idiomas, y un
-- disparador que tapa el texto antes de escribirlo. Lo que se guarda ya viene tapado, así que
-- no hay ninguna otra vía por la que salir entero: no existe en ningún lado.
--
-- DE DÓNDE SALE EL CUERPO DE REGLAS. De Careonys Match, que ya lo tenía resuelto como tabla y
-- con nueve reglas afinadas contra dos listas de mensajes de prueba —los que tienen que pasar y
-- los que no—, en castellano, inglés y portugués. Allá el único lugar vivo que las llama es una
-- pantalla de maqueta, y por eso la pieza parece muerta y no lo está: el control de verdad corre
-- en la base, antes de guardar. Es lo que se trae.
--
-- Y ACÁ NO SE BLOQUEA: SE TAPA. Es la única diferencia con Match, y la manda la regla de los dos
-- productos: el mensaje sale y llega, con lo demás entero, y lo que la regla alcanza va tapado.
-- Rechazarlo deja a dos personas sin poder hablarse por una coincidencia, y le enseña a quien
-- quiso esquivarlo qué forma probar la próxima vez.
--
-- LO QUE ESTO CAMBIA, Y SE DICE. Hasta hoy el texto se guardaba entero para poder destaparlo el
-- día que esa Familia abría el contacto de ese Asistente. Eso se termina: lo tapado no se guarda,
-- así que no hay nada que destapar después. El dato de contacto que esa Familia paga sale por su
-- propio circuito —`contactos_vistos_marketplace`—, que es donde siempre estuvo; el chat deja de
-- ser una segunda puerta hacia lo mismo.
--
-- QUÉ NO ALCANZA, Y TAMPOCO SE FINGE. Se tapa lo que se puede reconocer. Ninguna regla se apoya
-- en una palabra suelta, a propósito: el daño de este control no es dejar pasar un teléfono
-- —eso se arregla agregando una regla, sin publicar ninguna versión— sino taparle media frase a
-- un Asistente que está diciendo lo que cobra y cuándo puede.
--
-- EL TEXTO TAPADO NO SE ESCRIBE EN NINGÚN LADO. Ni en un registro, ni en un mensaje de error, ni
-- en la fila. Lo único que queda anotado es la clave de la primera regla que tapó algo, que es lo
-- que le permite a la pantalla decirle a quien escribió por qué hay marcas en su mensaje.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Lo que la base necesita para leer una expresión escrita para el navegador
-- ---------------------------------------------------------------------------
--
-- Las reglas se guardan tal como las escribe quien las ajusta, con la sintaxis corriente. La
-- única diferencia con la de Postgres, para lo que estas reglas usan, es el borde de palabra:
-- `\b` afuera, `\y` acá, donde `\b` significa retroceso. Lo que la traducción NO sabe hacer
-- —`\B`, las miradas hacia adelante y hacia atrás, las referencias hacia atrás— la tabla no lo
-- deja guardar, que es mejor que traducirlo mal.
--
-- Vive en `interno` porque no la llama ningún navegador: la llaman la tabla y el disparador.

CREATE OR REPLACE FUNCTION interno.patron_de_mensaje_en_postgres(p_patron text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'interno', 'public'
AS $$
  SELECT replace(p_patron, '\b', '\y');
$$;

COMMENT ON FUNCTION interno.patron_de_mensaje_en_postgres(text) IS
  'Traduce una expresion escrita con la sintaxis corriente a la de Postgres. Hoy la unica diferencia que importa es el borde de palabra.';

-- La marca que queda en el lugar de lo tapado. Es un signo y no una frase, a propósito: una
-- frase adentro del texto de otra persona se lee como si la hubiera escrito ella. La explicación
-- va una sola vez en la pantalla, traducida.
CREATE OR REPLACE FUNCTION interno.marca_de_lo_tapado()
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'interno', 'public'
AS $$
  SELECT '•••'::text;
$$;

COMMENT ON FUNCTION interno.marca_de_lo_tapado() IS
  'Lo que queda escrito en el lugar de lo que se tapo. Punto unico de verdad: no se escribe en ninguna otra parte.';

-- ---------------------------------------------------------------------------
-- 2. El cuerpo de reglas, que es dato y no código
-- ---------------------------------------------------------------------------
--
-- `prestadora_id` nula es la regla general, la que vale para todas —misma forma que el catálogo
-- de tipos de Asistente—. Ninguna Prestadora escribe acá: qué no puede viajar en un mensaje no
-- es una decisión de cada una, y cómo se cuida el producto tampoco entra en su configuración.
-- La columna existe porque toda tabla nace con ella y porque el día que una regla tenga que
-- valer para una sola Prestadora, ya hay dónde escribirla.

CREATE TABLE IF NOT EXISTS public.reglas_de_los_mensajes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid REFERENCES public.prestadoras(id),
  -- Nombre guardado: se nombra por lo que reconoce y no se renombra. Es lo que queda anotado en
  -- cada mensaje tapado.
  clave text NOT NULL,
  patron text NOT NULL,
  banderas text NOT NULL DEFAULT 'g',
  -- Por qué se tapó, en los tres idiomas. Es lo que ve quien escribió.
  motivo jsonb NOT NULL,
  orden smallint NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT el_motivo_esta_en_los_tres_idiomas CHECK (
    btrim(coalesce(motivo ->> 'es-AR', '')) <> ''
    AND btrim(coalesce(motivo ->> 'en', '')) <> ''
    AND btrim(coalesce(motivo ->> 'pt-BR', '')) <> ''
  ),

  -- Una expresión que no compila dejaría el tapado caído para todos los mensajes. Se comprueba
  -- al guardarla, que es cuando hay alguien mirando.
  CONSTRAINT el_patron_compila_en_postgres CHECK (
    length(regexp_replace('', interno.patron_de_mensaje_en_postgres(patron), '')) = 0
  ),

  -- Lo que la traducción no sabe llevar de un lado al otro no entra.
  CONSTRAINT el_patron_no_usa_lo_que_no_se_traduce CHECK (
    patron !~ '\\[B1-9]' AND patron !~ '\(\?[=!<]'
  ),

  -- Sin `g` se taparía la primera aparición y no las demás, que es no tapar.
  CONSTRAINT las_banderas_son_conocidas CHECK (
    banderas ~ '^[gi]*$' AND position('g' in banderas) > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS reglas_de_los_mensajes_una_clave_por_prestadora
  ON public.reglas_de_los_mensajes
  (clave, COALESCE(prestadora_id, '00000000-0000-0000-0000-000000000000'::uuid));

COMMENT ON TABLE public.reglas_de_los_mensajes IS
  'Que no puede viajar adentro de un mensaje: el telefono, el correo, el domicilio, el nombre de usuario de otra aplicacion y la invitacion a seguir la charla en otro lado. Es dato y no codigo: se agrega una regla sin publicar ninguna version. La aplica el disparador que tapa el texto antes de guardarlo.';
COMMENT ON COLUMN public.reglas_de_los_mensajes.prestadora_id IS
  'Nula: regla general, vale para todas las Prestadoras. Ninguna Prestadora escribe acá; que se tapa no es configuracion de ella.';
COMMENT ON COLUMN public.reglas_de_los_mensajes.clave IS
  'Nombre guardado de la regla. Queda anotado en el mensaje que tapo, y es lo unico que sale hacia afuera. No se renombra.';
COMMENT ON COLUMN public.reglas_de_los_mensajes.patron IS
  'La expresion escrita con la sintaxis corriente. La base la traduce al leerla con interno.patron_de_mensaje_en_postgres.';
COMMENT ON COLUMN public.reglas_de_los_mensajes.motivo IS
  'Por que se tapo, en los tres idiomas. Lo muestra la pantalla a quien escribio.';
COMMENT ON COLUMN public.reglas_de_los_mensajes.orden IS
  'En que orden corren. Importa: el correo se tapa antes que el nombre de usuario, o se taparia primero la cola del correo.';

ALTER TABLE public.reglas_de_los_mensajes ENABLE ROW LEVEL SECURITY;

-- Se lee desde una sesión de persona y nada más: el motor entra con la llave de servicio. No hay
-- ninguna política de escritura, así que desde una sesión no se escribe, y por eso no hace falta
-- ninguna que lo niegue.
DROP POLICY IF EXISTS las_reglas_de_los_mensajes_se_leen ON public.reglas_de_los_mensajes;
CREATE POLICY las_reglas_de_los_mensajes_se_leen
  ON public.reglas_de_los_mensajes
  FOR SELECT
  TO authenticated
  USING (
    activo
    AND (prestadora_id IS NULL OR prestadora_id = interno.current_tenant())
  );

REVOKE ALL ON TABLE public.reglas_de_los_mensajes FROM anon;
REVOKE ALL ON TABLE public.reglas_de_los_mensajes FROM authenticated;
GRANT SELECT ON TABLE public.reglas_de_los_mensajes TO authenticated;
GRANT ALL ON TABLE public.reglas_de_los_mensajes TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Las nueve reglas
-- ---------------------------------------------------------------------------
--
-- Vienen de Match, donde se afinaron contra dos listas de mensajes: los que tienen que quedar
-- alcanzados y los que tienen que pasar enteros. Quedaron afuera a propósito palabras que serían
-- un domicilio y rompen conversaciones normales —«floor», «andar», «drive», «st», «dr»—, y
-- ninguna se dispara con el nombre de una aplicación a secas: «no tengo WhatsApp, prefiero
-- hablar por acá» pasa entero, y tiene que pasar.

INSERT INTO public.reglas_de_los_mensajes (clave, patron, banderas, motivo, orden) VALUES
  -- Termina en dígito a propósito. En Match, que bloquea, daba igual que la expresión se llevara
  -- el espacio de atrás; acá el texto tapado es el que se lee, y sin eso «al 11 5555 4444 o» sale
  -- «al •••o», con dos palabras pegadas.
  ('telefono',
   '(?:\d[ .()\-]{0,2}){6,}\d',
   'g',
   '{"es-AR": "Parece un número de teléfono.", "en": "This looks like a phone number.", "pt-BR": "Parece um número de telefone."}',
   1),

  ('telefono_en_letras',
   '(?:\b(?:cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|zero|one|two|three|four|five|six|seven|eight|nine|oh|um|uma|dois|duas|três|sete|oito|nove)\b[ ,.\-]*){7,}',
   'gi',
   '{"es-AR": "Parece un número de teléfono escrito con palabras.", "en": "This looks like a phone number spelled out in words.", "pt-BR": "Parece um número de telefone escrito por extenso."}',
   2),

  ('correo',
   '[A-Za-z0-9._%+-]+ ?(?:@|\( ?at ?\)|\[ ?at ?\]|\barroba\b) ?[A-Za-z0-9-]+ ?(?:\.|\bpunto\b|\bponto\b) ?[A-Za-z]{2,}',
   'gi',
   '{"es-AR": "Parece una dirección de correo.", "en": "This looks like an email address.", "pt-BR": "Parece um endereço de e-mail."}',
   3),

  ('domicilio',
   '\b(?:calle|avenida|av|avda|pasaje|psje|diagonal|rua|travessa|alameda|estrada|rodovia|street|avenue|road|boulevard)\b\.? ?[A-Za-zÀ-ÿ'' ]{0,24}?\d{1,5}\b|\b\d{1,5} ?[A-Za-zÀ-ÿ'' ]{0,24}?\b(?:street|avenue|road|boulevard)\b',
   'gi',
   '{"es-AR": "Parece un domicilio.", "en": "This looks like a street address.", "pt-BR": "Parece um endereço residencial."}',
   4),

  ('domicilio_por_partes',
   '\b(?:piso|depto|dpto|departamento|timbre|altura|apartamento|apto|bloco|campainha|apartment|apt|flat|unit|suite|doorbell|buzzer)\b\.? ?\d{1,5}\b',
   'gi',
   '{"es-AR": "Parece parte de un domicilio.", "en": "This looks like part of a street address.", "pt-BR": "Parece parte de um endereço residencial."}',
   5),

  ('usuario_de_otra_aplicacion',
   '@[A-Za-z0-9._]{3,30}',
   'gi',
   '{"es-AR": "Parece un nombre de usuario de otra aplicación.", "en": "This looks like a username on another application.", "pt-BR": "Parece um nome de usuário de outro aplicativo."}',
   6),

  ('enlace',
   '(?:https?://|www\.)[^\s]{2,}|\b[A-Za-z0-9-]{2,}\.(?:com|net|org|ar|br|me|io|app|link|ly|gl)\b',
   'gi',
   '{"es-AR": "Parece un enlace a otro sitio.", "en": "This looks like a link to another site.", "pt-BR": "Parece um link para outro site."}',
   7),

  ('usuario_en_otra_aplicacion',
   '\b(?:mi|el|su|tu|my|your|his|her|meu|minha|seu|sua)\s+(?:instagram|insta|ig|telegram|telegran|whatsapp|whatsap|wasap|wsp|wpp|messenger|facebook|face|tiktok|snapchat|skype|signal|discord|linkedin|zoom|meet)\b\s*(?:es|is|é|e|:)?\s*[A-Za-z0-9._@-]{3,}',
   'gi',
   '{"es-AR": "Parece un nombre de usuario de otra aplicación.", "en": "This looks like a username on another application.", "pt-BR": "Parece um nome de usuário de outro aplicativo."}',
   8),

  ('invitacion_a_otra_aplicacion',
   '\b(?:busc.me|agreg.me|escrib.me|contact.me|habl.me|mand.me|llam.me|segu.me|pas.me|write|text|message|find|add|follow|contact|reach|dm|ping|escreva|escreve|procure|procura|adicione|adiciona|siga|segue|chame|chama|fale|fala|mande|manda|ligue|liga)\b[^\n]{0,40}\b(?:instagram|insta|ig|telegram|telegran|whatsapp|whatsap|wasap|wsp|wpp|messenger|facebook|face|tiktok|snapchat|skype|signal|discord|linkedin|zoom|meet)\b|\b(?:instagram|insta|ig|telegram|telegran|whatsapp|whatsap|wasap|wsp|wpp|messenger|facebook|face|tiktok|snapchat|skype|signal|discord|linkedin|zoom|meet)\b[^\n]{0,40}\b(?:busc.me|agreg.me|escrib.me|contact.me|habl.me|mand.me|llam.me|segu.me|pas.me|write|text|message|find|add|follow|contact|reach|dm|ping|escreva|escreve|procure|procura|adicione|adiciona|siga|segue|chame|chama|fale|fala|mande|manda|ligue|liga)\b',
   'gi',
   '{"es-AR": "Parece una invitación a seguir la conversación en otra aplicación.", "en": "This looks like an invitation to continue the conversation on another application.", "pt-BR": "Parece um convite para continuar a conversa em outro aplicativo."}',
   9)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Quién tapa
-- ---------------------------------------------------------------------------
--
-- Una sola función, y por eso acá: la decisión de qué se tapa aparecería en cada tabla con texto
-- libre que se agregue, y ahí ya serían copias que se separan.
--
-- FALLA CERRADO. Con el cuerpo de reglas vacío no deja pasar el texto «por las dudas»: se corta
-- con una clave estable y sin una letra del mensaje. Un cuerpo de reglas vacío es el sistema
-- roto, no alguien escribiendo mal, y taparle todo a todos es preferible a no taparle nada a
-- nadie.
--
-- Es `SECURITY DEFINER` a propósito, y no es un disparador. Leer las reglas con los permisos de
-- quien escribe haría que una sesión que no las ve tape menos, que es justo lo contrario de
-- fallar cerrado. Vive en `interno`, que queda afuera de los esquemas publicados, así que no es
-- ninguna dirección web; igual se le revoca lo que no necesita.

CREATE OR REPLACE FUNCTION interno.tapar_lo_que_no_viaja_en_un_mensaje(
  p_texto text,
  p_prestadora uuid DEFAULT NULL
)
  RETURNS TABLE (texto text, regla text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'interno', 'public'
AS $$
DECLARE
  v_texto  text := coalesce(p_texto, '');
  v_antes  text;
  v_regla  text;
  la_regla record;
  v_hay    boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.reglas_de_los_mensajes WHERE activo) INTO v_hay;
  IF NOT v_hay THEN
    RAISE EXCEPTION 'reglas_de_los_mensajes_sin_cargar' USING ERRCODE = 'P0001';
  END IF;

  FOR la_regla IN
    SELECT r.clave, r.patron, r.banderas
      FROM public.reglas_de_los_mensajes r
     WHERE r.activo
       AND (r.prestadora_id IS NULL OR r.prestadora_id = p_prestadora)
     ORDER BY r.orden, r.clave
  LOOP
    v_antes := v_texto;
    v_texto := regexp_replace(
      v_texto,
      interno.patron_de_mensaje_en_postgres(la_regla.patron),
      interno.marca_de_lo_tapado(),
      la_regla.banderas
    );
    -- Queda anotada la primera que tapó algo. Alcanza para decirle a quien escribió por qué hay
    -- marcas; la lista entera de las que tocaron el texto no le agrega nada y le cuenta al que
    -- quiere esquivarlo cuántas puertas encontró.
    IF v_regla IS NULL AND v_texto IS DISTINCT FROM v_antes THEN
      v_regla := la_regla.clave;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_texto, v_regla;
END;
$$;

COMMENT ON FUNCTION interno.tapar_lo_que_no_viaja_en_un_mensaje(text, uuid) IS
  'Tapa en un texto lo que las reglas de los mensajes alcanzan, y devuelve el texto tapado y la clave de la primera regla que tapo algo. Nunca devuelve ni registra lo que tapo. Con el cuerpo de reglas vacio falla cerrado.';

REVOKE ALL ON FUNCTION interno.tapar_lo_que_no_viaja_en_un_mensaje(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.tapar_lo_que_no_viaja_en_un_mensaje(text, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION interno.patron_de_mensaje_en_postgres(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.patron_de_mensaje_en_postgres(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION interno.marca_de_lo_tapado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.marca_de_lo_tapado() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Dónde queda anotado que se tapó
-- ---------------------------------------------------------------------------

ALTER TABLE public.mensajes_marketplace
  ADD COLUMN IF NOT EXISTS regla_tapada text;

COMMENT ON COLUMN public.mensajes_marketplace.regla_tapada IS
  'La clave de la primera regla que tapo algo en este mensaje, o nula si no se tapo nada. Es una clave, nunca el texto tapado.';
COMMENT ON COLUMN public.mensajes_marketplace.cuerpo IS
  'El texto ya tapado. Lo que las reglas de los mensajes alcanzan no se guarda: se tapa antes de escribirlo, del lado de la base.';
COMMENT ON TABLE public.mensajes_marketplace IS
  'Los mensajes de un hilo del Marketplace. Se guardan ya tapados: lo que no puede viajar en un mensaje no queda escrito en ningun lado, asi que llegar al dato por otra via no lo muestra.';

-- ---------------------------------------------------------------------------
-- 6. El disparador
-- ---------------------------------------------------------------------------
--
-- Antes de guardar, y también antes de cualquier corrección del cuerpo: quien llame al motor por
-- otra vía, o escriba contra la base directamente, pasa por acá igual. No es `SECURITY DEFINER`
-- —lo prohíbe `productos/careonys/CLAUDE.md`—: corre con el rol de quien escribe, y por eso lo
-- que llama vive en `interno` y tiene el permiso dado ahí.

CREATE OR REPLACE FUNCTION public.el_mensaje_se_guarda_ya_tapado()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'interno'
AS $$
DECLARE
  lo_tapado record;
BEGIN
  -- Un mensaje automático no lo escribió nadie: su cuerpo es una clave de traducción. Buscarle
  -- un teléfono a una clave no encuentra nada y podría romperla.
  IF NEW.automatico THEN
    NEW.regla_tapada := NULL;
    RETURN NEW;
  END IF;

  SELECT t.texto, t.regla
    INTO lo_tapado
    FROM interno.tapar_lo_que_no_viaja_en_un_mensaje(NEW.cuerpo, NEW.prestadora_id) t;

  NEW.cuerpo       := lo_tapado.texto;
  NEW.regla_tapada := lo_tapado.regla;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.el_mensaje_se_guarda_ya_tapado() IS
  'Sobre mensajes_marketplace: tapa el texto antes de escribirlo y anota que regla lo tapo. El texto tapado no se guarda, no se registra y no sale en ningun error.';

DROP TRIGGER IF EXISTS el_mensaje_se_guarda_ya_tapado ON public.mensajes_marketplace;
CREATE TRIGGER el_mensaje_se_guarda_ya_tapado
  BEFORE INSERT OR UPDATE OF cuerpo ON public.mensajes_marketplace
  FOR EACH ROW
  EXECUTE FUNCTION public.el_mensaje_se_guarda_ya_tapado();

-- ---------------------------------------------------------------------------
-- 7. Lo que ya estaba guardado entero
-- ---------------------------------------------------------------------------
--
-- Un defecto corregido se corrige en todas: lo que se guardó sin tapar sigue sin taparse solo.
-- Se lo vuelve a escribir tal cual, y el disparador hace el resto. No se puede recuperar lo que
-- ya se mostró, pero deja de estar guardado.

UPDATE public.mensajes_marketplace
   SET cuerpo = cuerpo
 WHERE automatico = false;

COMMIT;

NOTIFY pgrst, 'reload schema';

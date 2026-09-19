-- Una regla más para los mensajes: el nombre de usuario que quedaba suelto al lado de la invitación
-- ==========================================================================================
--
-- QUÉ ESTABA MAL. `invitacion_a_otra_aplicacion` tapa la invitación y nada más, así que
-- «agregame al face: usuario.ejemplo» quedaba guardado como «•••: usuario.ejemplo»: tapada la
-- invitación y **legible el dato**, que es justamente lo único que no podía viajar. En Match no
-- se notaba porque allá el mensaje entero se rechaza; acá el mensaje entra tapado, y lo que queda
-- destapado se lee.
--
-- Y lo mismo al revés: «juanita.inventada en instagram, buscame ahí» dejaba el nombre de usuario
-- adelante, fuera de lo que la regla alcanzaba.
--
-- EL SEGUNDO CASO, DE LA MISMA FORMA. Un correo sin un final reconocible —«alguien.inventado@ejemplo»,
-- sin punto ni terminación— no lo alcanza `correo`, y entonces lo alcanzaba
-- `usuario_de_otra_aplicacion`, que tapa desde la arroba: quedaba guardado
-- «escribime a alguien.inventado•••», con el nombre de la casilla a la vista. Se tapa entero, y
-- antes de que la regla de la arroba lo parta al medio.
--
-- POR QUÉ ES UNA FILA Y NO CÓDIGO. Porque qué no puede viajar en un mensaje es dato: se agrega una
-- regla sin publicar ninguna versión (`celtatech/docs/REGLAS_PRODUCTOS_CAREONYS.md` §4). No se
-- toca ninguna regla ya cargada: `invitacion_a_otra_aplicacion` sigue haciendo lo suyo cuando la
-- invitación viene sin ningún nombre de usuario detrás.
--
-- DÓNDE SE INTERCALAN. `invitacion_con_usuario` entra con orden 8, antes de
-- `invitacion_a_otra_aplicacion` (9), porque necesita leer el nombre de la aplicación todavía sin
-- tapar. `correo_incompleto` entra con orden 3, junto a `correo` y antes de
-- `usuario_de_otra_aplicacion` (6), por el mismo motivo.
--
-- HASTA DÓNDE LLEGA, Y HASTA DÓNDE NO. Se tapa el nombre de usuario que se reconoce como tal
-- —el que trae un punto, un guion, un guion bajo, una arroba o es todo dígitos— y el que viene
-- presentado con dos puntos o con «es». Una palabra suelta detrás del nombre de la aplicación
-- —«buscame en tiktok soyalguien»— queda afuera a propósito: ninguna expresión distingue ese
-- nombre de usuario de la palabra corriente que sigue a cualquier invitación, y taparla se llevaría
-- puesto «agregame al whatsapp así coordinamos». Vale la advertencia que ya está escrita: el daño
-- de este control no es dejar pasar un dato, que se arregla con otra fila, sino taparle media frase
-- a un Asistente que está diciendo lo que cobra y cuándo puede.
--
-- EL TEXTO TAPADO NO SE ESCRIBE EN NINGÚN LADO, acá tampoco: lo único que queda anotado en el
-- mensaje es la clave de la regla.

BEGIN;

INSERT INTO public.reglas_de_los_mensajes (clave, patron, banderas, motivo, orden) VALUES
  -- Tres formas, con la misma invitación de la regla 9 adelante o atrás:
  --   1. invitación … aplicación … nombre de usuario reconocible;
  --   2. invitación … aplicación … dos puntos o «es» … cualquier palabra;
  --   3. nombre de usuario reconocible … aplicación … invitación.
  ('invitacion_con_usuario',
   '\b(?:busc.me|agreg.me|escrib.me|contact.me|habl.me|mand.me|llam.me|segu.me|pas.me|write|text|message|find|add|follow|contact|reach|dm|ping|escreva|escreve|procure|procura|adicione|adiciona|siga|segue|chame|chama|fale|fala|mande|manda|ligue|liga)\b[^\n]{0,40}\b(?:instagram|insta|ig|telegram|telegran|whatsapp|whatsap|wasap|wsp|wpp|messenger|facebook|face|tiktok|snapchat|skype|signal|discord|linkedin|zoom|meet)\b[ ,]{0,2}(?:(?:[:=]|\b(?:es|is|é)\b)[ ,]{0,2})?(?:[A-Za-z0-9]{1,20}[._@-][A-Za-z0-9._@-]{1,28}|[0-9]{3,})|\b(?:busc.me|agreg.me|escrib.me|contact.me|habl.me|mand.me|llam.me|segu.me|pas.me|write|text|message|find|add|follow|contact|reach|dm|ping|escreva|escreve|procure|procura|adicione|adiciona|siga|segue|chame|chama|fale|fala|mande|manda|ligue|liga)\b[^\n]{0,40}\b(?:instagram|insta|ig|telegram|telegran|whatsapp|whatsap|wasap|wsp|wpp|messenger|facebook|face|tiktok|snapchat|skype|signal|discord|linkedin|zoom|meet)\b[ ,]{0,2}(?:[:=]|\b(?:es|is|é)\b)[ ,]{0,2}[A-Za-z0-9][A-Za-z0-9._-]{2,29}|(?:[A-Za-z0-9]{1,20}[._@-][A-Za-z0-9._@-]{1,28}|[0-9]{3,})[ ,]{0,2}(?:\b(?:en|no|em|on|in|por|via|by)\b[ ]{0,2})?\b(?:instagram|insta|ig|telegram|telegran|whatsapp|whatsap|wasap|wsp|wpp|messenger|facebook|face|tiktok|snapchat|skype|signal|discord|linkedin|zoom|meet)\b[^\n]{0,40}\b(?:busc.me|agreg.me|escrib.me|contact.me|habl.me|mand.me|llam.me|segu.me|pas.me|write|text|message|find|add|follow|contact|reach|dm|ping|escreva|escreve|procure|procura|adicione|adiciona|siga|segue|chame|chama|fale|fala|mande|manda|ligue|liga)\b',
   'gi',
   '{"es-AR": "Parece un nombre de usuario de otra aplicación.", "en": "This looks like a username on another application.", "pt-BR": "Parece um nome de usuário de outro aplicativo."}',
   8),

  ('correo_incompleto',
   '[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9-]{2,}',
   'gi',
   '{"es-AR": "Parece una dirección de correo.", "en": "This looks like an email address.", "pt-BR": "Parece um endereço de e-mail."}',
   3)
ON CONFLICT DO NOTHING;

-- Un defecto corregido se corrige en todas: lo que se guardó con el nombre de usuario a la vista
-- sigue así hasta que se lo vuelva a escribir. El disparador hace el resto. No se puede recuperar
-- lo que ya se mostró, pero deja de estar guardado.
UPDATE public.mensajes_marketplace
   SET cuerpo = cuerpo
 WHERE automatico = false;

COMMIT;

NOTIFY pgrst, 'reload schema';

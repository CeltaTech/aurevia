# Mapa de secretos — Careonys

**Acá no hay ningún valor, y no lo va a haber.** Este documento dice qué secreto existe, para qué
sirve, dónde vive y cuándo se rotó. El valor se mira en el lugar donde vive, por quien tenga el
acceso: escribirlo acá convertiría el repositorio en la caja fuerte que este documento viene a
evitar (`celtatech/CLAUDE.md` §6, «toda credencial vive en variable de entorno»).

**Para qué sirve tenerlo escrito.** Hasta hoy la única forma de saber qué secretos usa el producto
era leer el código buscando `process.env`, y la única forma de saber dónde estaba cada uno era
acordarse. Con eso no se puede contestar ninguna de las tres preguntas que importan el día que
algo se filtra: qué hay que rotar, a quién se le rompe el servicio mientras se rota, y qué queda
sin rotar porque nadie se acordó de que existía.

**Qué NO es un secreto, aunque viaje por el mismo camino.** La mayoría de las variables de entorno
del motor son configuración: direcciones de servicios, topes, el nombre del modelo de IA. Están
listadas al final, aparte, justamente para que nadie las rote creyendo que lo son ni las trate con
el cuidado que hace falta para las otras.

---

## 1. Dónde puede vivir un secreto

Son cinco lugares, y ninguno se superpone con otro:

| Lugar | Qué guarda | Quién lo lee |
|---|---|---|
| **Railway** — variables del servicio del motor | Todo lo que el motor necesita para funcionar en producción | El motor, en ejecución |
| **Secretos del repositorio en GitHub** | Lo que necesitan los automatismos: publicar, desplegar y respaldar | Los cinco archivos de `.github/workflows/` |
| **La caja fuerte de la base** (`vault` de Supabase) | Lo de **cada Prestadora**: su pasarela, su correo, su WhatsApp | El motor, con la llave de servicio, a través de funciones `SECURITY DEFINER` |
| **El panel de cada proveedor** | El valor original, que es de donde sale la copia que va a los otros lugares | Quien tenga la cuenta |
| **La máquina del Desarrollador** — `backend/.env` y la caja fuerte local | Lo mismo que Railway, pero apuntando al ambiente de desarrollo | El motor corriendo en local |

**La caja fuerte local no se abre** (`F:\proyectos\CLAUDE.md`): ni para verificar, ni para
completar este documento. Lo que este mapa sabe de ella es qué nombres espera el código, que se
lee en el código.

---

## 2. Los secretos del motor (Railway, y `backend/.env` en desarrollo)

Cada uno con el archivo que lo usa, para no tener que buscarlo.

| Secreto | Para qué sirve | Si falta | Última rotación |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | La llave con la que el motor entra a la base salteándose la protección por fila. **Es la más grave de todas: quien la tiene lee y escribe cualquier dato de cualquier Prestadora.** `backend/src/db/connection.js` | El motor no arranca | Sin registro — ver §6 |
| `ANTHROPIC_API_KEY` | Todo lo que hace la IA: leer un aviso de ausencia, redactar plantillas de WhatsApp, interpretar una importación, resumir | Cada función de IA devuelve «sin respuesta» y el resto del producto sigue andando | Sin registro |
| `SMTP_USER` y `SMTP_PASSWORD` | La casilla desde la que sale todo el correo del producto. `backend/src/utils/email.js` | No se manda ningún correo, en silencio | Sin registro |
| `VAPID_PRIVATE_KEY` | Firma los avisos al celular. Va de a pares con `VAPID_PUBLIC_KEY`, que no es secreta y se compila adentro de las pantallas. `backend/src/utils/push.js` | No llega ningún aviso al celular | Sin registro |
| `QR_COBRO_SECRET` | Firma el código que se escanea para cobrar en efectivo, para que no se pueda fabricar uno. `backend/src/utils/qrCobroEfectivo.js` | El motor arranca igual y falla recién al generar un código de cobro | Sin registro |
| `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY` | Subir el respaldo al depósito de Cloudflare R2 | No se guarda el respaldo | Sin registro |
| `COBRANZA_EFECTIVO_SECRETO_FIRMA_WEBHOOK`, `DEBIN_SECRETO_FIRMA_WEBHOOK`, `MODO_SECRETO_FIRMA_WEBHOOK` | Comprobar que el aviso de cobro lo mandó la pasarela y no cualquiera que conozca la dirección. **Son el respaldo del ambiente:** el secreto que manda es el de esa Prestadora, guardado en la caja fuerte de la base (§4) | El aviso se rechaza, que es lo correcto: mejor no cobrar que dar por cobrado lo que no se cobró | Sin registro |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Contestarle a Meta el saludo con que engancha la entrada de WhatsApp. **Quedó de cuando había uno solo para todas**; hoy manda el de cada Prestadora (§4) | El saludo de Meta falla si esa Prestadora tampoco tiene el suyo | Sin registro |

---

## 3. Los secretos de los automatismos (secretos del repositorio en GitHub)

Estos no los usa el producto: los usan los cinco archivos de `.github/workflows/`. **Ninguno está
en la máquina del Desarrollador**, y eso es a propósito — si un automatismo es la única forma de
publicar, el token de publicar no tiene por qué andar dando vueltas en una computadora.

| Secreto | Para qué sirve | Quién lo usa |
|---|---|---|
| `RAILWAY_TOKEN` | Subir el motor a Railway en cada push que toca `backend/` | `deploy-backend.yml` |
| `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` | Publicar el Panel, las dos aplicaciones y la página raíz. El token está acotado a Pages y DNS | `publicar-pantallas.yml` |
| `BACKUP_DB_HOST`, `BACKUP_DB_PORT`, `BACKUP_DB_NAME`, `BACKUP_DB_USER`, `BACKUP_DB_PASSWORD` | La conexión directa a la base para el volcado diario | `backup-diario.yml` |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Subir el volcado al depósito principal | `backup-diario.yml` |
| `B2_ENDPOINT`, `B2_BUCKET`, `B2_KEY_ID`, `B2_APPLICATION_KEY` | Subir el mismo volcado al espejo de Backblaze | `backup-diario.yml` |
| `SUPABASE_SERVICE_ROLE_KEY` | Bajar los archivos de los depósitos para copiarlos junto con el volcado. **Es el mismo valor que el del motor**, y por eso rotarlo toca los dos lugares | `backup-diario.yml` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_SITE_URL`, `VITE_VAPID_PUBLIC_KEY` | Los valores que se compilan adentro de cada pantalla. **No son secretos** —quedan a la vista de cualquiera que abra la aplicación— y están acá únicamente porque los archivos `.env.production` no se versionan | `publicar-pantallas.yml` |

**La clave anónima de Supabase no es una contraseña.** Es pública por diseño: lo que decide qué
puede hacer quien la usa son las políticas de protección por fila, no el hecho de conocerla.
Rotarla no protege nada y rompe todas las pantallas publicadas.

---

## 4. Los secretos de cada Prestadora (la caja fuerte de la base)

Estos no son de CeltaTech ni del producto: son de cada Prestadora, los carga ella y **nadie los
vuelve a ver, ni ella misma**. No viven en ninguna tabla: lo que la tabla guarda es el número de
referencia de una caja de `vault`, y adentro de esa caja está el texto cifrado.

| Caja | Qué guarda | Funciones que la abren |
|---|---|---|
| `pasarela_<proveedor>_<prestadora>` | La credencial con la que esa Prestadora cobra por esa pasarela | `guardar_credencial_pasarela_pago` / `leer_credencial_pasarela_pago` |
| `pasarela_firma_<proveedor>_<prestadora>` | El secreto con el que esa pasarela firma sus avisos de cobro | `guardar_secreto_firma_pasarela_pago` / `leer_secreto_firma_pasarela_pago` |
| `smtp_credencial_<prestadora>` | La contraseña de la casilla propia de la Prestadora | Las de `20260819160000_foto_de_la_base.sql` |
| `whatsapp_token_<prestadora>` | El token con el que manda mensajes por WhatsApp | ídem |
| `whatsapp_app_secret_<prestadora>` | Con qué se comprueba la firma de lo que llega de Meta | `guardar_app_secret_whatsapp` / `leer_app_secret_whatsapp` |
| `whatsapp_verify_token_<prestadora>` | Con qué se contesta el saludo de enganche de Meta | `guardar_verify_token_whatsapp` / `leer_verify_token_whatsapp` |

**Las doce funciones son `SECURITY DEFINER` y sólo las alcanza `service_role`**, o sea el motor.
Ni el Superadmin ni el Admin de la propia Prestadora llegan al texto. Rotar uno de estos secretos
no es trabajo de CeltaTech: la Prestadora lo vuelve a cargar desde Configuración, y el cambio
reemplaza el contenido de la caja en vez de abrir otra.

---

## 5. Qué se rota cuando se filtra qué

Sirve el día que pasa, que es el día en que nadie tiene tiempo de leer código.

- **Se filtró la llave de servicio de Supabase** → se rota en el panel de Supabase y se actualiza
  **en el mismo acto** en los dos lugares donde vive: las variables de Railway y el secreto
  `SUPABASE_SERVICE_ROLE_KEY` del repositorio, que es el que usa el respaldo diario para bajar los
  archivos. Mientras tanto el motor entero está caído: no hay forma de que no lo esté.
- **Se filtró un token de publicación** (Railway o Cloudflare) → se rota en su panel y se reemplaza
  el secreto del repositorio. No se cae nada; lo que no anda hasta reemplazarlo es publicar.
- **Se filtraron las llaves del respaldo** (R2 o B2) → se rotan en su panel y se reemplazan los
  secretos del repositorio. **Y se revisa qué se pudo bajar**: ahí adentro está la base entera.
- **Se filtró la clave de la API de IA** → se rota en el panel de Anthropic. Cada función de IA
  queda sin respuesta hasta reemplazarla; ninguna otra cosa se rompe.
- **Se filtró un secreto de una Prestadora** → lo vuelve a cargar ella desde Configuración. Si la
  que avisó usa la misma pasarela que otras, se revisa en todas: un defecto que aparece en una
  Prestadora es del producto, no de ella (`celtatech/CLAUDE.md` §8).

---

## 6. Por qué la columna «última rotación» está vacía

**Porque hasta hoy no se rotó ninguno, no porque falte averiguarlo.** Todos los secretos de §2 y
§3 son los originales, de cuando se dio de alta cada servicio. La rotación de a uno es un paso
propio de `docs/PLAN_HASTA_PRODUCCION.md`, y ahí entra además el caso que hay que rotar sí o sí:
**la llave de servicio de Supabase estuvo escrita en texto plano en la configuración de permisos de
la máquina del Desarrollador.** Los comandos que la llevaban adentro ya se borraron; la llave se
rota el día de la liberación.

**Al rotar uno, la fecha se anota acá**, en su renglón. Un mapa que dice dónde está cada secreto y
no dice cuándo se cambió sirve la mitad.

---

## 7. Lo que no es secreto

Variables de entorno del motor que son configuración, no credenciales. **No se rotan.** Se listan
para que nadie las confunda con las de arriba, ni al revés.

- **Direcciones de servicios ajenos:** `SUPABASE_URL`, `GEOREF_API_BASE`, `MERCADOPAGO_API_BASE`,
  `MERCADOPAGO_BACK_URL`, `STRIPE_API_BASE`, `MODO_API_BASE`, `DEBIN_API_BASE`,
  `DEBIN_PSP_API_BASE`, `COBRANZA_EFECTIVO_API_BASE`, `R2_ENDPOINT`, `R2_BUCKET`.
- **Direcciones propias:** `PANEL_URL`, `PWA_FAMILIAS_URL`, `PWA_ASISTENTES_URL`, `PORT`.
- **Decisiones de funcionamiento:** `MODELO_IA` (el nombre del modelo, que vive en un solo lugar y
  se puede pisar por entorno), `TOPE_PEDIDOS_POR_MINUTO`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`.
- **Sólo para correr cosas en la máquina propia:** `CONTENEDOR_BASE`, `URL_MOTOR`, `DB_HOST`,
  `ANTHROPIC_BASE_URL` (que además usan las pruebas para no salir a la API de verdad).

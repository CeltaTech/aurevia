# Marca del producto — qué archivos tienen que existir

> Etapa 0.5 de `celtatech/docs/PLAN_SEPARACION_CELTATECH.md`. Este documento es el **contrato**: la lista de
> archivos que hay que entregar cuando la marca exista. Hoy **no existe ninguno** — no hay
> isotipo ni logotipo diseñados, y no hay dominio registrado (confirmado por el Desarrollador
> el 2026-07-27). Nada de lo que sigue está hecho.

## 0. Antes que nada: acá hay tres marcas, no una

| Marca | Qué es | Quién la ve |
|---|---|---|
| **CeltaTech** | La empresa dueña del software | Nadie, dentro del producto |
| **Careonys** | El producto | Quien trabaja **en** la Prestadora (Admin_prestadora, Coordinador) y sabe qué software usa |
| **La Prestadora** | La empresa que presta el cuidado | La **Familia** y el **Asistente** |

Todo este documento habla de la segunda. **No confundirla con la tercera.**

Una Familia contrató a la Prestadora, no a CeltaTech, y probablemente no sepa que Careonys
existe. Un Asistente trabaja para la Prestadora. Para los dos, la marca que tiene sentido es
la de la Prestadora — `prestadoras.nombre_fantasia`, que existe en la base desde el diseño
inicial y que el diseño multi-tenant definió textualmente como *"marca que ve la
familia/paciente final"*.

**La regla:** en toda pantalla, email o notificación dirigida a una Familia o a un Asistente,
la marca **principal** la pone la Prestadora, nunca `identidadProducto.js`.

**El modelo es co-branding** — decidido por el Desarrollador el 2026-07-27, después de mirar
qué hace la industria. No es marca blanca total: la marca de la Prestadora va primera y
grande, y el producto queda en una línea discreta al pie, *"con la tecnología de
{{producto}}"*. Esa línea es el **único** lugar donde la marca del producto puede aparecer
ante una Familia o un Asistente, y **va siempre**: es el crédito de quién hizo el software, no
una función que se venda. El producto no pregunta qué contrató nadie.

**Cada Prestadora manda desde su propia dirección de correo, bajo el dominio del producto.** Al
dar de alta una Prestadora se le crea `[prestadora]@careonys.com`, y de ahí salen todos sus
avisos. Esa dirección sólo manda: **las respuestas se reenvían a la casilla que la Prestadora
declare**, que es la suya y vive donde ella quiera.

El nombre de esa dirección sale, en este orden:

1. Del dominio propio que la Prestadora haya declarado — `contacto@cuidardelsur.com` da
   `cuidardelsur@careonys.com`.
2. Del nombre de la Prestadora, si lo que declaró es una casilla de un proveedor gratuito.
3. De ese mismo nombre con un sufijo, si ya está tomado.

**Se fija en el alta y no cambia nunca**, porque ya quedó escrita en todos los correos que se
mandaron. Es un nombre guardado, no una marca.

Va bajo el dominio del producto y no bajo el de cada Prestadora porque la autorización para
mandar —SPF y DKIM— se carga una sola vez, en `careonys.com`, y de ahí cuelgan todas las
direcciones. Pedirle eso a cada Prestadora sería pedirle un trabajo que una Prestadora chica no
va a hacer, y sus avisos terminarían en correo no deseado.

Dos cosas que la decisión **descartó** explícitamente, para que nadie las reabra sin motivo:

- **Nada de marca blanca total.** Si el producto es invisible, nadie sabe que existe.
- **El nombre y el ícono de la PWA instalada se quedan con la marca del producto.** Hay un
  solo build para todas las Prestadoras. Es el punto donde el límite técnico y el estándar de
  la industria coinciden.

**Desde el 2026-08-08 la regla se cumple** (pendiente `#95`, cerrado). La Prestadora tiene
dónde guardar su logo, y las dos aplicaciones muestran su marca arriba y la del producto al
pie.

**Dónde viven los archivos de marca de la Prestadora.** En el depósito `marca-prestadoras`, y
cada Prestadora tiene su carpeta, que se llama como su identificador:

    marca-prestadoras/<id de la Prestadora>/logo.png

No es un nombre bonito: es de lo que se agarran las reglas del depósito para saber de quién es
cada archivo. Leer lo puede cualquiera —un logo está en la puerta del local—, pero escribir
solo dentro de la carpeta propia.

**El logo es opcional.** Sin logo la pantalla no se rompe: muestra el nombre de la Prestadora
escrito.

**La pantalla de ingreso muestra la marca de la Prestadora.** Se la dice la dirección: cada
Prestadora entra por la suya. `panel/src/lib/puertaDeIngreso.js` traduce esa dirección al segmento
que el motor lee, y `backend/src/routes/marcaDeLaPuerta.js` devuelve el nombre y el logotipo sin
pedir sesión. Si la dirección no corresponde a ninguna Prestadora, no se entra: no hay a cuál.

## 1. Los dos nombres, y por qué importa la diferencia

| | Qué es | ¿Cambia si se renombra el producto? |
|---|---|---|
| **Isotipo** | El símbolo solo, sin texto | Sí |
| **Logotipo** | El símbolo junto al nombre escrito | Sí |

El isotipo es el que va en los lugares chicos y cuadrados: el ícono de la app en el teléfono,
la pestaña del navegador, la notificación push. El logotipo va donde hay ancho: el
encabezado del Panel, la firma de un email.

## 2. Archivos a entregar

Todos van en `public/marca/` de cada app que los use (`panel/`, `pwa-asistentes/`,
`pwa-familias/`). Las rutas se declaran en `src/config/identidadProducto.js`, campos
`isotipo` y `logotipo` — ningún componente escribe una ruta de imagen a mano.

### Isotipo

| Archivo | Para qué | Por qué ese formato |
|---|---|---|
| `isotipo.svg` | Todo uso en pantalla | Escala sin pixelarse a cualquier tamaño |
| `isotipo-512-maskable.png` | Ícono de la PWA instalada en Android | Android recorta el ícono con la forma que elija el fabricante (círculo, cuadrado redondeado, gota). "Maskable" significa que el dibujo tiene margen suficiente para que ningún recorte le coma un pedazo |
| `isotipo-512.png` | Ícono de la PWA, uso general | |
| `isotipo-192.png` | Ícono de la PWA, pantallas chicas | |
| `isotipo-180.png` | Ícono en iPhone/iPad (`apple-touch-icon`) | iOS no usa el manifiesto para esto, pide su propio archivo |
| `isotipo-32.png`, `isotipo-16.png` | Pestaña del navegador en escritorio | |

### Logotipo

| Archivo | Para qué |
|---|---|
| `logotipo-horizontal.svg` | Encabezados anchos (Panel en escritorio) |
| `logotipo-vertical.svg` | Espacios altos y angostos (pantalla de ingreso en celular) |
| `logotipo-horizontal.png` | **Emails** — ver abajo |

**Por qué un PNG solo para email:** los programas de correo (Gmail, Outlook, el Mail del
iPhone) no dibujan archivos SVG. Un logotipo en SVG dentro de un email se ve como un
recuadro roto. Es el único lugar donde el PNG no es una alternativa sino la única opción.

### Variantes claro / oscuro

Cada SVG que se vea sobre fondo puede necesitar dos versiones, con el sufijo `-claro` y
`-oscuro` (ej. `logotipo-horizontal-oscuro.svg`), para cuando el teléfono está en modo
oscuro y un logotipo de tinta negra desaparecería. Si la marca se diseña de modo que funcione
sobre cualquier fondo, alcanza con una sola versión y no hacen falta las variantes.

## 3. Lo que ya está resuelto y no hay que rehacer

- **El nombre en texto** no necesita ningún archivo: sale de `identidadProducto.js` y se
  reparte solo por los marcadores `{{producto}}` / `{{productoCorto}}`.
- **El nombre de la Prestadora adentro de una frase** tiene su propio marcador,
  `{{prestadora}}`, que funciona igual y vive en `src/i18n/marcaEnElTexto.js` (original en el
  Panel, copia idéntica en las dos aplicaciones). Lo alimentan `PerfilContext.jsx` en las
  aplicaciones y `EmpresaContext.jsx` en el Panel; mientras no hay Prestadora anotada el marcador
  cae al nombre del producto. La marca **dibujada** no pasa por acá y sigue saliendo
  de `useMarca()`: un marcador reemplaza texto, y una imagen no es texto.
- **Los colores** (`colorPrimario`, `colorFondo`) ya salen de ahí, y de ahí los toma el
  manifiesto de las dos PWA.
- **El manifiesto y el `<title>`** de las PWA ya se arman desde la identidad — cuando existan
  los archivos de marca, solo hay que apuntar `isotipo` y reemplazar los `icon-*.png`
  provisorios que hoy viven en `public/`.

## 4. Lo que hoy hay en su lugar

`identidadProducto.js` apunta `isotipo` a `/favicon.svg` (el archivo provisorio que ya existe
en las tres apps) y deja `logotipo` en `null`. **Todo punto de consumo tiene que tolerar
`logotipo: null` y caer al nombre en texto** — nunca romper ni dejar un hueco por una imagen
que todavía no se dibujó.

## 5. Cuándo hay que tener esto

No bloquea nada del plan de separación. La fecha límite real es la misma que la de pendiente
`#44`: **antes de la primera Prestadora real**. Hasta entonces el producto funciona completo
con el favicon provisorio.

Hay un motivo para no dejarlo para el final: el ícono de una PWA queda grabado en el teléfono
de quien la instaló. Cambiarlo después obliga a cada persona a desinstalar y reinstalar la
app para verlo actualizado. Hoy eso no cuesta nada — **no hay una sola PWA instalada**.
Después de la primera Prestadora, cuesta.

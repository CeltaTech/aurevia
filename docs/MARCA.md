# Marca del producto — qué archivos tienen que existir

> Etapa 0.5 de `PLAN_SEPARACION_XEITRA.md`. Este documento es el **contrato**: la lista de
> archivos que hay que entregar cuando la marca exista. Hoy **no existe ninguno** — no hay
> isotipo ni logotipo diseñados, y no hay dominio registrado (confirmado por el Desarrollador
> el 2026-07-27). Nada de lo que sigue está hecho.

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

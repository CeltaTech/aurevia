# PRD_01 — La página pública de Careonys

> **Reescrito entero el 2026-08-13.** Cierra el pendiente `#104`. Lo que había acá describía
> el sitio de una empresa de cuidados —con formularios para pedir un cuidador y para
> postularse a trabajar— y ese no es este producto. Era un documento viejo, de cuando el
> proyecto era el sitio de una sola empresa, antes de que el software pasara a ser de
> CeltaTech. El texto anterior no se conserva acá: quien quiera verlo lo tiene en el
> historial de git.
>
> Nada de lo que sigue está construido. Hoy en `careonys.com` hay una sola página que dice
> "En construcción" (ver §8).

## 0. Qué vende esta página, y qué no

**Careonys le vende software de gestión a empresas que cuidan personas.** No le vende cuidado
a nadie. `CLAUDE.md` §1 lo dice con todas las letras: Careonys *"no presta servicios de
cuidado"* — es la herramienta con la que las empresas del rubro administran su operación.

De ahí salen las dos frases que ordenan todo el resto:

- **Una familia que entra buscando un cuidador se va sin lo que buscaba, y está bien.** No es
  nuestra clienta: es clienta de nuestras clientas. Lo único que le debemos es una salida
  clara y rápida, no una página entera (§1).
- **Ofrecerle cuidado a esa familia sería competirle a nuestros propios clientes.** Es la
  razón de fondo, y no depende de cómo esté escrita la página.

### Dos direcciones, dos temas distintos

| Dirección | De qué habla | Quién la mira |
|---|---|---|
| `celtatech.com` | La empresa y todo lo que hace: éste y los demás productos | Quien quiere saber quiénes somos |
| `careonys.com` | **Un solo producto**, contado en detalle | Quien busca software para su empresa de cuidados |

Regla práctica para saber dónde va una frase: si sigue siendo verdad cambiando "Careonys" por
el nombre de cualquier otro producto de la empresa, entonces es de `celtatech.com`. Si habla
de guardias, de reportes o de asistentes, es de acá.

Este documento es solamente el de `careonys.com`. El de la empresa no se escribe acá.

## 1. A quién le habla

Dos personas deciden juntas, y la página tiene que servirles a las dos:

- **Quien dirige la empresa de cuidados.** Firma y paga. Lo que quiere saber es si esto le
  saca de encima el desorden que tiene hoy, cuánto le sale y qué pasa con los datos de sus
  pacientes.
- **Quien coordina el día a día.** No firma, pero si dice que no, no se compra. Lo que quiere
  es **ver las pantallas** antes de creer nada.

Y dos que llegan por error, buscando lo que no vendemos:

- **Una familia buscando un cuidador.**
- **Alguien buscando trabajo de cuidador.**

A estos dos la página les debe **una sola línea visible**, no una explicación larga: que
Careonys es el software que usan las empresas del rubro, que no toma pedidos ni
postulaciones, y que tienen que dirigirse a la empresa que los atiende. Si esa línea no está,
el correo se llena de pedidos que no podemos responder y cada uno de ellos es una persona
esperando algo que no va a llegar.

## 2. Qué tiene que lograr

**Una sola cosa: que quien dirige una empresa de cuidados deje sus datos para que le
mostremos el producto.** Todo lo demás de la página existe para llegar a eso o para sacar una
objeción del camino.

Segundo objetivo, que condiciona cómo está hecha: **que los buscadores la encuentren.** Quien
busca "software para empresa de cuidado domiciliario" tiene que dar con esta página. Ese
motivo ya se había fijado el 2026-07-08 con estas palabras del Desarrollador: *"el seo es
fundamental, si no nos ven no nos contactan, si no nos contactan no facturamos"*. **El motivo
sigue valiendo igual; lo que cambió es qué dice la página, no para qué está.** La consecuencia
técnica está en §8: el texto tiene que llegar ya escrito desde el servidor, no armarse en el
navegador de quien mira.

## 3. Lo que la página no puede hacer

Son límites duros, no preferencias.

1. **No ofrece cuidado ni recibe pedidos de cuidado.** Ni un formulario, ni un teléfono para
   familias, ni una lista de servicios de cuidado con precios.
2. **No recibe postulaciones de Asistentes.** Quien quiere trabajar cuidando se postula en la
   empresa que lo va a contratar, no acá.
3. **Ningún dato real de nadie.** Ni el nombre de una Prestadora, ni un caso de éxito con
   nombre y apellido, ni una captura de pantalla con un paciente, un domicilio o un dato de
   salud verdadero (`CLAUDE.md` §6). Toda captura se saca del Sandbox, con datos inventados.
   Si alguna vez se publica el caso de un cliente, hace falta su permiso por escrito, y aun
   así las capturas siguen siendo de datos inventados.
4. **El nombre del producto no se escribe a mano en ningún archivo.** Sale de
   `identidadProducto.js` mediante los marcadores `{{producto}}` / `{{productoCorto}}`
   (`CLAUDE.md` §7 regla 1). La página de obra que hay hoy ya lo hace así, y
   `scripts/verificar_identidad.mjs` corta la publicación si alguien lo escribe a mano.
5. **Los tres idiomas desde el primer día**: español de Argentina, inglés y portugués de
   Brasil, siempre juntos (`CLAUDE.md` §7 regla 2). No se publica una página en un idioma
   "para traducirla después".
6. **No se promete lo que el producto no hace.** A la fecha de hoy no existen: el cobro
   automático a las Familias, la aplicación instalable desde las tiendas de Android y Apple, y
   los niveles de inteligencia artificial 3 a 5 (`BUILD_ORDER.md`). Lo que está a medias se
   cuenta como lo que es o no se cuenta.
7. **Ningún número de precio hasta que estén decididos** (§6).

## 4. Las páginas

Seis, y ninguna de más. Cada una tiene un trabajo; si no se le encuentra el trabajo, no va.

### 1. Portada (`/`)
Arriba de todo, en una sola frase, qué es y para quién. Debajo, el problema concreto que
resuelve, dicho como lo diría quien lo sufre: la grilla de guardias en una planilla, el
teléfono que suena porque nadie sabe si el asistente llegó, la familia que pregunta cómo pasó
la noche su madre. Y el botón que lleva a pedir una demostración.

Acá va también la línea para quien llegó por error (§1).

### 2. El producto por dentro (`/producto`)
Las tres piezas, con capturas de pantalla reales del Sandbox:

- **El Panel**, donde se maneja la empresa: quién cuida a quién, qué guardia quedó sin
  cubrir, qué documentación se vence.
- **La aplicación del Asistente**, donde marca que llegó, deja el reporte del día y consulta
  lo que tiene que hacer.
- **La aplicación de la Familia**, donde lee todos los días cómo estuvo su paciente.

Es la página que mira quien coordina. Las capturas pesan más que el texto.

### 3. Cómo se cobra (`/precios`)
La estructura, explicada en castellano y sin números todavía (§6).

### 4. Los datos y la seguridad (`/seguridad`)
Existe porque es la primera objeción real de cualquier empresa que maneja información de
salud, y contestarla tarde es perder la venta. Qué se cuenta: que los datos de cada empresa
están separados de los de las demás por diseño, que hay respaldo diario, quién ve qué dentro
del producto, y qué pasa con la información si el día de mañana la empresa deja de usarlo.

### 5. Pedir una demostración (`/demostracion`)
La única acción de toda la página. Cómo funciona por dentro, en §5.

### 6. Privacidad y términos (`/privacidad`, `/terminos`)
Los de **esta página**, no los del producto. Hacen falta el día que la página recoja un dato
de contacto. Los redacta quien corresponda; mientras no estén, la página lleva la advertencia
visible de que están en revisión.

## 5. Los datos de quien pide la demostración

Acá hay una trampa que conviene ver antes de construir nada.

**Un interesado en comprar Careonys no es un dato del producto: es un dato de CeltaTech.** El
producto guarda lo de cada empresa cliente, aislado del resto. Un interesado no es todavía
cliente de nadie, así que no tiene dónde entrar sin romper ese aislamiento.

Y no sirve la tabla que ya existe: `solicitudes` es el pedido que le entra **a una Prestadora**
—una familia pidiéndole cuidado a ella— y tiene la empresa dueña como dato obligatorio
(`prestadora_id NOT NULL`, comprobado contra la base el 2026-08-13). Meter ahí a un interesado
en el software sería inventarle un dueño que no tiene, y dejar información comercial de
CeltaTech adentro de la caja de un cliente. Va contra `CLAUDE.md` §2.

**Decisión, hasta que exista la base de CeltaTech:** la página **no guarda nada**. Ofrece
correo y WhatsApp, y con eso alcanza para el volumen de los primeros meses. Un botón flotante
de WhatsApp, como el que ya usa el resto del producto para cualquier teléfono visible
(`DESIGN_SYSTEM.md`).

Cuando exista la base de CeltaTech (Nivel 1, ver `celtatech/docs/ARQUITECTURA_NIVELES.md`), el
formulario escribe ahí y en ningún otro lado.

## 6. Precios: la estructura sí, los números no

La forma de cobrar ya está definida en `celtatech/docs/MODELO_COMERCIAL_CELTATECH.md` §2.4:
un **abono fijo** que incluye una cantidad de pacientes atendidos, más un **precio por cada
paciente que pase de esa cantidad**. Se cuenta el paciente que efectivamente recibió cuidado
en el mes, no el que figura en una lista.

Esa parte se puede contar, y conviene contarla: explica sola por qué una empresa de cinco
pacientes no paga lo mismo que una de doscientos, y evita la primera llamada perdida.

**Los números todavía no existen** — el mismo documento los deja anotados como pendientes de
decisión (§7.1: cuánto es el abono, cuántos pacientes incluye, cuánto el adicional). Hasta que
estén, la página muestra la estructura y dice **"a consultar"** donde iría el importe. Cuando
haya números, salen de configuración, nunca escritos adentro de la página (`CLAUDE.md` §7
regla 1).

## 7. Idiomas y direcciones

- Un idioma, una dirección: `/es-AR/...`, `/en/...`, `/pt-BR/...`. Cada idioma con dirección
  propia es lo que permite que los buscadores lo encuentren; el idioma resuelto en el
  navegador, como hace hoy la página de obra, sirve para una sola página y no para un sitio.
- Idioma por defecto: español de Argentina.
- Las tres aplicaciones ya tienen su dirección y no se tocan: `gestion.careonys.com`,
  `familias.careonys.com`, `asistentes.careonys.com`. La página pública vive en la raíz,
  `careonys.com`.
- **Hoy la página está tapada para los buscadores a propósito** (`noindex`), y cualquier
  dirección del dominio muestra la misma página de obra. Las dos cosas se sacan el mismo día
  que se publica el sitio de verdad: una página "en construcción" indexada es una primera
  impresión que después cuesta corregir.

## 8. Cómo está hecha hoy, y con qué se sigue

**Estado real, comprobado el 2026-08-13.** Existe `sitio-web/`, con siete archivos:
una sola página estática (`index.html`), un armador (`construir.mjs`) que reemplaza los
marcadores del nombre del producto, el ícono que toma del Panel, y la carpeta `dist/` que se
publica. No hay React, ni Vite, ni ninguna dependencia. Se publica a mano:

```bash
node sitio-web/construir.mjs && npx wrangler pages deploy sitio-web/dist --project-name=careonys-sitio
```

**No está en el automatismo de publicación.** `publicar-pantallas.yml` cubre el Panel y las
dos aplicaciones, y nada más (comprobado: sus rutas son `panel/`, `pwa-familias/` y
`pwa-asistentes/`). Mientras haya una sola página de obra no molesta; el día que el sitio
tenga contenido que se actualice, publicar a mano es la forma segura de que una corrección se
quede sin publicar.

**Con qué se construye el sitio de verdad.** El requisito es uno solo y no es negociable: el
texto tiene que llegar ya escrito desde el servidor, para que los buscadores lo lean (§2).
Cumplen con eso tanto un armador de páginas estáticas como lo que ya hay. **La recomendación
es estirar lo que ya está** —páginas estáticas sin framework— y recién traer una herramienta
si el sitio crece más allá de estas seis páginas: hoy ya resuelve el nombre del producto, ya
publica, y no suma nada nuevo que aprender ni que mantener. La decisión anterior de usar
Next.js quedó sin efecto junto con el documento que la contenía; si se retoma, se retoma por
un motivo nuevo y escrito.

**Dos cosas para hacer junto con el sitio:** meterlo en el automatismo de publicación, y
sacarle el `noindex` (§7).

## 9. La otra pregunta del pendiente #104: ¿y el sitio de cada Prestadora?

El pendiente pedía decidir si el sitio que **sí** le habla a las familias —el de cada empresa
de cuidados, con sus servicios y su teléfono— es una función de Careonys, algo que cada
empresa se arregla por su cuenta, o nada.

**Respuesta: no es una función de Careonys.** Por tres motivos:

1. **Es otro oficio.** Careonys ordena una operación de cuidado. Armar y hospedar páginas web
   es otra cosa, y la empresa ya tiene otros productos en ese terreno. Meterlo acá adentro
   sería mezclar dos productos en uno.
2. **Nos haría dueños de un problema que no termina nunca.** Cada cliente querría su diseño,
   su dominio, su correo. Eso es soporte para siempre a cambio de nada.
3. **Nadie lo pidió.** No hay ni una empresa cliente todavía. Construirlo ahora sería adivinar.

**Qué se hace en su lugar:** nada. La empresa que quiera su página se la hace por su cuenta,
como hace hoy, y desde ahí manda a sus familias y a sus asistentes a las direcciones que le
damos. Si más adelante varios clientes lo piden, se trata como lo que sería —un producto
aparte, con su propia decisión comercial—, y no como una función más de éste.

## 10. Lo que falta decidir, y es del Desarrollador

1. **Los números del precio**: cuánto es el abono, cuántos pacientes incluye, cuánto el
   adicional. Sin esto la página de precios dice "a consultar"
   (`celtatech/docs/MODELO_COMERCIAL_CELTATECH.md` §7.1).
2. **Si la página muestra la estructura de precio o no muestra nada de precios.** La
   recomendación de acá es mostrarla (§6), pero es una decisión comercial.
3. **Quién es dueño de esta página.** Cuando se definieron los tres niveles, quedó escrito que
   de *"la pagina web"* del producto se ocupa CeltaTech, no el producto
   (`celtatech/docs/ARQUITECTURA_NIVELES.md`). Hoy el código vive acá, en el repositorio del
   producto, junto a las tres aplicaciones y compartiendo con ellas el nombre del producto y
   la forma de publicar. Hay que decidir si se queda o se muda — y este documento se muda con
   ella. **Mientras no se decida, se queda acá**, que es donde funciona.
4. **Cuándo se saca el cartel de obra.** Depende de tener las seis páginas escritas y los
   legales, no de una fecha.

## 11. Estado

Documento de definición, sin nada construido. La única página que existe es la de obra (§8).
Lo que sigue abierto está en `docs/PENDIENTES.md`; el porqué de este cambio de rumbo, en
`docs/claude_history.md`.

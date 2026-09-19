// ---------------------------------------------------------------------------
// verificar_idioma_del_formato.mjs — que ninguna fecha ni importe lleve el
// idioma escrito adentro
//
// Uso, desde la raíz del repo:
//   node scripts/verificar_idioma_del_formato.mjs
//
// QUÉ REVISA
//   1. Que nadie le pase un idioma escrito a mano a una función que da forma a
//      una fecha, una hora o un número: `toLocaleDateString('es-AR')`,
//      `new Intl.NumberFormat('en')`, y las demás de la familia.
//   2. Que el único permiso —un documento que va en un idioma fijo— esté
//      declarado como corresponde: una constante `IDIOMA_DEL_DOCUMENTO`, una
//      sola vez por archivo, con el motivo escrito arriba en un comentario.
//   3. Que la plata se le pida a la función que sabe darle forma y no se
//      arme suelta en cada pantalla.
//
// POR QUÉ EXISTE
//   Una fecha y un importe son texto visible igual que una etiqueta. Con el
//   idioma clavado adentro, la pantalla en inglés muestra «08/12/2026»
//   queriendo decir el 12 de agosto, y un número con el punto y la coma dados
//   vuelta se lee como otra cifra. No falla, no avisa: dice otra cosa.
//
//   El día que se escribió este chequeo había cinco lugares así. Cuatro eran
//   documentos que se firman y se entregan, redactados en castellano de punta a
//   punta: ahí el idioma fijo estaba bien, lo que estaba mal era que estuviera
//   suelto en cada función en vez de declarado una vez. El quinto era una
//   pantalla del Panel, y ése mostraba mal de verdad.
//
// CÓMO SE EXCEPTÚA UN CASO LEGÍTIMO — y esto no está escondido, es la única
// manera y está acá escrita:
//   Un papel que se firma no cambia de idioma con quien lo mira. Cuando un
//   archivo arma un documento así, declara arriba de todo:
//
//       // POR QUÉ ESTE DOCUMENTO VA EN UN IDIOMA FIJO: ...el motivo...
//       export const IDIOMA_DEL_DOCUMENTO = 'es-AR';
//
//   y de ahí en más usa ese nombre en vez del literal. No hay lista de archivos
//   perdonados que alguien tenga que mantener: el permiso se pide en el archivo
//   mismo, al lado del motivo, y se lee junto con el código que lo usa.
//
// CUANDO ESTE PROGRAMA FALLA
//   Dice archivo, renglón y el trozo de código. Se arregla de una de dos
//   maneras: si lo que se muestra va en pantalla, el idioma sale de `locale`
//   —el que da `useLocale()`—; si es un documento de idioma fijo, se declara la
//   constante de arriba.
//
// LO QUE NO REVISA, A PROPÓSITO
//   - La llamada sin ningún argumento —`new Date(x).toLocaleDateString()`—, que
//     hoy aparece unas cuarenta veces. Ésa no lleva el idioma escrito adentro:
//     toma el del navegador. Es un tema aparte, más grande, y meterlo acá
//     haría que este chequeo marque cuarenta renglones el primer día y no lo
//     mire nadie.
//   - Si la fecha está bien calculada. Esto mira en qué idioma se escribe, no
//     qué día dice.
//   - `sitio-web/`, que no tiene ni catálogo de frases ni idioma elegido por
//     quien mira.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// Dónde se mira: lo que se le muestra a alguien o lo que arma un documento.
const CARPETAS = [
  'backend/src',
  'panel/src',
  'pwa-familias/src',
  'pwa-asistentes/src',
];

// Lo que no se abre nunca, aunque quede adentro de una carpeta que sí se mira.
// Las dos primeras son cajas fuertes y no se leen ni para verificar algo; las
// demás son código ajeno o construido.
const NO_SE_ABREN = new Set([
  'No hacer commit', 'no_commit', 'No commit', 'NO HACER COMMIT', 'no pushear',
  'ReferenciaNoHacerCommit',
  'node_modules', '.git', '.github', '.claude', '.temp', 'dist', 'build',
  'coverage', '__tests__',
]);
const esCajaFuerte = (nombre) => /^Exclusivo /i.test(nombre) || NO_SE_ABREN.has(nombre);

const EXTENSIONES = new Set(['.js', '.jsx', '.ts', '.tsx']);

// ── Los detectores ─────────────────────────────────────────────────────────

// El idioma escrito a mano: la función de formato seguida de una comilla. Si le
// pasan una variable no casa, que es justamente lo que se quiere. El `[` del
// medio es por la forma con lista —`Intl.DateTimeFormat(['pt-BR'])`—.
const IDIOMA_ESCRITO =
  /\b(?:toLocaleDateString|toLocaleTimeString|toLocaleString|Intl\.[A-Za-z]+)\s*\(\s*(?:\[\s*)?(?:'[^'\n]*'|"[^"\n]*"|`[^`\n$]*`)/;

// La declaración del permiso, y el comentario que tiene que estar arriba.
const DECLARA_IDIOMA_FIJO = /^\s*(?:export\s+)?const\s+IDIOMA_DEL_DOCUMENTO\s*=/;

// La plata armada a mano en vez de pedírsela a `formatearImporte`.
const IMPORTE_A_MANO = /style\s*:\s*(?:'currency'|"currency")/;

// Los tres lugares donde sí se arma un importe, con el motivo al lado. Es una
// lista corta a propósito: si se hace larga, lo que hay que revisar es por qué
// tanta pantalla le da forma a la plata por su cuenta.
const IMPORTES_DECLARADOS = new Map([
  ['panel/src/lib/dinero.js',
   'es el punto único: la función que todos usan para mostrar plata.'],
  ['pwa-familias/src/lib/dinero.js',
   'es la copia declarada del punto único (ver scripts/copias_entre_apps.mjs).'],
  ['panel/src/lib/generarDocumentoCese.js',
   'arma papeles que se firman, en idioma fijo; el punto único da forma en el idioma de quien mira, que acá no sirve.'],
]);

// ── El recorrido ───────────────────────────────────────────────────────────

const rutaCorta = (ruta) => relative(RAIZ, ruta).replaceAll('\\', '/');

function archivosDe(carpeta, encontrados = []) {
  for (const entrada of readdirSync(carpeta)) {
    if (esCajaFuerte(entrada)) continue;
    const ruta = join(carpeta, entrada);
    if (statSync(ruta).isDirectory()) archivosDe(ruta, encontrados);
    else if (EXTENSIONES.has(extname(entrada))) encontrados.push(ruta);
  }
  return encontrados;
}

const conIdiomaEscrito = [];
const permisosMalDeclarados = [];
const importesSueltos = [];

for (const carpeta of CARPETAS) {
  for (const ruta of archivosDe(join(RAIZ, carpeta))) {
    const corta = rutaCorta(ruta);
    const renglones = readFileSync(ruta, 'utf8').split('\n');

    let declaraciones = 0;
    renglones.forEach((renglon, i) => {
      const limpio = renglon.trimStart();
      const esComentario = limpio.startsWith('//') || limpio.startsWith('*');

      if (DECLARA_IDIOMA_FIJO.test(renglon)) {
        declaraciones += 1;
        // El motivo va arriba, y tiene que estar escrito. Se acepta cualquier
        // comentario en los cinco renglones de encima: lo que importa es que
        // quien lea el archivo se encuentre la razón antes que la constante.
        const encima = renglones.slice(Math.max(0, i - 6), i).map((r) => r.trimStart());
        const hayMotivo = encima.some((r) => (r.startsWith('//') || r.startsWith('*')) && r.length > 12);
        if (!hayMotivo) {
          permisosMalDeclarados.push(
            `${corta}:${i + 1} declara IDIOMA_DEL_DOCUMENTO sin decir arriba por qué ese documento va en un idioma fijo.`,
          );
        }
        return;
      }

      if (esComentario) return;

      if (IDIOMA_ESCRITO.test(renglon)) {
        conIdiomaEscrito.push(`${corta}:${i + 1}  ${limpio.slice(0, 96)}`);
      }
      if (IMPORTE_A_MANO.test(renglon) && !IMPORTES_DECLARADOS.has(corta)) {
        importesSueltos.push(`${corta}:${i + 1}  ${limpio.slice(0, 96)}`);
      }
    });

    if (declaraciones > 1) {
      permisosMalDeclarados.push(
        `${corta} declara IDIOMA_DEL_DOCUMENTO ${declaraciones} veces. Va una sola, arriba de todo.`,
      );
    }
  }
}

// ── Que el detector siga viendo ────────────────────────────────────────────
// Un detector que dejó de casar con nada da siempre en verde, y una prueba que
// no puede fallar no prueba nada. Estas dos listas lo prueban contra código
// escrito a mano: las de arriba tienen que doler y las de abajo no.

const TIENE_QUE_DOLER = [
  "  return new Intl.DateTimeFormat('es-AR', { day: '2-digit' }).format(f);",
  '  return new Intl.NumberFormat("en", {}).format(n);',
  "  return new Intl.DateTimeFormat(['pt-BR'], {}).format(f);",
  "  return new Date(f).toLocaleDateString('es-AR');",
  "  return valor.toLocaleString('es-AR');",
  '  return fecha.toLocaleTimeString(`en`);',
];
const NO_TIENE_QUE_DOLER = [
  '  return new Intl.DateTimeFormat(locale, { day: "2-digit" }).format(f);',
  '  return new Date(f).toLocaleDateString(IDIOMA_DEL_DOCUMENTO);',
  '  return numero.toLocaleString(locale, { style: "currency", currency: moneda });',
  '  return new Date(f).toLocaleDateString();',
  "  const IDIOMA_DEL_DOCUMENTO = 'es-AR';",
  "  const zonas = paises.map((p) => p.codigo).join(', ');",
];

const detectorRoto = [];
for (const renglon of TIENE_QUE_DOLER) {
  if (!IDIOMA_ESCRITO.test(renglon)) detectorRoto.push(`dejó de ver:      ${renglon.trim()}`);
}
for (const renglon of NO_TIENE_QUE_DOLER) {
  if (IDIOMA_ESCRITO.test(renglon)) detectorRoto.push(`se queja de más:  ${renglon.trim()}`);
}

// ── Lo que se dice al terminar ─────────────────────────────────────────────

function informar(titulo, hallazgos, explicacion) {
  if (!hallazgos.length) return false;
  console.error(`\n${titulo}`);
  for (const h of hallazgos) console.error(`  - ${h}`);
  console.error(`  ${explicacion}`);
  return true;
}

const falla1 = informar(
  'El detector de este chequeo se rompió:',
  detectorRoto,
  'Mientras esté así, este programa da verde sin haber mirado nada.',
);
const falla2 = informar(
  'Hay fechas, horas o importes con el idioma escrito adentro:',
  conIdiomaEscrito,
  'En pantalla, el idioma sale de `locale`. En un documento de idioma fijo, de IDIOMA_DEL_DOCUMENTO declarado arriba con su motivo.',
);
const falla3 = informar(
  'Hay un permiso de idioma fijo mal declarado:',
  permisosMalDeclarados,
  'La constante va una sola vez por archivo y con el motivo escrito arriba, para que se lea junto con el código que la usa.',
);
const falla4 = informar(
  'Hay importes con forma armada fuera del punto único:',
  importesSueltos,
  'La plata se muestra con `formatearImporte(monto, moneda, locale)` de lib/dinero.js. Si este archivo tiene un motivo para no usarla, va en IMPORTES_DECLARADOS de este guion, con el motivo al lado.',
);

if (falla1 || falla2 || falla3 || falla4) process.exit(1);

console.log('Ninguna fecha ni importe lleva el idioma escrito adentro.');

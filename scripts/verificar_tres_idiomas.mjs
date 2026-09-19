// ---------------------------------------------------------------------------
// verificar_tres_idiomas.mjs — que el catálogo de frases esté entero y que
// ninguna frase diga lo mismo en los tres idiomas
//
// Uso, desde la raíz del repo:
//   node scripts/verificar_tres_idiomas.mjs
//
// QUÉ REVISA, en los catálogos de las tres aplicaciones
//   1. Que el catálogo tenga los tres idiomas: `es-AR`, `en` y `pt-BR`.
//   2. Que toda frase esté en los tres y ninguna quede vacía. Una frase a medias
//      no rompe nada: se cae al castellano en silencio, y la pantalla en inglés
//      queda mitad y mitad sin que nadie se entere.
//   3. Que ninguna frase diga exactamente lo mismo en los tres idiomas. Casi
//      siempre eso quiere decir que alguien copió el castellano en las otras dos
//      columnas para llenar el hueco, y el resultado se ve igual que una
//      traducción hecha.
//
// POR QUÉ EXISTE
//   La regla de la empresa pide los tres idiomas desde el primer día, y dice por
//   qué: cada pantalla nueva escrita en un solo idioma encarece el cambio. Una
//   regla que no se verifica sola no es una regla.
//
// CÓMO SE EXCEPTÚA UN CASO LEGÍTIMO — está acá, a la vista, y no en otro lado:
//   Hay frases que se escriben igual en los tres idiomas y está bien que así
//   sea: una marca de un tercero, un nombre propio, una palabra que es la misma
//   en los tres. Van en `IGUALES_A_PROPOSITO`, unos renglones más abajo, con el
//   motivo escrito al lado. Se exceptúa **el texto**, no la clave: así, la misma
//   palabra en veinte pantallas se declara una sola vez, y el día que alguien
//   copie el castellano de una frase larga en las otras dos columnas, la
//   excepción no lo tapa.
//   Y hay un perdón automático, sin lista: la frase que después de sacarle los
//   marcadores —`{hora}`, `{{producto}}`— no deja ni dos letras. «{hora} h» es
//   igual en los tres idiomas porque casi no tiene idioma.
//
// CUANDO ESTE PROGRAMA FALLA
//   Dice la aplicación, la clave y qué le pasa. Se arregla traduciendo, o
//   declarando la excepción con su motivo.
//
// LO QUE NO REVISA, A PROPÓSITO
//   - Si la traducción es buena. Comprueba que haya texto, no que diga lo que
//     tiene que decir.
//   - Si la frase se usa en alguna pantalla. De eso se ocupa
//     `scripts/buscar_textos_huerfanos.mjs`.
//   - El catálogo de avisos del backend, que tiene otra forma y otro dueño.
// ---------------------------------------------------------------------------

import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const IDIOMAS = ['es-AR', 'en', 'pt-BR'];

// Las aplicaciones se buscan mirando la carpeta, no se anotan a mano: la que
// nazca mañana con su `src/i18n/translations.js` entra sola.
const NO_SE_ABREN = new Set([
  'No hacer commit', 'no_commit', 'No commit', 'NO HACER COMMIT', 'no pushear',
  'ReferenciaNoHacerCommit', 'node_modules', '.git', '.github', '.claude',
  '.temp', 'dist', 'build', 'coverage', 'docs', 'supabase', 'scripts',
]);
const esCajaFuerte = (nombre) => /^Exclusivo /i.test(nombre) || NO_SE_ABREN.has(nombre);

// Lo que se escribe igual en los tres idiomas y no es un descuido. Se declara el
// texto, con el motivo al lado.
const IGUALES_A_PROPOSITO = new Map([
  // Marcas de terceros: se escriben como el tercero las escribe, en todo idioma.
  ['WhatsApp', 'marca de un tercero'],
  ['Mercado Pago', 'marca de un tercero'],
  ['Stripe', 'marca de un tercero'],
  ['Modo', 'marca de un tercero'],
  // Nombre de un producto de la casa. El glosario dice que se escribe Match y
  // no se traduce.
  ['Match', 'nombre del producto, no se traduce'],
  // Nombres propios de países, que no cambian en estos tres idiomas.
  ['Argentina', 'nombre propio de país'],
  ['Chile', 'nombre propio de país'],
  // Palabras que se escriben igual en castellano, inglés y portugués.
  ['Email', 'se escribe igual en los tres idiomas'],
  ['Normal', 'se escribe igual en los tres idiomas'],
  ['Total', 'se escribe igual en los tres idiomas'],
  ['Digital', 'se escribe igual en los tres idiomas'],
  ['Marketing', 'se escribe igual en los tres idiomas'],
  ['Cheque', 'se escribe igual en los tres idiomas'],
  ['Admin', 'se escribe igual en los tres idiomas'],
  ['Superadmin', 'se escribe igual en los tres idiomas'],
  // El glosario deja estas dos en inglés a propósito, en los tres idiomas:
  // son las que usa todo el mundo en este rubro y traducirlas confundiría más.
  ['Check-in', 'el glosario lo deja en inglés en los tres idiomas'],
  ['Check-out', 'el glosario lo deja en inglés en los tres idiomas'],
]);

// ── Los detectores ─────────────────────────────────────────────────────────

// Lo que queda de una frase cuando se le sacan los marcadores. Si no llegan a
// dos letras, la frase casi no tiene idioma y no se le puede pedir que cambie.
const SIN_MARCADORES = (frase) => frase.replaceAll(/\{\{?[^}]*\}?\}/g, ' ');
const LETRAS = (frase) => (SIN_MARCADORES(frase).match(/\p{L}/gu) || []).length;

function aplanar(objeto, prefijo = '', salida = new Map()) {
  for (const [nombre, valor] of Object.entries(objeto || {})) {
    const clave = prefijo ? `${prefijo}.${nombre}` : nombre;
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) aplanar(valor, clave, salida);
    else salida.set(clave, valor);
  }
  return salida;
}

// ── El recorrido ───────────────────────────────────────────────────────────

const aplicaciones = [];
for (const entrada of readdirSync(RAIZ)) {
  if (esCajaFuerte(entrada)) continue;
  const carpeta = join(RAIZ, entrada);
  if (!statSync(carpeta).isDirectory()) continue;
  const catalogo = join(carpeta, 'src', 'i18n', 'translations.js');
  try {
    if (statSync(catalogo).isFile()) aplicaciones.push([entrada, catalogo]);
  } catch { /* esta carpeta no tiene catálogo de frases, y no todas tienen que tenerlo */ }
}

if (aplicaciones.length === 0) {
  console.error('No se encontró ningún catálogo de frases. Si se movieron de lugar, este chequeo');
  console.error('quedó mirando al vacío y desde ahora aprueba todo sin haber mirado nada.');
  process.exit(1);
}

const sinIdioma = [];
const incompletas = [];
const igualesEnLosTres = [];
let revisadas = 0;

for (const [app, catalogo] of aplicaciones) {
  const { T } = await import(new URL(`file:///${catalogo.replaceAll('\\', '/')}`));

  const faltanIdiomas = IDIOMAS.filter((i) => !T?.[i]);
  if (faltanIdiomas.length) {
    sinIdioma.push(`${app} no tiene ${faltanIdiomas.join(' ni ')} en su catálogo.`);
    continue;
  }

  const porIdioma = IDIOMAS.map((i) => aplanar(T[i]));
  const todas = new Set(porIdioma.flatMap((m) => [...m.keys()]));

  for (const clave of todas) {
    const valores = porIdioma.map((m) => m.get(clave));

    const faltan = IDIOMAS.filter((_, i) => typeof valores[i] !== 'string' || !valores[i].trim());
    if (faltan.length) {
      // Una lista de opciones no es una frase: se deja pasar si está en los tres.
      const sonListas = valores.every((v) => Array.isArray(v));
      if (!sonListas) incompletas.push(`${app}  «${clave}» no tiene ${faltan.join(' ni ')}.`);
      continue;
    }

    revisadas += 1;
    if (new Set(valores).size > 1) continue;
    const frase = valores[0];
    if (IGUALES_A_PROPOSITO.has(frase.trim())) continue;
    if (LETRAS(frase) < 2) continue;
    igualesEnLosTres.push(`${app}  «${clave}» dice lo mismo en los tres idiomas: ${JSON.stringify(frase)}`);
  }
}

// ── Que el detector siga viendo ────────────────────────────────────────────
// Una prueba que no puede fallar no prueba nada. El perdón automático es el que
// más fácil se pasa de rosca: si algún día se traga una frase entera, este
// chequeo aprueba en verde un catálogo copiado.

const CASI_SIN_IDIOMA = ['{hora} h', '{{producto}}', '{campo}: {nombre}', '—', '%', '{n}/{total}'];
const CON_IDIOMA = ['Guardia', 'No', 'Sin resultados', '{n} de {total} guardias', 'Ok'];

const detectorRoto = [];
for (const frase of CASI_SIN_IDIOMA) {
  if (LETRAS(frase) >= 2) detectorRoto.push(`el perdón automático dejó de tapar: ${JSON.stringify(frase)}`);
}
for (const frase of CON_IDIOMA) {
  if (LETRAS(frase) < 2) detectorRoto.push(`el perdón automático se tragó una frase de verdad: ${JSON.stringify(frase)}`);
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
  'El perdón automático de este chequeo se descalibró:',
  detectorRoto,
  'Mientras esté así, una frase copiada en las tres columnas pasa en verde.',
);
const falla2 = informar(
  'Hay un catálogo al que le falta un idioma entero:',
  sinIdioma,
  'El catálogo tiene las tres claves: «es-AR», «en» y «pt-BR».',
);
const falla3 = informar(
  'Hay frases que no están en los tres idiomas:',
  incompletas,
  'Una frase a medias no falla: se cae al castellano y la pantalla queda mitad y mitad.',
);
const falla4 = informar(
  'Hay frases iguales en los tres idiomas:',
  igualesEnLosTres,
  'Si es a propósito —una marca, un nombre propio, una palabra que es la misma en los tres—, va en IGUALES_A_PROPOSITO de este guion, con el motivo al lado.',
);

if (falla1 || falla2 || falla3 || falla4) process.exit(1);

console.log(
  `Los tres idiomas están completos y distintos: ${revisadas} frases en ${aplicaciones.length} aplicaciones.`,
);

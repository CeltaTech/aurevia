// ---------------------------------------------------------------------------
// verificar_identidad.mjs — el guardarraíl de la Etapa 0.5
//
// Uso, desde la raíz del repo:
//   node scripts/verificar_identidad.mjs
//
// Comprueba dos cosas y devuelve código de salida 1 si alguna falla:
//
//   1. SINCRONÍA — las 5 copias de identidadProducto.js son idénticas byte a
//      byte. Si alguien edita una sola, esto lo caza.
//
//   2. LITERAL — el nombre del producto no aparece escrito a mano en ninguna
//      parte del código. Es lo importante: sin esto, cambiar el nombre vuelve a
//      ser una cacería por todo el repo. El 2026-07-24 había 12 hardcodes
//      documentados; el 2026-07-27, sin que nadie los agregara a propósito, eran
//      más de 30. Una lista escrita a mano se desactualiza sola; un chequeo que
//      falla el build, no.
//
// QUÉ NO REVISA, a propósito:
//   - Archivos .md — la documentación nombra al producto y está bien que lo haga.
//   - Líneas que son solo comentario (//, *, --, #) — un comentario que explica
//     algo nombrando al producto se lee mejor así y no llega a ninguna pantalla.
//     Es una heurística por línea, no un parser: un comentario de bloque cuyo
//     texto arranque en la misma línea del código no se saltea.
//   - Los directorios de la lista DIRECTORIOS_IGNORADOS (dependencias, builds,
//     material que no se despliega).
//
// Cuando este script falla legítimamente porque un archivo nuevo tiene que
// nombrar al producto, la respuesta correcta casi siempre es usar el marcador
// {{producto}}, no agregar el archivo a ARCHIVOS_PERMITIDOS.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// El literal a perseguir sale de la config, no está escrito acá: si mañana el
// producto se llama distinto, este script persigue el nombre nuevo sin tocarlo.
const { IDENTIDAD } = await import(
  new URL('../backend/src/config/identidadProducto.js', import.meta.url)
);
const LITERALES = [...new Set([IDENTIDAD.nombre, IDENTIDAD.nombreCorto, IDENTIDAD.codigo])]
  .filter(Boolean)
  .map((valor) => valor.toLowerCase());

const COPIAS_IDENTIDAD = [
  'backend/src/config/identidadProducto.js',
  'panel/src/config/identidadProducto.js',
  'pwa-asistentes/src/config/identidadProducto.js',
  'pwa-familias/src/config/identidadProducto.js',
  'sitio-web/src/config/identidadProducto.js',
];

const DIRECTORIOS_IGNORADOS = new Set([
  'node_modules',
  '.git',
  '.github',        // nombres de servicio de infraestructura (Railway), no texto de producto
  '.claude',
  '.playwright-mcp',
  '.vercel',        // estado local de la CLI de Vercel, no es código del producto
  '.wrangler',      // ídem, pero de la CLI de Cloudflare — guarda el nombre del proyecto de Pages
  '.temp',          // ídem, pero de la CLI de Supabase (supabase/.temp) — está en .gitignore
  'dist',
  'build',
  'coverage',
  'docs',
  'No hacer commit',
]);

const EXTENSIONES_REVISADAS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.html', '.json', '.css', '.sql', '.yml', '.yaml',
]);

// Única lista blanca. Que sea corta es la señal de que la etapa está bien hecha.
const ARCHIVOS_PERMITIDOS = new Set([
  ...COPIAS_IDENTIDAD,
  'scripts/verificar_identidad.mjs',
  'scripts/sincronizar_identidad.mjs',
]);

const INICIOS_DE_COMENTARIO = ['//', '*', '/*', '--', '#'];

function esLineaDeComentario(linea) {
  const limpia = linea.trimStart();
  return INICIOS_DE_COMENTARIO.some((inicio) => limpia.startsWith(inicio));
}

function* recorrer(directorio) {
  for (const entrada of readdirSync(directorio)) {
    if (DIRECTORIOS_IGNORADOS.has(entrada)) continue;
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) {
      yield* recorrer(ruta);
    } else if (EXTENSIONES_REVISADAS.has(extname(entrada))) {
      yield ruta;
    }
  }
}

// --- 1. Sincronía de las 4 copias ------------------------------------------

const fallasSincronia = [];
const original = readFileSync(join(RAIZ, COPIAS_IDENTIDAD[0]), 'utf8');
for (const ruta of COPIAS_IDENTIDAD.slice(1)) {
  if (readFileSync(join(RAIZ, ruta), 'utf8') !== original) {
    fallasSincronia.push(ruta);
  }
}

// --- 2. El literal escrito a mano ------------------------------------------

const fallasLiteral = [];
for (const rutaAbsoluta of recorrer(RAIZ)) {
  const rutaRelativa = relative(RAIZ, rutaAbsoluta).split(sep).join('/');
  if (ARCHIVOS_PERMITIDOS.has(rutaRelativa)) continue;

  const lineas = readFileSync(rutaAbsoluta, 'utf8').split(/\r?\n/);
  lineas.forEach((linea, indice) => {
    if (esLineaDeComentario(linea)) return;
    const enMinuscula = linea.toLowerCase();
    if (LITERALES.some((literal) => enMinuscula.includes(literal))) {
      fallasLiteral.push({ ruta: rutaRelativa, numero: indice + 1, texto: linea.trim() });
    }
  });
}

// --- Informe ----------------------------------------------------------------

if (fallasSincronia.length > 0) {
  console.error('\n✗ Las copias de identidadProducto.js no coinciden con la original:\n');
  for (const ruta of fallasSincronia) console.error(`    ${ruta}`);
  console.error('\n  Se edita siempre backend/src/config/identidadProducto.js y después se corre:');
  console.error('    node scripts/sincronizar_identidad.mjs\n');
}

if (fallasLiteral.length > 0) {
  console.error(`\n✗ El nombre del producto está escrito a mano en ${fallasLiteral.length} lugar(es):\n`);
  let archivoAnterior = null;
  for (const falla of fallasLiteral) {
    if (falla.ruta !== archivoAnterior) {
      console.error(`  ${falla.ruta}`);
      archivoAnterior = falla.ruta;
    }
    const recorte = falla.texto.length > 110 ? `${falla.texto.slice(0, 110)}…` : falla.texto;
    console.error(`    ${String(falla.numero).padStart(5)}  ${recorte}`);
  }
  console.error('\n  Usar el marcador {{producto}} (o {{productoCorto}} / {{dominio}}) y dejar que');
  console.error('  identidadProducto.js lo resuelva. Ver PLAN_SEPARACION_CELTATECH.md, Etapa 0.5.\n');
}

if (fallasSincronia.length === 0 && fallasLiteral.length === 0) {
  console.log('✓ Identidad del producto: 5 copias sincronizadas y ningún nombre escrito a mano.');
  process.exit(0);
}

process.exit(1);

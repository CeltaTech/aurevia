// ---------------------------------------------------------------------------
// verificar_identidad.mjs — el guardarraíl de la Etapa 0.5
//
// Uso, desde la raíz del repo:
//   node scripts/verificar_identidad.mjs
//
// Comprueba dos cosas y devuelve código de salida 1 si alguna falla:
//
//   1. SINCRONÍA — los archivos que existen repetidos en varias carpetas son
//      idénticos byte a byte a su original. Si alguien edita una sola copia,
//      esto lo caza. La lista de cuáles son está en copias_entre_apps.mjs.
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

import { GRUPOS, TODAS_LAS_RUTAS, copiasDespegadas } from './copias_entre_apps.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// El literal a perseguir sale de la config, no está escrito acá: si mañana el
// producto se llama distinto, este script persigue el nombre nuevo sin tocarlo.
const { IDENTIDAD } = await import(
  new URL('../backend/src/config/identidadProducto.js', import.meta.url)
);
const LITERALES = [...new Set([IDENTIDAD.nombre, IDENTIDAD.nombreCorto, IDENTIDAD.codigo])]
  .filter(Boolean)
  .map((valor) => valor.toLowerCase());

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
  ...TODAS_LAS_RUTAS,
  'scripts/verificar_identidad.mjs',
  'scripts/sincronizar_copias.mjs',
  'scripts/copias_entre_apps.mjs',
]);

const INICIOS_DE_COMENTARIO = ['//', '*', '/*', '--', '#'];

function esLineaDeComentario(linea) {
  const limpia = linea.trimStart();
  return INICIOS_DE_COMENTARIO.some((inicio) => limpia.startsWith(inicio));
}

// Las claves de entitlement (`aurevia.marca.personalizada`) son identificadores
// guardados: se nombran una vez y no se renombran nunca, ni aunque la marca
// cambie (CLAUDE.md §7, regla 13, y la excepción escrita en el glosario, §4).
// En JavaScript se arman con IDENTIDAD.codigo; en un archivo .sql no se puede,
// porque una migración no importa código. Ahí van escritas, y este chequeo las
// deja pasar: lo que persigue es la marca visible en una pantalla, no un
// identificador que ya está guardado adentro de datos que existen.
const CLAVE_DE_ENTITLEMENT = new RegExp(`\\b${IDENTIDAD.codigo}(\\.[a-z0-9_]+)+`, 'gi');

function sinClavesDeEntitlement(linea, rutaRelativa) {
  if (extname(rutaRelativa) !== '.sql') return linea;
  return linea.replace(CLAVE_DE_ENTITLEMENT, '');
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

// --- 1. Sincronía de los archivos repetidos --------------------------------

const fallasSincronia = copiasDespegadas();

// --- 2. El literal escrito a mano ------------------------------------------

const fallasLiteral = [];
for (const rutaAbsoluta of recorrer(RAIZ)) {
  const rutaRelativa = relative(RAIZ, rutaAbsoluta).split(sep).join('/');
  if (ARCHIVOS_PERMITIDOS.has(rutaRelativa)) continue;

  const lineas = readFileSync(rutaAbsoluta, 'utf8').split(/\r?\n/);
  lineas.forEach((linea, indice) => {
    if (esLineaDeComentario(linea)) return;
    const enMinuscula = sinClavesDeEntitlement(linea, rutaRelativa).toLowerCase();
    if (LITERALES.some((literal) => enMinuscula.includes(literal))) {
      fallasLiteral.push({ ruta: rutaRelativa, numero: indice + 1, texto: linea.trim() });
    }
  });
}

// --- Informe ----------------------------------------------------------------

if (fallasSincronia.length > 0) {
  console.error('\n✗ Hay copias que no coinciden con su original:\n');
  for (const falla of fallasSincronia) {
    console.error(`    ${falla.copia}`);
    console.error(`      (${falla.que} — el original es ${falla.original})`);
  }
  console.error('\n  Se edita siempre el original y después se corre:');
  console.error('    node scripts/sincronizar_copias.mjs\n');
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
  console.error('  identidadProducto.js lo resuelva. Ver celtatech/docs/PLAN_SEPARACION_CELTATECH.md, Etapa 0.5.\n');
}

if (fallasSincronia.length === 0 && fallasLiteral.length === 0) {
  // El número se cuenta, no se escribe: agregar un grupo a copias_entre_apps.mjs no tiene que
  // obligar a acordarse de corregir este cartel.
  const cuantasCopias = GRUPOS.reduce((total, g) => total + g.copias.length, 0);
  console.log(
    `✓ ${cuantasCopias} copias sincronizadas (${GRUPOS.length} grupos) y ningún nombre del producto escrito a mano.`
  );
  process.exit(0);
}

process.exit(1);

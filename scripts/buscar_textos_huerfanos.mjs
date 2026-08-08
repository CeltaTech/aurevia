// ---------------------------------------------------------------------------
// buscar_textos_huerfanos.mjs — el guardarraíl de los textos traducidos
//
// Uso, desde la raíz del repo:
//   node scripts/buscar_textos_huerfanos.mjs
//
// Revisa dos cosas y devuelve código de salida 1 si alguna falla:
//
//   1. Textos huérfanos: claves escritas en los tres idiomas que ninguna
//      pantalla usa. Sobran.
//   2. Textos a medio traducir: claves que están en un idioma y no en los otros
//      dos. Faltan. Es la regla 2 del §7 de CLAUDE.md —toda clave nueva se
//      agrega a la vez en es-AR, en y pt-BR— comprobada en vez de recordada.
//      El agujero que tapa es silencioso: la pantalla no se rompe, simplemente
//      le muestra un hueco a quien la está mirando en su idioma.
//
// Por qué existe: el 2026-08-03 había 54 claves así. Una traducción muerta no
// rompe nada —por eso nadie la ve— pero engaña: se lee como una función que
// existe cuando en realidad no está construida, y cada idioma nuevo obliga a
// traducirla de nuevo. Una lista escrita a mano se desactualiza sola; un
// chequeo que falla el build, no. Es el pendiente #114.
//
// Cuando este script falla, hay exactamente dos respuestas correctas:
//   - construir la pantalla que usa ese texto, o
//   - borrar el texto de los tres idiomas.
// Nunca "agregarlo a una lista de excepciones": esa lista sería el problema
// de vuelta.
//
// CÓMO RECONOCE QUE UNA CLAVE ESTÁ VIVA. Tres formas, porque el código no
// siempre escribe la clave entera:
//   1. El nombre de la hoja aparece tal cual en el código.
//   2. La clave se arma al vuelo, `traducirValor(t.guardias, `estado_${x}`)`.
//      Se juntan todos los comienzos que aparecen en el código (`estado_`,
//      `nivel_`…) y se da por viva toda clave que empiece con alguno.
//   3. El grupo entero se pasa como un paquete,
//      `Object.entries(t.postulaciones.disponibilidad_labels)`. Ahí las hojas
//      están vivas aunque ninguna aparezca escrita.
// Los tres coladores son anchos a propósito: dejar pasar una clave muerta es
// mucho menos grave que hacer borrar una viva.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const APPS = [
  { nombre: 'panel', src: 'panel/src', trad: 'panel/src/i18n/translations.js' },
  { nombre: 'pwa-familias', src: 'pwa-familias/src', trad: 'pwa-familias/src/i18n/translations.js' },
  { nombre: 'pwa-asistentes', src: 'pwa-asistentes/src', trad: 'pwa-asistentes/src/i18n/translations.js' },
];

function archivosDe(dir) {
  const salida = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivosDe(ruta));
    else if (['.js', '.jsx', '.html'].includes(extname(nombre))) salida.push(ruta);
  }
  return salida;
}

/* Recorre el objeto de textos y devuelve una lista de { camino, hoja, grupo }.
   `camino` es "asistentes.vinculo_monotributo"; `hoja` es la última parte. */
function hojas(obj, prefijo = []) {
  const salida = [];
  for (const [clave, valor] of Object.entries(obj)) {
    const camino = [...prefijo, clave];
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) salida.push(...hojas(valor, camino));
    else salida.push({ camino: camino.join('.'), hoja: clave, grupo: prefijo.join('.') || '(raíz)' });
  }
  return salida;
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let huboHuerfanas = false;
let huboFaltantes = false;

for (const app of APPS) {
  const rutaTrad = join(RAIZ, app.trad);
  let T;
  try {
    ({ T } = await import(pathToFileURL(rutaTrad).href));
  } catch (e) {
    console.log(`\n### ${app.nombre}: no se pudo leer ${app.trad} — ${e.message}`);
    huboHuerfanas = true;
    continue;
  }

  const base = T['es-AR'] ?? T.es ?? Object.values(T)[0];
  const claves = hojas(base);

  /* Revisión 2: los tres idiomas tienen que tener exactamente las mismas claves. Se compara
     contra es-AR, que es el idioma en el que se escribe primero. Faltar en uno y sobrar en
     otro son el mismo error visto desde los dos lados, así que se informan los dos. */
  const caminosBase = new Set(claves.map((c) => c.camino));
  for (const idioma of Object.keys(T)) {
    if (T[idioma] === base) continue;
    const caminosOtro = new Set(hojas(T[idioma]).map((c) => c.camino));
    const faltan = [...caminosBase].filter((c) => !caminosOtro.has(c));
    const sobran = [...caminosOtro].filter((c) => !caminosBase.has(c));
    if (faltan.length === 0 && sobran.length === 0) continue;
    huboFaltantes = true;
    console.log(`\n### ${app.nombre} · ${idioma}: no coincide con es-AR`);
    if (faltan.length > 0) console.log(`  falta traducir (${faltan.length}): ${faltan.join(', ')}`);
    if (sobran.length > 0) console.log(`  está de más (${sobran.length}): ${sobran.join(', ')}`);
  }

  // Todo el código de la aplicación, menos el propio archivo de textos.
  const fuentes = archivosDe(join(RAIZ, app.src))
    .filter((r) => !r.replaceAll('\\', '/').endsWith('i18n/translations.js'))
    .map((r) => readFileSync(r, 'utf8'))
    .join('\n');

  // Forma 2: los comienzos de clave que el código arma al vuelo.
  const comienzos = new Set();
  for (const re of [/`([a-z0-9_]+_)\$\{/g, /'([a-z0-9_]+_)'\s*\+/g, /"([a-z0-9_]+_)"\s*\+/g]) {
    for (const m of fuentes.matchAll(re)) comienzos.add(m[1]);
  }

  /* Forma 3: los grupos que se usan enteros. Se reconoce por el camino completo desde `t.`,
     no por el nombre suelto del grupo: hay mucho `evento.detalle` y `fila.detalle` dando
     vueltas que no tienen nada que ver con los textos. Y se descarta `traducirValor(t.grupo, …)`,
     que no usa el grupo entero sino una hoja armada al vuelo — ese caso ya lo cubre la forma 2. */
  const grupoEnteroUsado = (grupo) => {
    if (grupo === '(raíz)') return false;
    const re = new RegExp(`(.{0,16})\\bt\\.${escapar(grupo)}\\s*(?![A-Za-z0-9_.[(])`, 'g');
    for (const m of fuentes.matchAll(re)) if (!m[1].includes('traducirValor(')) return true;
    return false;
  };
  const gruposEnteros = new Set();
  for (const { grupo } of claves) if (!gruposEnteros.has(grupo) && grupoEnteroUsado(grupo)) gruposEnteros.add(grupo);

  const huerfanas = claves.filter(({ hoja, grupo }) => {
    const re = new RegExp(`(^|[^A-Za-z0-9_])${escapar(hoja)}([^A-Za-z0-9_]|$)`);
    if (re.test(fuentes)) return false;
    for (const c of comienzos) if (hoja.startsWith(c)) return false;
    if (gruposEnteros.has(grupo)) return false;
    return true;
  });

  if (huerfanas.length === 0) {
    console.log(`### ${app.nombre}: sin textos huérfanos (${claves.length} claves)`);
    continue;
  }

  huboHuerfanas = true;
  console.log(`\n### ${app.nombre}: ${huerfanas.length} textos huérfanos de ${claves.length} claves`);
  const porGrupo = {};
  for (const h of huerfanas) (porGrupo[h.grupo] ??= []).push(h.hoja);
  for (const [grupo, lista] of Object.entries(porGrupo).sort()) {
    console.log(`  ${grupo}: ${lista.join(', ')}`);
  }
}

if (huboFaltantes) {
  console.log('\nHay claves que no están en los tres idiomas.');
  console.log('Se escribe el texto que falta, o se borra la clave de los idiomas donde sí está.');
}

if (huboHuerfanas) {
  console.log('\nHay textos traducidos que ninguna pantalla usa.');
  console.log('Se construye la pantalla que los usa, o se borran de los tres idiomas.');
}

if (huboHuerfanas || huboFaltantes) process.exit(1);

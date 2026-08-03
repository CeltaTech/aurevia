/* Busca lo que quedó a mitad de camino o escondido en las tres aplicaciones.
   Tres barridos mecánicos, sin criterio ni memoria de por medio:
     1. Textos traducidos que ninguna pantalla usa  -> función a medio construir o a medio borrar.
     2. Direcciones del backend que ningún frontend llama -> puerta sin picaporte.
     3. Pantallas con dirección propia a las que no lleva ningún enlace -> escondidas. */
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = 'F:/proyectos/celtatech/productos/aurevia';
const APPS = ['panel', 'pwa-familias', 'pwa-asistentes'];

function archivosDe(dir, exts = ['.js', '.jsx']) {
  const salida = [];
  if (!fs.existsSync(dir)) return salida;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...archivosDe(p, exts));
    else if (exts.includes(path.extname(e.name))) salida.push(p);
  }
  return salida;
}

/* ---------- 1. Textos que nadie usa ---------- */
const textosHuerfanos = {};
for (const app of APPS) {
  const fTrad = path.join(RAIZ, app, 'src/i18n/translations.js');
  if (!fs.existsSync(fTrad)) continue;
  const trad = fs.readFileSync(fTrad, 'utf8');

  // Las claves hoja: `nombre_de_clave:` seguido de un texto entre comillas.
  const claves = new Set();
  for (const m of trad.matchAll(/^\s{4,}([a-z][a-z0-9_]*)\s*:\s*['"`]/gm)) claves.add(m[1]);

  // Todo el código de la app menos el archivo de traducciones.
  const codigo = archivosDe(path.join(RAIZ, app, 'src'))
    .filter((f) => !f.endsWith('translations.js'))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  const sinUsar = [...claves].filter((c) => {
    // Se busca `.clave` y `['clave']` y `clave:` usado como variable de plantilla.
    const re = new RegExp(`[.\\[']${c}\\b`);
    return !re.test(codigo);
  });
  textosHuerfanos[app] = sinUsar.sort();
}

/* ---------- 2. Direcciones del backend que nadie llama ---------- */
const rutasBackend = [];
for (const f of archivosDe(path.join(RAIZ, 'backend/src/routes'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]*)/g)) {
    rutasBackend.push({ archivo: path.basename(f), metodo: m[1].toUpperCase(), ruta: m[2] });
  }
}
const codigoFrontends = APPS.flatMap((a) => archivosDe(path.join(RAIZ, a, 'src')))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

/* Comparación apretada: no alcanza con que las palabras de la dirección aparezcan
   sueltas por ahí (`guardias` aparece en todos lados). Se busca el tramo fijo más
   largo de la dirección, tal cual, pegado. Por ejemplo de
   `/guardias/:id/reporte/confirmar` se busca el texto `reporte/confirmar`. */
const rutasSinLlamar = rutasBackend.filter(({ ruta }) => {
  const partes = ruta.split('/').filter(Boolean);
  const tramos = [];
  let actual = [];
  for (const p of partes) {
    if (p.startsWith(':')) {
      if (actual.length) tramos.push(actual);
      actual = [];
    } else actual.push(p);
  }
  if (actual.length) tramos.push(actual);
  if (tramos.length === 0) return false;
  // El tramo más largo; si empatan, el último (suele ser el más específico).
  let mejor = tramos[0];
  for (const t of tramos) if (t.length >= mejor.length) mejor = t;
  return !codigoFrontends.includes(mejor.join('/'));
});

/* ---------- 3. Pantallas a las que no lleva ningún enlace ---------- */
const pantallasEscondidas = {};
for (const app of APPS) {
  const fApp = path.join(RAIZ, app, 'src/App.jsx');
  if (!fs.existsSync(fApp)) continue;
  const src = fs.readFileSync(fApp, 'utf8');
  const rutas = [...src.matchAll(/<Route\s+path=["']([^"']+)["']/g)].map((m) => m[1]);

  const codigo = archivosDe(path.join(RAIZ, app, 'src'))
    .filter((f) => !f.endsWith('App.jsx'))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  pantallasEscondidas[app] = rutas.filter((r) => {
    if (r === '*' || r === '/' || r.includes(':')) return false;
    const limpia = r.replace(/^\//, '');
    return !codigo.includes(limpia);
  });
}

/* ---------- Informe ---------- */
const lineas = [];
lineas.push('1. TEXTOS TRADUCIDOS QUE NINGUNA PANTALLA USA');
for (const [app, claves] of Object.entries(textosHuerfanos)) {
  lineas.push(`\n  ${app}: ${claves.length}`);
  if (claves.length) lineas.push('    ' + claves.join(', '));
}
lineas.push('\n\n2. DIRECCIONES DEL BACKEND QUE NINGUN FRONTEND LLAMA');
lineas.push(`  total de direcciones: ${rutasBackend.length} — sin llamar: ${rutasSinLlamar.length}`);
for (const r of rutasSinLlamar) lineas.push(`    ${r.metodo.padEnd(6)} ${r.ruta.padEnd(50)} (${r.archivo})`);
lineas.push('\n\n3. PANTALLAS CON DIRECCION PROPIA A LAS QUE NO LLEVA NINGUN ENLACE');
for (const [app, rutas] of Object.entries(pantallasEscondidas)) {
  lineas.push(`\n  ${app}: ${rutas.length}`);
  if (rutas.length) lineas.push('    ' + rutas.join(', '));
}

const salida = path.join(process.env.SCRATCH || '.', 'huerfanos.txt');
fs.writeFileSync(salida, lineas.join('\n'), 'utf8');
console.log(lineas.join('\n'));

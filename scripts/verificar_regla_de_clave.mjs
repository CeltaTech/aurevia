// ---------------------------------------------------------------------------
// verificar_regla_de_clave.mjs — que el mínimo de caracteres sea uno solo
//
// Uso, desde la raíz del repo:
//   node scripts/verificar_regla_de_clave.mjs
//
// El número vive en `backend/src/config/reglaDeClave.js`, y de ahí lo importan
// el motor y las tres pantallas. Pero la plataforma tiene el suyo escrito en un
// archivo de configuración que no puede importar nada, y es el que manda de
// verdad: cualquier camino que no pase por nuestras pantallas se valida contra
// ése. Los dos números tienen que decir lo mismo, y esto falla si se despegan.
//
// Comprueba además que nadie vuelva a escribir un mínimo a mano.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const { MINIMO_DE_CARACTERES } = await import(
  new URL('../backend/src/config/reglaDeClave.js', import.meta.url)
);

const fallas = [];

// 1. La plataforma dice el mismo número.
const config = readFileSync(join(RAIZ, 'supabase', 'config.toml'), 'utf8');
const enLaPlataforma = config.match(/^minimum_password_length\s*=\s*(\d+)/m);
if (!enLaPlataforma) {
  fallas.push('supabase/config.toml no declara minimum_password_length.');
} else if (Number(enLaPlataforma[1]) !== MINIMO_DE_CARACTERES) {
  fallas.push(
    `supabase/config.toml dice ${enLaPlataforma[1]} y la regla dice ${MINIMO_DE_CARACTERES}.`,
  );
}

// 2. Nadie compara el largo de una clave contra un número escrito a mano.
const IGNORADOS = new Set([
  'node_modules', '.git', '.github', '.claude', '.playwright-mcp', '.wrangler',
  '.temp', 'dist', 'build', 'coverage', 'docs',
]);
const EXTENSIONES = new Set(['.js', '.jsx', '.ts', '.tsx']);
// Acotado a propósito: `claves.length` es una lista de claves de un objeto, no una contraseña.
const ESCRITO_A_MANO = /\b(?:password|clave|contrase[ñn]a)\b\.length\s*[<>=!]+\s*\d/i;

function recorrer(carpeta) {
  for (const entrada of readdirSync(carpeta)) {
    if (IGNORADOS.has(entrada)) continue;
    const ruta = join(carpeta, entrada);
    if (statSync(ruta).isDirectory()) {
      recorrer(ruta);
      continue;
    }
    if (!EXTENSIONES.has(extname(entrada))) continue;
    const texto = readFileSync(ruta, 'utf8');
    texto.split('\n').forEach((linea, i) => {
      if (linea.trimStart().startsWith('//')) return;
      if (ESCRITO_A_MANO.test(linea)) {
        fallas.push(`${relative(RAIZ, ruta)}:${i + 1} compara el largo de una clave a mano.`);
      }
    });
  }
}
recorrer(RAIZ);

if (fallas.length) {
  console.error('La regla de la clave no es una sola:');
  for (const f of fallas) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`La regla de la clave es una sola: mínimo ${MINIMO_DE_CARACTERES} caracteres.`);

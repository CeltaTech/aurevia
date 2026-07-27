// ---------------------------------------------------------------------------
// sincronizar_identidad.mjs — copia la identidad del producto a las 4 unidades
//
// Uso, desde la raíz del repo:
//   node scripts/sincronizar_identidad.mjs
//
// La copia de backend/ es la original; las otras tres se sobrescriben con ella.
// Se edita SIEMPRE backend/src/config/identidadProducto.js y después se corre
// esto. Es la contracara de scripts/verificar_identidad.mjs, que falla el build
// si las cuatro no coinciden.
//
// Por qué hay cuatro copias en vez de un import compartido: cada unidad se
// despliega por separado y sin acceso al resto del repo (`railway up` sube solo
// backend/, cada frontend tiene su vercel.json con su root). Ver la cabecera de
// identidadProducto.js.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

export const ORIGINAL = 'backend/src/config/identidadProducto.js';
export const COPIAS = [
  'panel/src/config/identidadProducto.js',
  'pwa-asistentes/src/config/identidadProducto.js',
  'pwa-familias/src/config/identidadProducto.js',
];

const contenido = readFileSync(join(RAIZ, ORIGINAL), 'utf8');

let cambiadas = 0;
for (const ruta of COPIAS) {
  const destino = join(RAIZ, ruta);
  let actual = null;
  try {
    actual = readFileSync(destino, 'utf8');
  } catch {
    // todavía no existe — se crea abajo
  }
  if (actual === contenido) {
    console.log(`  = ${ruta} (ya estaba al día)`);
    continue;
  }
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, contenido, 'utf8');
  console.log(`  ↻ ${ruta} (actualizada)`);
  cambiadas++;
}

console.log(
  cambiadas === 0
    ? '\nLas 4 copias de la identidad ya estaban sincronizadas.'
    : `\n${cambiadas} copia(s) actualizada(s) desde ${ORIGINAL}.`
);

// ---------------------------------------------------------------------------
// sincronizar_copias.mjs — copia los originales encima de sus copias
//
// Uso, desde la raíz del repo:
//   node scripts/sincronizar_copias.mjs
//
// Qué archivos toca y por qué existen repetidos: está escrito en
// scripts/copias_entre_apps.mjs, que es la lista. Acá solo se copia.
//
// La regla de uso es siempre la misma: se edita el ORIGINAL, se corre esto, y
// listo. Editar una copia a mano es tiempo perdido — la próxima corrida la
// pisa, y mientras tanto scripts/verificar_identidad.mjs falla el build.
//
// (Antes se llamaba sincronizar_identidad.mjs y hacía lo mismo con un solo
// grupo de archivos.)
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { GRUPOS, RAIZ } from './copias_entre_apps.mjs';

let cambiadas = 0;
let total = 0;

for (const grupo of GRUPOS) {
  console.log(`\n${grupo.que} — original: ${grupo.original}`);
  const contenido = readFileSync(join(RAIZ, grupo.original), 'utf8');

  for (const ruta of grupo.copias) {
    total++;
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
}

console.log(
  cambiadas === 0
    ? `\nLas ${total} copias ya estaban sincronizadas.`
    : `\n${cambiadas} de ${total} copia(s) actualizada(s).`
);

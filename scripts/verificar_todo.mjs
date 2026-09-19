// ---------------------------------------------------------------------------
// verificar_todo.mjs — corre todos los chequeos, uno atrás del otro
//
// Uso, desde la raíz del repo:
//   node scripts/verificar_todo.mjs
//
// QUÉ HACE
//   Mira la carpeta `scripts/`, junta todo lo que se llame `verificar_*.mjs`, lo
//   ordena por nombre y lo corre. Si pasan todos, dice una línea por cada uno y
//   termina en cero. Si alguno falla, muestra entero lo que ese dijo y termina
//   en uno.
//
// POR QUÉ ARMA LA LISTA MIRANDO LA CARPETA Y NO LA TIENE ESCRITA
//   Porque una lista escrita a mano se desactualiza, y se desactualiza en
//   silencio: el chequeo nuevo que nadie anotó no corre nunca, y el resultado es
//   peor que no tenerlo, porque el corredor sigue diciendo que está todo bien.
//   Mirando la carpeta, un chequeo entra por existir. No hay nada que anotar en
//   ningún lado, y nadie se puede olvidar.
//
//   La contracara: todo lo que se llame `verificar_*.mjs` va a correr acá. Un
//   guion que necesite red, una base levantada o una credencial **no se llama
//   así** —los que prueban contra la base en vivo se llaman `probar_*.mjs`, y
//   ésa es la diferencia entre los dos nombres—. Un chequeo lee archivos y
//   nada más.
//
// CUANDO ESTE PROGRAMA FALLA
//   El que falló se puede correr solo, con `node scripts/<el que sea>.mjs`, y
//   ahí se lo ve sin el resto del ruido.
// ---------------------------------------------------------------------------

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACA = dirname(fileURLToPath(import.meta.url));
const YO = 'verificar_todo.mjs';

const chequeos = readdirSync(ACA)
  .filter((n) => n.startsWith('verificar_') && n.endsWith('.mjs') && n !== YO)
  .sort();

if (chequeos.length === 0) {
  console.error('No se encontró ningún chequeo en scripts/.');
  console.error('Si se movieron de lugar, este corredor quedó dando verde sin correr nada.');
  process.exit(1);
}

console.log(`Chequeos encontrados en scripts/: ${chequeos.length}\n`);

const fallaron = [];
for (const chequeo of chequeos) {
  const corrida = spawnSync(process.execPath, [join(ACA, chequeo)], {
    encoding: 'utf8',
    shell: false,
  });
  const nombre = chequeo.replace(/^verificar_/, '').replace(/\.mjs$/, '');

  if (corrida.status === 0) {
    const salida = (corrida.stdout || '').trim().split('\n');
    console.log(`  ✔ ${nombre.padEnd(20)} ${salida[salida.length - 1] || ''}`);
    continue;
  }

  fallaron.push(nombre);
  console.log(`  ✘ ${nombre}`);
  const detalle = ((corrida.stdout || '') + (corrida.stderr || '')).trimEnd();
  if (detalle) console.log(detalle.split('\n').map((l) => '      ' + l).join('\n'));
}

if (fallaron.length) {
  console.log(`\nFallaron ${fallaron.length} de ${chequeos.length}: ${fallaron.join(', ')}.`);
  process.exit(1);
}

console.log(`\nPasaron los ${chequeos.length} chequeos.`);

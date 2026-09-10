// ---------------------------------------------------------------------------
// verificar_errores_hacia_afuera.mjs — que el motor no vuelva a contarle a la
// pantalla el texto crudo de un error de la base.
//
// Uso, desde la raíz del repo:
//   node scripts/verificar_errores_hacia_afuera.mjs
//
// POR QUÉ EXISTE. El motor entra a la base con la llave maestra, así que el
// texto de un error de Postgres describe la base entera: nombra tablas,
// columnas y restricciones —"insert or update on table facturas_familia_items
// violates foreign key constraint …"—. Eso no puede llegar al navegador
// (`celtatech/CLAUDE.md` §6): quien mire la pantalla con las herramientas del
// navegador abiertas se lleva el mapa del esquema sin haber atacado nada.
//
// Y llegaba: había 209 lugares contestando `res.status(500).json({ error:
// error.message })`, repartidos en 28 archivos. Se convirtieron todos para que
// llamen al punto único, `backend/src/utils/errorConMotivo.js`, que manda el
// motivo y deja el detalle en el registro del servidor.
//
// Doscientos nueve lugares no se sostienen a ojo. Volver a romperlo cuesta un
// renglón, y el renglón se escribe solo porque es la forma más corta de
// contestar un error. Un control que corta la publicación, no.
//
// QUÉ BUSCA. Cuerpos de respuesta que lleven `.message` adentro: sea con la
// clave `error`, con `motivo`, con `detalle` o con cualquier otra. Es una
// heurística por renglón sobre el texto del archivo, no un parser: caza la
// forma en que este defecto se escribe, que es la de una sola línea.
//
// QUÉ NO REVISA, a propósito:
//   - `console.error(..., error.message)` y cualquier otro registro del
//     servidor: ahí es exactamente donde el detalle tiene que estar.
//   - `throw new Error(error.message)`: no contesta nada. Lo que contesta es el
//     `catch` de más afuera, y ése sí pasa por el punto único.
//   - Renglones que son sólo comentario.
//   - Las pruebas, que necesitan escribir el defecto para comprobar que se tapa.
//   - `errorConMotivo.js`, que es el punto único y el único que puede decidir
//     qué sale.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOTOR = join(RAIZ, 'backend', 'src');

const DIRECTORIOS_IGNORADOS = new Set(['node_modules', '__tests__', '.git', 'dist', 'build']);

// El punto único: es el que decide qué sale hacia afuera, así que es el único
// que puede nombrar `.message` en un cuerpo de respuesta.
const ARCHIVOS_PERMITIDOS = new Set([join('backend', 'src', 'utils', 'errorConMotivo.js')]);

// Un cuerpo de respuesta con `.message` adentro. `json({ … .message … })` cubre
// tanto `{ error: e.message }` como `{ motivo: e.message }` y cualquier otra
// clave, que es como se escapó la última vez.
const PATRON = /\.json\s*\(\s*\{[^}]*\.message\b/;

function archivosJs(directorio) {
  const encontrados = [];
  for (const nombre of readdirSync(directorio)) {
    if (DIRECTORIOS_IGNORADOS.has(nombre)) continue;
    const ruta = join(directorio, nombre);
    if (statSync(ruta).isDirectory()) encontrados.push(...archivosJs(ruta));
    else if (nombre.endsWith('.js')) encontrados.push(ruta);
  }
  return encontrados;
}

const hallazgos = [];

for (const ruta of archivosJs(MOTOR)) {
  const relativa = relative(RAIZ, ruta);
  if (ARCHIVOS_PERMITIDOS.has(relativa)) continue;

  const renglones = readFileSync(ruta, 'utf8').split(/\r?\n/);
  renglones.forEach((renglon, indice) => {
    const limpio = renglon.trim();
    if (limpio.startsWith('//') || limpio.startsWith('*')) return;
    if (!PATRON.test(renglon)) return;
    hallazgos.push({ archivo: relativa.split(sep).join('/'), renglon: indice + 1, texto: limpio });
  });
}

if (hallazgos.length === 0) {
  console.log('✓ Ningún cuerpo de respuesta del motor lleva el texto crudo de un error.');
  process.exit(0);
}

console.error(
  `✗ ${hallazgos.length} cuerpo(s) de respuesta llevan el texto crudo de un error hacia el navegador.\n`,
);
for (const { archivo, renglon, texto } of hallazgos) {
  console.error(`  ${archivo}:${renglon}`);
  console.error(`    ${texto}\n`);
}
console.error(
  'Se contesta con `responderError(res, error)` de `backend/src/utils/errorConMotivo.js`:\n' +
    'afuera va el motivo, que la pantalla traduce, y el detalle queda en el registro del\n' +
    'servidor. Si lo que falla es un renglón de un lote y no la respuesta entera, se guarda\n' +
    '`error?.motivo ?? \'falla_del_sistema\'` y el detalle se registra aparte.',
);
process.exit(1);

/**
 * Ninguna consulta de las dos aplicaciones de teléfono queda sin filtro que la ate a una sola
 * Prestadora.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El motor entra a la base con la llave de servicio y se saltea la
 * protección por fila, así que lo único que separa una Prestadora de otra son los filtros
 * escritos en cada ruta (`CLAUDE.md` §6). Un filtro que falta no se ve: la pantalla anda igual
 * de bien, y el día que dos Prestadoras compartan una persona, una ve los datos de la otra.
 * Aparecieron seis olvidos así de una sola vez, y ninguno lo encontró nadie mirando la pantalla.
 *
 * POR QUÉ ACÁ Y NO EN EL PANEL. Las rutas del Panel tienen su punto único de verdad —
 * `acotarAPrestadora()` en `middleware/alcancePrestadora.js`—, y ahí el filtro no se olvida
 * porque no se escribe a mano. Las rutas de las aplicaciones no tienen nada equivalente: cada
 * consulta pone su filtro por su cuenta. Mientras eso siga así, esta prueba es la red.
 *
 * QUÉ CUENTA COMO ATADA. Alcanza con que la consulta lleve la Prestadora, o el identificador de
 * algo que ya se validó como propio antes: el Paciente, la Familia, la Guardia, la conversación,
 * o la clave primaria de la fila misma.
 *
 * Qué daría con el sistema roto: sacarle a cualquier consulta su filtro de Prestadora la deja
 * sin ninguna atadura, y esta prueba la nombra.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUTAS = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Lo que ata una consulta a datos que ya se validaron como de esta Prestadora. */
const ATADURAS = [
  'prestadora_id',
  'prestadoraId',
  'paciente_id',
  'familia_id',
  'guardia_id',
  'conversacion_id',
  "eq('id'",
  "in('id'",
];

/**
 * Las que no llevan ninguna, y por qué. La lista es corta a propósito: cada renglón que se le
 * agrega es una consulta que esta prueba deja de mirar, así que se agrega con el motivo escrito
 * y no para acallarla.
 */
const CON_MOTIVO = new Map([
  // Catálogo legal por jurisdicción y modalidad. No es de ninguna Prestadora: dos Prestadoras
  // del mismo país tienen que ver el mismo texto.
  ['appAsistentesConsentimientos.js:textos_consentimiento', true],
  // `matriculas_asistente` no tiene columna de Organización, así que esto no se arregla con un
  // filtro: pide migración, y está anotado como paso en `docs/PLAN_HASTA_PRODUCCION.md`. La
  // vista cuelga de esa misma tabla.
  ['appAsistentesMatricula.js:matriculas_asistente', true],
  ['appAsistentesMatricula.js:estado_matricula_asistente', true],
  // Depósito de archivos, no tabla: `supabase.storage.from(BUCKET)`. La ruta del archivo empieza
  // por la Prestadora y la política del depósito lo exige.
  ['appAsistentes.js:reportes-fotos', true],
]);

/**
 * Cada `supabase.from('tabla')…` de un archivo, con la cadena encadenada entera —que es donde
 * están los filtros—. La cadena sigue mientras el renglón que viene arranque con un punto o sea
 * continuación de un paréntesis abierto; un comentario en el medio no la corta.
 */
function consultasDe(texto) {
  const renglones = texto.split('\n');
  const salida = [];

  for (let i = 0; i < renglones.length; i++) {
    const marca = renglones[i].match(/\.from\('([^']+)'\)/);
    if (!marca) continue;

    let cadena = renglones[i];
    let j = i;
    while (j + 1 < renglones.length) {
      const queSigue = renglones[j + 1].trim();
      const abiertos = (cadena.match(/\(/g) || []).length - (cadena.match(/\)/g) || []).length;
      const esComentario = queSigue.startsWith('//') || queSigue.startsWith('*');
      if (!queSigue.startsWith('.') && !esComentario && abiertos <= 0) break;
      j++;
      cadena += '\n' + renglones[j];
    }
    salida.push({ renglon: i + 1, tabla: marca[1], cadena });
  }

  return salida;
}

const ARCHIVOS = readdirSync(RUTAS).filter((a) => a.startsWith('app') && a.endsWith('.js'));

describe('las consultas de las aplicaciones de teléfono', () => {
  it('hay rutas de aplicación que mirar', () => {
    // Sin esto, un cambio de nombre de archivo dejaría la prueba mirando el vacío y dando verde.
    assert.ok(ARCHIVOS.length >= 5, `se encontraron ${ARCHIVOS.length} archivos de rutas`);
  });

  it('todas quedan atadas a una sola Prestadora', () => {
    const sueltas = [];

    for (const archivo of ARCHIVOS) {
      const texto = readFileSync(join(RUTAS, archivo), 'utf8');
      for (const consulta of consultasDe(texto)) {
        if (ATADURAS.some((atadura) => consulta.cadena.includes(atadura))) continue;
        if (CON_MOTIVO.has(`${archivo}:${consulta.tabla}`)) continue;
        sueltas.push(`${archivo}:${consulta.renglon} — ${consulta.tabla}`);
      }
    }

    assert.deepEqual(
      sueltas,
      [],
      `hay consultas sin ningún filtro que las ate a una Prestadora:\n  ${sueltas.join('\n  ')}`
    );
  });

  it('ningún motivo escrito sobra', () => {
    // Un motivo que ya no corresponde a ninguna consulta es un agujero abierto por si acaso.
    const vistas = new Set();
    for (const archivo of ARCHIVOS) {
      const texto = readFileSync(join(RUTAS, archivo), 'utf8');
      for (const consulta of consultasDe(texto)) {
        vistas.add(`${archivo}:${consulta.tabla}`);
      }
    }

    const sobrantes = [...CON_MOTIVO.keys()].filter((clave) => !vistas.has(clave));
    assert.deepEqual(sobrantes, [], `sobran motivos escritos: ${sobrantes.join(', ')}`);
  });
});

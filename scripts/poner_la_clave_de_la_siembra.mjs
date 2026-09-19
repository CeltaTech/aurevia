// ---------------------------------------------------------------------------
// poner_la_clave_de_la_siembra.mjs — le pone contraseña a las cuentas locales
//
// Uso, desde la raíz del producto, con la base local levantada:
//   SEED_LOCAL_PASSWORD=<la que quiera> node scripts/poner_la_clave_de_la_siembra.mjs
//
// POR QUÉ EXISTE. `supabase/seed.sql` crea las once cuentas de prueba con el
// casillero de la contraseña vacío, a propósito: una contraseña escrita adentro
// de ese archivo sería una credencial guardada en el repositorio, y eso no se
// hace ni para la base local (§6 de `celtatech/CLAUDE.md`). Pero ese archivo lo
// corre `supabase db reset`, que no le pasa variables de entorno, así que la
// clave no puede entrar por ahí. Entra por acá, en un paso aparte, que sí lee el
// entorno.
//
// SE PLANTA SI FALTA LA VARIABLE. Sin ella no hay nada que poner, y adivinar un
// valor por omisión sería volver a escribir una clave en el código.
//
// SOLO CONTRA LA BASE LOCAL. Le habla al contenedor de la base que corre en esta
// máquina, por su nombre, igual que `probar_aislamiento.mjs`. No hay forma de
// apuntarlo a la nube.
//
// EL VALOR NO SE MUESTRA NI SE ESCRIBE EN NINGÚN LADO. Ni en la pantalla, ni en
// la lista de procesos: viaja por la entrada estándar de `psql`, no como
// argumento.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const CLAVE = process.env.SEED_LOCAL_PASSWORD;
if (!CLAVE) {
  console.error('Falta la variable SEED_LOCAL_PASSWORD. Es la contraseña con la que entran las cuentas de la base local, y no se escribe en el código.');
  console.error('  SEED_LOCAL_PASSWORD=<la que quiera> node scripts/poner_la_clave_de_la_siembra.mjs');
  process.exit(1);
}

// El contenedor de la base local. El nombre se arma con el identificador que
// está en `supabase/config.toml`, no escrito a mano acá: así sigue funcionando
// si ese identificador cambia.
const CONTENEDOR = process.env.CONTENEDOR_BASE || (() => {
  const toml = readFileSync(join(RAIZ, 'supabase', 'config.toml'), 'utf8');
  const id = toml.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
  if (!id) throw new Error('No encontré project_id en supabase/config.toml.');
  return `supabase_db_${id[1]}`;
})();

// El dominio que el servicio de acceso ve, el mismo que escribe la siembra. Acota
// la orden a las cuentas que nacieron de ahí y no a cualquier otra.
const DOMINIO_DE_ACCESO = '@acceso.careonys.invalid';

// La clave se mete en la orden entre marcas de dólar con una etiqueta sorteada,
// para que ningún carácter que traiga pueda cerrar el texto antes de tiempo.
const ETIQUETA = 'clave' + randomUUID().replace(/-/g, '');
if (CLAVE.includes(ETIQUETA)) {
  console.error('La contraseña contiene la marca interna del programa. Volvé a correrlo.');
  process.exit(1);
}

// Se cuentan las filas con `RETURNING`, y no leyendo el renglón que imprime
// `psql`, porque ese renglón cambia según cómo esté configurada la salida.
const ORDEN = `
WITH cambiadas AS (
  UPDATE auth.users u
     SET encrypted_password = extensions.crypt($${ETIQUETA}$${CLAVE}$${ETIQUETA}$, extensions.gen_salt('bf')),
         updated_at = now()
    FROM public.usuarios p
   WHERE p.id = u.id
     AND u.email LIKE '%${DOMINIO_DE_ACCESO}'
  RETURNING 1
)
SELECT count(*) FROM cambiadas;
`;

let salida;
try {
  salida = execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { encoding: 'utf8', input: ORDEN },
  );
} catch (error) {
  console.error('No se pudo escribir en la base local.');
  console.error(`  Contenedor: ${CONTENEDOR}. ¿Está levantada? (npx supabase start)`);
  if (error.stderr) console.error(String(error.stderr).trim());
  process.exit(1);
}

const cuantas = Number(salida.trim().split('\n').pop());
if (cuantas === 0) {
  console.error('No hay ninguna cuenta de la siembra en esta base. ¿Falta correr `npx supabase db reset`?');
  process.exit(1);
}

console.log(`Listo: ${cuantas} cuentas de la base local quedaron con la contraseña de SEED_LOCAL_PASSWORD.`);

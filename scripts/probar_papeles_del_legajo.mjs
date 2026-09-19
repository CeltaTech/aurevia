// ---------------------------------------------------------------------------
// probar_papeles_del_legajo.mjs — ¿el papel del legajo queda encerrado en su Prestadora?
//
// Uso, desde la raíz del producto, con la base local levantada:
//   node scripts/probar_papeles_del_legajo.mjs
//
// Devuelve 0 si el aislamiento aguanta y 1 si algo se filtró.
//
// POR QUÉ EXISTE
//
// El depósito «documentos-asistente» es el primero que el Panel escribe con el pase de la persona
// que entró, y no con la llave de servicio del motor. Lo que lo aísla son sus políticas, no un
// filtro escrito en una pantalla. Una política no se prueba leyéndola: se prueba entrando.
//
// Y LA RUTA EMPIEZA POR LA PRESTADORA a propósito. Empezando por la cuenta, el día que una misma
// cuenta tenga legajo en dos Prestadoras las dos verían la misma carpeta. Eso es justamente lo que
// acá se comprueba que no pasa.
//
// QUÉ PRUEBA, con las dos Prestadoras que siembra `supabase/seed.sql` y datos cargados en las dos:
//
//   1. Cada administradora sube un papel a la carpeta de su propia Prestadora: tiene que entrar.
//   2. Cada una intenta subir a la carpeta de la otra: tiene que rebotar, en las dos direcciones.
//   3. Cada una lista el depósito: ve el suyo y ninguno del otro, en las dos direcciones.
//   4. Cada una pide una dirección firmada del papel de la otra: tiene que rebotar.
//   5. Una Asistente con sesión no alcanza ninguno: no hay política que la alcance.
//
// Una consulta que devuelve vacío no prueba nada, y por eso cada comprobación de «no ve» corre
// contra un archivo que existe y que la otra sí ve.
//
// QUÉ NECESITA. La base local levantada, sembrada, y `panel/.env.local` con su dirección. Lo que
// sube se borra al terminar.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEPOSITO = 'documentos-asistente';

const CONTENEDOR = process.env.CONTENEDOR_BASE || (() => {
  const toml = readFileSync(join(RAIZ, 'supabase', 'config.toml'), 'utf8');
  const id = toml.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
  if (!id) throw new Error('No encontré project_id en supabase/config.toml.');
  return `supabase_db_${id[1]}`;
})();

// La contraseña de las cuentas de la base local. No se escribe acá: es la que
// recibió `scripts/poner_la_clave_de_la_siembra.mjs` después de sembrar, y entra
// por la misma variable. Sin ella no hay con qué entrar, así que no arranca.
const CONTRASENA = process.env.SEED_LOCAL_PASSWORD;
if (!CONTRASENA) {
  console.error('Falta la variable SEED_LOCAL_PASSWORD. Es la contraseña con la que entran las cuentas de la base local, y no se escribe en el código.');
  console.error('  Se la pone `node scripts/poner_la_clave_de_la_siembra.mjs` con esa misma variable.');
  process.exit(1);
}

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const rojo = (t) => `\x1b[31m${t}\x1b[0m`;
const gris = (t) => `\x1b[90m${t}\x1b[0m`;

let fallas = 0;
function comprobar(queSeEsperaba, salioBien, detalle = '') {
  if (salioBien) {
    console.log(`  ${verde('✓')} ${queSeEsperaba}`);
  } else {
    fallas += 1;
    console.log(`  ${rojo('✗')} ${queSeEsperaba} ${detalle ? gris(detalle) : ''}`);
  }
}

function leerEntorno() {
  const archivo = join(RAIZ, 'panel', '.env.local');
  if (!existsSync(archivo)) {
    throw new Error(`Falta ${archivo}. Sin la dirección de la base local no hay nada que probar.`);
  }
  const valores = {};
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const corte = linea.indexOf('=');
    if (corte < 1 || linea.trimStart().startsWith('#')) continue;
    valores[linea.slice(0, corte).trim()] = linea.slice(corte + 1).trim();
  }
  return { base: valores.VITE_SUPABASE_URL, llavePublica: valores.VITE_SUPABASE_ANON_KEY };
}

function consultarBase(sql) {
  const salida = execFileSync(
    'docker',
    ['exec', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-F', '|', '-c', sql],
    { encoding: 'utf8' },
  );
  return salida.trim().split('\n').filter(Boolean).map((l) => l.split('|'));
}

async function entrar(base, llavePublica, email) {
  const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: llavePublica, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CONTRASENA }),
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!cuerpo.access_token) {
    throw new Error(`No se pudo entrar como ${email} (${r.status}). ¿Corriste "npx supabase db reset"?`);
  }
  return cuerpo.access_token;
}

const CUERPO = Buffer.from('%PDF-1.4\n% papel de prueba\n');

async function subir({ base, llavePublica, pase, ruta }) {
  const r = await fetch(`${base}/storage/v1/object/${DEPOSITO}/${ruta}`, {
    method: 'POST',
    headers: { apikey: llavePublica, Authorization: `Bearer ${pase}`, 'Content-Type': 'application/pdf' },
    body: CUERPO,
  });
  return r.status;
}

async function listar({ base, llavePublica, pase, carpeta }) {
  const r = await fetch(`${base}/storage/v1/object/list/${DEPOSITO}`, {
    method: 'POST',
    headers: { apikey: llavePublica, Authorization: `Bearer ${pase}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: carpeta, limit: 100 }),
  });
  const cuerpo = await r.json().catch(() => []);
  return Array.isArray(cuerpo) ? cuerpo.map((o) => o.name) : [];
}

async function borrar({ base, llavePublica, pase, ruta }) {
  await fetch(`${base}/storage/v1/object/${DEPOSITO}/${ruta}`, {
    method: 'DELETE',
    headers: { apikey: llavePublica, Authorization: `Bearer ${pase}` },
  });
}

async function firmar({ base, llavePublica, pase, ruta }) {
  const r = await fetch(`${base}/storage/v1/object/sign/${DEPOSITO}/${ruta}`, {
    method: 'POST',
    headers: { apikey: llavePublica, Authorization: `Bearer ${pase}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  return r.status;
}

async function principal() {
  const { base, llavePublica } = leerEntorno();
  if (!base || !llavePublica) throw new Error('Falta VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en panel/.env.local.');

  // Las dos Prestadoras salen de la base, no escritas a mano: si la siembra cambia, esto sigue.
  const filas = consultarBase(`
    SELECT u.prestadora_id, u.id, au.email, u.rol
      FROM public.usuarios u
      JOIN auth.users au ON au.id = u.id
     WHERE u.rol IN ('admin_prestadora', 'asistente')
       AND u.prestadora_id IS NOT NULL
     ORDER BY u.prestadora_id, u.rol, au.email;`);

  const porPrestadora = new Map();
  for (const [prestadoraId, usuarioId, email, rol] of filas) {
    if (!porPrestadora.has(prestadoraId)) porPrestadora.set(prestadoraId, { prestadoraId });
    const lado = porPrestadora.get(prestadoraId);
    if (rol === 'admin_prestadora' && !lado.admin) lado.admin = { email, id: usuarioId };
    if (rol === 'asistente' && !lado.asistente) lado.asistente = { email, id: usuarioId };
  }

  const lados = [...porPrestadora.values()].filter((l) => l.admin && l.asistente);
  if (lados.length < 2) {
    console.log(rojo('Hacen falta dos Prestadoras sembradas, cada una con administradora y Asistente.'));
    process.exit(1);
  }

  const [una, otra] = lados;
  for (const lado of [una, otra]) {
    lado.pase = await entrar(base, llavePublica, lado.admin.email);
    lado.paseAsistente = await entrar(base, llavePublica, lado.asistente.email);
    lado.ruta = `${lado.prestadoraId}/${lado.asistente.id}/${crypto.randomUUID()}.pdf`;
  }

  // Lo que haya dejado una corrida anterior interrumpida se saca antes de empezar: si no, el
  // listado cuenta de más y la prueba falla por una razón que no es la que vino a buscar.
  for (const lado of [una, otra]) {
    const carpeta = `${lado.prestadoraId}/${lado.asistente.id}`;
    for (const nombre of await listar({ base, llavePublica, pase: lado.pase, carpeta })) {
      await borrar({ base, llavePublica, pase: lado.pase, ruta: `${carpeta}/${nombre}` });
    }
  }

  console.log('\nCada administradora sube el papel a la carpeta de su propia Prestadora');
  for (const lado of [una, otra]) {
    const estado = await subir({ base, llavePublica, pase: lado.pase, ruta: lado.ruta });
    comprobar(`entra el papel de la Prestadora ${lado.prestadoraId.slice(0, 8)}`, estado === 200, `estado ${estado}`);
  }

  console.log('\nCada una intenta subir a la carpeta de la otra');
  for (const [quien, ajena] of [[una, otra], [otra, una]]) {
    const ruta = `${ajena.prestadoraId}/${ajena.asistente.id}/${crypto.randomUUID()}.pdf`;
    const estado = await subir({ base, llavePublica, pase: quien.pase, ruta });
    comprobar(`rebota la de ${quien.prestadoraId.slice(0, 8)} escribiendo en ${ajena.prestadoraId.slice(0, 8)}`,
      estado !== 200, `estado ${estado}`);
  }

  console.log('\nQué ve cada una del depósito');
  for (const [quien, ajena] of [[una, otra], [otra, una]]) {
    const propios = await listar({ base, llavePublica, pase: quien.pase, carpeta: `${quien.prestadoraId}/${quien.asistente.id}` });
    const ajenos = await listar({ base, llavePublica, pase: quien.pase, carpeta: `${ajena.prestadoraId}/${ajena.asistente.id}` });
    comprobar(`${quien.prestadoraId.slice(0, 8)} ve el suyo`, propios.length === 1, `vio ${propios.length}`);
    comprobar(`${quien.prestadoraId.slice(0, 8)} no ve ninguno de ${ajena.prestadoraId.slice(0, 8)}`, ajenos.length === 0, `vio ${ajenos.length}`);
  }

  console.log('\nLa dirección firmada del papel ajeno');
  for (const [quien, ajena] of [[una, otra], [otra, una]]) {
    const propia = await firmar({ base, llavePublica, pase: quien.pase, ruta: quien.ruta });
    const impropia = await firmar({ base, llavePublica, pase: quien.pase, ruta: ajena.ruta });
    comprobar(`${quien.prestadoraId.slice(0, 8)} firma el suyo`, propia === 200, `estado ${propia}`);
    comprobar(`${quien.prestadoraId.slice(0, 8)} no firma el de ${ajena.prestadoraId.slice(0, 8)}`, impropia !== 200, `estado ${impropia}`);
  }

  console.log('\nUna Asistente con sesión');
  for (const lado of [una, otra]) {
    const vistos = await listar({ base, llavePublica, pase: lado.paseAsistente, carpeta: `${lado.prestadoraId}/${lado.asistente.id}` });
    const firmado = await firmar({ base, llavePublica, pase: lado.paseAsistente, ruta: lado.ruta });
    comprobar('no alcanza el depósito por listado', vistos.length === 0, `vio ${vistos.length}`);
    comprobar('no alcanza el depósito por dirección firmada', firmado !== 200, `estado ${firmado}`);
  }

  // Lo subido se borra por la API de archivos, que es el único camino: la base rechaza el borrado
  // directo de esa tabla para no dejar el archivo huérfano del renglón.
  for (const lado of [una, otra]) {
    await borrar({ base, llavePublica, pase: lado.pase, ruta: lado.ruta });
  }

  console.log(fallas === 0
    ? `\n${verde('✓')} El papel del legajo queda encerrado en su Prestadora.`
    : `\n${rojo('✗')} ${fallas} comprobación(es) fallaron.`);
  process.exit(fallas === 0 ? 0 : 1);
}

principal().catch((e) => {
  console.error(rojo(e.message));
  process.exit(1);
});

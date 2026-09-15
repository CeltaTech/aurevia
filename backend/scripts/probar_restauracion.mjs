/**
 * Prueba de restauración: baja el último respaldo, lo restaura en una base efímera y compara
 * lo que volvió contra lo que hay.
 *
 * LO CORRE EL DESARROLLADOR, Y ESO NO ES UN OLVIDO. Para bajar el respaldo hacen falta las
 * llaves del bucket, y para comparar contra producción, las de la base y las del almacenamiento.
 * Todas viven en la caja fuerte, que no se abre (`celtatech/CLAUDE.md`, sección 6). Así que el
 * trabajo que sí se puede hacer desde acá es dejar el comando hecho, para que la prueba sea una
 * línea y no una tarde: lo que decide si volvió bien está en
 * `src/utils/comprobacionDeRestauracion.js`, con sus pruebas.
 *
 * LA BASE EFÍMERA NO TOCA NADA. Se levanta un contenedor propio, se restaura adentro, se
 * compara y se borra, junto con el archivo descargado. Contra producción sólo se cuentan filas.
 *
 * NO IMPRIME NINGÚN DATO DE NADIE. Nombres de tabla, cantidades y depósitos. Nunca una fila,
 * nunca una ruta de archivo, nunca una credencial.
 *
 * Cómo se corre, con las variables ya cargadas en el entorno (las mismas que usa el respaldo
 * diario, más las de la base de producción):
 *
 *   node scripts/probar_restauracion.mjs
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { IDENTIDAD } from '../src/config/identidadProducto.js';
import { claveEnElDestino, depositosDeSupabase } from '../src/utils/copiaDeDepositos.js';
import {
  elegirElUltimoRespaldo,
  diferenciasDeTablas,
  diferenciasDeConteo,
  diferenciasDeArchivos,
  veredicto,
} from '../src/utils/comprobacionDeRestauracion.js';

const CONTENEDOR = `${IDENTIDAD.codigo}_prueba_restauracion`;
const IMAGEN = 'postgres:17-alpine';

function requireEnv(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

/**
 * Corre un comando y devuelve su salida.
 *
 * `entrada` es la ruta de un archivo que se le manda por la entrada estándar, que es como se
 * restaura un volcado sin escribirlo adentro del contenedor.
 */
function correr(comando, argumentos, { entrada = null, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, argumentos, { env });
    let salida = '';
    let error = '';
    proceso.stdout.on('data', (c) => { salida += c.toString(); });
    proceso.stderr.on('data', (c) => { error += c.toString(); });
    proceso.on('error', reject);
    proceso.on('close', (codigo) => {
      if (codigo === 0) resolve(salida);
      else reject(new Error(`${comando} terminó con código ${codigo}: ${error.trim()}`));
    });
    if (entrada) createReadStream(entrada).pipe(proceso.stdin);
  });
}

function clienteR2() {
  return new S3Client({
    endpoint: requireEnv('R2_ENDPOINT'),
    region: 'auto',
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
}

/** Todas las claves del bucket, con su tamaño. El listado viene de a mil y hay que pedir el resto. */
async function inventarioDelBucket(cliente, bucket, prefijo) {
  const encontrados = {};
  let continuacion;
  do {
    const pagina = await cliente.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefijo,
      ContinuationToken: continuacion,
    }));
    for (const objeto of pagina.Contents ?? []) encontrados[objeto.Key] = objeto.Size;
    continuacion = pagina.IsTruncated ? pagina.NextContinuationToken : undefined;
  } while (continuacion);
  return encontrados;
}

async function bajarDelBucket(cliente, bucket, clave, rutaLocal) {
  const objeto = await cliente.send(new GetObjectCommand({ Bucket: bucket, Key: clave }));
  await pipeline(objeto.Body, createGunzip(), createWriteStream(rutaLocal));
}

/** Levanta la base efímera y espera a que conteste. */
async function levantarLaBase() {
  await correr('docker', ['rm', '-f', CONTENEDOR]).catch(() => {});
  await correr('docker', [
    'run', '--rm', '-d', '--name', CONTENEDOR,
    '-e', `POSTGRES_PASSWORD=${randomUUID()}`,
    IMAGEN,
  ]);
  for (let intento = 0; intento < 30; intento += 1) {
    try {
      await correr('docker', ['exec', CONTENEDOR, 'pg_isready', '-U', 'postgres']);
      return;
    } catch {
      await new Promise((r) => { setTimeout(r, 1000); });
    }
  }
  throw new Error('La base efímera no llegó a contestar.');
}

/**
 * Una consulta contra la base restaurada o contra producción, según `remota`.
 *
 * La contraseña de producción se le pasa a docker por nombre, no por valor: `-e PGPASSWORD`
 * sin el igual toma lo que ya está en el entorno, y así la clave no queda escrita en la lista
 * de procesos de la máquina.
 */
async function consultar(sql, { remota = false } = {}) {
  const base = remota
    ? ['-h', requireEnv('DB_HOST'), '-p', process.env.DB_PORT || '5432',
      '-U', requireEnv('DB_USER'), '-d', requireEnv('DB_NAME')]
    : ['-U', 'postgres', '-d', 'postgres'];
  const salida = await correr('docker', [
    'exec', ...(remota ? ['-e', 'PGPASSWORD'] : []), CONTENEDOR,
    'psql', ...base, '-tAF|', '-c', sql,
  ], { env: { ...process.env, PGPASSWORD: remota ? requireEnv('DB_PASSWORD') : '' } });
  return salida.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('|'));
}

const TABLAS = `select tablename from pg_tables where schemaname = 'public' order by 1`;

/** Una sola consulta que cuenta todas las tablas, en vez de una consulta por tabla. */
function consultaDeConteos(tablas) {
  return tablas
    .map((t) => `select '${t}' as tabla, count(*) from public."${t}"`)
    .join(' union all ');
}

async function conteos(tablas, opciones) {
  if (tablas.length === 0) return {};
  const filas = await consultar(consultaDeConteos(tablas), opciones);
  return Object.fromEntries(filas.map(([tabla, cantidad]) => [tabla, Number(cantidad)]));
}

/** Qué archivos hay hoy en el almacenamiento, con la clave ya en la forma del espejo. */
async function inventarioDelAlmacenamiento() {
  const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const almacenamiento = depositosDeSupabase(supabase);
  const encontrados = {};
  for (const deposito of await almacenamiento.listarDepositos()) {
    for (const archivo of await almacenamiento.listarArchivos(deposito)) {
      encontrados[claveEnElDestino(deposito, archivo.ruta)] = archivo.tamano;
    }
  }
  return encontrados;
}

async function main() {
  const cliente = clienteR2();
  const bucket = requireEnv('R2_BUCKET');
  const rutaLocal = join(tmpdir(), `prueba_restauracion_${Date.now()}.sql`);

  console.log('Buscando el último respaldo...');
  const volcado = elegirElUltimoRespaldo(Object.keys(await inventarioDelBucket(cliente, bucket, '')));
  console.log(`Respaldo elegido: ${volcado}`);

  try {
    await bajarDelBucket(cliente, bucket, volcado, rutaLocal);
    console.log('Levantando la base efímera...');
    await levantarLaBase();

    console.log('Restaurando...');
    await correr('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres'], { entrada: rutaLocal });

    const enProduccion = (await consultar(TABLAS, { remota: true })).map(([t]) => t);
    const enLaRestaurada = (await consultar(TABLAS)).map(([t]) => t);
    const tablas = diferenciasDeTablas(enProduccion, enLaRestaurada);

    const comparables = enProduccion.filter((t) => enLaRestaurada.includes(t));
    const cuentas = diferenciasDeConteo(
      await conteos(comparables, { remota: true }),
      await conteos(comparables),
    );

    console.log('Comparando los archivos...');
    const archivos = diferenciasDeArchivos(
      await inventarioDelAlmacenamiento(),
      await inventarioDelBucket(cliente, bucket, 'archivos/'),
    );

    const resultado = veredicto({ tablas, conteos: cuentas, archivos });
    console.log(`\nResultado: ${resultado.estado}`);
    for (const motivo of resultado.motivos) console.log(`  - ${motivo}`);
    if (resultado.estado !== 'bien') process.exitCode = 1;
  } finally {
    await correr('docker', ['rm', '-f', CONTENEDOR]).catch(() => {});
    await unlink(rutaLocal).catch(() => {});
    console.log('La base efímera y el archivo descargado quedaron borrados.');
  }
}

main().catch((error) => {
  console.error('La prueba de restauración no se pudo completar:', error.message);
  process.exit(1);
});

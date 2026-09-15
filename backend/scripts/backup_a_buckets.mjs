import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { IDENTIDAD } from '../src/config/identidadProducto.js';
import { copiarDepositos, depositosDeSupabase } from '../src/utils/copiaDeDepositos.js';

function requireEnv(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

async function generarDump(rutaSalida) {
  const env = {
    ...process.env,
    PGHOST: requireEnv('DB_HOST'),
    PGPORT: process.env.DB_PORT || '5432',
    PGDATABASE: requireEnv('DB_NAME'),
    PGUSER: requireEnv('DB_USER'),
    PGPASSWORD: requireEnv('DB_PASSWORD'),
  };

  await new Promise((resolve, reject) => {
    const proceso = spawn('pg_dump', ['--no-owner', '--no-privileges'], { env });
    const gzip = createGzip();
    const destino = createWriteStream(rutaSalida);
    let stderr = '';
    proceso.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proceso.on('error', reject);
    pipeline(proceso.stdout, gzip, destino).then(resolve).catch(reject);
    proceso.on('close', (codigo) => {
      if (codigo !== 0) reject(new Error(`pg_dump terminó con código ${codigo}: ${stderr}`));
    });
  });
}

function clienteS3({ endpoint, accessKeyId, secretAccessKey, region }) {
  return new S3Client({
    endpoint,
    region: region || 'auto',
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function subirA(cliente, bucket, nombreArchivo, rutaLocal) {
  await cliente.send(new PutObjectCommand({
    Bucket: bucket,
    Key: nombreArchivo,
    Body: createReadStream(rutaLocal),
  }));
}

/**
 * Un destino de la copia de archivos, sobre un depósito compatible con S3.
 *
 * `yaEstaIgual` compara tamaño y fecha de modificación contra lo que se guardó al subir. Sin esa
 * comparación el respaldo volvería a subir todos los archivos todas las noches, y eso crece
 * hasta que una noche no termina.
 */
function destinoS3(cliente, bucket) {
  return {
    async yaEstaIgual(clave, archivo) {
      try {
        const actual = await cliente.send(new HeadObjectCommand({ Bucket: bucket, Key: clave }));
        if (archivo.tamano != null && actual.ContentLength !== archivo.tamano) return false;
        if (archivo.actualizado && actual.Metadata?.actualizado !== archivo.actualizado) return false;
        return true;
      } catch {
        return false;
      }
    },
    async subir(clave, cuerpo, archivo) {
      await cliente.send(new PutObjectCommand({
        Bucket: bucket,
        Key: clave,
        Body: cuerpo,
        Metadata: archivo.actualizado ? { actualizado: archivo.actualizado } : undefined,
      }));
    },
  };
}

async function copiarLosArchivos(destinos) {
  const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const cuenta = await copiarDepositos({
    almacenamiento: depositosDeSupabase(supabase),
    destinos,
    avisar: (texto) => console.log(texto),
  });
  console.log(
    `Archivos: ${cuenta.depositos} depósitos, ${cuenta.copiados} copiados, `
    + `${cuenta.yaEstaban} ya estaban, ${cuenta.fallados} fallados.`,
  );
  return cuenta;
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Se nombra por el código técnico del producto, no por su nombre comercial: si mañana la
  // marca cambia, los backups viejos y los nuevos tienen que seguir compartiendo prefijo.
  const nombreArchivo = `${IDENTIDAD.codigo}_backup_${timestamp}.sql.gz`;
  const rutaTemporal = `/tmp/${nombreArchivo}`;

  console.log('Generando dump de la base de datos...');
  await generarDump(rutaTemporal);

  const r2 = clienteS3({
    endpoint: requireEnv('R2_ENDPOINT'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  });
  console.log('Subiendo a Cloudflare R2 (principal)...');
  await subirA(r2, requireEnv('R2_BUCKET'), nombreArchivo, rutaTemporal);

  const b2 = clienteS3({
    endpoint: `https://${requireEnv('B2_ENDPOINT')}`,
    accessKeyId: requireEnv('B2_KEY_ID'),
    secretAccessKey: requireEnv('B2_APPLICATION_KEY'),
    region: 'us-east-005',
  });
  console.log('Subiendo a Backblaze B2 (espejo)...');
  await subirA(b2, requireEnv('B2_BUCKET'), nombreArchivo, rutaTemporal);

  await unlink(rutaTemporal);
  console.log(`Volcado de la base: ${nombreArchivo} subido a los dos buckets.`);

  // Y ahora los archivos. Van después del volcado a propósito: si esta parte falla, el volcado
  // de esta noche ya está arriba, que es lo que no se puede perder.
  console.log('Copiando los archivos de los depósitos...');
  const cuenta = await copiarLosArchivos([destinoS3(r2, requireEnv('R2_BUCKET')), destinoS3(b2, requireEnv('B2_BUCKET'))]);
  if (cuenta.fallados > 0) {
    throw new Error(`${cuenta.fallados} archivos no se pudieron copiar.`);
  }
  console.log('Respaldo completo: la base y los archivos.');
}

main().catch((error) => {
  console.error('Error en el backup:', error);
  process.exit(1);
});

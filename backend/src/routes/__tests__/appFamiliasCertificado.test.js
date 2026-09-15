/**
 * El Certificado de Aptitud que la Familia ve del Asistente, por las dos puertas que lo muestran:
 * la pantalla del Asistente asignado y el escaneo del código en la puerta.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El motor entra a la base con la llave de servicio y se saltea la
 * protección por fila, así que lo único que separa una Prestadora de otra son los filtros
 * escritos en cada consulta. La de `certificados` se apoyaba nada más que en el identificador
 * del Asistente, y una misma persona tiene una ficha por cada Prestadora donde trabaja: si ese
 * identificador se repitiera, la Familia vería el Certificado de otra Prestadora y la pantalla
 * se vería igual de bien. No lo encuentra nadie mirando.
 *
 * Qué daría con el sistema roto: sin el filtro de Prestadora, las dos comprobaciones de abajo
 * fallan. Los datos son inventados.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USUARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FAMILIA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PACIENTE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ASISTENTE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con la dirección entera: los filtros van ahí. */
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, url: req.url });

    const preparada = respuestas.get(clave);
    // Lo que esta prueba no prepara contesta vacío: acá se mira con qué filtros se consultó una
    // sola tabla, y hacer fallar el pedido entero por una consulta de al lado no probaría eso.
    const valor = typeof preparada === 'function' ? preparada({ url: req.url }) : preparada ?? [];

    // `.single()` y `.maybeSingle()` piden una fila sola con este encabezado.
    const unoSolo = (req.headers.accept || '').includes('vnd.pgrst.object+json');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(unoSolo && Array.isArray(valor) ? valor[0] ?? null : valor));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const { appFamiliasRouter } = await import('../appFamilias.js');

const app = express();
app.use(express.json());
app.use('/api/app-familias', appFamiliasRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/app-familias`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function pedir(ruta) {
  const respuesta = await fetch(`${DIRECCION}${ruta}`, {
    headers: { Authorization: 'Bearer token-de-mentira' },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** Las direcciones con las que se consultó una tabla. Los filtros están ahí. */
function consultasA(tabla) {
  return llamadas.filter((l) => l.clave === `GET /rest/v1/${tabla}`).map((l) => l.url);
}

beforeEach(() => {
  respuestas.clear();
  llamadas = [];

  respuestas.set('GET /auth/v1/user', { id: USUARIO });
  respuestas.set('GET /rest/v1/usuarios', [{ rol: 'familia', prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/familias', [{ id: FAMILIA }]);
  respuestas.set('GET /rest/v1/pacientes', [
    { id: PACIENTE, nombre: 'Persona Inventada', familia_id: FAMILIA, prestadora_id: PRESTADORA },
  ]);
  respuestas.set('GET /rest/v1/asistentes', [
    { id: ASISTENTE, nombre: 'Asistente Inventado', foto_url: null, tipo_asistente_id: null },
  ]);
  respuestas.set('GET /rest/v1/certificados', [
    { activo: true, fecha_vencimiento: '2027-01-01' },
  ]);
});

describe('el Certificado en la pantalla del Asistente asignado', () => {
  it('se pide filtrado por la Prestadora del Paciente, no sólo por el Asistente', async () => {
    respuestas.set('GET /rest/v1/guardias', [
      { id: 'g-1', estado: 'cerrada', asistente_id: ASISTENTE },
    ]);

    const { estado } = await pedir(`/pacientes/${PACIENTE}/asistente`);
    assert.equal(estado, 200);

    const [url] = consultasA('certificados');
    assert.ok(url, 'no se consultó el Certificado');
    assert.ok(
      url.includes(`prestadora_id=eq.${PRESTADORA}`),
      'la consulta del Certificado no lleva el filtro de Prestadora'
    );
    assert.ok(url.includes(`asistente_id=eq.${ASISTENTE}`), url);
  });
});

describe('el Certificado al escanear el código en la puerta', () => {
  it('se pide filtrado por la Prestadora del Paciente, no sólo por el Asistente', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    respuestas.set('GET /rest/v1/guardias', [
      { id: 'g-1', estado: 'en_curso', hora_inicio: '08:00', hora_fin: '16:00', asistente_id: ASISTENTE },
    ]);

    const { estado } = await pedir(`/pacientes/${PACIENTE}/verificar-asistente/qr-de-mentira`);
    assert.equal(estado, 200, `contestó ${estado} para la guardia del ${hoy}`);

    const [url] = consultasA('certificados');
    assert.ok(url, 'no se consultó el Certificado');
    assert.ok(
      url.includes(`prestadora_id=eq.${PRESTADORA}`),
      'la consulta del Certificado no lleva el filtro de Prestadora'
    );
    assert.ok(url.includes(`asistente_id=eq.${ASISTENTE}`), url);
  });
});

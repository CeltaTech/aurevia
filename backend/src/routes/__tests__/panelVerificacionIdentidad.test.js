/**
 * Las dos fotos de identidad se guardan y se muestran, y sólo las del Asistente de quien pide.
 *
 *   npm test --prefix backend
 *   node --test backend/src/routes/__tests__/panelVerificacionIdentidad.test.js
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Adentro del depósito `fotos-identidad` hay imágenes de documentos de
 * identidad, y el depósito no tiene ninguna política: lo escribe y lo lee el motor con la llave
 * maestra (`../panelVerificacionIdentidad.js`). O sea que lo único que separa una Prestadora de
 * otra son los filtros escritos en esta ruta, y dos decisiones más: que el tipo de foto salga de
 * una lista cerrada —si no, quien manda el pedido elige el nombre del archivo adentro del
 * depósito— y que la ruta que se firma se arme con los datos del Asistente y no con nada que venga
 * de afuera.
 *
 * Por eso la base es de mentira y contesta por HTTP como la de verdad: además del resultado se
 * mira **qué se le pidió**, que es donde viven esos filtros.
 *
 * Con el sistema roto —un filtro de menos, o el tipo tomado tal como viene— las pruebas del
 * Asistente ajeno y la del tipo inventado dan al revés.
 *
 * Datos inventados, como manda CLAUDE.md §6.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const OTRA_PRESTADORA = '99999999-9999-9999-9999-999999999999';
const USUARIO = '22222222-2222-2222-2222-222222222222';
const ASISTENTE = '44444444-4444-4444-4444-444444444444';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió, con la dirección entera: los filtros van ahí. */
let llamadas = [];

let rolDelUsuario = 'admin_prestadora';
/** Qué contesta el depósito de archivos. `null` es «salió bien». */
let errorDelDeposito = null;
/** Qué rutas tienen foto subida. La firma de las demás vuelve sin dirección. */
let rutasConFoto = null;

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, url: req.url, cuerpo: crudo && req.headers['content-type']?.includes('json') ? JSON.parse(crudo) : crudo });

    // El depósito de archivos: subir y firmar. No se guarda nada, alcanza con contestar como
    // contesta el de verdad y dejar anotado qué ruta se tocó.
    if (ruta.startsWith('/storage/v1/')) {
      if (errorDelDeposito) {
        res.writeHead(errorDelDeposito.__estado, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(errorDelDeposito.__cuerpo));
        return;
      }
      if (ruta.includes('/object/sign/')) {
        const dentro = ruta.replace('/storage/v1/object/sign/fotos-identidad/', '');
        // El depósito es quien sabe si el archivo está: no hay ninguna columna que lo diga.
        if (rutasConFoto && !rutasConFoto.includes(dentro)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Object not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ signedURL: `${ruta.replace('/storage/v1', '')}?token=firma-de-mentira` }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ Key: ruta }));
      return;
    }

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada(crudo ? JSON.parse(crudo) : null) : preparada;
    if (valor === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }
    if (valor && valor.__estado) {
      res.writeHead(valor.__estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(valor.__cuerpo));
      return;
    }

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
const { panelVerificacionIdentidadRouter } = await import('../panelVerificacionIdentidad.js');
const { TIPO_DOCUMENTO, TIPO_PERFIL, rutaEnElDeposito } = await import('../../utils/fotosDeIdentidad.js');

const app = express();
app.use(express.json());
app.use('/api/panel/verificacion-identidad', panelVerificacionIdentidadRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/verificacion-identidad`;

after(() => {
  motor.close();
  baseFalsa.close();
});

/** Una foto de mentira, del tamaño de una miniatura. */
function unaFoto(tipoDeclarado = 'image/jpeg') {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], { type: tipoDeclarado });
}

async function subir(asistenteId, { tipo, archivo = unaFoto() } = {}) {
  const cuerpo = new FormData();
  if (tipo !== undefined) cuerpo.append('tipo', tipo);
  if (archivo !== null) cuerpo.append('archivo', archivo, 'documento');

  const respuesta = await fetch(`${DIRECCION}/${asistenteId}/foto`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-de-mentira' },
    body: cuerpo,
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function pedirLasFotos(asistenteId) {
  const respuesta = await fetch(`${DIRECCION}/${asistenteId}/fotos`, {
    headers: { Authorization: 'Bearer token-de-mentira' },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** El Asistente como sale de la base, con lo que cada prueba le ponga encima. */
function unAsistente(cambios = {}) {
  return { id: ASISTENTE, prestadora_id: PRESTADORA, ...cambios };
}

beforeEach(() => {
  llamadas = [];
  rolDelUsuario = 'admin_prestadora';
  errorDelDeposito = null;
  rutasConFoto = null;
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: PRESTADORA }]);
  respuestas.set('POST /rest/v1/rpc/tiene_permiso_de', () => true);
});

/** Lo que se le preguntó a la tabla de Asistentes, que es lo que tiene que llevar el filtro. */
function consultasDeAsistentes() {
  return llamadas.filter((l) => l.clave.endsWith(' /rest/v1/asistentes'));
}

// ---------------------------------------------------------------------------------------
// Guardar una de las dos fotos
// ---------------------------------------------------------------------------------------

describe('guardar una foto de identidad', () => {
  it('la foto sube a la ruta armada con la Prestadora, el Asistente y el tipo', async () => {
    respuestas.set('GET /rest/v1/asistentes', () => [unAsistente()]);

    const { estado, cuerpo } = await subir(ASISTENTE, { tipo: TIPO_DOCUMENTO });

    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.tipo, TIPO_DOCUMENTO);

    const subida = llamadas.find((l) => l.clave.startsWith('POST /storage/v1/object/'));
    assert.equal(
      subida.clave,
      `POST /storage/v1/object/fotos-identidad/${rutaEnElDeposito(PRESTADORA, ASISTENTE, TIPO_DOCUMENTO)}`,
    );
  });

  it('un tipo que no está en la lista no llega al depósito', async () => {
    const { estado, cuerpo } = await subir(ASISTENTE, { tipo: '../../otra-prestadora/algo' });

    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'foto_invalida');
    assert.equal(llamadas.some((l) => l.clave.startsWith('POST /storage/v1/')), false);
  });

  it('sin tipo tampoco', async () => {
    const { estado } = await subir(ASISTENTE, {});
    assert.equal(estado, 400);
    assert.equal(llamadas.some((l) => l.clave.startsWith('POST /storage/v1/')), false);
  });

  it('sin archivo tampoco', async () => {
    const { estado, cuerpo } = await subir(ASISTENTE, { tipo: TIPO_PERFIL, archivo: null });

    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'foto_invalida');
    assert.equal(llamadas.some((l) => l.clave.startsWith('POST /storage/v1/')), false);
  });

  it('lo que no es una imagen de las admitidas no entra', async () => {
    const { estado, cuerpo } = await subir(ASISTENTE, { tipo: TIPO_DOCUMENTO, archivo: unaFoto('application/pdf') });

    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'foto_invalida');
    assert.equal(llamadas.some((l) => l.clave.startsWith('POST /storage/v1/')), false);
  });

  it('el Asistente de otra Prestadora no existe para ésta, y nada se sube a su nombre', async () => {
    // La base contesta vacío porque el filtro la acotó; lo que se comprueba es que el filtro esté.
    respuestas.set('GET /rest/v1/asistentes', () => []);

    const { estado, cuerpo } = await subir(ASISTENTE, { tipo: TIPO_DOCUMENTO });

    assert.equal(estado, 404);
    assert.equal(cuerpo.motivo, 'asistente_no_encontrado');
    assert.equal(llamadas.some((l) => l.clave.startsWith('POST /storage/v1/')), false);

    const lectura = consultasDeAsistentes().find((l) => l.clave.startsWith('GET '));
    assert.ok(lectura.url.includes(`prestadora_id=eq.${PRESTADORA}`), lectura.url);
  });

  it('la consulta del Asistente lleva el filtro de Prestadora escrito', async () => {
    respuestas.set('GET /rest/v1/asistentes', () => [unAsistente()]);

    await subir(ASISTENTE, { tipo: TIPO_DOCUMENTO });

    const lectura = consultasDeAsistentes().find((l) => l.clave.startsWith('GET '));
    assert.ok(lectura.url.includes(`prestadora_id=eq.${PRESTADORA}`), lectura.url);
    assert.ok(lectura.url.includes(`id=eq.${ASISTENTE}`), lectura.url);
  });

  it('el error del depósito no cuenta hacia afuera qué pasó adentro', async () => {
    respuestas.set('GET /rest/v1/asistentes', () => [unAsistente()]);
    errorDelDeposito = { __estado: 400, __cuerpo: { message: 'new row violates row-level security policy for bucket "fotos-identidad"' } };

    const { cuerpo } = await subir(ASISTENTE, { tipo: TIPO_DOCUMENTO });

    assert.equal(JSON.stringify(cuerpo).includes('row-level security'), false);
    assert.equal(JSON.stringify(cuerpo).includes('fotos-identidad'), false);
  });

  it('quien no es del Panel no guarda nada', async () => {
    rolDelUsuario = 'familia';
    const { estado } = await subir(ASISTENTE, { tipo: TIPO_DOCUMENTO });
    assert.equal(estado, 403);
  });
});

// ---------------------------------------------------------------------------------------
// Volver a ver las dos fotos
// ---------------------------------------------------------------------------------------

describe('las direcciones firmadas de las dos fotos', () => {
  it('se firman las dos rutas armadas con los datos del Asistente, y vencen', async () => {
    respuestas.set('GET /rest/v1/asistentes', () => [unAsistente()]);

    const { estado, cuerpo } = await pedirLasFotos(ASISTENTE);

    assert.equal(estado, 200);
    assert.deepEqual(Object.keys(cuerpo.fotos).sort(), [TIPO_DOCUMENTO, TIPO_PERFIL].sort());
    for (const tipo of [TIPO_DOCUMENTO, TIPO_PERFIL]) {
      assert.ok(cuerpo.fotos[tipo].includes(`/object/sign/fotos-identidad/${rutaEnElDeposito(PRESTADORA, ASISTENTE, tipo)}`));
    }

    const firmas = llamadas.filter((l) => l.clave.startsWith('POST /storage/v1/object/sign/'));
    assert.equal(firmas.length, 2);
    for (const firma of firmas) assert.equal(firma.cuerpo.expiresIn, 60);
  });

  it('la foto que todavía no se subió vuelve vacía, y la otra igual se muestra', async () => {
    respuestas.set('GET /rest/v1/asistentes', () => [unAsistente()]);
    rutasConFoto = [rutaEnElDeposito(PRESTADORA, ASISTENTE, TIPO_DOCUMENTO)];

    const { cuerpo } = await pedirLasFotos(ASISTENTE);

    assert.equal(cuerpo.fotos[TIPO_PERFIL], null);
    assert.ok(cuerpo.fotos[TIPO_DOCUMENTO]);
  });

  it('el Asistente de otra Prestadora no se firma', async () => {
    respuestas.set('GET /rest/v1/asistentes', () => []);

    const { estado, cuerpo } = await pedirLasFotos(ASISTENTE);

    assert.equal(estado, 404);
    assert.equal(cuerpo.motivo, 'asistente_no_encontrado');
    assert.equal(llamadas.some((l) => l.clave.startsWith('POST /storage/v1/')), false);
    const lectura = consultasDeAsistentes().find((l) => l.clave.startsWith('GET '));
    assert.ok(lectura.url.includes(`prestadora_id=eq.${PRESTADORA}`), lectura.url);
  });

  it('la Prestadora que venga en el pedido no se usa para firmar nada', async () => {
    // El Asistente es de esta Prestadora; lo que llega de afuera dice otra cosa y no se mira.
    respuestas.set('GET /rest/v1/asistentes', () => [unAsistente()]);

    const respuesta = await fetch(`${DIRECCION}/${ASISTENTE}/fotos?prestadora_id=${OTRA_PRESTADORA}`, {
      headers: { Authorization: 'Bearer token-de-mentira' },
    });
    const cuerpo = await respuesta.json();

    assert.equal(JSON.stringify(cuerpo).includes(OTRA_PRESTADORA), false);
    assert.ok(cuerpo.fotos[TIPO_DOCUMENTO].includes(PRESTADORA));
  });

  it('ningún motivo nombra una tabla, una columna ni el depósito', async () => {
    respuestas.set('GET /rest/v1/asistentes', () => []);

    const { cuerpo } = await pedirLasFotos(ASISTENTE);

    assert.equal(/asistentes|prestadora_id|fotos-identidad|storage/.test(JSON.stringify(cuerpo)), false);
  });

  it('quien no es del Panel no pide direcciones firmadas', async () => {
    rolDelUsuario = 'asistente';
    const { estado } = await pedirLasFotos(ASISTENTE);
    assert.equal(estado, 403);
  });
});

/**
 * La lista de lugares de la Prestadora, y dónde trabaja cada persona.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Esta lista reemplaza a las zonas escritas a mano, que decidían tres
 * cosas a la vez sin que se notara: a quién se le ofrece una guardia, qué Asistentes ve cada
 * coordinadora y qué zonas ve la Familia. Cuatro agujeros que tapa:
 *
 *  1. Que un lugar entre marcado como oficial sin traer el identificador del organismo. Marcado
 *     así, el día que el organismo lo incorpore nadie puede reconocerlo y queda duplicado.
 *  2. Que se pueda editar a mano el nombre de un lugar oficial. Si se pudiera, el identificador
 *     diría una cosa y la pantalla otra.
 *  3. Que se guarden lugares de otra Organización, o que se borren los de una persona de otra.
 *  4. Que cualquiera pueda cambiar hasta dónde llega una coordinadora, que es cambiar qué ve.
 *
 * Se levantan los dos routers de verdad contra una base de mentira y se mira qué contestan y qué
 * escriben.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';
const ASISTENTE = '33333333-3333-3333-3333-333333333333';
const COORDINADORA = '44444444-4444-4444-4444-444444444444';
const LUGAR = '55555555-5555-5555-5555-555555555555';
const OTRO_LUGAR = '66666666-6666-6666-6666-666666666666';
const ZONA = '77777777-7777-7777-7777-777777777777';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con los filtros de la dirección incluidos. */
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const direccion = new URL(req.url, 'http://interno');
    const clave = `${req.method} ${direccion.pathname}`;
    llamadas.push({ clave, filtros: direccion.searchParams, cuerpo: crudo ? JSON.parse(crudo) : null });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada(direccion.searchParams) : preparada;
    if (valor === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
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

/** El servicio de direcciones de mentira, para las sugerencias del organismo oficial. */
let respuestaDelOrganismo = { localidades: [] };
let codigoDelOrganismo = 200;
const organismoFalso = createServer((req, res) => {
  res.writeHead(codigoDelOrganismo, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(respuestaDelOrganismo));
});
await new Promise((listo) => organismoFalso.listen(0, '127.0.0.1', listo));
process.env.GEOREF_API_BASE = `http://127.0.0.1:${organismoFalso.address().port}`;

// El import va después de dejar puestas las variables de entorno: la conexión a la base y la
// dirección del servicio se leen en el momento del import.
const { default: express } = await import('express');
await import('express-async-errors');
const { panelConfiguracionRouter } = await import('../panelConfiguracion.js');
const { panelLugaresDeTrabajoRouter } = await import('../panelLugaresDeTrabajo.js');

const app = express();
app.use(express.json());
app.use('/api/panel/configuracion', panelConfiguracionRouter);
app.use('/api/panel/lugares-de-trabajo', panelLugaresDeTrabajoRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const RAIZ = `http://127.0.0.1:${motor.address().port}/api/panel`;

after(() => {
  motor.close();
  baseFalsa.close();
  organismoFalso.close();
});

async function pedir(metodo, ruta, cuerpo) {
  const respuesta = await fetch(`${RAIZ}${ruta}`, {
    method: metodo,
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** Lo que el motor escribió en esa tabla, o `undefined` si no escribió nada. */
function loEscritoEn(tabla) {
  return llamadas.find((l) => l.clave === `POST /rest/v1/${tabla}`)?.cuerpo;
}

/** Quién dice la base que es quien llama. Cambiarlo es cambiar de rol en la prueba. */
let quienLlama = { rol: 'admin_prestadora', prestadora_id: PRESTADORA };

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  quienLlama = { rol: 'admin_prestadora', prestadora_id: PRESTADORA };
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', (filtros) =>
    // La misma ruta contesta dos preguntas distintas: quién llama, y si existe la persona cuyo
    // alcance se está por cambiar.
    filtros.get('id') === `eq.${COORDINADORA}` ? [{ id: COORDINADORA }] : [quienLlama],
  );
  // El país de la Prestadora es el que decide con qué organismo se habla.
  respuestas.set('GET /rest/v1/prestadoras', () => [{ pais: 'AR' }]);
  respuestas.set('GET /rest/v1/lugares', () => []);
  respuestas.set('POST /rest/v1/lugares', () => [{ id: LUGAR }]);
  respuestas.set('PATCH /rest/v1/lugares', () => [{ id: LUGAR }]);
  respuestas.set('GET /rest/v1/asistentes', () => [{ id: ASISTENTE }]);
  respuestas.set('GET /rest/v1/zonas_cobertura', () => [{ id: ZONA }]);
  respuestas.set('GET /rest/v1/zona_lugares', () => []);
  respuestas.set('DELETE /rest/v1/zona_lugares', () => []);
  respuestas.set('POST /rest/v1/zona_lugares', () => []);
  respuestas.set('GET /rest/v1/asistente_lugares', () => []);
  respuestas.set('DELETE /rest/v1/asistente_lugares', () => []);
  respuestas.set('POST /rest/v1/asistente_lugares', () => []);
  respuestas.set('GET /rest/v1/usuario_lugares', () => []);
  respuestas.set('DELETE /rest/v1/usuario_lugares', () => []);
  respuestas.set('POST /rest/v1/usuario_lugares', () => []);
  respuestaDelOrganismo = { localidades: [] };
  codigoDelOrganismo = 200;
});

// ---------------------------------------------------------------------------------------

describe('cargar la lista de lugares', () => {
  it('el lugar que trae identificador del organismo queda como oficial', async () => {
    const { estado } = await pedir('POST', '/configuracion/lugares', {
      nombre: 'Villa Urquiza',
      pais: 'ar',
      provincia: 'CABA',
      id_oficial: '02007',
    });
    assert.equal(estado, 200);
    const escrito = loEscritoEn('lugares');
    assert.equal(escrito.fuente, 'oficial');
    assert.equal(escrito.id_oficial, '02007');
    // El país se guarda siempre igual, aunque llegue escrito de cualquier forma.
    assert.equal(escrito.pais, 'AR');
  });

  it('el que no lo trae queda como propio, aunque quien llame diga lo contrario', async () => {
    await pedir('POST', '/configuracion/lugares', {
      nombre: 'Barrio Nuevo',
      pais: 'AR',
      fuente: 'oficial',
      parte_de: OTRO_LUGAR,
    });
    const escrito = loEscritoEn('lugares');
    assert.equal(escrito.fuente, 'propio');
    assert.equal(escrito.id_oficial, null);
    assert.equal(escrito.parte_de, OTRO_LUGAR);
  });

  it('se guarda en la Organización de quien llama, no en la que venga en el pedido', async () => {
    await pedir('POST', '/configuracion/lugares', {
      nombre: 'Villa Urquiza',
      pais: 'AR',
      prestadora_id: '99999999-9999-9999-9999-999999999999',
    });
    assert.equal(loEscritoEn('lugares').prestadora_id, PRESTADORA);
  });

  it('sin nombre o sin país no se escribe nada', async () => {
    for (const cuerpo of [{ pais: 'AR' }, { nombre: '   ', pais: 'AR' }, { nombre: 'Boedo' }]) {
      const { estado } = await pedir('POST', '/configuracion/lugares', cuerpo);
      assert.equal(estado, 400);
    }
    assert.equal(loEscritoEn('lugares'), undefined);
  });

  it('el nombre de un lugar oficial no se edita a mano', async () => {
    await pedir('PATCH', `/configuracion/lugares/${LUGAR}`, { nombre: 'Villa Urquiza de abajo' });
    const editado = llamadas.find((l) => l.clave === 'PATCH /rest/v1/lugares');
    assert.equal(editado.filtros.get('fuente'), 'eq.propio');
  });

  it('apagarlo no exige ser propio: un lugar oficial también se deja de usar', async () => {
    await pedir('PATCH', `/configuracion/lugares/${LUGAR}`, { activo: false });
    const editado = llamadas.find((l) => l.clave === 'PATCH /rest/v1/lugares');
    assert.equal(editado.filtros.get('fuente'), null);
    assert.equal(editado.cuerpo.activo, false);
  });
});

describe('lo que sugiere el organismo oficial', () => {
  it('vuelve con el identificador, el nombre y el punto de cada lugar', async () => {
    respuestaDelOrganismo = {
      localidades: [
        {
          id: '02007',
          nombre: 'Villa Urquiza',
          centroide: { lat: -34.57, lon: -58.48 },
          provincia: { nombre: 'Ciudad Autónoma de Buenos Aires' },
        },
      ],
    };
    const { estado, cuerpo } = await pedir('GET', '/configuracion/lugares/sugerencias?texto=Urquiza');
    assert.equal(estado, 200);
    assert.equal(cuerpo.lugares.length, 1);
    assert.equal(cuerpo.lugares[0].idOficial, '02007');
  });

  it('si el organismo se cayó se dice eso, y no una lista vacía', async () => {
    codigoDelOrganismo = 503;
    const { estado, cuerpo } = await pedir('GET', '/configuracion/lugares/sugerencias?texto=Urquiza');
    // Una lista vacía haría creer que el lugar no existe y cargarlo a mano, duplicado.
    assert.equal(estado, 502);
    assert.ok(cuerpo.error);
  });
});

describe('qué lugares abarca una zona', () => {
  it('se borran los que había y se escriben los que llegaron, en esta Organización', async () => {
    const { estado } = await pedir('PUT', `/configuracion/zonas/${ZONA}/lugares`, {
      lugares: [LUGAR, OTRO_LUGAR],
    });
    assert.equal(estado, 200);

    const borrado = llamadas.find((l) => l.clave === 'DELETE /rest/v1/zona_lugares');
    assert.equal(borrado.filtros.get('zona_id'), `eq.${ZONA}`);
    assert.equal(borrado.filtros.get('prestadora_id'), `eq.${PRESTADORA}`);
    assert.deepEqual(
      loEscritoEn('zona_lugares').map((f) => f.lugar_id),
      [LUGAR, OTRO_LUGAR],
    );
  });

  it('una zona de otra Organización no llega a borrar nada', async () => {
    respuestas.set('GET /rest/v1/zonas_cobertura', () => []);
    const { estado } = await pedir('PUT', `/configuracion/zonas/${ZONA}/lugares`, { lugares: [LUGAR] });
    assert.equal(estado, 404);
    assert.equal(llamadas.some((l) => l.clave === 'DELETE /rest/v1/zona_lugares'), false);
  });

  it('la lista vacía deja la zona sin lugares, y no es un error', async () => {
    const { estado } = await pedir('PUT', `/configuracion/zonas/${ZONA}/lugares`, { lugares: [] });
    assert.equal(estado, 200);
    assert.ok(llamadas.some((l) => l.clave === 'DELETE /rest/v1/zona_lugares'));
    assert.equal(loEscritoEn('zona_lugares'), undefined);
  });
});

describe('dónde acepta trabajar una Asistente', () => {
  it('se guardan lugares, no zonas', async () => {
    const { estado } = await pedir('PUT', `/lugares-de-trabajo/asistente/${ASISTENTE}`, {
      lugares: [LUGAR, OTRO_LUGAR],
    });
    assert.equal(estado, 200);
    assert.deepEqual(loEscritoEn('asistente_lugares'), [
      { asistente_id: ASISTENTE, lugar_id: LUGAR, prestadora_id: PRESTADORA },
      { asistente_id: ASISTENTE, lugar_id: OTRO_LUGAR, prestadora_id: PRESTADORA },
    ]);
  });

  it('una Asistente de otra Organización no llega a borrar nada', async () => {
    respuestas.set('GET /rest/v1/asistentes', () => []);
    const { estado } = await pedir('PUT', `/lugares-de-trabajo/asistente/${ASISTENTE}`, { lugares: [LUGAR] });
    assert.equal(estado, 404);
    assert.equal(llamadas.some((l) => l.clave === 'DELETE /rest/v1/asistente_lugares'), false);
  });

  it('sin lista de lugares no se toca nada', async () => {
    const { estado } = await pedir('PUT', `/lugares-de-trabajo/asistente/${ASISTENTE}`, {});
    assert.equal(estado, 400);
    assert.equal(llamadas.some((l) => l.clave === 'DELETE /rest/v1/asistente_lugares'), false);
  });

  it('quien coordina puede cambiarlos', async () => {
    quienLlama = { rol: 'coordinador', prestadora_id: PRESTADORA };
    const { estado } = await pedir('PUT', `/lugares-de-trabajo/asistente/${ASISTENTE}`, { lugares: [LUGAR] });
    assert.equal(estado, 200);
  });
});

describe('hasta dónde llega una coordinadora', () => {
  it('la administración lo cambia', async () => {
    const { estado } = await pedir('PUT', `/lugares-de-trabajo/usuario/${COORDINADORA}`, { lugares: [LUGAR] });
    assert.equal(estado, 200);
    assert.deepEqual(loEscritoEn('usuario_lugares'), [
      { usuario_id: COORDINADORA, lugar_id: LUGAR, prestadora_id: PRESTADORA },
    ]);
  });

  it('quien coordina no, porque eso es cambiar qué Asistentes ve', async () => {
    quienLlama = { rol: 'coordinador', prestadora_id: PRESTADORA };
    const { estado } = await pedir('PUT', `/lugares-de-trabajo/usuario/${COORDINADORA}`, { lugares: [LUGAR] });
    assert.equal(estado, 403);
    assert.equal(llamadas.some((l) => l.clave === 'DELETE /rest/v1/usuario_lugares'), false);
  });

  it('y tampoco los puede mirar', async () => {
    quienLlama = { rol: 'coordinador', prestadora_id: PRESTADORA };
    const { estado } = await pedir('GET', `/lugares-de-trabajo/usuario/${COORDINADORA}`);
    assert.equal(estado, 403);
  });
});

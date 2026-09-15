/**
 * Las referencias laborales se leen, se cargan y se anotan, y sólo las del Asistente de quien pide.
 *
 *   npm test --prefix backend
 *   node --test backend/src/routes/__tests__/panelReferenciasLaborales.test.js
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Una referencia laboral es el nombre y el teléfono de una persona que
 * no usa el producto y que no tiene forma de enterarse de nada. El motor entra a la base con la
 * llave maestra, así que lo único que separa una Prestadora de otra son los filtros escritos en
 * esta ruta (`../panelReferenciasLaborales.js`). Y hay dos decisiones más que sostener: que quién
 * verificó y cuándo los escriba el servidor y no el pedido —si no, la firma de la verificación la
 * pone quien quiera—, y que el mínimo salga de la configuración de la Prestadora y no de un número
 * escrito en el código.
 *
 * Por eso la base es de mentira y contesta por HTTP como la de verdad: además del resultado se
 * mira **qué se le pidió**, que es donde viven esos filtros.
 *
 * Con el sistema roto —un filtro de menos, o la firma tomada del cuerpo del pedido— las pruebas
 * del Asistente ajeno y la de la firma dan al revés.
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
const REFERENCIA = '55555555-5555-5555-5555-555555555555';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió, con la dirección entera: los filtros van ahí. */
let llamadas = [];

let rolDelUsuario = 'admin_prestadora';

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    // La cuenta exacta viaja como HEAD, y la contesta lo mismo que prepara la lista: es la misma
    // consulta, pedida sin cuerpo. Por eso se busca por GET.
    const clave = `${req.method === 'HEAD' ? 'GET' : req.method} ${ruta}`;
    llamadas.push({ clave, url: req.url, cuerpo: crudo ? JSON.parse(crudo) : null });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada(crudo ? JSON.parse(crudo) : null, req.url) : preparada;
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

    // El pedido de cuenta exacta contesta el total en el encabezado y sin cuerpo, como el de
    // verdad: es así como el motor sabe cuántas referencias hay sin traérselas todas.
    if (req.method === 'HEAD') {
      const total = Array.isArray(valor) ? valor.length : 0;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(total - 1, 0)}/${total}` });
      res.end();
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
const { panelReferenciasLaboralesRouter } = await import('../panelReferenciasLaborales.js');

const app = express();
app.use(express.json());
app.use('/api/panel/referencias-laborales', panelReferenciasLaboralesRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/referencias-laborales`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function llamar(camino, opciones = {}) {
  const respuesta = await fetch(`${DIRECCION}${camino}`, {
    ...opciones,
    headers: {
      Authorization: 'Bearer token-de-mentira',
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
      ...opciones.headers,
    },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** El Asistente como sale de la base, con lo que cada prueba le ponga encima. */
function unAsistente(cambios = {}) {
  return { id: ASISTENTE, prestadora_id: PRESTADORA, ...cambios };
}

/** Una referencia como sale de la base. Datos inventados. */
function unaReferencia(cambios = {}) {
  return {
    id: REFERENCIA,
    nombre: 'Marta Ledesma',
    telefono: '+54 9 11 5555 0000',
    vinculo: 'Coordinadora del geriátrico anterior',
    resultado: 'pendiente',
    notas: null,
    verificada_por: null,
    verificada_en: null,
    created_at: '2026-09-01T12:00:00Z',
    ...cambios,
  };
}

beforeEach(() => {
  llamadas = [];
  rolDelUsuario = 'admin_prestadora';
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: PRESTADORA }]);
  respuestas.set('POST /rest/v1/rpc/tiene_permiso_de', () => true);
  respuestas.set('GET /rest/v1/asistentes', () => [unAsistente()]);
  respuestas.set('GET /rest/v1/configuracion_referencias_laborales', () => [{ minimo_verificadas: 2 }]);
});

function consultasDeReferencias() {
  return llamadas.filter((l) => l.clave.endsWith(' /rest/v1/referencias_laborales_asistente'));
}

// ---------------------------------------------------------------------------------------
// Ver las referencias de una persona
// ---------------------------------------------------------------------------------------

describe('ver las referencias laborales', () => {
  it('vuelven las de esa persona, con la cuenta contra el mínimo de su Prestadora', async () => {
    respuestas.set('GET /rest/v1/referencias_laborales_asistente', () => [
      unaReferencia({ resultado: 'verificada' }),
      unaReferencia({ id: 'otra', resultado: 'no_responde' }),
    ]);

    const { estado, cuerpo } = await llamar(`/${ASISTENTE}`);

    assert.equal(estado, 200);
    assert.equal(cuerpo.referencias.length, 2);
    assert.equal(cuerpo.verificadas, 1);
    assert.equal(cuerpo.exigidas, 2);
    assert.equal(cuerpo.faltan, 1);
    assert.equal(cuerpo.alcanza, false);
    assert.equal(cuerpo.seExigenReferencias, true);
  });

  it('la consulta lleva los dos filtros: la Prestadora y el Asistente', async () => {
    respuestas.set('GET /rest/v1/referencias_laborales_asistente', () => []);

    await llamar(`/${ASISTENTE}`);

    const consulta = consultasDeReferencias()[0];
    assert.ok(consulta.url.includes(`prestadora_id=eq.${PRESTADORA}`));
    assert.ok(consulta.url.includes(`asistente_id=eq.${ASISTENTE}`));
  });

  it('un Asistente de otra Prestadora no existe para quien pregunta', async () => {
    // La base filtra por Prestadora, así que la consulta vuelve vacía y el Asistente no aparece.
    respuestas.set('GET /rest/v1/asistentes', () => []);

    const { estado, cuerpo } = await llamar(`/${ASISTENTE}`);

    assert.equal(estado, 404);
    assert.equal(cuerpo.motivo, 'asistente_no_encontrado');
    assert.equal(consultasDeReferencias().length, 0);
  });

  it('sin fila de configuración no se exige ninguna, y no hay nada que avisar', async () => {
    respuestas.set('GET /rest/v1/configuracion_referencias_laborales', () => []);
    respuestas.set('GET /rest/v1/referencias_laborales_asistente', () => [unaReferencia()]);

    const { cuerpo } = await llamar(`/${ASISTENTE}`);

    assert.equal(cuerpo.exigidas, 0);
    assert.equal(cuerpo.seExigenReferencias, false);
    assert.equal(cuerpo.alcanza, true);
  });

  it('el mínimo sale de la configuración de la Prestadora y no de un número escrito en el código', async () => {
    respuestas.set('GET /rest/v1/configuracion_referencias_laborales', () => [{ minimo_verificadas: 4 }]);
    respuestas.set('GET /rest/v1/referencias_laborales_asistente', () => []);

    const { cuerpo } = await llamar(`/${ASISTENTE}`);

    assert.equal(cuerpo.exigidas, 4);
    assert.equal(cuerpo.faltan, 4);
  });

  it('un rol que no es del Panel no entra', async () => {
    rolDelUsuario = 'familia';

    const { estado } = await llamar(`/${ASISTENTE}`);

    assert.equal(estado, 403);
    assert.equal(consultasDeReferencias().length, 0);
  });
});

// ---------------------------------------------------------------------------------------
// Cargar una referencia a mano
// ---------------------------------------------------------------------------------------

describe('cargar una referencia a mano', () => {
  const nueva = { nombre: 'Rubén Paz', telefono: '+54 9 351 555 0100', vinculo: 'Familia a la que cuidó' };

  it('se guarda con la Prestadora del Asistente, no con la que venga en el pedido', async () => {
    respuestas.set('GET /rest/v1/referencias_laborales_asistente', () => []);
    respuestas.set('POST /rest/v1/referencias_laborales_asistente', () => [unaReferencia(nueva)]);

    const { estado, cuerpo } = await llamar(`/${ASISTENTE}`, {
      method: 'POST',
      body: JSON.stringify({ ...nueva, prestadora_id: OTRA_PRESTADORA, asistente_id: 'cualquiera' }),
    });

    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);

    const alta = consultasDeReferencias().find((l) => l.clave.startsWith('POST '));
    assert.equal(alta.cuerpo.prestadora_id, PRESTADORA);
    assert.equal(alta.cuerpo.asistente_id, ASISTENTE);
    assert.equal(alta.cuerpo.resultado, 'pendiente');
  });

  it('nace sin firma: nadie la verificó todavía', async () => {
    respuestas.set('GET /rest/v1/referencias_laborales_asistente', () => []);
    respuestas.set('POST /rest/v1/referencias_laborales_asistente', () => [unaReferencia(nueva)]);

    await llamar(`/${ASISTENTE}`, { method: 'POST', body: JSON.stringify(nueva) });

    const alta = consultasDeReferencias().find((l) => l.clave.startsWith('POST '));
    assert.equal(alta.cuerpo.verificada_por, undefined);
    assert.equal(alta.cuerpo.verificada_en, undefined);
  });

  it('sin nombre o sin teléfono no se guarda nada', async () => {
    for (const incompleta of [{ telefono: '351' }, { nombre: 'Rubén' }, { nombre: '   ', telefono: '351' }]) {
      llamadas = [];
      const { estado, cuerpo } = await llamar(`/${ASISTENTE}`, {
        method: 'POST',
        body: JSON.stringify(incompleta),
      });
      assert.equal(estado, 400);
      assert.equal(cuerpo.motivo, 'faltan_datos');
      assert.equal(consultasDeReferencias().length, 0);
    }
  });

  it('no se cargan más de las cinco que admite la postulación', async () => {
    respuestas.set('GET /rest/v1/referencias_laborales_asistente', () => [1, 2, 3, 4, 5].map(
      (n) => unaReferencia({ id: `ref-${n}` }),
    ));

    const { estado, cuerpo } = await llamar(`/${ASISTENTE}`, {
      method: 'POST',
      body: JSON.stringify(nueva),
    });

    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'demasiadas_referencias');
    assert.equal(consultasDeReferencias().some((l) => l.clave.startsWith('POST ')), false);
  });

  it('a un Asistente de otra Prestadora no se le cuelga nada', async () => {
    respuestas.set('GET /rest/v1/asistentes', () => []);

    const { estado } = await llamar(`/${ASISTENTE}`, { method: 'POST', body: JSON.stringify(nueva) });

    assert.equal(estado, 404);
    assert.equal(consultasDeReferencias().length, 0);
  });
});

// ---------------------------------------------------------------------------------------
// Anotar lo que contestó la referencia
// ---------------------------------------------------------------------------------------

describe('anotar el resultado de una referencia', () => {
  it('la firma la pone el servidor: quién está del otro lado y el momento', async () => {
    respuestas.set('PATCH /rest/v1/referencias_laborales_asistente', () => [unaReferencia({ resultado: 'verificada' })]);

    const { estado, cuerpo } = await llamar(`/${ASISTENTE}/${REFERENCIA}`, {
      method: 'PATCH',
      body: JSON.stringify({
        resultado: 'verificada',
        notas: 'Confirmó dos años de trabajo.',
        // Lo que venga en el pedido no manda: la firma no se acepta de afuera.
        verificada_por: OTRA_PRESTADORA,
        verificada_en: '2001-01-01T00:00:00Z',
      }),
    });

    assert.equal(estado, 200);
    assert.equal(cuerpo.verificada, true);

    const cambio = consultasDeReferencias().find((l) => l.clave.startsWith('PATCH '));
    assert.equal(cambio.cuerpo.verificada_por, USUARIO);
    assert.notEqual(cambio.cuerpo.verificada_en, '2001-01-01T00:00:00Z');
    assert.ok(cambio.cuerpo.verificada_en);
  });

  it('volver a «sin llamar» borra la firma, porque ya nadie la verificó', async () => {
    respuestas.set('PATCH /rest/v1/referencias_laborales_asistente', () => [unaReferencia()]);

    const { estado, cuerpo } = await llamar(`/${ASISTENTE}/${REFERENCIA}`, {
      method: 'PATCH',
      body: JSON.stringify({ resultado: 'pendiente' }),
    });

    assert.equal(estado, 200);
    assert.equal(cuerpo.verificada, false);

    const cambio = consultasDeReferencias().find((l) => l.clave.startsWith('PATCH '));
    assert.equal(cambio.cuerpo.verificada_por, null);
    assert.equal(cambio.cuerpo.verificada_en, null);
  });

  it('un resultado que no está en la lista no toca nada', async () => {
    const { estado, cuerpo } = await llamar(`/${ASISTENTE}/${REFERENCIA}`, {
      method: 'PATCH',
      body: JSON.stringify({ resultado: 'aprobada' }),
    });

    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'resultado_invalido');
    assert.equal(consultasDeReferencias().length, 0);
  });

  it('el cambio lleva los tres filtros: la referencia, la Prestadora y el Asistente', async () => {
    respuestas.set('PATCH /rest/v1/referencias_laborales_asistente', () => [unaReferencia({ resultado: 'rechazada' })]);

    await llamar(`/${ASISTENTE}/${REFERENCIA}`, {
      method: 'PATCH',
      body: JSON.stringify({ resultado: 'rechazada' }),
    });

    const cambio = consultasDeReferencias().find((l) => l.clave.startsWith('PATCH '));
    assert.ok(cambio.url.includes(`id=eq.${REFERENCIA}`));
    assert.ok(cambio.url.includes(`prestadora_id=eq.${PRESTADORA}`));
    assert.ok(cambio.url.includes(`asistente_id=eq.${ASISTENTE}`));
  });

  it('una referencia que no es de esta persona vuelve como no encontrada', async () => {
    respuestas.set('PATCH /rest/v1/referencias_laborales_asistente', () => []);

    const { estado, cuerpo } = await llamar(`/${ASISTENTE}/${REFERENCIA}`, {
      method: 'PATCH',
      body: JSON.stringify({ resultado: 'verificada' }),
    });

    assert.equal(estado, 404);
    assert.equal(cuerpo.motivo, 'referencia_no_encontrada');
  });

  it('ningún motivo que sale hacia afuera nombra tabla, columna ni Prestadora', async () => {
    respuestas.set('PATCH /rest/v1/referencias_laborales_asistente', () => ({
      __estado: 400,
      __cuerpo: {
        message: 'new row violates row-level security policy for table "referencias_laborales_asistente"',
        details: 'prestadora_id',
      },
    }));

    const { cuerpo } = await llamar(`/${ASISTENTE}/${REFERENCIA}`, {
      method: 'PATCH',
      body: JSON.stringify({ resultado: 'verificada' }),
    });

    const texto = JSON.stringify(cuerpo);
    assert.equal(/referencias_laborales_asistente|prestadora_id|row-level security/.test(texto), false);
  });
});

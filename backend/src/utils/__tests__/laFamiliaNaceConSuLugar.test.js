/**
 * Una Familia recién creada nace con su localidad puesta, por los dos caminos que la crean.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El Panel busca Familias por localidad, y una Familia está donde
 * viven sus Pacientes. Si el Paciente nace sin lugar, la Familia recién creada no la encuentra
 * ninguna búsqueda y nadie se entera: la pantalla no falla, contesta vacío. Es el defecto más
 * caro de los dos, porque parece que funciona.
 *
 * Hay dos caminos hacia una Familia, y los dos tienen que dejarla igual:
 *
 *  1. Convertir una Solicitud: el Paciente nace con el lugar que quien atendió señaló en la lista.
 *  2. El alta manual: el lugar elegido para el Paciente queda también en la Solicitud que se crea
 *     junto con él, que es de donde sale el contacto de la Familia. Dos filas que nacen juntas no
 *     pueden decir cosas distintas sobre dónde está la persona.
 *
 * SE MIRA EL IDENTIFICADOR Y NO EL NOMBRE. Lo que se guarda es cuál lugar. Dos localidades que se
 * llaman igual en partidos distintos son dos, y el nombre se busca recién al mostrarlo.
 *
 * LA PRESTADORA DE LA PRUEBA NO TIENE SERVICIO DE MAPAS. Así la prueba no sale a preguntarle a un
 * tercero por una dirección: acá se comprueba la localidad, no las coordenadas.
 *
 * Se levanta el router de verdad contra una base de mentira y se mira qué escribió.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const QUIEN_LLAMA = '22222222-2222-2222-2222-222222222222';
const NUEVA_CUENTA = '33333333-3333-3333-3333-333333333333';
// El Legajo que la base le da a la Familia nueva. Es a propósito otro número que el de la cuenta:
// la misma persona puede tener otro Legajo en otra Prestadora, colgando de esta misma cuenta.
const NUEVO_LEGAJO = '66666666-6666-6666-6666-666666666666';
const SOLICITUD = '44444444-4444-4444-4444-444444444444';
const PACIENTE = '77777777-7777-7777-7777-777777777777';
const LUGAR = '55555555-5555-5555-5555-555555555555';

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
    const ruta = direccion.pathname.startsWith('/auth/v1/admin/users/')
      ? '/auth/v1/admin/users/:id'
      : direccion.pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, ruta: direccion.pathname, filtros: direccion.searchParams, cuerpo: crudo ? JSON.parse(crudo) : null });

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

// El import va después de dejar puestas las variables de entorno: la conexión a la base se lee en
// el momento del import.
const { default: express } = await import('express');
await import('express-async-errors');
const { panelCuentasRouter } = await import('../../routes/panelCuentas.js');
const { crearFamiliaDirecta } = await import('../cuentasPanel.js');

const app = express();
app.use(express.json());
app.use('/api/panel/cuentas', panelCuentasRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const RAIZ = `http://127.0.0.1:${motor.address().port}/api/panel/cuentas`;

after(() => {
  motor.close();
  baseFalsa.close();
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

function loLeidoDe(tabla) {
  return llamadas.find((l) => l.clave === `GET /rest/v1/${tabla}`);
}

/** La Solicitud que se está convirtiendo. Datos inventados. */
let solicitudGuardada;

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  solicitudGuardada = {
    id: SOLICITUD,
    prestadora_id: PRESTADORA,
    nombre: 'Alba Ferreyra',
    nombre_paciente: 'Bruno Ferreyra',
    email: 'alba@ejemplo.invalido',
    telefono: '11 5555 0001',
    localidad: 'belgrano',
    lugar_id: LUGAR,
    familia_id: null,
  };

  respuestas.set('GET /auth/v1/user', () => ({ id: QUIEN_LLAMA, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ id: QUIEN_LLAMA, rol: 'admin_prestadora', prestadora_id: PRESTADORA }]);
  respuestas.set('POST /rest/v1/usuarios', () => []);
  respuestas.set('POST /rest/v1/membresias', () => []);
  respuestas.set('DELETE /rest/v1/usuarios', () => []);
  respuestas.set('POST /auth/v1/admin/users', () => ({ id: NUEVA_CUENTA }));
  respuestas.set('DELETE /auth/v1/admin/users/:id', () => ({}));
  respuestas.set('GET /rest/v1/solicitudes', () => [solicitudGuardada]);
  respuestas.set('POST /rest/v1/solicitudes', () => [{ ...solicitudGuardada, id: SOLICITUD }]);
  respuestas.set('PATCH /rest/v1/solicitudes', () => []);
  respuestas.set('DELETE /rest/v1/solicitudes', () => []);
  respuestas.set('POST /rest/v1/familias', () => [{ id: NUEVO_LEGAJO }]);
  respuestas.set('DELETE /rest/v1/familias', () => []);
  respuestas.set('POST /rest/v1/pacientes', () => [{ id: PACIENTE }]);
  respuestas.set('DELETE /rest/v1/pacientes', () => []);
  // Cómo se llama el lugar señalado. El nombre se usa para ubicar el domicilio, nunca para
  // decidir cuál lugar es.
  respuestas.set('GET /rest/v1/lugares', () => [{ nombre: 'Belgrano' }]);
  // Un país sin servicio de mapas: el domicilio se guarda igual, sin coordenadas.
  respuestas.set('GET /rest/v1/prestadoras', () => [{ pais: 'UY' }]);
});

// ---------------------------------------------------------------------------------------

describe('la Familia que nace de una Solicitud', () => {
  it('su Paciente nace con el lugar que se señaló en la lista', async () => {
    const { estado } = await pedir('POST', '/familia', { solicitudId: SOLICITUD });

    assert.equal(estado, 200);
    assert.equal(loEscritoEn('pacientes').lugar_id, LUGAR);
  });

  it('el nombre del lugar se pregunta dentro de la Prestadora y no en cualquier ficha', async () => {
    await pedir('POST', '/familia', { solicitudId: SOLICITUD });

    const lectura = loLeidoDe('lugares');
    assert.equal(lectura.filtros.get('id'), `eq.${LUGAR}`);
    assert.equal(lectura.filtros.get('prestadora_id'), `eq.${PRESTADORA}`);
  });

  it('si nadie señaló ningún lugar, no se inventa ninguno', async () => {
    solicitudGuardada.lugar_id = null;

    const { estado } = await pedir('POST', '/familia', { solicitudId: SOLICITUD });

    assert.equal(estado, 200);
    assert.equal(loEscritoEn('pacientes').lugar_id, null);
    assert.equal(loLeidoDe('lugares'), undefined);
  });
});

describe('el alta manual de una Familia', () => {
  it('deja el mismo lugar en el Paciente y en la Solicitud que crea', async () => {
    await crearFamiliaDirecta({
      nombreContacto: 'Alba Ferreyra',
      email: 'alba@ejemplo.invalido',
      nombrePaciente: 'Bruno Ferreyra',
      localidad: 'belgrano',
      domicilioDelPacientePartido: { calle: 'Calle Inventada', numero: '100', lugar_id: LUGAR },
      prestadoraId: PRESTADORA,
    });

    // Las dos filas nacen juntas: si sólo una llevara el lugar, dirían cosas distintas sobre
    // dónde está la misma persona.
    assert.equal(loEscritoEn('pacientes').lugar_id, LUGAR);
    assert.equal(loEscritoEn('solicitudes').lugar_id, LUGAR);
  });
});

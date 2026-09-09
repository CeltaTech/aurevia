/**
 * `borrarCuenta` llamada derecho, sin ninguna ruta que la cuide antes.
 *
 *   npm test --prefix backend
 *   node --test backend/src/utils/__tests__/borrarCuenta.test.js
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Hasta el 2026-09-09 esta función tenía su propia comprobación de
 * Prestadora, y era más floja que la de la ruta que la llama (pendiente #157): con
 * `esSuperadmin: true` se salteaba entera, así que borraba a cualquiera de cualquier Prestadora.
 * No había fuga en vivo porque la única ruta que la usaba validaba antes; el agujero era para el
 * llamador siguiente, el que se olvidara de esa validación previa.
 *
 * Entonces lo que se prueba acá es justamente eso: el llamador descuidado. Se llama a la función
 * de frente, sin pasar por ninguna ruta y sin ninguna comprobación previa, y se mira qué hace.
 * Con el código anterior las dos pruebas de «no se borra lo ajeno» pasaban de largo y borraban.
 *
 * La base es de mentira y responde por HTTP como responde la de verdad, así que lo que se
 * comprueba no es que la función haya decidido bien por dentro, sino qué terminó pidiéndole a la
 * base: si negó, no salió ningún borrado.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA_PROPIA = '11111111-1111-1111-1111-111111111111';
const PRESTADORA_AJENA = '22222222-2222-2222-2222-222222222222';
const CUENTA = '33333333-3333-3333-3333-333333333333';

/** La fila de `usuarios` que la base contesta cuando se pregunta por la cuenta a borrar. */
let filaDeLaCuenta = null;
/** Todo lo que se le pidió a la base, para poder afirmar que NO se pidió un borrado. */
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const url = new URL(req.url, 'http://interno');
    llamadas.push({ metodo: req.method, ruta: url.pathname });

    // El servicio de acceso: `supabase.auth.admin.deleteUser` pega en /auth/v1/admin/users/<id>.
    if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/rest/v1/usuarios') {
      const unoSolo = (req.headers.accept || '').includes('vnd.pgrst.object+json');
      const filas = filaDeLaCuenta === null ? [] : [filaDeLaCuenta];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(unoSolo ? filas[0] ?? null : filas));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa, y con la dirección que haya en ese instante.
const { borrarCuenta } = await import('../cuentasPanel.js');

after(() => {
  baseFalsa.close();
});

beforeEach(() => {
  llamadas = [];
  filaDeLaCuenta = null;
});

/** Ningún borrado salió hacia la base: ni la fila de la persona ni su cuenta de acceso. */
function noBorroNada() {
  const borrados = llamadas.filter((l) => l.metodo === 'DELETE').map((l) => l.ruta);
  assert.deepEqual(borrados, [], `salió un borrado que no debía salir: ${borrados.join(', ')}`);
}

/** Los dos borrados salieron, en la tabla y en el servicio de acceso. */
function borroLaCuentaEntera() {
  const borrados = llamadas.filter((l) => l.metodo === 'DELETE').map((l) => l.ruta);
  assert.deepEqual(borrados, ['/rest/v1/usuarios', `/auth/v1/admin/users/${CUENTA}`]);
}

async function elMotivo(promesa) {
  return promesa.then(
    () => null,
    (error) => error.message,
  );
}

describe('la cuenta de otra Prestadora no se borra, la pida quien la pida', () => {
  it('ni siquiera diciendo que quien pide es Superadmin', async () => {
    // Éste es el llamado que el código anterior dejaba pasar: `esSuperadmin: true` salteaba la
    // comprobación entera y la cuenta ajena se borraba igual.
    filaDeLaCuenta = { rol: 'admin_prestadora', prestadora_id: PRESTADORA_AJENA };

    const motivo = await elMotivo(
      borrarCuenta(CUENTA, { prestadoraId: PRESTADORA_PROPIA, esSuperadmin: true }),
    );

    assert.match(motivo ?? '', /No hay permiso/);
    noBorroNada();
  });

  it('tampoco sin decir nada de quién pide', async () => {
    filaDeLaCuenta = { rol: 'coordinador', prestadora_id: PRESTADORA_AJENA };

    const motivo = await elMotivo(borrarCuenta(CUENTA, { prestadoraId: PRESTADORA_PROPIA }));

    assert.match(motivo ?? '', /No hay permiso/);
    noBorroNada();
  });
});

describe('cuando el alcance no se puede resolver, tampoco se borra', () => {
  it('dos cuentas sin Organización no son de la misma Organización', async () => {
    // El otro agujero del código anterior: comparaba las dos Organizaciones sin exigir que
    // existieran, y `null !== null` da falso, o sea que daba permiso.
    filaDeLaCuenta = { rol: 'familia', prestadora_id: null };

    const motivo = await elMotivo(borrarCuenta(CUENTA, { prestadoraId: null }));

    assert.match(motivo ?? '', /No hay permiso/);
    noBorroNada();
  });

  it('sin ninguna Organización indicada', async () => {
    filaDeLaCuenta = { rol: 'asistente', prestadora_id: PRESTADORA_PROPIA };

    const motivo = await elMotivo(borrarCuenta(CUENTA, {}));

    assert.match(motivo ?? '', /No hay permiso/);
    noBorroNada();
  });

  it('sin identificador de cuenta no se le pregunta nada a la base', async () => {
    // `.eq('id', undefined)` no filtra por nadie: se corta antes de salir.
    const motivo = await elMotivo(borrarCuenta(undefined, { prestadoraId: PRESTADORA_PROPIA }));

    assert.match(motivo ?? '', /No hay permiso/);
    assert.deepEqual(llamadas, []);
  });

  it('cuando la cuenta ya no existe', async () => {
    filaDeLaCuenta = null;

    const motivo = await elMotivo(
      borrarCuenta(CUENTA, { prestadoraId: PRESTADORA_PROPIA, esSuperadmin: true }),
    );

    assert.match(motivo ?? '', /No hay permiso/);
    noBorroNada();
  });
});

describe('lo que sí se borra, se borra entero', () => {
  it('una cuenta de la Organización sobre la que se está trabajando', async () => {
    filaDeLaCuenta = { rol: 'coordinador', prestadora_id: PRESTADORA_PROPIA };

    await borrarCuenta(CUENTA, { prestadoraId: PRESTADORA_PROPIA });

    borroLaCuentaEntera();
  });

  it('una cuenta del equipo técnico de CeltaTech, pedida por un Superadmin', async () => {
    // La única excepción que existe, y la razón por la que `esSuperadmin` sigue haciendo falta:
    // estas cuentas no cuelgan de ninguna Organización, así que ninguna comparación por
    // Prestadora las alcanza. Si esta prueba se rompe, el arreglo apretó de más.
    filaDeLaCuenta = { rol: 'superadmin', prestadora_id: null };

    await borrarCuenta(CUENTA, { prestadoraId: null, esSuperadmin: true });

    borroLaCuentaEntera();
  });

  it('una cuenta del equipo técnico no la borra quien no es Superadmin', async () => {
    filaDeLaCuenta = { rol: 'superadmin', prestadora_id: null };

    const motivo = await elMotivo(borrarCuenta(CUENTA, { prestadoraId: PRESTADORA_PROPIA }));

    assert.match(motivo ?? '', /No hay permiso/);
    noBorroNada();
  });
});

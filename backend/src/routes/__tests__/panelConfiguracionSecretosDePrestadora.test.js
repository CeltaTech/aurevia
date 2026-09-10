/**
 * Quién llega a los secretos de una Prestadora en Configuración (paso 10 del plan).
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Las rutas de Configuración estaban detrás del candado de la
 * administración, que deja pasar a Admin_prestadora **y a Superadmin**. Para casi toda la
 * configuración está bien: Superadmin es quien da soporte. Para un puñado no: son las claves con
 * las que esta Prestadora habla con un tercero —Meta, en WhatsApp; su proveedor de correo, en el
 * remitente saliente—, y Superadmin es un rol técnico de CeltaTech, no de la Prestadora. La
 * sesión de soporte técnico tampoco lo habilita — existe para mirar los datos de una Organización
 * por vez y queda auditada, no para alcanzar sus credenciales.
 *
 * Los dos casos se prueban juntos y con la misma lista porque son la misma regla: donde hay un
 * secreto de la Prestadora, Superadmin queda afuera. Partirlos en dos archivos haría que el
 * siguiente secreto que aparezca se agregue en uno solo.
 *
 * Lo que se prueba no es la función del candado —eso sería probar una comparación—, sino el
 * camino entero: se levanta el motor de verdad contra una base de mentira, se entra con cada rol
 * y se mira qué contesta cada ruta. Y en el caso que se niega se comprueba, además, que el motor
 * no le haya preguntado nada a la base: un 403 que igual leyó la tabla ya dijo si la Prestadora
 * tiene cargadas sus claves, que es justamente lo que no se quiere contar.
 *
 * La prueba se hace con la sesión de soporte ABIERTA a propósito. Sin ella, un Superadmin no
 * está parado en ninguna Prestadora y la ruta corta antes por otro motivo; el caso que importa
 * —y el que hasta hoy pasaba— es el de adentro de la sesión de soporte.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';
const SESION_SOPORTE = '44444444-4444-4444-4444-444444444444';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, para poder afirmar que NO pidió algo. */
let llamadas = [];

let rolDelUsuario = 'admin_prestadora';
let prestadoraDelUsuario = PRESTADORA;
/** Con sesión de soporte abierta, un Superadmin queda parado adentro de esta Prestadora. */
let sesionDeSoporteAbierta = false;

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, url: req.url, cuerpo: crudo ? JSON.parse(crudo) : null });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada() : preparada;
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

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const { panelConfiguracionRouter } = await import('../panelConfiguracion.js');

const app = express();
app.use(express.json());
app.use('/api/panel/configuracion', panelConfiguracionRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/configuracion`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function pedir(metodo, ruta, cuerpo) {
  const respuesta = await fetch(`${DIRECCION}${ruta}`, {
    method: metodo,
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

const dentroDeUnRato = () => new Date(Date.now() + 30 * 60 * 1000).toISOString();

beforeEach(() => {
  llamadas = [];
  rolDelUsuario = 'admin_prestadora';
  prestadoraDelUsuario = PRESTADORA;
  sesionDeSoporteAbierta = false;
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: prestadoraDelUsuario }]);
  // El segundo factor no es lo que se está probando acá: se lo deja apagado para que el camino
  // llegue hasta el candado del rol, que es lo que importa.
  respuestas.set('GET /rest/v1/configuracion_plataforma', () => [{ mfa_admin_obligatorio: false }]);
  respuestas.set('GET /rest/v1/sesiones_soporte_tecnico', () =>
    sesionDeSoporteAbierta
      ? [
          {
            id: SESION_SOPORTE,
            prestadora_id: PRESTADORA,
            expira_at: dentroDeUnRato(),
            ultima_actividad_at: new Date().toISOString(),
          },
        ]
      : []
  );
  respuestas.set('PATCH /rest/v1/sesiones_soporte_tecnico', () => []);
  respuestas.set('POST /rest/v1/auditoria_soporte_tecnico', () => []);
});

/** Todo lo que sólo se toca cuando la ruta llegó a hacer su trabajo con los secretos. */
const RASTROS_DE_LOS_SECRETOS = [
  'configuracion_whatsapp_prestadora',
  'rpc/guardar_token_whatsapp',
  'rpc/guardar_app_secret_whatsapp',
  'rpc/guardar_verify_token_whatsapp',
  'rpc/leer_token_whatsapp',
  'configuracion_email_prestadora',
  'rpc/guardar_credencial_smtp_prestadora',
];

function noTocoLosSecretos() {
  const tocadas = llamadas
    .map((l) => l.clave)
    .filter((clave) => RASTROS_DE_LOS_SECRETOS.some((rastro) => clave.includes(rastro)));
  assert.deepEqual(tocadas, [], `el motor le preguntó a la base antes de negar: ${tocadas.join(', ')}`);
}

/** Lo que la base contesta cuando la ruta sí llega a leer y a escribir los secretos. */
function prepararLosSecretos() {
  respuestas.set('GET /rest/v1/configuracion_whatsapp_prestadora', () => [
    {
      prestadora_id: PRESTADORA,
      activo: true,
      numero_telefono: '+5490000000000',
      waba_id: 'waba-de-mentira',
      phone_number_id: 'numero-de-mentira',
      verificado_at: null,
      updated_at: new Date().toISOString(),
      app_secret_secret_id: 'cccccccc-0000-4000-8000-000000000000',
      verify_token_secret_id: 'dddddddd-0000-4000-8000-000000000000',
    },
  ]);
  respuestas.set('POST /rest/v1/configuracion_whatsapp_prestadora', () => []);
  respuestas.set('POST /rest/v1/rpc/guardar_token_whatsapp', () => null);
  respuestas.set('POST /rest/v1/rpc/guardar_app_secret_whatsapp', () => null);
  respuestas.set('POST /rest/v1/rpc/guardar_verify_token_whatsapp', () => null);

  respuestas.set('GET /rest/v1/configuracion_email_prestadora', () => [
    {
      prestadora_id: PRESTADORA,
      activo: true,
      direccion_remitente: 'avisos@dominio-de-mentira.test',
      usuario_smtp: 'avisos@dominio-de-mentira.test',
      host: 'smtp.gmail.com',
      puerto: 465,
      verificado_at: null,
      updated_at: new Date().toISOString(),
      credencial_secret_id: 'eeeeeeee-0000-4000-8000-000000000000',
    },
  ]);
  respuestas.set('POST /rest/v1/configuracion_email_prestadora', () => []);
  respuestas.set('POST /rest/v1/rpc/guardar_credencial_smtp_prestadora', () => null);
}

const CAMBIO_WHATSAPP = {
  activo: true,
  numero_telefono: '+5490000000000',
  waba_id: 'waba-de-mentira',
  phone_number_id: 'numero-de-mentira',
  token: 'un-token-de-mentira',
  app_secret: 'un-secreto-de-mentira',
  verify_token: 'un-token-de-saludo-de-mentira',
};

const CAMBIO_EMAIL = {
  activo: true,
  direccion_remitente: 'avisos@dominio-de-mentira.test',
  usuario_smtp: 'avisos@dominio-de-mentira.test',
  host: 'smtp.gmail.com',
  puerto: 465,
  password: 'una-contrasena-de-mentira',
};

/**
 * Las rutas que tocan un secreto de la Prestadora, cada una con qué tiene que decir su negativa.
 * Cuando aparezca el próximo secreto, se agrega acá y queda cubierto por todo lo de abajo.
 */
const RUTAS_DE_LOS_SECRETOS = [
  ['GET', '/whatsapp', undefined, /credenciales de WhatsApp/i],
  ['PATCH', '/whatsapp', CAMBIO_WHATSAPP, /credenciales de WhatsApp/i],
  ['GET', '/email-remitente', undefined, /correo saliente/i],
  ['PATCH', '/email-remitente', CAMBIO_EMAIL, /correo saliente/i],
];

// ---------------------------------------------------------------------------------------

describe('Superadmin no llega a los secretos de una Prestadora', () => {
  for (const [metodo, ruta, cuerpo, mensajeEsperado] of RUTAS_DE_LOS_SECRETOS) {
    it(`${metodo} ${ruta}, aun con la sesión de soporte abierta`, async () => {
      rolDelUsuario = 'superadmin';
      prestadoraDelUsuario = null;
      sesionDeSoporteAbierta = true;
      // Se prepara todo lo que la ruta necesitaría: si el candado no cortara, contestaría 200.
      prepararLosSecretos();

      const { estado, cuerpo: respuesta } = await pedir(metodo, ruta, cuerpo);
      assert.equal(estado, 403);
      // El mensaje explica de quién es el secreto, y no nombra ninguna tabla ni columna de la
      // base (CLAUDE.md §6).
      assert.match(respuesta.error, mensajeEsperado);
      assert.doesNotMatch(
        respuesta.error,
        /configuracion_whatsapp|configuracion_email|select|column|relation|vault/i
      );
      noTocoLosSecretos();
    });
  }

  it('tampoco se entera de si las de WhatsApp están cargadas: el 403 no trae ningún dato', async () => {
    rolDelUsuario = 'superadmin';
    prestadoraDelUsuario = null;
    sesionDeSoporteAbierta = true;
    prepararLosSecretos();

    const { cuerpo } = await pedir('GET', '/whatsapp');
    assert.deepEqual(Object.keys(cuerpo), ['error']);
    assert.equal(cuerpo.whatsapp, undefined);
  });

  it('ni de si hay contraseña de correo cargada', async () => {
    rolDelUsuario = 'superadmin';
    prestadoraDelUsuario = null;
    sesionDeSoporteAbierta = true;
    prepararLosSecretos();

    const { cuerpo } = await pedir('GET', '/email-remitente');
    assert.deepEqual(Object.keys(cuerpo), ['error']);
    assert.equal(cuerpo.emailRemitente, undefined);
  });

  it('y el resto de la configuración le sigue quedando abierto', async () => {
    // El candado angosto es de estas rutas y de ninguna más: si se hubiera cerrado el router
    // entero, Superadmin dejaría de poder dar soporte sobre la configuración de una Prestadora.
    rolDelUsuario = 'superadmin';
    prestadoraDelUsuario = null;
    sesionDeSoporteAbierta = true;
    respuestas.set('GET /rest/v1/configuracion_prestadora', () => [{ prestadora_id: PRESTADORA, nombre: 'De mentira' }]);

    const { estado, cuerpo } = await pedir('GET', '/empresa');
    assert.equal(estado, 200);
    assert.equal(cuerpo.empresa.prestadora_id, PRESTADORA);
  });
});

describe('el Coordinador tampoco', () => {
  for (const [metodo, ruta, cuerpo] of RUTAS_DE_LOS_SECRETOS) {
    it(`${metodo} ${ruta}`, async () => {
      rolDelUsuario = 'coordinador';
      prepararLosSecretos();

      const { estado } = await pedir(metodo, ruta, cuerpo);
      assert.equal(estado, 403);
      noTocoLosSecretos();
    });
  }
});

describe('Admin_prestadora sí llega a los secretos de su Prestadora', () => {
  it('lee las de WhatsApp, y lo que vuelve dice si están cargadas pero nunca qué dicen', async () => {
    prepararLosSecretos();

    const { estado, cuerpo } = await pedir('GET', '/whatsapp');
    assert.equal(estado, 200);
    assert.equal(cuerpo.whatsapp.token_cargado, true);
    assert.equal(cuerpo.whatsapp.app_secret_cargado, true);
    assert.equal(cuerpo.whatsapp.verify_token_cargado, true);
    // Ni el contenido de los secretos ni la referencia a la caja fuerte viajan al navegador.
    assert.equal(cuerpo.whatsapp.app_secret_secret_id, undefined);
    assert.equal(cuerpo.whatsapp.verify_token_secret_id, undefined);
    assert.equal(JSON.stringify(cuerpo).includes('cccccccc-0000-4000-8000-000000000000'), false);
  });

  it('la lectura va acotada a su propia Prestadora', async () => {
    prepararLosSecretos();
    await pedir('GET', '/whatsapp');
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/configuracion_whatsapp_prestadora');
    assert.ok(busqueda.url.includes(`prestadora_id=eq.${PRESTADORA}`));
  });

  it('las guarda: los tres secretos van a la caja fuerte, cada uno por su función', async () => {
    prepararLosSecretos();

    const { estado, cuerpo } = await pedir('PATCH', '/whatsapp', CAMBIO_WHATSAPP);
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo, { ok: true });

    for (const funcion of ['guardar_token_whatsapp', 'guardar_app_secret_whatsapp', 'guardar_verify_token_whatsapp']) {
      const guardado = llamadas.find((l) => l.clave === `POST /rest/v1/rpc/${funcion}`);
      assert.ok(guardado, `no se llamó a ${funcion}`);
      assert.equal(guardado.cuerpo.p_prestadora_id, PRESTADORA);
    }
  });

  it('lee el remitente de correo, y la contraseña no viaja: sólo si está cargada', async () => {
    prepararLosSecretos();

    const { estado, cuerpo } = await pedir('GET', '/email-remitente');
    assert.equal(estado, 200);
    assert.equal(cuerpo.emailRemitente.credencial_cargada, true);
    assert.equal(cuerpo.emailRemitente.credencial_secret_id, undefined);
    assert.equal(JSON.stringify(cuerpo).includes('eeeeeeee-0000-4000-8000-000000000000'), false);
  });

  it('la lectura del remitente también va acotada a su propia Prestadora', async () => {
    prepararLosSecretos();
    await pedir('GET', '/email-remitente');
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/configuracion_email_prestadora');
    assert.ok(busqueda.url.includes(`prestadora_id=eq.${PRESTADORA}`));
  });

  it('guarda la contraseña del correo en la caja fuerte, por su función', async () => {
    prepararLosSecretos();

    const { estado } = await pedir('PATCH', '/email-remitente', CAMBIO_EMAIL);
    assert.equal(estado, 200);

    const guardado = llamadas.find((l) => l.clave === 'POST /rest/v1/rpc/guardar_credencial_smtp_prestadora');
    assert.ok(guardado, 'no se llamó a guardar_credencial_smtp_prestadora');
    assert.equal(guardado.cuerpo.p_prestadora_id, PRESTADORA);
  });
});

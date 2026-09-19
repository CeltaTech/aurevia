/**
 * El alta de una Prestadora.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Hasta ahora una Prestadora sólo aparecía sembrando la base local o
 * corriendo un guión de prueba: el Panel las listaba y no las creaba. El alta es el momento en el
 * que se declara cómo se llama, en qué país trabaja y a qué casilla quiere que le lleguen las
 * respuestas de los avisos, y de ahí cuelga todo lo demás. Un alta que sale a medias —o que
 * rechaza algo y lo crea igual— deja una Prestadora que nadie pidió, con un nombre que puede
 * chocar con otra.
 *
 * Lo que se prueba es el camino entero: se levanta el router de verdad contra una base de
 * mentira, se pide el alta en cada situación y se mira qué contesta. En los casos que se rechazan
 * se comprueba, además, que **no haya creado nada**. Y en todos, que el mensaje que sale hacia
 * afuera no describa la base (`celtatech/CLAUDE.md` §6).
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA_PROPIA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';
const NUEVA = '33333333-3333-3333-3333-333333333333';
const ADMINISTRADOR = '44444444-4444-4444-4444-444444444444';
/** Un dominio de casilla gratuita, el único que el catálogo de mentira reconoce como tal. */
const DOMINIO_GRATUITO = 'correo-gratis.example';

/** Las casillas de envío que ya están tomadas. Cada prueba carga las que le interesan. */
let casillasTomadas = [];

/** El identificador que el servicio de correo le da al reenvío recién abierto. */
const REGLA = 'regla-de-mentira';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, para poder afirmar que NO pidió algo. */
let llamadas = [];
/** Lo mismo, del lado del servicio de correo que abre y corta los reenvíos. */
let pedidosDeCorreo = [];
/** Qué contesta ese servicio. Una prueba lo cambia para hacerlo fallar. */
let correoContesta;

/** Para que una prueba pueda hacer fallar a la base con el error que quiera. */
function falla(estado, cuerpo) {
  return { __falla: { estado, cuerpo } };
}

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, url: req.url, cuerpo: crudo ? JSON.parse(crudo) : null });

    // A la respuesta preparada se le pasa el pedido entero: dos consultas distintas a la misma
    // tabla llegan por la misma ruta y se distinguen por lo que preguntan.
    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada({ url: req.url, metodo: req.method }) : preparada;
    if (valor === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }

    if (valor && valor.__falla) {
      res.writeHead(valor.__falla.estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(valor.__falla.cuerpo));
      return;
    }

    const unoSolo = (req.headers.accept || '').includes('vnd.pgrst.object+json');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(unoSolo && Array.isArray(valor) ? valor[0] ?? null : valor));
  });
});

// El servicio que abre y corta los reenvíos, de mentira. Contesta como Cloudflare: lo que
// devuelve viene adentro de `result`.
const correoFalso = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    pedidosDeCorreo.push({ metodo: req.method, ruta, cuerpo: crudo ? JSON.parse(crudo) : null });
    const { estado, resultado } = correoContesta({ metodo: req.method, ruta });
    res.writeHead(estado, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: estado === 200, result: resultado ?? null }));
  });
});

await new Promise((listo) => correoFalso.listen(0, '127.0.0.1', listo));
process.env.CLOUDFLARE_API_BASE = `http://127.0.0.1:${correoFalso.address().port}`;
process.env.CLOUDFLARE_EMAIL_ROUTING_TOKEN = 'token-de-mentira';
process.env.CLOUDFLARE_ACCOUNT_ID = 'cuenta-de-mentira';
process.env.CLOUDFLARE_ZONE_ID = 'zona-de-mentira';

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';
// Sin dirección del Panel, el correo de primera contraseña no se arma y se anota en el registro
// del servidor. Es a propósito: lo que se prueba acá es el alta, y el correo de activación tiene
// su propio camino. Se borra en vez de darla por ausente, para que la prueba dé lo mismo corra
// donde corra.
delete process.env.PANEL_URL;
// El dominio bajo el que cuelga la dirección de cada Prestadora sale de la dirección común del
// producto, así que acá se fija una de mentira: sin ella no habría dominio y no se podría
// comprobar con qué dirección queda la Prestadora nueva.
process.env.REMITENTE_AVISOS = 'avisos@producto.example';

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const { panelPrestadorasRouter } = await import('../panelPrestadoras.js');

const app = express();
app.use(express.json());
app.use('/api/panel/prestadoras', panelPrestadorasRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/prestadoras`;

after(() => {
  motor.close();
  baseFalsa.close();
  correoFalso.close();
});

/**
 * Lo que contesta el servicio de correo cuando todo sale bien: el reenvío se abre y la casilla de
 * destino todavía no está confirmada, que es como queda recién dada de alta.
 */
function correoNormal({ metodo, ruta }) {
  if (metodo === 'POST' && ruta.endsWith('/email/routing/rules')) {
    return { estado: 200, resultado: { tag: REGLA } };
  }
  if (metodo === 'GET' && ruta.endsWith('/email/routing/addresses')) {
    return { estado: 200, resultado: [{ email: ALTA_COMPLETA.email_respuestas, verified: null }] };
  }
  return { estado: 200, resultado: {} };
}

/** Lo que el motor le pidió al servicio de correo, si se lo pidió. */
function pedidoDeCorreo(metodo, final) {
  return pedidosDeCorreo.find((p) => p.metodo === metodo && p.ruta.includes(final));
}

/** Un alta con todo bien cargado. Cada prueba cambia lo que le interesa romper. */
const ALTA_COMPLETA = {
  razon_social: 'Cuidados del Litoral S.A.',
  nombre_fantasia: 'Cuidados del Litoral',
  identificacion_fiscal: '30-11111111-9',
  pais: 'AR',
  email_respuestas: 'respuestas@cuidadosdellitoral.example',
  admin_nombre: 'Marta Riquelme',
  admin_email: 'marta.riquelme@cuidadosdellitoral.example',
  admin_telefono: '11-5555-0000',
};

async function darDeAlta(cambios = {}) {
  const respuesta = await fetch(DIRECCION, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...ALTA_COMPLETA, ...cambios }),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

beforeEach(() => {
  llamadas = [];
  pedidosDeCorreo = [];
  correoContesta = correoNormal;
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'superadmin', prestadora_id: PRESTADORA_PROPIA }]);
  // Sin segundo factor obligatorio y sin sesión de soporte abierta: lo que se está probando es
  // el alta, no la puerta de entrada, que tiene sus propias pruebas.
  respuestas.set('GET /rest/v1/configuracion_plataforma', () => [{ mfa_admin_obligatorio: false }]);
  respuestas.set('GET /rest/v1/sesiones_soporte_tecnico', () => []);
  // El país está en el catálogo, la Prestadora se crea, la casilla se guarda y la auditoría entra.
  respuestas.set('GET /rest/v1/monedas_por_pais', () => [{ pais: 'AR', moneda: 'ARS' }]);
  respuestas.set('POST /rest/v1/prestadoras', () => [
    { id: NUEVA, nombre_fantasia: ALTA_COMPLETA.nombre_fantasia, estado: 'prospecto' },
  ]);
  respuestas.set('PATCH /rest/v1/configuracion_prestadora', () => []);
  // Donde queda anotado el reenvío recién abierto, para poder cortarlo después.
  respuestas.set('PATCH /rest/v1/prestadoras', () => []);
  respuestas.set('POST /rest/v1/auditoria_soporte_tecnico', () => []);
  // El acceso del administrador: la cuenta de acceso se crea y su ficha se guarda. El servicio
  // de acceso devuelve la cuenta suelta, no adentro de una lista.
  respuestas.set('POST /auth/v1/admin/users', () => ({ id: ADMINISTRADOR }));
  respuestas.set('POST /rest/v1/usuarios', () => []);
  respuestas.set('POST /rest/v1/membresias', () => []);
  // Y lo que se usa sólo cuando el alta se deshace.
  respuestas.set('DELETE /rest/v1/prestadoras', () => []);
  // La dirección desde la que va a mandar. El catálogo dice qué dominios son de una casilla
  // gratuita, y la consulta a `prestadoras` contesta dos preguntas distintas: qué casillas
  // están tomadas —para no repetir ninguna— y con cuál quedó la Prestadora recién creada, que
  // es la que se acaba de escribir.
  casillasTomadas = [];
  respuestas.set('GET /rest/v1/dominios_de_correo_gratuitos', ({ url }) => (
    url.includes(`dominio=eq.${DOMINIO_GRATUITO}`) ? [{ dominio: DOMINIO_GRATUITO }] : []
  ));
  respuestas.set('GET /rest/v1/prestadoras', ({ url }) => (
    url.includes('id=eq.')
      ? [{ casilla_envio: filaEscritaEn('POST /rest/v1/prestadoras')?.casilla_envio ?? null }]
      : casillasTomadas.map((casilla_envio) => ({ casilla_envio }))
  ));
});

/**
 * La fila que el motor mandó a escribir en esa tabla. Una escritura de una sola fila viaja como
 * objeto suelto y una de varias como lista: acá se devuelve siempre la fila, para que la prueba
 * mire lo que se escribió y no cómo viajó.
 */
function filaEscritaEn(clave) {
  const escritura = llamadas.find((l) => l.clave === clave);
  if (!escritura) return null;
  return Array.isArray(escritura.cuerpo) ? escritura.cuerpo[0] : escritura.cuerpo;
}

/** Que el rechazo haya sido de verdad: no quedó ninguna Prestadora creada. */
function noCreo() {
  const escrituras = llamadas.filter((l) => l.clave === 'POST /rest/v1/prestadoras');
  assert.deepEqual(escrituras, [], 'el motor creó la Prestadora igual, después de decir que no');
}

/** Que el alta se haya deshecho de verdad: la Prestadora que alcanzó a crearse quedó borrada. */
function seDeshizo() {
  const borrado = llamadas.find((l) => l.clave === 'DELETE /rest/v1/prestadoras');
  assert.ok(borrado, 'quedó creada una Prestadora sin administrador');
  assert.match(
    borrado.url,
    new RegExp(`id=eq\\.${NUEVA}`),
    'borró por un identificador que no es el de la Prestadora recién creada'
  );
}

/**
 * Que el mensaje no describa la base (`celtatech/CLAUDE.md` §6). Se mira el texto, no el motivo:
 * el motivo es un código que la pantalla traduce y nunca se muestra tal cual.
 */
function noFiltraLaBase(cuerpo) {
  const texto = String(cuerpo?.error ?? '');
  assert.doesNotMatch(
    texto,
    /monedas_por_pais|configuracion_prestadora|nombre_fantasia|duplicate key|violates|constraint|column|relation|PGRST/i,
    `el mensaje nombra algo de la base: ${texto}`
  );
}

// ---------------------------------------------------------------------------------------

describe('lo que falta o viene mal cargado no crea nada', () => {
  it('sin nombre de fantasía', async () => {
    const { estado, cuerpo } = await darDeAlta({ nombre_fantasia: '   ' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'faltan_datos');
    noCreo();
    noFiltraLaBase(cuerpo);
  });

  it('sin razón social', async () => {
    const { estado, cuerpo } = await darDeAlta({ razon_social: '' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'faltan_datos');
    noCreo();
  });

  it('sin país', async () => {
    const { estado, cuerpo } = await darDeAlta({ pais: '' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'faltan_datos');
    noCreo();
  });

  it('sin casilla de respuestas', async () => {
    const { estado, cuerpo } = await darDeAlta({ email_respuestas: '' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'faltan_datos');
    noCreo();
  });

  it('con la casilla de respuestas mal escrita', async () => {
    const { estado, cuerpo } = await darDeAlta({ email_respuestas: 'esto no es una direccion' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'correo_invalido');
    noCreo();
    noFiltraLaBase(cuerpo);
  });

  it('sin nombre del administrador', async () => {
    const { estado, cuerpo } = await darDeAlta({ admin_nombre: '   ' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'faltan_datos');
    noCreo();
  });

  it('sin correo del administrador', async () => {
    const { estado, cuerpo } = await darDeAlta({ admin_email: '' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'faltan_datos');
    noCreo();
  });

  it('con el correo del administrador mal escrito', async () => {
    const { estado, cuerpo } = await darDeAlta({ admin_email: 'marta arroba ejemplo' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'correo_invalido');
    noCreo();
    noFiltraLaBase(cuerpo);
  });

  it('la identificación fiscal no es obligatoria', async () => {
    const { estado } = await darDeAlta({ identificacion_fiscal: '' });
    assert.equal(estado, 201);
    assert.equal(filaEscritaEn('POST /rest/v1/prestadoras').identificacion_fiscal, null);
  });
});

describe('el país se comprueba antes de crear nada', () => {
  it('un país que no tiene moneda cargada se rechaza y no crea la Prestadora', async () => {
    // Si se insertara igual, el disparador que completa la moneda abortaría con una excepción de
    // la base, y esa excepción nombra tablas y columnas.
    respuestas.set('GET /rest/v1/monedas_por_pais', () => []);
    const { estado, cuerpo } = await darDeAlta({ pais: 'ZZ' });
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'pais_sin_moneda');
    noCreo();
    noFiltraLaBase(cuerpo);
  });

  it('el país se guarda en mayúsculas, escríbase como se escriba', async () => {
    await darDeAlta({ pais: 'ar' });
    assert.equal(filaEscritaEn('POST /rest/v1/prestadoras').pais, 'AR');
  });

  it('si no se pudo consultar el catálogo, no se crea nada', async () => {
    // Falla cerrado (`celtatech/CLAUDE.md` §5): crear sin haber mirado es justamente lo que esta
    // comprobación vino a impedir.
    respuestas.set('GET /rest/v1/monedas_por_pais', () => falla(500, { message: 'la base no contestó' }));
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 500);
    noCreo();
    noFiltraLaBase(cuerpo);
  });
});

describe('dos Prestadoras no se llaman igual', () => {
  it('el nombre repetido se dice como tal, no como una falla del sistema', async () => {
    respuestas.set('POST /rest/v1/prestadoras', () =>
      falla(409, {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "prestadoras_nombre_fantasia_unico"',
      })
    );
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'nombre_de_prestadora_repetido');
    // El texto crudo de la base nombra la restricción: acá se comprueba que no salió hacia afuera.
    noFiltraLaBase(cuerpo);
  });
});

describe('el alta que sale bien', () => {
  it('crea la Prestadora, guarda la casilla y deja el renglón de auditoría', async () => {
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 201);
    assert.equal(cuerpo.prestadora.id, NUEVA);
    assert.equal(cuerpo.casilla_respuestas_guardada, true);

    const escritura = filaEscritaEn('POST /rest/v1/prestadoras');
    assert.ok(escritura, 'dijo que la creó y no escribió nada');
    assert.equal(escritura.nombre_fantasia, ALTA_COMPLETA.nombre_fantasia);
    assert.equal(escritura.razon_social, ALTA_COMPLETA.razon_social);
    assert.match(escritura.fecha_alta, /^\d{4}-\d{2}-\d{2}$/);
    // Quien da de alta no elige el estado: lo pone la base.
    assert.equal(escritura.estado, undefined);

    const casilla = filaEscritaEn('PATCH /rest/v1/configuracion_prestadora');
    assert.ok(casilla, 'creó la Prestadora y se olvidó la casilla de respuestas');
    assert.equal(casilla.email, ALTA_COMPLETA.email_respuestas);

    const auditoria = filaEscritaEn('POST /rest/v1/auditoria_soporte_tecnico');
    assert.ok(auditoria, 'creó la Prestadora y no quedó registro de quién lo hizo');
    assert.equal(auditoria.admin_id, USUARIO);
    assert.equal(auditoria.prestadora_id, NUEVA);
    assert.equal(auditoria.tabla_afectada, 'prestadoras');
    assert.equal(auditoria.operacion, 'INSERT');
  });

  it('los espacios de más no crean nombres distintos', async () => {
    await darDeAlta({ nombre_fantasia: '  Cuidados del Litoral  ' });
    assert.equal(filaEscritaEn('POST /rest/v1/prestadoras').nombre_fantasia, 'Cuidados del Litoral');
  });
});

describe('la Prestadora nace con su dirección de envío', () => {
  it('el nombre sale del dominio propio que declaró', async () => {
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 201);
    assert.equal(filaEscritaEn('POST /rest/v1/prestadoras').casilla_envio, 'cuidadosdellitoral');
    assert.equal(cuerpo.direccion_envio, 'cuidadosdellitoral@producto.example');
  });

  it('si la casilla que declaró es gratuita, el nombre sale de su nombre de fantasía', async () => {
    const { cuerpo } = await darDeAlta({ email_respuestas: `cuidados@${DOMINIO_GRATUITO}` });
    assert.equal(filaEscritaEn('POST /rest/v1/prestadoras').casilla_envio, 'cuidados-del-litoral');
    assert.equal(cuerpo.direccion_envio, 'cuidados-del-litoral@producto.example');
  });

  it('los acentos y los signos no llegan a la dirección', async () => {
    await darDeAlta({
      nombre_fantasia: 'Atención Domiciliaria Ñandú & Cía.',
      email_respuestas: `hola@${DOMINIO_GRATUITO}`,
    });
    assert.equal(
      filaEscritaEn('POST /rest/v1/prestadoras').casilla_envio,
      'atencion-domiciliaria-nandu-cia',
    );
  });

  it('si el nombre ya está tomado, se le agrega un sufijo', async () => {
    casillasTomadas = ['cuidadosdellitoral', 'cuidadosdellitoral-2'];
    await darDeAlta();
    assert.equal(filaEscritaEn('POST /rest/v1/prestadoras').casilla_envio, 'cuidadosdellitoral-3');
  });

  it('ninguna Prestadora manda desde la dirección común del producto', async () => {
    await darDeAlta({
      nombre_fantasia: 'Avisos',
      email_respuestas: `contacto@${DOMINIO_GRATUITO}`,
    });
    assert.equal(filaEscritaEn('POST /rest/v1/prestadoras').casilla_envio, 'avisos-2');
  });

  it('si el nombre elegido chocó con otro, se elige otro y la Prestadora entra igual', async () => {
    // Dos altas al mismo tiempo pueden elegir la misma casilla: la segunda choca contra el
    // índice. La base contesta el choque una sola vez; al reintentar, ya con esa casilla
    // tomada, el alta sale.
    let intentos = 0;
    respuestas.set('POST /rest/v1/prestadoras', () => {
      intentos += 1;
      if (intentos === 1) {
        return falla(409, { code: '23505', message: 'duplicate key value violates unique constraint "prestadoras_casilla_envio_unica"' });
      }
      return [{ id: NUEVA, nombre_fantasia: ALTA_COMPLETA.nombre_fantasia, estado: 'prospecto' }];
    });
    respuestas.set('GET /rest/v1/prestadoras', ({ url }) => (
      url.includes('id=eq.')
        ? [{ casilla_envio: 'cuidadosdellitoral-2' }]
        : (intentos === 0 ? [] : [{ casilla_envio: 'cuidadosdellitoral' }])
    ));

    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 201);
    assert.equal(intentos, 2, 'no volvió a intentar con otra casilla');
    assert.equal(cuerpo.direccion_envio, 'cuidadosdellitoral-2@producto.example');
  });
});

describe('las respuestas vuelven a la casilla que declaró', () => {
  it('abre el reenvío desde su dirección de envío hacia esa casilla', async () => {
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 201);
    assert.equal(cuerpo.reenvio_abierto, true);

    const abierto = pedidoDeCorreo('POST', '/email/routing/rules');
    assert.ok(abierto, 'la Prestadora manda desde una dirección a la que nadie puede contestarle');
    assert.equal(abierto.cuerpo.matchers[0].value, 'cuidadosdellitoral@producto.example');
    assert.deepEqual(abierto.cuerpo.actions[0].value, [ALTA_COMPLETA.email_respuestas]);
    assert.equal(abierto.cuerpo.enabled, true);
  });

  it('anota el reenvío en la Prestadora, que es con lo que después se corta', async () => {
    await darDeAlta();
    const anotado = filaEscritaEn('PATCH /rest/v1/prestadoras');
    assert.ok(anotado, 'el reenvío quedó abierto y no hay con qué cortarlo');
    assert.equal(anotado.regla_reenvio, REGLA);
  });

  it('da de alta la casilla de destino, que es lo que dispara el correo de confirmación', async () => {
    await darDeAlta();
    const destino = pedidoDeCorreo('POST', '/email/routing/addresses');
    assert.ok(destino, 'nadie le pidió a esa casilla que confirme, así que no va a llegarle nada');
    assert.equal(destino.cuerpo.email, ALTA_COMPLETA.email_respuestas);
  });

  it('dice que todavía no está confirmada mientras nadie haya hecho el clic', async () => {
    const { cuerpo } = await darDeAlta();
    assert.equal(cuerpo.respuestas_confirmadas, false);
  });

  it('y dice que sí cuando ya se hizo', async () => {
    correoContesta = ({ metodo, ruta }) => {
      if (metodo === 'GET' && ruta.endsWith('/email/routing/addresses')) {
        return {
          estado: 200,
          resultado: [{ email: ALTA_COMPLETA.email_respuestas, verified: '2026-09-16T10:00:00Z' }],
        };
      }
      return correoNormal({ metodo, ruta });
    };
    const { cuerpo } = await darDeAlta();
    assert.equal(cuerpo.respuestas_confirmadas, true);
  });

  it('si el reenvío no se pudo abrir, la Prestadora entra igual y se avisa', async () => {
    // Lo que falló es el correo, así que avisarlo por correo no serviría de nada: sale en la
    // respuesta, que es lo que el Panel muestra.
    correoContesta = () => ({ estado: 500 });
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 201);
    assert.equal(cuerpo.prestadora.id, NUEVA);
    assert.equal(cuerpo.reenvio_abierto, false);
    assert.equal(cuerpo.respuestas_confirmadas, false);
    assert.equal(filaEscritaEn('PATCH /rest/v1/prestadoras'), null);
    noFiltraLaBase(cuerpo);
  });

  it('si el alta se deshace, el reenvío se corta', async () => {
    // El reenvío vive afuera y no se va con el borrado de la Prestadora: si queda abierto, sigue
    // mandando correo a la casilla de alguien que nunca llegó a ser cliente.
    respuestas.set('POST /auth/v1/admin/users', () => falla(500, { message: 'el servicio de acceso no contestó' }));
    await darDeAlta();
    seDeshizo();
    const cortado = pedidoDeCorreo('DELETE', '/email/routing/rules/');
    assert.ok(cortado, 'quedó abierto el reenvío de una Prestadora que no existe');
    assert.ok(cortado.ruta.endsWith(`/${REGLA}`), 'cortó un reenvío que no es el que había abierto');
  });

  it('sin el servicio configurado no se intenta nada y el alta sale igual', async () => {
    // Es el estado en el que está el producto hasta que se cargue la credencial. Hasta entonces
    // la Prestadora se da de alta, manda sus avisos, y las respuestas se pierden.
    const token = process.env.CLOUDFLARE_EMAIL_ROUTING_TOKEN;
    delete process.env.CLOUDFLARE_EMAIL_ROUTING_TOKEN;
    try {
      const { estado, cuerpo } = await darDeAlta();
      assert.equal(estado, 201);
      assert.equal(cuerpo.reenvio_abierto, false);
      assert.deepEqual(pedidosDeCorreo, [], 'habló con un servicio que no está configurado');
    } finally {
      process.env.CLOUDFLARE_EMAIL_ROUTING_TOKEN = token;
    }
  });
});

describe('la Prestadora nace con su administrador', () => {
  it('le crea el acceso, con su rol y atado a la Prestadora recién creada', async () => {
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 201);
    assert.equal(cuerpo.administrador.id, ADMINISTRADOR);

    const acceso = filaEscritaEn('POST /auth/v1/admin/users');
    assert.ok(acceso, 'dio de alta la Prestadora y nadie puede entrar a configurarla');
    assert.equal(acceso.email, ALTA_COMPLETA.admin_email);

    const ficha = filaEscritaEn('POST /rest/v1/usuarios');
    assert.ok(ficha, 'creó la cuenta de acceso y no quedó la ficha de la persona');
    assert.equal(ficha.id, ADMINISTRADOR);
    assert.equal(ficha.rol, 'admin_prestadora');
    assert.equal(ficha.prestadora_id, NUEVA, 'la ató a otra Prestadora');
    assert.equal(ficha.nombre, ALTA_COMPLETA.admin_nombre);
    assert.equal(ficha.telefono, ALTA_COMPLETA.admin_telefono);
  });

  it('no devuelve ninguna contraseña', async () => {
    // La cuenta nace con una clave al azar y la persona elige la suya por correo. Que esa clave
    // llegue al Panel sería mostrarla en pantalla, y no se muestra ninguna nunca.
    const { cuerpo } = await darDeAlta();
    assert.deepEqual(Object.keys(cuerpo.administrador), ['id']);
    const clave = filaEscritaEn('POST /auth/v1/admin/users').password;
    assert.ok(clave, 'la cuenta se creó sin clave');
    assert.doesNotMatch(JSON.stringify(cuerpo), new RegExp(clave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('el teléfono no es obligatorio', async () => {
    const { estado } = await darDeAlta({ admin_telefono: '' });
    assert.equal(estado, 201);
    assert.equal(filaEscritaEn('POST /rest/v1/usuarios').telefono, null);
  });
});

describe('sin administrador no queda Prestadora', () => {
  it('si no se pudo crear el acceso, la Prestadora se borra', async () => {
    respuestas.set('POST /auth/v1/admin/users', () => falla(500, { message: 'el servicio de acceso no contestó' }));
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 500);
    seDeshizo();
    noFiltraLaBase(cuerpo);
  });

  it('si no se pudo guardar la ficha de la persona, la Prestadora se borra', async () => {
    respuestas.set('POST /rest/v1/usuarios', () => falla(500, { message: 'la base no contestó' }));
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 500);
    seDeshizo();
    noFiltraLaBase(cuerpo);
  });

  it('el correo que ya tiene cuenta se dice como tal, y tampoco queda Prestadora', async () => {
    // El caso más probable de todos: quien va a administrar esta Prestadora ya administra otra.
    // El servicio de acceso avisa en inglés y sin código propio, así que llega tal cual.
    respuestas.set('POST /auth/v1/admin/users', () =>
      falla(422, { message: 'A user with this email address has already been registered' })
    );
    // Y detrás de ese correo hay alguien de verdad: la cuenta existe y su ficha es de otra
    // Prestadora, la que la base falsa contesta en `GET /rest/v1/usuarios`.
    respuestas.set('GET /auth/v1/admin/users', () => ({
      users: [{ id: ADMINISTRADOR, email: ALTA_COMPLETA.admin_email }],
    }));
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'correo_de_otra_cuenta');
    seDeshizo();
    // El detalle lleva el identificador de la cuenta ajena: acá se comprueba que no salió.
    assert.doesNotMatch(JSON.stringify(cuerpo), new RegExp(ADMINISTRADOR));
    noFiltraLaBase(cuerpo);
  });

  it('si el borrado también falla, lo que sale es el problema de verdad', async () => {
    // Lo que tiene que llegar a la pantalla es por qué no se pudo crear el acceso, no el
    // tropiezo de la limpieza: si no, quien está dando el alta lee el problema equivocado.
    respuestas.set('POST /auth/v1/admin/users', () => falla(500, { message: 'el servicio de acceso no contestó' }));
    respuestas.set('DELETE /rest/v1/prestadoras', () => falla(500, { message: 'la base no contestó' }));
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 500);
    assert.equal(cuerpo.error, 'falla_del_sistema');
    noFiltraLaBase(cuerpo);
  });
});

describe('si la casilla de respuestas no se pudo guardar, la Prestadora existe igual', () => {
  it('contesta que se creó y avisa que quedó sin casilla', async () => {
    // Deshacer el alta sería peor: la Prestadora ya está creada y la casilla se vuelve a cargar
    // desde Configuración. Lo que no puede pasar es que nadie se entere.
    respuestas.set('PATCH /rest/v1/configuracion_prestadora', () =>
      falla(500, { message: 'la base no contestó' })
    );
    const { estado, cuerpo } = await darDeAlta();
    assert.equal(estado, 201);
    assert.equal(cuerpo.prestadora.id, NUEVA);
    assert.equal(cuerpo.casilla_respuestas_guardada, false);
    noFiltraLaBase(cuerpo);
  });
});

describe('sólo Superadmin da de alta una Prestadora', () => {
  it('quien administra una Prestadora no puede crear otra', async () => {
    respuestas.set('GET /rest/v1/usuarios', () => [
      { rol: 'admin_prestadora', prestadora_id: PRESTADORA_PROPIA },
    ]);
    const { estado } = await darDeAlta();
    assert.equal(estado, 403);
    noCreo();
  });

  it('y tampoco puede ver el catálogo de países', async () => {
    respuestas.set('GET /rest/v1/usuarios', () => [
      { rol: 'coordinador', prestadora_id: PRESTADORA_PROPIA },
    ]);
    const respuesta = await fetch(`${DIRECCION}/paises`, {
      headers: { Authorization: 'Bearer token-de-mentira' },
    });
    assert.equal(respuesta.status, 403);
  });
});

describe('el catálogo de países sale de la base', () => {
  it('devuelve lo que hay cargado, no una lista escrita en la pantalla', async () => {
    respuestas.set('GET /rest/v1/monedas_por_pais', () => [
      { pais: 'AR', moneda: 'ARS' },
      { pais: 'UY', moneda: 'UYU' },
    ]);
    const respuesta = await fetch(`${DIRECCION}/paises`, {
      headers: { Authorization: 'Bearer token-de-mentira' },
    });
    const cuerpo = await respuesta.json();
    assert.equal(respuesta.status, 200);
    assert.deepEqual(cuerpo.paises.map((p) => p.pais), ['AR', 'UY']);
  });
});

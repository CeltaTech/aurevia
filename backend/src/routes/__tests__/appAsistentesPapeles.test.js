/**
 * `GET /perfil/papeles` — la carpeta que el Asistente ve de sí mismo desde el teléfono.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. No es que la ruta conteste 200. Son tres cosas, y ninguna se ve
 * mirando la pantalla:
 *
 *   1. DE QUIÉN ES LA CARPETA LO DECIDE LA SESIÓN. El identificador del Asistente no viaja en el
 *      pedido: no hay forma de pedir la carpeta de otra persona porque no hay dónde escribirla.
 *   2. EL FILTRO DE PRESTADORA VIAJA EN LAS CUATRO CONSULTAS. El motor entra a la base con la
 *      llave de servicio y se saltea la protección por fila, así que lo único que separa una
 *      Prestadora de otra son estos filtros. Si a una consulta le faltara, nadie lo notaría
 *      mirando la pantalla: los datos se verían bien igual.
 *   3. LOS DÍAS DE AVISO SON LOS QUE CONFIGURÓ LA PRESTADORA. Con la ventana ancha, un papel que
 *      vence en dos meses ya avisa; con la de fábrica, no.
 *
 * Qué daría con el sistema roto: si alguna consulta perdiera su filtro, la prueba del aislamiento
 * falla; si la ruta ignorara la configuración de la Prestadora, el papel de dentro de dos meses
 * saldría vigente en vez de por vencer.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { olvidarPedidos } from '../../middleware/topeDePedidos.js';

const PRESTADORA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USUARIO = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // usuarios.id === asistentes.id === auth.uid()

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con la dirección entera: los filtros van ahí. */
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, url: req.url });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada({ url: req.url }) : preparada;
    if (valor === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }

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
const { appAsistentesRouter } = await import('../appAsistentes.js');

const app = express();
app.use(express.json());
app.use('/api/app-asistentes', appAsistentesRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/app-asistentes`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function pedirPapeles() {
  const respuesta = await fetch(`${DIRECCION}/perfil/papeles`, {
    headers: { Authorization: 'Bearer token-de-mentira' },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** Dentro de cuántos días cae una fecha, dicho en el formato de día que usa la base. */
function enDias(dias) {
  const dia = new Date();
  dia.setDate(dia.getDate() + dias);
  return dia.toISOString().slice(0, 10);
}

/** Las direcciones con las que se consultó una tabla. Los filtros están ahí. */
function consultasA(tabla) {
  return llamadas.filter((l) => l.clave === `GET /rest/v1/${tabla}`).map((l) => l.url);
}

/** Lo exigido, lo cargado, el Certificado y la ventana de aviso, que cada prueba acomoda. */
let tiposExigidos;
let documentos;
let certificado;
let diasAviso;

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  // El tope de pedidos por minuto lleva su cuenta en la memoria del proceso y todas las pruebas
  // entran con el mismo Asistente: sin esto, las últimas fallarían por algo que no prueban.
  olvidarPedidos();
  delete process.env.TOPE_PEDIDOS_POR_MINUTO;

  tiposExigidos = [
    { id: 't-1', nombre: 'Apto médico', requiere_vencimiento: true },
    { id: 't-2', nombre: 'Libreta sanitaria', requiere_vencimiento: true },
  ];
  documentos = [{ tipo_documento_id: 't-1', fecha_vencimiento: enDias(200) }];
  certificado = null;
  diasAviso = null;

  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'asistente', prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/tipos_documento_asistente', () => tiposExigidos);
  respuestas.set('GET /rest/v1/documentos_asistente', () => documentos);
  respuestas.set('GET /rest/v1/certificados', () => (certificado ? [certificado] : []));
  respuestas.set('GET /rest/v1/prestadoras', () => [{ dias_aviso_vencimiento_documentos: diasAviso }]);
});

describe('la carpeta de papeles del Asistente, desde el teléfono', () => {
  it('lo que le exigen y nunca cargó también sale, y con su nombre', async () => {
    const { estado, cuerpo } = await pedirPapeles();
    assert.equal(estado, 200);
    assert.equal(cuerpo.carpeta.papeles.length, 2);
    const libreta = cuerpo.carpeta.papeles.find((p) => p.tipo_documento_id === 't-2');
    assert.equal(libreta.estado, 'sin_cargar');
    assert.equal(libreta.nombre, 'Libreta sanitaria');
    assert.equal(cuerpo.carpeta.resumen, 'incompleta');
  });

  it('sin Certificado emitido no dice que esté vencido: dice que no hay', async () => {
    const { cuerpo } = await pedirPapeles();
    assert.equal(cuerpo.certificado, null);
  });

  it('el Certificado dado de baja sale como tal aunque la fecha no haya llegado', async () => {
    certificado = { activo: false, fecha_emision: '2026-01-10', fecha_vencimiento: enDias(300) };
    const { cuerpo } = await pedirPapeles();
    assert.equal(cuerpo.certificado.estado, 'dado_de_baja');
  });

  it('los días de aviso son los que configuró la Prestadora, no los de fábrica', async () => {
    documentos = [
      { tipo_documento_id: 't-1', fecha_vencimiento: enDias(60) },
      { tipo_documento_id: 't-2', fecha_vencimiento: enDias(60) },
    ];

    const conLosDeFabrica = await pedirPapeles();
    assert.equal(conLosDeFabrica.cuerpo.carpeta.resumen, 'al_dia');

    llamadas = [];
    olvidarPedidos();
    diasAviso = 90;
    const conLaVentanaAncha = await pedirPapeles();
    assert.equal(conLaVentanaAncha.cuerpo.carpeta.resumen, 'por_vencer');
  });

  // ESTO ES LO QUE AÍSLA UNA PRESTADORA DE OTRA. El motor entra con la llave de servicio y se
  // saltea la protección por fila: si una de estas cuatro consultas perdiera su filtro, traería
  // los papeles de otra Prestadora y la pantalla se vería igual de bien.
  it('las cuatro consultas van filtradas por la Prestadora de la sesión', async () => {
    await pedirPapeles();
    for (const tabla of ['tipos_documento_asistente', 'documentos_asistente', 'certificados']) {
      const consultas = consultasA(tabla);
      assert.equal(consultas.length, 1, `se consultó ${tabla} ${consultas.length} veces`);
      assert.ok(
        consultas[0].includes(`prestadora_id=eq.${PRESTADORA}`),
        `la consulta a ${tabla} no lleva el filtro de Prestadora`
      );
    }
    assert.ok(consultasA('prestadoras')[0].includes(`id=eq.${PRESTADORA}`));
  });

  it('de quién es la carpeta lo decide la sesión, y se pide siempre por ese Asistente', async () => {
    await pedirPapeles();
    assert.ok(consultasA('documentos_asistente')[0].includes(`asistente_id=eq.${USUARIO}`));
    assert.ok(consultasA('certificados')[0].includes(`asistente_id=eq.${USUARIO}`));
  });

  it('sin sesión no hay carpeta', async () => {
    const respuesta = await fetch(`${DIRECCION}/perfil/papeles`);
    assert.equal(respuesta.status, 401);
  });

  it('quien no es Asistente no entra, aunque tenga sesión', async () => {
    respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'coordinador', prestadora_id: PRESTADORA }]);
    const { estado } = await pedirPapeles();
    assert.equal(estado, 403);
  });
});

// `GET /perfil` devuelve el mismo Certificado que la carpeta, por una consulta propia. Son dos
// consultas a la misma tabla escritas en dos lugares, y una de ellas estuvo sin el filtro de
// Prestadora: se veía igual de bien, porque el identificador del Asistente ya alcanza mientras
// nunca se repita. Lo que separa una Prestadora de otra son estos filtros, así que el que falta
// no lo encuentra nadie mirando la pantalla.
describe('el Certificado que viaja con el perfil', () => {
  beforeEach(() => {
    respuestas.set('GET /rest/v1/asistentes', () => [
      { id: USUARIO, nombre: 'Nombre Inventado', telefono: null, email: 'inventado@ejemplo.test',
        foto_url: null, tipo_asistente_id: null, estado: 'activo',
        tipo_vinculo: 'monotributo', qr_token: 'x', canales: [],
        disponible_para_ofertas: true, disponibilidad_cambiada_en: null, tipos_asistente: null },
    ]);
    // Dónde acepta trabajar sale de sus lugares y del catálogo, no de un renglón de la ficha.
    respuestas.set('GET /rest/v1/asistente_lugares', () => []);
    respuestas.set('GET /rest/v1/lugares', () => []);
  });

  it('la consulta del Certificado va filtrada por la Prestadora de la sesión', async () => {
    const respuesta = await fetch(`${DIRECCION}/perfil`, {
      headers: { Authorization: 'Bearer token-de-mentira' },
    });
    assert.equal(respuesta.status, 200);
    const consultas = consultasA('certificados');
    assert.equal(consultas.length, 1);
    assert.ok(
      consultas[0].includes(`prestadora_id=eq.${PRESTADORA}`),
      'la consulta del Certificado no lleva el filtro de Prestadora'
    );
    assert.ok(consultas[0].includes(`asistente_id=eq.${USUARIO}`));
  });
});

/**
 * El período de gracia de un cobro que no entró, y la suspensión cuando se termina.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El §3.2 del `docs/PRD_07_Modalidad_Marketplace.md` pide «ni corte en
 * el acto ni reintentos indefinidos sin avisar», y las dos mitades de esa frase se rompen de maneras
 * opuestas:
 *
 *   * si la gracia no se abre, o se abre y nadie la mira, un cobro que falló apaga el acceso el
 *     mismo día, que es justo lo que este trabajo vino a sacar;
 *   * si la gracia se vuelve a abrir con cada reintento del proveedor, la fecha se corre para
 *     adelante sin parar y el acceso no se suspende nunca;
 *   * si se avisa una vez por reintento, el aviso deja de leerse antes del día que importa;
 *   * y si la suspensión no vuelve a exigir sus condiciones al guardar, apaga un acceso que alguien
 *     acaba de pagar entre la consulta y el guardado.
 *
 * La entrega del push se reemplaza acá, por el mismo motivo que en `avisoPrevioAlCobro.test.js`:
 * `web-push` sólo entrega contra una dirección segura, así que no hay servicio de mentira posible.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const ACCESO = '33333333-3333-3333-3333-333333333333';
const OTRO_ACCESO = '55555555-5555-5555-5555-555555555555';
const FAMILIA = '11111111-1111-1111-1111-111111111111';
const PACIENTE = '22222222-2222-2222-2222-222222222222';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba pisa lo que necesita cambiar. */
const respuestas = new Map();
/** Todo lo que se le pidió a la base, para poder afirmar que NO se pidió algo. */
let llamadas = [];
/** Los avisos que se le mandaron a cada Familia. */
let empujados = [];
/** Los avisos que quedaron del lado del servidor. Se juntan para no ensuciar la salida. */
let anotados = [];

function avisarDeMentira(familiaId, texto) {
  empujados.push({ familiaId, texto });
  return Promise.resolve(true);
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

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada() : preparada;
    if (valor === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }

    if (valor && valor.__falla) {
      res.writeHead(valor.__falla.codigo ?? 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: valor.__falla.message }));
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

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma en
// el momento en que se importa el archivo.
const { abrirElPeriodoDeGracia, suspenderLosQueAgotaronLaGracia, textoDelAvisoDeGracia } =
  await import('../periodoDeGracia.js');

const avisarDeVerdad = console.error;
console.error = (...partes) => anotados.push(partes.join(' '));

after(() => {
  console.error = avisarDeVerdad;
  baseFalsa.close();
});

const HOY = new Date().toISOString().slice(0, 10);

function corrido(dias) {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** Un acceso vigente al que se le acaba de rebotar el cobro, sin ninguna gracia abierta. */
function accesoConCobroFallido(cambios = {}) {
  return {
    id: ACCESO,
    estado: 'vigente',
    familia_id: FAMILIA,
    paciente_id: PACIENTE,
    importe: '4500.00',
    moneda: 'ARS',
    gracia_hasta: null,
    ...cambios,
  };
}

/** Lo que la base recibió para guardar, o `undefined` si no se guardó nada. */
function loGuardado() {
  return llamadas.find((l) => l.clave === 'PATCH /rest/v1/accesos_marketplace');
}

beforeEach(() => {
  llamadas = [];
  empujados = [];
  anotados = [];
  respuestas.clear();
});

describe('cuando un cobro no entra', () => {
  it('abre la gracia, no suspende y le avisa a la Familia', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoConCobroFallido()]);
    respuestas.set('PATCH /rest/v1/accesos_marketplace', [{ id: ACCESO }]);

    const { abierta, gracia_hasta } = await abrirElPeriodoDeGracia({
      accesoId: ACCESO,
      avisar: avisarDeMentira,
    });

    assert.equal(abierta, true);
    assert.equal(gracia_hasta, corrido(7));
    assert.equal(loGuardado().cuerpo.gracia_hasta, corrido(7));
    // Lo que este paso vino a sacar: el acceso no se toca, sigue en pie mientras dure la gracia.
    assert.equal(loGuardado().cuerpo.estado, undefined);
    assert.equal(empujados.length, 1);
    assert.equal(empujados[0].familiaId, FAMILIA);
  });

  it('exige al guardar que siga vigente y que nadie haya abierto una gracia en el medio', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoConCobroFallido()]);
    respuestas.set('PATCH /rest/v1/accesos_marketplace', [{ id: ACCESO }]);

    await abrirElPeriodoDeGracia({ accesoId: ACCESO, avisar: avisarDeMentira });

    assert.match(loGuardado().url, /id=eq\.33333333/);
    assert.match(loGuardado().url, /estado=eq\.vigente/);
    assert.match(loGuardado().url, /gracia_hasta=is\.null/);
  });

  it('no mueve la fecha ni vuelve a avisar cuando el proveedor reintenta', async () => {
    // Es la mitad «ni reintentos indefinidos» del §3.2: si cada aviso de falla corriera la fecha
    // siete días más, un proveedor que reintenta cada tres no suspendería nunca.
    respuestas.set('GET /rest/v1/accesos_marketplace', [
      accesoConCobroFallido({ gracia_hasta: corrido(4) }),
    ]);

    const { abierta, gracia_hasta } = await abrirElPeriodoDeGracia({
      accesoId: ACCESO,
      avisar: avisarDeMentira,
    });

    assert.equal(abierta, false);
    assert.equal(gracia_hasta, corrido(4));
    assert.equal(loGuardado(), undefined);
    assert.equal(empujados.length, 0);
  });

  it('no le abre gracia a un acceso que ya estaba suspendido o dado de baja', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [
      accesoConCobroFallido({ estado: 'cancelada' }),
    ]);

    const { abierta } = await abrirElPeriodoDeGracia({ accesoId: ACCESO, avisar: avisarDeMentira });

    assert.equal(abierta, false);
    assert.equal(loGuardado(), undefined);
    assert.equal(empujados.length, 0);
  });

  it('no da por abierta una gracia que la base no guardó', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoConCobroFallido()]);
    respuestas.set('PATCH /rest/v1/accesos_marketplace', { __falla: { message: 'la base no contesta' } });

    const { abierta } = await abrirElPeriodoDeGracia({ accesoId: ACCESO, avisar: avisarDeMentira });

    assert.equal(abierta, false);
    assert.equal(empujados.length, 0);
    assert.equal(anotados.length, 1);
  });

  it('deja la gracia abierta aunque el aviso no haya podido salir', async () => {
    // Deshacerla porque el push falló suspendería antes de tiempo a quien nunca se enteró.
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoConCobroFallido()]);
    respuestas.set('PATCH /rest/v1/accesos_marketplace', [{ id: ACCESO }]);

    const { abierta } = await abrirElPeriodoDeGracia({
      accesoId: ACCESO,
      avisar: () => Promise.reject(new Error('sin dispositivo')),
    });

    assert.equal(abierta, true);
    assert.equal(loGuardado().cuerpo.gracia_hasta, corrido(7));
    assert.equal(anotados.length, 1);
  });
});

describe('qué dice el aviso del cobro que no entró', () => {
  it('nombra el importe con su moneda, hasta cuándo hay tiempo y adónde ir', () => {
    const texto = textoDelAvisoDeGracia(accesoConCobroFallido({ gracia_hasta: '2026-10-07' }));

    assert.match(texto.cuerpo, /4500\.00 ARS/);
    assert.match(texto.cuerpo, /7\/10\/2026/);
    assert.equal(texto.url, `/pacientes/${PACIENTE}/acceso`);
    assert.ok(texto.titulo);
  });

  it('nunca deja el importe sin su moneda', () => {
    const texto = textoDelAvisoDeGracia(accesoConCobroFallido({ moneda: 'BRL', gracia_hasta: HOY }));

    assert.match(texto.cuerpo, /4500\.00 BRL/);
  });
});

describe('cuando se termina la gracia', () => {
  it('le pide a la base sólo los vigentes con la gracia cumplida', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', []);

    await suspenderLosQueAgotaronLaGracia();

    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/accesos_marketplace').url;
    assert.match(consulta, /estado=eq\.vigente/);
    assert.match(consulta, /gracia_hasta=not\.is\.null/);
    assert.match(consulta, new RegExp(`gracia_hasta=lte\\.${HOY}`));
  });

  it('suspende el acceso y vuelve a exigir las mismas condiciones al guardar', async () => {
    // Si entre la consulta y el guardado entró la plata, `registrarCobroExitoso` cerró la gracia:
    // sin volver a exigirla, este guardado apagaría un acceso recién pagado.
    respuestas.set('GET /rest/v1/accesos_marketplace', [{ id: ACCESO }]);
    respuestas.set('PATCH /rest/v1/accesos_marketplace', []);

    const { suspendidos } = await suspenderLosQueAgotaronLaGracia();

    assert.equal(suspendidos, 1);
    assert.equal(loGuardado().cuerpo.estado, 'vencida');
    assert.match(loGuardado().url, /estado=eq\.vigente/);
    assert.match(loGuardado().url, /gracia_hasta=not\.is\.null/);
    assert.match(loGuardado().url, new RegExp(`gracia_hasta=lte\\.${HOY}`));
  });

  it('sigue con los demás accesos cuando una suspensión falla', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [{ id: ACCESO }, { id: OTRO_ACCESO }]);
    let vez = 0;
    respuestas.set('PATCH /rest/v1/accesos_marketplace', () => {
      vez += 1;
      return vez === 1 ? { __falla: { message: 'la base no contesta' } } : [];
    });

    const { suspendidos } = await suspenderLosQueAgotaronLaGracia();

    assert.equal(suspendidos, 1);
    assert.equal(anotados.length, 1);
  });

  it('no suspende nada si la consulta falla', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', { __falla: { message: 'la base no contesta' } });

    const { suspendidos } = await suspenderLosQueAgotaronLaGracia();

    assert.equal(suspendidos, 0);
    assert.equal(loGuardado(), undefined);
    assert.equal(anotados.length, 1);
  });
});

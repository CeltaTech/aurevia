/**
 * Pruebas de la liquidación del Asistente.
 *
 * Usan el banco de pruebas que ya trae Node adentro (`node --test`), sin instalar nada, igual
 * que el resto de las pruebas del motor:
 *
 *   npm test --prefix backend
 *
 * Dos clases de prueba conviven acá. Las cuentas —horas, base, conceptos, escalas— se prueban
 * llamando a las funciones directamente, sin nada alrededor. Las reglas de acceso y el
 * generar, que no son una cuenta sino una conversación con la base, se prueban levantando el
 * motor de verdad contra una base de mentira que contesta lo que cada prueba le prepara. Así
 * lo que se comprueba es el camino entero —permiso, filtros, escritura— y no una imitación.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------------------
// La base de mentira
// ---------------------------------------------------------------------------------------

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, para poder afirmar que NO pidió algo. */
let llamadas = [];

let rolDelUsuario = 'admin_prestadora';
let permisoOtorgado = true;

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, cuerpo: crudo ? JSON.parse(crudo) : null });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada() : preparada;
    if (valor === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }

    // `.single()` pide una fila sola con este encabezado; `.maybeSingle()` sobre una lectura
    // pide la lista y la achica del lado del motor. Se imita eso y nada más.
    const unoSolo = (req.headers.accept || '').includes('vnd.pgrst.object+json');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(unoSolo && Array.isArray(valor) ? valor[0] ?? null : valor));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// El import va después de dejar puestas las variables de entorno: la conexión a la base se
// arma en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const {
  panelLiquidacionesRouter,
  acumularGuardias,
  calcularLiquidacion,
  escalasEstablesDelPeriodo,
  esPeriodoValido,
  primerDia,
  ultimoDia,
  vinculoVigenteEnElPeriodo,
} = await import('../panelLiquidaciones.js');

const app = express();
app.use(express.json());
app.use('/api/panel/liquidaciones', panelLiquidacionesRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/liquidaciones`;

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

beforeEach(() => {
  llamadas = [];
  rolDelUsuario = 'admin_prestadora';
  permisoOtorgado = true;
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: PRESTADORA }]);
  respuestas.set('POST /rest/v1/rpc/tiene_permiso_de', () => permisoOtorgado);
});

// ---------------------------------------------------------------------------------------
// Las cuentas
// ---------------------------------------------------------------------------------------

const ASISTENTE_POR_HORA = {
  id: 'a-1',
  nombre: 'Asistente de prueba',
  tipo_vinculo: 'monotributo',
  valor_hora: 1500,
  sueldo_basico: null,
};

const ASISTENTE_EN_DEPENDENCIA = {
  id: 'a-2',
  nombre: 'Otra asistente de prueba',
  tipo_vinculo: 'dependencia',
  valor_hora: null,
  sueldo_basico: 900000,
};

function liquidar(asistente, acumulado, extras = {}) {
  return calcularLiquidacion({
    asistente,
    acumulado,
    conceptos: extras.conceptos ?? [],
    escalasPorTipo: extras.escalasPorTipo ?? new Map(),
    moneda: extras.moneda ?? 'ARS',
    jurisdiccion: 'AR',
    periodo: '2026-08',
  });
}

describe('las horas del mes', () => {
  it('una guardia que cubrió a dos Pacientes se paga una sola vez', () => {
    // Ocho horas trabajadas son ocho, atienda a uno o a cinco. La lista que entra acá es la
    // de guardias y nada más: no trae Pacientes, justamente para que no haya forma de
    // contarlas dos veces.
    const acumulado = acumularGuardias([
      { asistente_id: 'a-1', estado: 'completada', hora_inicio: '08:00:00', hora_fin: '16:00:00' },
    ]);
    assert.equal(acumulado.get('a-1').horas, 8);
    assert.equal(acumulado.get('a-1').guardias, 1);
  });

  it('la cuenta del Asistente nunca se cruza con la lista de Pacientes', () => {
    // Esta es la prueba de fondo del renglón anterior, y se hace mirando el código: unir
    // `guardias` con `guardia_pacientes` haría aparecer dos veces la misma guardia y el
    // Asistente cobraría dieciséis horas por ocho trabajadas. Si alguna vez alguien
    // "completa" la consulta, esto falla acá y no en el recibo de alguien.
    const codigo = readFileSync(new URL('../panelLiquidaciones.js', import.meta.url), 'utf8');
    assert.equal(codigo.includes("from('guardia_pacientes')"), false);
  });

  it('la guardia de noche no da horas negativas', () => {
    const acumulado = acumularGuardias([
      { asistente_id: 'a-1', estado: 'completada', hora_inicio: '22:00', hora_fin: '06:00' },
    ]);
    assert.equal(acumulado.get('a-1').horas, 8);
  });

  it('solo se cuentan las guardias cerradas', () => {
    const acumulado = acumularGuardias([
      { asistente_id: 'a-1', estado: 'completada', hora_inicio: '08:00', hora_fin: '16:00' },
      { asistente_id: 'a-1', estado: 'programada', hora_inicio: '08:00', hora_fin: '16:00' },
      { asistente_id: 'a-1', estado: 'cancelada', hora_inicio: '08:00', hora_fin: '16:00' },
    ]);
    assert.equal(acumulado.get('a-1').guardias, 1);
    assert.equal(acumulado.get('a-1').horas, 8);
  });
});

describe('la base: sueldo o valor por hora', () => {
  it('quien cobra por hora: las horas por su valor', () => {
    const { liquidacion, items } = liquidar(ASISTENTE_POR_HORA, { guardias: 10, horas: 80 });
    assert.equal(liquidacion.base_unidad, 'valor_hora');
    assert.equal(liquidacion.base_valor, 1500);
    assert.equal(liquidacion.bruto, 120000);
    assert.equal(liquidacion.neto, 120000);
    assert.equal(items[0].unidad, 'base');
    assert.equal(items[0].orden, 0);
    assert.equal(items[0].monto, 120000);
  });

  it('quien está en relación de dependencia cobra su sueldo, no las horas', () => {
    // El mismo mes con las mismas horas que arriba tiene que dar el sueldo y nada más: para
    // esa persona las horas son un control, no la cuenta.
    const { liquidacion } = liquidar(ASISTENTE_EN_DEPENDENCIA, { guardias: 10, horas: 80 });
    assert.equal(liquidacion.base_unidad, 'sueldo_basico');
    assert.equal(liquidacion.bruto, 900000);
    assert.equal(liquidacion.horas, 80);
  });

  it('el sueldo se paga aunque no haya hecho ninguna guardia', () => {
    const { liquidacion } = liquidar(ASISTENTE_EN_DEPENDENCIA, { guardias: 0, horas: 0 });
    assert.equal(liquidacion.bruto, 900000);
    assert.equal(liquidacion.guardias_contadas, 0);
  });

  it('sin el dato de base no se liquida nada', () => {
    // No se estima, no se completa con el de otro, no se pone cero: un cero se lee como "no
    // se le paga nada", que es una afirmación distinta de "no sabemos cuánto".
    const resultado = liquidar({ ...ASISTENTE_POR_HORA, valor_hora: null }, { guardias: 1, horas: 8 });
    assert.equal(resultado.faltaBase, true);
    assert.equal(resultado.liquidacion, undefined);
  });
});

describe('los conceptos que pone la Prestadora', () => {
  const aporte = {
    id: 'c-1',
    nombre: 'Aporte de prueba',
    signo: 'resta',
    unidad: 'porcentaje',
    origen_valor: 'propio',
    valor: 10,
    aplica_a: 'todos',
  };

  it('un porcentaje se aplica sobre el bruto', () => {
    const { liquidacion, items } = liquidar(ASISTENTE_POR_HORA, { guardias: 10, horas: 80 }, { conceptos: [aporte] });
    assert.equal(liquidacion.bruto, 120000);
    assert.equal(liquidacion.total_restas, 12000);
    assert.equal(liquidacion.total_sumas, 0);
    assert.equal(liquidacion.neto, 108000);
    assert.equal(items[1].descripcion, 'Aporte de prueba');
    assert.equal(items[1].valor_aplicado, 10);
    assert.equal(items[1].monto, 12000);
    assert.equal(items[1].orden, 1);
  });

  it('un monto por hora se aplica sobre las horas, y uno fijo es un importe plano', () => {
    const conceptos = [
      { id: 'c-2', nombre: 'Adicional por hora', signo: 'suma', unidad: 'monto_por_hora', origen_valor: 'propio', valor: 50, aplica_a: 'todos' },
      { id: 'c-3', nombre: 'Adelanto entregado', signo: 'resta', unidad: 'monto_fijo_mensual', origen_valor: 'propio', valor: 20000, aplica_a: 'todos' },
    ];
    const { liquidacion } = liquidar(ASISTENTE_POR_HORA, { guardias: 10, horas: 80 }, { conceptos });
    assert.equal(liquidacion.total_sumas, 4000);
    assert.equal(liquidacion.total_restas, 20000);
    assert.equal(liquidacion.neto, 104000);
  });

  it('un concepto de dependencia no le entra a quien factura por monotributo', () => {
    const soloDependencia = { ...aporte, id: 'c-4', aplica_a: 'dependencia' };
    const { liquidacion, items } = liquidar(ASISTENTE_POR_HORA, { guardias: 10, horas: 80 }, { conceptos: [soloDependencia] });
    assert.equal(items.length, 1);
    assert.equal(liquidacion.neto, 120000);
  });

  it('el nombre del concepto se copia al renglón, no se busca después', () => {
    const { items } = liquidar(ASISTENTE_POR_HORA, { guardias: 1, horas: 8 }, { conceptos: [aporte] });
    assert.equal(items[1].descripcion, aporte.nombre);
    assert.equal(items[1].concepto_id, 'c-1');
  });
});

describe('los conceptos que salen de una escala legal', () => {
  const conceptoConEscala = {
    id: 'c-9',
    nombre: 'Concepto atado a escala',
    signo: 'resta',
    unidad: 'porcentaje',
    origen_valor: 'escala_legal',
    escala_tipo: 'aporte_de_prueba',
    valor: null,
    aplica_a: 'todos',
  };

  function escalas(filas) {
    return escalasEstablesDelPeriodo(filas, '2026-08', 'AR');
  }

  it('sin la escala cargada, el concepto se saltea y se avisa', () => {
    // Regla 10 de CLAUDE.md §7: un valor legal no se estima ni se inventa. Si no está
    // cargado, el concepto no entra y la Prestadora se entera.
    const { liquidacion, items, sinEscala } = liquidar(
      ASISTENTE_POR_HORA,
      { guardias: 10, horas: 80 },
      { conceptos: [conceptoConEscala], escalasPorTipo: escalas([]) }
    );
    assert.equal(items.length, 1);
    assert.equal(liquidacion.neto, 120000);
    assert.equal(sinEscala.length, 1);
    assert.match(sinEscala[0], /Concepto atado a escala/);
    assert.match(sinEscala[0], /aporte_de_prueba/);
  });

  it('con la escala cargada, el valor sale de ahí y no del concepto', () => {
    const cargadas = escalas([
      { tipo: 'aporte_de_prueba', categoria: null, valor: 11, unidad: 'porcentaje', moneda: null, jurisdiccion: 'AR', vigencia_desde: '2026-01-01', vigencia_hasta: null },
    ]);
    const { liquidacion, items, sinEscala } = liquidar(
      ASISTENTE_POR_HORA,
      { guardias: 10, horas: 80 },
      { conceptos: [conceptoConEscala], escalasPorTipo: cargadas }
    );
    assert.equal(sinEscala.length, 0);
    assert.equal(items[1].valor_aplicado, 11);
    assert.equal(items[1].monto, 13200);
    assert.equal(liquidacion.neto, 106800);
  });

  it('una escala en otra moneda no se convierte: se saltea', () => {
    const enOtraMoneda = escalas([
      { tipo: 'piso_de_prueba', categoria: null, valor: 1000, unidad: 'monto_fijo_mensual', moneda: 'BRL', jurisdiccion: 'AR', vigencia_desde: '2026-01-01', vigencia_hasta: null },
    ]);
    const concepto = { ...conceptoConEscala, unidad: 'monto_fijo_mensual', escala_tipo: 'piso_de_prueba' };
    const { items, sinEscala } = liquidar(
      ASISTENTE_POR_HORA,
      { guardias: 10, horas: 80 },
      { conceptos: [concepto], escalasPorTipo: enOtraMoneda, moneda: 'ARS' }
    );
    assert.equal(items.length, 1);
    assert.match(sinEscala[0], /BRL/);
  });

  it('gana la escala con la vigencia más reciente', () => {
    const resueltas = escalas([
      { tipo: 'aporte_de_prueba', categoria: null, valor: 8, unidad: 'porcentaje', moneda: null, jurisdiccion: 'AR', vigencia_desde: '2025-01-01', vigencia_hasta: null },
      { tipo: 'aporte_de_prueba', categoria: null, valor: 11, unidad: 'porcentaje', moneda: null, jurisdiccion: 'AR', vigencia_desde: '2026-01-01', vigencia_hasta: null },
    ]);
    assert.equal(resueltas.get('aporte_de_prueba').valor, 11);
  });

  it('la escala de otra jurisdicción no se usa', () => {
    const resueltas = escalas([
      { tipo: 'aporte_de_prueba', categoria: null, valor: 8, unidad: 'porcentaje', moneda: null, jurisdiccion: 'BR', vigencia_desde: '2026-01-01', vigencia_hasta: null },
    ]);
    assert.equal(resueltas.size, 0);
  });

  it('una escala que cambia en la mitad del mes no se prorratea sola', () => {
    // El período es un mes entero, no un día. Si la escala cambió adentro, no hay forma de
    // saber cuál corresponde sin inventar un prorrateo, así que no se elige ninguna.
    const resueltas = escalas([
      { tipo: 'aporte_de_prueba', categoria: null, valor: 8, unidad: 'porcentaje', moneda: null, jurisdiccion: 'AR', vigencia_desde: '2026-01-01', vigencia_hasta: null },
      { tipo: 'aporte_de_prueba', categoria: null, valor: 11, unidad: 'porcentaje', moneda: null, jurisdiccion: 'AR', vigencia_desde: '2026-08-15', vigencia_hasta: null },
    ]);
    assert.equal(resueltas.size, 0);
  });
});

describe('el período y el vínculo', () => {
  it('el período viene como AAAA-MM', () => {
    assert.equal(esPeriodoValido('2026-08'), true);
    assert.equal(esPeriodoValido('2026-13'), false);
    assert.equal(esPeriodoValido('2026-8'), false);
    assert.equal(esPeriodoValido(undefined), false);
  });

  it('el último día del mes se saca sin saber cuántos tiene', () => {
    assert.equal(ultimoDia('2026-02'), '2026-02-28');
    assert.equal(ultimoDia('2024-02'), '2024-02-29');
    assert.equal(ultimoDia('2026-08'), '2026-08-31');
    assert.equal(primerDia('2026-08'), '2026-08-01');
  });

  it('no se liquida un mes anterior al ingreso ni posterior a la baja', () => {
    assert.equal(vinculoVigenteEnElPeriodo({ fecha_alta: '2026-09-01', fecha_baja: null }, '2026-08'), false);
    assert.equal(vinculoVigenteEnElPeriodo({ fecha_alta: '2026-08-31', fecha_baja: null }, '2026-08'), true);
    assert.equal(vinculoVigenteEnElPeriodo({ fecha_alta: '2020-01-01', fecha_baja: '2026-07-31' }, '2026-08'), false);
    assert.equal(vinculoVigenteEnElPeriodo({ fecha_alta: '2020-01-01', fecha_baja: '2026-08-01' }, '2026-08'), true);
  });
});

// ---------------------------------------------------------------------------------------
// Las rutas
// ---------------------------------------------------------------------------------------

describe('quién puede mirar y quién puede tocar', () => {
  it('sin el permiso de ver pagos, no se ve nada', async () => {
    permisoOtorgado = false;
    const { estado, cuerpo } = await pedir('GET', '/conceptos');
    assert.equal(estado, 403);
    assert.equal(cuerpo.error, 'La Prestadora no habilitó esta acción');
  });

  it('con el permiso, el catálogo se lee', async () => {
    respuestas.set('GET /rest/v1/conceptos_liquidacion', () => [{ id: 'c-1', nombre: 'Concepto de prueba' }]);
    const { estado, cuerpo } = await pedir('GET', '/conceptos');
    assert.equal(estado, 200);
    assert.equal(cuerpo.length, 1);
  });

  it('un Coordinador con el permiso puede mirar, pero no escribir', async () => {
    // Leer y escribir son dos preguntas distintas: la plata de una persona la toca la
    // administración de la Prestadora, no cualquiera que pueda mirarla.
    rolDelUsuario = 'coordinador';
    const { estado, cuerpo } = await pedir('POST', '/conceptos', {
      nombre: 'Concepto nuevo',
      signo: 'suma',
      unidad: 'porcentaje',
      origen_valor: 'propio',
      valor: 5,
    });
    assert.equal(estado, 403);
    assert.equal(cuerpo.error, 'La Prestadora no habilitó esta acción');
  });
});

describe('generar el mes', () => {
  function prepararLaBase({ liquidacionesExistentes = [] } = {}) {
    respuestas.set('GET /rest/v1/prestadoras', () => [{ pais: 'AR', moneda: 'ARS' }]);
    respuestas.set('GET /rest/v1/guardias', () => [
      { id: 'g-1', estado: 'completada', hora_inicio: '08:00:00', hora_fin: '16:00:00', asistente_id: 'a-1' },
    ]);
    respuestas.set('GET /rest/v1/asistentes', () => [
      { id: 'a-1', nombre: 'Asistente de prueba', estado: 'activo', tipo_vinculo: 'monotributo', fecha_alta: '2020-01-01', fecha_baja: null },
    ]);
    respuestas.set('GET /rest/v1/remuneraciones_asistente', () => [
      { asistente_id: 'a-1', valor_hora: 1500, sueldo_basico: null },
    ]);
    respuestas.set('GET /rest/v1/conceptos_liquidacion', () => []);
    respuestas.set('GET /rest/v1/escalas_legales', () => []);
    respuestas.set('GET /rest/v1/liquidaciones_asistente', () => liquidacionesExistentes);
    respuestas.set('POST /rest/v1/liquidaciones_asistente', () => ({ id: 'liq-nueva', moneda: 'ARS' }));
    respuestas.set('POST /rest/v1/liquidaciones_asistente_items', () => null);
    respuestas.set('DELETE /rest/v1/liquidaciones_asistente', () => null);
  }

  it('un mes sin liquidar se genera con los importes de la pantalla', async () => {
    prepararLaBase();
    const { estado, cuerpo } = await pedir('POST', '/generar', { periodo: '2026-08' });
    assert.equal(estado, 200);
    assert.deepEqual(
      { generadas: cuerpo.generadas, rehechas: cuerpo.rehechas, sin_dato_base: cuerpo.sin_dato_base },
      { generadas: 1, rehechas: 0, sin_dato_base: [] }
    );

    const escritura = llamadas.find((l) => l.clave === 'POST /rest/v1/liquidaciones_asistente');
    assert.equal(escritura.cuerpo.bruto, 12000); // ocho horas por mil quinientos
    assert.equal(escritura.cuerpo.neto, 12000);
    assert.equal(escritura.cuerpo.horas, 8);
    assert.equal(escritura.cuerpo.periodo, '2026-08-01');
  });

  it('una liquidación ya pagada no se rehace', async () => {
    // Es el registro de una plata que ya salió: rehacerla sería reescribir lo que se pagó.
    prepararLaBase({ liquidacionesExistentes: [{ id: 'liq-vieja', asistente_id: 'a-1', estado: 'pagada' }] });
    const { estado, cuerpo } = await pedir('POST', '/generar', { periodo: '2026-08' });
    assert.equal(estado, 200);
    assert.equal(cuerpo.generadas, 0);
    assert.equal(cuerpo.rehechas, 0);
    assert.deepEqual(cuerpo.omitidas_ya_pagadas, ['Asistente de prueba']);
    assert.equal(llamadas.some((l) => l.clave === 'POST /rest/v1/liquidaciones_asistente'), false);
    assert.equal(llamadas.some((l) => l.clave === 'DELETE /rest/v1/liquidaciones_asistente'), false);
  });

  it('una liquidación pendiente se borra y se rehace', async () => {
    prepararLaBase({ liquidacionesExistentes: [{ id: 'liq-vieja', asistente_id: 'a-1', estado: 'pendiente' }] });
    const { estado, cuerpo } = await pedir('POST', '/generar', { periodo: '2026-08' });
    assert.equal(estado, 200);
    assert.equal(cuerpo.rehechas, 1);
    assert.equal(cuerpo.generadas, 0);
    assert.equal(llamadas.some((l) => l.clave === 'DELETE /rest/v1/liquidaciones_asistente'), true);
    assert.equal(llamadas.some((l) => l.clave === 'POST /rest/v1/liquidaciones_asistente'), true);
  });

  it('sin el dato de base no se genera, y el nombre queda en la lista', async () => {
    prepararLaBase();
    respuestas.set('GET /rest/v1/remuneraciones_asistente', () => []);
    const { cuerpo } = await pedir('POST', '/generar', { periodo: '2026-08' });
    assert.equal(cuerpo.generadas, 0);
    assert.deepEqual(cuerpo.sin_dato_base, ['Asistente de prueba']);
  });

  it('un concepto de escala legal sin escala cargada se saltea y se informa', async () => {
    prepararLaBase();
    respuestas.set('GET /rest/v1/conceptos_liquidacion', () => [
      {
        id: 'c-9',
        nombre: 'Concepto atado a escala',
        signo: 'resta',
        unidad: 'porcentaje',
        origen_valor: 'escala_legal',
        escala_tipo: 'aporte_de_prueba',
        valor: null,
        aplica_a: 'todos',
      },
    ]);
    const { cuerpo } = await pedir('POST', '/generar', { periodo: '2026-08' });
    assert.equal(cuerpo.generadas, 1);
    assert.equal(cuerpo.sin_escala.length, 1);
    assert.match(cuerpo.sin_escala[0], /aporte_de_prueba/);

    // Y el importe queda sin tocar: nunca se completa con un número inventado.
    const escritura = llamadas.find((l) => l.clave === 'POST /rest/v1/liquidaciones_asistente');
    assert.equal(escritura.cuerpo.neto, 12000);
    assert.equal(escritura.cuerpo.total_restas, 0);
  });

  it('el período mal escrito se rechaza antes de tocar la base', async () => {
    prepararLaBase();
    const { estado } = await pedir('POST', '/generar', { periodo: 'agosto' });
    assert.equal(estado, 400);
    assert.equal(llamadas.some((l) => l.clave === 'GET /rest/v1/guardias'), false);
  });
});

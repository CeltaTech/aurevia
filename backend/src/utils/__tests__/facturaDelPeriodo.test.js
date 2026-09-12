import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { armarLosRenglonesDeLaFactura, correEnElPeriodo, ultimoDiaDelPeriodo } from '../facturaDelPeriodo.js';

/* Qué se le cobra a una Familia en un mes.
   ==========================================================================

   ACÁ SE PRUEBA UNA CUENTA SOBRE PLATA, así que cada caso está escrito por el error que evita, y
   son cuatro los que importan: cobrarle a alguien un acuerdo que ya terminó, cobrarle uno que
   todavía no empezó, dejar de cobrar uno que corre, y cobrar un paquete renglón por renglón
   —que es cobrar de más todos los meses, porque el precio único que se pactó era justamente menos
   que la suma—.

   Los datos son inventados. El período de todos los casos es agosto de 2026. */

const PERIODO = '2026-08-01';
const PACIENTE = '11111111-1111-4111-8111-111111111111';
const OTRO_PACIENTE = '22222222-2222-4222-8222-222222222222';

const NOMBRES = new Map([
  [PACIENTE, 'Juana Pérez'],
  [OTRO_PACIENTE, 'Marcos Giménez'],
]);

function prestacion(cambios = {}) {
  return {
    id: 1,
    paciente_id: PACIENTE,
    servicio_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tipo_servicio: 'Acompañamiento',
    precio_final: '10000.00',
    vigente_desde: '2026-01-01',
    vigente_hasta: null,
    ...cambios,
  };
}

function armar({ prestaciones = [], paquetes = [], itemsDePaquete = [] } = {}) {
  return armarLosRenglonesDeLaFactura({
    periodo: PERIODO,
    nombresDePacientes: NOMBRES,
    prestaciones,
    paquetes,
    itemsDePaquete,
  });
}

describe('el último día del período', () => {
  it('sale del mes pedido, sin lista de cuántos días tiene cada uno', () => {
    assert.equal(ultimoDiaDelPeriodo('2026-08-01'), '2026-08-31');
    assert.equal(ultimoDiaDelPeriodo('2026-04-01'), '2026-04-30');
  });

  it('y febrero de un año bisiesto tiene veintinueve', () => {
    assert.equal(ultimoDiaDelPeriodo('2028-02-01'), '2028-02-29');
  });
});

describe('qué acuerdos corren en el período', () => {
  it('uno que se terminó antes de que el mes empiece, no', () => {
    assert.equal(correEnElPeriodo(prestacion({ vigente_hasta: '2026-07-31' }), PERIODO), false);
  });

  it('uno que empieza después de que el mes termine, tampoco', () => {
    assert.equal(correEnElPeriodo(prestacion({ vigente_desde: '2026-09-01' }), PERIODO), false);
  });

  it('uno sin fecha de fin sigue corriendo', () => {
    assert.equal(correEnElPeriodo(prestacion(), PERIODO), true);
  });

  it('y alcanza con que corra un día: el primero del mes', () => {
    assert.equal(correEnElPeriodo(prestacion({ vigente_hasta: '2026-08-01' }), PERIODO), true);
  });

  it('o el último', () => {
    assert.equal(correEnElPeriodo(prestacion({ vigente_desde: '2026-08-31' }), PERIODO), true);
  });
});

describe('los renglones de la factura', () => {
  it('el que corre se cobra, y dice de qué Servicio es y a quién se le prestó', () => {
    const renglones = armar({ prestaciones: [prestacion()] });
    assert.equal(renglones.length, 1);
    assert.equal(renglones[0].paciente_id, PACIENTE);
    assert.equal(renglones[0].servicio_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(renglones[0].descripcion, 'Acompañamiento — Juana Pérez');
    assert.equal(renglones[0].monto, 10000);
  });

  it('el que ya no corre no aparece, aunque el acuerdo siga vigente', () => {
    // Es el caso que se cobraba de más: `estado` dice que el acuerdo está en pie, las fechas
    // dicen que dejó de correr en julio.
    assert.deepEqual(armar({ prestaciones: [prestacion({ vigente_hasta: '2026-06-30' })] }), []);
  });

  it('se cobra el precio acordado entero aunque haya corrido un solo día', () => {
    const renglones = armar({ prestaciones: [prestacion({ vigente_desde: '2026-08-31' })] });
    assert.equal(renglones[0].monto, 10000);
  });
});

describe('cuando las prestaciones están adentro de un paquete', () => {
  const PAQUETE = 77;

  function conPaquete(cambiosDelPaquete = {}) {
    return {
      prestaciones: [
        prestacion({ id: 1, tipo_servicio: 'Acompañamiento', precio_final: '10000.00' }),
        prestacion({ id: 2, tipo_servicio: 'Enfermería', precio_final: '8000.00' }),
      ],
      paquetes: [
        {
          id: PAQUETE,
          paciente_id: PACIENTE,
          nombre: 'Plan tarde',
          precio_paquete: '15000.00',
          estado: 'vigente',
          ...cambiosDelPaquete,
        },
      ],
      itemsDePaquete: [
        { paquete_id: PAQUETE, prestacion_id: 1 },
        { paquete_id: PAQUETE, prestacion_id: 2 },
      ],
    };
  }

  it('se cobra el precio pactado una vez, y no la suma de los suyos', () => {
    const renglones = armar(conPaquete());
    assert.equal(renglones.length, 1);
    assert.equal(renglones[0].monto, 15000);
    assert.equal(renglones[0].descripcion, 'Plan tarde — Juana Pérez');
  });

  it('el renglón del paquete no dice un Servicio, porque puede juntar varios', () => {
    assert.equal(armar(conPaquete())[0].servicio_id, null);
  });

  it('el paquete sin nombre se dice por lo que incluye', () => {
    assert.equal(
      armar(conPaquete({ nombre: null }))[0].descripcion,
      'Acompañamiento, Enfermería — Juana Pérez'
    );
  });

  it('entra aunque una de las suyas haya dejado de correr, y sigue valiendo lo pactado', () => {
    const datos = conPaquete();
    datos.prestaciones[1] = { ...datos.prestaciones[1], vigente_hasta: '2026-07-01' };
    const renglones = armar(datos);
    assert.equal(renglones.length, 1);
    assert.equal(renglones[0].monto, 15000);
  });

  it('no entra si no le corre ninguna', () => {
    const datos = conPaquete();
    datos.prestaciones = datos.prestaciones.map((p) => ({ ...p, vigente_hasta: '2026-07-01' }));
    assert.deepEqual(armar(datos), []);
  });

  it('uno dado de baja no tapa nada: sus prestaciones vuelven a cobrarse por separado', () => {
    const renglones = armar(conPaquete({ estado: 'de_baja' }));
    assert.equal(renglones.length, 2);
    assert.equal(
      renglones.reduce((acc, r) => acc + r.monto, 0),
      18000
    );
  });

  it('lo que queda afuera del paquete se cobra igual, al lado', () => {
    const datos = conPaquete();
    datos.prestaciones.push(prestacion({ id: 3, tipo_servicio: 'Kinesiología', precio_final: '5000.00' }));
    const renglones = armar(datos);
    assert.equal(renglones.length, 2);
    assert.deepEqual(
      renglones.map((r) => r.monto).sort((a, b) => a - b),
      [5000, 15000]
    );
  });
});

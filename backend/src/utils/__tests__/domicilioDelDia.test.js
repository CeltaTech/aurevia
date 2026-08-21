/**
 * Pruebas de dónde se atiende a cada Paciente el día de su guardia.
 *
 * Usan el banco de pruebas que ya trae Node adentro (`node --test`), sin instalar nada, igual
 * que el resto de las pruebas del motor:
 *
 *   npm test --prefix backend
 *
 * ACÁ NO SE PRUEBA EL CRITERIO, SE PRUEBA QUIÉN PREGUNTA Y CÓMO APLICA LA RESPUESTA. Cuál
 * dirección gana un día dado lo decide la función `domicilios_de_pacientes_en` de la base
 * (migración 20260821220000_donde_se_atiende_al_paciente_este_dia.sql) y no este archivo. Lo
 * que el motor tiene que hacer bien es otra cosa: preguntar por la fecha de cada guardia y no
 * por la de hoy, preguntar una vez por día y no una vez por Paciente, y pisar solamente los
 * campos que la consulta pidió.
 *
 * Por eso la base de mentira de abajo contesta con la misma regla que la función SQL —un
 * período que empieza el día que empieza y termina el día que termina, sin final si no lo
 * tiene—: así, cuando una prueba dice "el primer día del período cuenta como adentro", lo que
 * queda comprobado es que el motor preguntó por el día correcto. Que la función SQL conteste
 * eso mismo se comprueba contra la base de verdad, no acá.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PACIENTE_UNO = '50000000-0000-4000-8000-000000000001';
const PACIENTE_DOS = '50000000-0000-4000-8000-000000000002';

// La casa de siempre de cada uno. Es lo que devuelve la función cuando no hay ninguna
// dirección temporal vigente ese día.
const FICHAS = new Map([
  [PACIENTE_UNO, { domicilio: 'Av. Siempreviva 742', lat: -34.6037, lng: -58.3816 }],
  [PACIENTE_DOS, { domicilio: 'Calle Falsa 123', lat: -34.5, lng: -58.52 }],
]);

/** Las temporadas cargadas para esta prueba. Cada `it` prepara las suyas. */
let temporales = [];
/** Todo lo que el motor le preguntó a la base, para poder contar las preguntas. */
let preguntas = [];

// Copia exacta del criterio de la migración: la temporal vigente ese día, y si no la ficha.
// Las fechas se comparan como texto porque `2026-01-05` ordena igual escrito que como fecha.
function resolver(pacienteId, fecha) {
  const vigente = temporales.find(
    (t) =>
      t.paciente_id === pacienteId &&
      t.fecha_inicio <= fecha &&
      (t.fecha_fin == null || t.fecha_fin >= fecha)
  );
  const ficha = FICHAS.get(pacienteId) ?? { domicilio: null, lat: null, lng: null };
  if (!vigente) {
    return {
      paciente_id: pacienteId,
      domicilio_temporal_id: null,
      ...ficha,
      es_temporal: false,
      motivo: null,
      desde: null,
      hasta: null,
    };
  }
  return {
    paciente_id: pacienteId,
    domicilio_temporal_id: 'una-temporal',
    domicilio: vigente.domicilio,
    lat: vigente.lat,
    lng: vigente.lng,
    es_temporal: true,
    motivo: vigente.motivo,
    desde: vigente.fecha_inicio,
    hasta: vigente.fecha_fin ?? null,
  };
}

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const cuerpo = crudo ? JSON.parse(crudo) : null;
    preguntas.push({ ruta, cuerpo });

    if (ruta !== '/rest/v1/rpc/domicilios_de_pacientes_en') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no esperaba una consulta a ${ruta}` }));
      return;
    }

    const filas = (cuerpo.p_pacientes ?? []).map((id) => resolver(id, cuerpo.p_fecha));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(filas));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// El import va después de dejar puestas las variables de entorno: la conexión a la base se
// arma en el momento en que se importa, y con la dirección que haya en ese instante.
const { conDomicilioDelDia, pacientesConDomicilioDelDia, pacientesConDomicilioDeHoy } = await import(
  '../domicilioDelDia.js'
);

after(() => baseFalsa.close());

beforeEach(() => {
  temporales = [];
  preguntas = [];
});

/** Un Paciente como lo deja `pacientesDeGuardia.js` cuando la Prestadora muestra la dirección. */
function conDireccion(id) {
  return { id, nombre: 'Quien sea', ...FICHAS.get(id) };
}

/** Una guardia como la deja `conPacientes()`. */
function guardiaDe(fecha, pacientes) {
  return { id: `guardia-${fecha}`, fecha, hora_inicio: '08:00', pacientes };
}

// El verano en la casa de un hijo: doce días con principio y fin.
const EL_VERANO_EN_LA_CASA_DEL_HIJO = {
  paciente_id: PACIENTE_UNO,
  domicilio: 'Los Aromos 15, Pinamar',
  lat: -37.11,
  lng: -56.86,
  motivo: 'Pasa el verano en la casa de su hijo',
  fecha_inicio: '2026-01-05',
  fecha_fin: '2026-01-16',
};

describe('la dirección del día de la guardia', () => {
  it('una guardia adentro del período se atiende en la dirección temporal', async () => {
    temporales = [EL_VERANO_EN_LA_CASA_DEL_HIJO];

    const [guardia] = await conDomicilioDelDia([guardiaDe('2026-01-10', [conDireccion(PACIENTE_UNO)])]);
    const [paciente] = guardia.pacientes;

    assert.equal(paciente.domicilio, 'Los Aromos 15, Pinamar');
    assert.equal(paciente.lat, -37.11);
    assert.equal(paciente.lng, -56.86);
    assert.equal(paciente.domicilio_es_temporal, true);
    assert.equal(paciente.domicilio_motivo, 'Pasa el verano en la casa de su hijo');
  });

  it('una guardia afuera del período se atiende en la casa de siempre', async () => {
    temporales = [EL_VERANO_EN_LA_CASA_DEL_HIJO];

    const [guardia] = await conDomicilioDelDia([guardiaDe('2026-03-02', [conDireccion(PACIENTE_UNO)])]);
    const [paciente] = guardia.pacientes;

    assert.equal(paciente.domicilio, 'Av. Siempreviva 742');
    assert.equal(paciente.lat, -34.6037);
    assert.equal(paciente.domicilio_es_temporal, false);
    assert.equal(paciente.domicilio_motivo, null);
  });

  it('el primer día y el último día del período cuentan como adentro', async () => {
    // El error clásico de una temporada: contar los días de adentro y dejar afuera las dos
    // puntas. El día que llega a la casa del hijo ya se lo atiende ahí, y el día que se vuelve
    // todavía está ahí. Los dos vecinos —el día anterior y el siguiente— tienen que dar la
    // casa de siempre, porque si no la prueba pasaría con un período abierto para siempre.
    temporales = [EL_VERANO_EN_LA_CASA_DEL_HIJO];

    const guardias = await conDomicilioDelDia([
      guardiaDe('2026-01-04', [conDireccion(PACIENTE_UNO)]),
      guardiaDe('2026-01-05', [conDireccion(PACIENTE_UNO)]),
      guardiaDe('2026-01-16', [conDireccion(PACIENTE_UNO)]),
      guardiaDe('2026-01-17', [conDireccion(PACIENTE_UNO)]),
    ]);
    const esTemporal = guardias.map((g) => g.pacientes[0].domicilio_es_temporal);

    assert.deepEqual(esTemporal, [false, true, true, false]);
  });

  it('una temporada sin fecha de fin sigue vigente todo lo que venga después', async () => {
    // Una mudanza mientras arreglan el departamento no siempre tiene fecha de vuelta.
    temporales = [
      {
        paciente_id: PACIENTE_UNO,
        domicilio: 'Rivadavia 1000',
        lat: -34.61,
        lng: -58.4,
        motivo: 'Mientras arreglan el departamento',
        fecha_inicio: '2026-02-01',
        fecha_fin: null,
      },
    ];

    const guardias = await conDomicilioDelDia([
      guardiaDe('2026-01-31', [conDireccion(PACIENTE_UNO)]),
      guardiaDe('2026-12-31', [conDireccion(PACIENTE_UNO)]),
    ]);

    assert.equal(guardias[0].pacientes[0].domicilio_es_temporal, false);
    assert.equal(guardias[1].pacientes[0].domicilio_es_temporal, true);
    assert.equal(guardias[1].pacientes[0].domicilio, 'Rivadavia 1000');
  });

  it('cada guardia se resuelve con su propia fecha, no con la de la primera', async () => {
    // Es el caso de la lista de turnos: una semana entera de golpe, con la temporada empezando
    // en el medio. Si el motor preguntara una sola vez por "hoy", media lista quedaría mal.
    temporales = [EL_VERANO_EN_LA_CASA_DEL_HIJO];

    const guardias = await conDomicilioDelDia([
      guardiaDe('2026-01-03', [conDireccion(PACIENTE_UNO)]),
      guardiaDe('2026-01-08', [conDireccion(PACIENTE_UNO)]),
      guardiaDe('2026-01-20', [conDireccion(PACIENTE_UNO)]),
    ]);

    assert.deepEqual(
      guardias.map((g) => g.pacientes[0].domicilio),
      ['Av. Siempreviva 742', 'Los Aromos 15, Pinamar', 'Av. Siempreviva 742']
    );
  });
});

describe('cuántas veces se le pregunta a la base', () => {
  it('una pregunta por fecha distinta, no una por Paciente', async () => {
    temporales = [EL_VERANO_EN_LA_CASA_DEL_HIJO];

    await conDomicilioDelDia([
      // Cinco guardias, dos Pacientes, y una sola fecha entre todas: una sola pregunta.
      guardiaDe('2026-01-10', [conDireccion(PACIENTE_UNO), conDireccion(PACIENTE_DOS)]),
      { ...guardiaDe('2026-01-10', [conDireccion(PACIENTE_UNO)]), id: 'otra-del-mismo-dia' },
      { ...guardiaDe('2026-01-10', [conDireccion(PACIENTE_DOS)]), id: 'una-mas-del-mismo-dia' },
    ]);

    assert.equal(preguntas.length, 1);
    assert.equal(preguntas[0].cuerpo.p_fecha, '2026-01-10');
    assert.deepEqual([...preguntas[0].cuerpo.p_pacientes].sort(), [PACIENTE_UNO, PACIENTE_DOS].sort());
  });

  it('una semana de turnos son siete preguntas como mucho', async () => {
    const semana = ['06', '07', '08', '09', '10', '11', '12'].flatMap((dia) => [
      guardiaDe(`2026-01-${dia}`, [conDireccion(PACIENTE_UNO)]),
      { ...guardiaDe(`2026-01-${dia}`, [conDireccion(PACIENTE_DOS)]), id: `tarde-${dia}` },
    ]);

    await conDomicilioDelDia(semana);

    assert.equal(preguntas.length, 7);
  });

  it('sin nadie a quien preguntarle no se toca la base', async () => {
    await conDomicilioDelDia([]);
    await conDomicilioDelDia([guardiaDe('2026-01-10', [])]);
    // Una guardia sin fecha no se puede resolver: no hay día contra el cual preguntar.
    await conDomicilioDelDia([{ id: 'sin-fecha', pacientes: [conDireccion(PACIENTE_UNO)] }]);

    assert.equal(preguntas.length, 0);
  });
});

describe('lo que no se pidió, no se completa', () => {
  it('un Paciente sin dirección visible sigue sin dirección', async () => {
    // La Prestadora tiene apagado `asistente_domicilio_del_paciente`, así que la consulta ni
    // pidió la dirección. Que exista una temporal cargada no la hace aparecer: lo que no se
    // puede ver, no viaja al teléfono (tarea 65).
    temporales = [EL_VERANO_EN_LA_CASA_DEL_HIJO];

    const sinDireccion = { id: PACIENTE_UNO, nombre: 'Quien sea' };
    const [guardia] = await conDomicilioDelDia([guardiaDe('2026-01-10', [sinDireccion])]);
    const [paciente] = guardia.pacientes;

    assert.deepEqual(Object.keys(paciente).sort(), ['id', 'nombre']);
    assert.equal(preguntas.length, 0);
  });

  it('el check-in pisa las coordenadas y no arrastra ni la dirección ni el motivo', async () => {
    // El check-in mide una distancia: pide `lat` y `lng` y nada más. Tiene que enterarse de
    // que la dirección es temporal —el aviso al Coordinador lo dice— pero el motivo no le
    // hace falta, y puede decir "internación", que es un dato de salud (CLAUDE.md §6).
    temporales = [EL_VERANO_EN_LA_CASA_DEL_HIJO];

    const comoLosPideElCheckin = { id: PACIENTE_UNO, nombre: 'Quien sea', lat: -34.6037, lng: -58.3816, familia_id: 'una-familia' };
    const [paciente] = await pacientesConDomicilioDelDia(
      { id: 'una-guardia', fecha: '2026-01-10' },
      [comoLosPideElCheckin]
    );

    assert.equal(paciente.lat, -37.11);
    assert.equal(paciente.lng, -56.86);
    assert.equal(paciente.domicilio_es_temporal, true);
    assert.equal(paciente.domicilio_motivo, null);
    assert.ok(!Object.hasOwn(paciente, 'domicilio'));
    // Lo que no tiene que ver con la dirección sigue tal cual estaba.
    assert.equal(paciente.familia_id, 'una-familia');
    assert.equal(paciente.nombre, 'Quien sea');
  });

  it('lo que llega no se modifica en el lugar', async () => {
    temporales = [EL_VERANO_EN_LA_CASA_DEL_HIJO];

    const original = conDireccion(PACIENTE_UNO);
    await conDomicilioDelDia([guardiaDe('2026-01-10', [original])]);

    assert.equal(original.domicilio, 'Av. Siempreviva 742');
    assert.ok(!Object.hasOwn(original, 'domicilio_es_temporal'));
  });
});

describe('lo que ve la Familia, que mira hoy y no un turno', () => {
  // La Familia no entra a una guardia: entra a ver a los suyos. La pregunta que hace su
  // aplicación es "¿dónde lo están atendiendo ahora?", y la fecha la pone el motor.
  const hoy = () => new Date().toISOString().slice(0, 10);

  it('pregunta por el día de hoy, no por ninguna fecha de guardia', async () => {
    const [paciente] = await pacientesConDomicilioDeHoy([conDireccion(PACIENTE_UNO)]);

    assert.equal(preguntas.length, 1);
    assert.equal(preguntas[0].cuerpo.p_fecha, hoy());
    assert.equal(paciente.domicilio_es_temporal, false);
  });

  it('si hoy cae adentro de una temporada, la Familia ve esa dirección y el motivo', async () => {
    temporales = [{ ...EL_VERANO_EN_LA_CASA_DEL_HIJO, fecha_inicio: hoy(), fecha_fin: null }];

    const [paciente] = await pacientesConDomicilioDeHoy([conDireccion(PACIENTE_UNO)]);

    assert.equal(paciente.domicilio, 'Los Aromos 15, Pinamar');
    assert.equal(paciente.domicilio_es_temporal, true);
    assert.equal(paciente.domicilio_motivo, 'Pasa el verano en la casa de su hijo');
  });

  it('varios Pacientes de la misma Familia se resuelven con una sola pregunta', async () => {
    temporales = [{ ...EL_VERANO_EN_LA_CASA_DEL_HIJO, fecha_inicio: hoy(), fecha_fin: null }];

    const pacientes = await pacientesConDomicilioDeHoy([
      conDireccion(PACIENTE_UNO),
      conDireccion(PACIENTE_DOS),
    ]);

    assert.equal(preguntas.length, 1);
    assert.deepEqual(
      pacientes.map((p) => [p.domicilio, p.domicilio_es_temporal]),
      [
        ['Los Aromos 15, Pinamar', true],
        ['Calle Falsa 123', false],
      ]
    );
  });

  it('una Familia sin Pacientes no le pregunta nada a la base', async () => {
    assert.deepEqual(await pacientesConDomicilioDeHoy([]), []);
    assert.equal(preguntas.length, 0);
  });
});

describe('varios Pacientes en el mismo turno', () => {
  it('cada uno con la suya: uno de temporada y el otro en su casa', async () => {
    // El matrimonio que se separa por unos días porque a uno lo internan, o el turno que cubre
    // a dos personas de la misma casa y una está de viaje. Resolver los dos con la misma
    // dirección es lo que manda al Asistente al lugar equivocado.
    temporales = [EL_VERANO_EN_LA_CASA_DEL_HIJO];

    const [guardia] = await conDomicilioDelDia([
      guardiaDe('2026-01-10', [conDireccion(PACIENTE_UNO), conDireccion(PACIENTE_DOS)]),
    ]);

    assert.deepEqual(
      guardia.pacientes.map((p) => [p.domicilio, p.domicilio_es_temporal]),
      [
        ['Los Aromos 15, Pinamar', true],
        ['Calle Falsa 123', false],
      ]
    );
  });
});

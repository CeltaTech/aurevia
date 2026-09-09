/**
 * Lo que el sistema anota solo cuando nadie apretó nada (pendiente #101).
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El producto se apoya en el acto de la persona: quien aprieta «salgo
 * ahora» y avisa que va demorado hizo algo, y eso lo protege. Lo que saca una máquina es un hecho,
 * no un mérito. De ahí salen cinco cosas que hay que garantizar, y ninguna se ve mirando el
 * código:
 *
 *   1. LOS DOS REGISTROS AUTOMÁTICOS NO SE MEZCLAN NUNCA CON EL AVISO DE UNA PERSONA. Se anotan
 *      con códigos de origen propios y sin nadie en «quién lo reportó», porque no lo reportó
 *      nadie.
 *   2. LA AUSENCIA DE TODO TAMBIÉN ES UN REGISTRO. Pasó la hora y no hay ni llegada, ni salida, ni
 *      aviso: eso se anota como el hecho que es.
 *   3. QUIEN MARCÓ LA SALIDA NUNCA CAE EN EL SEGUNDO REGISTRO, aunque de su viaje no se pueda
 *      estimar nada. Anotarle «ni aviso ni salida» a alguien que sí marcó la salida sería escribir
 *      algo falso.
 *   4. LOS MINUTOS DE ATRASO LOS DECIDE LA PRESTADORA. El mismo viaje, con dos configuraciones
 *      distintas, da dos resultados distintos.
 *   5. SI ALGUIEN YA AVISÓ, EL SISTEMA NO REPITE. El Coordinador ya está enterado; una segunda
 *      fila por el mismo viaje sólo le llena la pantalla.
 *
 * Y una que es la medida de todo esto: LA DETECCIÓN POR CÁLCULO LLEGA ANTES DE LA HORA DE INICIO.
 * Ahí están los minutos con los que la Prestadora puede cubrir la guardia; una alerta que aparece
 * cuando la hora ya pasó llega tarde para lo único que sirve.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';
import {
  FUENTE_AVISO_DEMORA_ASISTENTE,
  FUENTE_AVISO_TELEFONICO,
  FUENTE_CALCULO_LLEGADA_TARDIA,
  FUENTE_SIN_AVISO_NI_SALIDA,
  laDioUnaPersona,
} from '../fuentesAlertaTemprana.js';
import { MINUTOS_DEMORA_POR_OMISION } from '../llegadaEstimada.js';

const PRESTADORA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTRA_PRESTADORA = '99999999-9999-9999-9999-999999999999';
const GUARDIA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const GUARDIA_AJENA = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const PACIENTE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

// El domicilio del Paciente, y dos puntos de salida: uno a la vuelta de la esquina y otro a
// treinta y tres kilómetros, que a la velocidad media del producto son más de dos horas de viaje.
const DOMICILIO = { lat: -34.6, lng: -58.4 };
const SALIDA_CERCA = { lat: -34.604, lng: -58.4 };
const SALIDA_LEJOS = { lat: -34.9, lng: -58.4 };
// Un domicilio temporal lejísimos: es el caso de quien está pasando una temporada en la casa de
// un hijo, y lo que prueba que la cuenta se hace contra el domicilio que rige ese día.
const DOMICILIO_TEMPORAL = { lat: -35.2, lng: -58.4 };

const respuestas = new Map();
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    const cuerpo = crudo ? JSON.parse(crudo) : null;
    llamadas.push({ clave, url: req.url, cuerpo });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada({ cuerpo, url: req.url }) : preparada;
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

const { revisarLlegadasDemoradas } = await import('../revisarLlegadasDemoradas.js');
const { llegadaEstimadaDeGuardia } = await import('../estimarLlegadaDeGuardia.js');

after(() => {
  baseFalsa.close();
});

/** La fecha y la hora tal como las guarda la base, en hora local. */
function enDosPartes(momento) {
  const dosCifras = (n) => String(n).padStart(2, '0');
  return {
    fecha: `${momento.getFullYear()}-${dosCifras(momento.getMonth() + 1)}-${dosCifras(momento.getDate())}`,
    hora: `${dosCifras(momento.getHours())}:${dosCifras(momento.getMinutes())}:${dosCifras(momento.getSeconds())}`,
  };
}

function haceUnRato(minutos) {
  return new Date(Date.now() - minutos * 60 * 1000).toISOString();
}

/** Una guardia programada que empieza dentro de tantos minutos (negativo: ya empezó). */
function guardiaQueEmpiezaEn(minutos, extra = {}) {
  const inicio = new Date(Date.now() + minutos * 60 * 1000);
  const { fecha, hora } = enDosPartes(inicio);
  return {
    id: GUARDIA,
    prestadora_id: PRESTADORA,
    paciente_id: PACIENTE,
    fecha,
    hora_inicio: hora,
    salida_checkin_at: null,
    salida_lat: null,
    salida_lng: null,
    ...extra,
  };
}

/** Cuándo empieza, de verdad, una guardia de las de arriba. */
function inicioDe(guardia) {
  return new Date(`${guardia.fecha}T${guardia.hora_inicio}`);
}

let guardiasEnLaBase;
let alertasEnLaBase;
let nivelesDeEscalada;
/** Dónde se atiende al Paciente el día de la guardia, que puede no ser el de la ficha. */
let domicilioDelDia;

function filaQuePasaLosFiltros(url, filas) {
  const parametros = new URL(url, 'http://interno').searchParams;
  return filas.filter((fila) =>
    [...parametros.entries()].every(([campo, condicion]) => {
      if (!Object.hasOwn(fila, campo)) return true;
      if (condicion === 'is.null') return fila[campo] === null || fila[campo] === undefined;
      if (condicion === 'not.is.null') return fila[campo] !== null && fila[campo] !== undefined;
      if (!condicion.startsWith('eq.')) return true;
      return String(fila[campo]) === condicion.slice(3);
    })
  );
}

/** Los ids que trae un filtro `campo=in.(a,b,c)`, que es como los pide el cliente de la base. */
function idsPedidos(url, campo) {
  const crudo = new URL(url, 'http://interno').searchParams.get(campo) ?? '';
  if (!crudo.startsWith('in.(')) return [];
  return crudo
    .slice('in.('.length, -1)
    .split(',')
    .map((id) => id.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

/** Las alertas que el proceso anotó, en el orden en que las anotó. */
function alertasAnotadas() {
  return llamadas
    .filter((l) => l.clave === 'POST /rest/v1/alertas_tempranas_guardia')
    .map((l) => (Array.isArray(l.cuerpo) ? l.cuerpo[0] : l.cuerpo));
}

/** La consulta con la que el proceso fue a buscar las guardias. */
function consultaDeGuardias() {
  return llamadas.find((l) => l.clave === 'GET /rest/v1/guardias');
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  alertasEnLaBase = [];
  nivelesDeEscalada = [];
  guardiasEnLaBase = [];
  domicilioDelDia = { ...DOMICILIO, es_temporal: false, motivo: null };

  respuestas.set('GET /rest/v1/prestadoras', () => [{ id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/configuracion_escalada_relevo', () => nivelesDeEscalada);
  respuestas.set('GET /rest/v1/guardias', ({ url }) => filaQuePasaLosFiltros(url, guardiasEnLaBase));
  respuestas.set('GET /rest/v1/alertas_tempranas_guardia', ({ url }) =>
    filaQuePasaLosFiltros(url, alertasEnLaBase)
  );
  respuestas.set('POST /rest/v1/alertas_tempranas_guardia', () => []);
  // Contesta por las guardias que le preguntaron, y no por las que estén cargadas en la base
  // falsa. La diferencia importa: las pruebas que llaman a la estimación con una guardia en la
  // mano no cargan nada en `guardiasEnLaBase`, y una respuesta vacía las mandaba a la red de
  // seguridad de `pacientesDeGuardia.js` —la columna vieja `guardias.paciente_id`—, o sea a
  // probar un camino que no era el que decían probar.
  respuestas.set('GET /rest/v1/guardia_pacientes', ({ url }) =>
    idsPedidos(url, 'guardia_id').map((guardiaId) => ({
      guardia_id: guardiaId,
      pacientes: { id: PACIENTE, ...DOMICILIO },
    }))
  );
  respuestas.set('POST /rest/v1/rpc/domicilios_de_pacientes_en', () => [
    { paciente_id: PACIENTE, ...domicilioDelDia },
  ]);
});

// ============================================================================
// La cuenta: se detecta antes de la hora, que es para lo que sirve
// ============================================================================

describe('cálculo de llegada tardía — los minutos de aviso', () => {
  it('con la salida marcada lejos, la alerta se anota ANTES de la hora de inicio', async () => {
    const guardia = guardiaQueEmpiezaEn(20, { salida_checkin_at: haceUnRato(0), salida_lat: SALIDA_LEJOS.lat, salida_lng: SALIDA_LEJOS.lng });
    guardiasEnLaBase = [guardia];

    await revisarLlegadasDemoradas();

    const [alerta] = alertasAnotadas();
    assert.ok(alerta, 'tiene que quedar anotada la llegada tardía');
    assert.equal(alerta.fuente, FUENTE_CALCULO_LLEGADA_TARDIA);
    assert.equal(alerta.guardia_id, GUARDIA);
    assert.equal(alerta.prestadora_id, PRESTADORA);

    // Ésta es la medida de todo el mecanismo: cuántos minutos antes se enteró la Prestadora.
    const minutosDeAviso = (inicioDe(guardia).getTime() - new Date(alerta.detectado_at).getTime()) / 60000;
    assert.ok(minutosDeAviso > 0, `la alerta llegó ${minutosDeAviso} minutos después de la hora de inicio`);
  });

  it('la cuenta no la reporta nadie: no lleva persona ni motivo', async () => {
    guardiasEnLaBase = [
      guardiaQueEmpiezaEn(20, { salida_checkin_at: haceUnRato(0), salida_lat: SALIDA_LEJOS.lat, salida_lng: SALIDA_LEJOS.lng }),
    ];

    await revisarLlegadasDemoradas();

    const [alerta] = alertasAnotadas();
    // Poner ahí a la persona de la guardia diría que ella avisó, que es lo que no pasó.
    assert.equal(alerta.reportado_por, undefined);
    assert.equal(alerta.motivo, null);
    assert.equal(laDioUnaPersona(alerta.fuente), false);
    assert.notEqual(alerta.fuente, FUENTE_AVISO_DEMORA_ASISTENTE);
  });

  it('quien sale a tiempo y de cerca no queda anotado', async () => {
    guardiasEnLaBase = [
      guardiaQueEmpiezaEn(20, { salida_checkin_at: haceUnRato(0), salida_lat: SALIDA_CERCA.lat, salida_lng: SALIDA_CERCA.lng }),
    ];

    await revisarLlegadasDemoradas();
    assert.equal(alertasAnotadas().length, 0);
  });

  it('la cuenta se hace contra el domicilio que rige ese día, no contra el de la ficha', async () => {
    // Mismo viaje corto, pero ese día se lo atiende en otro lado, a sesenta kilómetros.
    domicilioDelDia = { ...DOMICILIO_TEMPORAL, es_temporal: true, motivo: 'temporada en casa de un familiar' };
    guardiasEnLaBase = [
      guardiaQueEmpiezaEn(20, { salida_checkin_at: haceUnRato(0), salida_lat: SALIDA_CERCA.lat, salida_lng: SALIDA_CERCA.lng }),
    ];

    await revisarLlegadasDemoradas();

    const [alerta] = alertasAnotadas();
    assert.ok(alerta, 'medir contra la casa de siempre habría dicho que llega a horario');
    assert.equal(alerta.fuente, FUENTE_CALCULO_LLEGADA_TARDIA);
  });
});

// ============================================================================
// Los minutos los decide la Prestadora
// ============================================================================

describe('el margen lo decide la Prestadora, no el código', () => {
  it('el mismo viaje no se anota si la Prestadora tolera más minutos', async () => {
    const guardia = guardiaQueEmpiezaEn(20, {
      salida_checkin_at: haceUnRato(0),
      salida_lat: SALIDA_LEJOS.lat,
      salida_lng: SALIDA_LEJOS.lng,
    });

    // Primero con lo que trae de fábrica: se anota.
    guardiasEnLaBase = [guardia];
    await revisarLlegadasDemoradas();
    assert.equal(alertasAnotadas().length, 1);

    // Y ahora con un margen configurado que cubre el viaje entero: no se anota nada.
    llamadas = [];
    nivelesDeEscalada = [{ minutos_demora: 400 }];
    await revisarLlegadasDemoradas();
    assert.equal(alertasAnotadas().length, 0);
    assert.notEqual(400, MINUTOS_DEMORA_POR_OMISION);
  });

  it('con varios niveles manda el primer escalón, el más chico', async () => {
    nivelesDeEscalada = [{ minutos_demora: 400 }, { minutos_demora: 5 }];
    guardiasEnLaBase = [guardiaQueEmpiezaEn(-30)];

    await revisarLlegadasDemoradas();
    // Empezó hace treinta minutos: con el escalón de cinco ya está vencida.
    assert.equal(alertasAnotadas()[0].fuente, FUENTE_SIN_AVISO_NI_SALIDA);
  });
});

// ============================================================================
// La ausencia de todo también es un registro
// ============================================================================

describe('ni aviso ni salida — la ausencia de todo, anotada como hecho', () => {
  it('pasada la hora con su margen y sin nada, queda el registro', async () => {
    guardiasEnLaBase = [guardiaQueEmpiezaEn(-(MINUTOS_DEMORA_POR_OMISION + 5))];

    await revisarLlegadasDemoradas();

    const [alerta] = alertasAnotadas();
    assert.ok(alerta, 'la ausencia de todo también se anota');
    assert.equal(alerta.fuente, FUENTE_SIN_AVISO_NI_SALIDA);
    assert.equal(alerta.motivo, null);
    assert.equal(alerta.reportado_por, undefined);
  });

  it('antes de que se cumpla el margen no se anota nada', async () => {
    guardiasEnLaBase = [guardiaQueEmpiezaEn(20)];
    await revisarLlegadasDemoradas();
    assert.equal(alertasAnotadas().length, 0);
  });

  it('quien marcó la salida nunca queda anotado como «ni aviso ni salida»', async () => {
    // Marcó la salida, pero el teléfono no pudo ubicarla: de ese viaje no se puede estimar nada.
    // No saber no es no haber avisado, y anotarle lo contrario sería escribir algo falso.
    guardiasEnLaBase = [
      guardiaQueEmpiezaEn(-60, { salida_checkin_at: haceUnRato(70), salida_lat: null, salida_lng: null }),
    ];

    await revisarLlegadasDemoradas();
    assert.equal(alertasAnotadas().length, 0);
  });

  it('una guardia de anteayer ya no se anota: cubrirla no sirve de nada', async () => {
    guardiasEnLaBase = [guardiaQueEmpiezaEn(-60 * 30)];
    await revisarLlegadasDemoradas();
    assert.equal(alertasAnotadas().length, 0);
  });
});

// ============================================================================
// El acto de la persona manda: el sistema no lo repite ni lo pisa
// ============================================================================

describe('si alguien ya avisó, el sistema no agrega nada', () => {
  for (const fuente of [FUENTE_AVISO_DEMORA_ASISTENTE, FUENTE_AVISO_TELEFONICO]) {
    it(`con un aviso abierto de origen «${fuente}» no se anota nada nuevo`, async () => {
      guardiasEnLaBase = [guardiaQueEmpiezaEn(-30)];
      alertasEnLaBase = [
        { guardia_id: GUARDIA, prestadora_id: PRESTADORA, fuente, resuelto_at: null },
      ];

      await revisarLlegadasDemoradas();
      assert.equal(alertasAnotadas().length, 0);
    });
  }

  it('el mismo origen no se anota dos veces por la misma guardia', async () => {
    guardiasEnLaBase = [guardiaQueEmpiezaEn(-30)];
    // Ya se anotó una vez y el Coordinador la resolvió: no vuelve a anotarse por lo mismo.
    alertasEnLaBase = [
      {
        guardia_id: GUARDIA,
        prestadora_id: PRESTADORA,
        fuente: FUENTE_SIN_AVISO_NI_SALIDA,
        resuelto_at: haceUnRato(5),
      },
    ];

    await revisarLlegadasDemoradas();
    assert.equal(alertasAnotadas().length, 0);
  });

  it('una alerta resuelta de otro origen no impide anotar la que corresponde', async () => {
    guardiasEnLaBase = [guardiaQueEmpiezaEn(-30)];
    alertasEnLaBase = [
      {
        guardia_id: GUARDIA,
        prestadora_id: PRESTADORA,
        fuente: FUENTE_CALCULO_LLEGADA_TARDIA,
        resuelto_at: haceUnRato(5),
      },
    ];

    await revisarLlegadasDemoradas();
    assert.equal(alertasAnotadas()[0].fuente, FUENTE_SIN_AVISO_NI_SALIDA);
  });

  it('sin poder leer lo que ya está anotado no se anota nada', async () => {
    // Repetirle al Coordinador una alerta que ya existe le llena la pantalla de filas iguales, y
    // eso termina en un filtro del correo. Ante la duda, no se escribe.
    guardiasEnLaBase = [guardiaQueEmpiezaEn(-30)];
    respuestas.set('GET /rest/v1/alertas_tempranas_guardia', () => undefined);

    await revisarLlegadasDemoradas();
    assert.equal(alertasAnotadas().length, 0);
  });
});

// ============================================================================
// Aislamiento y alcance de la consulta
// ============================================================================

describe('a quién mira este proceso', () => {
  it('la consulta va acotada a una Prestadora por vez', async () => {
    guardiasEnLaBase = [guardiaQueEmpiezaEn(-30)];
    await revisarLlegadasDemoradas();
    assert.ok(consultaDeGuardias().url.includes(`prestadora_id=eq.${PRESTADORA}`), consultaDeGuardias().url);
  });

  it('la guardia de otra Prestadora no entra en la revisión de ésta', async () => {
    guardiasEnLaBase = [
      guardiaQueEmpiezaEn(-30, { id: GUARDIA_AJENA, prestadora_id: OTRA_PRESTADORA }),
    ];

    await revisarLlegadasDemoradas();
    assert.equal(alertasAnotadas().length, 0);
  });

  it('no mira guardias sin Asistente, ni guardias que ya marcaron la llegada', async () => {
    guardiasEnLaBase = [guardiaQueEmpiezaEn(-30)];
    await revisarLlegadasDemoradas();
    const { url } = consultaDeGuardias();
    // De los huecos sin cubrir se ocupa otro proceso, que sabe en qué punto está la búsqueda.
    assert.ok(url.includes('asistente_id=not.is.null'), url);
    assert.ok(url.includes('checkin_at=is.null'), url);
    assert.ok(url.includes('estado=eq.programada'), url);
  });
});

// ============================================================================
// La estimación, mirada de cerca
// ============================================================================

describe('estimarLlegadaDeGuardia — qué devuelve y qué no', () => {
  it('sin marca de salida no hay estimación, y eso se dice', async () => {
    const estimada = await llegadaEstimadaDeGuardia(guardiaQueEmpiezaEn(20));
    assert.equal(estimada, null);
  });

  it('con salida marcada pero sin punto tampoco: no se inventa una hora', async () => {
    const estimada = await llegadaEstimadaDeGuardia(
      guardiaQueEmpiezaEn(20, { salida_checkin_at: haceUnRato(5), salida_lat: null, salida_lng: null })
    );
    assert.equal(estimada, null);
  });

  it('con salida y punto devuelve una hora posterior a la salida', async () => {
    const salidaAt = haceUnRato(5);
    const estimada = await llegadaEstimadaDeGuardia(
      guardiaQueEmpiezaEn(20, { salida_checkin_at: salidaAt, salida_lat: SALIDA_LEJOS.lat, salida_lng: SALIDA_LEJOS.lng })
    );
    assert.ok(estimada instanceof Date);
    assert.ok(estimada.getTime() > new Date(salidaAt).getTime());
  });

  it('lo que devuelve es una hora y nunca un punto: el lugar del que salió no viaja', async () => {
    const estimada = await llegadaEstimadaDeGuardia(
      guardiaQueEmpiezaEn(20, { salida_checkin_at: haceUnRato(5), salida_lat: SALIDA_LEJOS.lat, salida_lng: SALIDA_LEJOS.lng })
    );
    // Es la garantía de que de acá no sale la ubicación de nadie hacia ninguna pantalla.
    assert.equal(typeof estimada.getTime(), 'number');
    assert.equal(Object.hasOwn(estimada, 'lat'), false);
    assert.equal(Object.hasOwn(estimada, 'lng'), false);
  });

  it('sin salida marcada ni siquiera se le pregunta a la base por el domicilio', async () => {
    llamadas = [];
    await llegadaEstimadaDeGuardia(guardiaQueEmpiezaEn(20));
    assert.equal(llamadas.length, 0);
  });
});

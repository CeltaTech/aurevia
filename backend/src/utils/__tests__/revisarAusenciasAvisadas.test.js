/**
 * Que faltar avisando con tiempo y faltar de golpe no le lleguen igual a la Coordinadora.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El aviso de turno sin cubrir no ve esto: mira los turnos que no
 * tienen a nadie asignado, y el turno de una Asistente de licencia la sigue teniendo asignada. Si
 * este proceso se equivoca, nadie más lo tapa. Lo que tiene que garantizar:
 *
 *   1. LAS DOS CLASES SALEN COMO DOS AVISOS DISTINTOS. Una es una tarea para cuando se pueda, la
 *      otra es un turno que empieza enseguida. Con un solo aviso, apagar el ruido apagaría también
 *      la alarma.
 *   2. LA CLASE SE RECALCULA, NO SE CONGELA. Sale de una cuenta que se rehace en cada vuelta, así
 *      que corregir cuándo se supo, o el número de la Prestadora, la cambia — y entonces se vuelve
 *      a avisar, aunque ya se haya avisado recién.
 *   3. LA QUE LLEGÓ CON MARGEN NO INSISTE. Repetir cada dos horas algo que tiene tres días es el
 *      modo más rápido de que la Coordinadora deje de leer los avisos.
 *   4. LA QUE NO DEJA NINGÚN TURNO SIN NADIE NO AVISA NADA.
 *   5. CADA PRESTADORA SE MIRA CON SU PROPIO NÚMERO, y nunca con la configuración de otra.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTRA_PRESTADORA = '99999999-9999-9999-9999-999999999999';
const ASISTENTE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const AUSENCIA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const respuestas = new Map();
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const direccion = new URL(req.url, 'http://interno');
    const clave = `${req.method} ${direccion.pathname}`;
    llamadas.push({ clave, filtros: direccion.searchParams, cuerpo: crudo ? JSON.parse(crudo) : null });

    const preparada = respuestas.get(clave);
    // Sin preparar, vacío: este proceso consulta media docena de tablas y la prueba sólo quiere
    // hablar de dos. Que las demás contesten vacío es lo mismo que decir «no hay nada cargado».
    const valor = typeof preparada === 'function' ? preparada(direccion.searchParams) : (preparada ?? []);

    const unoSolo = (req.headers.accept || '').includes('vnd.pgrst.object+json');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(unoSolo && Array.isArray(valor) ? valor[0] ?? null : valor));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// Después de las variables de entorno: la conexión se arma al importar.
const { revisarAusenciasAvisadas } = await import('../revisarAusenciasAvisadas.js');

after(() => baseFalsa.close());

/** Un momento de hoy, corrido las horas que se pidan. */
function enHoras(horas) {
  return new Date(Date.now() + horas * 60 * 60 * 1000);
}

/** La fecha de ese momento como la guarda la base, en hora local. */
function fecha(momento) {
  const corrida = new Date(momento.getTime() - momento.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}

/** La hora de ese momento como la guarda la base. */
function hora(momento) {
  return `${String(momento.getHours()).padStart(2, '0')}:${String(momento.getMinutes()).padStart(2, '0')}:00`;
}

/**
 * Una ausencia cuyo primer turno empieza dentro de las horas indicadas, y que se supo hace las
 * horas indicadas. Las dos cosas juntas son lo que decide la clase.
 */
function escenario({ turnoEnHoras, supoHaceHoras, prestadoraId = PRESTADORA, ...resto }) {
  const inicio = enHoras(turnoEnHoras);
  respuestas.set('GET /rest/v1/ausencias', () => [
    {
      id: AUSENCIA,
      prestadora_id: prestadoraId,
      asistente_id: ASISTENTE,
      fecha_inicio: fecha(enHoras(-24)),
      fecha_fin: null,
      avisada_en: enHoras(-supoHaceHoras).toISOString(),
      created_at: enHoras(-supoHaceHoras).toISOString(),
      aviso_ausencia_at: null,
      aviso_ausencia_veces: 0,
      aviso_ausencia_clase: null,
      ...resto,
    },
  ]);
  respuestas.set('GET /rest/v1/guardias', () => [
    {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      asistente_id: ASISTENTE,
      paciente_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      fecha: fecha(inicio),
      hora_inicio: hora(inicio),
      hora_fin: '23:59:00',
      estado: 'programada',
    },
  ]);
}

/** Qué evento se pidió avisar, o `undefined` si no se avisó nada. */
function eventoAvisado() {
  const pedido = llamadas.find((l) => l.clave === 'GET /rest/v1/configuracion_notificaciones');
  return pedido?.filtros.get('evento')?.replace(/^eq\./, '');
}

/** Lo que el proceso marcó en la ausencia, o `undefined` si no marcó nada. */
function loMarcado() {
  return llamadas.find((l) => l.clave === 'PATCH /rest/v1/ausencias')?.cuerpo;
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  // Apagado en la configuración de la Prestadora: el aviso no sale por ningún lado y la prueba
  // igual ve cuál se pidió. Lo que se mira acá es la decisión, no el envío.
  respuestas.set('GET /rest/v1/configuracion_notificaciones', () => [{ activo: false }]);
});

// ---------------------------------------------------------------------------------------

describe('cómo llega la falta', () => {
  it('avisada con tres días de margen sale como tarea', async () => {
    escenario({ turnoEnHoras: 72, supoHaceHoras: 0 });
    await revisarAusenciasAvisadas();
    assert.equal(eventoAvisado(), 'ausencia_avisada_con_tiempo');
    assert.equal(loMarcado().aviso_ausencia_clase, 'con_tiempo');
  });

  it('con el turno empezando en dos horas sale como alarma', async () => {
    escenario({ turnoEnHoras: 2, supoHaceHoras: 0 });
    await revisarAusenciasAvisadas();
    assert.equal(eventoAvisado(), 'ausencia_de_golpe');
    assert.equal(loMarcado().aviso_ausencia_clase, 'de_golpe');
  });

  it('la que no deja ningún turno sin nadie no avisa nada', async () => {
    escenario({ turnoEnHoras: 2, supoHaceHoras: 0 });
    respuestas.set('GET /rest/v1/guardias', () => []);
    await revisarAusenciasAvisadas();
    assert.equal(eventoAvisado(), undefined, 'avisó por una ausencia que no deja ningún hueco');
    assert.equal(loMarcado(), undefined);
  });

  it('el turno que ya pasó hace días no se avisa: taparlo ya no sirve de nada', async () => {
    escenario({ turnoEnHoras: -72, supoHaceHoras: 96 });
    await revisarAusenciasAvisadas();
    assert.equal(eventoAvisado(), undefined);
  });
});

describe('cuándo se vuelve a avisar', () => {
  it('la que llegó con margen se dice una sola vez', async () => {
    escenario({
      turnoEnHoras: 72,
      supoHaceHoras: 0,
      aviso_ausencia_at: enHoras(-12).toISOString(),
      aviso_ausencia_veces: 1,
      aviso_ausencia_clase: 'con_tiempo',
    });
    await revisarAusenciasAvisadas();
    assert.equal(eventoAvisado(), undefined, 'repitió una tarea que no cambió');
  });

  it('si se corrige cuándo se supo, avisa de nuevo aunque ya se haya avisado recién', async () => {
    // Entró como tarea porque nadie había cargado cuándo avisaron, y después la Coordinadora
    // corrigió: avisaron hace un rato, no hace días. Callarla porque «ya se avisó» dejaría el
    // turno de esta tarde tratado como algo que puede esperar.
    escenario({
      turnoEnHoras: 1,
      supoHaceHoras: 1,
      aviso_ausencia_at: new Date().toISOString(),
      aviso_ausencia_veces: 1,
      aviso_ausencia_clase: 'con_tiempo',
    });
    await revisarAusenciasAvisadas();
    assert.equal(eventoAvisado(), 'ausencia_de_golpe');
    assert.equal(loMarcado().aviso_ausencia_veces, 2);
  });

  it('la urgente no se repite antes de que pase el intervalo', async () => {
    escenario({
      turnoEnHoras: 2,
      supoHaceHoras: 1,
      aviso_ausencia_at: enHoras(-0.5).toISOString(),
      aviso_ausencia_veces: 1,
      aviso_ausencia_clase: 'de_golpe',
    });
    await revisarAusenciasAvisadas();
    assert.equal(eventoAvisado(), undefined);
  });

  it('la urgente vuelve a avisar pasado el intervalo', async () => {
    escenario({
      turnoEnHoras: 2,
      supoHaceHoras: 5,
      aviso_ausencia_at: enHoras(-5).toISOString(),
      aviso_ausencia_veces: 3,
      aviso_ausencia_clase: 'de_golpe',
    });
    await revisarAusenciasAvisadas();
    assert.equal(eventoAvisado(), 'ausencia_de_golpe');
    assert.equal(loMarcado().aviso_ausencia_veces, 4);
  });
});

describe('cada Prestadora con lo suyo', () => {
  it('pregunta la configuración de la Prestadora de la ausencia, no de cualquiera', async () => {
    escenario({ turnoEnHoras: 2, supoHaceHoras: 0, prestadoraId: OTRA_PRESTADORA });
    await revisarAusenciasAvisadas();
    const pregunta = llamadas.find((l) => l.clave === 'GET /rest/v1/configuracion_ausencias');
    assert.equal(pregunta.filtros.get('prestadora_id'), `eq.${OTRA_PRESTADORA}`);
  });

  it('busca las guardias de esa Prestadora y sólo de los que faltan', async () => {
    escenario({ turnoEnHoras: 2, supoHaceHoras: 0 });
    await revisarAusenciasAvisadas();
    const pregunta = llamadas.find((l) => l.clave === 'GET /rest/v1/guardias');
    assert.equal(pregunta.filtros.get('prestadora_id'), `eq.${PRESTADORA}`);
    assert.match(pregunta.filtros.get('asistente_id') ?? '', new RegExp(ASISTENTE));
  });

  it('con otro número configurado, la misma falta cambia de clase', async () => {
    // El mismo turno a tres días: de fábrica es una tarea; para una Prestadora que quiere
    // enterarse con una semana de anticipación, es urgente.
    escenario({ turnoEnHoras: 72, supoHaceHoras: 0 });
    respuestas.set('GET /rest/v1/configuracion_ausencias', () => [
      { regla: { horas_para_considerarla_con_tiempo: 168 } },
    ]);
    await revisarAusenciasAvisadas();
    assert.equal(eventoAvisado(), 'ausencia_de_golpe');
  });
});

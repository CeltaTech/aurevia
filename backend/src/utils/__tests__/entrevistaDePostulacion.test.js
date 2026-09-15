/**
 * La entrevista de una postulación, llamada de frente, sin ninguna ruta que la cuide antes.
 *
 *   npm test --prefix backend
 *   node --test backend/src/utils/__tests__/entrevistaDePostulacion.test.js
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Acá hay una puerta que se abre sin sesión: quien se postuló no tiene
 * cuenta, así que entra con una llave que le llegó por correo. Una puerta así se comprueba por lo
 * que NO deja salir, y eso no se ve mirando la pantalla: se ve mirando qué le pidió a la base y qué
 * devolvió. Las tres cosas que no pueden pasar son que la dirección de la sala salga fuera de hora,
 * que una postulación de otra Prestadora se pueda agendar, y que agendar dos veces cree dos citas.
 *
 * La base es de mentira y contesta por HTTP igual que la de verdad, así que lo que se afirma no es
 * que la función haya pensado bien por dentro sino qué terminó pidiéndole a la base.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const PRESTADORA_AJENA = '22222222-2222-2222-2222-222222222222';
const USUARIO = '33333333-3333-3333-3333-333333333333';
const POSTULACION = 4100;
const LLAVE = 'una-llave-larga-de-mentira-que-pasa-el-minimo-de-treinta-y-dos';
const BASE_DE_SALAS = 'https://salas.ejemplo/aca';

const EN_UNA_HORA = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

/** Lo que la base contesta. Cada prueba deja acá el mundo que quiere. */
let postulacion = null;
let entrevistas = [];
let prestadora = null;
/** Todo lo que se le pidió a la base, para poder afirmar lo que NO salió. */
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const url = new URL(req.url, 'http://interno');
    const cuerpo = crudo ? JSON.parse(crudo) : null;
    llamadas.push({ metodo: req.method, ruta: url.pathname, cuerpo });

    const unoSolo = (req.headers.accept || '').includes('vnd.pgrst.object+json');

    /* La base de verdad aplica los filtros de la consulta, y ésta también tiene que aplicarlos: una
       base falsa que contesta lo mismo se le pida lo que se le pida deja pasar la prueba de
       aislamiento sin que exista el filtro. Sería una prueba que no puede fallar. */
    const contestar = (filas) => {
      const filtradas = filas.filter((fila) =>
        [...url.searchParams].every(([columna, condicion]) => {
          if (!(columna in fila) || !String(condicion).startsWith('eq.')) return true;
          return String(fila[columna]) === String(condicion).slice(3);
        }),
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(unoSolo ? (filtradas[0] ?? null) : filtradas));
    };

    if (url.pathname === '/rest/v1/postulaciones') return contestar(postulacion ? [postulacion] : []);
    if (url.pathname === '/rest/v1/prestadoras') return contestar(prestadora ? [prestadora] : []);

    if (url.pathname === '/rest/v1/entrevistas_postulacion') {
      if (req.method === 'POST') {
        const fila = { id: 'e-1', llave_publica: LLAVE, estado: 'agendada', ...cuerpo };
        entrevistas = [...entrevistas, fila];
        return contestar([fila]);
      }
      if (req.method === 'PATCH') {
        const fila = { ...entrevistas[0], ...cuerpo };
        entrevistas = [fila];
        // La fila modificada vuelve tal cual, sin pasar por los filtros: es lo que hace la base de
        // verdad, que devuelve lo que acaba de escribir aunque ya no cumpla la condición de la
        // consulta —cerrar una entrevista es justamente eso—.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(unoSolo ? fila : [fila]));
        return;
      }
      return contestar(entrevistas);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';
process.env.PANEL_URL = 'https://panel.ejemplo';

// El import va después de las variables de entorno: la conexión se arma al importarse, con la
// dirección que haya en ese instante.
const {
  agendarEntrevista,
  cancelarEntrevista,
  cerrarEntrevista,
  entrevistaPorLlave,
  reprogramarEntrevista,
} = await import('../entrevistaDePostulacion.js');
const { MINUTOS_DE_TOLERANCIA } = await import('../videollamada.js');

after(() => {
  baseFalsa.close();
});

beforeEach(() => {
  llamadas = [];
  entrevistas = [];
  postulacion = {
    id: POSTULACION,
    nombre: 'Marta Ledesma',
    email: 'marta@ejemplo',
    idioma: 'es-AR',
    prestadora_id: PRESTADORA,
  };
  prestadora = {
    id: PRESTADORA,
    nombre_fantasia: 'Cuidados del Sur',
    logo_url: null,
    videollamada_base_url: BASE_DE_SALAS,
  };
});

const insertos = () =>
  llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/rest/v1/entrevistas_postulacion');

async function elMotivo(promesa) {
  return promesa.then(
    () => null,
    (error) => error.motivo ?? error.message,
  );
}

/** Deja una entrevista ya agendada, como si alguien la hubiera creado antes. */
function yaHayUnaAgendada(campos = {}) {
  entrevistas = [
    {
      id: 'e-1',
      prestadora_id: PRESTADORA,
      postulacion_id: POSTULACION,
      agendada_para: EN_UNA_HORA(),
      llave_publica: LLAVE,
      sala_videollamada: 'sala-de-mentira',
      estado: 'agendada',
      ...campos,
    },
  ];
}

describe('agendar', () => {
  it('crea la cita con su llave y su sala', async () => {
    const entrevista = await agendarEntrevista({
      prestadoraId: PRESTADORA,
      postulacionId: POSTULACION,
      agendadaPara: EN_UNA_HORA(),
      usuarioId: USUARIO,
    });

    assert.equal(entrevista.estado, 'agendada');
    const [insertado] = insertos();
    assert.equal(insertado.cuerpo.prestadora_id, PRESTADORA);
    assert.equal(insertado.cuerpo.agendada_por, USUARIO);
    assert.ok(insertado.cuerpo.sala_videollamada, 'la sala tendría que existir');
    // La llave es toda la credencial de quien no tiene cuenta: si fuera corta o deducible de algún
    // dato de la persona, la puerta se abriría probando.
    assert.ok(insertado.cuerpo.llave_publica.length >= 32);
    assert.ok(!insertado.cuerpo.llave_publica.includes(String(POSTULACION)));
  });

  // «El producto no prohíbe ni bloquea: avisa» (celtatech/CLAUDE.md §7). Sin dirección base no hay
  // sala, pero acordar el día y dejar la constancia sirve lo mismo.
  it('sin videollamada configurada, la cita se agenda igual y sin sala', async () => {
    prestadora = { ...prestadora, videollamada_base_url: null };

    await agendarEntrevista({
      prestadoraId: PRESTADORA,
      postulacionId: POSTULACION,
      agendadaPara: EN_UNA_HORA(),
      usuarioId: USUARIO,
    });

    assert.equal(insertos()[0].cuerpo.sala_videollamada, null);
  });

  it('no agenda una segunda cuando ya hay una viva', async () => {
    yaHayUnaAgendada();

    const motivo = await elMotivo(
      agendarEntrevista({
        prestadoraId: PRESTADORA,
        postulacionId: POSTULACION,
        agendadaPara: EN_UNA_HORA(),
        usuarioId: USUARIO,
      }),
    );

    assert.equal(motivo, 'entrevista_ya_agendada');
    assert.deepEqual(insertos(), [], 'no tendría que haber salido ningún alta');
  });

  // Ésta es la que mira el aislamiento: la postulación es de otra Prestadora, así que para esta
  // sesión no existe, y el motivo que sale es «no encontrado» y no «sin permiso».
  it('no agenda sobre una postulación de otra Prestadora', async () => {
    const motivo = await elMotivo(
      agendarEntrevista({
        prestadoraId: PRESTADORA_AJENA,
        postulacionId: POSTULACION,
        agendadaPara: EN_UNA_HORA(),
        usuarioId: USUARIO,
      }),
    );

    assert.equal(motivo, 'no_encontrado');
    assert.deepEqual(insertos(), []);
  });

  it('no agenda para ayer', async () => {
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    assert.equal(
      await elMotivo(
        agendarEntrevista({
          prestadoraId: PRESTADORA,
          postulacionId: POSTULACION,
          agendadaPara: ayer,
          usuarioId: USUARIO,
        }),
      ),
      'entrevista_en_el_pasado',
    );
    assert.equal(
      await elMotivo(
        agendarEntrevista({
          prestadoraId: PRESTADORA,
          postulacionId: POSTULACION,
          agendadaPara: 'el jueves',
          usuarioId: USUARIO,
        }),
      ),
      'fecha_invalida',
    );
    assert.deepEqual(insertos(), []);
  });
});

describe('mover, cancelar y cerrar', () => {
  // La llave viajó por correo una sola vez. Si reprogramar la cambiara, el postulante tendría que
  // ir a buscar el correo nuevo y el viejo lo dejaría afuera.
  it('reprogramar no cambia la llave ni la sala', async () => {
    yaHayUnaAgendada();
    const nueva = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const entrevista = await reprogramarEntrevista({
      prestadoraId: PRESTADORA,
      postulacionId: POSTULACION,
      agendadaPara: nueva,
    });

    assert.equal(entrevista.llave_publica, LLAVE);
    assert.equal(entrevista.sala_videollamada, 'sala-de-mentira');
    const [patch] = llamadas.filter((l) => l.metodo === 'PATCH');
    assert.deepEqual(Object.keys(patch.cuerpo), ['agendada_para']);
  });

  it('cancelar apaga la sala en el momento', async () => {
    yaHayUnaAgendada();

    const entrevista = await cancelarEntrevista({
      prestadoraId: PRESTADORA,
      postulacionId: POSTULACION,
      usuarioId: USUARIO,
    });

    assert.equal(entrevista.estado, 'cancelada');
    assert.equal(entrevista.sala_videollamada, null);
    assert.equal(entrevista.cerrada_por, USUARIO);
  });

  // Haber entrevistado a alguien no es haberlo aprobado: esa decisión se toma en la pantalla de
  // Postulantes. Si esta función tocara la postulación, la estaría tomando sola.
  it('cerrar no toca la situación de la postulación', async () => {
    yaHayUnaAgendada();

    const entrevista = await cerrarEntrevista({
      prestadoraId: PRESTADORA,
      postulacionId: POSTULACION,
      estado: 'no_asistio',
      usuarioId: USUARIO,
      observaciones: 'No se presentó ni avisó',
    });

    assert.equal(entrevista.estado, 'no_asistio');
    const escrituras = llamadas.filter(
      (l) => l.ruta === '/rest/v1/postulaciones' && l.metodo !== 'GET',
    );
    assert.deepEqual(escrituras, [], 'la postulación no se toca al cerrar una entrevista');
  });

  it('un cierre que no es un cierre no pasa', async () => {
    yaHayUnaAgendada();
    assert.equal(
      await elMotivo(
        cerrarEntrevista({
          prestadoraId: PRESTADORA,
          postulacionId: POSTULACION,
          estado: 'cancelada',
          usuarioId: USUARIO,
        }),
      ),
      'faltan_datos',
    );
    assert.deepEqual(llamadas.filter((l) => l.metodo === 'PATCH'), []);
  });

  it('no se cierra ni se mueve lo que ya está cerrado', async () => {
    yaHayUnaAgendada({ estado: 'realizada' });

    assert.equal(
      await elMotivo(
        cerrarEntrevista({
          prestadoraId: PRESTADORA,
          postulacionId: POSTULACION,
          estado: 'realizada',
          usuarioId: USUARIO,
        }),
      ),
      'entrevista_ya_cerrada',
    );
    assert.equal(
      await elMotivo(
        reprogramarEntrevista({
          prestadoraId: PRESTADORA,
          postulacionId: POSTULACION,
          agendadaPara: EN_UNA_HORA(),
        }),
      ),
      'no_encontrado',
    );
    assert.deepEqual(llamadas.filter((l) => l.metodo === 'PATCH'), []);
  });
});

describe('la puerta del postulante', () => {
  it('a la hora de la cita da la dirección de la sala y nada más', async () => {
    yaHayUnaAgendada({ agendada_para: new Date().toISOString() });

    const vista = await entrevistaPorLlave(LLAVE);

    assert.equal(vista.momento, 'ahora');
    assert.equal(vista.url, `${BASE_DE_SALAS}/sala-de-mentira`);
    // Nada del postulante, nada de quien entrevista, nada de lo anotado por dentro.
    assert.deepEqual(Object.keys(vista).sort(), [
      'agendada_para',
      'hay_videollamada',
      'logo_url',
      'momento',
      'prestadora',
      'url',
    ]);
  });

  it('antes de tiempo dice cuándo volver, sin dar la sala', async () => {
    yaHayUnaAgendada({ agendada_para: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() });

    const vista = await entrevistaPorLlave(LLAVE);

    assert.equal(vista.momento, 'todavia_no');
    assert.equal(vista.url, null);
    // Y distingue «todavía no es la hora» de «esta entrevista no tiene videollamada»: una se
    // arregla volviendo más tarde y la otra no se arregla sola.
    assert.equal(vista.hay_videollamada, true);
  });

  it('pasada la tolerancia tampoco da la sala', async () => {
    const hace = MINUTOS_DE_TOLERANCIA + 10;
    yaHayUnaAgendada({ agendada_para: new Date(Date.now() - hace * 60 * 1000).toISOString() });

    const vista = await entrevistaPorLlave(LLAVE);

    assert.equal(vista.momento, 'ya_paso');
    assert.equal(vista.url, null);
  });

  // Falla cerrado, y contesta lo mismo en los tres casos: probar llaves no dice nada.
  it('una llave que no existe, una vacía y una entrevista cerrada contestan igual', async () => {
    entrevistas = [];
    assert.equal(await elMotivo(entrevistaPorLlave('otra-llave')), 'no_encontrado');
    assert.equal(await elMotivo(entrevistaPorLlave('')), 'no_encontrado');
    assert.equal(await elMotivo(entrevistaPorLlave(null)), 'no_encontrado');

    yaHayUnaAgendada({ estado: 'cancelada', sala_videollamada: null });
    assert.equal(await elMotivo(entrevistaPorLlave(LLAVE)), 'no_encontrado');
  });
});

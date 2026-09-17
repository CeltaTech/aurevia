/**
 * Cuándo una Asistente quedó de más, y qué se le cuenta mientras espera.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. De estas cuentas sale el rato que una persona se quedó adentro de
 * una casa después de terminar su turno, y ese rato es trabajo que después se paga. Un error acá
 * no se ve en ninguna pantalla: se ve en lo que cobra.
 *
 * Tres cosas se vigilan, y las tres ya salieron mal alguna vez en este producto:
 *   - la medianoche, que convierte `22:00 → 06:00` en dos días y no en uno;
 *   - la hora en que termina la extensión, que es la del hecho y nunca la del proceso de fondo
 *     que se dio cuenta —el proceso corre cada cinco minutos, así que tomar su hora le regalaría
 *     hasta cinco minutos por vez a quien no los trabajó, o se los sacaría—;
 *   - los pasos que se le muestran, donde no puede aparecer el nombre de nadie.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

// La conexión a la base se arma sola al importar, y `createClient` no acepta una dirección vacía.
// Acá no se consulta nada: todo lo que se prueba es puro.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';
const {
  laQueSigue,
  laExtensionCorresponde,
  laExtensionTermino,
  cuandoTermino,
  pasosDeLaBusqueda,
  PASOS_DE_LA_BUSQUEDA,
} = await import('../extensionDeTurno.js');

/** El turno de la noche del viernes: arranca a las 22 y termina el sábado a las 6. */
const NOCHE = {
  id: 'noche',
  fecha: '2026-09-04',
  hora_inicio: '22:00',
  hora_fin: '06:00',
  checkin_at: '2026-09-04T22:01:00.000Z',
  checkout_at: null,
};

// Los momentos que se comparan contra el fin de un turno van SIN zona: `finDeGuardia` arma la
// fecha con la hora de reloj tal como está escrita, que es la hora del lugar donde se trabaja.
// Escribirlos en hora universal correría la prueba tres horas y la haría pasar o fallar según en
// qué máquina corra.
const enHoraLocal = (texto) => new Date(texto);

describe('laQueSigue', () => {
  it('sin candidatas no hay relevo cargado, y eso también es un caso real', () => {
    assert.equal(laQueSigue(NOCHE, []), null);
    assert.equal(laQueSigue(NOCHE, null), null);
  });

  it('elige el que arranca más cerca del final', () => {
    const manana = { id: 'manana', fecha: '2026-09-05', hora_inicio: '06:00', hora_fin: '14:00' };
    const tarde = { id: 'tarde', fecha: '2026-09-05', hora_inicio: '14:00', hora_fin: '22:00' };
    assert.equal(laQueSigue(NOCHE, [tarde, manana]).id, 'manana');
  });

  it('el que arranca justo cuando éste termina cuenta: ése es el relevo normal', () => {
    const pegado = { id: 'pegado', fecha: '2026-09-05', hora_inicio: '06:00', hora_fin: '14:00' };
    assert.equal(laQueSigue(NOCHE, [pegado]).id, 'pegado');
  });

  it('el turno de la noche cruza la medianoche: el de la tarde anterior no es su relevo', () => {
    // Si alguien vuelve a comparar las horas sueltas como si fueran del mismo día, este turno
    // —que arranca ANTES de que la noche termine— pasaría por relevo.
    const tardeAnterior = { id: 'tarde-anterior', fecha: '2026-09-04', hora_inicio: '14:00', hora_fin: '22:00' };
    assert.equal(laQueSigue(NOCHE, [tardeAnterior]), null);
  });

  it('no se elige a sí misma', () => {
    assert.equal(laQueSigue(NOCHE, [NOCHE]), null);
  });
});

describe('laExtensionCorresponde', () => {
  const despuesDelFin = enHoraLocal('2026-09-05T07:00:00');
  const antesDelFin = enHoraLocal('2026-09-05T03:00:00');

  it('quedó de más: terminó, sigue adentro y el relevo no marcó la llegada', () => {
    assert.equal(laExtensionCorresponde({ guardia: NOCHE, relevo: null, ahora: despuesDelFin }), true);
  });

  it('nunca llegó: sin marca de llegada no estuvo adentro y no hay nada que extender', () => {
    const sinLlegar = { ...NOCHE, checkin_at: null };
    assert.equal(laExtensionCorresponde({ guardia: sinLlegar, relevo: null, ahora: despuesDelFin }), false);
  });

  it('ya cerró su turno: se fue, y lo que se quedó de más ya está cerrado', () => {
    const cerrada = { ...NOCHE, checkout_at: '2026-09-05T06:05:00.000Z' };
    assert.equal(laExtensionCorresponde({ guardia: cerrada, relevo: null, ahora: despuesDelFin }), false);
  });

  it('el turno todavía no terminó: nadie está de más', () => {
    assert.equal(laExtensionCorresponde({ guardia: NOCHE, relevo: null, ahora: antesDelFin }), false);
  });

  it('el relevo llegó: no quedó de más aunque haya un relevo asignado', () => {
    const relevo = { id: 'manana', checkin_at: '2026-09-05T05:58:00.000Z' };
    assert.equal(laExtensionCorresponde({ guardia: NOCHE, relevo, ahora: despuesDelFin }), false);
  });

  it('el relevo existe pero todavía no marcó la llegada: sí quedó de más', () => {
    // Éste es el caso que no abre ningún expediente: nadie faltó todavía, sólo no llegó.
    const relevo = { id: 'manana', asistente_id: 'alguien', checkin_at: null };
    assert.equal(laExtensionCorresponde({ guardia: NOCHE, relevo, ahora: despuesDelFin }), true);
  });

  it('sin tolerancia: un minuto después del fin ya cuenta', () => {
    const unMinutoDespues = enHoraLocal('2026-09-05T06:01:00');
    assert.equal(laExtensionCorresponde({ guardia: NOCHE, relevo: null, ahora: unMinutoDespues }), true);
  });
});

describe('laExtensionTermino', () => {
  it('llegó el relevo', () => {
    assert.equal(laExtensionTermino({ guardia: NOCHE, relevo: { checkin_at: '2026-09-05T07:30:00.000Z' } }), true);
  });

  it('ella cerró su turno, aunque no haya llegado nadie', () => {
    const cerrada = { ...NOCHE, checkout_at: '2026-09-05T08:00:00.000Z' };
    assert.equal(laExtensionTermino({ guardia: cerrada, relevo: null }), true);
  });

  it('sigue esperando', () => {
    assert.equal(laExtensionTermino({ guardia: NOCHE, relevo: { checkin_at: null } }), false);
  });
});

describe('cuandoTermino', () => {
  const ahora = new Date('2026-09-05T09:00:00.000Z');

  it('vale el primero de los dos momentos, no el del proceso que se dio cuenta', () => {
    const cerrada = { ...NOCHE, checkout_at: '2026-09-05T08:00:00.000Z' };
    const relevo = { checkin_at: '2026-09-05T07:30:00.000Z' };
    assert.equal(cuandoTermino({ guardia: cerrada, relevo, ahora }).toISOString(), '2026-09-05T07:30:00.000Z');
  });

  it('con un solo momento vale ése', () => {
    const relevo = { checkin_at: '2026-09-05T07:30:00.000Z' };
    assert.equal(cuandoTermino({ guardia: NOCHE, relevo, ahora }).toISOString(), '2026-09-05T07:30:00.000Z');
  });

  it('sin ninguno de los dos, recién ahí vale la hora de la revisión', () => {
    assert.equal(cuandoTermino({ guardia: NOCHE, relevo: null, ahora }).getTime(), ahora.getTime());
  });
});

describe('pasosDeLaBusqueda', () => {
  it('sin novedades se dice igual: no saber nada también es una noticia', () => {
    assert.deepEqual(pasosDeLaBusqueda({}), [PASOS_DE_LA_BUSQUEDA.SIN_NOVEDADES]);
  });

  it('los pasos salen en orden', () => {
    const pasos = pasosDeLaBusqueda({
      relevo: { ofrecida_at: '2026-09-05T06:10:00.000Z', asistente_id: 'alguien' },
      coordinacionAvisada: true,
      escalado: true,
    });
    assert.deepEqual(pasos, [
      PASOS_DE_LA_BUSQUEDA.COORDINACION_AVISADA,
      PASOS_DE_LA_BUSQUEDA.ESCALADO,
      PASOS_DE_LA_BUSQUEDA.TURNO_OFRECIDO,
      PASOS_DE_LA_BUSQUEDA.RELEVO_ASIGNADO,
    ]);
  });

  it('un turno ofrecido y todavía sin nadie no dice que hay relevo asignado', () => {
    const pasos = pasosDeLaBusqueda({ relevo: { ofrecida_at: '2026-09-05T06:10:00.000Z', asistente_id: null } });
    assert.deepEqual(pasos, [PASOS_DE_LA_BUSQUEDA.TURNO_OFRECIDO]);
  });

  it('no sale ningún nombre por ninguna parte', () => {
    // La lista es de claves de traducción y nada más. Si alguna vez alguien devuelve acá el
    // nombre del relevo o de quien faltó, esta prueba se rompe.
    const pasos = pasosDeLaBusqueda({
      relevo: { ofrecida_at: '2026-09-05T06:10:00.000Z', asistente_id: 'alguien', nombre: 'Inventada Pérez' },
      coordinacionAvisada: true,
      escalado: true,
    });
    const conocidos = Object.values(PASOS_DE_LA_BUSQUEDA);
    for (const paso of pasos) assert.ok(conocidos.includes(paso), `paso desconocido: ${paso}`);
  });
});

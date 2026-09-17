/**
 * Las dos clases de «no» en la lista de quién puede cubrir un hueco.
 *
 *   npm test --prefix panel
 *
 * QUÉ SE PRUEBA ACÁ, Y POR QUÉ ESTO Y NO OTRA COSA. Un candidato puede quedar afuera por dos
 * motivos que se parecen en la pantalla y no son lo mismo:
 *
 *   - `bloqueado`  — lo rechaza la base. La Matrícula y la modalidad de trabajo las hace cumplir
 *                    un disparador, así que la asignación falla igual. El botón queda apagado.
 *   - `desaconsejado` — lo rechaza esta lista. Que se pise con otra guardia y que haya una
 *                    ausencia registrada son hechos que la base acepta sin decir nada. El botón
 *                    queda encendido, porque quien coordina puede saber que la licencia se cortó
 *                    antes o que las dos guardias se están permutando.
 *
 * Confundirlos tiene consecuencia en las dos direcciones: marcar como bloqueado lo que no lo es
 * deja a la Coordinadora sin poder cargar un reemplazo que ya arregló por teléfono, y marcar como
 * desaconsejado lo que la base rechaza manda a alguien a apretar un botón que va a fallar.
 *
 * Qué daría con el sistema roto: si el choque de horarios volviera a poner `bloqueado = true`,
 * fallan las dos primeras; si la modalidad pasara a `desaconsejado`, falla la cuarta; si el orden
 * de los tres grupos se mezclara, falla la última.
 */
import { describe, expect, it } from 'vitest';
import { candidatosParaGuardia, MOTIVO } from '../candidatos';
import { AVISO, avisosDeAsignacion } from '../avisosAsignacion';

const HUECO = {
  id: 'g-hueco',
  fecha: '2026-09-20',
  hora_inicio: '08:00',
  hora_fin: '16:00',
  canal_modalidad: 'directa',
  paciente_ids: [],
};

const activo = (id, nombre, canales = ['directa']) => ({
  id,
  nombre,
  estado: 'activo',
  canales,
  disponible_para_ofertas: true,
});

const LIBRE = activo('a-libre', 'Ana Prueba');
const OCUPADA = activo('a-ocupada', 'Beatriz Prueba');
const DE_LICENCIA = activo('a-licencia', 'Carla Prueba');
const DE_OTRA_MODALIDAD = activo('a-modalidad', 'Delia Prueba', ['marketplace']);

/** La otra guardia de Beatriz, el mismo día y a la misma hora que el hueco. */
const GUARDIA_QUE_SE_PISA = {
  id: 'g-otra',
  asistente_id: OCUPADA.id,
  fecha: '2026-09-20',
  hora_inicio: '08:00',
  hora_fin: '16:00',
  estado: 'programada',
  paciente_ids: [],
};

/** La licencia de Carla, abierta y sin fecha de vuelta, que es el caso más común. */
const AUSENCIA_ABIERTA = {
  asistente_id: DE_LICENCIA.id,
  fecha_inicio: '2026-09-15',
  fecha_fin: null,
};

const evaluar = (asistentes, extra = {}) =>
  candidatosParaGuardia(HUECO, {
    asistentes,
    guardias: [GUARDIA_QUE_SE_PISA],
    ausencias: [AUSENCIA_ABIERTA],
    ahora: new Date('2026-09-18T10:00:00'),
    ...extra,
  });

const buscar = (lista, asistente) => lista.find((c) => c.asistente.id === asistente.id);
const motivosEnContra = (candidato) => candidato.enContra.map((m) => m.clave);

const TODOS = [LIBRE, OCUPADA, DE_LICENCIA, DE_OTRA_MODALIDAD];

describe('quien ese día ya tiene otra guardia', () => {
  it('queda desaconsejado, no bloqueado: la base acepta la asignación', () => {
    const beatriz = buscar(evaluar(TODOS), OCUPADA);
    expect(beatriz.desaconsejado).toBe(true);
    expect(beatriz.bloqueado).toBe(false);
  });

  it('y se ve por qué, con el horario de la otra guardia', () => {
    const beatriz = buscar(evaluar(TODOS), OCUPADA);
    expect(motivosEnContra(beatriz)).toContain(MOTIVO.OCUPADO);
  });
});

describe('quien tiene una ausencia registrada que tapa esa fecha', () => {
  it('queda desaconsejada, no bloqueada', () => {
    const carla = buscar(evaluar(TODOS), DE_LICENCIA);
    expect(carla.desaconsejado).toBe(true);
    expect(carla.bloqueado).toBe(false);
  });

  it('y el motivo no dice de qué ausencia se trata', () => {
    const carla = buscar(evaluar(TODOS), DE_LICENCIA);
    const ausencia = carla.enContra.find((m) => m.clave === MOTIVO.AUSENCIA);
    expect(ausencia).toBeTruthy();
    // El tipo de licencia puede ser información de salud y no llega ni hasta acá.
    expect(JSON.stringify(ausencia.valores ?? {})).not.toMatch(/enfermedad|accidente|tipo/i);
  });
});

describe('quien trabaja en otra modalidad', () => {
  it('queda bloqueada: eso lo rechaza la base', () => {
    const delia = buscar(evaluar(TODOS), DE_OTRA_MODALIDAD);
    expect(delia.bloqueado).toBe(true);
  });
});

describe('a quien no le pasa nada', () => {
  it('ni bloqueada ni desaconsejada', () => {
    const ana = buscar(evaluar(TODOS), LIBRE);
    expect(ana.bloqueado).toBe(false);
    expect(ana.desaconsejado).toBe(false);
  });
});

describe('lo que se le muestra a quien confirma', () => {
  // Que la lista mande a alguien al fondo no alcanza: si la Coordinadora igual lo elige, el
  // motivo tiene que volver a aparecer en el cartel de confirmación. Si no, el «asignar igual»
  // se aprieta sin saber por qué el sistema lo desaconsejaba.
  const datos = {
    asistentes: TODOS,
    guardias: [GUARDIA_QUE_SE_PISA],
    ausencias: [AUSENCIA_ABIERTA],
    ahora: new Date('2026-09-18T10:00:00'),
  };

  it('la ausencia registrada llega al cartel, y como algo serio', () => {
    const avisos = avisosDeAsignacion(HUECO, DE_LICENCIA.id, datos);
    const ausencia = avisos.find((a) => a.clave === AVISO.AUSENCIA);
    expect(ausencia).toBeTruthy();
    expect(ausencia.grave).toBe(true);
  });

  it('el choque de horarios llega al cartel con el horario de la otra guardia', () => {
    const avisos = avisosDeAsignacion(HUECO, OCUPADA.id, datos);
    const choque = avisos.find((a) => a.clave === AVISO.SUPERPOSICION);
    expect(choque).toBeTruthy();
    expect(choque.valores).toEqual({ desde: '08:00', hasta: '16:00' });
  });

  it('a quien no le pasa nada no se le muestra ningún cartel', () => {
    expect(avisosDeAsignacion(HUECO, LIBRE.id, datos)).toEqual([]);
  });
});

describe('el orden de la lista', () => {
  it('primero quien se propone, después lo desaconsejado, al final lo que la base rechaza', () => {
    const lista = evaluar([DE_OTRA_MODALIDAD, OCUPADA, LIBRE, DE_LICENCIA]);
    const grupos = lista.map((c) => (c.bloqueado ? 'base' : c.desaconsejado ? 'lista' : 'propone'));
    expect(grupos).toEqual(['propone', 'lista', 'lista', 'base']);
  });
});

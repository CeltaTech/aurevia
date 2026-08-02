// Punto único de verdad de LAS EXCEPCIONES DEL ESTADO ACTUAL (regla 12 de CLAUDE.md §7).
// ============================================================================
//
// Qué es una excepción acá. Una cosa que no está bien y que alguien tiene que resolver:
// un hueco sin cubrir, una invitación que nadie contestó, un Asistente que no llegó. El
// Estado actual arranca mostrando siete contadores —uno por excepción— y debajo la semana entera.
//
// El problema que este archivo evita. La franja tiene que hacer dos cosas con la misma idea:
// **contar** ("hay 4 sin cubrir") y **filtrar** ("mostrame esas 4"). Si el contador se calcula
// en un lado y el filtro en otro, tarde o temprano dicen cosas distintas: el cartel marca 4 y
// abajo aparecen 3. Es de los errores más difíciles de encontrar porque no rompe nada, solo
// hace que nadie vuelva a confiar en el número.
//
// Acá cada excepción tiene **una sola** función `aplica(guardia, ctx)`, y esa misma función se
// usa para contar y para filtrar. Que el número y la lista coincidan no es algo que haya que
// cuidar: es imposible que no coincidan.
//
// De dónde salen las definiciones. Cinco de las siete se leen de `lib/semaforoGuardia.js`, que
// ya decide en qué situación está cada guardia. Así el color del borde en la grilla y el
// contador de arriba no pueden contradecirse tampoco: si el chip está rojo por "llegó tarde",
// está sí o sí adentro del contador "tarde".
//
// Las dos que necesitan datos de afuera —papeles por vencer y reportes que faltan— no se
// pueden contestar mirando la guardia sola, así que se resuelven con dos conjuntos que la
// pantalla arma una vez y pasa en `ctx`. La cuenta sigue estando escrita una sola vez.

import { SITUACION, situacionDeGuardia } from './semaforoGuardia';

/**
 * Lo que hay que pasarle a `aplica`. Todo es opcional: si falta un dato, la excepción que lo
 * necesita simplemente no encuentra nada, que es preferible a inventar.
 *
 *   ahora                        → Date. Sirve para congelar el reloj en las pruebas.
 *   umbrales                     → los de `semaforoGuardia.js`, si la Prestadora los cambió.
 *   asistentesConPapelPorVencer  → Set de ids de Asistentes con un papel próximo a vencer.
 *   asistentesConPapelVencido    → Set de ids de Asistentes con un papel ya vencido.
 *   guardiasSinReporte           → Set de ids de guardias terminadas sin reporte cargado.
 *   diasAviso                    → con cuántos días de anticipación avisa esta Prestadora.
 *   asistentesConMatriculaTrabada→ Set de ids de Asistentes que hoy no pueden tomar guardias.
 *   asistentesConMatriculaPorVencer → Set de ids con la matrícula cerca de vencer.
 */
export function contextoVacio() {
  return {
    ahora: new Date(),
    umbrales: undefined,
    asistentesConPapelPorVencer: new Set(),
    asistentesConPapelVencido: new Set(),
    guardiasSinReporte: new Set(),
    diasAviso: 0,
    asistentesConMatriculaTrabada: new Set(),
    asistentesConMatriculaPorVencer: new Set(),
  };
}

const conjunto = (c) => (c instanceof Set ? c : new Set());

/**
 * Las siete excepciones, en el orden en que se muestran: primero lo que deja a un Paciente sin
 * nadie, después lo que pasa durante la guardia, y al final lo administrativo.
 *
 * Cada una tiene:
 *   id            → la clave técnica; también es lo que viaja en la URL del filtro.
 *   claveEtiqueta → dónde está su nombre en los tres idiomas.
 *   claveAyuda    → dónde está la explicación de una línea.
 *   parametros    → qué valores necesita ese texto (hoy solo "papeles" necesita `{dias}`).
 *   aplica        → la única definición de "esta guardia cae acá". Cuenta y filtra.
 *   esCritica     → si el contador se pinta rojo. Rojo no es "hay muchas": es "hay una que
 *                   ya se pasó del punto en que se podía resolver con tiempo".
 */
export const EXCEPCIONES = [
  {
    id: 'sin_cubrir',
    claveEtiqueta: 'exc_sin_cubrir',
    claveAyuda: 'exc_sin_cubrir_ayuda',
    parametros: () => ({}),
    aplica: (g, ctx) => {
      const s = situacionDeGuardia(g, ctx);
      return s === SITUACION.HUECO || s === SITUACION.HUECO_URGENTE;
    },
    // Se pone rojo cuando alguno de los huecos ya está encima. Un hueco dentro de un mes es
    // trabajo pendiente; uno de mañana es un Paciente que se queda solo.
    esCritica: (guardias, ctx) =>
      guardias.some((g) => situacionDeGuardia(g, ctx) === SITUACION.HUECO_URGENTE),
  },
  {
    id: 'ofrecidas_sin_respuesta',
    claveEtiqueta: 'exc_ofrecidas_sin_respuesta',
    claveAyuda: 'exc_ofrecidas_sin_respuesta_ayuda',
    parametros: () => ({}),
    aplica: (g, ctx) => {
      const s = situacionDeGuardia(g, ctx);
      return s === SITUACION.OFRECIDA || s === SITUACION.OFRECIDA_VENCIDA;
    },
    // Rojo cuando venció el plazo que la propia Prestadora se puso: esperar ya no es una
    // opción, hay que salir a buscar a otro.
    esCritica: (guardias, ctx) =>
      guardias.some((g) => situacionDeGuardia(g, ctx) === SITUACION.OFRECIDA_VENCIDA),
  },
  {
    id: 'tarde',
    claveEtiqueta: 'exc_tarde',
    claveAyuda: 'exc_tarde_ayuda',
    parametros: () => ({}),
    aplica: (g, ctx) => {
      const s = situacionDeGuardia(g, ctx);
      return s === SITUACION.TARDE || s === SITUACION.AUSENTE;
    },
    // Siempre rojo. No hay una versión tranquila de que un Paciente esté esperando.
    esCritica: (guardias) => guardias.length > 0,
  },
  {
    id: 'sin_cerrar',
    claveEtiqueta: 'exc_sin_cerrar',
    claveAyuda: 'exc_sin_cerrar_ayuda',
    parametros: () => ({}),
    aplica: (g, ctx) => situacionDeGuardia(g, ctx) === SITUACION.SIN_CERRAR,
    // Rojo: una salida sin marcar es una guardia que no se puede liquidar y, muchas veces,
    // alguien que sigue en la casa sin que el sistema lo sepa.
    esCritica: (guardias) => guardias.length > 0,
  },
  {
    id: 'documentacion',
    claveEtiqueta: 'exc_documentacion',
    claveAyuda: 'exc_documentacion_ayuda',
    parametros: (ctx) => ({ dias: ctx?.diasAviso ?? 0 }),
    // Mira las guardias que todavía van a pasar: un papel que vence no cambia nada de lo que
    // ya ocurrió, pero sí invalida lo que está por venir.
    aplica: (g, ctx) => {
      if (!g?.asistente_id) return false;
      const s = situacionDeGuardia(g, ctx);
      if (s === SITUACION.CANCELADA || s === SITUACION.COMPLETADA) return false;
      return (
        conjunto(ctx?.asistentesConPapelPorVencer).has(g.asistente_id) ||
        conjunto(ctx?.asistentesConPapelVencido).has(g.asistente_id)
      );
    },
    // Rojo solo si el papel ya venció. Por vencer es naranja: para eso avisa con anticipación.
    esCritica: (guardias, ctx) =>
      guardias.some((g) => conjunto(ctx?.asistentesConPapelVencido).has(g.asistente_id)),
  },
  {
    id: 'matricula',
    claveEtiqueta: 'exc_matricula',
    claveAyuda: 'exc_matricula_ayuda',
    parametros: () => ({}),
    /* Va aparte de "papeles" aunque las dos hablen de vencimientos, y la diferencia es grande:
       un papel vencido es un aviso —la guardia se hace igual—, mientras que una matrícula sin
       vigencia la base directamente no la deja asignar. Contarlas juntas mezclaría "hay que
       reclamar un certificado" con "esta guardia no se puede cubrir con esta persona". */
    aplica: (g, ctx) => {
      if (!g?.asistente_id) return false;
      const s = situacionDeGuardia(g, ctx);
      if (s === SITUACION.CANCELADA || s === SITUACION.COMPLETADA) return false;
      return (
        conjunto(ctx?.asistentesConMatriculaTrabada).has(g.asistente_id) ||
        conjunto(ctx?.asistentesConMatriculaPorVencer).has(g.asistente_id)
      );
    },
    // Rojo solo cuando ya está trabado. Por vencer todavía se resuelve con una llamada.
    esCritica: (guardias, ctx) =>
      guardias.some((g) => conjunto(ctx?.asistentesConMatriculaTrabada).has(g.asistente_id)),
  },
  {
    id: 'reportes',
    claveEtiqueta: 'exc_reportes',
    claveAyuda: 'exc_reportes_ayuda',
    parametros: () => ({}),
    aplica: (g, ctx) =>
      situacionDeGuardia(g, ctx) === SITUACION.COMPLETADA &&
      conjunto(ctx?.guardiasSinReporte).has(g.id),
    // Nunca rojo. Falta un papel, no falta una persona: se reclama, no se corre.
    esCritica: () => false,
  },
];

/** Busca una excepción por su id. Devuelve `undefined` si el id no existe. */
export function excepcionPorId(id) {
  return EXCEPCIONES.find((e) => e.id === id);
}

/**
 * Pasa la lista de guardias por las siete excepciones y devuelve, para cada una, cuántas
 * cayeron y si va en rojo. Es lo único que necesita la franja para dibujarse.
 *
 * Devuelve las siete siempre, incluso las que dieron cero: que un contador desaparezca cuando
 * llega a cero hace que la franja cambie de forma sola y que uno no encuentre lo que buscaba.
 * Quien la dibuja decide si atenúa las de cero; el cálculo no esconde nada.
 */
export function resumenDeExcepciones(guardias, ctx) {
  const lista = Array.isArray(guardias) ? guardias : [];
  return EXCEPCIONES.map((exc) => {
    const caen = lista.filter((g) => exc.aplica(g, ctx));
    return {
      id: exc.id,
      claveEtiqueta: exc.claveEtiqueta,
      claveAyuda: exc.claveAyuda,
      parametros: exc.parametros(ctx),
      cantidad: caen.length,
      critica: caen.length > 0 && exc.esCritica(caen, ctx),
    };
  });
}

/**
 * Deja solo las guardias de una excepción. Es la otra mitad del contrato: usa exactamente la
 * misma función `aplica` que contó, así que la lista y el número no pueden discrepar.
 * Sin filtro elegido, devuelve todo tal cual.
 */
export function filtrarPorExcepcion(guardias, id, ctx) {
  const exc = id ? excepcionPorId(id) : null;
  if (!exc) return guardias;
  return guardias.filter((g) => exc.aplica(g, ctx));
}

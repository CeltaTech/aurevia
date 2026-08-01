// Punto único de verdad de LOS AVISOS ANTES DE ASIGNAR (regla 12 de CLAUDE.md §7).
// ============================================================================
//
// La pregunta que contesta. Ya se eligió a alguien y se está por confirmar. Antes de apretar,
// ¿qué puede salir mal con esta asignación puntual? Devuelve la lista de cosas que conviene
// mirar, y marca cuáles son lo bastante serias como para pedir una confirmación más fuerte.
//
// **Ningún aviso impide asignar.** Ni siquiera el peor. Quien está del otro lado del mostrador
// sabe cosas que la base no sabe —que el Asistente ya avisó que ese día se libera, que la
// Familia lo pidió por nombre—, y un hueco sin cubrir es peor que casi cualquiera de estos
// avisos. El software advierte; la persona decide. Lo que sí queda es el registro de quién
// pasó por arriba de qué (eso lo hace la pantalla, no este archivo).
//
// ----------------------------------------------------------------------------
// Por qué este archivo casi no tiene cuentas propias
// ----------------------------------------------------------------------------
//
// "¿Quién sirve para este hueco?" y "¿qué puede salir mal con este?" son dos preguntas
// distintas, pero se contestan mirando exactamente lo mismo: si se pisa con otra guardia,
// cuánto va a descansar, cuántas horas lleva en la semana, qué papeles y qué Habilitación
// vencen. Si esas cuentas estuvieran escritas dos veces, tarde o temprano dirían cosas
// distintas sobre la misma persona y la misma guardia: la lista de candidatos mostrando a
// alguien arriba de todo y, dos clics después, un cartel diciendo que se pisa con otra
// guardia. No rompe nada; solo hace que nadie vuelva a confiar en la pantalla.
//
// Por eso las comprobaciones viven una sola vez, en `candidatos.js`, y acá se importan. Este
// archivo no vuelve a calcular nada: solo traduce esos mismos resultados a la otra pregunta —
// de "esto suma o resta puntos" a "esto conviene que lo mires antes de confirmar" (regla 12 de
// CLAUDE.md §7).
//
// Igual que `candidatos.js`, **no devuelve texto**: devuelve claves de traducción más los
// valores a reemplazar, y la pantalla arma la frase con `t.guardias.avisos[clave]`.

import { finDeGuardia } from './horarios';
import {
  TOPES,
  guardiasDeAsistente,
  guardiaQueSePisa,
  descansoMasCorto,
  cargaSemanal,
  topeSemanalDe,
  habilitacionVigenteAl,
  papelQueVencePrimero,
} from './candidatos';

/** Las claves de traducción que devuelve este archivo. Viven en `t.guardias.avisos`. */
export const AVISO = {
  SUPERPOSICION: 'superposicion',
  DESCANSO: 'descanso',
  HORAS_EXTRA: 'horas_extra',
  DOCUMENTACION: 'documentacion',
  HABILITACION: 'habilitacion',
};

const redondear = (n) => Math.round(n * 10) / 10;
const hhmm = (h) => (typeof h === 'string' ? h.slice(0, 5) : h);
const lista = (x) => (Array.isArray(x) ? x : []);

/** El día en que termina la guardia, en el formato de la base. Cruza la medianoche bien. */
function diaEnQueTermina(guardia) {
  const fin = finDeGuardia(guardia);
  const corrida = new Date(fin.getTime() - fin.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}

/**
 * La Habilitación que hay que mirar para esta asignación.
 *
 * Primero la que está vigente hoy. Si no hay ninguna vigente, se toma la última que tuvo —la de
 * vencimiento más lejano—, porque el aviso necesita una fecha para mostrar. Si el Asistente no
 * tiene ninguna Habilitación registrada, no hay aviso: eso no es "algo que vence", es que falta
 * el papel entero, y de eso ya avisa `candidatos.js` con `motivo_habilitacion_falta`.
 */
function habilitacionAMirar(asistenteId, habilitaciones, ahora) {
  const vigente = habilitacionVigenteAl(asistenteId, habilitaciones, ahora);
  if (vigente) return vigente;

  const propias = lista(habilitaciones).filter(
    (h) => h.asistente_id === asistenteId && h.vigente_hasta
  );
  if (!propias.length) return null;
  return propias.reduce((mejor, h) => (h.vigente_hasta > mejor.vigente_hasta ? h : mejor));
}

/**
 * Qué puede salir mal si esta Guardia se le asigna a este Asistente.
 *
 * @param guardia      la fila de `guardias` que se va a asignar.
 * @param asistenteId  a quién se le va a dar.
 * @param datos        `{ asistentes, guardias, habilitaciones, documentos, ahora }` — lo mismo
 *                     que recibe `candidatosParaGuardia`, para que la pantalla pase el mismo
 *                     objeto en los dos lugares y no tenga que armar dos.
 * @param opciones     `{ topes }` — para pisar los topes sin tocar este archivo.
 *
 * @returns array de `{ clave, valores, grave }`. Vacío si está todo bien.
 *          Los graves vienen primero: es lo que hay que leer si se lee una sola línea.
 */
export function avisosDeAsignacion(guardia, asistenteId, datos = {}, opciones = {}) {
  if (!guardia || !asistenteId) return [];

  const topes = { ...TOPES, ...(opciones.topes ?? {}) };
  const ahora = datos.ahora ?? new Date();
  const avisos = [];

  const asistente =
    lista(datos.asistentes).find((a) => a.id === asistenteId) ?? { id: asistenteId };
  const propias = guardiasDeAsistente(asistenteId, datos.guardias, guardia.id);

  // --- 1. Se pisa con otra guardia. El único aviso que siempre es grave: nadie puede estar en
  //        dos casas a la vez, así que asignar igual significa que alguien va a faltar a una.
  const choque = guardiaQueSePisa(guardia, propias);
  if (choque) {
    avisos.push({
      clave: AVISO.SUPERPOSICION,
      valores: { desde: hhmm(choque.hora_inicio), hasta: hhmm(choque.hora_fin) },
      grave: true,
    });
  }

  // --- 2. Descanso corto entre guardias.
  const descanso = descansoMasCorto(guardia, propias);
  if (descanso !== null && descanso < topes.horas_descanso_minimo) {
    avisos.push({
      clave: AVISO.DESCANSO,
      valores: { horas: redondear(descanso) },
      grave: false,
    });
  }

  // --- 3. Se pasa del tope de horas de la semana. Se muestra el total con esta guardia
  //        incluida, que es el número que va a tener que justificar la Prestadora.
  const tope = topeSemanalDe(asistente, topes);
  const carga = cargaSemanal(guardia, propias, topes);
  if (carga.conEsta > tope) {
    avisos.push({
      clave: AVISO.HORAS_EXTRA,
      valores: { horas: redondear(carga.conEsta), tope: redondear(tope) },
      grave: false,
    });
  }

  // A partir de acá, la pregunta es siempre la misma: ¿este papel llega vivo hasta el final de
  // la guardia? Por eso se compara contra el día en que la guardia TERMINA y no contra el día
  // en que empieza: un papel que vence en el medio de una guardia de noche es exactamente el
  // caso que hay que avisar, y comparar contra el inicio lo dejaría pasar.
  const ultimoDia = diaEnQueTermina(guardia);

  // --- 4. Documentación que vence antes o durante la guardia.
  const papel = papelQueVencePrimero(asistenteId, datos.documentos);
  if (papel && papel.fecha_vencimiento <= ultimoDia) {
    avisos.push({
      clave: AVISO.DOCUMENTACION,
      valores: { fecha: papel.fecha_vencimiento },
      // Grave si ya está vencido antes de que la guardia arranque: ahí no es "se le vence en el
      // medio", es que trabaja el turno entero con el papel caído.
      grave: papel.fecha_vencimiento < guardia.fecha,
    });
  }

  // --- 5. Habilitación que vence antes o durante la guardia. Mismo criterio que los papeles,
  //        y pesa más: sin Habilitación vigente no puede administrar medicación.
  const habilitacion = habilitacionAMirar(asistenteId, datos.habilitaciones, ahora);
  if (habilitacion?.vigente_hasta && habilitacion.vigente_hasta <= ultimoDia) {
    avisos.push({
      clave: AVISO.HABILITACION,
      valores: { fecha: habilitacion.vigente_hasta },
      grave: habilitacion.vigente_hasta < guardia.fecha,
    });
  }

  // Los graves arriba. Dentro de cada grupo se respeta el orden en que se fueron encontrando,
  // que va de lo que deja a un Paciente sin nadie a lo administrativo.
  return avisos.sort((a, b) => Number(b.grave) - Number(a.grave));
}

/** ¿Hay algo serio? Sirve para elegir entre la confirmación común y la fuerte. */
export function hayAvisoGrave(avisos) {
  return lista(avisos).some((a) => a.grave);
}

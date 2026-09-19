// Procesa la cola offline en orden de creación, y ese orden es justamente la garantía: los
// tres actos de una guardia dependen del anterior —check-in, después Reporte Diario, después
// cierre—, y el backend rechaza cada uno si falta el de más atrás
// (backend/src/routes/appAsistentes.js). Si un ítem falla por un motivo real (no de red), se
// traba esa guardia y se sigue con las demás — los siguientes ítems de esa misma guardia
// dependen del que falló, pero los de otra guardia no tienen nada que ver y antes quedaban
// esperando detrás de un rechazo ajeno.
//
// LO PRIMERO QUE HACE ES DESCARTAR LO DE OTRAS SESIONES. Un teléfono lo usa más de una persona y
// cada Prestadora es una cuenta distinta: lo que quedó anotado con otra cuenta no se manda nunca
// con ésta. `listarCola()` ya devuelve sólo lo de la sesión abierta, así que el descarte no es lo
// que protege —protege el filtro—, pero deja de ocupar lugar en el teléfono algo que no se va a
// mandar jamás.
//
// Y HAY UN TOPE DE INTENTOS: lo que el motor rechaza por un motivo real no mejora por repetirse.
// Al agotarse, el ítem se queda anotado con su motivo, a la vista, y no se manda más.
import { api } from './api';
import { situacionDelError } from './errores';
import {
  listarCola,
  colaParaMandar,
  quitarDeCola,
  marcarIntentoFallido,
  descartarLoDeOtrasSesiones,
} from './colaOffline';
import { seAgoto } from './reglasDeLaCola';

function esErrorDeRed(error) {
  // fetch rechaza con TypeError cuando no hay red (a diferencia de una respuesta HTTP de error).
  // Y el teléfono que ya se declaró sin señal tampoco rechazó nada por un motivo real: sea cual
  // sea la forma del error, contárselo como intento gastaría el tope de un aviso que nunca llegó
  // a salir. Quedarse sin señal no es que la hayan rechazado.
  return error instanceof TypeError || !navigator.onLine;
}

let sincronizando = false;
const oyentes = new Set();

export function suscribirseASincronizacion(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function avisar() {
  oyentes.forEach((fn) => fn());
}

/**
 * Manda un ítem de la cola.
 *
 * La hora del hecho y el identificador del envío viajan siempre, y son los dos que anotó el
 * teléfono cuando pasó la cosa: con ellos el motor guarda la hora en que ocurrió —aparte de la
 * hora en que el dato le llegó— y reconoce un reenvío en vez de duplicarlo.
 */
function mandar(item) {
  const datos = { ...item.payload, ocurrido_at: item.payload?.ocurrido_at ?? item.ocurridoEn, clienteUuid: item.id };
  if (item.tipo === 'checkin') return api.checkin(item.guardiaId, datos);
  if (item.tipo === 'reporte') return api.confirmarReporte(item.guardiaId, datos);
  if (item.tipo === 'checkout') return api.checkout(item.guardiaId, datos);
  if (item.tipo === 'salida') return api.registrarSalida(item.guardiaId, datos);
  if (item.tipo === 'aviso_demora') return api.avisarDemora(item.guardiaId, datos);
  if (item.tipo === 'emergencia') return api.avisarEmergencia(item.guardiaId, datos);
  if (item.tipo === 'no_puede_continuar') return api.noPuedeContinuar(item.guardiaId, datos);
  if (item.tipo === 'descanso_empezar') return api.empezarDescanso(item.guardiaId, datos);
  if (item.tipo === 'descanso_terminar') return api.terminarDescanso(item.guardiaId, datos);
  // Un tipo que esta versión no conoce no se manda a ningún lado: adivinar la dirección sería
  // registrar una cosa como otra.
  return Promise.reject(new Error('tipo_desconocido'));
}

export async function sincronizarCola() {
  if (sincronizando || !navigator.onLine) return;
  sincronizando = true;
  try {
    if (await descartarLoDeOtrasSesiones()) avisar();
    // `listarCola()` es lo de la sesión abierta, agotado o no, y `colaParaMandar()` le saca lo
    // agotado. Las dos salen del mismo filtro por dueño: nada que no sea de esta sesión llega acá.
    const cola = await listarCola();
    // Las guardias en las que algo quedó trabado: lo que viene detrás depende de eso y rebotaría.
    // Las agotadas entran de entrada: lo agotado ya no se manda —y no se borra, porque el motivo
    // por el que no entró es lo que tiene que poder leer la persona—, y lo que venía detrás de
    // ello en esa misma guardia tampoco, porque depende de lo que no llegó.
    const trabadas = new Set(cola.filter(seAgoto).map((item) => item.guardiaId));
    for (const item of await colaParaMandar()) {
      if (trabadas.has(item.guardiaId)) continue;
      try {
        await mandar(item);
        await quitarDeCola(item.id);
        avisar();
      } catch (error) {
        if (esErrorDeRed(error)) {
          break; // se cortó la conexión de nuevo, se reintenta en el próximo evento
        }
        if (error.yaRegistrado) {
          // El servidor ya tiene esta acción registrada (mismo check-in/reporte que se
          // había enviado antes de perder la respuesta) — se da por sincronizada.
          await quitarDeCola(item.id);
          avisar();
          continue;
        }
        // El motivo que se guarda es una de las ocho situaciones del catálogo, nunca el texto
        // crudo del motor: eso describe tablas y columnas y no puede llegar a una pantalla.
        await marcarIntentoFallido(item.id, situacionDelError(error));
        trabadas.add(item.guardiaId);
        avisar();
      }
    }
  } finally {
    sincronizando = false;
  }
}

let inicializado = false;
export function iniciarSincronizacionAutomatica() {
  if (inicializado) return;
  inicializado = true;
  window.addEventListener('online', sincronizarCola);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sincronizarCola();
  });
  sincronizarCola();
}

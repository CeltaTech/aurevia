import { supabase } from '../db/connection.js';
import { minutosDeDemoraTolerados, llegaTarde } from './llegadaEstimada.js';
import { llegadaEstimadaDeGuardias } from './estimarLlegadaDeGuardia.js';
import {
  FUENTE_CALCULO_LLEGADA_TARDIA,
  FUENTE_SIN_AVISO_NI_SALIDA,
} from './fuentesAlertaTemprana.js';

// Lo que el sistema anota solo cuando nadie apretó nada (pendiente #101).
//
// QUÉ HACE Y QUÉ NO. Anota dos situaciones distintas, cada una con su propio código de origen:
//
//   1. `calculo_llegada_tardia` — hay marca de salida, y la cuenta de la hora estimada de llegada
//      pasa la hora de inicio más el margen que configuró la Prestadora. Es la que da minutos de
//      aviso de verdad: se detecta apenas la persona sale, mucho antes de la hora de inicio.
//   2. `sin_aviso_ni_salida` — pasó la hora de inicio con su margen y no hay nada: ni llegada, ni
//      marca de salida, ni aviso de demora de ninguna clase.
//
// NINGUNA DE LAS DOS ES EL AVISO DE UNA PERSONA, y por eso no se guardan con el código de los
// avisos. Quien apretó «voy demorado» hizo algo, y ese acto no se puede confundir después con una
// cuenta que sacó una máquina. Son registros separados que no se mezclan nunca.
//
// LO QUE ESTE PROCESO NO PUEDE HACER. Para quien no marcó la salida no hay ningún dato con el que
// estimar una hora de llegada: la cuenta necesita un punto de partida y una hora. Estimar el
// viaje de alguien que no declaró nada exigiría seguirlo durante el trayecto, que es la otra
// mitad del pendiente #101 y está bloqueada por el #102. Por eso el segundo caso no estima nada:
// dice que llegó la hora y no hay registro de nada, que es un hecho comprobable.
//
// UNA SOLA VEZ POR GUARDIA Y POR ORIGEN, y ninguna si ya hay una alerta abierta de esa guardia:
// si alguien ya avisó —por la aplicación o por teléfono—, el Coordinador ya está enterado y
// repetírselo desde otro lado no le agrega nada. La insistencia hasta que se resuelva la maneja
// `revisarNotificacionesCoordinador.js`, que es el único que notifica; acá sólo se detecta.
//
// Entra con la llave de servicio porque recorre todas las Prestadoras y en este proceso no hay
// ninguna sesión de Panel abierta, igual que `ausenciaAutomatica.js`.

const MS_POR_MINUTO = 60 * 1000;
const MS_POR_HORA = 60 * MS_POR_MINUTO;

// Cuánto hacia atrás se mira. No es una regla de negocio: es el borde de la ventana de búsqueda.
// Una guardia de anteayer ya no se cubre, y anotarle una alerta hoy sería ruido.
const DIAS_HACIA_ATRAS = 1;

export async function revisarLlegadasDemoradas() {
  const { data: prestadoras, error } = await supabase
    .from('prestadoras')
    .select('id')
    .eq('estado', 'certificada');

  if (error) {
    console.error('Error consultando prestadoras para las llegadas demoradas:', error.message);
    return;
  }

  const ahora = new Date();
  for (const { id: prestadoraId } of prestadoras ?? []) {
    await revisarPrestadora(prestadoraId, ahora);
  }
}

async function revisarPrestadora(prestadoraId, ahora) {
  // El margen lo decide cada Prestadora en sus niveles de escalada. Sin niveles cargados vale el
  // valor de arranque de `llegadaEstimada.js`, que no es una regla del producto: es con lo que
  // funciona quien todavía no configuró nada.
  const { data: niveles, error: errorNiveles } = await supabase
    .from('configuracion_escalada_relevo')
    .select('minutos_demora')
    .eq('prestadora_id', prestadoraId);

  if (errorNiveles) {
    console.error(`Error consultando configuracion_escalada_relevo (prestadora ${prestadoraId}):`, errorNiveles.message);
    return;
  }
  const minutosTolerados = minutosDeDemoraTolerados(niveles);

  // El filtro por `fecha` es sólo para no traerse la agenda entera; la cuenta fina se hace
  // después contra la hora de inicio, que la base guarda en otra columna.
  //
  // `.not('asistente_id', 'is', null)` no es un detalle: una guardia sin cubrir también llega a
  // su hora sin que nadie marque nada, pero eso no es una demora de nadie — de los huecos se
  // ocupa `revisarGuardiasSinCubrir.js`, que es el que sabe en qué punto está la búsqueda.
  const { data: guardias, error: errorGuardias } = await supabase
    .from('guardias')
    .select('id, paciente_id, fecha, hora_inicio, salida_checkin_at, salida_lat, salida_lng')
    .eq('prestadora_id', prestadoraId)
    .eq('estado', 'programada')
    .not('asistente_id', 'is', null)
    .is('checkin_at', null)
    .gte('fecha', fechaISO(new Date(ahora.getTime() - DIAS_HACIA_ATRAS * 24 * MS_POR_HORA)))
    .lte('fecha', fechaISO(new Date(ahora.getTime() + 24 * MS_POR_HORA)));

  if (errorGuardias) {
    console.error(`Error consultando guardias para las llegadas demoradas (prestadora ${prestadoraId}):`, errorGuardias.message);
    return;
  }
  if (!guardias?.length) return;

  let yaAnotadas;
  let estimadas;
  try {
    yaAnotadas = await alertasYaAnotadas(prestadoraId, guardias.map((g) => g.id));
    estimadas = await llegadaEstimadaDeGuardias(guardias);
  } catch (e) {
    console.error(`Error preparando la revisión de llegadas demoradas (prestadora ${prestadoraId}):`, e.message);
    return;
  }

  for (const guardia of guardias) {
    const anotadas = yaAnotadas.get(guardia.id) ?? { abiertas: 0, fuentes: new Set() };
    // Alguien ya avisó, o el sistema ya anotó algo que sigue sin resolverse: no se agrega nada.
    if (anotadas.abiertas > 0) continue;

    const inicio = new Date(`${guardia.fecha}T${guardia.hora_inicio}`);
    if (Number.isNaN(inicio.getTime())) continue;
    // Ya pasó el plazo en que cubrirla servía de algo.
    if (inicio.getTime() < ahora.getTime() - DIAS_HACIA_ATRAS * 24 * MS_POR_HORA) continue;

    const fuente = queHayQueAnotar({
      guardia,
      inicio,
      ahora,
      minutosTolerados,
      llegadaEstimada: estimadas.get(guardia.id) ?? null,
    });
    if (!fuente || anotadas.fuentes.has(fuente)) continue;

    const { error: errorInsert } = await supabase.from('alertas_tempranas_guardia').insert({
      prestadora_id: prestadoraId,
      guardia_id: guardia.id,
      fuente,
      // `reportado_por` queda en blanco a propósito: no lo reportó nadie. Poner ahí a la persona
      // de la guardia diría que ella avisó, que es justamente lo que no pasó.
      motivo: null,
      detectado_at: ahora.toISOString(),
    });
    if (errorInsert) {
      console.error(`Error anotando la alerta temprana de la guardia ${guardia.id}:`, errorInsert.message);
    }
  }
}

/**
 * Cuál de los dos registros corresponde, o ninguno.
 *
 * Los tres resultados son distintos y ninguno se puede leer como otro: un `null` acá es «no hay
 * nada que anotar todavía», nunca «llega bien».
 */
function queHayQueAnotar({ guardia, inicio, ahora, minutosTolerados, llegadaEstimada }) {
  if (guardia.salida_checkin_at) {
    // Con salida marcada, lo que decide es la cuenta. `llegaTarde` contesta `null` cuando no se
    // sabe —sin punto de salida, o sin coordenadas del domicilio—, y no saber no es llegar tarde.
    return llegaTarde({ llegadaEstimada, inicio, minutosTolerados }) === true
      ? FUENTE_CALCULO_LLEGADA_TARDIA
      : null;
  }

  // Sin salida marcada no hay nada que estimar. Lo único comprobable es que pasó la hora.
  const limite = inicio.getTime() + minutosTolerados * MS_POR_MINUTO;
  return ahora.getTime() >= limite ? FUENTE_SIN_AVISO_NI_SALIDA : null;
}

/**
 * Qué alertas tiene ya cada una de estas guardias: cuántas sin resolver, y con qué orígenes se
 * anotó alguna vez. Devuelve un Map de id de guardia → `{ abiertas, fuentes }`.
 */
async function alertasYaAnotadas(prestadoraId, guardiaIds) {
  const porGuardia = new Map();
  if (guardiaIds.length === 0) return porGuardia;

  const { data, error } = await supabase
    .from('alertas_tempranas_guardia')
    .select('guardia_id, fuente, resuelto_at')
    .eq('prestadora_id', prestadoraId)
    .in('guardia_id', guardiaIds);

  if (error) {
    // Sin poder leer lo que ya está, no se anota nada: repetir una alerta que ya existe llena la
    // pantalla del Coordinador de filas iguales, y eso termina en un filtro del correo.
    throw new Error(error.message);
  }

  for (const fila of data ?? []) {
    if (!porGuardia.has(fila.guardia_id)) porGuardia.set(fila.guardia_id, { abiertas: 0, fuentes: new Set() });
    const anotadas = porGuardia.get(fila.guardia_id);
    if (!fila.resuelto_at) anotadas.abiertas += 1;
    if (fila.fuente) anotadas.fuentes.add(fila.fuente);
  }
  return porGuardia;
}

// La fecha de un momento tal como la guarda la base (`2026-09-09`), en hora local.
// `toISOString()` a secas daría la fecha en UTC, que en horario argentino cambia de día tres
// horas antes de tiempo.
function fechaISO(momento) {
  const corrida = new Date(momento.getTime() - momento.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}

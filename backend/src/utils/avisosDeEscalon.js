import { supabase } from '../db/connection.js';
import { enviarEmail } from './email.js';
import { correosDe } from './correoDeUnaPersona.js';
import { aviso } from '../i18n/avisos.js';
import { ESCALONES, escalonesQueCorresponden } from './ordenDeLaEscalada.js';

// LA ALARMA QUE NADIE ATIENDE SUBE DE ESCALÓN.
// ============================================================================
//
// QUÉ RESUELVE. Una alarma le insiste a quien coordina y, si no reacciona, pasa a su respaldo. Si
// el respaldo tampoco reacciona, hasta ayer el aviso se quedaba dando vueltas entre dos personas.
// Acá están los dos escalones que siguen: todos los Coordinadores de esa Prestadora, y después la
// administración.
//
// ESCALAR NO ES VOLVER A INSISTIR. Insistir es repetirle lo mismo a la misma persona cada tantos
// minutos, y de eso se ocupa `insistencia.js`. Escalar es ampliar quién se entera, y eso pasa una
// sola vez por escalón: el segundo aviso a la misma gente no agrega a nadie.
//
// CUÁNDO SUBE CADA UNO LO DECIDE LA PRESTADORA, en minutos desde que la alarma empezó
// (`configuracion_escalada_coordinador`). En nulo, ese escalón queda apagado. El orden y los bordes
// viven en `ordenDeLaEscalada.js`, que es el mismo archivo que le muestra la escalada al Panel.
//
// SALE POR CORREO Y NO POR WhatsApp. El WhatsApp de la Prestadora es un número solo, el mismo que
// ya recibió la insistencia: repetirle el aviso ahí no le llegaría a nadie nuevo, que es justamente
// lo único que hace un escalón. Por correo cada persona lo recibe en el suyo.

const MS_POR_MINUTO = 60 * 1000;

/**
 * Qué escalones ya salieron, para las alarmas de esta clase en esta Prestadora.
 *
 * Una consulta por clase de alarma y por vuelta, no una por alarma. Devuelve, para cada fila
 * alarmada, el conjunto de escalones que ya se avisaron.
 */
export async function escalonesYaAvisados({ prestadoraId, tipo }) {
  const yaSalieron = new Map();

  const { data, error } = await supabase
    .from('escalones_de_alarma_avisados')
    .select('referencia_id, escalon')
    .eq('prestadora_id', prestadoraId)
    .eq('tipo', tipo);

  if (error) {
    // Sin poder leer qué salió, no se escala: el riesgo de repetirle a todo el mundo un aviso que
    // ya recibió es peor que el de tardar una vuelta más. La vuelta siguiente lo intenta de nuevo.
    console.error(`Error consultando los escalones ya avisados (prestadora ${prestadoraId}, ${tipo}):`, error.message);
    return null;
  }

  for (const fila of data ?? []) {
    if (!yaSalieron.has(fila.referencia_id)) yaSalieron.set(fila.referencia_id, new Set());
    yaSalieron.get(fila.referencia_id).add(fila.escalon);
  }
  return yaSalieron;
}

/**
 * Hace subir a esta alarma los escalones que le correspondan y todavía no salieron.
 *
 * `texto` es el cuerpo que ya se le manda a quien coordina: el escalón no cuenta otra cosa, le
 * cuenta lo mismo a más gente. Lo que cambia es el asunto, que dice por qué está llegando.
 *
 * Puede venir hecho o venir como una función que lo arma. Lo segundo es para quien todavía no lo
 * tiene: la mayoría de las vueltas no escala nada, y armar un cuerpo que nadie va a mandar cuesta
 * consultas. Si es función, se la llama una sola vez y recién cuando hay a quién escribirle.
 *
 * @returns {Promise<string[]>} Los escalones que salieron en esta vuelta.
 */
export async function escalarSiCorresponde({
  prestadoraId,
  tipo,
  referenciaId,
  minutosPremura,
  config,
  idioma,
  texto,
  yaSalieron,
  ahora = new Date(),
}) {
  // Sin la lista de lo ya avisado no se escala. Ver el comentario de `escalonesYaAvisados`.
  if (!yaSalieron) return [];

  const salidos = [];
  const avisados = yaSalieron.get(referenciaId) ?? new Set();
  let cuerpo = typeof texto === 'function' ? null : texto;

  for (const escalon of escalonesQueCorresponden(config, minutosPremura)) {
    if (avisados.has(escalon)) continue;

    const destinatarios = await aQuienLeToca({ prestadoraId, escalon });

    // Sin nadie a quien escribirle no se deja constancia: un escalón marcado sin destinatarios
    // sería un aviso dado por salido que no salió, y la alarma no volvería a intentarlo nunca. El
    // renglón en el registro es para que se pueda entender después por qué no llegó.
    if (!destinatarios.length) {
      console.error(
        `El escalón "${escalon}" de la alarma ${tipo}/${referenciaId} no tiene a quién avisarle en la prestadora ${prestadoraId}.`
      );
      continue;
    }

    if (cuerpo === null) cuerpo = await texto();
    // Sin cuerpo no se manda nada, y tampoco se deja constancia: la vuelta siguiente lo reintenta.
    if (!cuerpo) return salidos;

    const { asunto } = aviso(ASUNTO_DE_CADA_ESCALON[escalon], idioma, {
      minutos: Math.round(minutosPremura),
    });

    let llegaron = 0;
    for (const to of destinatarios) {
      try {
        await enviarEmail({ to, asunto, texto: cuerpo, prestadoraId });
        llegaron += 1;
      } catch (e) {
        console.error(`Error escalando la alarma ${tipo}/${referenciaId} al escalón "${escalon}":`, e.message);
      }
    }

    if (!llegaron) continue;

    const { error } = await supabase.from('escalones_de_alarma_avisados').insert({
      prestadora_id: prestadoraId,
      tipo,
      referencia_id: referenciaId,
      escalon,
      avisado_at: ahora.toISOString(),
      destinatarios: llegaron,
    });
    if (error) {
      console.error(`Error dejando constancia del escalón "${escalon}" (${tipo}/${referenciaId}):`, error.message);
    }

    avisados.add(escalon);
    salidos.push(escalon);
  }

  return salidos;
}

/** Con qué asunto llega cada escalón. El cuerpo es el mismo que ya se le manda a quien coordina. */
const ASUNTO_DE_CADA_ESCALON = {
  [ESCALONES.TODOS_LOS_COORDINADORES]: 'escalada_a_todos_los_coordinadores',
  [ESCALONES.ADMINISTRACION]: 'escalada_a_la_administracion',
};

/**
 * A quién le llega cada escalón.
 *
 * La administración es Admin_prestadora y nadie más. Superadmin es el rol técnico de CeltaTech
 * (`CLAUDE.md` §5): tiene el acceso de la administración para operar el producto, pero una guardia
 * que quedó sin cubrir es un asunto de la Prestadora, no de quien le licencia el software.
 */
async function aQuienLeToca({ prestadoraId, escalon }) {
  const rol = escalon === ESCALONES.ADMINISTRACION ? 'admin_prestadora' : 'coordinador';

  const { data, error } = await supabase
    .from('usuarios')
    .select('id')
    .eq('prestadora_id', prestadoraId)
    .eq('rol', rol);

  if (error) {
    console.error(`Error buscando a quién le toca el escalón "${escalon}" (prestadora ${prestadoraId}):`, error.message);
    return [];
  }

  // El correo no está en la ficha: vive en la tabla de cuentas (`correoDeUnaPersona.js`).
  return correosDe((data ?? []).map((u) => u.id));
}

/** Minutos que lleva abierta una alarma que empezó en este momento. */
export function minutosDesde(momento, ahora) {
  const inicio = new Date(momento);
  if (Number.isNaN(inicio.getTime())) return 0;
  return (ahora.getTime() - inicio.getTime()) / MS_POR_MINUTO;
}

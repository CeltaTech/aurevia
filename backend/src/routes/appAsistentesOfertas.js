import { Router } from 'express';
import { requiereRolAsistente } from '../middleware/requiereRolAsistente.js';
import { supabase } from '../db/connection.js';
import { conPacientes } from '../utils/pacientesDeGuardia.js';
import { conDomicilioDelDia } from '../utils/domicilioDelDia.js';
import { visibilidadDelPedido } from '../utils/visibilidadPrestadora.js';
import { columnasSegunVisibilidad } from '../utils/catalogoVisibilidad.js';

// ============================================================================
// Las guardias que se le ofrecieron al Asistente, y su respuesta.
//
// Hasta acá el producto tenía construida una sola mitad: el Panel sabía ofrecerle una misma
// guardia a varios Asistentes con fecha límite, y la base guardaba esos ofrecimientos. Del
// otro lado no había nada. La oferta se avisaba por teléfono o por mensaje y lo que el
// Asistente contestaba no quedaba registrado en ninguna parte.
//
// Esta es la otra mitad: el Asistente ve lo que le ofrecieron, hasta cuándo tiene para
// contestar, y acepta o rechaza desde su teléfono.
//
// ----------------------------------------------------------------------------
// El corte por Prestadora se escribe a mano, siempre
// ----------------------------------------------------------------------------
//
// La base tiene sus propias cerraduras y ya dejan que cada Asistente vea y conteste sus
// invitaciones y nada más. Pero el motor entra con la llave maestra, así que esas cerraduras
// no lo frenan: cada consulta de este archivo lleva escrito el filtro por Prestadora y por
// Asistente (CLAUDE.md §5, regla de aislamiento).
//
// ----------------------------------------------------------------------------
// Aceptar es una carrera, y hay que perderla bien
// ----------------------------------------------------------------------------
//
// La misma guardia se le ofrece a varios a la vez, a propósito: se la queda el primero que
// contesta. Entonces dos personas pueden apretar Aceptar en el mismo segundo, y solo una
// puede quedarse con el turno. El desempate lo hace la base, no el motor: la guardia se
// reclama con una escritura condicionada a que todavía no tenga Asistente. Postgres traba la
// fila, y el segundo que llega escribe cero filas y se entera de que llegó tarde. Quien
// pierde ve un cartel que se lo explica; nunca dos personas con el mismo turno.
// ============================================================================

export const appAsistentesOfertasRouter = Router();

// Cuánto texto se acepta cuando el Asistente explica por qué rechaza. Es un campo libre y
// opcional; el tope está para que nadie mande un libro, no para exigir una explicación.
const LARGO_MAXIMO_MOTIVO = 500;

// Con qué datos del Paciente se dibuja una oferta. Es la misma lista que la de sus guardias
// (`appAsistentes.js`), y por el mismo motivo: hay Prestadoras que no dan el domicilio exacto
// hasta que el turno está confirmado, y lo que está apagado no se pide, así que no viaja.
// Las patologías no van ni aunque estén prendidas: para decidir si toma el turno alcanza con
// saber a quién, dónde y a qué hora.
function camposDePacienteEnLaOferta(visibilidad) {
  return columnasSegunVisibilidad(
    [
      'id',
      'nombre',
      ['domicilio', 'asistente_domicilio_del_paciente'],
      ['lat', 'asistente_domicilio_del_paciente'],
      ['lng', 'asistente_domicilio_del_paciente'],
    ],
    visibilidad
  );
}

// Los datos de la guardia que necesita quien está decidiendo si la toma.
const CAMPOS_DE_GUARDIA =
  'id, paciente_id, fecha, hora_inicio, hora_fin, modalidad, estado, asistente_id, ofrecida_at, ofrecida_por, oferta_limite_at';

/**
 * Traduce el rechazo de un disparador de la base a un motivo que la pantalla sepa explicar.
 *
 * Cuando la Matrícula o la modalidad de trabajo frenan una asignación, la base levanta un
 * mensaje con esta forma exacta:
 *
 *     matricula_bloquea:vencida:
 *     modalidad_bloquea:marketplace:
 *
 * Ese texto no puede llegar nunca a la pantalla: no está traducido y para quien lo lee es un
 * error de sistema. Acá se lo abre y se devuelve el código que las traducciones convierten en
 * una frase. Si el error es otra cosa —se cayó la conexión, chocó con otra guardia—, devuelve
 * `null` y la ruta lo trata como una falla común.
 *
 * El Panel hace esta misma lectura por su cuenta, en `panel/src/lib/matricula.js`: son dos
 * unidades que se despliegan por separado y no pueden compartir código.
 */
function motivoDelBloqueo(error) {
  const texto = String(error?.message ?? error ?? '');

  const matricula = /matricula_bloquea:([a-z_]+)/.exec(texto);
  if (matricula) return `matricula_${matricula[1]}`;

  if (/modalidad_bloquea:/.test(texto)) return 'modalidad_no_habilitada';

  return null;
}

// Una respuesta que no es un error del sistema sino una situación prevista: el turno ya lo
// tomó otro, el plazo se venció, la invitación ya estaba contestada. Viaja con su motivo, que
// es lo que le permite a la pantalla decir exactamente qué pasó y no "algo falló".
function noSePudo(res, estado, motivo, detalle) {
  return res.status(estado).json({ error: detalle, motivo });
}

// ============================================================================
// Lo que hoy tiene para contestar
// ============================================================================

// Se muestra solo lo que sigue vivo: sin contestar, con la guardia todavía sin cubrir, sin
// cancelar y dentro del plazo. Una invitación que se venció o que ganó otro desaparece de la
// lista porque ya no hay nada que hacer con ella, y una lista de cosas muertas en un teléfono
// es ruido. Si igual llega a apretar Aceptar sobre una que acaba de morir, el motor se lo
// explica — no falla en silencio.
appAsistentesOfertasRouter.get('/', requiereRolAsistente, async (req, res) => {
  const { data, error } = await supabase
    .from('ofertas_guardia')
    .select(`id, invitado_at, guardia_id, guardias!inner(${CAMPOS_DE_GUARDIA})`)
    .eq('asistente_id', req.usuarioAsistente.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .is('respuesta', null)
    .eq('guardias.estado', 'programada')
    .is('guardias.asistente_id', null)
    .order('invitado_at', { ascending: false })
    .limit(50);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const ahora = Date.now();
  const vivas = (data ?? []).filter(
    (o) => !o.guardias?.oferta_limite_at || new Date(o.guardias.oferta_limite_at).getTime() > ahora
  );

  try {
    const visibilidad = await visibilidadDelPedido(req);
    // La dirección que se muestra es la del día del turno ofrecido, no la de la ficha. Acá
    // pesa más que en ningún otro lado: es con ese dato que se decide si se toma el turno, y
    // aceptar creyendo que queda a diez cuadras para después enterarse de que ese mes se lo
    // atiende en otro barrio es exactamente lo que hace que alguien no vuelva a aceptar
    // (`utils/domicilioDelDia.js`).
    const guardias = await conDomicilioDelDia(
      await conPacientes(
        vivas.map((o) => o.guardias),
        camposDePacienteEnLaOferta(visibilidad)
      )
    );
    const porId = new Map(guardias.map((g) => [g.id, g]));

    res.json({
      ofertas: vivas.map((o) => ({
        id: o.id,
        invitado_at: o.invitado_at,
        guardia: porId.get(o.guardia_id) ?? null,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// Aceptar o rechazar
// ============================================================================

appAsistentesOfertasRouter.post('/:id/responder', requiereRolAsistente, async (req, res) => {
  const { respuesta } = req.body ?? {};
  if (respuesta !== 'acepta' && respuesta !== 'rechaza') {
    // Sin motivo a propósito: esto no le puede pasar a nadie desde la aplicación, que manda
    // una de las dos palabras y nada más. Un texto traducido para esto sería texto muerto.
    return res.status(400).json({ error: 'Respuesta no reconocida' });
  }

  const motivo =
    typeof req.body?.motivo === 'string' && req.body.motivo.trim()
      ? req.body.motivo.trim().slice(0, LARGO_MAXIMO_MOTIVO)
      : null;

  // La invitación tiene que ser de esta persona y de esta Prestadora. Si no lo es, para el
  // Asistente no existe: se contesta lo mismo que si el número estuviera mal escrito.
  const { data: oferta } = await supabase
    .from('ofertas_guardia')
    .select(`id, respuesta, guardia_id, guardias(${CAMPOS_DE_GUARDIA})`)
    .eq('id', req.params.id)
    .eq('asistente_id', req.usuarioAsistente.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .maybeSingle();

  if (!oferta || !oferta.guardias) {
    return noSePudo(res, 404, 'oferta_no_encontrada', 'Invitación no encontrada');
  }
  if (oferta.respuesta) {
    return noSePudo(res, 409, 'oferta_ya_contestada', 'La invitación ya estaba contestada');
  }

  const guardia = oferta.guardias;

  // Rechazar se puede siempre, aunque el plazo haya pasado: es información que a la
  // Prestadora le sirve igual, y negarse a registrar un "no" no le ahorra nada a nadie.
  if (respuesta === 'rechaza') {
    const { data: contestada, error: falla } = await supabase
      .from('ofertas_guardia')
      .update({ respuesta: 'rechaza', respuesta_at: new Date().toISOString(), motivo })
      .eq('id', oferta.id)
      .eq('asistente_id', req.usuarioAsistente.id)
      .is('respuesta', null)
      .select('id');

    if (falla) return res.status(500).json({ error: falla.message });
    if (!contestada?.length) {
      return noSePudo(res, 409, 'oferta_ya_contestada', 'La invitación ya estaba contestada');
    }
    return res.json({ respuesta: 'rechaza' });
  }

  // --- Aceptar ---

  if (guardia.estado !== 'programada') {
    return noSePudo(res, 409, 'guardia_ya_cubierta', 'La guardia ya no está disponible');
  }
  if (guardia.oferta_limite_at && new Date(guardia.oferta_limite_at).getTime() <= Date.now()) {
    return noSePudo(res, 409, 'oferta_vencida', 'El plazo para contestar ya pasó');
  }

  // Primero se reclama el turno y después se anota la respuesta, en ese orden. Al revés, si
  // el turno se lo lleva otro quedaría anotado que esta persona lo aceptó cuando no lo tiene.
  //
  // La guardia deja de estar publicada en la misma escritura: la base no admite una guardia
  // con Asistente que siga figurando como ofrecida, y son dos formas de decir lo mismo.
  const { data: tomada, error: fallaGuardia } = await supabase
    .from('guardias')
    .update({
      asistente_id: req.usuarioAsistente.id,
      ofrecida_at: null,
      ofrecida_por: null,
      oferta_limite_at: null,
    })
    .eq('id', guardia.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .is('asistente_id', null)
    .select('id');

  if (fallaGuardia) {
    // La Matrícula o la modalidad de trabajo pueden frenar la asignación en la base, y con
    // razón: entre la invitación y esta respuesta pudo vencerse el papel que lo autoriza.
    const bloqueo = motivoDelBloqueo(fallaGuardia);
    if (bloqueo) return noSePudo(res, 409, bloqueo, fallaGuardia.message);
    return res.status(500).json({ error: fallaGuardia.message });
  }
  if (!tomada?.length) {
    return noSePudo(res, 409, 'guardia_ya_cubierta', 'La guardia ya no está disponible');
  }

  const { error: fallaOferta } = await supabase
    .from('ofertas_guardia')
    .update({ respuesta: 'acepta', respuesta_at: new Date().toISOString() })
    .eq('id', oferta.id)
    .eq('asistente_id', req.usuarioAsistente.id);

  if (fallaOferta) {
    // No debería pasar: lo que la base revisa acá lo acaba de aprobar al asignar la guardia.
    // Si igual pasara, el turno vuelve a quedar publicado como estaba. Quedárselo sin que la
    // invitación diga que lo aceptó sería un turno asignado que nadie sabe por qué.
    await supabase
      .from('guardias')
      .update({
        asistente_id: null,
        ofrecida_at: guardia.ofrecida_at,
        ofrecida_por: guardia.ofrecida_por,
        oferta_limite_at: guardia.oferta_limite_at,
      })
      .eq('id', guardia.id);

    const bloqueo = motivoDelBloqueo(fallaOferta);
    if (bloqueo) return noSePudo(res, 409, bloqueo, fallaOferta.message);
    return res.status(500).json({ error: fallaOferta.message });
  }

  res.json({ respuesta: 'acepta', guardiaId: guardia.id });
});

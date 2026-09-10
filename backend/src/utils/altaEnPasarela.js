/* El único lugar por donde una suscripción del Marketplace se da de alta en una pasarela.
   ======================================================================================

   QUÉ RESUELVE. Las seis pasarelas están escritas desde el primer día y `crearSuscripcion` no la
   llamaba nadie: una suscripción vivía en esta base y no existía del lado de ningún proveedor, así
   que no había con qué cobrarle. Esto es lo que faltaba en el medio.

   POR QUÉ ES UN SOLO ARCHIVO. Dar de alta una suscripción son seis pasos —resolver el riel, sacar
   la credencial de la caja fuerte, conseguir el correo real de la Familia, llamar al proveedor,
   guardar lo que devolvió y no repetir nada de eso si ya estaba hecho— y ninguno se puede saltear.
   Hoy lo llama el Panel; mañana lo va a llamar la activación al intentar ver el contacto, del lado
   de la Familia. Si cada uno lo escribiera por su cuenta, la segunda copia iba a olvidarse alguno
   (`celtatech\CLAUDE.md` §8, ningún patrón repetido sin punto único de verdad).

   NO SE DA DE ALTA DOS VECES. `alta_en_pasarela` es la marca: con esa fecha puesta, la suscripción
   ya existe en el proveedor y volver a crearla dejaría dos cobros recurrentes vivos por la misma
   Familia. Se contesta lo que ya está guardado y no se llama a nadie.

   NO CAMBIA EL ESTADO DE LA SUSCRIPCIÓN. Dar de alta no es cobrar. La suscripción pasa a `activa`
   cuando entra la plata del primer período, y eso lo decide `registrarCobroExitoso`
   (`cobrosMarketplace.js`), que es adonde llegan tanto el aviso del proveedor como la carga a mano
   del Panel. Acá se guarda dónde quedó dada de alta y nada más.

   FALLA CERRADO. Sin riel conectado, sin credencial, sin correo de la Familia o con el proveedor
   rechazando el alta, no se guarda nada y se devuelve el motivo. Nunca queda una suscripción con
   la marca de alta puesta y sin referencia del proveedor: eso sería una suscripción que nadie va a
   volver a intentar y que no cobra nunca. */

import { supabase } from '../db/connection.js';
import { obtenerAdaptador, proveedoresDisponibles } from '../pasarelas/index.js';

/** Los motivos por los que un alta no se puede hacer. Son códigos, no frases: la frase que lee la
 *  persona vive en las traducciones del Panel, en los tres idiomas
 *  (`celtatech\CLAUDE.md` §8, «un mensaje de error es texto visible»). */
export const MOTIVO_ALTA = {
  SUSCRIPCION_INEXISTENTE: 'suscripcion_inexistente',
  SUSCRIPCION_CANCELADA: 'suscripcion_cancelada',
  SIN_PASARELA_CONECTADA: 'sin_pasarela_conectada',
  VARIAS_PASARELAS_CONECTADAS: 'varias_pasarelas_conectadas',
  PASARELA_NO_CONECTADA: 'pasarela_no_conectada',
  PROVEEDOR_DESCONOCIDO: 'proveedor_desconocido',
  SIN_CREDENCIAL: 'sin_credencial',
  SIN_CORREO_DE_FAMILIA: 'sin_correo_de_familia',
  PROVEEDOR_RECHAZO: 'proveedor_rechazo',
  NO_SE_PUDO_GUARDAR: 'no_se_pudo_guardar',
};

/**
 * Da de alta una suscripción en la pasarela de la Prestadora.
 *
 * @param {object} argumentos
 * @param {string} argumentos.suscripcionId  Cuál suscripción.
 * @param {string} argumentos.prestadoraId   De qué Prestadora — se comprueba contra la fila, para
 *                                           que nadie pueda dar de alta la suscripción de otra.
 * @param {string} [argumentos.proveedor]    Con qué riel. Sólo hace falta cuando la Prestadora
 *                                           tiene más de uno conectado: con uno solo se resuelve
 *                                           solo, y elegir por ella cuál de varios sería decidir
 *                                           con qué cobra.
 * @returns {Promise<{ok: boolean, motivo?: string, detalle?: string, alta?: object}>}
 */
export async function darDeAltaEnPasarela({ suscripcionId, prestadoraId, proveedor = null }) {
  const { data: suscripcion, error: errorSuscripcion } = await supabase
    .from('suscripciones_marketplace')
    .select('id, prestadora_id, familia_id, estado, monto_mensual, moneda, proveedor, referencia_externa, url_accion, alta_en_pasarela')
    .eq('id', suscripcionId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (errorSuscripcion) {
    return { ok: false, motivo: MOTIVO_ALTA.NO_SE_PUDO_GUARDAR, detalle: errorSuscripcion.message };
  }
  if (!suscripcion) {
    return { ok: false, motivo: MOTIVO_ALTA.SUSCRIPCION_INEXISTENTE };
  }

  // Una suscripción cancelada no se da de alta: sería empezar a cobrarle a quien se dio de baja.
  if (suscripcion.estado === 'cancelada') {
    return { ok: false, motivo: MOTIVO_ALTA.SUSCRIPCION_CANCELADA };
  }

  // Ya estaba dada de alta. Se contesta lo guardado y no se llama al proveedor.
  if (suscripcion.alta_en_pasarela) {
    return { ok: true, alta: resumenDelAlta(suscripcion), yaEstaba: true };
  }

  const riel = await resolverRiel({ prestadoraId, proveedor });
  if (!riel.ok) return riel;

  let adaptador;
  try {
    adaptador = obtenerAdaptador(riel.proveedor);
  } catch {
    return { ok: false, motivo: MOTIVO_ALTA.PROVEEDOR_DESCONOCIDO };
  }

  // La credencial sale de la caja fuerte y no se guarda en ninguna variable que sobreviva a esta
  // función. `efectivo_manual` no tiene ninguna, y no la necesita.
  let credencial = null;
  if (riel.proveedor !== 'efectivo_manual') {
    const { data, error } = await supabase.rpc('leer_credencial_pasarela_pago', {
      p_prestadora_id: prestadoraId,
      p_proveedor: riel.proveedor,
    });
    if (error || !data) {
      return { ok: false, motivo: MOTIVO_ALTA.SIN_CREDENCIAL, detalle: error?.message };
    }
    credencial = data;
  }

  const emailPagador = await correoDeLaFamilia(suscripcion.familia_id);
  // Dos rieles lo exigen y los demás lo ignoran, pero el corte se hace acá para todos: una
  // suscripción cuya Familia no tiene correo no se puede cobrar en ninguno, porque tampoco hay
  // adónde mandarle el comprobante ni el aviso previo.
  if (!emailPagador) {
    return { ok: false, motivo: MOTIVO_ALTA.SIN_CORREO_DE_FAMILIA };
  }

  let respuesta;
  try {
    respuesta = await adaptador.crearSuscripcion({
      prestadoraId,
      credencial,
      suscripcionId: suscripcion.id,
      monto: Number(suscripcion.monto_mensual),
      moneda: suscripcion.moneda,
      familiaId: suscripcion.familia_id,
      emailPagador,
    });
  } catch (falla) {
    // El texto crudo del proveedor queda del lado del servidor: puede nombrar la cuenta, el
    // comercio o la credencial (`celtatech\CLAUDE.md` §6).
    console.error('La pasarela rechazó el alta de una suscripción:', riel.proveedor, falla.message);
    return { ok: false, motivo: MOTIVO_ALTA.PROVEEDOR_RECHAZO };
  }

  const { error: errorGuardar } = await supabase
    .from('suscripciones_marketplace')
    .update({
      proveedor: riel.proveedor,
      referencia_externa: respuesta.referenciaExterna ?? null,
      url_accion: respuesta.urlAccion ?? null,
      alta_en_pasarela: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', suscripcion.id)
    .eq('prestadora_id', prestadoraId);

  if (errorGuardar) {
    // Acá la suscripción quedó creada en el proveedor y sin guardar de este lado. No se puede
    // deshacer sola —cancelarla del otro lado es otra llamada que también puede fallar—, así que
    // lo que corresponde es que quede registrado y que el alta se pueda volver a intentar: sin
    // `alta_en_pasarela`, el próximo intento la crea de nuevo, y el sobrante lo cancela una
    // persona desde el panel del proveedor. Se avisa fuerte porque es plata.
    console.error(
      'Suscripción creada en la pasarela y no guardada en la base:',
      riel.proveedor,
      suscripcion.id,
      errorGuardar.message
    );
    return { ok: false, motivo: MOTIVO_ALTA.NO_SE_PUDO_GUARDAR, detalle: errorGuardar.message };
  }

  return {
    ok: true,
    alta: resumenDelAlta({
      ...suscripcion,
      proveedor: riel.proveedor,
      referencia_externa: respuesta.referenciaExterna ?? null,
      url_accion: respuesta.urlAccion ?? null,
    }),
  };
}

/** Con qué riel se da de alta. Con uno solo conectado, ése; con varios, el que diga quien llama y
 *  siempre que esté conectado; con ninguno, no hay alta posible. Elegir por la Prestadora cuál de
 *  varios sería decidir con qué cobra, y eso no lo decide el producto. */
async function resolverRiel({ prestadoraId, proveedor }) {
  const { data, error } = await supabase
    .from('prestadora_pasarela_pago')
    .select('proveedor')
    .eq('prestadora_id', prestadoraId)
    .eq('estado_conexion', 'conectada');

  if (error) {
    return { ok: false, motivo: MOTIVO_ALTA.SIN_PASARELA_CONECTADA, detalle: error.message };
  }

  // Un riel que quedó guardado y que el código ya no conoce no sirve para dar de alta nada.
  const conectados = (data ?? [])
    .map((fila) => fila.proveedor)
    .filter((nombre) => proveedoresDisponibles().includes(nombre));

  if (!conectados.length) {
    return { ok: false, motivo: MOTIVO_ALTA.SIN_PASARELA_CONECTADA };
  }

  if (proveedor) {
    if (!conectados.includes(proveedor)) {
      return { ok: false, motivo: MOTIVO_ALTA.PASARELA_NO_CONECTADA };
    }
    return { ok: true, proveedor };
  }

  if (conectados.length > 1) {
    return { ok: false, motivo: MOTIVO_ALTA.VARIAS_PASARELAS_CONECTADAS, conectados };
  }

  return { ok: true, proveedor: conectados[0] };
}

/** El correo real de la Familia. `usuarios` no guarda correos —viven del lado de las cuentas—, y
 *  `familias.id` es el mismo identificador que el de la cuenta, igual que ya resuelven
 *  `instruccionesCirculo.js` y `mfaRecuperacionEmail.js`. */
async function correoDeLaFamilia(familiaId) {
  if (!familiaId) return null;
  const { data, error } = await supabase.auth.admin.getUserById(familiaId);
  if (error) {
    console.error('No se pudo leer el correo de la Familia para el alta en la pasarela:', error.message);
    return null;
  }
  return data?.user?.email || null;
}

/** Lo que se le devuelve a quien llamó. Nunca la credencial ni nada que venga de la caja fuerte. */
function resumenDelAlta(suscripcion) {
  return {
    proveedor: suscripcion.proveedor,
    referencia_externa: suscripcion.referencia_externa,
    url_accion: suscripcion.url_accion,
  };
}

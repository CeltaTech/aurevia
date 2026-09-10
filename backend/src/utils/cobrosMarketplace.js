/* El cobro de cada período de una suscripción del Marketplace.
   ===========================================================

   DOS COSAS, Y LAS DOS FALTABAN.

   1. **Armar el cobro del mes en los rieles que no cobran solos.** `modo` y `cobranza_efectivo` no
      dejan nada recurrente del lado del proveedor: si nadie les pide el QR o el cupón de este mes,
      la Familia no tiene con qué pagar. `generarCobroQr` y `generarCupon` estaban escritos desde el
      primer día y no los llamaba nadie. Eso lo hace `armarCobrosDelPeriodo`, una vez por día.

   2. **Anotar que un período se cobró, y mover la suscripción al siguiente.** Hasta acá, el aviso
      del proveedor movía `proximo_cobro` y las dos cargas a mano del Panel —el efectivo en mano y
      el canje del QR— no lo movían: el período quedaba pagado y la suscripción seguía esperando el
      mismo mes para siempre, así que el mes siguiente no llegaba nunca. Ahora los tres pasan por
      `registrarCobroExitoso`, que es el único que decide qué le pasa a la suscripción cuando entra
      la plata (`celtatech\CLAUDE.md` §8, ningún patrón repetido sin punto único de verdad).

   EL PERÍODO ES UNA FECHA GUARDADA, NO UNA CUENTA AL VUELO. `suscripciones_marketplace.proximo_cobro`
   dice qué mes toca, y el mes siguiente sale de ése y no de la fecha de hoy. Es lo que pide
   `docs/PRD_07_Modalidad_Marketplace.md:72-73`, y la diferencia se ve el día que un cobro entra
   tarde: contando desde hoy, cada demora corre la fecha y la Prestadora termina cobrando once
   meses por año.

   POR QUÉ ESTE TRABAJO NO SUSPENDE NADA. Armar un cobro no es cobrarlo. Que un cobro quede
   pendiente y no entre es otro asunto —el período de gracia y los reintentos son un paso aparte del
   plan— y acá no se toca el estado de ninguna suscripción por el paso del tiempo.

   Y NO SE ARMA DOS VECES EL MISMO MES. El candado de verdad está en la base: un índice único
   parcial deja un solo cobro `pendiente` por suscripción y período
   (`supabase/migrations/20260911100000_…`). Acá igual se pregunta antes, para no pedirle al
   proveedor un QR que después habría que tirar. */

import { supabase } from '../db/connection.js';
import { obtenerAdaptador, armaCobroPorPeriodo } from '../pasarelas/index.js';

/** Cuántos días vive el cupón de una red de cobranza extrabancaria. Quien decide hasta cuándo se
 *  puede pagar es este producto, no la red: un cupón sin vencimiento se paga tres meses tarde y el
 *  período ya está cerrado. */
const DIAS_DE_VENCIMIENTO_DEL_CUPON = 10;

/**
 * Le pide a cada riel de período el cobro de los meses que ya vencieron. Corre una vez por día
 * (`backend/src/server.js`). Recorre todas las Prestadoras y nunca corta por una: lo de una no
 * puede dejar sin cobrar a las demás, que es el mismo criterio de `revisarVencimientos`.
 */
export async function armarCobrosDelPeriodo() {
  const hoy = new Date().toISOString().slice(0, 10);

  const { data: suscripciones, error } = await supabase
    .from('suscripciones_marketplace')
    .select('id, prestadora_id, familia_id, proveedor, monto_mensual, moneda, proximo_cobro')
    .in('estado', ['trial', 'activa'])
    .not('proveedor', 'is', null)
    .not('proximo_cobro', 'is', null)
    .lte('proximo_cobro', hoy);

  if (error) {
    console.error('Error consultando las suscripciones por cobrar:', error.message);
    return;
  }

  // Sólo los rieles que no cobran solos. Los otros ya están andando del lado del proveedor y
  // pedirles algo por período crearía un segundo cobro del mismo mes.
  const porArmar = (suscripciones ?? []).filter((s) => armaCobroPorPeriodo(s.proveedor));
  if (!porArmar.length) return;

  // La credencial es una por Prestadora y riel, y sale de la caja fuerte con una llamada cada
  // vez. Se leen una sola vez por combinación y no una por suscripción.
  const credenciales = new Map();

  for (const suscripcion of porArmar) {
    try {
      await armarUnCobro(suscripcion, credenciales);
    } catch (falla) {
      // Ni el identificador de la Familia ni el texto crudo del proveedor: lo primero es dato de
      // una persona y lo segundo puede nombrar la cuenta de cobro (`celtatech\CLAUDE.md` §6).
      console.error(
        `Error armando el cobro de ${suscripcion.proximo_cobro} en ${suscripcion.proveedor}:`,
        falla.message
      );
    }
  }
}

async function armarUnCobro(suscripcion, credenciales) {
  const periodo = suscripcion.proximo_cobro;

  // ¿Ya tiene un cobro de este período que no está fallido? Entonces no hay nada que armar: o
  // está esperando que la Familia pague, o ya se pagó y lo que quedó atrasado es la fecha.
  const { data: existentes, error: errorExistentes } = await supabase
    .from('cobros_marketplace')
    .select('id, estado_cobro')
    .eq('suscripcion_id', suscripcion.id)
    .eq('periodo', periodo);

  if (errorExistentes) {
    throw new Error(errorExistentes.message);
  }
  if ((existentes ?? []).some((cobro) => cobro.estado_cobro !== 'fallido')) {
    return;
  }

  const credencial = await credencialDe(suscripcion.prestadora_id, suscripcion.proveedor, credenciales);
  if (!credencial) {
    throw new Error('sin credencial guardada para este riel');
  }

  const adaptador = obtenerAdaptador(suscripcion.proveedor);
  const armado = await adaptador.armarCobroDelPeriodo({
    credencial,
    monto: Number(suscripcion.monto_mensual),
    // La referencia que se le da al proveedor identifica el período, no la suscripción: es lo que
    // permite que dos meses de la misma Familia no se confundan cuando vuelven los avisos.
    referencia: `${suscripcion.id}:${periodo}`,
    vencimiento: sumarDias(periodo, DIAS_DE_VENCIMIENTO_DEL_CUPON),
  });

  const { error: errorInsertar } = await supabase.from('cobros_marketplace').insert({
    suscripcion_id: suscripcion.id,
    prestadora_id: suscripcion.prestadora_id,
    medio: suscripcion.proveedor,
    monto: suscripcion.monto_mensual,
    periodo,
    estado_cobro: 'pendiente',
    referencia_externa: armado.referenciaExterna ?? null,
    url_accion: armado.urlAccion ?? null,
    codigo_cupon: armado.codigoCupon ?? null,
  });

  if (errorInsertar) {
    // El QR ya existe del lado del proveedor y no quedó guardado acá. Vence solo, así que no hay
    // nada que deshacer; mañana el trabajo lo vuelve a armar. Se registra porque es plata.
    throw new Error(errorInsertar.message);
  }
}

async function credencialDe(prestadoraId, proveedor, credenciales) {
  const clave = `${prestadoraId}:${proveedor}`;
  if (credenciales.has(clave)) return credenciales.get(clave);

  const { data, error } = await supabase.rpc('leer_credencial_pasarela_pago', {
    p_prestadora_id: prestadoraId,
    p_proveedor: proveedor,
  });
  const credencial = error ? null : data || null;
  credenciales.set(clave, credencial);
  return credencial;
}

/**
 * Un período entró. Es el único lugar que decide qué le pasa a la suscripción cuando eso ocurre:
 * queda `activa` y su próximo cobro pasa a ser el mes siguiente **al del período que se cobró**.
 *
 * Lo llaman los tres caminos por los que entra la plata: el aviso del proveedor
 * (`routes/webhooksPasarelas.js`), la carga de efectivo en mano y el canje del QR
 * (`routes/panelMarketplace.js`).
 *
 * @param {object} argumentos
 * @param {string} argumentos.suscripcionId
 * @param {string} argumentos.periodo  El mes que se cobró, en formato `AAAA-MM-DD`.
 */
export async function registrarCobroExitoso({ suscripcionId, periodo }) {
  const { data: suscripcion, error } = await supabase
    .from('suscripciones_marketplace')
    .select('id, proximo_cobro')
    .eq('id', suscripcionId)
    .maybeSingle();

  if (error || !suscripcion) {
    console.error('No se pudo mover la suscripción tras un cobro:', error?.message || 'no encontrada');
    return { ok: false };
  }

  // La fecha desde la que se cuenta el mes siguiente. Normalmente es el período que se acaba de
  // cobrar; si por lo que sea llegara un cobro de un mes anterior al que la suscripción está
  // esperando, la fecha no se mueve hacia atrás — eso le regalaría un mes a quien pagó tarde.
  const base = periodo && (!suscripcion.proximo_cobro || periodo >= suscripcion.proximo_cobro)
    ? periodo
    : suscripcion.proximo_cobro;

  const { error: errorActualizar } = await supabase
    .from('suscripciones_marketplace')
    .update({
      estado: 'activa',
      proximo_cobro: sumarUnMes(base),
      updated_at: new Date().toISOString(),
    })
    .eq('id', suscripcionId);

  if (errorActualizar) {
    console.error('No se pudo mover la suscripción tras un cobro:', errorActualizar.message);
    return { ok: false };
  }

  return { ok: true, proximo_cobro: sumarUnMes(base) };
}

/**
 * El mismo día del mes siguiente, y si ese día no existe, el último del mes.
 *
 * No se escribe con `setMonth(+1)` a secas, que es lo que hacía el aviso de cobro: el 31 de enero
 * más un mes da 3 de marzo, y a partir de ahí la suscripción cobra el 3 de cada mes en vez del 31.
 * Un mes corrido de más por año.
 */
export function sumarUnMes(fechaISO) {
  const [anio, mes, dia] = fechaISO.slice(0, 10).split('-').map(Number);
  const mesSiguiente = mes === 12 ? 1 : mes + 1;
  const anioSiguiente = mes === 12 ? anio + 1 : anio;
  // Día 0 del mes que viene es el último del mes anterior: así sale cuántos días tiene.
  const ultimoDia = new Date(Date.UTC(anioSiguiente, mesSiguiente, 0)).getUTCDate();
  const diaFinal = Math.min(dia, ultimoDia);
  return `${anioSiguiente}-${String(mesSiguiente).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

/** Fecha en formato `AAAA-MM-DD`, tantos días después. Se hace en UTC a propósito: son fechas sin
 *  hora, y hacerlo en la zona del servidor corre un día según a qué hora corra el trabajo. */
export function sumarDias(fechaISO, dias) {
  const base = new Date(`${fechaISO.slice(0, 10)}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

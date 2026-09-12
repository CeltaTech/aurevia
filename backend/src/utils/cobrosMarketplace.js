/* El cobro de cada período de un acceso del Marketplace.
   =====================================================

   DOS COSAS, Y LAS DOS FALTABAN.

   1. **Armar el cobro del período en los rieles que no cobran solos.** `modo` y `cobranza_efectivo`
      no dejan nada recurrente del lado del proveedor: si nadie les pide el QR o el cupón de este
      período, la Familia no tiene con qué pagar. `generarCobroQr` y `generarCupon` estaban escritos
      desde el primer día y no los llamaba nadie. Eso lo hace `armarCobrosDelPeriodo`, una vez por
      día.

   2. **Anotar que un período se cobró, y mover el acceso al siguiente.** Hasta acá, el aviso del
      proveedor movía `proximo_cobro` y las dos cargas a mano del Panel —el efectivo en mano y el
      canje del QR— no lo movían: el período quedaba pagado y el acceso seguía esperando el mismo
      para siempre, así que el siguiente no llegaba nunca. Ahora los tres pasan por
      `registrarCobroExitoso`, que es el único que decide qué le pasa al acceso cuando entra la
      plata (`celtatech\CLAUDE.md` §8, ningún patrón repetido sin punto único de verdad).

   Y NO TODO LO QUE SE COBRA ES UN PERÍODO. Una forma de cobro puede traer contactos incluidos —un
   paquete se paga una vez y lo que lo sostiene es el saldo, no una fecha—, y el único momento en
   que ese saldo existe es cuando entra la plata. Por eso la carga también sale de acá
   (`contactosMarketplace.js`): es el mismo punto único por donde pasan los tres caminos del cobro.

   CUÁNTO DURA EL PERÍODO LO DICE LA PRESTADORA, NO ESTE ARCHIVO. Cada acceso cuelga de la forma de
   cobro que la Familia eligió, y esa forma guarda cada cuánto se cobra: tantos días, semanas, meses
   o años (`formas_de_cobro_marketplace.periodo_cantidad` y `periodo_unidad`). Una forma sin período
   se cobra una sola vez y no tiene siguiente.

   Y EL PERÍODO ES UNA FECHA GUARDADA, NO UNA CUENTA AL VUELO. `accesos_marketplace.proximo_cobro`
   dice cuál toca, y el siguiente sale de ése y no de la fecha de hoy. Es lo que pide
   `docs/PRD_07_Modalidad_Marketplace.md:72-73`, y la diferencia se ve el día que un cobro entra
   tarde: contando desde hoy, cada demora corre la fecha y la Prestadora termina cobrando once
   períodos por año.

   POR QUÉ ESTE TRABAJO NO SUSPENDE NADA. Armar un cobro no es cobrarlo. Que un cobro quede
   pendiente y no entre es otro asunto —el período de gracia y los reintentos son un paso aparte del
   plan— y acá no se toca el estado de ningún acceso por el paso del tiempo.

   Y NO SE ARMA DOS VECES EL MISMO PERÍODO. El candado de verdad está en la base: un índice único
   parcial deja un solo cobro `pendiente` por acceso y período
   (`supabase/migrations/20260911100000_…`). Acá igual se pregunta antes, para no pedirle al
   proveedor un QR que después habría que tirar. */

import { supabase } from '../db/connection.js';
import { obtenerAdaptador, armaCobroPorPeriodo } from '../pasarelas/index.js';
import { cargarContactosEnElSaldo } from './contactosMarketplace.js';

/** Cuántos días vive el cupón de una red de cobranza extrabancaria. Quien decide hasta cuándo se
 *  puede pagar es este producto, no la red: un cupón sin vencimiento se paga tres meses tarde y el
 *  período ya está cerrado. */
const DIAS_DE_VENCIMIENTO_DEL_CUPON = 10;

/**
 * Le pide a cada riel de período el cobro de los períodos que ya vencieron. Corre una vez por día
 * (`backend/src/server.js`). Recorre todas las Prestadoras y nunca corta por una: lo de una no
 * puede dejar sin cobrar a las demás, que es el mismo criterio de `revisarVencimientos`.
 */
export async function armarCobrosDelPeriodo() {
  const hoy = new Date().toISOString().slice(0, 10);

  const { data: accesos, error } = await supabase
    .from('accesos_marketplace')
    .select(
      'id, prestadora_id, familia_id, proveedor, importe, moneda, proximo_cobro, ' +
        'formas_de_cobro_marketplace(periodo_cantidad, periodo_unidad)'
    )
    .eq('estado', 'vigente')
    .not('proveedor', 'is', null)
    .not('proximo_cobro', 'is', null)
    .lte('proximo_cobro', hoy);

  if (error) {
    console.error('Error consultando los accesos por cobrar:', error.message);
    return;
  }

  // Sólo los rieles que no cobran solos. Los otros ya están andando del lado del proveedor y
  // pedirles algo por período crearía un segundo cobro del mismo período.
  const porArmar = (accesos ?? []).filter((s) => armaCobroPorPeriodo(s.proveedor));
  if (!porArmar.length) return;

  // La credencial es una por Prestadora y riel, y sale de la caja fuerte con una llamada cada
  // vez. Se leen una sola vez por combinación y no una por acceso.
  const credenciales = new Map();

  for (const acceso of porArmar) {
    try {
      await armarUnCobro(acceso, credenciales);
    } catch (falla) {
      // Ni el identificador de la Familia ni el texto crudo del proveedor: lo primero es dato de
      // una persona y lo segundo puede nombrar la cuenta de cobro (`celtatech\CLAUDE.md` §6).
      console.error(
        `Error armando el cobro de ${acceso.proximo_cobro} en ${acceso.proveedor}:`,
        falla.message
      );
    }
  }
}

async function armarUnCobro(acceso, credenciales) {
  const periodo = acceso.proximo_cobro;

  // ¿Ya tiene un cobro de este período que no está fallido? Entonces no hay nada que armar: o
  // está esperando que la Familia pague, o ya se pagó y lo que quedó atrasado es la fecha.
  const { data: existentes, error: errorExistentes } = await supabase
    .from('cobros_marketplace')
    .select('id, estado_cobro')
    .eq('acceso_id', acceso.id)
    .eq('periodo', periodo);

  if (errorExistentes) {
    throw new Error(errorExistentes.message);
  }
  if ((existentes ?? []).some((cobro) => cobro.estado_cobro !== 'fallido')) {
    return;
  }

  const credencial = await credencialDe(acceso.prestadora_id, acceso.proveedor, credenciales);
  if (!credencial) {
    throw new Error('sin credencial guardada para este riel');
  }

  const adaptador = obtenerAdaptador(acceso.proveedor);
  const armado = await adaptador.armarCobroDelPeriodo({
    credencial,
    monto: Number(acceso.importe),
    // La referencia que se le da al proveedor identifica el período, no el acceso: es lo que
    // permite que dos períodos de la misma Familia no se confundan cuando vuelven los avisos.
    referencia: `${acceso.id}:${periodo}`,
    vencimiento: sumarDias(periodo, DIAS_DE_VENCIMIENTO_DEL_CUPON),
  });

  const { error: errorInsertar } = await supabase.from('cobros_marketplace').insert({
    acceso_id: acceso.id,
    prestadora_id: acceso.prestadora_id,
    medio: acceso.proveedor,
    monto: acceso.importe,
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
 * Un período entró. Es el único lugar que decide qué le pasa al acceso cuando eso ocurre: queda
 * `vigente` y su próximo cobro pasa a ser un período **contado desde el que se cobró**.
 *
 * Lo llaman los tres caminos por los que entra la plata: el aviso del proveedor
 * (`routes/webhooksPasarelas.js`), la carga de efectivo en mano y el canje del QR
 * (`routes/panelMarketplace.js`).
 *
 * @param {object} argumentos
 * @param {string} argumentos.accesoId
 * @param {string} argumentos.periodo  El período que se cobró, en formato `AAAA-MM-DD`.
 */
export async function registrarCobroExitoso({ accesoId, periodo }) {
  const { data: acceso, error } = await supabase
    .from('accesos_marketplace')
    .select(
      'id, proximo_cobro, ' +
        'formas_de_cobro_marketplace(periodo_cantidad, periodo_unidad, contactos_incluidos)'
    )
    .eq('id', accesoId)
    .maybeSingle();

  if (error || !acceso) {
    console.error('No se pudo mover el acceso tras un cobro:', error?.message || 'no encontrado');
    return { ok: false };
  }

  // La fecha desde la que se cuenta el período siguiente. Normalmente es el que se acaba de
  // cobrar; si por lo que sea llegara un cobro de un período anterior al que el acceso está
  // esperando, la fecha no se mueve hacia atrás — eso le regalaría un período a quien pagó tarde.
  const base = periodo && (!acceso.proximo_cobro || periodo >= acceso.proximo_cobro)
    ? periodo
    : acceso.proximo_cobro;

  // Una forma que se cobra una sola vez no tiene período siguiente: queda pago y no vuelve a
  // cobrarse. Lo que la sostenga a partir de acá —una fecha o un saldo— ya está guardado.
  const proximoCobro = proximaFecha(base, acceso.formas_de_cobro_marketplace);

  const { error: errorActualizar } = await supabase
    .from('accesos_marketplace')
    .update({
      estado: 'vigente',
      proximo_cobro: proximoCobro,
      // Hasta cuándo alcanza lo que se acaba de pagar. Es el dato que después mira el corte al
      // fin del período pagado: sin él, cortar obligaría a rehacer la cuenta del cobro.
      ...(proximoCobro ? { vigente_hasta: proximoCobro } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', accesoId);

  if (errorActualizar) {
    console.error('No se pudo mover el acceso tras un cobro:', errorActualizar.message);
    return { ok: false };
  }

  // Y si lo que se pagó trae contactos, el saldo se carga acá: entrar la plata es el momento en
  // que existen. Se suma al que hubiera, porque un paquete no vence por calendario y lo que quedó
  // sin abrir de una compra anterior sigue estando. Va después de mover el acceso a propósito: el
  // período es lo que no puede quedar sin anotar, y una carga de saldo que falle se ve en el
  // registro sin dejar un cobro a medio aplicar.
  const contactos = acceso.formas_de_cobro_marketplace?.contactos_incluidos;
  let saldoContactos;
  if (contactos > 0) {
    const carga = await cargarContactosEnElSaldo({ accesoId, cuantos: contactos });
    if (!carga.ok) {
      console.error('No se pudo cargar el saldo de contactos tras un cobro:', carga.motivo, carga.detalle ?? '');
    } else {
      saldoContactos = carga.saldo_contactos;
    }
  }

  return { ok: true, proximo_cobro: proximoCobro, saldo_contactos: saldoContactos ?? null };
}

/**
 * Cuándo toca el cobro siguiente, según el período que la Prestadora le puso a esa forma de
 * cobro. Sin período —una forma que se cobra una sola vez— devuelve `null`: no hay siguiente.
 */
export function proximaFecha(fechaISO, forma) {
  const cantidad = forma?.periodo_cantidad;
  const unidad = forma?.periodo_unidad;
  if (!cantidad || !unidad) return null;
  return sumarPeriodo(fechaISO, cantidad, unidad);
}

/**
 * Tantos días, semanas, meses o años después. Las cuatro unidades son las que la Prestadora
 * puede elegir al armar su forma de cobro (`formas_de_cobro_marketplace.periodo_unidad`).
 *
 * Por meses y años no se escribe con `setMonth(+1)` a secas, que es lo que hacía el aviso de
 * cobro: el 31 de enero más un mes da 3 de marzo, y a partir de ahí el cobro cae el 3 de cada mes
 * en vez del 31. Un período corrido de más por año. Cuando el día no existe en el mes al que se
 * llega, se usa el último de ese mes.
 */
export function sumarPeriodo(fechaISO, cantidad, unidad) {
  if (unidad === 'dia') return sumarDias(fechaISO, cantidad);
  if (unidad === 'semana') return sumarDias(fechaISO, cantidad * 7);

  const meses = unidad === 'anio' ? cantidad * 12 : cantidad;
  if (unidad !== 'mes' && unidad !== 'anio') {
    throw new Error(`unidad de período desconocida: ${unidad}`);
  }

  const [anio, mes, dia] = fechaISO.slice(0, 10).split('-').map(Number);
  // Se cuenta en meses corridos desde el año cero para no tener que tratar aparte el cambio de
  // año: enero es el mes 0 de su año, y sumar doce da el mismo mes del año siguiente.
  const corridos = anio * 12 + (mes - 1) + meses;
  const anioFinal = Math.floor(corridos / 12);
  const mesFinal = (corridos % 12) + 1;
  // Día 0 del mes que viene es el último del mes anterior: así sale cuántos días tiene.
  const ultimoDia = new Date(Date.UTC(anioFinal, mesFinal, 0)).getUTCDate();
  const diaFinal = Math.min(dia, ultimoDia);
  return `${anioFinal}-${String(mesFinal).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

/** Fecha en formato `AAAA-MM-DD`, tantos días después. Se hace en UTC a propósito: son fechas sin
 *  hora, y hacerlo en la zona del servidor corre un día según a qué hora corra el trabajo. */
export function sumarDias(fechaISO, dias) {
  const base = new Date(`${fechaISO.slice(0, 10)}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

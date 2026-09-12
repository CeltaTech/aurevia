// Pendiente #85 (docs/PLAN_HASTA_PRODUCCION.md), Grupo 3 Marketplace — registro de adaptadores de
// pasarela de pago. Un solo punto de verdad (CLAUDE.md §7 regla 12): cualquier ruta que
// necesite operar sobre un acceso llama a `obtenerAdaptador(proveedor)`, nunca importa un
// adaptador puntual por su nombre de proveedor.
//
// Interfaz común que todo adaptador implementa:
//   crearSuscripcion({ prestadoraId, credencial, accesoId, monto, moneda, periodo, gratisHasta,
//                      familiaId, emailPagador })
//     -> { estadoConexion: 'pendiente'|'exitoso', referenciaExterna, urlAccion? }
//     `periodo` es `{ cantidad, unidad }` —`dia`, `semana`, `mes` o `anio`— y dice cada cuánto
//     vuelve a cobrarse. Sale de la forma de cobro que armó la Prestadora, así que ningún
//     adaptador tiene un valor por descarte: sin período, falla.
//     `gratisHasta` es el día del primer cobro cuando la forma de cobro tiene período gratuito, y
//     nulo cuando no lo tiene. **Sólo lo miran los rieles que cobran solos**, porque el cobro
//     recurrente queda andando del lado del proveedor y sin decírselo arrancaría hoy: Stripe lo
//     manda como `trial_end` y Mercado Pago como `auto_recurring.start_date`. Los demás lo ignoran
//     a propósito —no dejan nada recurrente—, y ahí el período gratuito lo sostiene
//     `accesos_marketplace.proximo_cobro`, que es lo único que mira `armarCobrosDelPeriodo`.
//     `emailPagador` es el correo real de la Familia. Lo resuelve quien llama —hoy
//     `backend/src/utils/altaEnPasarela.js`, que es el único punto por donde se da de alta un
//     acceso—, porque el adaptador no consulta la base. Los rieles que no se lo piden al
//     proveedor lo ignoran; Mercado Pago sin él rechaza el alta.
//   cancelarSuscripcion({ credencial, referenciaExterna })
//     -> { ok: true }
//   verificarWebhook({ credencial, secretoFirma, headers, consulta, cuerpoCrudo, body })
//     -> { valido: boolean, motivo, referenciaExterna, estado: 'exitoso'|'fallido'|'pendiente' }
//     `cuerpoCrudo` son los bytes exactos que mandó la pasarela, sin pasar por express: una
//     firma se calcula sobre eso y no sobre el objeto ya leído (pendiente #159). `motivo`
//     dice por qué se rechazó, y lo mira la ruta para saber si contesta 401 (ver
//     `firmaWebhook.js`).
//   consultarEstado({ credencial, referenciaExterna })
//     -> { estado: 'exitoso'|'fallido'|'pendiente' }
//
// Y sólo los rieles que no dejan nada recurrente del lado del proveedor implementan además:
//   armarCobroDelPeriodo({ credencial, monto, referencia, vencimiento })
//     -> { referenciaExterna, urlAccion, codigoCupon }
//     Se reconocen por la marca `ARMA_COBRO_POR_PERIODO`, que consulta `armaCobroPorPeriodo()`.
//
// El monto SIEMPRE viaja como parámetro — ningún adaptador asume un monto fijo, para poder
// reutilizarse el día que se automatice también el cobro de facturas_familia (pendiente #59).

import * as mercadopago from './mercadopago.js';
import * as stripe from './stripe.js';
import * as modo from './modo.js';
import * as debin from './debin.js';
import * as cobranzaEfectivo from './cobranzaEfectivo.js';
import * as efectivoManual from './efectivoManual.js';

const ADAPTADORES = {
  mercadopago,
  stripe,
  modo,
  debin,
  cobranza_efectivo: cobranzaEfectivo,
  efectivo_manual: efectivoManual,
};

export function proveedoresDisponibles() {
  return Object.keys(ADAPTADORES);
}

/** ¿Este proveedor firma sus avisos de cobro? Lo contesta el adaptador, que es el único que
 *  sabe cómo comprueba lo que le llega; el Panel lo consulta para saber si además de la
 *  credencial le tiene que pedir a la Prestadora el secreto de firma (regla 12 del §7). */
export function requiereSecretoFirma(proveedor) {
  return Boolean(ADAPTADORES[proveedor]?.REQUIERE_SECRETO_FIRMA);
}

/** ¿Al aviso de este proveedor hay que confirmarlo preguntándole el estado a él mismo? Hay
 *  proveedores cuyo aviso trae el estado adentro de lo que firman —ahí el aviso alcanza— y
 *  otros cuyo aviso solo dice "pasó algo con este cobro". Para los segundos, comprobar la
 *  firma no es saber si la plata entró, y la ruta vuelve a preguntar antes de imputar nada.
 *  Lo contesta el adaptador, que es el único que sabe cómo avisa su proveedor (regla 12). */
export function confirmaConsultando(proveedor) {
  return Boolean(ADAPTADORES[proveedor]?.CONFIRMA_CONSULTANDO);
}

/** ¿A este riel hay que armarle el cobro período por período? Los seis se parten en dos grupos y
 *  la diferencia manda todo lo demás: los que cobran solos (`mercadopago`, `stripe`, `debin`)
 *  quedan andando con el alta del acceso y avisan por cada período que cobran; los que no
 *  (`modo`, `cobranza_efectivo`) no dejan nada recurrente, y si nadie les pide el QR o el cupón de
 *  este mes, la Familia no tiene con qué pagar. `efectivo_manual` no es ninguno de los dos: ahí
 *  no hay proveedor, la carga la hace una persona desde el Panel.
 *
 *  Lo contesta el adaptador y no una lista escrita en el trabajo diario, que es lo mismo que ya
 *  hacen `requiereSecretoFirma` y `confirmaConsultando`: el día que entre un riel nuevo, alcanza
 *  con que su archivo diga de qué grupo es. */
export function armaCobroPorPeriodo(proveedor) {
  return Boolean(ADAPTADORES[proveedor]?.ARMA_COBRO_POR_PERIODO);
}

export function obtenerAdaptador(proveedor) {
  const adaptador = ADAPTADORES[proveedor];
  if (!adaptador) {
    throw new Error(`Proveedor de pasarela desconocido: ${proveedor}`);
  }
  return adaptador;
}

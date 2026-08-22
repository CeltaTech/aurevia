// Pendiente #85 (docs/PENDIENTES.md), Grupo 3 Marketplace — registro de adaptadores de
// pasarela de pago. Un solo punto de verdad (CLAUDE.md §7 regla 12): cualquier ruta que
// necesite operar sobre una suscripción llama a `obtenerAdaptador(proveedor)`, nunca
// importa un adaptador puntual por su nombre de proveedor.
//
// Interfaz común que todo adaptador implementa:
//   crearSuscripcion({ prestadoraId, credencial, suscripcionId, monto, moneda, familiaId })
//     -> { estadoConexion: 'pendiente'|'exitoso', referenciaExterna, urlAccion? }
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

export function obtenerAdaptador(proveedor) {
  const adaptador = ADAPTADORES[proveedor];
  if (!adaptador) {
    throw new Error(`Proveedor de pasarela desconocido: ${proveedor}`);
  }
  return adaptador;
}

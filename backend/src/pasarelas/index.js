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
//   verificarWebhook({ credencial, headers, body })
//     -> { valido: boolean, referenciaExterna, estado: 'exitoso'|'fallido'|'pendiente' }
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

export function obtenerAdaptador(proveedor) {
  const adaptador = ADAPTADORES[proveedor];
  if (!adaptador) {
    throw new Error(`Proveedor de pasarela desconocido: ${proveedor}`);
  }
  return adaptador;
}

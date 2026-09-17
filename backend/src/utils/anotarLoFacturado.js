/* Anotar en una factura lo que el software de facturación emitió.
   ==========================================================================

   POR QUÉ EXISTE ESTE ARCHIVO. Lo emitido llega hoy por tres caminos —cargado a mano factura por
   factura, subido en un archivo, o empujado por el software de facturación de la Prestadora— y los
   tres terminan escribiendo exactamente lo mismo en la misma fila. Escrito tres veces, alcanza con
   que uno de los tres se olvide de una columna para que la misma factura quede distinta según por
   dónde entró. Acá está una sola vez (`CLAUDE.md` §8, punto único de verdad).

   QUÉ SE ESCRIBE. Los tres datos de siempre —cómo se llama el comprobante, qué número tiene y
   cuánto quedó adeudando la Familia— y el instante en que se anotó. El nombre del comprobante es
   texto que se guarda y no se interpreta: cambia de país en país y el producto no conoce ninguno.

   EL VENCIMIENTO SÓLO SI VIENE. Si quien emitió no informa uno, queda el que la factura ya tenía,
   que es el acordado con esa Familia y calculado al generar. Pisarlo con un vacío movería una
   fecha que nadie decidió cambiar.

   LO QUE NO HACE: decidir. Si ese renglón se anota, se saltea o se rechaza lo resuelve
   `intercambioDeFacturacion.js`, que se puede probar sin base. Acá se escribe, nada más. */

import { supabase } from '../db/connection.js';
import { aDosDecimales } from './facturacionDeFamilias.js';

/** Las columnas que quedan escritas en la factura con lo que informó quien emitió. */
export function cambiosDeLoFacturado(facturado) {
  const ahora = new Date().toISOString();
  const cambios = {
    monto_facturado: aDosDecimales(facturado.monto_facturado),
    comprobante_tipo: String(facturado.comprobante_tipo).trim(),
    comprobante_numero: String(facturado.comprobante_numero ?? '').trim() || null,
    facturado_at: ahora,
    updated_at: ahora,
  };
  if (facturado.fecha_vencimiento) {
    cambios.fecha_vencimiento = String(facturado.fecha_vencimiento).slice(0, 10);
  }
  return cambios;
}

/**
 * Escribir lo emitido en esa factura. Devuelve lo que contestó la base.
 *
 * El filtro de Prestadora va acá y no en quien llama: el motor entra a la base con la llave de
 * servicio, así que si falta ese filtro no lo detiene nadie.
 */
export async function anotarLoFacturado(prestadoraId, facturaId, facturado) {
  return supabase
    .from('facturas_familia')
    .update(cambiosDeLoFacturado(facturado))
    .eq('id', facturaId)
    .eq('prestadora_id', prestadoraId);
}

/**
 * La factura de esta Prestadora, con lo único que hace falta para decidir si se anota.
 *
 * Contesta `null` también cuando la factura existe pero es de otra Prestadora: quién es de quién
 * lo resuelve esta consulta, y desde afuera las dos situaciones se ven iguales a propósito.
 */
export async function facturaParaAnotar(prestadoraId, facturaId) {
  return supabase
    .from('facturas_familia')
    .select('id, facturado_at')
    .eq('id', facturaId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
}

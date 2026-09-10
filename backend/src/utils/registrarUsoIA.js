import { supabase } from '../db/connection.js';

// Punto único de verdad para calcular el costo real de una llamada a la IA (CLAUDE.md
// §7.12 — evita repetir esta cuenta en alertasIA.js/reporteIA.js/importacionIA.js/
// iaWhatsapp.js) y para el pendiente #84 (docs/PLAN_HASTA_PRODUCCION.md): registro de uso de IA por
// Prestadora, nunca visible en el panel de la propia Prestadora (CLAUDE.md §2).
//
// El costo nunca se estima ni se hardcodea (CLAUDE.md §7.10): se toma tokens_entrada/
// tokens_salida real que devuelve la respuesta de Anthropic y se multiplica por el precio
// vigente en precios_ia_modelo a la fecha de la llamada (no el precio actual si la llamada
// fuera reprocesada después).
//
// Si el registro falla (tabla caída, precio no cargado, etc.) nunca corta el flujo
// principal — guardar el reporte/alerta/mapeo/respuesta de WhatsApp importa más que
// contabilizar su costo; el error solo queda en el log del backend.
export async function registrarUsoIA({ prestadoraId, modulo, modelo, proveedor = 'anthropic', respuestaAnthropic }) {
  try {
    const tokensEntrada = respuestaAnthropic?.usage?.input_tokens ?? 0;
    const tokensSalida = respuestaAnthropic?.usage?.output_tokens ?? 0;
    const ahoraISO = new Date().toISOString().slice(0, 10);

    const { data: precio, error: errorPrecio } = await supabase
      .from('precios_ia_modelo')
      .select('precio_entrada_usd_por_millon, precio_salida_usd_por_millon')
      .eq('proveedor', proveedor)
      .eq('modelo', modelo)
      .lte('vigente_desde', ahoraISO)
      .order('vigente_desde', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (errorPrecio || !precio) {
      console.error(`registrarUsoIA: sin precio cargado para ${proveedor}/${modelo} — no se registra el costo de esta llamada`);
      return;
    }

    const costoUsd =
      (tokensEntrada / 1_000_000) * Number(precio.precio_entrada_usd_por_millon) +
      (tokensSalida / 1_000_000) * Number(precio.precio_salida_usd_por_millon);

    const { error: errorInsert } = await supabase.from('uso_ia').insert({
      prestadora_id: prestadoraId,
      modulo,
      proveedor,
      modelo,
      tokens_entrada: tokensEntrada,
      tokens_salida: tokensSalida,
      costo_usd: costoUsd,
    });

    if (errorInsert) {
      console.error('registrarUsoIA: error al insertar uso_ia:', errorInsert.message);
    }
  } catch (err) {
    console.error('registrarUsoIA: error inesperado:', err.message);
  }
}

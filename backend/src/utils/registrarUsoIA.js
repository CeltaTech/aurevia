import { supabase } from '../db/connection.js';

// El medidor de consumo de IA
// ============================================================================
//
// Anota, por Prestadora, cuántos tokens gastó cada llamada a la inteligencia artificial, con qué
// módulo se hizo y contra qué modelo. Es un contador y nada más: acá no hay ningún precio ni
// ningún importe.
//
// **Y esa es la regla, no una simplificación.** El producto declara lo que sabe hacer y mide lo
// que consumió; cuánto vale ese consumo, cómo se reparte y a quién se le cobra es de CeltaTech y
// vive en su panel (`celtatech/CLAUDE.md` §2). Con la tabla de precios adentro del producto, el
// mismo precio terminaba escrito de los dos lados, con dos respuestas posibles para la misma
// pregunta.
//
// Lo que había acá —la tabla de precios por millón de tokens, la vigilancia mensual de los
// precios del proveedor, la columna del importe y la pantalla que lo mostraba— funcionaba bien y
// está guardado entero en el estante de la empresa, en
// `Codigos-utiles/vigilancia-del-precio-de-la-ia/`, con su documento de cómo se vuelve a poner.
//
// **Antes no se registraba nada cuando no había precio cargado**, así que la medición dependía de
// una configuración comercial y hoy la tabla está vacía. Ahora el conteo entra siempre: es lo
// único que el producto tiene que saber, y lo sabe sin que nadie configure nada.
//
// Si el registro falla nunca corta el flujo principal — guardar el reporte, la alerta, el mapeo o
// la respuesta de WhatsApp importa más que contar su consumo; el error queda en el registro del
// motor.
export async function registrarUsoIA({ prestadoraId, modulo, modelo, proveedor = 'anthropic', respuestaAnthropic }) {
  try {
    const { error } = await supabase.from('uso_ia').insert({
      prestadora_id: prestadoraId,
      modulo,
      proveedor,
      modelo,
      tokens_entrada: respuestaAnthropic?.usage?.input_tokens ?? 0,
      tokens_salida: respuestaAnthropic?.usage?.output_tokens ?? 0,
    });

    if (error) {
      console.error('registrarUsoIA: error al insertar uso_ia:', error.message);
    }
  } catch (err) {
    console.error('registrarUsoIA: error inesperado:', err.message);
  }
}

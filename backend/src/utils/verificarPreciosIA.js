import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db/connection.js';

// Rutina mensual del pendiente #84 (docs/PENDIENTES.md): el día 1 de cada mes, revisa si
// el precio oficial publicado por cada proveedor de IA sigue coincidiendo con lo cargado
// en precios_ia_modelo. Nunca aplica un cambio detectado por su cuenta — lo deja en
// cambios_precio_ia_pendientes esperando confirmación explícita en el panel de
// Admin_plataforma (CLAUDE.md §6: ningún valor económico se actualiza sin confirmación).
//
// Es data-driven: recorre lo que ya está cargado en precios_ia_modelo, no una lista fija
// de modelos en el código — el día que se agregue un proveedor nuevo (Gemini, OpenAI), la
// misma rutina lo empieza a chequear sin tocar este archivo.

const DIA_DEL_MES_VERIFICACION = 1;
const MODELO_VERIFICADOR = 'claude-sonnet-5';

const PAGINAS_PRECIOS = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
  openai: 'https://openai.com/api/pricing',
};

let cliente = null;
function obtenerCliente() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cliente) cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cliente;
}

// Guarda contra correr dos veces el mismo día si el intervalo del server dispara de más
// (mismo patrón de guarda por fecha que ya usa el resto de backend/src/server.js).
let ultimaEjecucionISO = null;

export async function verificarPreciosIA() {
  const hoy = new Date();
  const hoyISO = hoy.toISOString().slice(0, 10);
  if (hoy.getDate() !== DIA_DEL_MES_VERIFICACION || ultimaEjecucionISO === hoyISO) return;
  ultimaEjecucionISO = hoyISO;

  const anthropic = obtenerCliente();
  if (!anthropic) return;

  const { data: preciosCargados, error } = await supabase
    .from('precios_ia_modelo')
    .select('proveedor, modelo, precio_entrada_usd_por_millon, precio_salida_usd_por_millon, vigente_desde')
    .order('vigente_desde', { ascending: false });
  if (error || !preciosCargados?.length) return;

  // Un modelo puede tener varias filas (precios futuros ya conocidos, ver semilla de
  // Sonnet 5 en schema_uso_ia_01.sql) — comparamos contra el precio VIGENTE hoy, nunca
  // contra uno con fecha futura todavía no aplicada.
  const vigentePorClave = new Map();
  for (const fila of preciosCargados) {
    if (fila.vigente_desde > hoyISO) continue;
    const clave = `${fila.proveedor}|${fila.modelo}`;
    if (!vigentePorClave.has(clave)) vigentePorClave.set(clave, fila);
  }

  const filasVigentes = [...vigentePorClave.values()];
  const proveedores = new Set(filasVigentes.map((f) => f.proveedor));

  for (const proveedor of proveedores) {
    const urlFuente = PAGINAS_PRECIOS[proveedor];
    if (!urlFuente) continue;

    let html;
    try {
      const respuestaFetch = await fetch(urlFuente);
      html = await respuestaFetch.text();
    } catch (err) {
      console.error(`verificarPreciosIA: no se pudo traer ${urlFuente}:`, err.message);
      continue;
    }

    const modelosDeEsteProveedor = filasVigentes.filter((f) => f.proveedor === proveedor);

    let extraido;
    try {
      const respuestaIA = await anthropic.messages.create({
        model: MODELO_VERIFICADOR,
        max_tokens: 1000,
        system: `Este asistente lee la página de precios oficial de un proveedor de IA y
extrae el precio actual por millón de tokens de entrada y de salida, para los modelos que se
nombran a continuación. Se responde únicamente con JSON de esta forma, sin texto adicional:
{"nombre_del_modelo": {"precio_entrada_usd_por_millon": number, "precio_salida_usd_por_millon": number}, ...}
Si alguno de los modelos pedidos no aparece en la página, no se incluye esa clave.`,
        messages: [{
          role: 'user',
          content: `Modelos a buscar: ${modelosDeEsteProveedor.map((m) => m.modelo).join(', ')}\n\nContenido de la página (puede tener HTML/ruido, se ignora):\n${html.slice(0, 40000)}`,
        }],
      });
      const texto = respuestaIA.content?.[0]?.type === 'text' ? respuestaIA.content[0].text : '';
      extraido = JSON.parse(texto);
    } catch (err) {
      console.error(`verificarPreciosIA: no se pudo interpretar la página de ${proveedor}:`, err.message);
      continue;
    }

    for (const filaActual of modelosDeEsteProveedor) {
      const detectado = extraido?.[filaActual.modelo];
      if (!detectado) continue;

      const cambioEntrada = Number(detectado.precio_entrada_usd_por_millon) !== Number(filaActual.precio_entrada_usd_por_millon);
      const cambioSalida = Number(detectado.precio_salida_usd_por_millon) !== Number(filaActual.precio_salida_usd_por_millon);

      if (!cambioEntrada && !cambioSalida) {
        await supabase
          .from('precios_ia_modelo')
          .update({ verificado_at: new Date().toISOString() })
          .eq('proveedor', filaActual.proveedor)
          .eq('modelo', filaActual.modelo)
          .eq('vigente_desde', filaActual.vigente_desde);
        continue;
      }

      await supabase.from('cambios_precio_ia_pendientes').insert({
        proveedor: filaActual.proveedor,
        modelo: filaActual.modelo,
        precio_entrada_actual: filaActual.precio_entrada_usd_por_millon,
        precio_salida_actual: filaActual.precio_salida_usd_por_millon,
        precio_entrada_detectado: detectado.precio_entrada_usd_por_millon,
        precio_salida_detectado: detectado.precio_salida_usd_por_millon,
        fuente_url: urlFuente,
      });
    }
  }
}

import Anthropic from '@anthropic-ai/sdk';
import { registrarUsoIA } from './registrarUsoIA.js';
import { TRATO_IA } from './tratoIA.js';

// IA Nivel 1 (Reporte inteligente) — prompt exacto de docs/AI_PROMPTS.md, no reformular acá
// sin actualizar ese archivo primero (el contrato JSON está acoplado a las columnas de
// `reportes`, ver DATA_MODEL.md). Mismo patrón de cliente perezoso que importacionIA.js.

const MODELO = 'claude-sonnet-5';

const SYSTEM_PROMPT = `Este asistente estructura reportes de cuidado domiciliario.
El Asistente envía un texto libre describiendo la guardia.
Se extrae y se estructura la información en formato JSON con estos campos:
{
  "alimentacion": { "descripcion": string, "porcentaje_consumido": number|null },
  "medicacion": [{ "nombre": string, "hora": string, "via": string }],
  "signos_vitales": { "presion": string|null, "temperatura": string|null, "saturacion": string|null, "glucemia": string|null },
  "estado_animo": "muy_bien"|"bien"|"regular"|"mal"|"muy_mal"|null,
  "incidentes": string|null,
  "observaciones": string|null
}
Si no se menciona algún dato, se devuelve null para ese campo.
Se responde SOLO con el JSON, sin texto adicional.

${TRATO_IA}
Alcanza a los campos que lee una persona: "incidentes", "observaciones" y
"alimentacion.descripcion".`;

let cliente = null;
function obtenerCliente() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cliente) cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cliente;
}

const ESTRUCTURA_VACIA = {
  alimentacion: null,
  medicacion: [],
  signos_vitales: null,
  estado_animo: null,
  incidentes: null,
  observaciones: null,
};

// Nunca loguea texto_libre ni el JSON de salida (regla 7 CLAUDE.md — dato de salud del
// paciente) — ni siquiera en el catch de error de parseo.
export async function estructurarReporteIA(textoLibre, prestadoraId) {
  const anthropic = obtenerCliente();
  if (!anthropic) {
    return { ...ESTRUCTURA_VACIA, observaciones: textoLibre || null, _sinIA: true };
  }

  const respuesta = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: textoLibre }],
  });

  registrarUsoIA({ prestadoraId, modulo: 'reporte', modelo: MODELO, respuestaAnthropic: respuesta });

  const texto = respuesta.content?.[0]?.type === 'text' ? respuesta.content[0].text : '';

  try {
    const parseado = JSON.parse(texto);
    return {
      alimentacion: parseado.alimentacion ?? null,
      medicacion: Array.isArray(parseado.medicacion) ? parseado.medicacion : [],
      signos_vitales: parseado.signos_vitales ?? null,
      estado_animo: parseado.estado_animo ?? null,
      incidentes: parseado.incidentes ?? null,
      observaciones: parseado.observaciones ?? null,
    };
  } catch {
    return { ...ESTRUCTURA_VACIA, observaciones: textoLibre || null, _sinIA: true };
  }
}

// Distancia entre dos puntos GPS (fórmula de Haversine), usada para el aviso de check-in
// fuera de rango — nunca bloquea (ver PRD_04_05_App_Servicio.md, flujo de Check-in punto 4).
export function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (v) => (v * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

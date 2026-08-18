import XLSX from 'xlsx';
import Anthropic from '@anthropic-ai/sdk';
import { registrarUsoIA } from './registrarUsoIA.js';
import { TRATO_IA } from './tratoIA.js';
import { IDENTIDAD } from '../config/identidadProducto.js';

// Fase 3 del plan "Terminar la Etapa 2 (Panel)" (importación masiva de datos con IA).
// Sigue el mismo patrón que backend/src/utils/iaWhatsapp.js: cliente de Anthropic con
// inicialización perezosa condicionada a ANTHROPIC_API_KEY, prompt que exige responder
// solo JSON, y un fallback seguro si la respuesta no es JSON válido o si falta la key
// (acá el fallback es proponer un mapeo vacío para que el Admin_prestadora lo arme a mano,
// nunca bloquear la importación por falta de IA).

const MODELO = 'claude-sonnet-5';

// Campos destino disponibles para el mapeo, por tipo — reflejan exactamente lo que
// panel/src/pages/familias/NuevoPacienteModal.jsx, EditarPacienteModal.jsx y
// crearAsistenteDirecto()/crearFamiliaDirecta() (backend/src/utils/cuentasPanel.js) aceptan.
// Se excluye `medicacion_habitual` de Paciente: es un array de objetos {nombre, dosis,
// frecuencia} que no mapea a una sola columna de planilla — queda para cargar después
// desde la ficha de la Familia, no como parte de este import (ver docs/PENDIENTES.md).
export const CAMPOS_IMPORTACION = {
  asistente: [
    'nombre', 'telefono', 'email', 'dni', 'tipo_asistente', 'zonas',
    'tipo_vinculo', 'categoria_cct', 'valor_hora', 'sueldo_basico', 'horas_semanales',
  ],
  familia: [
    'nombreContacto', 'telefono', 'email', 'localidad', 'plan',
    'nombrePaciente', 'domicilioPaciente', 'fechaNacimientoPaciente',
    'nivelComplejidadPaciente', 'patologiasPaciente',
  ],
};

// Capa 1 (formato conocido): cualquier formato que `xlsx` ya sepa leer — XLSX/XLSM/XLSB/XLS,
// ODS, XML SpreadsheetML, CSV/TSV/TXT delimitado, DIF, SYLK, DBF, WK1/WK3 — se acepta sin
// código nuevo, `XLSX.read` autodetecta el formato por firma de archivo, no hace falta un
// flag por extensión.
export function parsearArchivo(buffer, nombreArchivo) {
  // codepage 65001 (UTF-8) explícito: sin esto, un CSV en UTF-8 sin BOM (el caso normal al
  // exportar desde Excel/Sheets en español) se interpreta con acentos/ñ corrompidos —
  // encontrado en la verificación de esta fase con una planilla de prueba real.
  const libro = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
  if (filas.length === 0) {
    throw new Error('El archivo no tiene filas de datos');
  }
  const headers = Object.keys(filas[0]);
  return { headers, filas };
}

// Sigue dentro de Capa 1 (formato conocido, sin IA): dump SQL estándar de una tabla, del
// tipo `INSERT INTO tabla (col1, col2, ...) VALUES (v1, v2, ...), (...), ...;` — lo que
// exportan por defecto pgAdmin/phpMyAdmin/mysqldump con "solo datos". No interpreta CREATE
// TABLE ni tipos — si el archivo no calza con este patrón devuelve null, sin lanzar error,
// para que el caller seleccione la Capa 2 (juicio de viabilidad IA) en vez de fallar en seco.
export function intentarParsearSQL(buffer) {
  const texto = buffer.toString('utf8');
  const regexInsert = /INSERT\s+INTO\s+[`"[\]\w.]+\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+?);/gi;
  const columnas = [];
  const filas = [];

  let matchInsert;
  while ((matchInsert = regexInsert.exec(texto)) !== null) {
    const headers = matchInsert[1].split(',').map((c) => c.trim().replace(/^[`"[]|[`"\]]$/g, ''));
    if (columnas.length === 0) columnas.push(...headers);

    const bloqueValores = matchInsert[2];
    const regexTupla = /\(([^()]*)\)/g;
    let matchTupla;
    while ((matchTupla = regexTupla.exec(bloqueValores)) !== null) {
      const valores = matchTupla[1]
        .split(',')
        .map((v) => v.trim().replace(/^'(.*)'$/s, '$1').replace(/''/g, "'"))
        .map((v) => (v.toUpperCase() === 'NULL' ? '' : v));
      if (valores.length !== headers.length) continue;
      const fila = {};
      headers.forEach((h, i) => { fila[h] = valores[i]; });
      filas.push(fila);
    }
  }

  if (columnas.length === 0 || filas.length === 0) return null;
  return { headers: columnas, filas };
}

const SYSTEM_PROMPT_VIABILIDAD = `Este asistente decide si un archivo, subido por una
Prestadora de cuidado domiciliario a ${IDENTIDAD.nombre} para importación masiva de Asistentes o
Familias/Pacientes, se puede interpretar como una tabla de datos con certeza suficiente de
no producir una importación incorrecta. El archivo no es un Excel/CSV/planilla estándar ni
un dump SQL reconocible (esos casos ya se resolvieron antes de llegar acá) — puede ser JSON,
XML, texto de ancho fijo, u otro formato exportado por un sistema de terceros.

Si no hay garantía razonable de qué valor de cada fila corresponde a qué columna, se marca
viable=false y se explica el motivo en una frase — nunca se inventa una estructura de columnas
que no esté claramente presente en la muestra.

${TRATO_IA}
Alcanza a "motivo", que se muestra en pantalla a quien subió el archivo.

Se responde únicamente con un JSON de esta forma, sin texto adicional:
{"viable": true|false, "motivo": "texto breve", "headers": ["col1", "col2", ...], "filas": [{"col1": "valor", ...}, ...]}
Si viable=false, "headers" y "filas" quedan como arrays vacíos.`;

// Capa 2: juicio de viabilidad de IA para formatos que no calzaron con la Capa 1 (ni
// `xlsx` ni el parser de dump SQL). Fallback seguro ante falta de API key o respuesta
// inválida: nunca inventa datos, rechaza la importación y pide un formato conocido.
export async function evaluarViabilidadIA({ tipo, nombreArchivo, buffer, prestadoraId }) {
  const anthropic = obtenerCliente();
  if (!anthropic) {
    return {
      viable: false,
      motivo: 'ANTHROPIC_API_KEY no configurada — hace falta subir el archivo en Excel, CSV o un dump SQL estándar',
      headers: [],
      filas: [],
    };
  }

  const muestraTexto = buffer.toString('utf8').slice(0, 8000);
  const mensaje = `Tipo de importación: ${tipo}
Nombre del archivo: ${nombreArchivo}
Contenido del archivo (puede estar truncado a los primeros 8000 caracteres):
${muestraTexto}`;

  const respuesta = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 4000,
    system: SYSTEM_PROMPT_VIABILIDAD,
    messages: [{ role: 'user', content: mensaje }],
  });

  registrarUsoIA({ prestadoraId, modulo: 'importacion_viabilidad', modelo: MODELO, respuestaAnthropic: respuesta });

  const texto = respuesta.content?.[0]?.type === 'text' ? respuesta.content[0].text : '';
  try {
    const parseado = JSON.parse(texto);
    if (!parseado.viable) {
      return { viable: false, motivo: parseado.motivo || 'La IA determinó que no es viable importar este archivo con certeza', headers: [], filas: [] };
    }
    if (!Array.isArray(parseado.headers) || !Array.isArray(parseado.filas) || parseado.filas.length === 0) {
      return { viable: false, motivo: 'La IA no devolvió filas interpretables — conviene probar con un formato conocido (Excel, CSV, dump SQL)', headers: [], filas: [] };
    }
    return { viable: true, motivo: parseado.motivo || '', headers: parseado.headers, filas: parseado.filas };
  } catch {
    return { viable: false, motivo: 'La IA no devolvió una respuesta válida — conviene probar con un formato conocido (Excel, CSV, dump SQL)', headers: [], filas: [] };
  }
}

const SYSTEM_PROMPT = `Este asistente ayuda a mapear columnas de una planilla (Excel/CSV)
subida por una Prestadora de cuidado domiciliario a los campos internos del sistema ${IDENTIDAD.nombre},
para importar Asistentes (cuidadores) o Familias/Pacientes en forma masiva. Cada Prestadora
nombra sus columnas distinto (puede venir en español, con abreviaturas, en otro orden, con
columnas de más que no aplican). La tarea es proponer, para cada columna del archivo, a qué
campo interno corresponde (o null si no aplica a ninguno), y marcar advertencias sobre datos
que parezcan faltantes, ambiguos o de formato dudoso mirando las filas de muestra.

${TRATO_IA}
Alcanza a "advertencias", que se muestran en pantalla a quien subió la planilla.

Se responde únicamente con un JSON de esta forma, sin texto adicional:
{"mapeo": {"columna_del_archivo": "campo_interno_o_null", ...}, "advertencias": ["texto breve", ...]}`;

let cliente = null;
function obtenerCliente() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cliente) cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cliente;
}

export async function proponerMapeoIA({ tipo, headers, filasMuestra, prestadoraId }) {
  const camposDisponibles = CAMPOS_IMPORTACION[tipo];
  const anthropic = obtenerCliente();
  if (!anthropic) {
    return {
      mapeo: Object.fromEntries(headers.map((h) => [h, null])),
      advertencias: ['ANTHROPIC_API_KEY no configurada — hace falta revisar y completar el mapeo a mano antes de confirmar'],
    };
  }

  const mensaje = `Tipo de importación: ${tipo}
Campos internos disponibles: ${camposDisponibles.join(', ')}
Columnas del archivo: ${headers.join(', ')}
Primeras filas de muestra (JSON): ${JSON.stringify(filasMuestra.slice(0, 5))}`;

  const respuesta = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: mensaje }],
  });

  registrarUsoIA({ prestadoraId, modulo: 'importacion', modelo: MODELO, respuestaAnthropic: respuesta });

  const texto = respuesta.content?.[0]?.type === 'text' ? respuesta.content[0].text : '';

  try {
    const parseado = JSON.parse(texto);
    const mapeo = Object.fromEntries(
      headers.map((h) => {
        const campo = parseado.mapeo?.[h];
        return [h, camposDisponibles.includes(campo) ? campo : null];
      })
    );
    return { mapeo, advertencias: Array.isArray(parseado.advertencias) ? parseado.advertencias : [] };
  } catch {
    return {
      mapeo: Object.fromEntries(headers.map((h) => [h, null])),
      advertencias: ['La IA no devolvió un mapeo válido — hace falta revisar y completar el mapeo a mano antes de confirmar'],
    };
  }
}

/* REGISTRO DE INDICACIONES DEL DESARROLLADOR
   ==========================================

   Para qué sirve: sacar de los registros de las sesiones TODO lo que escribió el
   Desarrollador, en orden y con fecha, y dejarlo en un archivo de texto que él pueda
   abrir y leer solo, sin depender de que Claude Code se acuerde de nada.

   Por qué existe: el 2026-08-03 apareció que una indicación hablada tiempo atrás —el
   pase de guardia por QR— nunca había quedado registrada en `docs/PENDIENTES.md`.
   Existía como tarea de sesión, y las tareas de sesión se borran cuando la sesión se
   cierra. La memoria de Claude Code no es un lugar donde guardar cosas. El registro de
   la conversación sí lo es, y este archivo lo convierte en algo legible.

   Cómo se usa, parado en `productos/aurevia`:

       node herramientas/registro-de-indicaciones.mjs

   Deja el resultado en `No hacer commit/indicaciones-del-desarrollador.txt`.

   POR QUÉ EL RESULTADO VA A "No hacer commit" Y NO AL REPOSITORIO:
   en las conversaciones hay claves, enlaces de acceso y direcciones pegadas a mano. El
   archivo de salida las arrastra tal cual. Esa carpeta está excluida de git (ver
   `.gitignore` y la regla 9 de `CLAUDE.md`), así que el texto queda en la máquina y no
   se sube a ninguna parte. El programa —este archivo— no tiene nada sensible adentro y
   sí se versiona.
*/

import fs from 'node:fs';
import path from 'node:path';

// Donde Claude Code guarda el registro de cada sesión de este proyecto.
const CARPETA_SESIONES = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.claude',
  'projects',
  'F--proyectos-celtatech',
);

const SALIDA = path.join('No hacer commit', 'indicaciones-del-desarrollador.txt');

if (!fs.existsSync(CARPETA_SESIONES)) {
  console.error('No encuentro la carpeta de sesiones:', CARPETA_SESIONES);
  process.exit(1);
}

const archivos = fs.readdirSync(CARPETA_SESIONES).filter((f) => f.endsWith('.jsonl'));
const mensajes = [];

for (const archivo of archivos) {
  const lineas = fs.readFileSync(path.join(CARPETA_SESIONES, archivo), 'utf8').split('\n');
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    let registro;
    try {
      registro = JSON.parse(linea);
    } catch {
      continue; // línea cortada por la mitad: se saltea
    }
    if (registro.type !== 'user') continue;

    const contenido = registro.message?.content;
    let texto = '';
    if (typeof contenido === 'string') texto = contenido;
    else if (Array.isArray(contenido)) {
      // Solo lo que tecleó una persona. Se descarta lo que devolvieron las herramientas.
      texto = contenido.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
    }
    texto = texto.trim();
    if (!texto) continue;

    // Ruido del sistema disfrazado de mensaje del usuario.
    if (texto.startsWith('<')) continue;
    if (texto.startsWith('Caveat:')) continue;
    if (texto.startsWith('This session is being continued')) continue;
    if (texto.includes('[Request interrupted')) continue;

    mensajes.push({ fecha: (registro.timestamp || '').slice(0, 10), texto });
  }
}

/* Una misma conversación puede quedar partida en dos archivos cuando se retoma, así que
   el mismo mensaje aparece dos veces. Se queda la primera aparición de cada texto. */
const vistos = new Set();
const unicos = mensajes.filter((m) => {
  const huella = m.fecha + '|' + m.texto;
  if (vistos.has(huella)) return false;
  vistos.add(huella);
  return true;
});

unicos.sort((a, b) => a.fecha.localeCompare(b.fecha));

const encabezado = [
  'INDICACIONES DEL DESARROLLADOR — todo lo que escribió, en orden.',
  `Generado el ${new Date().toISOString().slice(0, 10)} a partir de ${archivos.length} archivo(s) de sesión.`,
  `${unicos.length} mensajes.`,
  '',
  'ESTE ARCHIVO NO SE SUBE A NINGUNA PARTE: puede tener claves pegadas a mano.',
  '',
  '='.repeat(78),
  '',
].join('\n');

const cuerpo = unicos.map((m, i) => `### ${i + 1} · ${m.fecha}\n${m.texto}`).join('\n\n');

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, encabezado + cuerpo, 'utf8');

console.log(`Mensajes del Desarrollador: ${unicos.length}`);
console.log(`Archivos de sesión leídos: ${archivos.length}`);
console.log(`Escrito en: ${SALIDA}`);

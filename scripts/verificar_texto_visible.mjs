// ---------------------------------------------------------------------------
// verificar_texto_visible.mjs — el guardarraíl de la regla 1 del §7 de CLAUDE.md
//
// Uso, desde la raíz del repo:
//   node scripts/verificar_texto_visible.mjs
//
// Revisa tres cosas y devuelve código de salida 1 si alguna falla:
//
//   1. TEXTO ESCRITO A MANO. Que ninguna pantalla tenga una frase escrita
//      directamente en el código en lugar de salir del archivo de traducciones.
//      Una frase así se ve igual que cualquier otra, pero existe en un solo
//      idioma: quien mire el producto en inglés o en portugués encuentra un
//      castellano suelto en el medio.
//
//   2. TRATO. Que ningún texto visible tutee a quien lo lee. En castellano:
//      nada de "vos", "podés", "revisá", "tu cuenta". En portugués: nada de
//      "tu", "teu", "tua", ni "o senhor / a senhora". Quien lee es una
//      institución que evalúa o paga un software, o una Familia que confió a
//      alguien suyo a esa institución — no un conocido.
//
//   3. TRATO EN LOS TEXTOS GUARDADOS EN LA BASE. Lo mismo que la revisión 2, pero
//      para el texto visible que no está en ningún archivo del repositorio: la
//      advertencia legal, el consentimiento que se firma, el catálogo de módulos.
//      Se consulta la base real —no los archivos de migración, que dicen lo que se
//      cargó aquel día y no lo que la gente lee hoy— y únicamente el texto que
//      escribió la plataforma, nunca lo que escribió una Prestadora ni un dato de
//      una persona (el porqué está escrito arriba de la lista, más abajo).
//
// POR QUÉ EXISTE. Las dos reglas estaban escritas en CLAUDE.md desde siempre y
// las dos se violaron igual, porque solo las controlaba una persona leyendo. La
// primera apareció el 2026-08-16 en cuatro lugares ("Cargando…" escrito a mano
// en las dos aplicaciones, y el título del Panel en la pestaña del navegador).
// La segunda costó cinco tareas enteras de corrección. Una regla que solo se
// comprueba leyendo se rompe sola con el tiempo; una que corta el build, no.
//
// CUANDO ESTE PROGRAMA FALLA hay exactamente dos respuestas correctas:
//   - corregir el texto, o
//   - si el programa se equivocó, agregar la palabra a la lista de excepciones
//     de acá abajo, con su motivo escrito al lado.
// Nunca apagar el control.
//
// LO QUE NO REVISA, a propósito: los dos son coladores de patrones, no
// entienden lo que leen. Atrapan lo que se repite —una frase entre etiquetas,
// una terminación verbal—, no un texto mal redactado ni una traducción floja.
// Que pase esto no reemplaza leer lo que se escribió.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Las tres aplicaciones que ve un cliente. `sitio-web/` no entra en la revisión 1
   porque es una página estática de una sola pieza, sin archivo de traducciones:
   ahí el texto en el HTML no es una violación sino el diseño. Sí entra en la
   revisión 2, que es la del trato. */
const APPS = ['panel', 'pwa-familias', 'pwa-asistentes'];

/* Archivos que hablan solamente con quien programa, nunca con un cliente. La
   pantalla de muestra del Panel está montada bajo `import.meta.env.DEV`, así que
   no existe en el producto publicado. */
const SOLO_PARA_DESARROLLO = [
  'panel/src/pages/Muestra.jsx',
  'panel/src/pages/MuestraEstadoActual.jsx',
];

/* Archivos cuyos textos son instrucciones dirigidas a un modelo de inteligencia
   artificial, no frases para que las lea una persona.

   Lo que el modelo *responde* sí lo lee una persona, y eso este programa no lo puede
   revisar: esa frase no existe en ningún archivo hasta que el modelo contesta. Por eso
   la regla del trato se le dice al modelo adentro de la instrucción, escrita una sola
   vez en `backend/src/utils/tratoIA.js`, que los cuatro prompts insertan. Ese archivo
   entra en esta lista justamente porque nombra las formas prohibidas para prohibirlas
   —dice "nunca 'vos', 'podés'"—, y el colador, que no entiende lo que lee, las
   marcaría como si las estuviera usando.

   Si alguna vez se saca una instrucción de esta lista, el control la va a marcar por
   las palabras del bloque de trato, no por un error. */
const INSTRUCCIONES_PARA_LA_IA = [
  'backend/src/utils/alertasIA.js',
  'backend/src/utils/iaWhatsapp.js',
  'backend/src/utils/importacionIA.js',
  'backend/src/utils/reporteIA.js',
  'backend/src/utils/tratoIA.js',
  'backend/src/utils/verificarPreciosIA.js',
];

// ---------------------------------------------------------------------------
// Recorrido de archivos
// ---------------------------------------------------------------------------

function archivosDe(dir, extensiones) {
  if (!existsSync(dir)) return [];
  const salida = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivosDe(ruta, extensiones));
    else if (extensiones.includes(extname(nombre))) salida.push(ruta);
  }
  return salida;
}

const rutaCorta = (ruta) => relative(RAIZ, ruta).replaceAll('\\', '/');

/* Los comentarios se sacan antes de revisar nada: están escritos para quien lee el
   código, no para quien usa el producto, y no tienen por qué respetar ni una regla
   ni la otra. Las líneas se conservan (se reemplaza por líneas vacías) para que el
   número de línea que se informa siga siendo el verdadero. */
function sinComentarios(texto) {
  const vaciar = (m) => m.replace(/[^\n]/g, ' ');
  return texto
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, vaciar) // {/* … */} de JSX
    .replace(/\/\*[\s\S]*?\*\//g, vaciar) //           /* … */
    .replace(/^([ \t]*)\/\/.*$/gm, (m) => vaciar(m)); //  // … a principio de línea
}

// ---------------------------------------------------------------------------
// Revisión 1 — texto escrito a mano en una pantalla
// ---------------------------------------------------------------------------

/* Una frase entre etiquetas: `<span>Cargando…</span>`. Se descarta todo lo que
   tenga llaves, porque eso ya es código —`{t.comun.cargando}`, `{{producto}}`— y
   por lo tanto sale de las traducciones o de la identidad del producto.
   El `>` no puede venir de una flecha `=>` ni de una comparación, y después del `<`
   tiene que empezar una etiqueta de verdad y no un `<=`: sin esas dos condiciones,
   `findIndex((fin) => fin <= arranca)` se lee como si "fin" fuera una frase. */
const RE_ENTRE_ETIQUETAS = /(?<![=<>!-])>[\s]*([^<>{}\n]*?\p{L}{3,}[^<>{}\n]*?)[\s]*<(?=[/a-zA-Z])/gu;

/* Los atributos que la persona igual termina leyendo o escuchando: el texto gris
   de un campo vacío, el cartelito al pasar el mouse, lo que dice el lector de
   pantalla, la descripción de una imagen que no cargó. */
const RE_ATRIBUTO_VISIBLE = /\b(placeholder|title|aria-label|alt)\s*=\s*"([^"{}\n]*?\p{L}{3,}[^"{}\n]*?)"/gu;

/* Señales de que lo que se capturó es código y no una frase: una comparación
   (`n > 0 && lista.length < 5` deja `0 && lista.length` en el medio), una llamada
   a una función, un punto y coma. Ninguna frase de pantalla los tiene. */
const PARECE_CODIGO = /[=&|()[\];$`_]|=>|\.\w/;

/* Los dos brazos de un `condición ? esto : aquello` escrito entre etiquetas dejan
   restos que empiezan con dos puntos o con signo de pregunta. Ninguna frase de
   pantalla empieza así, ni lleva un signo de pregunta suelto entre espacios. */
const PARECE_CONDICION = /^[:?]|\s\?\s/;

/* Un número romano es el mismo en los tres idiomas: es un valor de una lista
   (Grado I, II, III), no una frase para traducir. */
const ES_NUMERO_ROMANO = /^[IVXLCDM]{1,6}$/;

/* Palabras sueltas que son valores del sistema, no frases: aparecen entre
   etiquetas en tablas y listas. Se comparan en minúsculas y sin acentos. */
const NO_ES_FRASE = new Set(['null', 'undefined', 'true', 'false', 'nan']);

function revisarTextoAMano() {
  const hallazgos = [];

  const archivos = [
    ...APPS.flatMap((app) => archivosDe(join(RAIZ, app, 'src'), ['.jsx'])),
    ...APPS.map((app) => join(RAIZ, app, 'index.html')).filter(existsSync),
  ];

  for (const ruta of archivos) {
    const corta = rutaCorta(ruta);
    if (SOLO_PARA_DESARROLLO.includes(corta)) continue;

    const contenido = sinComentarios(readFileSync(ruta, 'utf8'));
    const lineaDe = (indice) => contenido.slice(0, indice).split('\n').length;

    for (const [re, grupo] of [[RE_ENTRE_ETIQUETAS, 1], [RE_ATRIBUTO_VISIBLE, 2]]) {
      re.lastIndex = 0;
      for (const m of contenido.matchAll(re)) {
        const frase = m[grupo].trim();
        if (!frase || PARECE_CODIGO.test(frase) || PARECE_CONDICION.test(frase)) continue;
        if (ES_NUMERO_ROMANO.test(frase)) continue;
        if (NO_ES_FRASE.has(frase.toLowerCase())) continue;
        hallazgos.push({ archivo: corta, linea: lineaDe(m.index), frase });
      }
    }
  }

  return hallazgos;
}

// ---------------------------------------------------------------------------
// Revisión 2 — el trato
// ---------------------------------------------------------------------------

/* Se revisan únicamente los textos entre comillas. Es lo que se le muestra a
   alguien; todo lo demás es código. Así el control vale igual para el archivo de
   traducciones, para un mensaje que arma el motor y para un atributo suelto, sin
   tener que saber de antemano dónde vive cada texto. */
const RE_TEXTOS_ENTRE_COMILLAS = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

/* Formas de tuteo que se nombran una por una, porque no siguen ninguna regla de
   terminación que se pueda reconocer sola. */
const FORMAS_DIRECTAS = [
  // Castellano — pronombres y posesivos
  'vos', 'tu', 'tus', 'ti', 'te', 'contigo', 'tuyo', 'tuya', 'tuyos', 'tuyas',
  /* Castellano — verbos irregulares que no terminan en -ás/-és/-ís. No se listan
     "das" ni "anda": en portugués son "das" (de las) y "anda junto", palabras
     corrientes que aparecen a cada rato y no tienen nada que ver con el trato. */
  'sos', 'vas', 'ves', 'oís',
  // Castellano — órdenes (imperativo de vos)
  'andá', 'mirá', 'fijate', 'acordate', 'dale', 'revisá', 'elegí', 'escribí',
  'poné', 'hacé', 'tocá', 'apretá', 'cargá', 'guardá', 'probá', 'volvé', 'sacá',
  'borrá', 'activá', 'desactivá', 'ingresá', 'completá', 'seleccioná', 'confirmá',
  'verificá', 'contá', 'pedí', 'abrí', 'cerrá', 'agregá', 'sumá', 'enviá', 'marcá',
  'usá', 'dejá', 'esperá', 'seguí', 'buscá', 'llená', 'avisá', 'mandá', 'subí',
  // Portugués — pronombres y posesivos informales
  'teu', 'tua', 'teus', 'tuas',
  // Portugués — el trato que obliga a adivinar el género de quien lee
  'o senhor', 'a senhora', 'ao senhor', 'à senhora',
];

/* La regla de terminación: en castellano, casi todo el presente del tuteo termina
   en -ás, -és o -ís (tenés, podés, querés, sabés, decís, escribís, estás). Es la
   red que atrapa las formas que no están en la lista de arriba. */
/* Los bordes de palabra se escriben a mano en vez de usar `\b`. Motivo: para una
   expresión regular, `\b` solo reconoce como letras las del alfabeto inglés, así que
   una palabra terminada en vocal acentuada —"revisá", "elegí"— no tiene borde al
   final y no se encuentra nunca. Con `á` y `ñ` de por medio, `\b` no sirve.
   El guion también corta: en portugués el infinitivo con pronombre pegado se acentúa
   igual que una orden en voseo —"marcá-lo", "revisá-la", "ativá-la"— y es correcto. */
const BORDE_IZQ = '(?<![\\p{L}\\p{N}_])';
const BORDE_DER = '(?![\\p{L}\\p{N}_-])';

const RE_TERMINACION = new RegExp(`${BORDE_IZQ}(\\p{L}{2,}(?:ás|és|ís))${BORDE_DER}`, 'giu');

/* Palabras que terminan igual y no son tuteo. Cada una está acá porque el colador
   la marcó alguna vez y no correspondía. */
const TERMINACION_PERMITIDA = new Set([
  'más', 'además', 'jamás', 'quizás', 'atrás', 'detrás', 'demás', 'compás', 'gas',
  'después', 'inglés', 'francés', 'portugués', 'interés', 'cortés', 'revés', 'través',
  'mes', 'país', 'raíz', 'anís', 'gris', 'aprés',
]);

const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/* Un texto que no tiene ni una letra acentuada ni una eñe ni una palabra corriente
   del castellano o del portugués casi seguro es un valor del sistema
   ('created_at', 'pending'), no una frase para leer. No se revisa. */
function pareceFraseParaLeer(texto) {
  if (texto.trim().split(/\s+/).length < 2) return false; // una sola palabra: es un valor
  if (/^[a-z0-9_.\-/]+$/.test(texto)) return false; //        clave técnica o ruta
  return /\p{L}{3,}/u.test(texto);
}

const RE_DIRECTAS = new RegExp(`${BORDE_IZQ}(${FORMAS_DIRECTAS.join('|')})${BORDE_DER}`, 'giu');

/* El colador de una frase suelta. Vive aparte porque lo usan las dos revisiones que
   miran el trato: la que lee los archivos del repositorio y la que lee los textos
   guardados en la base. Es la misma regla, así que es una sola función y no dos
   iguales (regla 12 del §7 de CLAUDE.md). Devuelve las palabras que encontró, o una
   lista vacía si el texto está bien. */
function tuteosEnElTexto(texto) {
  if (!pareceFraseParaLeer(texto)) return [];
  const encontradas = new Set();

  RE_DIRECTAS.lastIndex = 0;
  for (const m of texto.matchAll(RE_DIRECTAS)) encontradas.add(m[1].toLowerCase());

  RE_TERMINACION.lastIndex = 0;
  for (const m of texto.matchAll(RE_TERMINACION)) {
    const palabra = m[1].toLowerCase();
    if (TERMINACION_PERMITIDA.has(palabra)) continue;
    if (TERMINACION_PERMITIDA.has(sinAcentos(palabra))) continue;
    encontradas.add(palabra);
  }

  return [...encontradas];
}

const recortar = (texto) => (texto.length > 90 ? `${texto.slice(0, 90)}…` : texto);

function revisarTrato() {
  const hallazgos = [];

  const archivos = [
    ...archivosDe(join(RAIZ, 'backend', 'src'), ['.js']),
    ...APPS.flatMap((app) => archivosDe(join(RAIZ, app, 'src'), ['.js', '.jsx'])),
    ...APPS.map((app) => join(RAIZ, app, 'index.html')).filter(existsSync),
    join(RAIZ, 'sitio-web', 'index.html'),
  ].filter(existsSync);

  for (const ruta of archivos) {
    const corta = rutaCorta(ruta);
    if (SOLO_PARA_DESARROLLO.includes(corta)) continue;
    if (INSTRUCCIONES_PARA_LA_IA.includes(corta)) continue;

    const contenido = sinComentarios(readFileSync(ruta, 'utf8'));
    const lineaDe = (indice) => contenido.slice(0, indice).split('\n').length;

    /* El HTML no tiene comillas alrededor de sus frases: ahí se revisa el texto
       que queda entre etiquetas. En los archivos de código, los textos entre
       comillas. */
    const esHtml = corta.endsWith('.html');
    const trozos = [];
    if (esHtml) {
      for (const m of contenido.matchAll(/>([^<>]*)</g)) trozos.push({ texto: m[1], indice: m.index });
    } else {
      for (const m of contenido.matchAll(RE_TEXTOS_ENTRE_COMILLAS)) {
        trozos.push({ texto: m[1] ?? m[2] ?? m[3] ?? '', indice: m.index });
      }
    }

    for (const { texto, indice } of trozos) {
      const encontradas = tuteosEnElTexto(texto);
      if (encontradas.length === 0) continue;
      hallazgos.push({
        archivo: corta,
        linea: lineaDe(indice),
        palabras: encontradas.join(', '),
        frase: recortar(texto),
      });
    }
  }

  return hallazgos;
}

// ---------------------------------------------------------------------------
// Revisión 3 — el trato en los textos guardados en la base
// ---------------------------------------------------------------------------

/* Hay texto visible que no está en ningún archivo del repositorio: vive en la base,
   porque la regla 1 del §7 de CLAUDE.md prohíbe escribirlo en el código. La
   advertencia legal que se muestra al activar una función riesgosa, el consentimiento
   que firma el Asistente, los nombres del catálogo de módulos: todos salen de una
   tabla. Las dos revisiones de arriba no los ven, y por eso se escaparon dos: la
   advertencia legal (corregida el 2026-08-16) y el consentimiento de seguimiento de
   ubicación (corregido el 2026-08-18). A los dos los encontró una persona mirando la
   pantalla, que es exactamente lo que este programa existe para no depender.

   SE CONSULTA LA BASE, NO LOS ARCHIVOS DE MIGRACIÓN. Un archivo de migración dice lo
   que se cargó aquel día; la base dice lo que la gente lee hoy. Es lo mismo que manda
   el §12 de CLAUDE.md para cualquier afirmación sobre el estado real.

   QUÉ SE MIRA Y QUÉ NO. Únicamente el texto que escribió la plataforma: el catálogo
   general que viene con el producto. Nunca una fila que escribió una Prestadora, y
   nunca un dato de una persona. El motivo no es de estilo: este programa imprime en
   pantalla lo que encuentra, y esa pantalla queda guardada en el registro público de
   la publicación. Un reporte diario, una observación, el nombre de un Paciente son
   datos de salud y datos personales — volcarlos ahí sería la violación del §6 de
   CLAUDE.md más grande de todo el proyecto. Por eso la lista de abajo se escribe a
   mano, tabla por tabla, y no se arma sola recorriendo el esquema.

   El corte entre las dos cosas es la columna `prestadora_id`: donde no existe, la
   tabla entera es de la plataforma; donde existe, son nuestras solamente las filas
   que la tienen vacía, que son las del catálogo general. */
const TEXTOS_DE_LA_PLATAFORMA = [
  // La advertencia que se muestra al activar una función con riesgo legal (§3).
  { tabla: 'advertencias_legales', señal: "jurisdiccion || ' / ' || funcion_clave", columnas: ['texto_advertencia'] },
  // Lo que lee y acepta un Asistente o una Familia antes de que se active algo.
  { tabla: 'textos_consentimiento', señal: "jurisdiccion || ' / ' || clave || ' / ' || idioma", columnas: ['titulo', 'cuerpo'] },
  // Los módulos del producto, tal como se ven en el Panel.
  { tabla: 'catalogo_modulos', señal: 'key', columnas: ['nombre', 'descripcion'] },
  // De acá para abajo, solo el catálogo general: `prestadora_id` vacío.
  { tabla: 'tipos_asistente', señal: 'clave', columnas: ['nombre', 'descripcion'], soloGeneral: true },
  { tabla: 'tareas_tipo_asistente', señal: 'clave', columnas: ['texto'], soloGeneral: true },
  { tabla: 'etapas_incorporacion_asistente', señal: 'clave', columnas: ['nombre'], soloGeneral: true },
  { tabla: 'configuracion_notificaciones', señal: 'evento', columnas: ['descripcion'], soloGeneral: true },
  { tabla: 'tipos_documento_asistente', señal: 'nombre', columnas: ['nombre'], soloGeneral: true },
];

/* Cómo se llega a la base. Con las variables puestas —así corre en la publicación,
   con las mismas claves que ya usa el respaldo diario— se entra derecho. Sin ellas
   —así corre en la máquina de quien programa— se entra por el contenedor local, que
   tiene usuario y contraseña fijos y conocidos, no son un secreto. */
function consultarBase(consulta) {
  const opciones = { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 };
  if (process.env.DB_HOST) {
    const { DB_HOST, DB_PORT = '5432', DB_NAME = 'postgres', DB_USER = 'postgres', DB_PASSWORD } = process.env;
    return execFileSync(
      'psql',
      [`postgresql://${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`, '-At', '-v', 'ON_ERROR_STOP=1', '-c', consulta],
      { ...opciones, env: { ...process.env, PGPASSWORD: DB_PASSWORD, PGCONNECT_TIMEOUT: '15' } },
    );
  }
  /* El contenedor local se llama `supabase_db_<proyecto>`, y ese `<proyecto>` sale de
     `supabase/config.toml`, que es quien se lo puso. Se lee de ahí y no se escribe a mano:
     es un solo lugar donde está la verdad (regla 12 del §7 de CLAUDE.md) y, además, ese
     nombre quedó fijado cuando se creó la base local y no se renombra aunque cambie la
     marca (regla 13). */
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const proyecto = config.match(/^\s*project_id\s*=\s*"([^"]+)"/m)?.[1];
  if (!proyecto) throw new Error('No encontré project_id en supabase/config.toml');

  return execFileSync(
    'docker',
    ['exec', '-i', `supabase_db_${proyecto}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', consulta],
    opciones,
  );
}

function revisarTextosDeLaBase() {
  /* Una sola consulta con todas las tablas pegadas una abajo de la otra, y el
     resultado en un solo bloque de JSON. Así el texto puede tener comillas, barras o
     renglones adentro sin romper la lectura. */
  const trozos = TEXTOS_DE_LA_PLATAFORMA.flatMap(({ tabla, señal, columnas, soloGeneral }) =>
    columnas.map(
      (columna) =>
        `select '${tabla}.${columna}' as origen, (${señal})::text as fila, ${columna} as texto ` +
        `from ${tabla} where ${columna} is not null${soloGeneral ? ' and prestadora_id is null' : ''}`,
    ),
  );
  const consulta = `select coalesce(json_agg(f), '[]')::text from (${trozos.join(' union all ')}) f;`;

  let filas;
  try {
    filas = JSON.parse(consultarBase(consulta).trim());
  } catch (e) {
    return { revisada: false, motivo: (e.stderr || e.message || String(e)).trim().split('\n').slice(-3).join('\n'), hallazgos: [] };
  }

  const hallazgos = [];
  for (const { origen, fila, texto } of filas) {
    const encontradas = tuteosEnElTexto(texto);
    if (encontradas.length === 0) continue;
    hallazgos.push({ archivo: origen, linea: fila, palabras: encontradas.join(', '), frase: recortar(texto) });
  }
  return { revisada: true, cuantos: filas.length, hallazgos };
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

function informar(titulo, hallazgos, formatear, explicacion) {
  if (hallazgos.length === 0) {
    console.log(`### ${titulo}: sin hallazgos`);
    return false;
  }
  console.log(`\n### ${titulo}: ${hallazgos.length} hallazgos`);
  for (const h of hallazgos) console.log(`  ${h.archivo}:${h.linea} — ${formatear(h)}`);
  console.log(`\n${explicacion}`);
  return true;
}

const aMano = revisarTextoAMano();
const trato = revisarTrato();
const base = revisarTextosDeLaBase();

const falla1 = informar(
  'Texto escrito a mano en una pantalla',
  aMano,
  (h) => `"${h.frase}"`,
  'Ese texto existe en un solo idioma. Va al archivo de traducciones, en los tres,\ny la pantalla lo toma de ahí (regla 1 y regla 2 del §7 de CLAUDE.md).',
);

const falla2 = informar(
  'Textos que tutean a quien los lee',
  trato,
  (h) => `${h.palabras}  →  "${h.frase}"`,
  'En castellano el texto visible va en forma impersonal, y usted cuando haya que\ndirigirse a una persona. En portugués, forma impersonal y "você" solo donde no\nquede otra (regla 1 del §7 de CLAUDE.md).',
);

/* Que no se llegue a la base es una falla cuando esto corre en la publicación: si se
   dejara pasar, el control se apagaría solo el día que cambie una clave y nadie se
   enteraría. En la máquina de quien programa solamente avisa, porque ahí el
   contenedor local puede estar apagado por cualquier motivo. */
let falla3 = false;
if (!base.revisada) {
  const enLaPublicacion = !!process.env.CI;
  console.log(`\n### Textos guardados en la base: no se pudo consultar\n${base.motivo}`);
  console.log(
    enLaPublicacion
      ? '\nSin base no hay control. Hace falta revisar las claves de conexión del automatismo.'
      : '\nAviso: los textos guardados en la base quedaron sin revisar. Para revisarlos hace\nfalta la base local encendida (`npx supabase start`). El automatismo de la\npublicación sí los revisa siempre.',
  );
  falla3 = enLaPublicacion;
} else {
  falla3 = informar(
    'Textos guardados en la base que tutean a quien los lee',
    base.hallazgos,
    (h) => `${h.palabras}  →  "${h.frase}"`,
    'Ese texto no está en ningún archivo: vive en la base y se corrige con una migración.\nEl mismo criterio que arriba — forma impersonal, y usted cuando haya que dirigirse a\nuna persona (regla 1 del §7 de CLAUDE.md).',
  );
  if (base.hallazgos.length === 0) console.log(`  (${base.cuantos} textos de la plataforma revisados)`);
}

process.exit(falla1 || falla2 || falla3 ? 1 : 0);

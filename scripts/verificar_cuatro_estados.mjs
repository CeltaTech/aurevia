// ---------------------------------------------------------------------------
// verificar_cuatro_estados.mjs — que toda pantalla que carga datos tenga los
// cuatro estados, y que su texto salga del catálogo
//
// Uso, desde la raíz del repo:
//   node scripts/verificar_cuatro_estados.mjs
//
// LOS CUATRO ESTADOS son cargando, error, vacío y listo. La regla de la empresa
// los pide en todo componente que carga datos, y el motivo es el de siempre: sin
// ellos, la pantalla que está esperando y la pantalla que falló se ven igual —en
// blanco—, y quien trabaja no sabe si esperar, reintentar o avisar.
//
// QUÉ REVISA
//   1. Que el punto único del Panel siga en su lugar y siga sacando sus cuatro
//      textos del catálogo. Es el componente que resuelve los cuatro estados de
//      una vez, y de él cuelgan la mayoría de las pantallas: si se le escribe un
//      texto a mano adentro, se le escribe a todas juntas.
//   2. Que ninguna pantalla escriba a mano el texto de un estado —«Cargando…»,
//      «No hay datos», «Loading»—. Eso es texto visible y sale del catálogo, o
//      la pantalla en inglés muestra una palabra en castellano.
//   3. Que toda pantalla que carga datos por su cuenta avise que está esperando,
//      diga cuando algo falló, y diga cuando no hay nada que mostrar.
//
// CÓMO SE DECIDE QUÉ PANTALLA SE MIRA, Y POR QUÉ ASÍ
//   - Se mira la que **espera datos**: tiene un `await` contra una puerta de
//     datos —la base o la red—. La que recibe todo ya resuelto por quien la
//     llama no tiene ningún estado que manejar.
//   - **Un proveedor trae y no muestra.** Los de `src/context/` cargan para los
//     demás; su deber no son los cuatro estados sino que el fallo le llegue a
//     quien sí muestra, y eso se revisa aparte, abajo.
//   - **El «vacío» se le pide sólo a quien dibuja una lista de lo que trajo**,
//     o sea a quien recorre una lista que él mismo guardó al cargar. Recorrer un
//     catálogo de opciones fijas no es lo mismo: esa lista nunca está vacía, y
//     pedirle un «no hay nada» a un desplegable de provincias es ruido.
//
// CÓMO SE EXCEPTÚA UN CASO LEGÍTIMO — acá, a la vista:
//   En `EXCEPTUADAS`, unos renglones más abajo, con el motivo escrito al lado.
//   Se pone la ruta del archivo y qué estado se le perdona. Hoy está vacía, y
//   ojalá siga así: si empieza a llenarse, lo que hay que revisar es por qué
//   tantas pantallas cargan datos por su cuenta en vez de colgarse del punto
//   único.
//
// CUANDO ESTE PROGRAMA FALLA
//   Dice el archivo y qué estado falta. Lo más corto casi siempre es envolver lo
//   que se dibuja en `<EstadoLista>`, que ya los resuelve los cuatro y ya saca su
//   texto del catálogo.
//
// LO QUE NO REVISA, A PROPÓSITO
//   - Si el estado se dibuja lindo. Comprueba que exista, no cómo se ve.
//   - Si el mensaje de error dice lo que corresponde: de eso se ocupa
//     `scripts/verificar_errores_hacia_afuera.mjs`.
//   - El backend, que no dibuja pantallas.
//   - **Si el proveedor que carga para los demás les pasa el fallo.** Es una
//     regla de verdad y hoy no se cumple —los proveedores de `src/context/`
//     dejan el dato en nulo, y quien lo recibe no puede distinguir «todavía no
//     llegó» de «falló»—, pero es otro problema y de otro tamaño: toca el
//     ingreso y a todas las pantallas que cuelgan de esos proveedores. Queda
//     escrito acá para que no se pierda, y no metido adentro de este chequeo,
//     que se ocupa de las pantallas.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const APLICACIONES = ['panel', 'pwa-familias', 'pwa-asistentes'];

// El punto único de los cuatro estados, y las claves del catálogo que tiene que
// nombrar. Si alguna deja de aparecer ahí adentro, ese estado se escribió a mano.
const PUNTO_UNICO = 'panel/src/components/layout/EstadoLista.jsx';
const CLAVES_DEL_PUNTO_UNICO = [
  't.comun.cargando',
  't.comun.error_generico',
  't.comun.reintentar',
  't.comun.sin_datos_titulo',
  't.comun.sin_resultados_titulo',
];

// Lo que no se abre nunca. Las primeras son cajas fuertes: no se leen ni para
// verificar algo.
const NO_SE_ABREN = new Set([
  'No hacer commit', 'no_commit', 'No commit', 'NO HACER COMMIT', 'no pushear',
  'ReferenciaNoHacerCommit',
  'node_modules', '.git', '.github', '.claude', '.temp', 'dist', 'build',
  'coverage', '__tests__',
]);
const esCajaFuerte = (nombre) => /^Exclusivo /i.test(nombre) || NO_SE_ABREN.has(nombre);

// Pantallas perdonadas, con el motivo al lado: 'ruta' => 'estado: por qué'.
const EXCEPTUADAS = new Map([
  // (vacía a propósito — ver el encabezado)
]);

// ── Los detectores ─────────────────────────────────────────────────────────

// Una puerta de datos: la base o la red.
const PUERTA_DE_DATOS = /\bsupabase\s*\.\s*from\s*\(|\bfetch\s*\(|\bapi[A-Z]\w*\s*\(|\bapi\.\w+\s*\(/;

// Ya los resuelve el punto único, o el equivalente que tenga esa aplicación.
const YA_LOS_RESUELVE = /<EstadoLista\b|<EstadoDePantalla\b|<EstadoDeCarga\b/;

// Avisa que está esperando. Se acepta cualquiera de las formas que se usan: el
// cartel de «cargando», el botón apagado mientras la operación corre, la marca
// para quien usa lector de pantalla.
const AVISA_QUE_ESPERA = /cargando|guardando|enviando|procesando|disabled\s*=|aria-busy|ocupado|trabajando|subiendo|buscando|verificando/i;

// Dice cuando algo falló. Son dos formas y las dos valen: atajar lo que se
// rompió, o mirar el `error` que devuelve la base, que no se rompe: lo informa.
const DICE_EL_FALLO = /\bcatch\b|setError\s*\(|mensajeDeError|error_generico/;

// Dice cuando no hay nada que mostrar.
const DICE_EL_VACIO = /\.length\s*===\s*0|\.length\s*>\s*0|\.length\s*\?|!\w+\.length|length\s*&&|vac[ií]o|sin_datos|sin_resultados/;

// Una lista que guardó al cargar: `const [cosas, setCosas] = useState([])`.
const LISTA_PROPIA = /const\s*\[\s*(\w+)\s*,\s*set\w+\s*\]\s*=\s*useState\s*\(\s*\[\s*\]\s*\)/g;

// El texto de un estado escrito a mano en vez de pedido al catálogo. Se busca
// sólo donde el texto **se ve**: entre etiquetas, o adentro de uno de los cuatro
// atributos que se leen en pantalla. `useState('cargando')` no entra, y está
// bien que no entre: ahí «cargando» no es una palabra que alguien lea, es el
// nombre de uno de los cuatro estados.
const ESTADOS_EN_PALABRAS =
  '(?:Cargando|Loading|Carregando|Aguarde|No hay datos|Sin datos|Sin resultados|No se encontraron|Nenhum resultado|No results|Nada para mostrar)';
const ESTADO_ESCRITO_A_MANO = new RegExp(
  `>\\s*${ESTADOS_EN_PALABRAS}\\b|(?:placeholder|title|alt|aria-label)\\s*=\\s*["'{\\s]*${ESTADOS_EN_PALABRAS}\\b`,
  'i',
);

const rutaCorta = (ruta) => relative(RAIZ, ruta).replaceAll('\\', '/');

function pantallasDe(carpeta, encontradas = []) {
  for (const entrada of readdirSync(carpeta)) {
    if (esCajaFuerte(entrada)) continue;
    const ruta = join(carpeta, entrada);
    if (statSync(ruta).isDirectory()) pantallasDe(ruta, encontradas);
    else if (entrada.endsWith('.jsx')) encontradas.push(ruta);
  }
  return encontradas;
}

// ── El recorrido ───────────────────────────────────────────────────────────

const sinPuntoUnico = [];
const textoEscritoAMano = [];
const sinLosCuatro = [];
let miradas = 0;

// 1. El punto único.
try {
  const texto = readFileSync(join(RAIZ, PUNTO_UNICO), 'utf8');
  for (const clave of CLAVES_DEL_PUNTO_UNICO) {
    if (!texto.includes(clave)) {
      sinPuntoUnico.push(`${PUNTO_UNICO} ya no nombra «${clave}»: ese estado dejó de salir del catálogo.`);
    }
  }
} catch {
  sinPuntoUnico.push(
    `${PUNTO_UNICO} no está. Si se movió, hay que moverlo también acá, o este chequeo deja de mirarlo.`,
  );
}

// 2 y 3. Las pantallas.
for (const app of APLICACIONES) {
  for (const ruta of pantallasDe(join(RAIZ, app, 'src'))) {
    const corta = rutaCorta(ruta);
    const texto = readFileSync(ruta, 'utf8');

    texto.split('\n').forEach((renglon, i) => {
      const limpio = renglon.trimStart();
      if (limpio.startsWith('//') || limpio.startsWith('*')) return;
      if (ESTADO_ESCRITO_A_MANO.test(renglon)) {
        textoEscritoAMano.push(`${corta}:${i + 1}  ${limpio.slice(0, 90)}`);
      }
    });

    if (!PUERTA_DE_DATOS.test(texto) || !/\bawait\b/.test(texto)) continue;

    // Un proveedor trae y no muestra: no tiene pantalla, así que no tiene los
    // cuatro estados. Lo suyo —que el fallo le llegue a quien sí muestra— es
    // otra regla, y está anotada abajo entre lo que este chequeo no revisa.
    if (corta.includes('/context/')) continue;

    miradas += 1;
    if (YA_LOS_RESUELVE.test(texto)) continue;

    const listasPropias = new Set();
    for (const m of texto.matchAll(LISTA_PROPIA)) listasPropias.add(m[1]);
    let dibujaLoQueTrajo = false;
    for (const nombre of listasPropias) {
      if (new RegExp(`\\{\\s*${nombre}\\s*\\.map\\s*\\(`).test(texto)) dibujaLoQueTrajo = true;
    }

    const perdon = EXCEPTUADAS.get(corta) || '';
    const falta = [];
    if (!AVISA_QUE_ESPERA.test(texto) && !perdon.startsWith('cargando')) falta.push('cargando');
    if (!DICE_EL_FALLO.test(texto) && !perdon.startsWith('error')) falta.push('error');
    if (dibujaLoQueTrajo && !DICE_EL_VACIO.test(texto) && !perdon.startsWith('vacio')) falta.push('vacío');
    if (falta.length) sinLosCuatro.push(`${corta} carga datos y no tiene: ${falta.join(', ')}.`);
  }
}

// ── Que los detectores sigan viendo ────────────────────────────────────────
// Una prueba que no puede fallar no prueba nada. Cada detector se prueba contra
// código escrito a mano: lo de arriba tiene que casar y lo de abajo no.

const BANCO = [
  ['la puerta de datos', PUERTA_DE_DATOS,
    ['  const { data } = await supabase.from("guardias").select();',
     '  const r = await fetch("/api/guardias");',
     '  const r = await apiGuardias({ id });'],
    ['  const guardias = props.guardias;',
     '  const total = suma.from(lista);']],
  ['el aviso de que espera', AVISA_QUE_ESPERA,
    ['  {estado === "cargando" && <Spinner />}',
     '  <button disabled={guardando}>Guardar</button>',
     '  <div aria-busy="true" />'],
    ['  <button onClick={guardar}>Guardar</button>',
     '  const total = filas.length;']],
  ['lo que dice el fallo', DICE_EL_FALLO,
    ['  try { await traer(); } catch (e) { avisar(e); }',
     '  if (error) setError(mensajeDeError(error, t));',
     '  <p>{t.comun.error_generico}</p>'],
    ['  const error = null;',
     '  await traer();']],
  ['lo que dice el vacío', DICE_EL_VACIO,
    ['  {filas.length === 0 && <Nada />}',
     '  {!filas.length ? <Nada /> : <Tabla />}',
     '  <p>{t.comun.sin_datos_titulo}</p>'],
    ['  const primera = filas[0];',
     '  filas.forEach((f) => sumar(f));']],
  ['el texto de un estado escrito a mano', ESTADO_ESCRITO_A_MANO,
    ['      <p>Cargando…</p>',
     '      <p className="x">No hay datos</p>',
     '      <span>Loading</span>',
     '      <input placeholder="Sin resultados" />'],
    ['      <p>{t.comun.cargando}</p>',
     '      <p>{t.comun.sin_datos_titulo}</p>',
     "      const [estado, setEstado] = useState('cargando');",
     "      if (estado === 'cargando') return null;",
     '      // Cargando: ver más abajo']],
];

const detectorRoto = [];
for (const [nombre, forma, casan, noCasan] of BANCO) {
  for (const renglon of casan) {
    forma.lastIndex = 0;
    if (!forma.test(renglon)) detectorRoto.push(`${nombre} dejó de ver:      ${renglon.trim()}`);
  }
  for (const renglon of noCasan) {
    forma.lastIndex = 0;
    if (forma.test(renglon)) detectorRoto.push(`${nombre} se queja de más:  ${renglon.trim()}`);
  }
}

if (miradas === 0) {
  detectorRoto.push('no quedó ni una pantalla que cargue datos: el recorrido está mirando al vacío.');
}

// ── Lo que se dice al terminar ─────────────────────────────────────────────

function informar(titulo, hallazgos, explicacion) {
  if (!hallazgos.length) return false;
  console.error(`\n${titulo}`);
  for (const h of hallazgos) console.error(`  - ${h}`);
  console.error(`  ${explicacion}`);
  return true;
}

const falla1 = informar(
  'Los detectores de este chequeo se rompieron:',
  detectorRoto,
  'Mientras estén así, este programa da verde sin haber mirado nada.',
);
const falla2 = informar(
  'El punto único de los cuatro estados se despegó del catálogo:',
  sinPuntoUnico,
  'De él cuelgan casi todas las pantallas del Panel: lo que se le escriba a mano adentro se lo escribe a todas.',
);
const falla3 = informar(
  'Hay texto de un estado escrito a mano:',
  textoEscritoAMano,
  'Eso es texto visible: sale del catálogo, o la pantalla en inglés muestra una palabra en castellano.',
);
const falla4 = informar(
  'Hay pantallas que cargan datos sin los cuatro estados:',
  sinLosCuatro,
  'Lo más corto es envolver lo que se dibuja en <EstadoLista>, que ya los resuelve los cuatro y ya saca su texto del catálogo.',
);
if (falla1 || falla2 || falla3 || falla4) process.exit(1);

console.log(`Las ${miradas} pantallas que cargan datos tienen los cuatro estados y su texto sale del catálogo.`);

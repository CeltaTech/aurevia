// El único lugar que convierte un error en una frase que una persona pueda leer.
//
// Un error que sube de la base de datos o del servidor viene escrito para quien programa:
// "duplicate key value violates unique constraint", "Failed to fetch", "PGRST116". Eso no
// puede llegar nunca a la pantalla. Acá se lo clasifica en una de ocho situaciones y se
// devuelve el texto del idioma que corresponda.
//
// Vive en lib/ porque lo usan decenas de pantallas y la regla 12 de CLAUDE.md pide un solo
// punto de verdad. El archivo es idéntico en panel/, pwa-familias/ y pwa-asistentes/: el
// original es el del Panel y las copias las mantiene scripts/sincronizar_copias.mjs.

// Las ocho situaciones. No son categorías técnicas: son las ocho cosas distintas que le
// pueden pasar a quien está mirando la pantalla, y para cada una hay algo distinto que hacer.
export const SITUACIONES = [
  'sin_conexion', // el aparato se quedó sin internet, o el servidor no contesta
  'sesion_vencida', // pasó demasiado tiempo, hay que volver a entrar
  'sin_permiso', // entró bien, pero eso no le corresponde
  'no_encontrado', // lo que buscaba ya no está
  'duplicado', // ya existe otro igual
  'en_uso', // no se puede borrar porque otra cosa depende de esto
  'dato_invalido', // lo que cargó no cumple una regla
  'falla_del_sistema', // cualquier otra cosa: es nuestra culpa, no de quien mira
];

// Los códigos que manda PostgREST (la puerta de entrada a la base de datos).
const CODIGOS_POSTGREST = {
  PGRST116: 'no_encontrado', // pidió una fila y no había ninguna
  PGRST301: 'sesion_vencida', // el permiso de entrada se venció
  PGRST302: 'sesion_vencida',
  PGRST303: 'sesion_vencida',
  PGRST204: 'falla_del_sistema', // le pidió una columna que no existe
  PGRST205: 'falla_del_sistema', // le pidió una tabla que no existe
};

// Los códigos que manda PostgreSQL (la base de datos misma).
const CODIGOS_POSTGRES = {
  '23505': 'duplicado', // ya hay otro registro con ese mismo dato único
  '23503': 'en_uso', // otra tabla apunta a esto, no se puede borrar
  '23502': 'dato_invalido', // falta un dato obligatorio
  '23514': 'dato_invalido', // el dato no cumple una regla de la tabla
  '22P02': 'dato_invalido', // mandó letras donde iba un número
  '22001': 'dato_invalido', // el texto es más largo de lo que entra
  '22007': 'dato_invalido', // la fecha está mal escrita
  P0001: 'dato_invalido', // una regla del negocio frenó la operación
  '42501': 'sin_permiso', // la base no lo deja tocar eso
  '42P01': 'falla_del_sistema', // la tabla no existe
  '42703': 'falla_del_sistema', // la columna no existe
  '42883': 'falla_del_sistema', // la función no existe
  '42P17': 'falla_del_sistema', // las reglas de acceso se muerden la cola
  '40001': 'falla_del_sistema', // dos operaciones chocaron, hay que reintentar
  '57014': 'falla_del_sistema', // la consulta tardó demasiado y se cortó
};

// Los números que manda el servidor por HTTP.
const CODIGOS_HTTP = {
  400: 'dato_invalido',
  401: 'sesion_vencida',
  403: 'sin_permiso',
  404: 'no_encontrado',
  409: 'duplicado',
  422: 'dato_invalido',
  429: 'falla_del_sistema',
};

// Cuando no hay ningún código, lo único que queda es mirar el texto. Estas son las frases
// que el navegador y las bibliotecas escriben en inglés, en minúscula para comparar.
const FRASES = [
  [/failed to fetch|networkerror|network request failed|load failed|err_internet|net::err/, 'sin_conexion'],
  [/timeout|timed out|aborted/, 'sin_conexion'],
  [/jwt expired|invalid refresh token|refresh_token_not_found|session (not found|missing|expired)|no session/, 'sesion_vencida'],
  [/permission denied|not authorized|unauthorized|forbidden|row-level security/, 'sin_permiso'],
  [/duplicate key|already (exists|registered)|ya existe/, 'duplicado'],
  [/violates foreign key|still referenced/, 'en_uso'],
  [/not found|no rows|does not exist/, 'no_encontrado'],
];

// Un error puede llegar de cuatro formas distintas según de dónde venga: un objeto de
// Supabase con .code, un Error con .status que puso api.js, un Error pelado, o un texto.
// Esto las aplana a { codigo, estado, texto }.
function partesDelError(error) {
  if (error === null || error === undefined) return { codigo: '', estado: 0, texto: '' };
  if (typeof error === 'string') return { codigo: '', estado: 0, texto: error };
  return {
    codigo: String(error.code ?? error.codigo ?? ''),
    estado: Number(error.status ?? error.statusCode ?? error.estado ?? 0),
    texto: String(error.message ?? error.error_description ?? error.error ?? error.details ?? ''),
  };
}

/**
 * Clasifica un error en una de las ocho situaciones. Siempre devuelve una: si no reconoce
 * nada, devuelve 'falla_del_sistema', que es lo honesto — si no sabemos qué pasó, el
 * problema es nuestro.
 */
export function situacionDelError(error) {
  const { codigo, estado, texto } = partesDelError(error);

  if (codigo && CODIGOS_POSTGREST[codigo]) return CODIGOS_POSTGREST[codigo];
  if (codigo && CODIGOS_POSTGRES[codigo]) return CODIGOS_POSTGRES[codigo];
  if (estado >= 500) return 'falla_del_sistema';
  if (estado && CODIGOS_HTTP[estado]) return CODIGOS_HTTP[estado];

  const minuscula = texto.toLowerCase();
  if (minuscula) {
    for (const [patron, situacion] of FRASES) {
      if (patron.test(minuscula)) return situacion;
    }
  }

  return 'falla_del_sistema';
}

/**
 * Convierte una respuesta fallida del motor en un Error que la pantalla pueda explicar.
 *
 * Existe porque el `fetch` del navegador no falla cuando el servidor contesta que no: hay que
 * mirar `respuesta.ok` a mano y armar el error uno mismo. Cuando cada pantalla lo arma a su
 * manera —`throw new Error(resultado.error)`— se pierden en el camino las dos cosas que
 * después hacen falta para explicar: el código de respuesta y el motivo.
 *
 * @param respuesta el objeto que devolvió `fetch`.
 * @param datos     el cuerpo ya leído como JSON (puede venir vacío o mal formado).
 */
export function errorDeLaRespuesta(respuesta, datos) {
  const error = new Error(datos?.error || `HTTP ${respuesta?.status ?? 0}`);
  error.status = respuesta?.status ?? 0;
  if (datos?.motivo) error.motivo = datos.motivo;
  return error;
}

/**
 * El texto que va a la pantalla.
 *
 * @param error   lo que se agarró en el catch: un objeto de Supabase, un Error o un texto.
 * @param t       los textos del idioma que está usando la persona (useLocale().t).
 * @param donde   opcional, para el registro de la consola: en qué pantalla u operación pasó.
 *
 * El texto crudo del error no se pierde: se escribe en la consola del navegador, que es
 * donde hay que buscarlo cuando algo falla. A la pantalla va solo la frase traducida.
 *
 * Hay dos niveles de explicación, y siempre gana el más específico:
 *
 * 1. **El motivo**, si el motor mandó uno. Un motivo es un código —`correo_de_otra_cuenta`,
 *    `sin_etapas_incorporacion`— con el que el motor dice exactamente qué pasó y qué hay que
 *    hacer. Es lo mejor que se le puede mostrar a una persona: en vez de "Ya existe un
 *    registro con esos datos", lee que ese correo ya tiene cuenta en esta Prestadora.
 * 2. **La situación**, si no hay motivo: una de las ocho de arriba, deducida del código o del
 *    texto del error. Es lo genérico, y por eso va segundo.
 *
 * El motivo nunca viaja como frase hecha desde el motor —el motor no sabe en qué idioma está
 * mirando la persona—, así que la frase se busca acá, en las traducciones, en los tres
 * idiomas. Si llegara un motivo sin traducción, se cae a la situación y nadie ve un código.
 */
export function mensajeDeError(error, t, donde = '') {
  const motivo = error && typeof error === 'object' ? String(error.motivo ?? '') : '';
  const explicacion = motivo ? t?.errores?.motivos?.[motivo] : '';
  const situacion = situacionDelError(error);

  if (import.meta.env?.DEV || (!explicacion && situacion === 'falla_del_sistema')) {
    console.error(`[error${donde ? ': ' + donde : ''}] ${motivo || situacion}`, error);
  }

  return explicacion || t?.errores?.[situacion] || t?.comun?.error_generico || '';
}

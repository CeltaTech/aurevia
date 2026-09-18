// Punto único de verdad de QUÉ SE REGISTRA CUANDO NO VA NADIE.
// ============================================================================
//
// QUÉ RESUELVE. Cuando un turno se queda sin nadie, termina de una de dos maneras que el producto
// no sabía escribir: el Paciente queda solo, o se queda cuidándolo alguien de la casa. Las dos son
// hechos, no arreglos: ninguna de las dos cuenta el turno como prestado, y ninguna de las dos lo
// cierra. Este archivo contesta qué hace falta para que cada una quede bien registrada.
//
// LAS DOS COSAS NO SON LA MISMA. En una no hay nadie en la casa; en la otra sí. Se registran por
// separado porque se leen por separado, y porque un mismo turno puede tener las dos: la Familia
// aceptó que quedara solo un rato, y después igual se quedó alguien.
//
// EL CONSENTIMIENTO ES EL REGISTRO DE UNA CONVERSACIÓN QUE YA OCURRIÓ. El sistema no lo pide ni lo
// concede: lo carga quien coordina después de hablar con la Familia. Por eso lo que hace falta es
// lo que permite reconstruir el hecho si alguien lo discute —con quién se habló, por qué medio, y
// hasta cuándo vale lo que se aceptó—, y nada más que eso.
//
// Y TIENE FIN, SIEMPRE. Un consentimiento sin fecha de fin no es un consentimiento: es una
// renuncia abierta, y la Familia nunca aceptó eso. Se pide el fin igual que se pide el comienzo.
//
// AL FAMILIAR NO SE LE PIDE NADA, Y POR ESO NO HAY NADA QUE AUTORIZAR. Un familiar es el cliente:
// no le debe una guardia a nadie. Que igual se haya quedado se anota como lo que es —un defecto
// grave del servicio que no se pudo solucionar—, y quien figura en el registro es quien lo dejó
// escrito, no quien lo permitió.
//
// QUÉ NO DECIDE ESTE ARCHIVO. No escribe nada, no cierra ningún turno y no muestra ninguna
// advertencia legal. Si algún día hay que advertir algo sobre dejar sola a la persona atendida, el
// texto sale del documento legal de ese país y no de acá.
//
// Se copia entero al motor (`scripts/copias_entre_apps.mjs`). Por eso no importa nada del Panel.

/**
 * Por qué medio se habló con la Familia. Guardado, no visible: el texto de cada uno vive en las
 * traducciones, en los tres idiomas.
 */
export const MEDIOS = {
  TELEFONO: 'telefono',
  EN_PERSONA: 'en_persona',
  MENSAJE: 'mensaje',
  CORREO: 'correo',
};

export const MEDIOS_POSIBLES = Object.values(MEDIOS);

/**
 * Por cuál de los tres caminos el turno se quedó sin nadie.
 *
 * Son tres y no uno porque el hecho es el mismo y el camino cambia: el relevo que no llegó abre un
 * incidente de relevo, el turno que nunca tuvo a quién asignarle abre el suyo, y la que quedó de
 * más y no puede continuar no abre ninguno. Guardar el camino es lo que después permite contar
 * cuántas veces terminó cuidando la familia por cada uno.
 */
export const ORIGENES = {
  RELEVO: 'relevo',
  TURNO_SIN_CUBRIR: 'turno_sin_cubrir',
  EXTENSION: 'extension',
};

export const ORIGENES_POSIBLES = Object.values(ORIGENES);

/** Lo más largo que puede escribirse en una nota o en un nombre. */
export const LARGOS = {
  quien_consintio: 200,
  nota: 2000,
  motivo: 2000,
};

function textoUsable(valor, maximo) {
  if (typeof valor !== 'string') return false;
  const limpio = valor.trim();
  return limpio.length > 0 && limpio.length <= maximo;
}

const FORMA_DE_IDENTIFICADOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Falla cerrado: lo que no tiene forma de identificador no señala ningún Legajo.
function identificadorUsable(valor) {
  return typeof valor === 'string' && FORMA_DE_IDENTIFICADOR.test(valor.trim());
}

function momento(valor) {
  if (!valor) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Comprueba un consentimiento antes de guardarlo.
 *
 * Devuelve `{ ok: true }`, o `{ ok: false, campo }` con el primer campo que no sirve. El campo se
 * devuelve y no una frase: el texto que ve la persona sale de las traducciones, y acá no se
 * escribe texto visible.
 */
export function revisarConsentimiento(datos) {
  if (!textoUsable(datos?.quien_consintio, LARGOS.quien_consintio)) {
    return { ok: false, campo: 'quien_consintio' };
  }
  if (!MEDIOS_POSIBLES.includes(datos?.medio)) return { ok: false, campo: 'medio' };

  const desde = momento(datos?.desde_at);
  if (!desde) return { ok: false, campo: 'desde_at' };
  const hasta = momento(datos?.hasta_at);
  // El fin no es opcional, y tampoco puede ser anterior al comienzo: eso es un dato mal cargado.
  if (!hasta || hasta.getTime() <= desde.getTime()) return { ok: false, campo: 'hasta_at' };

  if (datos?.nota != null && datos.nota !== '' && !textoUsable(datos.nota, LARGOS.nota)) {
    return { ok: false, campo: 'nota' };
  }
  return { ok: true };
}

/**
 * Comprueba el registro de un familiar que se quedó, antes de guardarlo.
 *
 * El motivo no se pide. El familiar no tiene que justificar por qué se quedó en su propia casa; si
 * hay algo que dejar escrito, se escribe, y si no, no.
 *
 * Quién se quedó se elige del Padrón y se guarda cuál Legajo es, nunca su nombre tecleado. Que sea
 * una Persona física lo comprueba además la base, al dar de alta.
 */
export function revisarFamiliarQueSeQuedo(datos) {
  if (!identificadorUsable(datos?.familiar_legajo_id)) {
    return { ok: false, campo: 'familiar_legajo_id' };
  }
  if (!ORIGENES_POSIBLES.includes(datos?.origen)) return { ok: false, campo: 'origen' };

  const desde = momento(datos?.desde_at);
  if (!desde) return { ok: false, campo: 'desde_at' };

  // Acá el fin sí puede faltar: mientras el familiar siga en la casa todavía no hay fin que poner.
  if (datos?.hasta_at != null && datos.hasta_at !== '') {
    const hasta = momento(datos.hasta_at);
    if (!hasta || hasta.getTime() < desde.getTime()) return { ok: false, campo: 'hasta_at' };
  }

  if (datos?.motivo != null && datos.motivo !== '' && !textoUsable(datos.motivo, LARGOS.motivo)) {
    return { ok: false, campo: 'motivo' };
  }
  return { ok: true };
}

/**
 * Si lo que la Familia aceptó alcanza a este momento.
 *
 * Falla cerrado: sin fechas usables la respuesta es que no alcanza. Un consentimiento que no se
 * puede leer es un consentimiento que no existe, y darlo por bueno sería justamente el error que
 * este registro viene a evitar.
 */
export function elConsentimientoAlcanza(consentimiento, cuando = new Date()) {
  const desde = momento(consentimiento?.desde_at);
  const hasta = momento(consentimiento?.hasta_at);
  const ahora = momento(cuando);
  if (!desde || !hasta || !ahora) return false;
  return ahora.getTime() >= desde.getTime() && ahora.getTime() <= hasta.getTime();
}

/** El consentimiento de este turno que alcanza a ese momento, o `null` si no hay ninguno. */
export function consentimientoQueAlcanza(consentimientos, cuando = new Date()) {
  return (consentimientos ?? []).find((c) => elConsentimientoAlcanza(c, cuando)) ?? null;
}

/** Si ese familiar sigue en la casa: se quedó y todavía no volvió a haber personal. */
export function elFamiliarSigueEnLaCasa(registro) {
  if (!registro) return false;
  return registro.hasta_at == null;
}

/**
 * Que un familiar haya terminado cuidando es siempre un defecto grave del servicio que no se pudo
 * solucionar, venga por el camino que venga.
 *
 * Está escrito como función y no como una constante `true` porque es la pregunta que hacen las
 * pantallas, y el día que deje de ser siempre —si alguna vez lo deja de ser— cambia acá y en
 * ningún otro lado.
 */
export function esDefectoGraveQueSeQuedaraUnFamiliar() {
  return true;
}

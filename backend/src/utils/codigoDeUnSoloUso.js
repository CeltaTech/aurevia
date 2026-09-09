import crypto from 'node:crypto';

// El código de seis dígitos que vence, que este producto usa ya en cuatro lugares distintos: la
// firma de la instrucción del titular del círculo familiar, la recuperación de acceso por correo,
// y —desde el pase de guardia (pendiente #113)— el código que una persona muestra en la pantalla
// de su teléfono y el que suelta la Prestadora cuando no hay nadie que lo muestre.
//
// Estaba copiado tal cual en cada uno. Acá queda una sola vez (CLAUDE.md de la empresa, «ningún
// patrón repetido sin punto único de verdad»).
//
// LAS TRES REGLAS QUE HACEN QUE SIRVA
//   1. El código nunca se guarda. Se guarda su huella, y se compara huella contra huella.
//   2. Vence. Sin vencimiento, seis dígitos son un secreto permanente de un millón de valores.
//   3. Se cuentan los intentos. Sin tope, seis dígitos se prueban de a uno hasta acertar.
//
// La comparación es de tiempo constante. Comparar dos textos con `!==` termina apenas encuentra
// el primer carácter distinto, y cuánto tardó en terminar es información sobre cuánto acertó
// quien probó. Sobre una huella de sha256 el riesgo es remoto, pero la forma correcta no cuesta
// nada y evita tener que discutirlo cada vez.

export const INTENTOS_MAXIMOS = 5;

// Seis dígitos, siempre seis: `randomInt(100000, 1000000)` nunca devuelve un número que empiece
// con cero, así que el largo no varía y la pantalla puede exigirlo.
export const LARGO_DEL_CODIGO = 6;

export function codigoNuevo() {
  return String(crypto.randomInt(100000, 1000000));
}

export function huellaDelCodigo(codigo) {
  return crypto.createHash('sha256').update(String(codigo)).digest('hex');
}

// ¿El código que alguien tipeó corresponde a esta huella guardada? Devuelve false ante cualquier
// cosa rara —sin huella guardada, código vacío, huella de largo distinto— porque todo control de
// acceso falla cerrado.
export function codigoCoincide(codigo, huellaGuardada) {
  if (!huellaGuardada) return false;
  const texto = String(codigo ?? '').trim();
  if (!texto) return false;

  const calculada = Buffer.from(huellaDelCodigo(texto), 'utf8');
  const guardada = Buffer.from(String(huellaGuardada), 'utf8');
  if (calculada.length !== guardada.length) return false;

  return crypto.timingSafeEqual(calculada, guardada);
}

export function vencimientoEnMinutos(minutos) {
  return new Date(Date.now() + minutos * 60 * 1000).toISOString();
}

export function vencimientoEnSegundos(segundos) {
  return new Date(Date.now() + segundos * 1000).toISOString();
}

export function estaVencido(expiraEn) {
  if (!expiraEn) return true;
  return new Date(expiraEn).getTime() < Date.now();
}

// ---------------------------------------------------------------------------------------
// Emitir un código nuevo NO devuelve intentos (pendiente #177)
// ---------------------------------------------------------------------------------------
//
// El tope se contaba bien y se borraba solo: los dos lugares que emiten un código escribían
// `codigo_intentos: 0` junto con la huella nueva. Con eso el tope no era un tope — alcanzaba con
// pedir otro código para tener cinco intentos más, y así hasta acertar los seis dígitos.
//
// LA CUENTA ES DEL ACTO, NO DEL CÓDIGO. Los intentos se cuentan contra la cosa que se está
// abriendo —esta instrucción, esta llegada—, no contra el papelito de turno. Pedir un papelito
// nuevo no borra los intentos que ya se gastaron, igual que cambiar de llave no borra las veces
// que uno erró la cerradura.
//
// Y EL CASO LEGÍTIMO SIGUE ANDANDO. Quien pide un código nuevo porque el anterior venció no
// gastó ningún intento: el vencimiento se controla **antes** de contar, así que un código
// vencido no cuesta nada y esa persona llega al código nuevo con los cinco enteros.
//
// Cuando de verdad se agotaron, la salida no es pedir otro código —eso es justamente lo que se
// cerró— sino la que cada camino ya tenía: en la firma del titular, la Prestadora carga una
// instrucción nueva o la cierra con la hoja firmada en papel; en el pase de guardia, el
// Asistente entra igual eligiendo un motivo, que es el piso que nunca falla.
//
// Devuelve el código en claro —que se muestra o se manda una sola vez— y las columnas que hay
// que guardar. `codigo_intentos` no está en esa lista a propósito: no se toca al emitir.
export function codigoNuevoParaGuardar(expiraEn) {
  const codigo = codigoNuevo();
  return {
    codigo,
    campos: {
      codigo_huella: huellaDelCodigo(codigo),
      codigo_expira_en: expiraEn,
    },
  };
}

// ---------------------------------------------------------------------------------------
// El intento lo suma la base, en un solo paso (pendiente #177)
// ---------------------------------------------------------------------------------------
//
// Antes el motor leía `codigo_intentos`, le sumaba uno y lo volvía a escribir. Entre la lectura
// y la escritura entra cualquier otro pedido: dos intentos simultáneos leen 2, los dos escriben
// 3, y de cinco intentos se cuenta uno. Repitiendo eso en paralelo el tope no se alcanza nunca.
//
// Acá la suma la hace la base adentro de una sola sentencia (`codigo_intentos + 1` con
// `RETURNING`), que es atómica: cada llamada devuelve su propio número y ninguna pisa a la otra.
// La función SQL vive en `public` porque el motor la llama por API, y sólo la puede ejecutar la
// llave de servicio — ver la migración
// `20260909130000_el_tope_de_intentos_de_un_codigo_es_un_tope.sql`.
//
// La lista de tablas está acá además de en la base para que un nombre de tabla no llegue nunca
// desde afuera. Ninguna de las dos puntas la arma con lo que venga en un pedido.
const TABLAS_CON_INTENTOS = new Set(['instrucciones_acceso_circulo', 'guardia_comprobaciones']);

/**
 * Suma un intento y devuelve cuántos van, contando el que se acaba de hacer.
 * Devuelve `null` si no se pudo contar; quien llama tiene que tratar eso como "se agotaron",
 * porque un tope que se saltea cuando la base no contesta no es un tope.
 */
export async function sumarIntento({ tabla, id }) {
  if (!TABLAS_CON_INTENTOS.has(tabla) || !id) return null;

  // La conexión se pide acá adentro y no arriba de todo a propósito. El resto de este archivo son
  // cuentas de criptografía que no tocan la base, y varias pruebas lo importan sin levantar
  // ninguna: si la conexión se armara al cargar el archivo, importarlo sin las variables de
  // entorno puestas rompería. El módulo se carga una sola vez y queda en memoria.
  const { supabase } = await import('../db/connection.js');

  const { data, error } = await supabase.rpc('sumar_intento_de_codigo', { p_tabla: tabla, p_id: id });
  if (error) {
    // Se anota que no se pudo contar, nunca el código ni el contenido (CLAUDE.md §6).
    console.error('sumarIntento: no se pudo contar el intento:', error.message);
    return null;
  }

  // `Number(null)` da 0, que es un número perfectamente finito: si no se filtrara acá, una base
  // que contestara vacío se leería como "cero intentos" y el tope quedaría abierto para siempre.
  if (data === null || data === undefined) {
    console.error('sumarIntento: la base no devolvió cuántos intentos van');
    return null;
  }

  const intentos = Number(data);
  return Number.isFinite(intentos) ? intentos : null;
}

/**
 * ¿Este intento quedó fuera del tope? Recibe lo que devolvió `sumarIntento`.
 *
 * Falla cerrado: ante `null`, `undefined` o cualquier cosa que no sea un número se contesta que
 * sí. En JavaScript `undefined > 5` da falso, y un control escrito al revés dejaría pasar justo
 * el caso que no se entendió (CLAUDE.md §5).
 */
export function seAgotaronLosIntentos(intentos) {
  if (!Number.isFinite(intentos)) return true;
  return intentos > INTENTOS_MAXIMOS;
}

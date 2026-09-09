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

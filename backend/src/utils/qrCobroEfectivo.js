// Pendiente #85 — token firmado del QR de cobro en efectivo (qr_cobro_efectivo.token).
// HMAC-SHA256 con clave de servidor (QR_COBRO_SECRET), no JWT: el payload es mínimo (un
// id de fila propia) y no necesitamos ni claims estándar ni una librería nueva para esto
// (CLAUDE.md — no sumar dependencia para un problema que `crypto` ya resuelve).

import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

const SECRETO = process.env.QR_COBRO_SECRET;
const VIGENCIA_MINUTOS = 10;

export function generarTokenQrCobro() {
  const id = randomUUID();
  const firma = createHmac('sha256', SECRETO).update(id).digest('hex');
  const expiraEn = new Date(Date.now() + VIGENCIA_MINUTOS * 60 * 1000);
  return { token: `${id}.${firma}`, expiraEn };
}

export function tokenQrCobroValido(token) {
  const [id, firma] = String(token).split('.');
  if (!id || !firma) return false;
  const firmaEsperada = createHmac('sha256', SECRETO).update(id).digest('hex');
  const bufferRecibido = Buffer.from(firma, 'hex');
  const bufferEsperado = Buffer.from(firmaEsperada, 'hex');
  if (bufferRecibido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecibido, bufferEsperado);
}

import crypto from 'crypto';
import { supabase } from '../db/connection.js';
import { enviarEmail } from './email.js';
import { IDENTIDAD } from '../config/identidadProducto.js';

// Pendiente #37 — recuperación de acceso por email cuando se pierde el dispositivo TOTP.
const VIGENCIA_MINUTOS = 10;

function hashCodigo(codigo) {
  return crypto.createHash('sha256').update(codigo).digest('hex');
}

function generarCodigoLegible() {
  return String(crypto.randomInt(100000, 1000000)); // 6 dígitos, mismo formato que el TOTP
}

export async function solicitarCodigoRecuperacion(usuarioId) {
  const { data: userData, error } = await supabase.auth.admin.getUserById(usuarioId);
  if (error || !userData?.user?.email) {
    throw new Error('No se pudo resolver el email registrado del usuario');
  }

  // Invalida cualquier código anterior sin usar — solo el último pedido sirve.
  await supabase
    .from('mfa_codigos_recuperacion')
    .update({ usado: true, usado_en: new Date().toISOString() })
    .eq('usuario_id', usuarioId)
    .eq('usado', false);

  const codigo = generarCodigoLegible();
  const { error: errorInsert } = await supabase.from('mfa_codigos_recuperacion').insert({
    usuario_id: usuarioId,
    codigo_hash: hashCodigo(codigo),
    expira_at: new Date(Date.now() + VIGENCIA_MINUTOS * 60 * 1000).toISOString(),
  });
  if (errorInsert) throw new Error(errorInsert.message);

  await enviarEmail({
    to: userData.user.email,
    asunto: `Código de recuperación de acceso — ${IDENTIDAD.nombre}`,
    texto: `El código de recuperación es ${codigo}. Vence en ${VIGENCIA_MINUTOS} minutos. Si no lo pidió usted, puede ignorar este correo.`,
  });
}

// Verifica el código y, si es válido, da de baja el/los factor/es TOTP del usuario —
// misma acción que hoy se hacía a mano por SQL (DELETE FROM auth.mfa_factors), pero
// autoservicio. El usuario vuelve a entrar sin MFA y queda en estado "requiere
// enrolamiento" para configurar un dispositivo nuevo en el momento.
export async function confirmarCodigoRecuperacion(usuarioId, codigo) {
  const hash = hashCodigo(String(codigo || '').trim());

  const { data: fila } = await supabase
    .from('mfa_codigos_recuperacion')
    .select('id, expira_at')
    .eq('usuario_id', usuarioId)
    .eq('codigo_hash', hash)
    .eq('usado', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!fila || new Date(fila.expira_at) < new Date()) return false;

  await supabase
    .from('mfa_codigos_recuperacion')
    .update({ usado: true, usado_en: new Date().toISOString() })
    .eq('id', fila.id);

  const { data: factoresData } = await supabase.auth.admin.mfa.listFactors({ userId: usuarioId });
  const factoresTotp = (factoresData?.factors ?? []).filter((f) => f.factor_type === 'totp');
  for (const factor of factoresTotp) {
    await supabase.auth.admin.mfa.deleteFactor({ id: factor.id, userId: usuarioId });
  }

  return true;
}

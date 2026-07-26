import 'dotenv/config';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const API_URL = process.env.PANEL_API_URL_TEST || 'https://aurevia-backend-production-e7ee.up.railway.app';

const EMAIL = 'temp.verif.mfa.recuperacion@gmail.com';
const PASSWORD = 'VerifTemp!2026x';

function base32Decode(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of base32.replace(/=+$/, '')) {
    const val = alphabet.indexOf(char.toUpperCase());
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generarTotp(secretBase32) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const codeInt =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(codeInt % 1000000).padStart(6, '0');
}

async function main() {
  console.log('1. Creando cuenta temporal admin_plataforma...');
  const { data: userData, error: errorUser } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (errorUser) throw errorUser;
  const usuarioId = userData.user.id;

  const { error: errorPerfil } = await admin
    .from('usuarios')
    .insert({ id: usuarioId, rol: 'admin_plataforma', nombre: 'Temp Verificacion MFA Recuperacion' });
  if (errorPerfil) throw errorPerfil;
  console.log('   OK, usuario_id =', usuarioId);

  console.log('2. Login como el usuario temporal...');
  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: signIn, error: errorSignIn } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (errorSignIn) throw errorSignIn;
  const accessToken = signIn.session.access_token;
  const userClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  console.log('3. Enrolando factor TOTP (simulando la app autenticadora)...');
  const { data: enrollData, error: errorEnroll } = await userClient.auth.mfa.enroll({ factorType: 'totp' });
  if (errorEnroll) throw errorEnroll;
  const factorId = enrollData.id;
  const secret = enrollData.totp.secret;

  const { data: challengeData, error: errorChallenge } = await userClient.auth.mfa.challenge({ factorId });
  if (errorChallenge) throw errorChallenge;

  const codigoTotp = generarTotp(secret);
  const { error: errorVerify } = await userClient.auth.mfa.verify({
    factorId,
    challengeId: challengeData.id,
    code: codigoTotp,
  });
  if (errorVerify) throw errorVerify;
  console.log('   Factor TOTP enrolado y verificado. factorId =', factorId);

  const { data: factoresAntes } = await admin.auth.admin.mfa.listFactors({ userId: usuarioId });
  console.log('   Factores TOTP antes de recuperar:', factoresAntes.factors.filter((f) => f.factor_type === 'totp').length);

  console.log('4. Llamando POST /api/panel/mfa-recuperacion/solicitar (endpoint real)...');
  const respSolicitar = await fetch(`${API_URL}/api/panel/mfa-recuperacion/solicitar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const jsonSolicitar = await respSolicitar.json();
  console.log('   status:', respSolicitar.status, jsonSolicitar);
  if (!respSolicitar.ok) throw new Error('solicitar falló: ' + JSON.stringify(jsonSolicitar));

  const { data: filaCodigo } = await admin
    .from('mfa_codigos_recuperacion')
    .select('id, expira_at, usado')
    .eq('usuario_id', usuarioId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  console.log('   Fila insertada en mfa_codigos_recuperacion:', filaCodigo);

  console.log('5. Probando código incorrecto contra POST /confirmar (debe fallar)...');
  const respMalo = await fetch(`${API_URL}/api/panel/mfa-recuperacion/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ codigo: '000000' }),
  });
  console.log('   status (esperado 400):', respMalo.status, await respMalo.json());

  console.log('6. Insertando un código de recuperación conocido (simulando el que llegaría por email) y confirmando...');
  const codigoConocido = '482913';
  const hash = crypto.createHash('sha256').update(codigoConocido).digest('hex');
  await admin
    .from('mfa_codigos_recuperacion')
    .update({ usado: true, usado_en: new Date().toISOString() })
    .eq('usuario_id', usuarioId)
    .eq('usado', false);
  await admin.from('mfa_codigos_recuperacion').insert({
    usuario_id: usuarioId,
    codigo_hash: hash,
    expira_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  const respBueno = await fetch(`${API_URL}/api/panel/mfa-recuperacion/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ codigo: codigoConocido }),
  });
  console.log('   status (esperado 200):', respBueno.status, await respBueno.json());
  if (!respBueno.ok) throw new Error('confirmar con código válido falló');

  console.log('7. Verificando que el factor TOTP fue dado de baja...');
  const { data: factoresDespues } = await admin.auth.admin.mfa.listFactors({ userId: usuarioId });
  const totpDespues = factoresDespues.factors.filter((f) => f.factor_type === 'totp');
  console.log('   Factores TOTP después de recuperar:', totpDespues.length, '(esperado 0)');
  if (totpDespues.length !== 0) throw new Error('El factor TOTP no fue eliminado');

  console.log('8. Probando reusar el mismo código (debe fallar, ya usado)...');
  const respReuso = await fetch(`${API_URL}/api/panel/mfa-recuperacion/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ codigo: codigoConocido }),
  });
  console.log('   status (esperado 400):', respReuso.status, await respReuso.json());

  console.log('\nTODO OK. usuario_id para limpieza:', usuarioId);
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});

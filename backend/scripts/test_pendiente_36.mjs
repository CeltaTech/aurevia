// Prueba puntual del pendiente #36 (2026-07-15, reescrita el 2026-07-28 para la Etapa 2) —
// confirma que quien entra por una sesión de soporte técnico puede leer/editar Configuración
// sin el 403 que tenía antes del fix en panelConfiguracion.js, y que sin sesión abierta y sin
// Prestadora propia recibe un 400 entendible en vez de romper.
// Corre contra el backend local. Borra todo lo que crea al terminar.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
dotenv.config();

const API = 'http://localhost:4000/api/panel';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const panelEnv = readFileSync(new URL('../../panel/.env', import.meta.url), 'utf8');
const anonKey = panelEnv.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim();
const anon = createClient(process.env.SUPABASE_URL, anonKey);

const SANDBOX_ID = '5d727437-a5ff-432f-b9f6-10015e61ffef';
const EMAIL = 'alas.para.escribir.2026+pendiente36.test@gmail.com';
const PASSWORD = 'Pendiente36Test2026!';

let authUserId;

async function main() {
  const { data: auth, error: errorAuth } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
  });
  if (errorAuth) throw errorAuth;
  authUserId = auth.user.id;

  const { error: errorUsuario } = await admin.from('usuarios').insert({
    id: authUserId, rol: 'superadmin', nombre: 'PRUEBA temporal — pendiente #36',
  });
  if (errorUsuario) throw errorUsuario;

  const { data: sesion, error: errorLogin } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (errorLogin) throw errorLogin;
  const token = sesion.session.access_token;
  const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  // 1. Sin sesión de tenant activa: debe dar 400 explícito, no 403 ni crash
  const rSinTenant = await fetch(`${API}/configuracion/empresa`, { headers: headers() });
  console.log('1. GET /configuracion/empresa sin sesión de tenant:', rSinTenant.status);
  if (rSinTenant.status !== 400) throw new Error('FALLO: esperaba 400 sin sesión de tenant, dio ' + rSinTenant.status);

  // 2. Entrar a la prestadora sandbox
  const rEntrar = await fetch(`${API}/sesion-tenant`, { method: 'POST', headers: headers(), body: JSON.stringify({ prestadora_id: SANDBOX_ID }) });
  console.log('2. POST /sesion-tenant (entrar a sandbox):', rEntrar.status);
  if (!rEntrar.ok) throw new Error('FALLO al entrar a la prestadora: ' + (await rEntrar.text()));

  // 3. Con sesión de tenant activa, antes del fix esto daba 403 — ahora debe dar 200
  const rConTenant = await fetch(`${API}/configuracion/empresa`, { headers: headers() });
  const jConTenant = await rConTenant.json();
  console.log('3. GET /configuracion/empresa con sesión de tenant activa:', rConTenant.status, jConTenant.empresa ? '(datos recibidos)' : jConTenant);
  if (rConTenant.status !== 200) throw new Error('FALLO: esperaba 200 con sesión de tenant activa, dio ' + rConTenant.status + ' — ' + JSON.stringify(jConTenant));

  // 4. Otra ruta del mismo router (zonas), para confirmar que el fix cubre todo el router, no solo /empresa
  const rZonas = await fetch(`${API}/configuracion/zonas`, { headers: headers() });
  console.log('4. GET /configuracion/zonas con sesión de tenant activa:', rZonas.status);
  if (rZonas.status !== 200) throw new Error('FALLO: esperaba 200 en /zonas, dio ' + rZonas.status);

  console.log('Pendiente #36 verificado correctamente: 400 sin sesión de tenant, 200 en /empresa y /zonas con sesión activa.');
}

async function limpiar() {
  if (authUserId) {
    // el paso 2 (entrar a la Prestadora) deja fila en sesiones_soporte_tecnico y en
    // auditoria_soporte_tecnico — hay que borrarlas antes que el usuario o el delete de abajo
    // falla en silencio por FK y deja el usuario de prueba huérfano (pasó en la corrida anterior).
    await admin.from('sesiones_soporte_tecnico').delete().eq('admin_id', authUserId);
    await admin.from('auditoria_soporte_tecnico').delete().eq('admin_id', authUserId);
    await admin.from('usuarios').delete().eq('id', authUserId);
    await admin.auth.admin.deleteUser(authUserId);
  }
  console.log('Datos de prueba borrados.');
}

main()
  .then(() => limpiar())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await limpiar();
    process.exit(1);
  });

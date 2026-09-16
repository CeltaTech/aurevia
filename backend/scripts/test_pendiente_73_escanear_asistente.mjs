// Prueba puntual del pendiente #73 (Etapa 6, 2026-07-22) — confirma el endpoint nuevo
// GET /api/app-familias/pacientes/:id/verificar-asistente/:qrToken contra Supabase real
// (prestadora Sandbox), corriendo contra el backend local. Cubre los 3 motivos posibles
// (asignado, no_asignado, sin_guardia_hoy) más un qr_token inexistente. Borra todo lo que
// crea al terminar.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
dotenv.config();

const API = 'http://localhost:4000/api/app-familias';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const pwaEnv = readFileSync(new URL('../../pwa-familias/.env', import.meta.url), 'utf8');
const anonKey = pwaEnv.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim();
const anon = createClient(process.env.SUPABASE_URL, anonKey);

const SANDBOX_ID = '5d727437-a5ff-432f-b9f6-10015e61ffef';
const EMAIL = 'alas.para.escribir.2026+pendiente73.test@gmail.com';
// La contraseña de las cuentas de prueba entra por el entorno, como cualquier credencial. Escrita
// acá queda a la vista de cualquiera que abra el repositorio, y si el script se corta antes de
// borrar lo que creó, las cuentas quedan con ella puesta. Sin la variable no arranca.
const PASSWORD = process.env.SEED_TEST_PASSWORD;
if (!PASSWORD) {
  console.error('Falta la variable SEED_TEST_PASSWORD. Es la contraseña con la que nacen las cuentas de prueba, y no se escribe en el código.');
  process.exit(1);
}

const creados = { authUserIds: [], asistenteIds: [], pacienteIds: [], guardiaIds: [] };

async function crearAsistente(nombre) {
  const { data: auth, error } = await admin.auth.admin.createUser({
    email: `alas.para.escribir.2026+pendiente73.${nombre}@gmail.com`, password: PASSWORD, email_confirm: true,
  });
  if (error) throw error;
  creados.authUserIds.push(auth.user.id);
  const { error: errorUsuario } = await admin.from('usuarios').insert({
    id: auth.user.id, rol: 'asistente', prestadora_id: SANDBOX_ID, nombre: `PRUEBA temporal — pendiente #73 (${nombre})`,
  });
  if (errorUsuario) throw errorUsuario;
  const { data: asistente, error: errorAsistente } = await admin
    .from('asistentes')
    .insert({ id: auth.user.id, prestadora_id: SANDBOX_ID, nombre: `PRUEBA temporal — ${nombre}` })
    .select('id, qr_token')
    .single();
  if (errorAsistente) throw errorAsistente;
  creados.asistenteIds.push(asistente.id);
  return asistente;
}

async function main() {
  // Familia de prueba
  const { data: authFamilia, error: errorAuth } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
  });
  if (errorAuth) throw errorAuth;
  creados.authUserIds.push(authFamilia.user.id);
  const familiaId = authFamilia.user.id;
  const { error: errorUsuarioFamilia } = await admin.from('usuarios').insert({ id: familiaId, rol: 'familia', prestadora_id: SANDBOX_ID, nombre: 'PRUEBA temporal — pendiente #73 (familia)' });
  if (errorUsuarioFamilia) throw errorUsuarioFamilia;
  const { error: errorFamilia } = await admin.from('familias').insert({ id: familiaId, prestadora_id: SANDBOX_ID });
  if (errorFamilia) throw errorFamilia;

  // Dos asistentes: uno asignado a la guardia de hoy, otro no
  const asignado = await crearAsistente('asignado');
  const sinAsignar = await crearAsistente('sin-asignar');

  // Paciente 1: tiene guardia hoy con el Asistente "asignado"
  const { data: paciente1, error: errorPac1 } = await admin
    .from('pacientes')
    .insert({ familia_id: familiaId, prestadora_id: SANDBOX_ID, nombre: 'PRUEBA temporal — Paciente 1' })
    .select('id')
    .single();
  if (errorPac1) throw errorPac1;
  creados.pacienteIds.push(paciente1.id);

  const hoyISO = new Date().toISOString().slice(0, 10);
  const { data: guardia1, error: errorGuardia1 } = await admin
    .from('guardias')
    .insert({
      prestadora_id: SANDBOX_ID, asistente_id: asignado.id, paciente_id: paciente1.id,
      fecha: hoyISO, hora_inicio: '08:00', hora_fin: '16:00', modalidad: 'domicilio',
    })
    .select('id')
    .single();
  if (errorGuardia1) throw errorGuardia1;
  creados.guardiaIds.push(guardia1.id);

  // Paciente 2: sin ninguna guardia hoy
  const { data: paciente2, error: errorPac2 } = await admin
    .from('pacientes')
    .insert({ familia_id: familiaId, prestadora_id: SANDBOX_ID, nombre: 'PRUEBA temporal — Paciente 2' })
    .select('id')
    .single();
  if (errorPac2) throw errorPac2;
  creados.pacienteIds.push(paciente2.id);

  const { data: sesion, error: errorLogin } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (errorLogin) throw errorLogin;
  const token = sesion.session.access_token;
  const headers = () => ({ Authorization: `Bearer ${token}` });

  // 1. QR del Asistente asignado, contra el Paciente que sí tiene guardia hoy con él -> coincide
  const r1 = await fetch(`${API}/pacientes/${paciente1.id}/verificar-asistente/${asignado.qr_token}`, { headers: headers() });
  const j1 = await r1.json();
  console.log('1. Asistente asignado vs guardia de hoy:', r1.status, j1.motivo, 'coincide=' + j1.coincide);
  if (r1.status !== 200 || j1.coincide !== true || j1.motivo !== 'asignado') throw new Error('FALLO caso 1: ' + JSON.stringify(j1));

  // 2. QR del Asistente NO asignado, contra el mismo Paciente -> no coincide
  const r2 = await fetch(`${API}/pacientes/${paciente1.id}/verificar-asistente/${sinAsignar.qr_token}`, { headers: headers() });
  const j2 = await r2.json();
  console.log('2. Asistente sin asignar vs guardia de hoy:', r2.status, j2.motivo, 'coincide=' + j2.coincide);
  if (r2.status !== 200 || j2.coincide !== false || j2.motivo !== 'no_asignado') throw new Error('FALLO caso 2: ' + JSON.stringify(j2));

  // 3. QR válido, contra un Paciente sin guardia hoy -> sin_guardia_hoy
  const r3 = await fetch(`${API}/pacientes/${paciente2.id}/verificar-asistente/${asignado.qr_token}`, { headers: headers() });
  const j3 = await r3.json();
  console.log('3. Paciente sin guardia hoy:', r3.status, j3.motivo);
  if (r3.status !== 200 || j3.motivo !== 'sin_guardia_hoy') throw new Error('FALLO caso 3: ' + JSON.stringify(j3));

  // 4. qr_token inexistente -> 404
  const r4 = await fetch(`${API}/pacientes/${paciente1.id}/verificar-asistente/token-que-no-existe`, { headers: headers() });
  console.log('4. qr_token inexistente:', r4.status);
  if (r4.status !== 404) throw new Error('FALLO caso 4: esperaba 404, dio ' + r4.status);

  console.log('Pendiente #73 (endpoint verificar-asistente) verificado correctamente: los 4 casos dieron el resultado esperado.');
}

async function limpiar() {
  for (const id of creados.guardiaIds) await admin.from('guardias').delete().eq('id', id);
  for (const id of creados.pacienteIds) await admin.from('pacientes').delete().eq('id', id);
  await admin.from('familias').delete().in('id', creados.authUserIds);
  for (const id of creados.asistenteIds) await admin.from('asistentes').delete().eq('id', id);
  await admin.from('usuarios').delete().in('id', creados.authUserIds);
  for (const id of creados.authUserIds) await admin.auth.admin.deleteUser(id);
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

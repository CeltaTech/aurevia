// Verificación manual del Bloque 3 (filtrado de tenant en rutas backend con Service Role Key).
// Corre contra Supabase real. No hay suite de tests automatizada en backend/ — este script
// queda en el repo (a pedido del usuario, 2026-07-10) para poder re-confirmar el aislamiento
// más adelante, en vez de descartarlo después de correrlo una vez.
//
// Cubre dos tipos de chequeo:
//   1. Lectura simple (GET) comparada contra ground truth vía Service Role Key.
//   2. Aislamiento cross-tenant activo: fabrica una segunda prestadora + fila real de
//      usuario/solicitud/postulación, e intenta operar sobre ellas desde la sesión del
//      admin de la prestadora real — debe fallar en los 3 puntos que en algún
//      momento no tuvieron verificación de tenant propia: DELETE de usuarios
//      (`cuentasPanel.js` `borrarCuenta`), y las altas de cuenta familia/asistente que
//      resuelven `solicitudId`/`postulacionId` (`panelCuentas.js`).
//
// Requiere el backend corriendo localmente (BACKEND_URL, default http://localhost:4502) y las
// siguientes variables de entorno (no hardcodeadas — este script se commitea al repo):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (o el publishable key)
//   PANEL_TEST_EMAIL, PANEL_TEST_PASSWORD (cuenta admin_prestadora real de prueba)
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.PANEL_TEST_EMAIL;
const PASSWORD = process.env.PANEL_TEST_PASSWORD;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4502';

for (const [nombre, valor] of Object.entries({ SUPABASE_URL, SERVICE_KEY, ANON_KEY, EMAIL, PASSWORD })) {
  if (!valor) throw new Error(`Falta la variable de entorno para ${nombre}`);
}

async function login() {
  const supabase = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) throw new Error('Login falló: ' + error.message);
  return { supabase, token: data.session.access_token, userId: data.user.id };
}

async function checkLecturaSimple(admin, headers, prestadoraId) {
  const resUsuarios = await fetch(`${BACKEND_URL}/api/panel/usuarios`, { headers });
  const bodyUsuarios = await resUsuarios.json();
  console.log('GET /panel/usuarios ->', resUsuarios.status, `(${bodyUsuarios.usuarios?.length ?? 0} filas)`);

  const resZonas = await fetch(`${BACKEND_URL}/api/panel/configuracion/zonas`, { headers });
  const bodyZonas = await resZonas.json();
  console.log('GET /panel/configuracion/zonas ->', resZonas.status, `(${bodyZonas.zonas?.length ?? 0} filas)`);

  // El camino público lleva a la Prestadora en la dirección (su dominio configurado), no en un
  // encabezado — ver backend/src/middleware/resolverPrestadoraPublica.js.
  const { data: configPublica } = await admin
    .from('configuracion_prestadora')
    .select('dominio')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (configPublica?.dominio) {
    const resPublica = await fetch(`${BACKEND_URL}/api/publico/${configPublica.dominio}/configuracion`);
    const bodyPublica = await resPublica.json();
    console.log('GET /publico/:prestadora/configuracion ->', resPublica.status, `(${bodyPublica.zonas?.length ?? 0} zonas)`);
  } else {
    console.log('GET /publico/:prestadora/configuracion -> omitido (esta Prestadora no tiene dominio público configurado)');
  }

  const { count: countUsuariosGT } = await admin
    .from('usuarios')
    .select('*', { count: 'exact', head: true })
    .eq('prestadora_id', prestadoraId)
    .in('rol', ['admin_prestadora', 'coordinador', 'superadmin']);
  console.log('Ground truth usuarios (misma prestadora, roles panel):', countUsuariosGT);
  console.log(countUsuariosGT === (bodyUsuarios.usuarios?.length ?? -1) ? 'OK — panelUsuarios coincide con ground truth' : '¡DIFERENCIA en panelUsuarios!');

  const { count: countZonasGT } = await admin
    .from('zonas_cobertura')
    .select('*', { count: 'exact', head: true })
    .eq('prestadora_id', prestadoraId);
  console.log('Ground truth zonas (misma prestadora):', countZonasGT);
  console.log(countZonasGT === (bodyZonas.zonas?.length ?? -1) ? 'OK — panelConfiguracion/zonas coincide con ground truth' : '¡DIFERENCIA en zonas!');
}

async function checkAislamientoCrossTenant(admin, headers) {
  // Fabrica una segunda prestadora real + un usuario, una solicitud y una postulación reales
  // que pertenecen a ella — para poder intentar operar sobre ellas desde la sesión de la prestadora real.
  const { data: prestadora, error: errP } = await admin.from('prestadoras').insert({
    razon_social: 'TEST BLOQUE3 SA',
    nombre_fantasia: 'Test Bloque 3',
    identificacion_fiscal: '20-99999999-9',
    pais: 'AR',
    estado: 'certificada',
    fecha_alta: new Date().toISOString().slice(0, 10),
  }).select().single();
  if (errP) throw errP;

  const emailFake = `test.bloque3.${Date.now()}@example.com`;
  const { data: authData, error: errAuth } = await admin.auth.admin.createUser({
    email: emailFake, password: 'TestPassword123!', email_confirm: true,
  });
  if (errAuth) throw errAuth;
  const { error: errPerfil } = await admin.from('usuarios').insert({
    id: authData.user.id, rol: 'coordinador', nombre: 'TEST BLOQUE3', prestadora_id: prestadora.id,
  });
  if (errPerfil) throw errPerfil;

  const { data: solicitud, error: errSol } = await admin.from('solicitudes').insert({
    nombre: 'TEST', telefono: 'T', email: 't@t.com', localidad: 'T',
    tipo_servicio: 'T', modalidad: 'T', dias_horario: 'T', prestadora_id: prestadora.id,
  }).select().single();
  if (errSol) throw errSol;

  const { data: postulacion, error: errPost } = await admin.from('postulaciones').insert({
    nombre: 'TEST', dni: '12345678', telefono: 'T', email: 't@t.com',
    especialidades: 'T', zonas: 'T', disponibilidad: 'T', situacion_fiscal: 'T',
    prestadora_id: prestadora.id,
  }).select().single();
  if (errPost) throw errPost;

  let resultados = [];

  try {
    // 1. DELETE cross-tenant de usuarios (cuentasPanel.js:borrarCuenta)
    const resDelete = await fetch(`${BACKEND_URL}/api/panel/usuarios/${authData.user.id}`, {
      method: 'DELETE', headers,
    });
    const sigueExistiendo = await admin.from('usuarios').select('id').eq('id', authData.user.id).maybeSingle();
    const okDelete = resDelete.status !== 200 && !!sigueExistiendo.data;
    resultados.push(['DELETE /panel/usuarios/:id cross-tenant', okDelete]);
    console.log(`DELETE /panel/usuarios/:id cross-tenant -> ${resDelete.status}`, okDelete ? '— OK, rechazado y no borrado' : '— ¡FALLA, borró o no rechazó!');

    // 2. Alta de familia contra una solicitud de otra prestadora (panelCuentas.js)
    const resFamilia = await fetch(`${BACKEND_URL}/api/panel/cuentas/familia`, {
      method: 'POST', headers, body: JSON.stringify({ solicitudId: solicitud.id }),
    });
    const okFamilia = resFamilia.status === 404;
    resultados.push(['POST /panel/cuentas/familia cross-tenant', okFamilia]);
    console.log(`POST /panel/cuentas/familia cross-tenant -> ${resFamilia.status}`, okFamilia ? '— OK, no encontrada' : '— ¡FALLA, no rechazó la solicitud de otra prestadora!');

    // 3. Alta de asistente contra una postulación de otra prestadora (panelCuentas.js)
    const resAsistente = await fetch(`${BACKEND_URL}/api/panel/cuentas/asistente`, {
      method: 'POST', headers, body: JSON.stringify({ postulacionId: postulacion.id }),
    });
    const okAsistente = resAsistente.status === 404;
    resultados.push(['POST /panel/cuentas/asistente cross-tenant', okAsistente]);
    console.log(`POST /panel/cuentas/asistente cross-tenant -> ${resAsistente.status}`, okAsistente ? '— OK, no encontrada' : '— ¡FALLA, no rechazó la postulación de otra prestadora!');
  } finally {
    // Limpieza completa, corra como corra el bloque try.
    await admin.from('solicitudes').delete().eq('id', solicitud.id);
    await admin.from('postulaciones').delete().eq('id', postulacion.id);
    await admin.from('usuarios').delete().eq('id', authData.user.id);
    await admin.auth.admin.deleteUser(authData.user.id);
    await admin.from('prestadoras').delete().eq('id', prestadora.id);
  }

  return resultados;
}

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { supabase, token, userId } = await login();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const { data: perfil } = await admin.from('usuarios').select('prestadora_id').eq('id', userId).single();
  const prestadoraId = perfil.prestadora_id;

  await checkLecturaSimple(admin, headers, prestadoraId);
  const resultadosAislamiento = await checkAislamientoCrossTenant(admin, headers);

  await supabase.auth.signOut();

  const fallas = resultadosAislamiento.filter(([, ok]) => !ok);
  if (fallas.length) {
    console.error(`\n${fallas.length} chequeo(s) de aislamiento cross-tenant fallaron: ${fallas.map(([n]) => n).join(', ')}`);
    process.exit(1);
  }
  console.log('\nOK — todos los chequeos de aislamiento cross-tenant pasaron.');
}

main().catch((e) => { console.error(e); process.exit(1); });

// ---------------------------------------------------------------------------
// test_etapa2_sesion_soporte.mjs — prueba de punta a punta de la Etapa 2
// (2026-07-28): la "sesión de soporte técnico", que antes era del rol comercial
// admin_plataforma, ahora es de superadmin y sigue dejando el mismo rastro
// auditado.
//
// SOLO CONTRA LA BASE LOCAL. El script crea un superadmin y una Prestadora de
// juguete, así que corre un chequeo previo y se niega a arrancar si la URL de
// Supabase no es localhost. Es a propósito: los otros test_*.js de esta carpeta
// leen el .env, que apunta a producción, y esa distracción no puede repetirse.
//
// Cómo correrlo, desde productos/aurevia/:
//
//   1. npx supabase start
//   2. arrancar el backend apuntado a la base local, por ejemplo:
//        cd backend && DOTENV_CONFIG_PATH=.env.local node -r dotenv/config src/server.js
//   3. cd backend && SUPABASE_URL=http://127.0.0.1:54421 \
//        SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
//        node scripts/test_etapa2_sesion_soporte.mjs
//
//   (las dos claves las imprime `npx supabase status`)
//
// Borra todo lo que crea, pase o falle.
// ---------------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js';

const API_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:4000';

if (!API_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SUPABASE_ANON_KEY. Ver el encabezado de este archivo.');
  process.exit(1);
}

// El guardarraíl. No hay bandera para saltearlo.
const anfitrion = new URL(API_URL).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(anfitrion)) {
  console.error(`\n✗ Esta prueba crea y borra datos: corre únicamente contra la base local.`);
  console.error(`  SUPABASE_URL apunta a "${anfitrion}", que no es localhost. Abortado.\n`);
  process.exit(1);
}

const API = `${BACKEND}/api/panel`;
const admin = createClient(API_URL, SERVICE_ROLE_KEY);
const anon = createClient(API_URL, ANON_KEY);

const EMAIL = 'prueba.etapa2@local.celtatech.com';
const PASSWORD = 'local-dev-1234';

let authUserId, prestadoraId, prestadoraIdB, coladoId;
const fallos = [];

function chequear(n, ok, detalle) {
  console.log(`${ok ? 'OK  ' : 'MAL '} ${n}${detalle ? ' — ' + detalle : ''}`);
  if (!ok) fallos.push(n);
}

async function main() {
  const { data: p, error: eP } = await admin.from('prestadoras').insert({
    razon_social: 'PRUEBA local Etapa 2', nombre_fantasia: 'PRUEBA local', pais: 'AR', estado: 'prospecto',
  }).select('id').single();
  if (eP) throw eP;
  prestadoraId = p.id;
  // una Prestadora real nace con su fila de configuración; acá se crea a mano
  await admin.from('configuracion_prestadora').insert({ prestadora_id: prestadoraId, nombre: 'PRUEBA local' });

  const { data: a, error: eA } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (eA) throw eA;
  authUserId = a.user.id;

  // superadmin sin Organización propia: lo permite la restricción nueva
  // usuarios_prestadora_id_solo_superadmin_null
  const { error: eU } = await admin.from('usuarios').insert({
    id: authUserId, rol: 'superadmin', nombre: 'PRUEBA local Etapa 2', prestadora_id: null,
  });
  chequear('1. se puede crear un superadmin sin Prestadora propia', !eU, eU?.message);
  if (eU) throw eU;

  const { data: s, error: eL } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (eL) throw eL;
  const h = { Authorization: `Bearer ${s.session.access_token}`, 'Content-Type': 'application/json' };

  const rRol = await fetch(`${API}/prestadoras`, { headers: h });
  const jRol = await rRol.json();
  chequear('2. superadmin lista Prestadoras', rRol.status === 200 && jRol.prestadoras?.some((x) => x.id === prestadoraId), 'status ' + rRol.status);

  const r0 = await fetch(`${API}/sesion-tenant`, { headers: h });
  const j0 = await r0.json();
  chequear('3. arranca sin sesión de soporte abierta', r0.status === 200 && j0.sesion === null, 'status ' + r0.status);

  const rCfg0 = await fetch(`${API}/configuracion/empresa`, { headers: h });
  chequear('4. sin sesión ni Prestadora propia, Configuración corta con 400 entendible', rCfg0.status === 400, 'status ' + rCfg0.status);

  const rIn = await fetch(`${API}/sesion-tenant`, { method: 'POST', headers: h, body: JSON.stringify({ prestadora_id: prestadoraId }) });
  chequear('5. superadmin abre la sesión de soporte', rIn.status === 200, 'status ' + rIn.status + ' ' + (rIn.ok ? '' : await rIn.text()));

  const rIn2 = await fetch(`${API}/sesion-tenant`, { method: 'POST', headers: h, body: JSON.stringify({ prestadora_id: prestadoraId }) });
  chequear('6. no deja abrir una segunda sesión a la vez (409)', rIn2.status === 409, 'status ' + rIn2.status);

  const rCfg1 = await fetch(`${API}/configuracion/empresa`, { headers: h });
  chequear('7. con la sesión abierta, Configuración responde', rCfg1.status === 200, 'status ' + rCfg1.status);

  // una escritura cualquiera dentro de la Prestadora visitada tiene que dejar rastro
  const rZona = await fetch(`${API}/configuracion/zonas`, { method: 'POST', headers: h, body: JSON.stringify({ codigo: 'PRB', nombre: 'Zona de prueba Etapa 2', categoria: 'principal' }) });
  await new Promise((r) => setTimeout(r, 700)); // la auditoría se escribe en res.on('finish')
  const { data: audit } = await admin.from('auditoria_soporte_tecnico').select('tipo_evento, prestadora_id, detalle').eq('admin_id', authUserId).order('created_at');
  const hayLogin = audit?.some((e) => e.tipo_evento === 'login' && e.prestadora_id === prestadoraId);
  const hayMutacion = audit?.some((e) => e.tipo_evento === 'mutacion');
  chequear('8. queda auditado el ingreso', hayLogin, `${audit?.length ?? 0} evento(s)`);
  chequear('9. queda auditada la escritura hecha adentro', hayMutacion, 'POST /zonas dio ' + rZona.status);

  const rOut = await fetch(`${API}/sesion-tenant/salir`, { method: 'POST', headers: h });
  chequear('10. superadmin cierra la sesión de soporte', rOut.status === 200, 'status ' + rOut.status);

  const r1 = await fetch(`${API}/sesion-tenant`, { headers: h });
  const j1 = await r1.json();
  chequear('11. después de salir ya no hay sesión abierta', j1.sesion === null);

  const rCfg2 = await fetch(`${API}/configuracion/empresa`, { headers: h });
  chequear('12. y Configuración vuelve a cortar con 400', rCfg2.status === 400, 'status ' + rCfg2.status);

  // -------------------------------------------------------------------------
  // Pendiente #98 (cerrado el 2026-07-28): que la sesión de soporte no sea
  // optativa. Antes, superadmin veía y tocaba datos de cualquier Prestadora sin
  // abrir ninguna sesión, porque el filtro por Organización tenía escrita la
  // excepción `if (rol !== 'superadmin')` en 40 lugares. Estos chequeos usan una
  // SEGUNDA Prestadora, la B, en la que nunca se entra.
  // -------------------------------------------------------------------------
  const { data: pB, error: ePB } = await admin.from('prestadoras').insert({
    razon_social: 'PRUEBA local Etapa 2 B', nombre_fantasia: 'PRUEBA local B', pais: 'AR', estado: 'prospecto',
  }).select('id').single();
  if (ePB) throw ePB;
  prestadoraIdB = pB.id;
  await admin.from('configuracion_prestadora').insert({ prestadora_id: prestadoraIdB, nombre: 'PRUEBA local B' });
  const { data: zB } = await admin.from('zonas_cobertura').insert({
    prestadora_id: prestadoraIdB, codigo: 'PRBB', nombre: 'Zona secreta de la Prestadora B', categoria: 'principal',
  }).select('id').single();

  const rZonasSinSesion = await fetch(`${API}/configuracion/zonas`, { headers: h });
  chequear('13. sin sesión abierta, no se llega a ningún dato de ninguna Prestadora (400)',
    rZonasSinSesion.status === 400, 'status ' + rZonasSinSesion.status);

  // se vuelve a entrar, pero a la Prestadora A: la B tiene que seguir invisible
  await fetch(`${API}/sesion-tenant`, { method: 'POST', headers: h, body: JSON.stringify({ prestadora_id: prestadoraId }) });

  const rZonasA = await fetch(`${API}/configuracion/zonas`, { headers: h });
  const jZonasA = await rZonasA.json();
  const veLaDeB = (jZonasA.zonas ?? jZonasA ?? []).some?.((z) => z.prestadora_id === prestadoraIdB);
  chequear('14. dentro de la Prestadora A no se ven las zonas de la B', rZonasA.status === 200 && !veLaDeB,
    'status ' + rZonasA.status);

  await fetch(`${API}/configuracion/zonas/${zB.id}`, { method: 'DELETE', headers: h });
  const { data: zBSigue } = await admin.from('zonas_cobertura').select('id').eq('id', zB.id).maybeSingle();
  chequear('15. tampoco se puede borrar una zona de la B desde adentro de la A', Boolean(zBSigue),
    zBSigue ? 'la fila sigue ahí' : 'LA BORRÓ');

  // el atajo viejo: mandar la Prestadora destino en el cuerpo del pedido
  const emailCol = 'prueba.etapa2.colado@local.celtatech.com';
  const rColado = await fetch(`${API}/usuarios`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ email: emailCol, nombre: 'Colado', rol: 'coordinador', prestadora_id: prestadoraIdB }),
  });
  const jColado = await rColado.json();
  coladoId = jColado.id;
  const { data: colado } = coladoId
    ? await admin.from('usuarios').select('prestadora_id').eq('id', coladoId).maybeSingle()
    : { data: null };
  chequear('16. el alta ignora la Prestadora que venga en el pedido y usa la de la sesión',
    rColado.status === 200 && colado?.prestadora_id === prestadoraId,
    colado ? 'quedó en ' + (colado.prestadora_id === prestadoraId ? 'la A, correcto' : 'OTRA') : 'no se creó');

  await fetch(`${API}/sesion-tenant/salir`, { method: 'POST', headers: h });

  // el rol viejo ya no existe: la base tiene que rechazarlo
  const { error: eViejo } = await admin.from('usuarios').update({ rol: 'admin_plataforma' }).eq('id', authUserId);
  chequear('17. la base rechaza el rol admin_plataforma', Boolean(eViejo), eViejo ? 'rechazado como corresponde' : 'LO ACEPTÓ');
}

async function limpiar() {
  if (authUserId) {
    await admin.from('auditoria_soporte_tecnico').delete().eq('admin_id', authUserId);
    await admin.from('sesiones_soporte_tecnico').delete().eq('admin_id', authUserId);
    await admin.from('usuarios').delete().eq('id', authUserId);
    await admin.auth.admin.deleteUser(authUserId);
  }
  if (coladoId) {
    await admin.from('usuarios').delete().eq('id', coladoId);
    await admin.auth.admin.deleteUser(coladoId);
  }
  for (const pid of [prestadoraId, prestadoraIdB]) {
    if (!pid) continue;
    await admin.from('zonas_cobertura').delete().eq('prestadora_id', pid);
    await admin.from('configuracion_prestadora').delete().eq('prestadora_id', pid);
    await admin.from('prestadoras').delete().eq('id', pid);
  }
  console.log('\nDatos de prueba borrados.');
}

main()
  .catch((e) => { console.error('\nSE CORTÓ:', e.message); fallos.push('excepción: ' + e.message); })
  .then(limpiar)
  .then(() => {
    console.log(fallos.length ? `\nRESULTADO: ${fallos.length} fallo(s): ${fallos.join(' | ')}` : '\nRESULTADO: los 17 chequeos pasaron.');
    process.exit(fallos.length ? 1 : 0);
  });

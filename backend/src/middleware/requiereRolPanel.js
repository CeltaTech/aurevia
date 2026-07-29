import { supabase } from '../db/connection.js';

// Ítem D del pendiente #30 (docs/PLAN_MULTITENANT_CELTATECH.md 3.4.1): tope de 5 min de
// inactividad dentro de la sesión de soporte técnico — se corta en silencio, sin aviso previo,
// distinto del tope absoluto de 60 min (que sí tiene aviso a los 50, ver panelSesionTenant.js).
const INACTIVIDAD_LIMITE_MS = 5 * 60 * 1000;

// Ítem G del pendiente #30: las mutaciones que pasan por rutas Express usan la service
// role key (backend/src/db/connection.js) — sin JWT de usuario, así que los triggers de
// auditoria_soporte_tecnico no las ven, porque auth.uid() da NULL dentro de un trigger
// disparado por una escritura con service role.
// Se audita acá, a nivel de request, en vez de a nivel de tabla/fila.
const METODOS_MUTACION = ['POST', 'PUT', 'PATCH', 'DELETE'];

async function registrarAuditoriaMutacionExpress({ adminId, prestadoraId, metodo, ruta }) {
  const { error } = await supabase.from('auditoria_soporte_tecnico').insert({
    admin_id: adminId,
    prestadora_id: prestadoraId,
    tipo_evento: 'mutacion',
    detalle: { metodo, ruta },
  });
  if (error) console.error('Error registrando auditoría de soporte técnico (Express):', error.message);
}

// Ítem H del pendiente #30: decodifica el claim `aal` del JWT ya validado por
// supabase.auth.getUser() más arriba (no hace falta reverificar firma, solo leer el
// payload) — Supabase no expone el AAL en el objeto `user`, solo en el JWT en sí.
function leerAalDelToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.aal ?? null;
  } catch {
    return null;
  }
}

export async function requiereRolPanel(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { data: userData, error: errorUsuario } = await supabase.auth.getUser(token);
  if (errorUsuario || !userData?.user) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { data: perfil, error: errorPerfil } = await supabase
    .from('usuarios')
    .select('rol, prestadora_id')
    .eq('id', userData.user.id)
    .single();

  if (errorPerfil || !perfil || !['admin_prestadora', 'coordinador', 'superadmin'].includes(perfil.rol)) {
    return res.status(403).json({ error: 'Rol sin permiso' });
  }

  if (perfil.rol === 'superadmin') {
    const { data: configPlataforma } = await supabase
      .from('configuracion_plataforma')
      .select('mfa_admin_obligatorio')
      .single();
    if (configPlataforma?.mfa_admin_obligatorio && leerAalDelToken(token) !== 'aal2') {
      return res.status(403).json({ error: 'MFA requerido', codigo: 'mfa_requerido' });
    }
  }

  let prestadoraId = perfil.prestadora_id;
  let dentroDeSesionSoporte = false;

  // Etapa 2 de la separación CeltaTech / Aurevia (2026-07-28): la sesión de soporte técnico
  // era exclusiva de admin_plataforma, el rol comercial que se fue a CeltaTech. Ahora es de
  // superadmin, el rol técnico (CLAUDE.md §5).
  // Superadmin sin sesión de soporte abierta sigue viendo únicamente su propia Organización
  // (Sandbox, por su prestadora_id). Con sesión abierta, ve la Prestadora de esa sesión.
  // Es exactamente el mismo orden de precedencia que la función SQL current_tenant(), que es
  // el punto único de verdad para RLS (CLAUDE.md §7.12) — acá se replica para que el resto de
  // las rutas reutilice el mismo req.usuarioPanel.prestadoraId sin branches por rol.
  if (perfil.rol === 'superadmin') {
    const { data: sesion } = await supabase
      .from('sesiones_soporte_tecnico')
      .select('id, prestadora_id, expira_at, ultima_actividad_at')
      .eq('admin_id', userData.user.id)
      .is('salida_at', null)
      .order('entrada_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const ahora = new Date();
    const vigente = Boolean(
      sesion &&
        new Date(sesion.expira_at) > ahora &&
        ahora.getTime() - new Date(sesion.ultima_actividad_at).getTime() <= INACTIVIDAD_LIMITE_MS
    );

    // El cierre real de la sesión vencida (salida_at) lo hace GET /sesion-tenant, que el
    // frontend hace polling cada 30s — acá alcanza con no exponer prestadoraId si no está
    // vigente, más info directa a Supabase con RLS queda igual bloqueada por current_tenant().
    // El polling de estado (GET /sesion-tenant) y el heartbeat de actividad (POST /actividad)
    // no bumpean acá — /actividad ya lo hace explícitamente, y contar el polling como
    // actividad real anularía el propio timeout de inactividad.
    const esRutaPropiaDeSesion = req.baseUrl === '/api/panel/sesion-tenant';
    if (sesion && vigente && !esRutaPropiaDeSesion) {
      await supabase
        .from('sesiones_soporte_tecnico')
        .update({ ultima_actividad_at: ahora.toISOString() })
        .eq('id', sesion.id);
    }

    if (vigente) {
      prestadoraId = sesion.prestadora_id;
      dentroDeSesionSoporte = true;
    }
  }

  // `prestadoraId` es la Organización sobre la que se está trabajando ahora (la de la sesión de
  // soporte si hay una abierta). `organizacionPropiaId` es la Organización a la que pertenece la
  // cuenta en sí, que no cambia al entrar a una Prestadora. Casi todo el código quiere la
  // primera; la segunda hace falta en el único lugar donde importa de quién es la cuenta y no
  // dónde está parada: al dar de alta otra cuenta superadmin (panelUsuarios.js).
  req.usuarioPanel = {
    id: userData.user.id,
    rol: perfil.rol,
    prestadoraId,
    organizacionPropiaId: perfil.prestadora_id,
    dentroDeSesionSoporte,
  };

  // La ruta de sesión de soporte (entrar/salir/renovar) ya audita login/logout/renovación
  // explícitamente (panelSesionTenant.js) — no duplicar acá como "mutacion" genérica.
  // Solo se audita lo que pasa dentro de una Prestadora ajena: el trabajo de superadmin en su
  // propia Organización (Sandbox) no genera registro de soporte.
  const esRutaPropiaDeSesion = req.baseUrl === '/api/panel/sesion-tenant';
  if (dentroDeSesionSoporte && METODOS_MUTACION.includes(req.method) && !esRutaPropiaDeSesion) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        registrarAuditoriaMutacionExpress({
          adminId: userData.user.id,
          prestadoraId,
          metodo: req.method,
          ruta: req.originalUrl,
        });
      }
    });
  }

  next();
}

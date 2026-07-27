// Superadmin es un quinto rol real, distinto de Admin_prestadora (ver CLAUDE.md,
// docs/CONTEXT.md), pero tiene todo el acceso de Admin_prestadora más el técnico
// (Módulo 8). Por eso cualquier chequeo que compara contra 'admin_prestadora' pasa a
// usar este helper en vez de repetir la comparación.
//
// Rename admin → admin_prestadora completado (Bloque 2 del kickoff,
// docs/PLAN_MULTITENANT_CELTATECH.md 4.1): el dato en `usuarios.rol` ya dice
// 'admin_prestadora', no 'admin'.
//
// admin_plataforma (pendiente #30, docs/PLAN_MULTITENANT_CELTATECH.md 3.4/3.4.1) suma acá
// desde 2026-07-14: administra cualquier prestadora, una a la vez, mientras tiene una
// sesión activa en sesiones_tenant_admin_plataforma — RLS via current_tenant() se
// encarga de que sin sesión activa no vea ninguna fila (COALESCE devuelve NULL).
export function esAdminOSuperior(rol) {
  return rol === 'admin_prestadora' || rol === 'superadmin' || rol === 'admin_plataforma';
}

export const ROLES_PANEL = ['admin_prestadora', 'coordinador', 'superadmin', 'admin_plataforma'];

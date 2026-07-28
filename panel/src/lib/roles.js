// Superadmin es un rol real distinto de Admin_prestadora (ver CLAUDE.md §5,
// docs/CONTEXT.md), pero tiene todo el acceso de Admin_prestadora más el técnico
// (Módulo 8). Por eso cualquier chequeo que compara contra 'admin_prestadora' pasa a
// usar este helper en vez de repetir la comparación.
//
// Rename admin → admin_prestadora completado (Bloque 2 del kickoff,
// docs/PLAN_MULTITENANT_CELTATECH.md 4.1): el dato en `usuarios.rol` ya dice
// 'admin_prestadora', no 'admin'.
//
// Etapa 2 de la separación CeltaTech / Aurevia (2026-07-28): acá también estaba
// admin_plataforma, el rol comercial. Se fue entero a CeltaTech y ya no existe dentro de
// Aurevia. Lo que hacía de técnico —entrar a una Prestadora real, una por vez— lo hace ahora
// superadmin con una sesión de soporte técnico (sesiones_soporte_tecnico); RLS via
// current_tenant() se encarga de que sin sesión abierta no vea más que su propia Organización.
export function esAdminOSuperior(rol) {
  return rol === 'admin_prestadora' || rol === 'superadmin';
}

export const ROLES_PANEL = ['admin_prestadora', 'coordinador', 'superadmin'];

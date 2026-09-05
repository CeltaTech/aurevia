// Superadmin es un rol real distinto de Admin_prestadora (ver CLAUDE.md §5,
// docs/CONTEXT.md), pero tiene todo el acceso de Admin_prestadora más el técnico
// (Módulo 8). Por eso cualquier chequeo que compara contra 'admin_prestadora' pasa a
// usar este helper en vez de repetir la comparación.
//
// Rename admin → admin_prestadora completado (Bloque 2 del kickoff): el dato en
// `usuarios.rol` ya dice 'admin_prestadora', no 'admin'.
//
// Etapa 2 de la separación CeltaTech / Careonys (2026-07-28): acá también estaba
// admin_plataforma, el rol comercial. Se fue entero a CeltaTech y ya no existe dentro de
// Careonys. Lo que hacía de técnico —entrar a una Prestadora real, una por vez— lo hace ahora
// superadmin con una sesión de soporte técnico (sesiones_soporte_tecnico); RLS via
// current_tenant() se encarga de que sin sesión abierta no vea más que su propia Organización.
// El motor usa este mismo archivo, copiado por máquina (scripts/copias_entre_apps.mjs). Hasta
// el 2026-09-04 la lista estaba escrita a mano en cinco rutas del motor y no todas decían lo
// mismo: tres funciones llamadas `requiereAdminOSuperior`, y la de marketplace dejaba pasar al
// Coordinador donde las otras dos no. Buscar el nombre daba tres resultados que parecían la
// misma función. El texto de cada error se queda en su ruta —no es lo mismo negar la
// configuración que negar una acción sobre remuneraciones—; lo que no puede diferir es quién
// entra.
// La lista y la pregunta son la misma cosa dicha de dos maneras: hay lugares que necesitan
// preguntar por un rol (`esAdminOSuperior`) y otros que necesitan la lista entera —una ruta
// protegida del Panel, un filtro contra la base—. Se define una sola y la pregunta sale de
// ella, así no puede pasar que una diga una cosa y la otra otra.
export const ROLES_ADMINISTRACION = ['admin_prestadora', 'superadmin'];

export function esAdminOSuperior(rol) {
  return ROLES_ADMINISTRACION.includes(rol);
}

export const ROLES_PANEL = [...ROLES_ADMINISTRACION, 'coordinador'];

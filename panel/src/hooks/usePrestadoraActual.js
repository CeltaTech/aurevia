import { useAuth } from '../context/AuthContext';
import { useTenantSession } from '../context/TenantSessionContext';

/**
 * De qué Prestadora se está hablando en esta pantalla, ahora mismo.
 *
 * Hay dos respuestas posibles y el orden entre ellas importa: si hay una sesión de
 * soporte técnico abierta, manda la Prestadora de esa sesión; si no, la Prestadora
 * propia del usuario. Es exactamente el mismo orden que aplica la base de datos en
 * `current_tenant()`, y esa coincidencia no es casual: si las dos no dicen lo mismo,
 * el Panel arma una consulta apuntando a una Prestadora y la base la contesta
 * apuntando a otra.
 *
 * Antes de que existiera este archivo, cada pantalla leía `usuario.prestadora_id`
 * directo, que nunca sigue la sesión de soporte. Un Superadmin adentro de una
 * Prestadora ajena veía los datos de Sandbox y, peor, guardaba filas nuevas con
 * Sandbox adentro de la Prestadora ajena. Este hook es el punto único de verdad que
 * pide la regla 12 de `CLAUDE.md` §7: la lógica está escrita una sola vez acá y el
 * resto del Panel la consume.
 *
 * Devuelve `null` mientras el usuario todavía no terminó de cargar.
 */
export function usePrestadoraActual() {
  const { usuario } = useAuth();
  const { sesion } = useTenantSession();
  return sesion?.prestadora_id ?? usuario?.prestadora_id ?? null;
}

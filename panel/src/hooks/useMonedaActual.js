import { useAuth } from '../context/AuthContext';
import { useTenantSession } from '../context/TenantSessionContext';

/**
 * En qué moneda están los importes de esta pantalla.
 *
 * Es la misma pregunta que contesta `usePrestadoraActual`, aplicada al dinero: si hay
 * una sesión de soporte técnico abierta, la moneda es la de esa Prestadora; si no, la
 * de la Prestadora propia del usuario. El orden tiene que ser el mismo que el del
 * tenant, porque si no un importe se muestra —o peor, se guarda— con una moneda que
 * no es la de la Prestadora a la que pertenece la fila.
 *
 * La regla 14 de `CLAUDE.md` §7 pide que todo importe se guarde con su moneda. Esto es
 * de dónde sale esa moneda en el Panel, escrito una sola vez (regla 12).
 *
 * Devuelve `null` mientras el usuario todavía no terminó de cargar.
 */
export function useMonedaActual() {
  const { usuario } = useAuth();
  const { sesion } = useTenantSession();
  return sesion?.prestadoras?.moneda ?? usuario?.moneda ?? null;
}

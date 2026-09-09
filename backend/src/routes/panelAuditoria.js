import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { esAdminOSuperior } from '../utils/roles.js';

// Ítem G del pendiente #30 — lectura del registro de auditoría de las sesiones de soporte
// técnico (tabla auditoria_soporte_tecnico). El motor entra a la base con la llave de servicio,
// que no pasa por las reglas de la base (CLAUDE.md de Careonys §6), así que el alcance de lo que
// se entrega se escribe acá a mano. Esas reglas siguen existiendo y siguen rigiendo cuando algo
// consulta la tabla directo con el pase de la persona, no a través de esta ruta.
export const panelAuditoriaRouter = Router();

panelAuditoriaRouter.get('/', requiereRolPanel, async (req, res) => {
  const { rol, prestadoraId } = req.usuarioPanel;

  if (!esAdminOSuperior(rol)) {
    return res.status(403).json({ error: 'Sin permiso para ver el registro de auditoría' });
  }

  // POR QUÉ ESTE ES EL ALCANCE, Y NO EL REGISTRO ENTERO.
  //
  // Hasta el 2026-09-08 esta ruta le entregaba al Superadmin el registro de todas las
  // Prestadoras, y la base decía otra cosa: desde la migración
  // `20260822180000` la política `superadmin_lee_auditoria_de_su_sesion_activa` compara
  // `prestadora_id` contra `interno.current_tenant()`, o sea que sólo deja leer el registro de
  // la Prestadora donde haya una sesión de soporte abierta. Los dos lados decían cosas
  // distintas; era el pendiente #158. **Manda el alcance de la base** (Desarrollador,
  // 2026-09-08), y este filtro es el que lo hace cumplir de este lado.
  //
  // El motivo, que es el que importa y no la coincidencia entre los dos lados:
  //
  //   · `CLAUDE.md` §5 dice que fuera de una sesión de soporte el Superadmin no llega a datos
  //     de ninguna Prestadora real: sólo alcanza la Organización ficticia de pruebas (Sandbox).
  //     Un registro de auditoría no es una excepción a esa regla.
  //   · El campo `detalle` de cada fila puede traer datos de la Prestadora adentro —qué ruta se
  //     tocó, sobre qué tabla, sobre qué fila—, así que entregar el registro entero es entregar
  //     esos datos de todas las Prestadoras a la vez.
  //   · Para mirar el registro de otra Prestadora el camino es abrir la sesión de soporte sobre
  //     esa otra: de a una por vez y dejando constancia, que es exactamente la puerta única que
  //     define `CLAUDE.md` §6. No hay ningún mecanismo para ver varias a la vez y no se
  //     construye ninguno.
  //
  // Por eso el filtro es uno solo y vale para todo rol: la Prestadora sobre la que la persona
  // está parada, y ninguna otra. `prestadoraId` sale de `requiereRolPanel`, que resuelve la
  // precedencia —sesión de soporte primero, Organización propia después— con el mismo orden que
  // la función SQL `current_tenant()`, que es el punto único de verdad. Para el
  // Admin_prestadora eso es siempre la suya, igual que la política
  // `admin_prestadora_lee_auditoria_de_su_prestadora`.
  //
  // Falla cerrado: si no se pudo resolver ninguna Prestadora no se entrega nada (§5).
  if (!prestadoraId) {
    return res.status(403).json({ error: 'Sin prestadora asociada' });
  }

  const { data, error } = await supabase
    .from('auditoria_soporte_tecnico')
    .select('id, admin_id, prestadora_id, tipo_evento, tabla_afectada, operacion, registro_id, detalle, created_at, usuarios(nombre), prestadoras(nombre_fantasia)')
    .eq('prestadora_id', prestadoraId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ eventos: data });
});

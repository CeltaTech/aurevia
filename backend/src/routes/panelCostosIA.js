import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';

// Etapa 2 de la separación CeltaTech / Careonys (2026-07-28, docs/ETAPA_2_INVENTARIO.md §5):
// este bloque venía adentro de panelAdminPlataforma.js, que era el panel comercial del SaaS.
// Ese panel se fue entero — planes, licencias y facturación son de CeltaTech (Nivel 1), no de
// Careonys. Pero el costo de IA no es comercial: no factura ni fija ningún precio de venta, mide
// un costo de infraestructura y vigila que el precio oficial del proveedor no cambie sin que
// nadie se entere. Eso es mantenimiento técnico de la plataforma = superadmin (CLAUDE.md §5).
//
// Motivo práctico además del conceptual: la rutina mensual verificarPreciosIA.js sigue
// escribiendo en cambios_precio_ia_pendientes. Sin una pantalla que los confirme, esos avisos
// se acumulan sin que nadie pueda resolverlos.
export const panelCostosIARouter = Router();

function requiereSuperadmin(req, res, next) {
  if (req.usuarioPanel?.rol !== 'superadmin') {
    return res.status(403).json({ error: 'Solo Superadmin puede ver los costos de IA de la plataforma' });
  }
  next();
}

panelCostosIARouter.use(requiereRolPanel, requiereSuperadmin);

// ============================================================================
// Uso de IA por Prestadora (pendiente #84, docs/PENDIENTES.md) — costo real en dólares,
// calculado en backend/src/utils/registrarUsoIA.js a partir de tokens reales y el precio
// oficial vigente a la fecha de cada llamada. Nunca visible para la propia Prestadora
// (CLAUDE.md §2) — solo se resume acá.
// ============================================================================
panelCostosIARouter.get('/uso-ia', async (req, res) => {
  const { data: usos, error } = await supabase
    .from('uso_ia')
    .select('prestadora_id, modulo, costo_usd, creado_at, prestadoras(nombre_fantasia)')
    .order('creado_at', { ascending: false })
    .limit(5000);
  if (error) return res.status(500).json({ error: error.message });

  const resumenPorPrestadora = new Map();
  for (const fila of usos) {
    const clave = fila.prestadora_id;
    const actual = resumenPorPrestadora.get(clave) ?? {
      prestadoraId: clave,
      nombre: fila.prestadoras?.nombre_fantasia ?? clave,
      costoTotalUsd: 0,
      llamadas: 0,
    };
    actual.costoTotalUsd += Number(fila.costo_usd);
    actual.llamadas += 1;
    resumenPorPrestadora.set(clave, actual);
  }

  res.json({ resumen: [...resumenPorPrestadora.values()].sort((a, b) => b.costoTotalUsd - a.costoTotalUsd) });
});

// ============================================================================
// Cambios de precio de IA detectados por la rutina mensual (verificarPreciosIA.js) —
// quedan pendientes de confirmación explícita, nunca se aplican solos (CLAUDE.md §6).
// ============================================================================
panelCostosIARouter.get('/cambios-precio-ia', async (req, res) => {
  const { data, error } = await supabase
    .from('cambios_precio_ia_pendientes')
    .select('*')
    .eq('estado', 'pendiente')
    .order('detectado_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ cambios: data });
});

panelCostosIARouter.post('/cambios-precio-ia/:id/confirmar', async (req, res) => {
  const { id } = req.params;

  const { data: cambio, error: errorCambio } = await supabase
    .from('cambios_precio_ia_pendientes')
    .select('*')
    .eq('id', id)
    .eq('estado', 'pendiente')
    .maybeSingle();
  if (errorCambio) return res.status(500).json({ error: errorCambio.message });
  if (!cambio) return res.status(404).json({ error: 'Cambio no encontrado o ya resuelto' });

  const hoy = new Date().toISOString().slice(0, 10);

  // upsert (no insert): si ya existe una fila para este proveedor/modelo con vigencia hoy
  // (ej. la semilla inicial, o dos cambios confirmados el mismo día), se corrige esa fila
  // en vez de chocar con la UNIQUE (proveedor, modelo, vigente_desde) de schema_uso_ia_01.sql.
  const { error: errorInsert } = await supabase.from('precios_ia_modelo').upsert({
    proveedor: cambio.proveedor,
    modelo: cambio.modelo,
    precio_entrada_usd_por_millon: cambio.precio_entrada_detectado,
    precio_salida_usd_por_millon: cambio.precio_salida_detectado,
    vigente_desde: hoy,
    verificado_at: new Date().toISOString(),
    fuente: cambio.fuente_url,
  }, { onConflict: 'proveedor,modelo,vigente_desde' });
  if (errorInsert) return res.status(500).json({ error: errorInsert.message });

  // Mismo criterio que la ruta de descartar de más abajo: se cierra solo si seguía pendiente, y
  // se comprueba que se haya cerrado. La lectura de arriba pasó hace un instante, pero dos
  // personas mirando la misma bandeja pueden resolver el mismo aviso a la vez.
  const { data: confirmado, error: errorUpdate } = await supabase
    .from('cambios_precio_ia_pendientes')
    .update({ estado: 'confirmado', resuelto_at: new Date().toISOString(), resuelto_por: req.usuarioPanel.id })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id');
  if (errorUpdate) return res.status(500).json({ error: errorUpdate.message });
  if (!confirmado?.length) return res.status(404).json({ error: 'Cambio no encontrado o ya resuelto' });

  res.json({ ok: true });
});

panelCostosIARouter.post('/cambios-precio-ia/:id/descartar', async (req, res) => {
  const { id } = req.params;
  // La escritura devuelve la fila descartada. Sin eso, un aviso que no existe o que ya se había
  // resuelto contesta igual que uno descartado recién, y el cambio de precio sigue esperando
  // sin que nadie se entere. Es el mismo aviso que ya devuelve la ruta de confirmar de arriba.
  const { data: descartado, error } = await supabase
    .from('cambios_precio_ia_pendientes')
    .update({ estado: 'descartado', resuelto_at: new Date().toISOString(), resuelto_por: req.usuarioPanel.id })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id');
  if (error) return res.status(500).json({ error: error.message });
  if (!descartado?.length) {
    return res.status(404).json({ error: 'Cambio no encontrado o ya resuelto' });
  }
  res.json({ ok: true });
});

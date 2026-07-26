import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';

// Etapa 2 del plan de panel Admin_plataforma (2026-07-18, aprobado por el Desarrollador):
// planes/módulos/facturación de licencias — configuración administrativa de negocio de
// la plataforma. Exclusivamente admin_plataforma (CLAUDE.md §5: "gestiona... procesos
// comerciales del SaaS"); superadmin es un rol puramente técnico sin alcance de negocio
// y queda afuera a propósito, a diferencia de panelPrestadoras.js (que sí lo incluye,
// por la necesidad puntual del onboarding del pendiente #26).
export const panelAdminPlataformaRouter = Router();

function requiereAdminPlataforma(req, res, next) {
  if (req.usuarioPanel?.rol !== 'admin_plataforma') {
    return res.status(403).json({ error: 'Solo admin_plataforma puede acceder a esta sección' });
  }
  next();
}

panelAdminPlataformaRouter.use(requiereRolPanel, requiereAdminPlataforma);

async function planVigenteDe(prestadoraId) {
  const { data } = await supabase
    .from('prestadora_planes')
    .select('plan_id, vigente_desde, planes(id, nombre, precio, moneda)')
    .eq('prestadora_id', prestadoraId)
    .is('vigente_hasta', null)
    .maybeSingle();
  return data?.planes ?? null;
}

async function modulosDePlan(planId) {
  const { data, error } = await supabase.from('plan_modulos').select('modulo_key').eq('plan_id', planId);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((f) => f.modulo_key));
}

// ============================================================================
// Resumen (KPIs)
// ============================================================================
panelAdminPlataformaRouter.get('/resumen', async (req, res) => {
  const { data: prestadoras, error: errorPrestadoras } = await supabase
    .from('prestadoras')
    .select('id, estado, fecha_alta');
  if (errorPrestadoras) return res.status(500).json({ error: errorPrestadoras.message });

  const { data: configPlataforma, error: errorConfig } = await supabase
    .from('configuracion_plataforma')
    .select('umbral_alerta_prestadoras')
    .single();
  if (errorConfig) return res.status(500).json({ error: errorConfig.message });

  const { data: planesVigentes, error: errorPlanes } = await supabase
    .from('prestadora_planes')
    .select('prestadora_id, planes(precio)')
    .is('vigente_hasta', null);
  if (errorPlanes) return res.status(500).json({ error: errorPlanes.message });

  const { count: addonsCount, error: errorAddons } = await supabase
    .from('prestadora_modulos')
    .select('id', { count: 'exact', head: true })
    .eq('origen', 'addon')
    .eq('activo', true);
  if (errorAddons) return res.status(500).json({ error: errorAddons.message });

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const mrrTotal = planesVigentes.reduce((acc, fila) => acc + Number(fila.planes?.precio ?? 0), 0);
  const activas = prestadoras.filter((p) => p.estado === 'certificada').length;
  const nuevasEsteMes = prestadoras.filter((p) => p.fecha_alta && new Date(p.fecha_alta) >= inicioMes).length;

  const umbralAlertaPrestadoras = configPlataforma.umbral_alerta_prestadoras;

  res.json({
    mrrTotal,
    prestadorasActivas: activas,
    prestadorasTotal: prestadoras.length,
    nuevasEsteMes,
    addonsContratados: addonsCount ?? 0,
    // Pendiente #44 (docs/PENDIENTES.md): el envío de emails de todas las Prestadoras sale
    // de una única cuenta Gmail compartida (backend/src/utils/email.js) con tope de 500/día
    // — riesgo real recién a partir de cierto volumen de Prestadoras simultáneas, no antes.
    // Se avisa al llegar/superar el umbral configurable (docs/DECISION_EMAIL_ESCALA.md
    // tiene el detalle para decidir en ese momento), nunca antes.
    umbralAlertaPrestadoras,
    alertaLimiteEmailCompartido: activas >= umbralAlertaPrestadoras,
  });
});

// ============================================================================
// Licenciatarias (lista con su plan vigente, estado de pago, riesgo y uso —
// Fase 6 del plan de rediseño de frontend, "Fase 7" en
// C:\Users\Usuario\.claude\plans\distributed-scribbling-wirth.md: estado de pago
// (vigente/vencido, derivado de facturas_licencia, sin "en reintento" porque no hay
// pasarela real), riesgo (mismo criterio que estado de pago por ahora) y uso real
// (conteos de Asistentes/Pacientes/usuarios del Panel, sin tope de plan — decisión del
// Desarrollador 2026-07-22)
// ============================================================================
panelAdminPlataformaRouter.get('/tenants', async (req, res) => {
  const { data: prestadoras, error } = await supabase
    .from('prestadoras')
    .select('id, nombre_fantasia, pais, estado')
    .order('nombre_fantasia', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const { data: planesVigentes, error: errorPlanes } = await supabase
    .from('prestadora_planes')
    .select('prestadora_id, planes(id, nombre, precio, moneda)')
    .is('vigente_hasta', null);
  if (errorPlanes) return res.status(500).json({ error: errorPlanes.message });
  const planPorPrestadora = new Map(planesVigentes.map((f) => [f.prestadora_id, f.planes]));

  const hoy = new Date().toISOString().slice(0, 10);
  const { data: facturasVencidas, error: errorFacturas } = await supabase
    .from('facturas_licencia')
    .select('prestadora_id')
    .neq('estado', 'pagada')
    .lt('fecha_vencimiento', hoy);
  if (errorFacturas) return res.status(500).json({ error: errorFacturas.message });
  const prestadorasConVencida = new Set(facturasVencidas.map((f) => f.prestadora_id));

  const [
    { data: asistentes, error: errorAsistentes },
    { data: pacientes, error: errorPacientes },
    { data: usuariosPanel, error: errorUsuarios },
  ] = await Promise.all([
    supabase.from('asistentes').select('prestadora_id'),
    supabase.from('pacientes').select('prestadora_id'),
    supabase.from('usuarios').select('prestadora_id').in('rol', ['admin_prestadora', 'coordinador']),
  ]);
  if (errorAsistentes) return res.status(500).json({ error: errorAsistentes.message });
  if (errorPacientes) return res.status(500).json({ error: errorPacientes.message });
  if (errorUsuarios) return res.status(500).json({ error: errorUsuarios.message });

  const contarPor = (filas) => {
    const mapa = new Map();
    for (const fila of filas) {
      mapa.set(fila.prestadora_id, (mapa.get(fila.prestadora_id) ?? 0) + 1);
    }
    return mapa;
  };
  const asistentesPorPrestadora = contarPor(asistentes);
  const pacientesPorPrestadora = contarPor(pacientes);
  const usuariosPorPrestadora = contarPor(usuariosPanel);

  res.json({
    tenants: prestadoras.map((p) => ({
      ...p,
      plan: planPorPrestadora.get(p.id) ?? null,
      estadoPago: prestadorasConVencida.has(p.id) ? 'vencido' : 'vigente',
      riesgo: prestadorasConVencida.has(p.id),
      uso: {
        asistentes: asistentesPorPrestadora.get(p.id) ?? 0,
        pacientes: pacientesPorPrestadora.get(p.id) ?? 0,
        usuariosPanel: usuariosPorPrestadora.get(p.id) ?? 0,
      },
    })),
  });
});

// ============================================================================
// Preview de cambio de plan: qué funciones se ganan/pierden si se aplica un plan
// distinto al vigente hoy — nunca se aplica un cambio de plan a ciegas (Fase 7).
// ============================================================================
panelAdminPlataformaRouter.get('/tenants/:id/plan-preview/:planId', async (req, res) => {
  const { id, planId } = req.params;

  const { data: activos, error: errorActivos } = await supabase
    .from('prestadora_modulos')
    .select('modulo_key, origen, activo')
    .eq('prestadora_id', id);
  if (errorActivos) return res.status(500).json({ error: errorActivos.message });

  const activosKeys = new Set(activos.filter((m) => m.activo).map((m) => m.modulo_key));
  const planActualKeys = new Set(
    activos.filter((m) => m.activo && m.origen === 'plan').map((m) => m.modulo_key)
  );

  let nuevoPlanKeys;
  try {
    nuevoPlanKeys = await modulosDePlan(planId);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const { data: catalogo, error: errorCatalogo } = await supabase
    .from('catalogo_modulos')
    .select('key, nombre');
  if (errorCatalogo) return res.status(500).json({ error: errorCatalogo.message });
  const nombrePorKey = new Map(catalogo.map((m) => [m.key, m.nombre]));

  const ganadas = [...nuevoPlanKeys]
    .filter((k) => !activosKeys.has(k))
    .map((k) => nombrePorKey.get(k) ?? k);
  const perdidas = [...planActualKeys]
    .filter((k) => !nuevoPlanKeys.has(k))
    .map((k) => nombrePorKey.get(k) ?? k);

  res.json({ ganadas, perdidas });
});

// Aplica el cambio de plan: cierra el prestadora_planes vigente, abre uno nuevo, y
// sincroniza prestadora_modulos (las funciones "del plan" que ya no vienen incluidas
// se desactivan; las nuevas se activan). Los módulos marcados como "función adicional"
// (origen='addon') no se tocan — siguen dependiendo de la Prestadora, no del plan.
panelAdminPlataformaRouter.patch('/tenants/:id/plan', async (req, res) => {
  const { id } = req.params;
  const { planId } = req.body;
  if (!planId) return res.status(400).json({ error: 'Falta el campo "planId"' });

  const { data: plan, error: errorPlan } = await supabase
    .from('planes')
    .select('id')
    .eq('id', planId)
    .is('vigente_hasta', null)
    .maybeSingle();
  if (errorPlan) return res.status(500).json({ error: errorPlan.message });
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado o no vigente' });

  const hoy = new Date().toISOString().slice(0, 10);

  const { error: errorCierre } = await supabase
    .from('prestadora_planes')
    .update({ vigente_hasta: hoy })
    .eq('prestadora_id', id)
    .is('vigente_hasta', null);
  if (errorCierre) return res.status(500).json({ error: errorCierre.message });

  const { error: errorAlta } = await supabase
    .from('prestadora_planes')
    .insert({ prestadora_id: id, plan_id: planId, vigente_desde: hoy });
  if (errorAlta) return res.status(500).json({ error: errorAlta.message });

  let nuevoPlanKeys;
  try {
    nuevoPlanKeys = await modulosDePlan(planId);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const { data: activos, error: errorActivos } = await supabase
    .from('prestadora_modulos')
    .select('modulo_key, origen, activo')
    .eq('prestadora_id', id);
  if (errorActivos) return res.status(500).json({ error: errorActivos.message });

  const planActualKeys = new Set(
    activos.filter((m) => m.activo && m.origen === 'plan').map((m) => m.modulo_key)
  );
  const ahoraIso = new Date().toISOString();

  const filas = [
    ...[...nuevoPlanKeys].map((key) => ({
      prestadora_id: id,
      modulo_key: key,
      origen: 'plan',
      activo: true,
      updated_at: ahoraIso,
    })),
    ...[...planActualKeys]
      .filter((key) => !nuevoPlanKeys.has(key))
      .map((key) => ({
        prestadora_id: id,
        modulo_key: key,
        origen: 'plan',
        activo: false,
        updated_at: ahoraIso,
      })),
  ];

  if (filas.length) {
    const { error: errorUpsert } = await supabase
      .from('prestadora_modulos')
      .upsert(filas, { onConflict: 'prestadora_id,modulo_key' });
    if (errorUpsert) return res.status(500).json({ error: errorUpsert.message });
  }

  res.json({ ok: true });
});

// ============================================================================
// Módulos de una licenciataria puntual (para el drawer de toggles)
// ============================================================================
panelAdminPlataformaRouter.get('/tenants/:id/modulos', async (req, res) => {
  const { id } = req.params;

  const { data: catalogo, error: errorCatalogo } = await supabase
    .from('catalogo_modulos')
    .select('key, nombre')
    .order('key', { ascending: true });
  if (errorCatalogo) return res.status(500).json({ error: errorCatalogo.message });

  const { data: asignados, error: errorAsignados } = await supabase
    .from('prestadora_modulos')
    .select('modulo_key, origen, activo')
    .eq('prestadora_id', id);
  if (errorAsignados) return res.status(500).json({ error: errorAsignados.message });

  const asignadoPorKey = new Map(asignados.map((a) => [a.modulo_key, a]));

  res.json({
    modulos: catalogo.map((m) => ({
      key: m.key,
      nombre: m.nombre,
      activo: asignadoPorKey.get(m.key)?.activo ?? false,
      origen: asignadoPorKey.get(m.key)?.origen ?? null,
    })),
  });
});

// Prender/apagar un módulo de una licenciataria puntual — queda auditado por el mismo
// mecanismo genérico de mutaciones Express (requiereRolPanel.js), no hace falta duplicar
// el registro acá.
panelAdminPlataformaRouter.patch('/tenants/:id/modulos/:key', async (req, res) => {
  const { id, key } = req.params;
  const { activo } = req.body;

  if (typeof activo !== 'boolean') {
    return res.status(400).json({ error: 'Falta el campo "activo" (boolean)' });
  }

  const planVigente = await planVigenteDe(id);
  const { data: planModulo } = await supabase
    .from('plan_modulos')
    .select('modulo_key')
    .eq('plan_id', planVigente?.id ?? '00000000-0000-0000-0000-000000000000')
    .eq('modulo_key', key)
    .maybeSingle();

  const origen = planModulo ? 'plan' : 'addon';

  const { error } = await supabase
    .from('prestadora_modulos')
    .upsert(
      { prestadora_id: id, modulo_key: key, origen, activo, updated_at: new Date().toISOString() },
      { onConflict: 'prestadora_id,modulo_key' }
    );
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

// ============================================================================
// Catálogo de planes (solo lectura por ahora — crear/editar planes queda para una
// siguiente etapa, ya señalado como fuera de alcance de esta tanda)
// ============================================================================
panelAdminPlataformaRouter.get('/planes', async (req, res) => {
  const { data: planes, error } = await supabase
    .from('planes')
    .select('id, nombre, precio, moneda, vigente_desde, vigente_hasta')
    .is('vigente_hasta', null)
    .order('precio', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const { data: modulos, error: errorModulos } = await supabase
    .from('plan_modulos')
    .select('plan_id, catalogo_modulos(key, nombre)');
  if (errorModulos) return res.status(500).json({ error: errorModulos.message });

  const modulosPorPlan = new Map();
  for (const fila of modulos) {
    const lista = modulosPorPlan.get(fila.plan_id) ?? [];
    lista.push(fila.catalogo_modulos.nombre);
    modulosPorPlan.set(fila.plan_id, lista);
  }

  res.json({
    planes: planes.map((p) => ({ ...p, modulos: modulosPorPlan.get(p.id) ?? [] })),
  });
});

// ============================================================================
// Facturación de licencias (solo lectura por ahora — emitir/marcar pagada queda para
// una siguiente etapa)
// ============================================================================
panelAdminPlataformaRouter.get('/facturas', async (req, res) => {
  const { data, error } = await supabase
    .from('facturas_licencia')
    .select('id, concepto, monto, moneda, estado, fecha_emision, fecha_vencimiento, prestadoras(nombre_fantasia)')
    .order('fecha_emision', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ facturas: data });
});

// ============================================================================
// Uso de IA por Prestadora (pendiente #84, docs/PENDIENTES.md) — costo real en dólares,
// calculado en backend/src/utils/registrarUsoIA.js a partir de tokens reales y el precio
// oficial vigente a la fecha de cada llamada. Nunca visible para la propia Prestadora
// (CLAUDE.md §2) — solo se resume acá, en Admin_plataforma.
// ============================================================================
panelAdminPlataformaRouter.get('/uso-ia', async (req, res) => {
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
panelAdminPlataformaRouter.get('/cambios-precio-ia', async (req, res) => {
  const { data, error } = await supabase
    .from('cambios_precio_ia_pendientes')
    .select('*')
    .eq('estado', 'pendiente')
    .order('detectado_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ cambios: data });
});

panelAdminPlataformaRouter.post('/cambios-precio-ia/:id/confirmar', async (req, res) => {
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

  const { error: errorUpdate } = await supabase
    .from('cambios_precio_ia_pendientes')
    .update({ estado: 'confirmado', resuelto_at: new Date().toISOString(), resuelto_por: req.usuarioPanel.id })
    .eq('id', id);
  if (errorUpdate) return res.status(500).json({ error: errorUpdate.message });

  res.json({ ok: true });
});

panelAdminPlataformaRouter.post('/cambios-precio-ia/:id/descartar', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('cambios_precio_ia_pendientes')
    .update({ estado: 'descartado', resuelto_at: new Date().toISOString(), resuelto_por: req.usuarioPanel.id })
    .eq('id', id)
    .eq('estado', 'pendiente');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

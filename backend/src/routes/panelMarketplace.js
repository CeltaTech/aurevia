// Pendiente #85 (docs/PLAN_HASTA_PRODUCCION.md), Grupo 3 Marketplace — rutas del Panel: pasarela de
// pago por Prestadora, suscripciones/cobros, calificaciones con descargo, y la auditoría de
// advertencias legales de marketplace. Mismo patrón de scoping por prestadora_id/rol que
// panelConfiguracion.js.

import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { proveedoresDisponibles, obtenerAdaptador, requiereSecretoFirma } from '../pasarelas/index.js';
import { tokenQrCobroValido } from '../utils/qrCobroEfectivo.js';
import { exigirAdministracion, exigirAdminDePrestadora } from '../middleware/exigirAdministracion.js';
import { exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { exigirModalidad } from '../middleware/exigirModalidad.js';
import { advertenciaVigente, advertenciasVigentes, registrarAviso } from '../utils/advertenciaLegal.js';

export const panelMarketplaceRouter = Router();

panelMarketplaceRouter.use(requiereRolPanel);

// Todo lo de marketplace pasa adentro de una Prestadora. Superadmin sin sesión de soporte
// abierta no está parado en ninguna, y entonces no hay sobre qué operar. El corte lo pone el
// middleware compartido con el resto de los routers: hasta hoy este archivo tenía su propia
// copia de la misma condición, con otro texto (CLAUDE.md §8, «ningún patrón repetido sin punto
// único de verdad»).
panelMarketplaceRouter.use(exigirOrganizacionActiva);

// Y todo lo de acá adentro existe solamente si la Prestadora tiene encendida la modalidad
// Marketplace. Que el menú del Panel no muestre estos enlaces no alcanza: escribiendo la
// dirección a mano se entraba igual. El candado de verdad es éste (middleware/exigirModalidad.js).
panelMarketplaceRouter.use(exigirModalidad('marketplace'));

// La plata del Marketplace es de la administración de la Prestadora, no del Coordinador
// (Desarrollador, 2026-09-04: «absolutamente no puede ni debe»). Alcanza a las dos mitades:
// conectar y desconectar pasarelas de pago —que es cargar credenciales de cobro—, y todo lo
// que sea un cobro: la lista de suscripciones con sus importes, el historial de cobros, la
// carga de efectivo en mano y el canje del QR. Lo que sí queda para el Coordinador es lo que
// no es plata: las calificaciones y la auditoría de advertencias legales.
//
// Hasta el 2026-09-04 este archivo tenía una función llamada `requiereAdminOSuperior` que
// dejaba pasar al Coordinador; las otras dos del motor, con el mismo nombre, no. Ahora el
// control se escribe una sola vez (middleware/exigirAdministracion.js) y lo único que se
// decide acá es a qué rutas se le pide.
const soloAdministracion = exigirAdministracion('Rol sin permiso');

// Y adentro de la plata hay una parte que ni siquiera es de la administración en general: las
// credenciales con las que la Prestadora cobra. Son secretos de ella, igual que el token de
// WhatsApp y que la contraseña del correo saliente, así que Superadmin también queda afuera de
// cargarlas y de reemplazarlas. Superadmin es un rol técnico de CeltaTech, y CeltaTech no tiene
// por qué poder tocar con qué credencial cobra una Prestadora. Se suma encima del candado de
// administración en las dos rutas que las escriben; el resto del riel —ver qué pasarelas están
// conectadas, los cobros, las suscripciones— no cambia (middleware/exigirAdministracion.js).
const soloAdminDePrestadora = exigirAdminDePrestadora(
  'Las credenciales de cobro son de la Prestadora: solo Admin puede cargarlas y cambiarlas'
);

// ============================================================================
// Pasarela de pago — la Prestadora activa uno o varios de los 6 rieles, cada uno con su
// propia credencial (Supabase Vault, ver schema_marketplace_pasarelas_01.sql). El secreto
// nunca se vuelve a mostrar una vez guardado, mismo criterio que WhatsApp.
// ============================================================================

panelMarketplaceRouter.get('/pasarela', soloAdministracion, async (req, res) => {
  const { data, error } = await supabase
    .from('prestadora_pasarela_pago')
    .select('proveedor, estado_conexion, conectada_en, updated_at')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });

  // Qué secretos tiene guardados cada proveedor. Nunca el texto —eso no sale de la caja
  // fuerte ni para el Admin que lo cargó—, solamente si está o no está: sin el secreto de
  // firma, los avisos de cobro de esa pasarela se rechazan y la pantalla tiene que poder
  // decirlo (pendiente #159).
  const { data: secretos, error: errorSecretos } = await supabase
    .from('credenciales_pasarela_pago')
    .select('proveedor, secreto_firma_secret_id')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (errorSecretos) return res.status(500).json({ error: errorSecretos.message });

  const activados = new Map(data.map((fila) => [fila.proveedor, fila]));
  const conSecretoDeFirma = new Set(
    (secretos ?? []).filter((fila) => fila.secreto_firma_secret_id).map((fila) => fila.proveedor)
  );
  const pasarelas = proveedoresDisponibles().map((proveedor) => ({
    proveedor,
    activo: activados.has(proveedor),
    estado_conexion: activados.get(proveedor)?.estado_conexion ?? null,
    conectada_en: activados.get(proveedor)?.conectada_en ?? null,
    requiere_secreto_firma: requiereSecretoFirma(proveedor),
    secreto_firma_cargado: conSecretoDeFirma.has(proveedor),
  }));

  res.json({ pasarelas });
});

// El secreto con el que la pasarela firma sus avisos de cobro (pendiente #159). Lo normal es
// que llegue junto con la credencial, en el mismo paso de conexión (ver el PATCH de más
// abajo): los dos datos se sacan del mismo panel del proveedor y en el mismo viaje, y
// partirlo en dos trámites era pedirle a la Prestadora que volviera por lo mismo. Esta ruta
// queda para el caso que sí es aparte: cambiar el secreto de una pasarela ya conectada,
// porque se rota cada tanto sin tocar la credencial. Se guarda en la misma caja fuerte que
// la credencial y no se vuelve a mostrar.
panelMarketplaceRouter.put('/pasarela/:proveedor/secreto-firma', soloAdministracion, soloAdminDePrestadora, async (req, res) => {
  const { proveedor } = req.params;
  const { secretoFirma } = req.body || {};

  if (!requiereSecretoFirma(proveedor)) {
    return res.status(400).json({ error: 'Este proveedor no firma sus avisos de cobro' });
  }
  if (typeof secretoFirma !== 'string' || !secretoFirma.trim()) {
    return res.status(400).json({ error: 'Hace falta el secreto de firma' });
  }

  const { error } = await supabase.rpc('guardar_secreto_firma_pasarela_pago', {
    p_prestadora_id: req.usuarioPanel.prestadoraId,
    p_proveedor: proveedor,
    p_secreto: secretoFirma.trim(),
  });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

panelMarketplaceRouter.patch('/pasarela/:proveedor', soloAdministracion, soloAdminDePrestadora, async (req, res) => {
  const { proveedor } = req.params;
  const { activo, credencial, secretoFirma } = req.body || {};

  if (!proveedoresDisponibles().includes(proveedor)) {
    return res.status(400).json({ error: 'Proveedor desconocido' });
  }

  if (activo === false) {
    const { error } = await supabase
      .from('prestadora_pasarela_pago')
      .delete()
      .eq('prestadora_id', req.usuarioPanel.prestadoraId)
      .eq('proveedor', proveedor);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  const requiereCredencial = proveedor !== 'efectivo_manual';
  if (requiereCredencial && credencial) {
    const { error: errorCredencial } = await supabase.rpc('guardar_credencial_pasarela_pago', {
      p_prestadora_id: req.usuarioPanel.prestadoraId,
      p_proveedor: proveedor,
      p_credencial: credencial,
    });
    if (errorCredencial) return res.status(500).json({ error: errorCredencial.message });
  }

  // El secreto de firma viaja en la misma llamada que la credencial cuando el proveedor firma
  // sus avisos: son dos datos del mismo panel del proveedor, se copian de una sola vez. Si no
  // vino, la pasarela igual se conecta y la pantalla avisa que le falta — hay pasarelas que se
  // conectaron antes de que esto existiera, y no se las deja tiradas.
  if (requiereSecretoFirma(proveedor) && typeof secretoFirma === 'string' && secretoFirma.trim()) {
    const { error: errorSecreto } = await supabase.rpc('guardar_secreto_firma_pasarela_pago', {
      p_prestadora_id: req.usuarioPanel.prestadoraId,
      p_proveedor: proveedor,
      p_secreto: secretoFirma.trim(),
    });
    if (errorSecreto) return res.status(500).json({ error: errorSecreto.message });
  }

  const { error } = await supabase.from('prestadora_pasarela_pago').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      proveedor,
      estado_conexion: requiereCredencial ? 'conectada' : 'conectada',
      activada_por: req.usuarioPanel.id,
      conectada_en: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'prestadora_id,proveedor' }
  );
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

// ============================================================================
// Suscripciones y cobros
// ============================================================================

// Nombres legibles de Familia/Paciente/Asistente en consultas separadas (no un único JOIN
// embebido): familia_id apunta a familias.id, que a su vez comparte id con usuarios.id, así
// que el nombre real vive en usuarios — resolverlo acá evita mostrar UUID crudo en el Panel
// (CLAUDE.md §7 regla 7, "sin datos crudos").
panelMarketplaceRouter.get('/suscripciones', soloAdministracion, async (req, res) => {
  const { data, error } = await supabase
    .from('suscripciones_marketplace')
    .select('id, familia_id, paciente_id, asistente_id, estado, monto_mensual, trial_fin, proximo_cobro, cancelada_en, created_at')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const familiaIds = [...new Set(data.map((s) => s.familia_id).filter(Boolean))];
  const pacienteIds = [...new Set(data.map((s) => s.paciente_id).filter(Boolean))];
  const asistenteIds = [...new Set(data.map((s) => s.asistente_id).filter(Boolean))];

  const [{ data: usuariosFamilia }, { data: pacientes }, { data: asistentes }] = await Promise.all([
    familiaIds.length ? supabase.from('usuarios').select('id, nombre').in('id', familiaIds) : { data: [] },
    pacienteIds.length ? supabase.from('pacientes').select('id, nombre').in('id', pacienteIds) : { data: [] },
    asistenteIds.length ? supabase.from('asistentes').select('id, nombre').in('id', asistenteIds) : { data: [] },
  ]);

  const nombreFamilia = new Map((usuariosFamilia || []).map((u) => [u.id, u.nombre]));
  const nombrePaciente = new Map((pacientes || []).map((p) => [p.id, p.nombre]));
  const nombreAsistente = new Map((asistentes || []).map((a) => [a.id, a.nombre]));

  const suscripciones = data.map((s) => ({
    ...s,
    familia_nombre: nombreFamilia.get(s.familia_id) || null,
    paciente_nombre: nombrePaciente.get(s.paciente_id) || null,
    asistente_nombre: s.asistente_id ? nombreAsistente.get(s.asistente_id) || null : null,
  }));

  res.json({ suscripciones });
});

panelMarketplaceRouter.get('/suscripciones/:id/cobros', soloAdministracion, async (req, res) => {
  const { data, error } = await supabase
    .from('cobros_marketplace')
    .select('id, medio, monto, periodo, estado_cobro, referencia_externa, fecha_cobro, registrado_por, created_at')
    .eq('suscripcion_id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('periodo', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ cobros: data });
});

// Carga manual de efectivo en mano — mitigante central del riesgo de suspensión indebida
// por cobro no reflejado a tiempo en el sistema (docs/PLAN_HASTA_PRODUCCION.md). fecha_cobro es la
// fecha real del hecho, nunca la de carga (CLAUDE.md §3).
panelMarketplaceRouter.post('/cobros/efectivo-manual', soloAdministracion, async (req, res) => {
  const { suscripcion_id: suscripcionId, monto, periodo, fecha_cobro: fechaCobro } = req.body || {};
  if (!suscripcionId || !monto || !periodo || !fechaCobro) {
    return res.status(400).json({ error: 'Faltan suscripcion_id, monto, periodo o fecha_cobro' });
  }

  const { data: suscripcion } = await supabase
    .from('suscripciones_marketplace')
    .select('id')
    .eq('id', suscripcionId)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (!suscripcion) {
    return res.status(404).json({ error: 'Suscripción no encontrada' });
  }

  const { error } = await supabase.from('cobros_marketplace').insert({
    suscripcion_id: suscripcionId,
    prestadora_id: req.usuarioPanel.prestadoraId,
    medio: 'efectivo_manual',
    monto,
    periodo,
    estado_cobro: 'exitoso',
    fecha_cobro: fechaCobro,
    registrado_por: req.usuarioPanel.id,
  });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

// Canje del QR de cobro en efectivo escaneado por el cobrador — validación de firma/
// vencimiento/uso único acá, nunca como UPDATE directo desde la PWA (CLAUDE.md §6).
panelMarketplaceRouter.post('/qr-cobro/canjear', soloAdministracion, async (req, res) => {
  const { token } = req.body || {};
  if (!token || !tokenQrCobroValido(token)) {
    return res.status(400).json({ error: 'QR inválido o vencido' });
  }

  const { data: qr } = await supabase
    .from('qr_cobro_efectivo')
    .select('id, suscripcion_id, monto, periodo, expira_en, usado_en')
    .eq('token', token)
    .maybeSingle();
  if (!qr) {
    return res.status(404).json({ error: 'QR no encontrado' });
  }
  if (qr.usado_en) {
    return res.status(409).json({ error: 'Este QR ya fue usado' });
  }
  if (new Date(qr.expira_en) < new Date()) {
    return res.status(410).json({ error: 'Este QR venció, hace falta pedirle a la Familia que genere uno nuevo' });
  }

  const { data: suscripcion } = await supabase
    .from('suscripciones_marketplace')
    .select('id')
    .eq('id', qr.suscripcion_id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (!suscripcion) {
    return res.status(404).json({ error: 'La suscripción de este QR no pertenece a esta Prestadora' });
  }

  const { data: cobro, error: errorCobro } = await supabase
    .from('cobros_marketplace')
    .insert({
      suscripcion_id: qr.suscripcion_id,
      prestadora_id: req.usuarioPanel.prestadoraId,
      medio: 'efectivo_manual',
      monto: qr.monto,
      periodo: qr.periodo,
      estado_cobro: 'exitoso',
      fecha_cobro: new Date().toISOString().slice(0, 10),
      registrado_por: req.usuarioPanel.id,
    })
    .select('id')
    .single();
  if (errorCobro) return res.status(500).json({ error: errorCobro.message });

  const { error: errorQr } = await supabase
    .from('qr_cobro_efectivo')
    .update({ usado_en: new Date().toISOString(), usado_por: req.usuarioPanel.id, cobro_id: cobro.id })
    .eq('id', qr.id);
  if (errorQr) return res.status(500).json({ error: errorQr.message });

  res.json({ ok: true, monto: qr.monto });
});

// ============================================================================
// Calificaciones y descargos — visibilidad pública queda como único campo editable por la
// Prestadora (schema_calificaciones_asistente.sql), el contenido (incluido el descargo del
// Asistente) nunca se edita desde acá.
// ============================================================================

panelMarketplaceRouter.get('/calificaciones', async (req, res) => {
  const { data, error } = await supabase
    .from('calificaciones_asistente')
    .select('id, asistente_id, paciente_id, familia_id, estrellas, comentario, visible_publica, descargo_asistente, descargo_en, created_at')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const asistenteIds = [...new Set(data.map((c) => c.asistente_id).filter(Boolean))];
  const { data: asistentes } = asistenteIds.length
    ? await supabase.from('asistentes').select('id, nombre').in('id', asistenteIds)
    : { data: [] };
  const nombreAsistente = new Map((asistentes || []).map((a) => [a.id, a.nombre]));

  const calificaciones = data.map((c) => ({ ...c, asistente_nombre: nombreAsistente.get(c.asistente_id) || null }));

  res.json({ calificaciones });
});

panelMarketplaceRouter.patch('/calificaciones/:id/visibilidad', async (req, res) => {
  const { visible_publica: visiblePublica } = req.body || {};
  if (typeof visiblePublica !== 'boolean') {
    return res.status(400).json({ error: 'Falta visible_publica (booleano)' });
  }
  // La escritura devuelve la fila tocada: sin esto la base contesta que salió bien aunque no
  // haya encontrado ninguna, y la pantalla muestra un cambio de visibilidad que no ocurrió.
  const { data: modificada, error } = await supabase
    .from('calificaciones_asistente')
    .update({ visible_publica: visiblePublica })
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .select('id');
  if (error) return res.status(500).json({ error: error.message });
  if (!modificada?.length) {
    // No existe, o es de otra Prestadora. Se contesta lo mismo en los dos casos.
    return res.status(404).json({ error: 'No se encontró esa calificación' });
  }
  res.json({ ok: true });
});

// ============================================================================
// Las cinco funciones de riesgo legal de marketplace
//
// QUÉ SON. `docs/legal/argentina.md` describe cinco funciones de la modalidad marketplace
// que, en Argentina, acercan el vínculo con el Asistente a una relación de dependencia:
// el ranking calculado por la plataforma, la consecuencia automática atada a la calificación,
// el precio u horario fijado por la plataforma, la exclusividad y la mediación de conflictos.
// Cada una tiene su texto de aviso escrito en ese documento, y desde la migración
// 20260910140000 esos cinco textos están cargados en `advertencias_legales`.
//
// CUÁL ES LA LISTA. Sale de la base, de `catalogo_funciones_marketplace`, y no de una lista
// escrita acá: los catálogos salen de la base (CLAUDE.md §8). Hasta el 2026-09-10 estaba
// escrita en este archivo, y la tabla que la guarda no existía; ahora la usan las tres rutas
// de abajo desde un solo lugar.
// ============================================================================

/** Las funciones de riesgo, en el orden en que las escribe el documento legal. */
async function catalogoDeFuncionesDeRiesgo() {
  return supabase
    .from('catalogo_funciones_marketplace')
    .select('clave, orden')
    .order('orden', { ascending: true });
}

/* El detalle crudo de la base nombra tablas, columnas y restricciones, así que queda en el
   registro del servidor y no viaja al navegador (CLAUDE.md §6). La pantalla no lo necesita:
   traduce por el código de respuesta (panel/src/lib/errores.js). */
function fallaDelSistema(res, donde, error) {
  console.error(`Marketplace, ${donde}:`, error.message);
  return res.status(500).json({ error: 'No se pudo completar la operación' });
}

// ----------------------------------------------------------------------------
// Encender y apagar cada función — el aviso avisa, no bloquea
// ----------------------------------------------------------------------------
//
// AVISA, NO BLOQUEA (CLAUDE.md §7). Encender cualquiera de las cinco siempre se puede. Lo que
// hace el motor es mostrar el aviso escrito para la jurisdicción de esa Prestadora —si esa
// jurisdicción tiene documento— y dejar registrado que se avisó, cuándo y a quién. Si el país
// no tiene documento, no hay aviso y la función se enciende igual: no se improvisa un texto
// por parecido con otro país, y la falta de texto nunca se convierte en un impedimento.
//
// Y ninguna de las cinco queda apagada por decisión del sistema: nacen apagadas porque nadie
// las encendió, que no es lo mismo. Encenderlas es un clic.
//
// POR QUÉ EL REGISTRO SE ESCRIBE ACÁ Y NO EN LA PANTALLA: ver utils/advertenciaLegal.js.

panelMarketplaceRouter.get('/funciones-riesgo', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;

  const { data: catalogo, error: errorCatalogo } = await catalogoDeFuncionesDeRiesgo();
  if (errorCatalogo) return fallaDelSistema(res, 'catálogo de funciones de riesgo', errorCatalogo);

  const { data: guardadas, error } = await supabase
    .from('configuracion_funciones_marketplace')
    .select('funcion_clave, activa, advertida_en')
    .eq('prestadora_id', prestadoraId);
  if (error) return fallaDelSistema(res, 'funciones de riesgo encendidas', error);

  const porClave = new Map((guardadas || []).map((f) => [f.funcion_clave, f]));
  const avisos = await advertenciasVigentes(prestadoraId, (catalogo || []).map((f) => f.clave));

  res.json({
    funciones: (catalogo || []).map((f) => {
      const guardada = porClave.get(f.clave);
      return {
        clave: f.clave,
        // Sin fila guardada, apagada: una Prestadora recién creada no necesita que nadie le
        // siembre cinco filas para estar en el estado en el que ya está.
        activa: guardada?.activa ?? false,
        advertida_en: guardada?.advertida_en ?? null,
        // El texto viaja para que la pantalla pueda mostrarlo ANTES de encender, que es el
        // único momento en el que sirve. Si esta jurisdicción no tiene documento para esta
        // función, viaja `null` y no hay nada que mostrar.
        texto_advertencia: avisos.get(f.clave)?.texto ?? null,
      };
    }),
  });
});

// Encender o apagar una de estas cinco es una decisión de negocio con consecuencia legal: la
// toma la administración de la Prestadora, no el Coordinador, que las ve y no las toca.
panelMarketplaceRouter.put('/funciones-riesgo/:clave', soloAdministracion, async (req, res) => {
  const { activa } = req.body || {};
  if (typeof activa !== 'boolean') {
    return res.status(400).json({ error: 'Falta activa (booleano)' });
  }

  const prestadoraId = req.usuarioPanel.prestadoraId;
  const usuarioId = req.usuarioPanel.id;

  // La clave se valida contra el catálogo de la base, no contra una lista escrita acá.
  const { data: catalogo, error: errorCatalogo } = await catalogoDeFuncionesDeRiesgo();
  if (errorCatalogo) return fallaDelSistema(res, 'catálogo de funciones de riesgo', errorCatalogo);
  if (!(catalogo || []).some((f) => f.clave === req.params.clave)) {
    return res.status(404).json({ error: 'No se encontró esa función' });
  }

  // El aviso se resuelve antes de guardar porque forma parte de lo que se guarda: la fila
  // queda diciendo que esta función se encendió sabiendo esto. Apagar no lleva aviso: lo que
  // el documento legal advierte es de usar la función, no de dejar de usarla.
  const advertencia = activa ? await advertenciaVigente(prestadoraId, req.params.clave) : null;
  const ahora = new Date().toISOString();

  const { error } = await supabase
    .from('configuracion_funciones_marketplace')
    .upsert(
      {
        prestadora_id: prestadoraId,
        funcion_clave: req.params.clave,
        activa,
        updated_at: ahora,
        ...(advertencia ? { advertida_en: ahora, advertida_por: usuarioId } : {}),
      },
      { onConflict: 'prestadora_id,funcion_clave' }
    );
  if (error) return fallaDelSistema(res, 'encender función de riesgo', error);

  // Recién con la función efectivamente encendida se anota que se avisó: un registro de un
  // aviso sobre algo que no llegó a pasar no es un registro, es ruido. Al revés no aplica —
  // que el registro falle nunca hace fallar el encendido (utils/advertenciaLegal.js).
  if (advertencia) {
    await registrarAviso({ prestadoraId, usuarioId, funcionClave: req.params.clave, advertencia });
  }

  res.json({ ok: true, activa, advertencia });
});

// ----------------------------------------------------------------------------
// La auditoría: qué se avisó, cuándo y a quién
// ----------------------------------------------------------------------------

panelMarketplaceRouter.get('/auditoria-legal', async (req, res) => {
  const { data: catalogo, error: errorCatalogo } = await catalogoDeFuncionesDeRiesgo();
  if (errorCatalogo) return fallaDelSistema(res, 'catálogo de funciones de riesgo', errorCatalogo);

  const { data, error } = await supabase
    .from('auditoria_advertencias_legales')
    .select('id, usuario_id, funcion_clave, jurisdiccion, texto_mostrado, created_at, usuarios(nombre)')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .in('funcion_clave', (catalogo || []).map((f) => f.clave))
    .order('created_at', { ascending: false });
  if (error) return fallaDelSistema(res, 'auditoría de advertencias legales', error);
  res.json({ auditoria: data });
});

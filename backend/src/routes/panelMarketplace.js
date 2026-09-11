// Pendiente #85 (docs/PLAN_HASTA_PRODUCCION.md), Grupo 3 Marketplace — rutas del Panel: pasarela de
// pago por Prestadora, accesos y cobros, calificaciones con descargo, y la auditoría de
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
import { ErrorConMotivo, responderError } from '../utils/errorConMotivo.js';
import { darDeAltaEnPasarela, MOTIVO_ALTA } from '../utils/altaEnPasarela.js';
import { registrarCobroExitoso } from '../utils/cobrosMarketplace.js';

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
// que sea un cobro: la lista de accesos con sus importes, el historial de cobros, la
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
// conectadas, los cobros, los accesos— no cambia (middleware/exigirAdministracion.js).
const soloAdminDePrestadora = exigirAdminDePrestadora(
  'Las credenciales de cobro son de la Prestadora: solo Admin puede cargarlas y cambiarlas'
);

// El mismo candado angosto, por otro motivo y con otro texto: cuánto cobra una Prestadora y cada
// cuánto lo cobra es su política de comercialización, y CeltaTech no se mete en eso ni con
// precios sugeridos. Quien la arma es el Admin de la Prestadora; Superadmin la ve —la necesita
// para dar soporte— y no la escribe.
const soloAdminArmaLaFormaDeCobro = exigirAdminDePrestadora(
  'Cómo cobra la Prestadora lo decide ella: solo Admin puede armar y cambiar sus formas de cobro'
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
  if (error) return responderError(res, error);

  // Qué secretos tiene guardados cada proveedor. Nunca el texto —eso no sale de la caja
  // fuerte ni para el Admin que lo cargó—, solamente si está o no está: sin el secreto de
  // firma, los avisos de cobro de esa pasarela se rechazan y la pantalla tiene que poder
  // decirlo (pendiente #159).
  const { data: secretos, error: errorSecretos } = await supabase
    .from('credenciales_pasarela_pago')
    .select('proveedor, secreto_firma_secret_id')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (errorSecretos) return responderError(res, errorSecretos);

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
  if (error) return responderError(res, error);

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
    if (error) return responderError(res, error);
    return res.json({ ok: true });
  }

  const requiereCredencial = proveedor !== 'efectivo_manual';
  if (requiereCredencial && credencial) {
    const { error: errorCredencial } = await supabase.rpc('guardar_credencial_pasarela_pago', {
      p_prestadora_id: req.usuarioPanel.prestadoraId,
      p_proveedor: proveedor,
      p_credencial: credencial,
    });
    if (errorCredencial) return responderError(res, errorCredencial);
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
    if (errorSecreto) return responderError(res, errorSecreto);
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
  if (error) return responderError(res, error);

  res.json({ ok: true });
});

// ============================================================================
// Las formas de cobro que arma la Prestadora
//
// QUÉ SON. Las piezas con las que cada Prestadora arma cómo le cobra a sus Familias: qué se
// cobra, cada cuánto, con cuántos días gratis, con qué saldo de contactos y si se renueva sola
// (`supabase/migrations/20260911160000_la_prestadora_arma_su_forma_de_cobro.sql`). No hay una
// columna que diga «esto es una suscripción»: la forma sale de cómo se combinen las piezas, y
// una combinación nueva no necesita migración.
//
// POR QUÉ PASAN POR EL MOTOR Y NO DERECHO A LA BASE. La lista de precios de prestación directa
// se escribe desde la pantalla con la sesión de quien mira, y alcanza. Acá no: lo que decide que
// estas pantallas existan es la modalidad contratada, y ese candado vive en este riel
// (`exigirModalidad`, arriba). Escribiendo la dirección a mano se entraba igual.
//
// QUIÉN. Verlas es de la administración; armarlas y cambiarlas, sólo del Admin de la Prestadora,
// por lo mismo que las credenciales de cobro: cómo cobra una Prestadora no es asunto de un rol
// técnico de CeltaTech.
//
// Y NO HAY BAJA. Una forma que ya se contrató no se borra: se apaga con `ofrecida`, y los
// accesos que la tienen siguen apuntando a algo que existe.
// ============================================================================

const CAMPOS_DE_LA_FORMA =
  'id, nombre, importe, moneda, periodo_cantidad, periodo_unidad, dias_gratis, contactos_incluidos, renueva_sola, ofrecida, created_at, updated_at';

/** Las unidades de tiempo que el producto conoce. Salen de la base, nunca de una lista escrita
 *  acá (CLAUDE.md §8): la tabla es lo mismo que mira la clave foránea de la forma de cobro. */
async function unidadesDePeriodo() {
  const { data, error } = await supabase
    .from('catalogo_periodos_cobro')
    .select('clave, orden')
    .order('orden', { ascending: true });
  if (error) throw error;
  return (data || []).map((fila) => fila.clave);
}

/** Un entero de verdad: ni texto con letras, ni un decimal, ni vacío. `Number('')` da 0, así que
 *  comprobar solamente que sea un número deja pasar el campo vacío como si fuera cero. */
function enteroOInvalido(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isInteger(numero) ? numero : NaN;
}

/**
 * Lo que se va a guardar, o un error con motivo.
 *
 * Repite en el servidor lo que la tabla ya comprueba en la base, y no por desconfianza de la
 * base: un `CHECK` que salta sube como código crudo de Postgres, y de ahí la pantalla sólo puede
 * decir «hay un dato mal cargado». Comprobándolo acá, cada pieza mal cargada viaja con su propio
 * motivo y la persona lee cuál es (`celtatech/CLAUDE.md` §6, y `utils/errorConMotivo.js`).
 *
 * Falla cerrado: cualquier pieza que no se entienda es un rechazo, nunca un valor por omisión.
 */
function formaValidada(cuerpo, unidades) {
  const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : '';
  if (!nombre) throw new ErrorConMotivo('faltan_datos', 'La forma de cobro necesita un nombre');

  if (cuerpo.importe === null || cuerpo.importe === undefined || cuerpo.importe === '') {
    throw new ErrorConMotivo('faltan_datos', 'La forma de cobro necesita un importe');
  }
  const importe = Number(cuerpo.importe);
  if (!Number.isFinite(importe) || importe < 0) {
    throw new ErrorConMotivo('importe_invalido', `Importe fuera de rango: ${cuerpo.importe}`);
  }

  // El período son dos piezas que viajan juntas o no viajan: «cada 2» sin unidad no quiere decir
  // nada, y «cada mes» sin cantidad tampoco. Las dos vacías es una forma que se cobra una vez.
  const periodoCantidad = enteroOInvalido(cuerpo.periodo_cantidad);
  const periodoUnidad = typeof cuerpo.periodo_unidad === 'string' && cuerpo.periodo_unidad
    ? cuerpo.periodo_unidad
    : null;
  if (Number.isNaN(periodoCantidad)) {
    throw new ErrorConMotivo('periodo_invalido', `Cantidad de período no entera: ${cuerpo.periodo_cantidad}`);
  }
  if ((periodoCantidad === null) !== (periodoUnidad === null)) {
    throw new ErrorConMotivo('periodo_incompleto', 'El período lleva cantidad y unidad, o ninguna de las dos');
  }
  if (periodoCantidad !== null && periodoCantidad <= 0) {
    throw new ErrorConMotivo('periodo_invalido', `Cantidad de período no positiva: ${periodoCantidad}`);
  }
  if (periodoUnidad !== null && !unidades.includes(periodoUnidad)) {
    throw new ErrorConMotivo('unidad_de_periodo_desconocida', `Unidad fuera del catálogo: ${periodoUnidad}`);
  }

  const diasGratis = enteroOInvalido(cuerpo.dias_gratis);
  if (Number.isNaN(diasGratis) || (diasGratis !== null && diasGratis < 0)) {
    throw new ErrorConMotivo('dias_gratis_invalido', `Días gratis fuera de rango: ${cuerpo.dias_gratis}`);
  }

  const contactos = enteroOInvalido(cuerpo.contactos_incluidos);
  if (Number.isNaN(contactos) || (contactos !== null && contactos <= 0)) {
    throw new ErrorConMotivo('contactos_incluidos_invalido', `Contactos incluidos fuera de rango: ${cuerpo.contactos_incluidos}`);
  }

  const renuevaSola = cuerpo.renueva_sola === true;
  if (renuevaSola && periodoCantidad === null) {
    throw new ErrorConMotivo('renovacion_sin_periodo', 'Una forma que se cobra una sola vez no se renueva sola');
  }

  return {
    nombre,
    importe,
    periodo_cantidad: periodoCantidad,
    periodo_unidad: periodoUnidad,
    dias_gratis: diasGratis,
    contactos_incluidos: contactos,
    renueva_sola: renuevaSola,
    // Una forma nueva se ofrece salvo que se diga lo contrario: quien la está cargando la está
    // cargando para usarla.
    ofrecida: cuerpo.ofrecida === undefined ? true : cuerpo.ofrecida === true,
  };
}

/** El nombre repetido es lo único que la base rechaza y que la persona puede corregir sola, así
 *  que sube con motivo propio en vez de caer en «algo falló de nuestro lado». */
function errorDeGuardado(error) {
  if (error?.code === '23505') {
    return new ErrorConMotivo('nombre_de_forma_repetido', error.message);
  }
  return error;
}

panelMarketplaceRouter.get('/formas-de-cobro', soloAdministracion, async (req, res) => {
  const { data, error } = await supabase
    .from('formas_de_cobro_marketplace')
    .select(CAMPOS_DE_LA_FORMA)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('created_at', { ascending: true });
  if (error) return responderError(res, error);

  // Las unidades viajan con la lista para que la pantalla arme su desplegable sin tener que
  // conocerlas: el catálogo está en la base y esta ruta es la única puerta hacia él.
  let unidades;
  try {
    unidades = await unidadesDePeriodo();
  } catch (errorCatalogo) {
    return responderError(res, errorCatalogo);
  }

  res.json({ formas: data, unidades_de_periodo: unidades });
});

panelMarketplaceRouter.post('/formas-de-cobro', soloAdministracion, soloAdminArmaLaFormaDeCobro, async (req, res) => {
  let valores;
  try {
    valores = formaValidada(req.body || {}, await unidadesDePeriodo());
  } catch (error) {
    return responderError(res, error, 400);
  }

  // La moneda no viaja: la completa el disparador con la de la Prestadora, que es el único lugar
  // donde está decidida (`CLAUDE.md` de Careonys, «la moneda de cada importe se completa sola»).
  const { data, error } = await supabase
    .from('formas_de_cobro_marketplace')
    .insert({ ...valores, prestadora_id: req.usuarioPanel.prestadoraId })
    .select(CAMPOS_DE_LA_FORMA)
    .single();
  if (error) return responderError(res, errorDeGuardado(error));

  res.json({ forma: data });
});

panelMarketplaceRouter.patch('/formas-de-cobro/:id', soloAdministracion, soloAdminArmaLaFormaDeCobro, async (req, res) => {
  // Se lee la forma entera antes de tocarla por dos motivos. Uno: si no es de esta Prestadora, no
  // existe, y se contesta lo mismo que si no existiera. Dos: las piezas se comprueban entre sí
  // —renovarse sola exige período—, y eso no se puede hacer mirando sólo lo que vino en el pedido.
  const { data: actual, error: errorLectura } = await supabase
    .from('formas_de_cobro_marketplace')
    .select(CAMPOS_DE_LA_FORMA)
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (errorLectura) return responderError(res, errorLectura);
  if (!actual) return responderError(res, new ErrorConMotivo('no_encontrado', 'Forma de cobro de otra Prestadora o inexistente'));

  let valores;
  try {
    valores = formaValidada({ ...actual, ...req.body }, await unidadesDePeriodo());
  } catch (error) {
    return responderError(res, error, 400);
  }

  const { data, error } = await supabase
    .from('formas_de_cobro_marketplace')
    .update({ ...valores, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .select(CAMPOS_DE_LA_FORMA)
    .single();
  if (error) return responderError(res, errorDeGuardado(error));

  res.json({ forma: data });
});

// ============================================================================
// Accesos y cobros
// ============================================================================

// Nombres legibles de Familia/Paciente/Asistente en consultas separadas (no un único JOIN
// embebido): familia_id apunta a familias.id, que a su vez comparte id con usuarios.id, así
// que el nombre real vive en usuarios — resolverlo acá evita mostrar UUID crudo en el Panel
// (CLAUDE.md §7 regla 7, "sin datos crudos").
panelMarketplaceRouter.get('/accesos', soloAdministracion, async (req, res) => {
  const { data, error } = await supabase
    .from('accesos_marketplace')
    .select('id, familia_id, paciente_id, asistente_id, estado, importe, gratis_hasta, proximo_cobro, cancelada_en, created_at, proveedor, url_accion, alta_en_pasarela')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('created_at', { ascending: false });
  if (error) return responderError(res, error);

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

  const accesos = data.map((s) => ({
    ...s,
    familia_nombre: nombreFamilia.get(s.familia_id) || null,
    paciente_nombre: nombrePaciente.get(s.paciente_id) || null,
    asistente_nombre: s.asistente_id ? nombreAsistente.get(s.asistente_id) || null : null,
  }));

  res.json({ accesos });
});

panelMarketplaceRouter.get('/accesos/:id/cobros', soloAdministracion, async (req, res) => {
  const { data, error } = await supabase
    .from('cobros_marketplace')
    .select('id, medio, monto, periodo, estado_cobro, referencia_externa, fecha_cobro, registrado_por, created_at')
    .eq('acceso_id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('periodo', { ascending: false });
  if (error) return responderError(res, error);
  res.json({ cobros: data });
});

// Carga manual de efectivo en mano — mitigante central del riesgo de suspensión indebida
// por cobro no reflejado a tiempo en el sistema (docs/PLAN_HASTA_PRODUCCION.md). fecha_cobro es la
// fecha real del hecho, nunca la de carga (CLAUDE.md §3).
panelMarketplaceRouter.post('/cobros/efectivo-manual', soloAdministracion, async (req, res) => {
  const { acceso_id: accesoId, monto, periodo, fecha_cobro: fechaCobro } = req.body || {};
  if (!accesoId || !monto || !periodo || !fechaCobro) {
    return res.status(400).json({ error: 'Faltan acceso_id, monto, periodo o fecha_cobro' });
  }

  const { data: acceso } = await supabase
    .from('accesos_marketplace')
    .select('id')
    .eq('id', accesoId)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (!acceso) {
    return res.status(404).json({ error: 'Acceso no encontrado' });
  }

  const { error } = await supabase.from('cobros_marketplace').insert({
    acceso_id: accesoId,
    prestadora_id: req.usuarioPanel.prestadoraId,
    medio: 'efectivo_manual',
    monto,
    periodo,
    estado_cobro: 'exitoso',
    fecha_cobro: fechaCobro,
    registrado_por: req.usuarioPanel.id,
  });
  if (error) return responderError(res, error);

  // Y el acceso pasa al período siguiente. Sin esto el período quedaba pagado y el acceso seguía
  // esperando el mismo para siempre, así que el que viene no llegaba nunca.
  const movimiento = await registrarCobroExitoso({ accesoId, periodo });

  res.json({ ok: true, proximo_cobro: movimiento.proximo_cobro ?? null });
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
    .select('id, acceso_id, monto, periodo, expira_en, usado_en')
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

  const { data: acceso } = await supabase
    .from('accesos_marketplace')
    .select('id')
    .eq('id', qr.acceso_id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (!acceso) {
    return res.status(404).json({ error: 'El acceso de este QR no pertenece a esta Prestadora' });
  }

  const { data: cobro, error: errorCobro } = await supabase
    .from('cobros_marketplace')
    .insert({
      acceso_id: qr.acceso_id,
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
  if (errorCobro) return responderError(res, errorCobro);

  const { error: errorQr } = await supabase
    .from('qr_cobro_efectivo')
    .update({ usado_en: new Date().toISOString(), usado_por: req.usuarioPanel.id, cobro_id: cobro.id })
    .eq('id', qr.id);
  if (errorQr) return responderError(res, errorQr);

  // Igual que el efectivo en mano: cobrado el período, el acceso pasa al siguiente.
  const movimiento = await registrarCobroExitoso({ accesoId: qr.acceso_id, periodo: qr.periodo });

  res.json({ ok: true, monto: qr.monto, proximo_cobro: movimiento.proximo_cobro ?? null });
});

// ============================================================================
// El alta del acceso en la pasarela
// ============================================================================

// Sin esto un acceso vive en esta base y no existe del lado de ningún proveedor, así que no hay
// con qué cobrarle. Lo hace el Admin de la Prestadora desde la pantalla de accesos; mañana lo va
// a llamar también la activación del lado de la Familia. Los pasos que hacen falta están en un
// solo lugar (`utils/altaEnPasarela.js`) y esta ruta no repite ninguno.
panelMarketplaceRouter.post('/accesos/:id/alta-en-pasarela', soloAdministracion, async (req, res) => {
  const { proveedor } = req.body || {};

  // Con qué riel sólo hace falta decirlo cuando la Prestadora tiene más de uno conectado; con uno
  // solo se resuelve solo. Si viene, tiene que ser uno de los que el producto conoce.
  if (proveedor && !proveedoresDisponibles().includes(proveedor)) {
    return res.status(400).json({ error: 'Proveedor de pasarela desconocido' });
  }

  const resultado = await darDeAltaEnPasarela({
    accesoId: req.params.id,
    prestadoraId: req.usuarioPanel.prestadoraId,
    proveedor: proveedor || null,
  });

  if (!resultado.ok) {
    // El motivo es un código, y la frase que lee la persona sale de las traducciones del Panel en
    // los tres idiomas. El detalle crudo no sale de acá: puede nombrar la cuenta de cobro
    // (`celtatech\CLAUDE.md` §6).
    const estado = resultado.motivo === MOTIVO_ALTA.ACCESO_INEXISTENTE ? 404 : 409;
    return res.status(estado).json({
      error: 'No se pudo dar de alta el acceso en la pasarela',
      motivo: resultado.motivo,
      conectados: resultado.conectados,
    });
  }

  res.json({ ok: true, ya_estaba: Boolean(resultado.yaEstaba), alta: resultado.alta });
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
  if (error) return responderError(res, error);

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
  if (error) return responderError(res, error);
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

/* Lo único que agrega este ayudante es en qué consulta falló, porque una misma ruta hace
   varias y saber la ruta no alcanza para saber cuál. Qué sale hacia afuera no lo decide acá:
   lo decide `responderError`, que es el punto único —afuera va el código, el detalle crudo de
   la base se queda en el registro del servidor (CLAUDE.md §6)—. Antes contestaba una frase
   escrita a mano en castellano, que además nunca llegaba a verse: la pantalla trata cualquier
   500 como falla del sistema sin leer el mensaje (`panel/src/lib/errores.js`). */
function fallaDelSistema(res, donde, error) {
  console.error(`Marketplace, ${donde}:`, error?.message ?? error);
  return responderError(res, error);
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

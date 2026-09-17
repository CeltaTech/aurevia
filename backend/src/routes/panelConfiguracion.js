import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { acotarAPrestadora, exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { supabase } from '../db/connection.js';
import { accionesDePermisos } from '../utils/permisos.js';
import { exigirAdministracion, exigirAdminDePrestadora } from '../middleware/exigirAdministracion.js';
import { ErrorConMotivo, responderError } from '../utils/errorConMotivo.js';
import { avisoDelCatalogo, mezclarAvisosConCatalogo, sePuedeApagar, VALORES_POR_DEFECTO_AVISO } from '../utils/catalogoAvisos.js';
import { cosaDelCatalogo, mezclarVisibilidadConCatalogo } from '../utils/catalogoVisibilidad.js';
import { LIMITES_ALERTAS_IA, VALORES_POR_DEFECTO_ALERTAS_IA } from '../utils/revisarAlertasIA.js';
import { validarUmbralesPremura } from '../utils/umbralesPremura.js';
import {
  PERFIL_POR_DEFECTO,
  pesosYTopesDe,
  revisarCambios,
  soloLoQueCorreDelPerfil,
} from '../utils/perfilesDeCandidatos.js';
import {
  reglaDeEquipoDe,
  revisarRegla,
  soloLoQueCorreDeLaRegla,
} from '../utils/equipoDelPaciente.js';
// Con alias porque las tres funciones de configuración se llaman igual en los dos archivos: el
// molde es el mismo a propósito, y renombrarlas en el original para que no choquen acá escondería
// que son la misma clase de cosa.
import {
  reglaDeAvisoDe,
  revisarRegla as revisarReglaDeAviso,
  soloLoQueCorreDeLaRegla as soloLoQueCorreDelAviso,
} from '../utils/avisoDeAusencia.js';
import { darDeAltaEnMeta, traerEstadosDeMeta } from '../utils/plantillasWhatsapp.js';
import { redactarPlantillaWhatsapp, corregirPlantillaWhatsapp } from '../utils/iaPlantillasWhatsapp.js';
import { idiomaDeLaPrestadora } from '../i18n/idiomaDeLaPrestadora.js';
import { direccionDeEnvioDe, esDireccionDeCorreo } from '../utils/email.js';
import {
  apuntarReenvioDeRespuestas,
  hayReenvioConfigurado,
  respuestasConfirmadas,
} from '../utils/reenvioDeRespuestas.js';
import { LIMITES_AVISO_PREVIO_GUARDIA } from '../utils/revisarRecordatoriosPush.js';
import { METROS_TOLERANCIA_POR_OMISION, MINUTOS_TOLERANCIA_POR_OMISION } from '../utils/toleranciaCheckin.js';
import {
  SEGUNDOS_EN_PANTALLA_POR_OMISION,
  SEGUNDOS_EN_PANTALLA_MINIMO,
  SEGUNDOS_EN_PANTALLA_MAXIMO,
  MINUTOS_CODIGO_DE_LA_PRESTADORA_POR_OMISION,
  MINUTOS_CODIGO_DE_LA_PRESTADORA_MINIMO,
  MINUTOS_CODIGO_DE_LA_PRESTADORA_MAXIMO,
} from '../utils/comprobacionDePresencia.js';

export const panelConfiguracionRouter = Router();

// Módulo 8 (Configuración) es a nivel de toda la empresa — Coordinador no entra acá,
// solo Admin/Superadmin (misma restricción que precios y escalas legales).
const soloAdministracion = exigirAdministracion('Solo Admin o Superadmin puede editar la configuración');

// El corte por "no hay Organización activa" lo pone exigirOrganizacionActiva, compartido con el
// resto de los routers (CLAUDE.md §7.12) — antes esta misma condición estaba escrita acá a mano.
panelConfiguracionRouter.use(requiereRolPanel, soloAdministracion, exigirOrganizacionActiva);

// --- Datos de la prestadora (configuracion_prestadora, ver schema_multitenant_04.sql —
//     reemplaza el singleton configuracion_empresa: cada prestadora tiene su propia fila) ---
panelConfiguracionRouter.get('/empresa', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('configuracion_prestadora')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .single();
  if (error) return responderError(res, error);
  res.json({ empresa: data });
});

panelConfiguracionRouter.patch('/empresa', async (req, res) => {
  const { nombre, telefono, whatsapp_numero, email, dominio, zona_cobertura_texto } = req.body;
  // A diferencia de los datos que viven en `prestadoras`, esta fila puede no existir: se crea
  // en el alta y una Prestadora dada de alta a mano puede quedarse sin ella. Sin esta
  // comprobación, la pantalla de Configuración guarda, dice que guardó, y al recargar está todo
  // como antes.
  const { data, error } = await supabase
    .from('configuracion_prestadora')
    .update({ nombre, telefono, whatsapp_numero, email, dominio, zona_cobertura_texto, updated_at: new Date().toISOString() })
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .select('prestadora_id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'Esta Prestadora todavía no tiene configuración cargada' });
  res.json({ ok: true });
});

// --- Zonas de cobertura ---
panelConfiguracionRouter.get('/zonas', async (req, res) => {
  let query = supabase.from('zonas_cobertura').select('*').order('orden');
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query;
  if (error) return responderError(res, error);
  res.json({ zonas: data });
});

panelConfiguracionRouter.post('/zonas', async (req, res) => {
  const { codigo, nombre, categoria, orden } = req.body;
  if (!codigo || !nombre || !categoria) {
    return res.status(400).json({ error: 'Faltan código, nombre o categoría' });
  }
  const { error } = await supabase
    .from('zonas_cobertura')
    .insert({ codigo, nombre, categoria, orden: orden ?? 0, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/zonas/:id', async (req, res) => {
  const { nombre, categoria, activa, orden } = req.body;
  let query = supabase
    .from('zonas_cobertura')
    .update({ nombre, categoria, activa, orden })
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró esa zona de cobertura' });
  res.json({ ok: true });
});

panelConfiguracionRouter.delete('/zonas/:id', async (req, res) => {
  let query = supabase.from('zonas_cobertura').delete().eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró esa zona de cobertura' });
  res.json({ ok: true });
});

// --- Servicios: escalada de relevo (protocolo de continuidad de guardia) ---
panelConfiguracionRouter.get('/escalada-relevo', async (req, res) => {
  let query = supabase.from('configuracion_escalada_relevo').select('*').order('nivel');
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query;
  if (error) return responderError(res, error);
  res.json({ niveles: data });
});

panelConfiguracionRouter.post('/escalada-relevo', async (req, res) => {
  const { nivel, minutos_demora, orden_prioridad, plantilla_mensaje } = req.body;
  if (!nivel || !plantilla_mensaje) {
    return res.status(400).json({ error: 'Faltan nivel o plantilla de mensaje' });
  }
  const { error } = await supabase
    .from('configuracion_escalada_relevo')
    .insert({ nivel, minutos_demora, orden_prioridad, plantilla_mensaje, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/escalada-relevo/:id', async (req, res) => {
  const { nivel, minutos_demora, orden_prioridad, plantilla_mensaje } = req.body;
  let query = supabase
    .from('configuracion_escalada_relevo')
    .update({ nivel, minutos_demora, orden_prioridad, plantilla_mensaje })
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró ese nivel de la escalada de relevo' });
  res.json({ ok: true });
});

panelConfiguracionRouter.delete('/escalada-relevo/:id', async (req, res) => {
  let query = supabase.from('configuracion_escalada_relevo').delete().eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró ese nivel de la escalada de relevo' });
  res.json({ ok: true });
});

// --- Servicios: etapas del Proceso de Incorporación de Asistentes, configurables por
//     prestadora (pendiente #18 candidato 7, docs/PLAN_HASTA_PRODUCCION.md — ver
//     supabase/migrations/). Alta/edición/reordenamiento
//     desde el Panel; sin DELETE — se discontinúa con el toggle "activa" para no romper
//     verificaciones_asistente ya existentes que referencian esa etapa. ---
panelConfiguracionRouter.get('/etapas-incorporacion', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('etapas_incorporacion_asistente')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .order('orden');
  if (error) return responderError(res, error);
  res.json({ etapas: data });
});

panelConfiguracionRouter.post('/etapas-incorporacion', async (req, res) => {
  const { clave, nombre } = req.body;
  if (!clave || !nombre) return res.status(400).json({ error: 'Faltan clave o nombre' });
  const { data: maxOrden, error: errorMax } = await supabase
    .from('etapas_incorporacion_asistente')
    .select('orden')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('orden', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errorMax) return responderError(res, errorMax);
  const { error } = await supabase
    .from('etapas_incorporacion_asistente')
    .insert({ clave, nombre, orden: (maxOrden?.orden ?? 0) + 1, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/etapas-incorporacion/:id', async (req, res) => {
  const { nombre, activa } = req.body;
  let query = supabase
    .from('etapas_incorporacion_asistente')
    .update({ nombre, activa })
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró esa etapa del Proceso de Incorporación de Asistentes' });
  res.json({ ok: true });
});

// Reordena una etapa moviéndola una posición hacia arriba o abajo — intercambia su
// "orden" con el de la etapa vecina (misma prestadora).
panelConfiguracionRouter.patch('/etapas-incorporacion/:id/mover', async (req, res) => {
  const { direccion } = req.body;
  if (direccion !== 'arriba' && direccion !== 'abajo') {
    return res.status(400).json({ error: 'direccion debe ser "arriba" o "abajo"' });
  }
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data: etapas, error: errorEtapas } = await supabase
    .from('etapas_incorporacion_asistente')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .order('orden');
  if (errorEtapas) return responderError(res, errorEtapas);

  const indice = etapas.findIndex((e) => e.id === req.params.id);
  if (indice === -1) return res.status(404).json({ error: 'Etapa no encontrada' });
  const indiceVecino = direccion === 'arriba' ? indice - 1 : indice + 1;
  if (indiceVecino < 0 || indiceVecino >= etapas.length) return res.json({ ok: true });

  const actual = etapas[indice];
  const vecino = etapas[indiceVecino];
  const { error: errorSwap } = await supabase.rpc('intercambiar_orden_etapas_incorporacion', {
    p_id_a: actual.id, p_orden_a: vecino.orden, p_id_b: vecino.id, p_orden_b: actual.orden,
  });
  if (errorSwap) return responderError(res, errorSwap);
  res.json({ ok: true });
});

// --- Servicios: personal de emergencia (roster de suplentes/franqueros/emergencia
//     disponibles para el protocolo de continuidad de guardia, Parte 2 de Módulo 6) ---
panelConfiguracionRouter.get('/personal-emergencia', async (req, res) => {
  let query = supabase
    .from('personal_emergencia')
    .select('id, asistente_id, tipo, activo, created_at, asistentes(nombre)')
    .order('created_at', { ascending: false });
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query;
  if (error) return responderError(res, error);
  res.json({ personal: data });
});

panelConfiguracionRouter.post('/personal-emergencia', async (req, res) => {
  const { asistente_id, tipo } = req.body;
  if (!asistente_id || !tipo) {
    return res.status(400).json({ error: 'Faltan asistente_id o tipo' });
  }
  const { error } = await supabase
    .from('personal_emergencia')
    .insert({ asistente_id, tipo, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/personal-emergencia/:id', async (req, res) => {
  const { activo } = req.body;
  let query = supabase.from('personal_emergencia').update({ activo }).eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró a esa persona en el personal de emergencia' });
  res.json({ ok: true });
});

panelConfiguracionRouter.delete('/personal-emergencia/:id', async (req, res) => {
  let query = supabase.from('personal_emergencia').delete().eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró a esa persona en el personal de emergencia' });
  res.json({ ok: true });
});

// --- Configuración de notificaciones ---
// configuracion_notificaciones pasó a ser por prestadora el 2026-07-13
// (supabase/migrations/) — antes era una fila global por
// evento, compartida sin darse cuenta por todas las prestadoras licenciatarias.
//
// La pantalla muestra SIEMPRE los ocho avisos del catálogo (utils/catalogoAvisos.js), tenga
// o no tenga fila guardada cada uno. Antes devolvía solo las filas existentes, así que un
// aviso sin sembrar era invisible y no se podía apagar aunque se siguiera mandando.
panelConfiguracionRouter.get('/notificaciones', async (req, res) => {
  let query = supabase
    .from('configuracion_notificaciones')
    .select('evento, descripcion, emails, activo, whatsapp_activo, notificar_familia, plantilla_whatsapp_id');
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query;
  if (error) return responderError(res, error);
  res.json({ notificaciones: mezclarAvisosConCatalogo(data) });
});

// Inserción-o-actualización, no actualización a secas: la primera vez que la Prestadora toca
// un aviso, la fila todavía no existe y un UPDATE no hacía nada (guardaba en silencio y no
// guardaba nada). La descripción sale del catálogo, nunca del navegador.
panelConfiguracionRouter.patch('/notificaciones/:evento', async (req, res) => {
  const aviso = avisoDelCatalogo(req.params.evento);
  if (!aviso) return res.status(400).json({ error: 'Aviso desconocido' });

  const { emails, activo, whatsapp_activo, notificar_familia, plantilla_whatsapp_id } = req.body;

  // La plantilla se guarda sólo si es de esta Prestadora. El identificador viene del navegador, y
  // el motor entra a la base con la llave de servicio: sin esta comprobación, una Prestadora podría
  // mandar sus avisos con la plantilla de otra.
  let plantillaId = null;
  if (aviso.admite_whatsapp && plantilla_whatsapp_id) {
    const { data: plantilla } = await supabase
      .from('plantillas_whatsapp')
      .select('id')
      .eq('id', plantilla_whatsapp_id)
      .eq('prestadora_id', req.usuarioPanel.prestadoraId)
      .maybeSingle();
    if (!plantilla) return res.status(400).json({ error: 'Plantilla desconocida' });
    plantillaId = plantilla.id;
  }

  const { error } = await supabase.from('configuracion_notificaciones').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      evento: aviso.evento,
      descripcion: aviso.descripcion,
      emails: Array.isArray(emails) ? emails.map((correo) => String(correo).trim()).filter(Boolean) : [...VALORES_POR_DEFECTO_AVISO.emails],
      // Un aviso que la persona está esperando para poder seguir no se apaga aunque el navegador
      // lo mande apagado: la pantalla no ofrece esa casilla, y el emisor tampoco la obedecería.
      activo: sePuedeApagar(aviso) ? (activo === undefined ? VALORES_POR_DEFECTO_AVISO.activo : Boolean(activo)) : true,
      // Un canal que este aviso no usa se guarda apagado aunque el navegador lo mande
      // encendido: dejarlo prendido haría creer que el aviso sale por ahí, y no sale.
      whatsapp_activo: aviso.admite_whatsapp ? Boolean(whatsapp_activo) : false,
      notificar_familia: aviso.admite_familia ? Boolean(notificar_familia) : false,
      plantilla_whatsapp_id: plantillaId,
    },
    { onConflict: 'evento,prestadora_id' }
  );
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- Cuánto antes se le recuerda a la Asistente su próxima guardia. Estaba escrito fijo en
//     una hora para todas las Prestadoras (utils/revisarRecordatoriosPush.js), y una hora no
//     le sirve a todas: quien trabaja con guardias de doce horas quiere avisar la noche
//     anterior. Mismo patrón que /guardias/horizonte-generacion: el valor vive en
//     "prestadoras" y se expone acá para reusar el acotado por Prestadora de este router. ---
panelConfiguracionRouter.get('/aviso-previo-guardia', async (req, res) => {
  const { data, error } = await supabase
    .from('prestadoras')
    .select('minutos_aviso_previo_guardia')
    .eq('id', req.usuarioPanel.prestadoraId)
    .single();
  if (error) return responderError(res, error);
  res.json({ minutos_aviso_previo_guardia: data.minutos_aviso_previo_guardia });
});

panelConfiguracionRouter.patch('/aviso-previo-guardia', async (req, res) => {
  const { minutos } = req.body;
  if (
    !Number.isInteger(minutos)
    || minutos < LIMITES_AVISO_PREVIO_GUARDIA.minimo
    || minutos > LIMITES_AVISO_PREVIO_GUARDIA.maximo
  ) {
    return res.status(400).json({
      error: `El aviso previo tiene que ser un número entero de minutos, entre ${LIMITES_AVISO_PREVIO_GUARDIA.minimo} y ${LIMITES_AVISO_PREVIO_GUARDIA.maximo}.`,
    });
  }
  const { error } = await supabase
    .from('prestadoras')
    .update({ minutos_aviso_previo_guardia: minutos })
    .eq('id', req.usuarioPanel.prestadoraId);
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- Revisión con IA de los reportes (IA Nivel 2): palabras clave que disparan la revisión
//     inmediata, cuántos reportes se miran y a quién se entera de cada nivel de alerta.
//     Hasta ahora las palabras clave solo se podían cambiar por SQL directo contra la base, y
//     el resto estaba escrito fijo en utils/revisarAlertasIA.js — las dos cosas en contra de
//     "Configuración sobre programación" (CLAUDE.md §2). Mismo patrón que /ausencia-automatica. ---
panelConfiguracionRouter.get('/alertas-ia', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('configuracion_alertas_ia')
    .select('palabras_clave, reportes_a_analizar, roja_avisa_familia, amarilla_avisa_familia, amarilla_avisa_coordinador')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) return responderError(res, error);
  res.json({ configuracion: data || { ...VALORES_POR_DEFECTO_ALERTAS_IA } });
});

panelConfiguracionRouter.patch('/alertas-ia', async (req, res) => {
  const {
    palabras_clave, reportes_a_analizar,
    roja_avisa_familia, amarilla_avisa_familia, amarilla_avisa_coordinador,
  } = req.body;

  if (!Array.isArray(palabras_clave)) {
    return res.status(400).json({ error: 'palabras_clave debe ser una lista de textos' });
  }
  if (
    !Number.isInteger(reportes_a_analizar)
    || reportes_a_analizar < LIMITES_ALERTAS_IA.reportes_a_analizar_minimo
    || reportes_a_analizar > LIMITES_ALERTAS_IA.reportes_a_analizar_maximo
  ) {
    return res.status(400).json({
      error: `reportes_a_analizar debe ser un entero entre ${LIMITES_ALERTAS_IA.reportes_a_analizar_minimo} y ${LIMITES_ALERTAS_IA.reportes_a_analizar_maximo}`,
    });
  }

  // "Fiebre", " fiebre" y "FIEBRE" son la misma palabra: el disparo inmediato compara en
  // minúsculas (routes/appAsistentes.js), así que se guardan ya normalizadas y sin repetir.
  const palabrasNormalizadas = [
    ...new Set(
      palabras_clave
        .map((palabra) => String(palabra).trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  const { error } = await supabase.from('configuracion_alertas_ia').upsert({
    prestadora_id: req.usuarioPanel.prestadoraId,
    palabras_clave: palabrasNormalizadas,
    reportes_a_analizar,
    roja_avisa_familia: Boolean(roja_avisa_familia),
    amarilla_avisa_familia: Boolean(amarilla_avisa_familia),
    amarilla_avisa_coordinador: Boolean(amarilla_avisa_coordinador),
    updated_at: new Date().toISOString(),
  });
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- Qué muestran las dos aplicaciones de teléfono. La lista completa sale del catálogo del
//     motor (utils/catalogoVisibilidad.js) y la pantalla la muestra entera, tenga o no fila
//     guardada cada interruptor; la tabla solo guarda lo que la Prestadora cambió. Mismo patrón
//     que /notificaciones. ---
panelConfiguracionRouter.get('/visibilidad-app', async (req, res) => {
  const { data, error } = await supabase
    .from('configuracion_visibilidad_app')
    .select('clave, visible')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (error) return responderError(res, error);
  res.json({ visibilidad: mezclarVisibilidadConCatalogo(data) });
});

// Inserción-o-actualización, no actualización a secas: la primera vez que la Prestadora toca
// un interruptor la fila todavía no existe, y un UPDATE guardaría en silencio sin guardar nada.
// La clave se valida contra el catálogo: lo que mande el navegador que no esté en la lista no
// se guarda, para que no queden filas de interruptores que no existen.
panelConfiguracionRouter.patch('/visibilidad-app/:clave', async (req, res) => {
  const cosa = cosaDelCatalogo(req.params.clave);
  if (!cosa) return res.status(400).json({ error: 'Esa opción no existe' });

  const { visible } = req.body || {};
  if (typeof visible !== 'boolean') {
    return res.status(400).json({ error: 'Falta decir si se muestra o no' });
  }

  const { error } = await supabase.from('configuracion_visibilidad_app').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      clave: cosa.clave,
      visible,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'prestadora_id,clave' }
  );
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- Cómo se ordena la lista de candidatos para un hueco. Tres formas armadas y, para quien
//     quiera, el detalle abierto número por número. Las tres formas, los valores de fábrica y el
//     borde de cada número están en utils/perfilesDeCandidatos.js, que es copia del original del
//     Panel: así el motor comprueba contra la misma lista con la que el Panel dibuja la pantalla.
//
//     Se guarda solamente lo que corre respecto del perfil elegido, nunca la tabla entera:
//     guardar los cuarenta números congelaría los valores de fábrica apenas alguien abriera la
//     pantalla y le diera a guardar sin tocar nada. ---
panelConfiguracionRouter.get('/calculo-candidatos', async (req, res) => {
  const { data, error } = await supabase
    .from('configuracion_calculo_candidatos')
    .select('perfil, pesos, topes')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (error) return responderError(res, error);

  // La fila puede no existir —una Prestadora que nunca entró acá—, y eso no es un error: es la
  // configuración de fábrica. La pantalla necesita las tres capas para poder mostrar cada número
  // con su valor efectivo y saber cuáles fueron corridos a mano.
  const guardado = data ?? { perfil: PERFIL_POR_DEFECTO, pesos: {}, topes: {} };
  const efectivo = pesosYTopesDe(guardado);
  res.json({
    configuracion: {
      perfil: efectivo.perfil,
      pesos: efectivo.pesos,
      topes: efectivo.topes,
      corridos: { pesos: guardado.pesos ?? {}, topes: guardado.topes ?? {} },
    },
  });
});

panelConfiguracionRouter.put('/calculo-candidatos', async (req, res) => {
  const { perfil, pesos, topes } = req.body || {};

  // Llega la tabla completa desde la pantalla; acá se queda solamente lo que difiere del perfil.
  const corridos = soloLoQueCorreDelPerfil(perfil, pesos, topes);
  const revision = revisarCambios(perfil, corridos.pesos, corridos.topes);
  if (!revision.ok) {
    return res.status(400).json({ error: `El valor de «${revision.clave}» está fuera de lo permitido` });
  }

  const { error } = await supabase.from('configuracion_calculo_candidatos').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      perfil: perfil ?? PERFIL_POR_DEFECTO,
      pesos: corridos.pesos,
      topes: corridos.topes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'prestadora_id' }
  );
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- Con cuántos turnos se entra solo al equipo de un Paciente ---
//
// El equipo se arma solo y lo corrige la Coordinadora. Acá se guarda nada más que con cuántos
// turnos, y en qué ventana de días, alguien entra sin que nadie la ponga.

panelConfiguracionRouter.get('/equipo-paciente', async (req, res) => {
  const { data, error } = await supabase
    .from('configuracion_equipo_paciente')
    .select('regla')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (error) return responderError(res, error);

  // Que la fila no exista no es un error: es la configuración de fábrica.
  const corrido = data?.regla ?? {};
  res.json({ configuracion: { regla: reglaDeEquipoDe(corrido), corridos: corrido } });
});

panelConfiguracionRouter.put('/equipo-paciente', async (req, res) => {
  // Llega la regla completa desde la pantalla; acá se queda solamente lo que difiere de fábrica.
  const corridos = soloLoQueCorreDeLaRegla(req.body?.regla);
  const revision = revisarRegla(corridos);
  if (!revision.ok) {
    return res.status(400).json({ error: `El valor de «${revision.clave}» está fuera de lo permitido` });
  }

  const { error } = await supabase.from('configuracion_equipo_paciente').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      regla: corridos,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'prestadora_id' }
  );
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- Con cuánta anticipación una ausencia se considera avisada con tiempo ---
//
// De acá sale si una falta le llega a la Coordinadora como tarea o como alarma. Es la misma forma
// que la configuración del equipo: se guarda solamente lo que esta Prestadora corrió, y la
// pantalla recibe además los valores que están rigiendo.

panelConfiguracionRouter.get('/ausencias', async (req, res) => {
  const { data, error } = await supabase
    .from('configuracion_ausencias')
    .select('regla')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (error) return responderError(res, error);

  // Que la fila no exista no es un error: es la configuración de fábrica.
  const corrido = data?.regla ?? {};
  res.json({ configuracion: { regla: reglaDeAvisoDe(corrido), corridos: corrido } });
});

panelConfiguracionRouter.put('/ausencias', async (req, res) => {
  const corridos = soloLoQueCorreDelAviso(req.body?.regla);
  const revision = revisarReglaDeAviso(corridos);
  if (!revision.ok) {
    return res.status(400).json({ error: `El valor de «${revision.clave}» está fuera de lo permitido` });
  }

  const { error } = await supabase.from('configuracion_ausencias').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      regla: corridos,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'prestadora_id' }
  );
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- WhatsApp: credenciales de Meta Cloud API (Supabase Vault, ver
//     supabase/migrations/ — el token nunca vuelve a
//     mostrarse en el Panel una vez guardado) ---
//
// Acá se cierra más que en el resto del router. El candado de arriba
// (`soloAdministracion`) deja pasar a Superadmin, y para casi toda la configuración está bien:
// Superadmin es quien da soporte. Pero estas tres claves son con las que la Prestadora habla
// con Meta, y Superadmin es un rol técnico de CeltaTech: no tiene por qué poder leer si están
// cargadas ni, mucho menos, reemplazarlas. La sesión de soporte técnico tampoco lo habilita —
// existe para mirar los datos de una Organización por vez y queda auditada, no para alcanzar
// sus credenciales (`panel/src/lib/roles.js`, `esAdminDePrestadora`).
//
// Se agrega encima del de router en vez de tocar aquél, porque aquél protege bien al resto de
// la configuración y ahí Superadmin sí tiene que entrar. Sumar un candado nunca abre nada.
const soloAdminDePrestadora = exigirAdminDePrestadora(
  'Las credenciales de WhatsApp son de la Prestadora: solo Admin puede verlas y cambiarlas'
);

panelConfiguracionRouter.get('/whatsapp', soloAdminDePrestadora, async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('configuracion_whatsapp_prestadora')
    .select('prestadora_id, activo, numero_telefono, waba_id, phone_number_id, verificado_at, updated_at, app_secret_secret_id, verify_token_secret_id')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) return responderError(res, error);
  // De los tres secretos sale de acá si están cargados o no, nunca su contenido: la referencia
  // a la caja fuerte tampoco viaja al navegador, porque no le sirve para nada y sí sirve para
  // aparecer en un registro donde no tendría que estar.
  res.json({
    whatsapp: data
      ? {
          ...data,
          token_cargado: true,
          app_secret_cargado: !!data.app_secret_secret_id,
          verify_token_cargado: !!data.verify_token_secret_id,
          app_secret_secret_id: undefined,
          verify_token_secret_id: undefined,
        }
      : {
          prestadora_id: prestadoraId,
          activo: false,
          numero_telefono: null,
          waba_id: null,
          phone_number_id: null,
          verificado_at: null,
          token_cargado: false,
          app_secret_cargado: false,
          verify_token_cargado: false,
        },
  });
});

panelConfiguracionRouter.patch('/whatsapp', soloAdminDePrestadora, async (req, res) => {
  const { activo, numero_telefono, waba_id, phone_number_id, token, app_secret, verify_token } = req.body;
  const prestadoraId = req.usuarioPanel.prestadoraId;

  const { error } = await supabase
    .from('configuracion_whatsapp_prestadora')
    .upsert({
      prestadora_id: prestadoraId,
      activo,
      numero_telefono,
      waba_id,
      phone_number_id,
      updated_at: new Date().toISOString(),
    });
  if (error) return responderError(res, error);

  if (token) {
    const { error: errorToken } = await supabase.rpc('guardar_token_whatsapp', {
      p_prestadora_id: prestadoraId,
      p_token: token,
    });
    if (errorToken) return responderError(res, errorToken);
  }

  // Los dos secretos con los que el motor le cree a un aviso entrante de Meta (pendiente #165):
  // el de la aplicación, con el que se comprueba la firma de cada mensaje, y el token del
  // saludo inicial, que ahora es de esta Prestadora y no uno solo para todo el producto. Los
  // dos van a la caja fuerte y no vuelven a mostrarse acá, igual que el token de acceso.
  if (app_secret) {
    const { error: errorAppSecret } = await supabase.rpc('guardar_app_secret_whatsapp', {
      p_prestadora_id: prestadoraId,
      p_secreto: app_secret,
    });
    if (errorAppSecret) return responderError(res, errorAppSecret);
  }

  if (verify_token) {
    const { error: errorVerifyToken } = await supabase.rpc('guardar_verify_token_whatsapp', {
      p_prestadora_id: prestadoraId,
      p_token: verify_token,
    });
    if (errorVerifyToken) return responderError(res, errorVerifyToken);
  }

  res.json({ ok: true });
});

// --- El correo de esta Prestadora: desde dónde sale y adónde vuelven las respuestas ---
//
// Acá no se pide ningún servidor de correo ni ninguna contraseña, y no es un olvido. Cada
// Prestadora manda desde una dirección propia bajo el dominio del producto, que le fija el alta
// (`utils/casillaDeEnvio.js`) y que despacha el mismo servicio para todas. Lo único que la
// Prestadora elige es **adónde quiere que le lleguen las respuestas**, porque esa dirección sólo
// manda: quien le conteste un aviso le estaría escribiendo a un buzón que no existe
// (`utils/reenvioDeRespuestas.js`).
//
// Y por eso tampoco lleva el candado angosto que llevaba la contraseña: la casilla de respuestas
// no es un secreto, es el mismo `configuracion_prestadora.email` que ya se edita desde la
// pantalla de datos de la empresa. Dos puertas sobre el mismo dato con cerraduras distintas es
// una sola puerta mal cerrada.

// Lo que la pantalla necesita saber para explicar en qué estado está el correo de esta
// Prestadora. Son cuatro cosas distintas y ninguna se deduce de otra, así que se arman juntas y
// las devuelven tanto la lectura como el guardado.
async function estadoDelCorreoDe(prestadoraId) {
  const { data } = await supabase
    .from('configuracion_prestadora')
    .select('email')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  const { data: prestadora } = await supabase
    .from('prestadoras')
    .select('regla_reenvio')
    .eq('id', prestadoraId)
    .maybeSingle();

  const emailRespuestas = data?.email ?? null;

  return {
    // Nula significa que esta Prestadora no tiene dirección propia y manda desde la común del
    // producto. Pasa con las que se dieron de alta antes de que existiera la casilla propia.
    direccion_envio: await direccionDeEnvioDe(prestadoraId),
    email_respuestas: emailRespuestas,
    reenvio_abierto: Boolean(prestadora?.regla_reenvio),
    // Se pregunta en el momento: el clic con el que se confirma la casilla lo da una persona
    // cuando quiere, así que un valor guardado diría «sin confirmar» para siempre.
    respuestas_confirmadas: await respuestasConfirmadas(emailRespuestas),
    // Sin el servicio configurado no hay reenvío posible, y la pantalla lo dice en vez de
    // mostrar un reenvío cerrado como si fuera una falla de esta Prestadora.
    servicio_configurado: hayReenvioConfigurado(),
  };
}

panelConfiguracionRouter.get('/correo', async (req, res) => {
  try {
    res.json({ correo: await estadoDelCorreoDe(req.usuarioPanel.prestadoraId) });
  } catch (error) {
    responderError(res, error);
  }
});

panelConfiguracionRouter.patch('/correo', async (req, res) => {
  const { email_respuestas: emailRespuestas } = req.body;
  const prestadoraId = req.usuarioPanel.prestadoraId;

  if (!esDireccionDeCorreo(emailRespuestas)) {
    // Mismo motivo que la casilla mal escrita en el alta: es el mismo dato y se arregla igual.
    return responderError(res, new ErrorConMotivo('correo_invalido'));
  }

  const { data, error } = await supabase
    .from('configuracion_prestadora')
    .update({ email: emailRespuestas, updated_at: new Date().toISOString() })
    .eq('prestadora_id', prestadoraId)
    .select('prestadora_id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'Esta Prestadora todavía no tiene configuración cargada' });

  // El reenvío tiene que seguir a la casilla. Si se guardara la casilla nueva sin mover el
  // reenvío, las respuestas seguirían yendo a la vieja y nadie se enteraría.
  const { data: prestadora } = await supabase
    .from('prestadoras')
    .select('regla_reenvio')
    .eq('id', prestadoraId)
    .maybeSingle();

  await apuntarReenvioDeRespuestas({
    prestadoraId,
    direccionDeEnvio: await direccionDeEnvioDe(prestadoraId),
    emailRespuestas,
    reglaAnterior: prestadora?.regla_reenvio ?? null,
  });

  res.json({ correo: await estadoDelCorreoDe(prestadoraId) });
});

// --- WhatsApp: plantillas de mensaje (requieren aprobación de Meta antes de poder
//     usarse para un mensaje que la prestadora inicia) ---
panelConfiguracionRouter.get('/whatsapp/plantillas', async (req, res) => {
  let query = supabase.from('plantillas_whatsapp').select('*').order('created_at', { ascending: false });
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query;
  if (error) return responderError(res, error);
  res.json({ plantillas: data });
});

panelConfiguracionRouter.post('/whatsapp/plantillas', async (req, res) => {
  const { nombre_interno, categoria, idioma, cuerpo_texto } = req.body;
  if (!nombre_interno || !categoria || !cuerpo_texto) {
    return res.status(400).json({ error: 'Faltan nombre_interno, categoria o cuerpo_texto' });
  }
  const { error } = await supabase.from('plantillas_whatsapp').insert({
    nombre_interno,
    categoria,
    idioma: idioma || 'es-AR',
    cuerpo_texto,
    prestadora_id: req.usuarioPanel.prestadoraId,
    created_by: req.usuarioPanel.id,
  });
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// Lo único que se edita a mano es el texto, y solamente mientras la plantilla es un borrador. El
// estado y el identificador de Meta los escribe el alta de acá abajo con lo que Meta contesta:
// puestos a mano decían que la plantilla estaba aprobada sin que nadie lo hubiera preguntado.
panelConfiguracionRouter.patch('/whatsapp/plantillas/:id', async (req, res) => {
  const { cuerpo_texto } = req.body;
  if (!cuerpo_texto) return responderError(res, new ErrorConMotivo('faltan_datos', 'Falta cuerpo_texto'));

  let query = supabase
    .from('plantillas_whatsapp')
    .update({ cuerpo_texto, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('estado', 'borrador');
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  // La que no existe, la de otra Prestadora y la que ya salió hacia Meta contestan lo mismo: el
  // texto de una plantilla que ya se mandó no se cambia de este lado sin que Meta se entere.
  if (!data?.length) return responderError(res, new ErrorConMotivo('no_encontrado', 'Plantilla inexistente, de otra Prestadora o ya enviada'));
  res.json({ ok: true });
});

// La IA escribe el texto, y quien coordina decide. Las dos rutas que siguen no guardan nada ni le
// mandan nada a Meta: devuelven una propuesta, que se ve en la pantalla antes de usarla. Guardarla
// sola sería escribir en nombre de la Prestadora un texto que nadie leyó
// (`docs/PRD_06_WhatsApp_IA.md:49`).
panelConfiguracionRouter.post('/whatsapp/plantillas/redactar', async (req, res) => {
  const { proposito, categoria } = req.body ?? {};
  const prestadoraId = req.usuarioPanel.prestadoraId;
  try {
    // El idioma no se le pregunta a la pantalla: es el de la Prestadora, resuelto donde ya se
    // resuelve para todos los avisos.
    const propuesta = await redactarPlantillaWhatsapp({
      proposito,
      categoria,
      idioma: await idiomaDeLaPrestadora(prestadoraId),
      prestadoraId,
    });
    res.json({ propuesta });
  } catch (err) {
    responderError(res, err);
  }
});

// Corregir la que Meta rechazó, leyendo lo que Meta objetó. Lo que hoy queda escrito en la fila es
// la sigla con la que Meta nombra su objeción, en inglés; acá se convierte en otro texto.
panelConfiguracionRouter.post('/whatsapp/plantillas/:id/corregir', async (req, res) => {
  let query = supabase
    .from('plantillas_whatsapp')
    .select('id, categoria, idioma, cuerpo_texto, motivo_rechazo')
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data: filas, error } = await query;
  if (error) return responderError(res, error);
  const plantilla = filas?.[0];
  if (!plantilla) return responderError(res, new ErrorConMotivo('no_encontrado', 'Plantilla inexistente o de otra Prestadora'));

  try {
    const propuesta = await corregirPlantillaWhatsapp({
      plantilla,
      prestadoraId: req.usuarioPanel.prestadoraId,
    });
    res.json({ propuesta });
  } catch (err) {
    responderError(res, err);
  }
});

// Dar de alta la plantilla en Meta. Hasta que esto existió, el botón del Panel cambiaba el estado
// guardado y nada más.
panelConfiguracionRouter.post('/whatsapp/plantillas/:id/enviar-a-meta', async (req, res) => {
  let query = supabase.from('plantillas_whatsapp').select('*').eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data: filas, error } = await query;
  if (error) return responderError(res, error);
  const plantilla = filas?.[0];
  if (!plantilla) return responderError(res, new ErrorConMotivo('no_encontrado', 'Plantilla inexistente o de otra Prestadora'));
  if (plantilla.estado !== 'borrador') {
    return responderError(res, new ErrorConMotivo('plantilla_ya_enviada', `Estado ${plantilla.estado}`));
  }

  let resultado;
  try {
    resultado = await darDeAltaEnMeta(plantilla);
  } catch (err) {
    // Lo que Meta objetó queda guardado en la fila: es lo que hay que corregir para volver a
    // intentarlo, y la plantilla se queda en borrador justamente para poder corregirla.
    if (err.motivo === 'meta_no_acepto') {
      await supabase
        .from('plantillas_whatsapp')
        .update({ motivo_rechazo: err.message, updated_at: new Date().toISOString() })
        .eq('id', plantilla.id);
    }
    return responderError(res, err);
  }

  const { error: errorGuardado } = await supabase
    .from('plantillas_whatsapp')
    .update({
      meta_template_id: resultado.metaTemplateId,
      estado: resultado.estado,
      motivo_rechazo: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', plantilla.id);
  if (errorGuardado) return responderError(res, errorGuardado);

  res.json({ ok: true, estado: resultado.estado });
});

// Preguntarle a Meta cómo quedaron las plantillas que ya salieron. El camino normal es el aviso
// automático de Meta, que entra por `whatsappWebhook.js` y no le pide nada a nadie; esto es la
// otra puerta, para cuando ese aviso no está conectado o se perdió uno. Se pregunta por todas en
// un solo pedido y se escriben únicamente las que cambiaron.
panelConfiguracionRouter.post('/whatsapp/plantillas/consultar-a-meta', async (req, res) => {
  let query = supabase
    .from('plantillas_whatsapp')
    .select('id, meta_template_id, estado, motivo_rechazo')
    .not('meta_template_id', 'is', null);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data: plantillas, error } = await query;
  if (error) return responderError(res, error);

  let estados;
  try {
    estados = await traerEstadosDeMeta(req.usuarioPanel.prestadoraId);
  } catch (err) {
    return responderError(res, err);
  }

  let cambiadas = 0;
  for (const plantilla of plantillas ?? []) {
    const enMeta = estados.get(String(plantilla.meta_template_id));
    if (!enMeta) continue;
    if (enMeta.estado === plantilla.estado && (enMeta.motivo ?? null) === (plantilla.motivo_rechazo ?? null)) continue;

    const { error: errorGuardado } = await supabase
      .from('plantillas_whatsapp')
      .update({
        estado: enMeta.estado,
        motivo_rechazo: enMeta.motivo,
        updated_at: new Date().toISOString(),
      })
      .eq('id', plantilla.id);
    if (errorGuardado) return responderError(res, errorGuardado);
    cambiadas += 1;
  }

  res.json({ ok: true, cambiadas });
});

panelConfiguracionRouter.delete('/whatsapp/plantillas/:id', async (req, res) => {
  let query = supabase.from('plantillas_whatsapp').delete().eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró esa plantilla de WhatsApp' });
  res.json({ ok: true });
});

// --- Catálogo de tipos de documento de Asistente (vencimientos a trackear) + plazo de aviso
//     configurable por prestadora (pendiente #18 punto 1, docs/PLAN_HASTA_PRODUCCION.md — ver
//     supabase/migrations/). El plazo vive en la tabla "prestadoras",
//     de gestión exclusiva de superadmin por RLS (schema_multitenant_01.sql) — se expone acá
//     porque el backend usa la service role key y aplica el mismo scoping por prestadora que
//     el resto de este archivo. ---
panelConfiguracionRouter.get('/documentos-tipo', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;

  const [{ data: tipos, error: errorTipos }, { data: prestadora, error: errorPrestadora }] = await Promise.all([
    supabase.from('tipos_documento_asistente').select('*').eq('prestadora_id', prestadoraId).order('nombre'),
    supabase.from('prestadoras').select('dias_aviso_vencimiento_documentos').eq('id', prestadoraId).single(),
  ]);
  if (errorTipos) return responderError(res, errorTipos);
  if (errorPrestadora) return responderError(res, errorPrestadora);
  res.json({ tipos, dias_aviso_vencimiento_documentos: prestadora.dias_aviso_vencimiento_documentos });
});

panelConfiguracionRouter.post('/documentos-tipo', async (req, res) => {
  const { nombre, requiere_vencimiento } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta nombre' });
  const { error } = await supabase
    .from('tipos_documento_asistente')
    .insert({ nombre, requiere_vencimiento: requiere_vencimiento ?? true, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/documentos-tipo/plazo-aviso', async (req, res) => {
  const { dias } = req.body;
  if (!Number.isInteger(dias) || dias <= 0) {
    return res.status(400).json({ error: 'dias debe ser un entero positivo' });
  }
  const { error } = await supabase
    .from('prestadoras')
    .update({ dias_aviso_vencimiento_documentos: dias })
    .eq('id', req.usuarioPanel.prestadoraId);
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- Qué tan estricto es el control de matrícula en esta prestadora.
//     Mismo motivo que el plazo de aviso de más arriba: el dato vive en la tabla "prestadoras",
//     que por RLS solo superadmin puede modificar. El navegador no la puede escribir ni aunque
//     lo intente; el backend sí, porque usa la service role key y acota siempre a la prestadora
//     de quien pide. Los dos valores posibles los fija una restricción de la base
//     supabase/migrations/20260801180000_regla_matricula_vigente.sql) — acá se repiten como
//     validación de entrada, no como fuente de verdad. ---
const MODOS_DE_CONTROL_MATRICULA = ['flexible', 'estricto'];

panelConfiguracionRouter.get('/modo-control-matricula', async (req, res) => {
  const { data, error } = await supabase
    .from('prestadoras')
    .select('modo_control_matricula')
    .eq('id', req.usuarioPanel.prestadoraId)
    .single();
  if (error) return responderError(res, error);
  res.json({ modo: data.modo_control_matricula });
});

panelConfiguracionRouter.patch('/modo-control-matricula', async (req, res) => {
  const { modo } = req.body;
  if (!MODOS_DE_CONTROL_MATRICULA.includes(modo)) {
    return res.status(400).json({ error: 'modo debe ser flexible o estricto' });
  }
  const { error } = await supabase
    .from('prestadoras')
    .update({ modo_control_matricula: modo })
    .eq('id', req.usuarioPanel.prestadoraId);
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- Catálogo de motivos de aviso previo de guardia, configurable por prestadora. Mismo patrón
//     que /documentos-tipo. ---
panelConfiguracionRouter.get('/motivos-aviso-previo', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('motivos_aviso_previo_guardia')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .order('nombre');
  if (error) return responderError(res, error);
  res.json({ motivos: data });
});

panelConfiguracionRouter.post('/motivos-aviso-previo', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta nombre' });
  const { error } = await supabase
    .from('motivos_aviso_previo_guardia')
    .insert({ nombre, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/motivos-aviso-previo/:id', async (req, res) => {
  const { nombre, activo } = req.body;
  let query = supabase
    .from('motivos_aviso_previo_guardia')
    .update({ nombre, activo })
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró ese motivo de aviso previo' });
  res.json({ ok: true });
});

// --- Catálogo de motivos de cierre de la atención de un Paciente, configurable por prestadora.
//     Dos niveles: las filas que trae el producto guardan "clave" y su texto sale de las
//     traducciones; las que agrega la prestadora guardan "nombre", escrito por ella. Cada
//     prestadora nace con las siete de fábrica y a partir de ahí la lista es suya: puede
//     apagarlas, borrarlas y agregar las que quiera. La base lo controla en el disparador
//     "validar_motivo_cierres_servicio_paciente", no acá. ---
panelConfiguracionRouter.get('/motivos-cierre-servicio', async (req, res) => {
  const { data, error } = await supabase
    .from('motivos_cierre_servicio')
    .select('*')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('orden');
  if (error) return responderError(res, error);
  res.json({ motivos: data });
});

/* Sólo se crean motivos propios: los de fábrica ya vienen sembrados y su clave no la elige
   nadie desde afuera —el texto visible de una clave sale de las traducciones, así que una clave
   inventada acá se mostraría con un guion—. Por eso esta ruta no acepta "clave". */
panelConfiguracionRouter.post('/motivos-cierre-servicio', async (req, res) => {
  const { nombre, pide_detalle } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta nombre' });
  const { error } = await supabase
    .from('motivos_cierre_servicio')
    .insert({
      nombre,
      pide_detalle: pide_detalle === true,
      prestadora_id: req.usuarioPanel.prestadoraId,
    });
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

/* Lo que se puede cambiar de una fila ya creada es si está encendida y si pide detalle. El
   nombre no: es lo que quedó escrito en los cierres que ya se hicieron con ese motivo, y
   cambiarlo acá los dejaría diciendo una cosa distinta de la que se eligió ese día. Para
   corregir un nombre se apaga el motivo y se crea otro. */
panelConfiguracionRouter.patch('/motivos-cierre-servicio/:id', async (req, res) => {
  const { activo, pide_detalle } = req.body;
  const cambios = {};
  if (activo !== undefined) cambios.activo = activo === true;
  if (pide_detalle !== undefined) cambios.pide_detalle = pide_detalle === true;
  if (Object.keys(cambios).length === 0) {
    return res.status(400).json({ error: 'No hay nada que cambiar' });
  }
  cambios.updated_at = new Date().toISOString();
  let query = supabase.from('motivos_cierre_servicio').update(cambios).eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró ese motivo de cierre' });
  res.json({ ok: true });
});

/* Borrar no rompe la historia: el cierre guarda el texto del motivo, no una referencia a esta
   fila, así que los cierres viejos siguen diciendo lo que decían. */
panelConfiguracionRouter.delete('/motivos-cierre-servicio/:id', async (req, res) => {
  let query = supabase.from('motivos_cierre_servicio').delete().eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró ese motivo de cierre' });
  res.json({ ok: true });
});

// --- Horizonte de generación de guardias de series abiertas — cron
//     backend/src/utils/generacionSeriesGuardia.js. Mismo patrón que
//     /documentos-tipo/plazo-aviso: valor en "prestadoras", expuesto acá para reusar el
//     scoping por prestadora ya resuelto en este router. ---
panelConfiguracionRouter.get('/guardias/horizonte-generacion', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('prestadoras')
    .select('dias_generacion_series_guardia')
    .eq('id', prestadoraId)
    .single();
  if (error) return responderError(res, error);
  res.json({ dias_generacion_series_guardia: data.dias_generacion_series_guardia });
});

panelConfiguracionRouter.patch('/guardias/horizonte-generacion', async (req, res) => {
  const { dias } = req.body;
  if (!Number.isInteger(dias) || dias <= 0) {
    return res.status(400).json({ error: 'dias debe ser un entero positivo' });
  }
  const { error } = await supabase
    .from('prestadoras')
    .update({ dias_generacion_series_guardia: dias })
    .eq('id', req.usuarioPanel.prestadoraId);
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- Ausencia automática por falta de check-in GPS (Etapa 3, pendiente #63): antes solo
//     editable por SQL directo contra Supabase, violando "Configuración sobre programación"
//     (CLAUDE.md §2). Ver backend/src/routes/appAsistentes.js (uso de metros_tolerancia_checkin
//     al validar el check-in) y backend/src/utils/ausenciaAutomatica.js (uso de
//     minutos_tolerancia_checkin y activo). ---
panelConfiguracionRouter.get('/ausencia-automatica', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('configuracion_ausencia_automatica')
    .select(
      'activo, minutos_tolerancia_checkin, metros_tolerancia_checkin, ' +
      'segundos_codigo_en_pantalla, minutos_codigo_de_la_prestadora',
    )
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) return responderError(res, error);
  res.json({
    configuracion: data || {
      activo: true,
      minutos_tolerancia_checkin: MINUTOS_TOLERANCIA_POR_OMISION,
      metros_tolerancia_checkin: METROS_TOLERANCIA_POR_OMISION,
      segundos_codigo_en_pantalla: SEGUNDOS_EN_PANTALLA_POR_OMISION,
      minutos_codigo_de_la_prestadora: MINUTOS_CODIGO_DE_LA_PRESTADORA_POR_OMISION,
    },
  });
});

/* Las dos decisiones del pase de guardia (pendiente #113) viajan por acá y no por una ruta
   propia porque viven en la misma fila y describen lo mismo: cada cuánto se renueva el código
   que alguien muestra en su pantalla, y cuántos minutos vale el que suelta la Prestadora. Los
   topes son los de las restricciones de la base; se comprueban también acá para que el rechazo
   llegue con un mensaje que la pantalla pueda explicar y no con el texto crudo de la base. */
panelConfiguracionRouter.patch('/ausencia-automatica', async (req, res) => {
  const {
    activo,
    minutos_tolerancia_checkin,
    metros_tolerancia_checkin,
    segundos_codigo_en_pantalla,
    minutos_codigo_de_la_prestadora,
  } = req.body;
  if (!Number.isInteger(minutos_tolerancia_checkin) || minutos_tolerancia_checkin <= 0) {
    return res.status(400).json({ error: 'minutos_tolerancia_checkin debe ser un entero positivo' });
  }
  if (!Number.isInteger(metros_tolerancia_checkin) || metros_tolerancia_checkin <= 0) {
    return res.status(400).json({ error: 'metros_tolerancia_checkin debe ser un entero positivo' });
  }
  if (
    !Number.isInteger(segundos_codigo_en_pantalla) ||
    segundos_codigo_en_pantalla < SEGUNDOS_EN_PANTALLA_MINIMO ||
    segundos_codigo_en_pantalla > SEGUNDOS_EN_PANTALLA_MAXIMO
  ) {
    return res.status(400).json({
      error: `segundos_codigo_en_pantalla debe estar entre ${SEGUNDOS_EN_PANTALLA_MINIMO} y ${SEGUNDOS_EN_PANTALLA_MAXIMO}`,
    });
  }
  if (
    !Number.isInteger(minutos_codigo_de_la_prestadora) ||
    minutos_codigo_de_la_prestadora < MINUTOS_CODIGO_DE_LA_PRESTADORA_MINIMO ||
    minutos_codigo_de_la_prestadora > MINUTOS_CODIGO_DE_LA_PRESTADORA_MAXIMO
  ) {
    return res.status(400).json({
      error: `minutos_codigo_de_la_prestadora debe estar entre ${MINUTOS_CODIGO_DE_LA_PRESTADORA_MINIMO} y ${MINUTOS_CODIGO_DE_LA_PRESTADORA_MAXIMO}`,
    });
  }
  const { error } = await supabase
    .from('configuracion_ausencia_automatica')
    .upsert({
      prestadora_id: req.usuarioPanel.prestadoraId,
      activo: Boolean(activo),
      minutos_tolerancia_checkin,
      metros_tolerancia_checkin,
      segundos_codigo_en_pantalla,
      minutos_codigo_de_la_prestadora,
    });
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/documentos-tipo/:id', async (req, res) => {
  const { nombre, requiere_vencimiento, activo } = req.body;
  let query = supabase
    .from('tipos_documento_asistente')
    .update({ nombre, requiere_vencimiento, activo })
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query.select('id');
  if (error) return responderError(res, error);
  if (!data?.length) return res.status(404).json({ error: 'No se encontró ese tipo de documento' });
  res.json({ ok: true });
});

// --- Motor de permisos configurable por Prestadora — quién, además de un Admin, puede dar de
//     alta a mano, editar datos de Asistentes/Familias/Pacientes, importar en masa, validar un
//     informe de Obra Social o ver lo que se le paga a un Asistente.
//
//     Qué acciones existen y qué pasa con cada una cuando la Prestadora no configuró nada NO se
//     decide acá: sale del catálogo de la base, que es el único lugar donde está escrito. Hasta
//     el 2026-08-19 esta pantalla tenía su propia lista de tres acciones y mostraba un estado
//     que el motor no aplicaba (pendiente #127). Ver backend/src/utils/permisos.js. ---

// Los Coordinadores de una Prestadora, para las pantallas de Configuración que hacen elegir uno
// de una lista. Sale del motor y no del navegador porque la tabla `usuarios` sólo deja que cada
// persona lea su propia fila: pedida desde el Panel, la lista vuelve vacía y el desplegable
// aparece sin nadie adentro. El motor entra con la llave maestra —decisión escrita en
// `CLAUDE.md` §6— y acota a la Prestadora acá, en la única consulta que hace falta escribir.
// Todo el router está reservado a Admin y Superadmin de la Organización activa (ver el
// `use` de arriba), así que esta lista no llega a más gente de la que ya podía verla.
function coordinadoresDeLaPrestadora(prestadoraId) {
  return supabase
    .from('usuarios')
    .select('id, nombre')
    .eq('prestadora_id', prestadoraId)
    .eq('rol', 'coordinador')
    .order('nombre');
}

panelConfiguracionRouter.get('/permisos', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  try {
    const [acciones, { data: filas, error: errorFilas }, { data: coordinadores, error: errorCoordinadores }] = await Promise.all([
      accionesDePermisos(),
      supabase.from('permisos_prestadora').select('*').eq('prestadora_id', prestadoraId),
      coordinadoresDeLaPrestadora(prestadoraId),
    ]);
    if (errorFilas) return responderError(res, errorFilas);
    if (errorCoordinadores) return responderError(res, errorCoordinadores);

    const porAccion = Object.fromEntries((filas || []).map((f) => [f.accion, f]));
    const permisos = acciones.map(({ accion, default_solo_admin }) => porAccion[accion] || {
      accion,
      alcance: default_solo_admin ? 'solo_admin' : 'admin_y_coordinador',
      excepciones_permitir: [],
      excepciones_denegar: [],
    });

    res.json({ permisos, coordinadores });
  } catch (e) {
    responderError(res, e);
  }
});

panelConfiguracionRouter.patch('/permisos/:accion', async (req, res) => {
  const { accion } = req.params;
  let acciones;
  try {
    acciones = await accionesDePermisos();
  } catch (e) {
    return responderError(res, e);
  }
  if (!acciones.some((a) => a.accion === accion)) {
    return res.status(400).json({ error: 'Acción desconocida' });
  }
  const { alcance, excepciones_permitir, excepciones_denegar } = req.body;
  if (!['solo_admin', 'admin_y_coordinador'].includes(alcance)) {
    return res.status(400).json({ error: 'Alcance inválido' });
  }
  const { error } = await supabase.from('permisos_prestadora').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      accion,
      alcance,
      excepciones_permitir: excepciones_permitir || [],
      excepciones_denegar: excepciones_denegar || [],
      actualizado_por: req.usuarioPanel.id,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: 'prestadora_id,accion' }
  );
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

panelConfiguracionRouter.get('/politica-verificacion', async (req, res) => {
  const { data, error } = await supabase
    .from('prestadoras')
    .select('politica_verificacion_alta_manual')
    .eq('id', req.usuarioPanel.prestadoraId)
    .single();
  if (error) return responderError(res, error);
  res.json({ politica_verificacion_alta_manual: data.politica_verificacion_alta_manual });
});

panelConfiguracionRouter.patch('/politica-verificacion', async (req, res) => {
  const { politica } = req.body;
  if (!['omitir', 'pendiente', 'aprobado'].includes(politica)) {
    return res.status(400).json({ error: 'Política inválida' });
  }
  const { error } = await supabase
    .from('prestadoras')
    .update({ politica_verificacion_alta_manual: politica })
    .eq('id', req.usuarioPanel.prestadoraId);
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- Modalidades de negocio activas (PRD_08_Dashboard_Modalidades.md, aprobado 2026-07-24,
//     primer corte "Base: tabla + menú + onboarding"). Activar/desactivar es exclusivo de
//     admin_prestadora (este router ya lo exige vía soloAdministracion más arriba); la
//     lectura para armar el menú de cualquier rol vive en panelCuentas.js /modalidades-activas
//     (misma tabla, misma fuente única de verdad — CLAUDE.md §7 regla 12).
//     'subcontratacion' todavía no se ofrece acá: no tiene menú ni pantallas (PRD_08 §3.8),
//     solo existe en el CHECK de la tabla para no requerir otra migración cuando se diseñe.
//     Hasta el 2026-08-07 ese valor se llamaba 'cooperativa', que nombraba otra cosa
//     (pendiente #115).
const MODALIDAD_MARKETPLACE = 'marketplace';
const MODALIDADES_DISPONIBLES = ['directa', MODALIDAD_MARKETPLACE];

// Un acceso del Marketplace sigue en curso mientras esté vigente. Vencido o cancelado ya no ata
// nada: se apagó solo.
const ACCESO_EN_CURSO = 'vigente';

/**
 * Qué impide apagar una modalidad, o `null` si no impide nada.
 *
 * POR QUÉ EXISTE. Hasta hoy el casillero se apagaba sin mirar nada, y apagarlo no era un
 * ajuste de pantalla: la Prestadora quedaba con Asistentes trabajando en una forma que su
 * propia configuración ya no habilita —la base les frena la próxima asignación de guardia con
 * un error que nadie pidió— y, en el Marketplace, con Familias pagando un acceso cuya
 * pantalla de cobros acaba de desaparecer del Panel.
 *
 * Devuelve un **motivo**, que es un código: la frase que lee la persona vive en las
 * traducciones, en los tres idiomas, y nunca sale escrita desde acá (CLAUDE.md §8). Ninguno de
 * los tres códigos nombra una tabla ni una columna.
 *
 * Los dos vínculos que atan, y por qué son ésos:
 *   * **Asistentes** con vínculo vigente que trabajan en esa modalidad. Un Asistente cesado o
 *     dado de baja no ata nada.
 *   * **Accesos** del Marketplace todavía vigentes. Sólo existen en esa modalidad, así que en
 *     prestación directa no se pregunta.
 *
 * No devuelve cuántos son a propósito: quien apaga necesita saber qué revisar, y la lista de
 * Asistentes y la de accesos ya están, cada una en su pantalla.
 */
async function loQueImpideApagar(prestadoraId, modalidad) {
  const [asistentes, accesos] = await Promise.all([
    supabase
      .from('asistentes')
      .select('id')
      .eq('prestadora_id', prestadoraId)
      .eq('estado', 'activo')
      .is('deleted_at', null)
      .contains('canales', [modalidad])
      .limit(1),
    modalidad === MODALIDAD_MARKETPLACE
      ? supabase
          .from('accesos_marketplace')
          .select('id')
          .eq('prestadora_id', prestadoraId)
          .eq('estado', ACCESO_EN_CURSO)
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // Si no se pudo preguntar, no se contesta que no impide nada: se levanta el error y la ruta
  // deja la modalidad como está (CLAUDE.md §5, «todo control de acceso falla cerrado»).
  if (asistentes.error) throw asistentes.error;
  if (accesos.error) throw accesos.error;

  const hayAsistentes = Boolean(asistentes.data?.length);
  const hayAccesos = Boolean(accesos.data?.length);

  if (hayAsistentes && hayAccesos) return 'modalidad_con_asistentes_y_accesos';
  if (hayAccesos) return 'modalidad_con_accesos';
  if (hayAsistentes) return 'modalidad_con_asistentes';
  return null;
}

panelConfiguracionRouter.get('/modalidades', async (req, res) => {
  const { data, error } = await supabase
    .from('prestadora_modalidades')
    .select('modalidad, activa')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (error) return responderError(res, error);

  const porModalidad = Object.fromEntries((data || []).map((f) => [f.modalidad, f.activa]));
  const modalidades = MODALIDADES_DISPONIBLES.map((modalidad) => ({
    modalidad,
    activa: porModalidad[modalidad] ?? false,
  }));
  res.json({ modalidades });
});

panelConfiguracionRouter.patch('/modalidades/:modalidad', async (req, res) => {
  const { modalidad } = req.params;
  if (!MODALIDADES_DISPONIBLES.includes(modalidad)) {
    return res.status(400).json({ error: 'Modalidad desconocida' });
  }
  const { activa } = req.body;
  if (typeof activa !== 'boolean') {
    return res.status(400).json({ error: 'Falta indicar activa (boolean)' });
  }

  // Apagar sí se comprueba; encender no tiene nada que romper.
  if (!activa) {
    let motivo;
    try {
      motivo = await loQueImpideApagar(req.usuarioPanel.prestadoraId, modalidad);
    } catch (e) {
      // No se pudo comprobar qué depende de la modalidad. Se deja como está: apagarla sin
      // haber mirado es justamente lo que esta comprobación vino a impedir. El texto crudo de
      // la base queda en el registro del servidor y no sube a la pantalla (CLAUDE.md §6).
      console.error(`No se pudo comprobar qué depende de la modalidad ${modalidad}:`, e?.message ?? e);
      return responderError(res, e);
    }
    if (motivo) {
      return responderError(res, new ErrorConMotivo(motivo, `modalidad ${modalidad} todavía en uso`));
    }
  }

  const ahora = new Date().toISOString();
  const { error } = await supabase.from('prestadora_modalidades').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      modalidad,
      activa,
      ...(activa
        ? { activada_por: req.usuarioPanel.id, activada_en: ahora }
        : { desactivada_por: req.usuarioPanel.id, desactivada_en: ahora }),
    },
    { onConflict: 'prestadora_id,modalidad' }
  );
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// --- Escalada a Coordinador: respaldo + intervalos de insistencia según premura
//     (punto 5 de docs/PRD_06_WhatsApp_IA.md) ---

// Lo que vale mientras la Prestadora todavía no guardó su propia configuración. No es una
// decisión que se tome acá: es el mismo valor con el que la base crea la columna (migración
// 20260822200000). Si se cambia allá, se cambia acá — es el precio de que el formulario pueda
// mostrar algo antes de que exista la fila.
const MINUTOS_GRACIA_CIERRE_POR_DEFECTO = 15;
const MINUTOS_DE_UN_DIA = 24 * 60;
const HORAS_ANTES_DE_ESCALAR_POR_DEFECTO = 4;
const HORAS_DE_TRES_DIAS = 72;

panelConfiguracionRouter.get('/escalada-coordinador', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  // La lista de Coordinadores viaja con la configuración, y no la pide el navegador por su
  // cuenta: es el mismo reparto que ya usa `/permisos`, con la misma consulta escrita una sola
  // vez más arriba.
  const [{ data, error }, { data: coordinadores, error: errorCoordinadores }] = await Promise.all([
    supabase
      .from('configuracion_escalada_coordinador')
      .select('*')
      .eq('prestadora_id', prestadoraId)
      .maybeSingle(),
    coordinadoresDeLaPrestadora(prestadoraId),
  ]);
  if (error) return responderError(res, error);
  if (errorCoordinadores) return responderError(res, errorCoordinadores);
  res.json({
    coordinadores: coordinadores || [],
    escalada: data || {
      prestadora_id: prestadoraId,
      coordinador_backup_id: null,
      minutos_antes_backup: 15,
      umbrales_premura: [
        { maximo_minutos: 60, intervalo_minutos: 10 },
        { maximo_minutos: 240, intervalo_minutos: 30 },
        { maximo_minutos: null, intervalo_minutos: 60 },
      ],
      fase_automatica_activa: false,
      minutos_antes_fase_automatica: 120,
      minutos_gracia_cierre_guardia: MINUTOS_GRACIA_CIERRE_POR_DEFECTO,
      horas_antes_aviso_grave_sin_cerrar: HORAS_ANTES_DE_ESCALAR_POR_DEFECTO,
    },
  });
});

panelConfiguracionRouter.patch('/escalada-coordinador', async (req, res) => {
  const {
    coordinador_backup_id, minutos_antes_backup, umbrales_premura,
    fase_automatica_activa, minutos_antes_fase_automatica,
    minutos_gracia_cierre_guardia, horas_antes_aviso_grave_sin_cerrar,
  } = req.body;

  // Los tramos deciden cada cuánto se le vuelve a insistir al Coordinador. Antes se guardaban
  // sin mirarlos, y una lista mal armada no rompía nada acá: rompía después, callada, en
  // intervaloParaPremura() — que ante un tramo raro cae a su intervalo de respaldo y le
  // termina avisando cada una hora a alguien que había pedido que le avisen cada diez minutos.
  const problema = validarUmbralesPremura(umbrales_premura);
  if (problema) return res.status(400).json({ error: problema });

  // El Panel ya lo revisa antes de mandarlo, pero la revisión de allá es para que la
  // Coordinadora se entere sin esperar la respuesta del servidor — no es la que protege el
  // dato. Esta es la que protege: la base rechazaría un valor fuera de rango con un error
  // suyo, ilegible, y cualquiera puede llamar a esta dirección sin pasar por la pantalla.
  if (minutos_gracia_cierre_guardia !== undefined) {
    const minutos = Number(minutos_gracia_cierre_guardia);
    if (!Number.isInteger(minutos) || minutos <= 0 || minutos > MINUTOS_DE_UN_DIA) {
      return res.status(400).json({
        error: `Los minutos de espera para avisar que una guardia quedó sin cerrar tienen que ser un número entero entre 1 y ${MINUTOS_DE_UN_DIA}`,
      });
    }
  }

  if (horas_antes_aviso_grave_sin_cerrar !== undefined) {
    const horas = Number(horas_antes_aviso_grave_sin_cerrar);
    if (!Number.isInteger(horas) || horas <= 0 || horas > HORAS_DE_TRES_DIAS) {
      return res.status(400).json({
        error: `Las horas antes de escalar una guardia sin cerrar tienen que ser un número entero entre 1 y ${HORAS_DE_TRES_DIAS}`,
      });
    }
  }

  const { error } = await supabase
    .from('configuracion_escalada_coordinador')
    .upsert({
      prestadora_id: req.usuarioPanel.prestadoraId,
      coordinador_backup_id,
      minutos_antes_backup,
      umbrales_premura,
      fase_automatica_activa,
      minutos_antes_fase_automatica,
      minutos_gracia_cierre_guardia: minutos_gracia_cierre_guardia ?? MINUTOS_GRACIA_CIERRE_POR_DEFECTO,
      horas_antes_aviso_grave_sin_cerrar:
        horas_antes_aviso_grave_sin_cerrar ?? HORAS_ANTES_DE_ESCALAR_POR_DEFECTO,
      updated_at: new Date().toISOString(),
    });
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

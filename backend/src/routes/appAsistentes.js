import { Router } from 'express';
import multer from 'multer';
import { requiereRolAsistente } from '../middleware/requiereRolAsistente.js';
import { supabase } from '../db/connection.js';
import { estructurarReporteIA, distanciaMetros } from '../utils/reporteIA.js';
import { enviarPushFamilia } from '../utils/push.js';
import { analizarPaciente } from '../utils/revisarAlertasIA.js';
import { resolverVitalesHabilitados } from '../utils/vitalesReferencia.js';
import {
  conPacientes,
  pacientesDeGuardia,
  asistenteAtiendeAlPaciente,
} from '../utils/pacientesDeGuardia.js';
import { conDomicilioDelDia, pacientesConDomicilioDelDia } from '../utils/domicilioDelDia.js';
import { llegoAlDomicilio } from '../utils/toleranciaCheckin.js';
import { marcaDeLaPrestadora } from '../utils/marcaPrestadora.js';
import { visibilidadDelPedido, exigeVisible } from '../utils/visibilidadPrestadora.js';
import { columnasSegunVisibilidad } from '../utils/catalogoVisibilidad.js';
import { tipoConSusTareas } from '../utils/tareasDelTipo.js';
import { estadoDeLaExtension } from '../utils/estadoDeLaExtension.js';
import { carpetaDelAsistente, estadoDelCertificado } from '../utils/carpetaDelAsistente.js';
import { guardarSuscripcionPush } from '../utils/suscripcionesPush.js';
import {
  MOTIVOS_SIN_COMPROBAR,
  codigoParaMostrar,
  comprobacionDe,
  pedirCodigoALaPrestadora,
  registrarComprobacion,
} from '../utils/comprobacionDePresencia.js';
import { responderError, ErrorConMotivo } from '../utils/errorConMotivo.js';
import { lugaresDe } from '../utils/lugaresDeCadaPersona.js';
import { nombresDeLugares } from '../utils/catalogoDeLugares.js';
import { ofreceMarketplace } from '../utils/marketplaceDeLaPrestadora.js';
import { MODALIDAD } from '../utils/modalidades.js';
import {
  LADO,
  abrirVideollamada,
  contactoAbierto,
  escribirMensaje,
  marcarLeido,
  mensajesDeLaConversacion,
  videollamadaEnCurso,
} from '../utils/conversacionMarketplace.js';
import { direccionDeVideollamada } from '../utils/videollamada.js';
import { puedeRegistrarUbicacion } from '../utils/consentimientoUbicacion.js';
import { faltaElSustituto, MOTIVO_SIN_SUSTITUTO } from '../utils/guardiaSinSustituto.js';
import { topeDePedidos } from '../middleware/topeDePedidos.js';
import { MOTIVOS_DEMORA } from '../utils/motivosDemora.js';
import { FUENTE_AVISO_DEMORA_ASISTENTE } from '../utils/fuentesAlertaTemprana.js';
import { notificarCoordinador } from '../utils/whatsapp.js';
import { aviso } from '../i18n/avisos.js';
import { idiomaDeLaPrestadora } from '../i18n/idiomaDeLaPrestadora.js';

export const appAsistentesRouter = Router();

// Con qué datos del Paciente se dibuja la pantalla del Asistente en esta Prestadora. El
// domicilio exacto y las patologías tienen cada uno su interruptor: hay quien da la dirección
// recién al confirmar el turno, y hay quien no manda datos clínicos al teléfono de nadie.
// Lo que está apagado no se pide, así que tampoco viaja (tarea 65).
//
// Las patologías se piden solamente en la pantalla de una guardia, que es donde el Asistente
// las necesita para trabajar. En la lista de sus turnos no van ni aunque estén prendidas: ahí
// alcanza con saber a quién y a qué hora.
function camposDePacienteParaElAsistente(visibilidad, { conPatologias = false } = {}) {
  return columnasSegunVisibilidad([
    'id',
    'nombre',
    ['domicilio', 'asistente_domicilio_del_paciente'],
    ['lat', 'asistente_domicilio_del_paciente'],
    ['lng', 'asistente_domicilio_del_paciente'],
    ...(conPatologias ? [['patologias', 'asistente_patologias_del_paciente']] : []),
  ], visibilidad);
}

const TIPOS_FOTO_PERMITIDOS = ['image/jpeg', 'image/png'];
const TAMANO_MAXIMO_FOTO = 8 * 1024 * 1024; // 8 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO_FOTO },
  fileFilter(req, file, cb) {
    cb(null, TIPOS_FOTO_PERMITIDOS.includes(file.mimetype));
  },
});

function manejarErrorMulter(err, req, res, next) {
  if (err) {
    return res.status(400).json({ error: 'Foto no permitida (solo JPG o PNG, hasta 8 MB)' });
  }
  next();
}

async function guardiaDelAsistente(guardiaId, usuarioAsistente) {
  const { data } = await supabase
    .from('guardias')
    .select('id, prestadora_id, asistente_id, paciente_id, fecha, hora_inicio, hora_fin, dias_hasta_el_fin, modalidad, estado, salida_checkin_at, medio_transporte, checkin_at, checkout_at, checkout_bloqueado')
    .eq('id', guardiaId)
    .eq('asistente_id', usuarioAsistente.id)
    .eq('prestadora_id', usuarioAsistente.prestadoraId)
    .maybeSingle();
  return data;
}

// ============================================================================
// El pase de guardia (pendiente #113) — decisiones del Desarrollador que no se vuelven a
// discutir:
//   1. Nada de escanear carteles. Un cartel impreso pegado en la puerta es un secreto que no
//      cambia nunca y que se fotografía de paso: el código lo muestra una PERSONA en la pantalla
//      de su teléfono y se renueva solo cada pocos segundos, o lo suelta la Prestadora de un solo
//      uso y con vencimiento de minutos. Toda la mecánica está en `utils/comprobacionDePresencia.js`.
//   2. El código viaja siempre junto con el GPS, nunca en lugar de él: por eso esto se valida
//      además de lat/lng, no en cambio de lat/lng.
//   3. La guardia nunca se traba. Si nadie puede mostrar el código y en la Prestadora tampoco
//      atiende nadie, el Asistente elige un motivo de una lista corta, marca igual y esa llegada
//      queda como SIN COMPROBAR en la lista que ve el Coordinador. Lo único que sí se rechaza es
//      un código equivocado —ahí la pantalla ofrece reintentar, pedirle uno a la Prestadora, o
//      entrar con un motivo—, porque aceptar un código que no es sería no comprobar nada y decir
//      que sí.
//   4. Esto no decide si un relevo cierra una guardia y abre la siguiente en un solo acto (esa
//      pregunta sigue abierta). Cada guardia anota su propia comprobación por su cuenta: cuando
//      hay relevo real quedan dos filas, una contra la que termina y otra contra la que empieza.
// ============================================================================

// Ordena lo que mandó el teléfono sobre la comprobación. Se acepta el pedido viejo —sin nada—
// como «no se comprobó, motivo desconocido»: puede ser un teléfono con la versión anterior
// todavía cargada, o un check-in que quedó en la cola sin conexión y se está reintentando ahora.
// Ese Asistente está parado en la puerta y tiene que poder marcar.
//
// Un motivo que no está en la lista cae en «otro» en vez de rechazar el pedido, por lo mismo: la
// lista puede haber cambiado y el teléfono todavía tener la anterior, y eso es un desajuste de
// versiones, no una razón para trabar una guardia. Lo que mandó se guarda en el detalle, así el
// Coordinador ve qué quiso decir.
function datosDeComprobacion(body) {
  const { comprobacion } = body || {};
  if (comprobacion && typeof comprobacion === 'object') {
    if (typeof comprobacion.codigo === 'string' && comprobacion.codigo.trim()) {
      return { codigo: comprobacion.codigo.trim() };
    }
    if (typeof comprobacion.motivoSinComprobar === 'string') {
      const motivo = comprobacion.motivoSinComprobar.trim();
      if (MOTIVOS_SIN_COMPROBAR.includes(motivo)) {
        return { motivoSinComprobar: motivo, detalle: comprobacion.detalle };
      }
      return { motivoSinComprobar: 'otro', detalle: comprobacion.detalle ?? motivo };
    }
  }
  return { motivoSinComprobar: 'otro' };
}

// Le avisa a la Familia que la guardia quedó cubierta y por quién. Sale cuando la Familia NO
// participó de la comprobación: cuando el código lo mostró el Asistente que se iba, y cuando lo
// soltó la Prestadora. Si el código lo mostró la propia Familia, ya se enteró mostrándolo.
//
// El texto va en castellano y a mano, como los otros cuatro avisos al celular que ya existen: el
// motor todavía no tiene catálogo de traducciones (ver el informe de esta tarea).
async function avisarALaFamiliaDeLaCobertura({ guardia, medio }) {
  try {
    const pacientes = await pacientesDeGuardia(guardia, 'id, nombre, familia_id');
    const { data: asistente } = await supabase
      .from('asistentes')
      .select('nombre')
      .eq('id', guardia.asistente_id)
      .maybeSingle();
    const nombreDelAsistente = asistente?.nombre ?? 'el Asistente asignado';
    const comoSeComprobo = medio === 'codigo_prestadora'
      ? 'La comprobación la resolvió la Prestadora.'
      : 'La comprobación la hizo el Asistente que terminaba su guardia.';

    for (const paciente of pacientes.filter((p) => p.familia_id)) {
      enviarPushFamilia(paciente.familia_id, {
        titulo: 'La guardia quedó cubierta',
        cuerpo: `${nombreDelAsistente} está en el domicilio de ${paciente.nombre}. ${comoSeComprobo}`,
        url: `/pacientes/${paciente.id}`,
      }).catch((err) => console.error('Error avisando a la Familia de la cobertura:', err.message));
    }
  } catch (e) {
    console.error('Error armando el aviso de cobertura para la Familia:', e.message);
  }
}

// Punto único de verdad de "qué reportes tiene ya cargados esta guardia" (regla 12 de §7):
// lo consultan el guard de reporte repetido, el guard de cierre sin reporte y la pantalla de
// la guardia.
//
// Devuelve una lista y no uno solo porque un turno que cubre a varios Pacientes lleva un
// reporte por cada uno: el de la señora de la casa no es el del marido, y darlos por
// equivalentes era escribir la comida, la medicación y la presión de los dos en la misma hoja.
async function reportesDeLaGuardia(guardiaId) {
  const { data } = await supabase
    .from('reportes')
    .select('id, paciente_id')
    .eq('guardia_id', guardiaId);
  return data ?? [];
}

// A quiénes del turno todavía les falta el reporte. Es lo que decide si la guardia se puede
// cerrar, y lo que la pantalla del Asistente muestra como lo que le queda por hacer.
async function pacientesSinReporte(guardia) {
  const [pacientes, reportes] = await Promise.all([
    pacientesDeGuardia(guardia, 'id, nombre'),
    reportesDeLaGuardia(guardia.id),
  ]);
  const conReporte = new Set(reportes.map((r) => r.paciente_id));
  return pacientes.filter((p) => !conReporte.has(p.id));
}

// ============================================================================
// Mi Perfil
// ============================================================================

appAsistentesRouter.get('/perfil', requiereRolAsistente, async (req, res) => {
  const { data: perfil, error } = await supabase
    .from('asistentes')
    .select('id, nombre, telefono, email, foto_url, tipo_asistente_id, estado, tipo_vinculo, qr_token, canales, disponible_para_ofertas, disponibilidad_cambiada_en, tipos_asistente(id, clave, nombre, prestadora_id)')
    .eq('id', req.usuarioAsistente.id)
    .single();
  if (error || !perfil) {
    return res.status(404).json({ error: 'Perfil no encontrado' });
  }

  // El filtro por Prestadora va aunque el identificador del Asistente ya sea de una sola: una
  // misma persona tiene una ficha por cada Prestadora donde trabaja, y una consulta que no
  // nombra la Organización queda a merced de que ese identificador nunca se repita. Es la misma
  // consulta que hace `/perfil/papeles`, y se escribe igual.
  const { data: certificado } = await supabase
    .from('certificados')
    .select('activo, fecha_emision, fecha_vencimiento')
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .eq('asistente_id', req.usuarioAsistente.id)
    .order('fecha_emision', { ascending: false })
    .limit(1)
    .maybeSingle();

  // La marca de su Prestadora viaja con el perfil, no en una dirección aparte:
  // el encabezado la necesita ni bien la persona entra, que es cuando la
  // aplicación ya pide esto. Y para el Asistente de marketplace es lo que hace
  // que una sola aplicación sirva para varias Prestadoras: cambia la marca de
  // arriba según dónde esté parado.
  const marca = await marcaDeLaPrestadora(req.usuarioAsistente.prestadoraId);

  // Qué muestra esta Prestadora, por el mismo camino y por el mismo motivo que la marca: la
  // aplicación necesita saberlo antes de dibujar la primera pantalla, y pedirlo aparte sería
  // un viaje más para lo mismo. Acá viaja para que la aplicación no dibuje lo que está
  // apagado; que el dato apagado no salga de la base lo resuelve cada consulta por su cuenta.
  const visibilidad = await visibilidadDelPedido(req);

  // Si esta persona trabaja en marketplace, su aplicación tiene una pantalla más: los hilos con
  // las Familias que le escribieron. Son dos condiciones y las dos tienen que dar que sí —que la
  // Prestadora ofrezca esa modalidad, y que esta persona trabaje en ella—, porque un Asistente
  // de prestación directa adentro de una Prestadora que además hace marketplace no recibe
  // mensajes de nadie. Viaja con el perfil por el mismo motivo que la marca: la aplicación lo
  // necesita antes de dibujar el menú.
  const marketplace =
    (perfil.canales || []).includes(MODALIDAD.MARKETPLACE) &&
    (await ofreceMarketplace(req.usuarioAsistente.prestadoraId));

  // Dónde acepta trabajar, con los nombres puestos. Está guardado en la tabla que la cruza con cada
  // lugar, no en su ficha: una persona puede cubrir dos localidades de una zona y una de otra, y la
  // zona diría de más. La pantalla recibe una lista de nombres, igual que siempre.
  const lugares = await lugaresDe('asistente_lugares', 'asistente_id', perfil.id, req.usuarioAsistente.prestadoraId);
  const zonas = await nombresDeLugares(lugares, req.usuarioAsistente.prestadoraId);

  res.json({ perfil: { ...perfil, zonas }, certificado: certificado || null, marca, visibilidad, marketplace });
});

// Su carpeta de papeles, y su Certificado de Aptitud.
//
// VA APARTE DE `/perfil` A PROPÓSITO. `/perfil` lo pide la aplicación entera al arrancar, para
// saber de qué Prestadora es la marca del encabezado: todo lo que se le cuelgue ahí lo paga cada
// arranque, y esto lo mira quien entró a Mi Perfil.
//
// Y ACÁ SÍ VAN LOS NOMBRES DE LOS PAPELES. A la Familia se le dan cuentas y nunca cuál papel es
// cuál (`celtatech/CLAUDE.md` §6); el dueño de la carpeta necesita saber qué le falta para ir a
// buscarlo. La sesión decide de quién es la carpeta: el identificador no viaja en el pedido.
appAsistentesRouter.get('/perfil/papeles', requiereRolAsistente, async (req, res) => {
  const asistenteId = req.usuarioAsistente.id;
  const prestadoraId = req.usuarioAsistente.prestadoraId;

  const [{ data: tiposExigidos }, { data: documentos }, { data: certificado }, { data: prestadora }] =
    await Promise.all([
      supabase
        .from('tipos_documento_asistente')
        .select('id, nombre, requiere_vencimiento')
        .eq('prestadora_id', prestadoraId)
        .eq('activo', true)
        .order('nombre'),
      supabase
        .from('documentos_asistente')
        .select('tipo_documento_id, fecha_vencimiento')
        .eq('prestadora_id', prestadoraId)
        .eq('asistente_id', asistenteId),
      supabase
        .from('certificados')
        .select('activo, fecha_emision, fecha_vencimiento')
        .eq('prestadora_id', prestadoraId)
        .eq('asistente_id', asistenteId)
        .order('fecha_emision', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('prestadoras')
        .select('dias_aviso_vencimiento_documentos')
        .eq('id', prestadoraId)
        .maybeSingle(),
    ]);

  const diasAviso = prestadora?.dias_aviso_vencimiento_documentos ?? undefined;

  res.json({
    carpeta: carpetaDelAsistente({
      tiposExigidos: tiposExigidos || [],
      documentos: documentos || [],
      diasAviso,
    }),
    certificado: estadoDelCertificado(certificado || null, { diasAviso }),
  });
});

// El interruptor de disponibilidad, y lo mueve el Asistente.
//
// `asistentes.estado` lo decide la Prestadora; esto lo decide él, y son dos cosas distintas a
// propósito (ver la migración `20260915120000_el_asistente_dice_cuando_no_esta_disponible.sql`).
// Apagarlo lo saca de lo que sale a buscarlo solo —la fase automática de la escalada de relevo—
// y no toca ninguna guardia ya asignada: lo que ya se comprometió sigue siendo suyo.
//
// La sesión decide sobre qué fila se escribe. El identificador no viaja en el pedido, así que no
// hay forma de pedir que se apague a otra persona.
appAsistentesRouter.patch('/perfil/disponibilidad', requiereRolAsistente, async (req, res) => {
  const { disponible } = req.body || {};
  if (typeof disponible !== 'boolean') {
    return res.status(400).json({ error: 'Falta decir si queda disponible o no', motivo: 'disponibilidad_invalida' });
  }

  // Se pide de vuelta la fila que se tocó: la base contesta que salió bien aunque no haya
  // encontrado ninguna, y acá lo que se muestra después es justamente el estado del interruptor.
  const { data: guardada, error } = await supabase
    .from('asistentes')
    .update({ disponible_para_ofertas: disponible, disponibilidad_cambiada_en: new Date().toISOString() })
    .eq('id', req.usuarioAsistente.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .select('disponible_para_ofertas, disponibilidad_cambiada_en');
  if (error) return responderError(res, error);
  if (!guardada?.length) {
    return res.status(404).json({ error: 'Perfil no encontrado', motivo: 'perfil_no_encontrado' });
  }

  res.json({
    disponible_para_ofertas: guardada[0].disponible_para_ofertas,
    disponibilidad_cambiada_en: guardada[0].disponibilidad_cambiada_en,
  });
});

// ============================================================================
// Mis Guardias
// ============================================================================

// `guardia.pacientes` es una LISTA, no una persona: un mismo turno puede cubrir a más de un
// Paciente (ver `utils/pacientesDeGuardia.js`). La lista ya no la engancha PostgREST por la
// columna vieja `guardias.paciente_id` — sale de la tabla `guardia_pacientes`.
//
// Y la dirección de cada Paciente es la que rige **el día de esa guardia**, no la de la ficha:
// un turno de enero puede caer en la temporada en que el Paciente está en la casa de un hijo
// (`utils/domicilioDelDia.js`).
appAsistentesRouter.get('/guardias', requiereRolAsistente, async (req, res) => {
  const { data, error } = await supabase
    .from('guardias')
    .select('id, paciente_id, fecha, hora_inicio, hora_fin, dias_hasta_el_fin, modalidad, estado, salida_checkin_at, medio_transporte, checkin_at, checkout_at, checkout_bloqueado')
    .eq('asistente_id', req.usuarioAsistente.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .order('fecha', { ascending: false })
    .order('hora_inicio', { ascending: false })
    .limit(100);

  if (error) {
    return responderError(res, error);
  }

  try {
    const visibilidad = await visibilidadDelPedido(req);
    const guardias = await conPacientes(data ?? [], camposDePacienteParaElAsistente(visibilidad));
    res.json({ guardias: await conDomicilioDelDia(guardias) });
  } catch (e) {
    responderError(res, e);
  }
});

appAsistentesRouter.get('/guardias/:id', requiereRolAsistente, async (req, res) => {
  const { data, error } = await supabase
    .from('guardias')
    .select('id, paciente_id, fecha, hora_inicio, hora_fin, dias_hasta_el_fin, modalidad, estado, salida_checkin_at, medio_transporte, checkin_at, checkout_at, checkout_bloqueado')
    .eq('id', req.params.id)
    .eq('asistente_id', req.usuarioAsistente.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .maybeSingle();

  if (error || !data) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }

  const visibilidad = await visibilidadDelPedido(req);

  let guardia;
  try {
    const [conSuGente] = await conPacientes([data], camposDePacienteParaElAsistente(visibilidad, { conPatologias: true }));
    // La dirección que se muestra es la del día de la guardia. Si es una temporal, cada
    // Paciente viaja además con `domicilio_es_temporal` y `domicilio_motivo`, que es lo que le
    // permite a la pantalla avisar que hoy no se lo atiende en su casa.
    [guardia] = await conDomicilioDelDia([conSuGente]);
  } catch (e) {
    return responderError(res, e);
  }

  // Los signos vitales son de una persona, no de un turno: la presión normal de la señora de
  // la casa no es la del marido. Por eso van por Paciente, y la autorización de monitoreo
  // también —puede estar firmada para uno y no para el otro.
  //
  // Si la Prestadora no toma signos vitales, ni siquiera se pregunta cuáles corresponden: la
  // pantalla no va a mostrar el bloque, y los valores de referencia de una persona son un dato
  // de salud que no tiene por qué llegar al teléfono.
  const vitalesPorPaciente = {};
  if (visibilidad.asistente_signos_vitales) {
    for (const p of guardia.pacientes ?? []) {
      const vitales = await resolverVitalesHabilitados(p.id, req.usuarioAsistente.prestadoraId);
      vitalesPorPaciente[p.id] = vitales;
    }
  }

  // Qué le corresponde hacer en este turno, y qué no. Las dos listas salen del mismo
  // catálogo que ve la Familia, así que las dos partes leen lo mismo y nadie discute en la
  // puerta con una lista distinta en la mano.
  //
  // El tipo se pide acá y no se guarda con la guardia: si la Prestadora corrige el catálogo,
  // el cambio tiene que llegar al próximo turno sin arrastrar la copia vieja.
  const { data: quienEs } = await supabase
    .from('asistentes')
    .select('tipo_asistente_id')
    .eq('id', req.usuarioAsistente.id)
    .maybeSingle();

  const { tipo, tareas } = await tipoConSusTareas(
    quienEs?.tipo_asistente_id,
    req.usuarioAsistente.prestadoraId
  );

  // La pantalla necesita saber a quiénes les falta el reporte: ofrece el cierre recién cuando
  // no queda ninguno, en vez de dejar apretar un botón que el backend va a rechazar.
  const reportes = await reportesDeLaGuardia(data.id);
  const conReporte = reportes.map((r) => r.paciente_id);

  // Si quedó un descanso abierto, la pantalla tiene que ofrecer terminarlo y no empezar otro. Es
  // una sola fila como máximo: la base no admite dos abiertos en la misma guardia.
  const { data: descansoAbierto } = await supabase
    .from('descansos_guardia')
    .select('id, inicio_at')
    .eq('guardia_id', data.id)
    .is('fin_at', null)
    .maybeSingle();

  // Si su turno ya terminó y el relevo no llegó, ella sigue adentro. La pantalla tiene que
  // decírselo, mostrarle cómo va la búsqueda y darle por dónde avisar que no puede continuar.
  // Viene en blanco en la enorme mayoría de los turnos, que es lo normal.
  const extension = await estadoDeLaExtension({
    guardiaId: data.id,
    prestadoraId: req.usuarioAsistente.prestadoraId,
  });

  res.json({
    guardia,
    tipo,
    tareas,
    extension,
    descansoAbierto: descansoAbierto ?? null,
    pacientesConReporte: conReporte,
    // Se sigue mandando para las versiones de la aplicación que todavía no saben de la lista:
    // significa "ya está todo el trabajo del turno", que es lo que preguntaban.
    reporteCargado: (guardia.pacientes ?? []).every((p) => conReporte.includes(p.id)),
    vitalesPorPaciente,
  });
});

// ============================================================================
// Check-in — nunca bloquea por distancia (PRD_04_05_App_Servicio.md, flujo de Check-in
// punto 4): fuera de rango se avisa y se deja confirmar igual, con nota al coordinador.
// ============================================================================

// El tope de pedidos por minuto (pendiente #177) cuenta SÓLO los pedidos que traen un código: el
// piso queda intacto, así que entrar o salir eligiendo un motivo nunca se frena y la guardia
// nunca se traba. Sin esto, el código que alguien muestra en su pantalla —que no lleva cuenta de
// intentos, sólo se renueva cada pocos segundos— se podía probar sin freno.
const trajoUnCodigo = (req) => Boolean(req.body?.comprobacion?.codigo);

appAsistentesRouter.post('/guardias/:id/checkin', requiereRolAsistente, topeDePedidos({ nombre: 'comprobacion_probar_codigo', soloSi: trajoUnCodigo }), async (req, res) => {
  const { lat, lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Faltan coordenadas GPS' });
  }
  // El código va junto con el GPS, nunca en lugar de él (decisión del Desarrollador, pendiente
  // #113): se junta además de lat/lng de arriba, no en cambio de ellas.
  const comprobacionPedida = datosDeComprobacion(req.body);

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }
  if (guardia.checkin_at) {
    // yaRegistrado: true — permite que el cliente offline (Fase 9) distinga "ya se había
    // sincronizado antes" de un error real, y dé la acción encolada por sincronizada.
    return res.status(400).json({ error: 'Esta guardia ya tiene check-in registrado', yaRegistrado: true });
  }

  // Una guardia tapada por una licencia registrada no arranca hasta que tenga sustituto asignado
  // (docs/PRD_02B_Gestion_Personal.md:187). Es el único lugar de todo el producto que pasa una
  // guardia a `activa`, así que la guarda va acá. El motivo viaja como código y la frase la arma
  // la pantalla en su idioma; el texto de acá es para el registro, no para nadie.
  if (await faltaElSustituto(guardia)) {
    return res.status(400).json({
      error: 'Esta guardia todavía no tiene Asistente sustituto asignado',
      motivo: MOTIVO_SIN_SUSTITUTO,
    });
  }

  // Un solo check-in para todo el turno, aunque el turno cubra a varias personas: el Asistente
  // llega una vez a la casa y marca una vez.
  //
  // Las coordenadas contra las que se mide son las del DÍA DE ESTA GUARDIA, no las de la ficha:
  // si el Paciente está pasando una temporada en otro lado, el Asistente fue a donde le
  // dijeron, y medir contra la casa de siempre lo daba fuera de rango y le mandaba al
  // Coordinador un aviso que era un falso positivo (pendiente #153).
  //
  // Acá no se pide `domicilio` a propósito: esto mide una distancia, no muestra una dirección.
  // Y no se pasa por el interruptor `asistente_domicilio_del_paciente` tampoco: ese decide qué
  // ve el Asistente en el teléfono, no contra qué mide el motor de este lado.
  let pacientes;
  try {
    pacientes = await pacientesDeGuardia(guardia, 'id, nombre, lat, lng, familia_id');
    pacientes = await pacientesConDomicilioDelDia(guardia, pacientes);
  } catch (e) {
    return responderError(res, e);
  }

  const { data: config } = await supabase
    .from('configuracion_ausencia_automatica')
    .select('metros_tolerancia_checkin')
    .eq('prestadora_id', guardia.prestadora_id)
    .maybeSingle();

  // Con varios Pacientes se mide contra el domicilio MÁS CERCANO. Casi siempre viven todos en
  // la misma casa y da lo mismo; cuando no, estar en la puerta de uno de ellos no es llegar
  // tarde ni al lugar equivocado, y el aviso al Coordinador sería un falso positivo.
  //
  // Se guarda cuál fue el más cercano, no solamente cuántos metros: si la medición terminó
  // siendo contra una dirección temporal, el aviso al Coordinador tiene que decirlo.
  const medidos = pacientes
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({ paciente: p, metros: Math.round(distanciaMetros(lat, lng, p.lat, p.lng)) }));
  const masCerca = medidos.reduce((mejor, actual) => (mejor && mejor.metros <= actual.metros ? mejor : actual), null);
  const distancia = masCerca ? masCerca.metros : null;
  // `llegoAlDomicilio` contesta `null` cuando no hay con qué medir, y eso no es llegar lejos:
  // es no saber. Sin coordenadas no se le manda un aviso al Coordinador.
  const dentroDeRango = llegoAlDomicilio(distancia, config) !== false;

  // La comprobación se resuelve ANTES de marcar el check-in, y es lo único que puede rechazar el
  // pedido: un código equivocado no marca la llegada, porque darlo por bueno sería no comprobar
  // nada y decir que sí. No traba la guardia igual — la pantalla ofrece reintentar, pedirle un
  // código a la Prestadora, o entrar con un motivo, y ese último camino nunca falla.
  let comprobacion;
  try {
    comprobacion = await registrarComprobacion({
      guardia, momento: 'checkin', lat, lng, comprobacion: comprobacionPedida,
    });
  } catch (e) {
    return responderError(res, e);
  }

  // La llegada se marca siempre; la coordenada, sólo si el consentimiento de seguimiento está
  // vigente. Quien lo retiró sigue pudiendo trabajar con normalidad — lo único que no queda
  // guardado es dónde estaba.
  const registraUbicacion = await puedeRegistrarUbicacion(guardia.asistente_id);

  const { error } = await supabase
    .from('guardias')
    .update({
      checkin_at: new Date().toISOString(),
      checkin_lat: registraUbicacion ? lat : null,
      checkin_lng: registraUbicacion ? lng : null,
      estado: 'activa',
    })
    .eq('id', guardia.id);
  if (error) {
    return responderError(res, error);
  }

  // A la Familia se le avisa que la guardia quedó cubierta y por quién cuando ella no participó
  // de la comprobación: cuando el código lo mostró el Asistente que se iba, y cuando lo soltó la
  // Prestadora.
  if (comprobacion.avisarFamilia) {
    await avisarALaFamiliaDeLaCobertura({ guardia, medio: comprobacion.medio });
  }

  // Push inmediato a la Familia — docs/PRD_04_05_App_Servicio.md:58 ("el Asistente llegó al
  // domicilio"). Se envía una sola vez porque checkin_at ya se validó arriba como no seteado
  // antes de este UPDATE.
  //
  // Un aviso por Paciente, no uno por turno: la Familia de cada uno tiene que enterarse de que
  // llegaron a atender al suyo, y con el nombre del suyo. Dos hermanos que viven juntos pero
  // avisan a familias distintas reciben cada uno el suyo. Si las dos personas son de la misma
  // Familia, esa Familia recibe los dos avisos, uno por nombre — es lo correcto: son dos
  // Pacientes distintos, y un aviso solo obligaría a adivinar a cuál se refiere.
  const conFamilia = pacientes.filter((p) => p.familia_id);
  for (const p of conFamilia) {
    enviarPushFamilia(p.familia_id, {
      titulo: 'Llegó el Asistente',
      cuerpo: `El Asistente llegó al domicilio de ${p.nombre}.`,
      url: `/pacientes/${p.id}`,
    }).catch((err) => console.error('Error enviando push de llegada a Familia:', err.message));
  }
  if (conFamilia.length > 0) {
    await supabase.from('guardias').update({ push_llegada_enviado_at: new Date().toISOString() }).eq('id', guardia.id);
  }

  if (!dentroDeRango && req.usuarioAsistente.prestadoraId) {
    // Nota automática al coordinador (PRD_04_05_App_Servicio.md) — se registra en
    // mensajes_asistente, el mismo canal que ya usa el Panel para comunicación con Asistentes,
    // en vez de crear una tabla nueva de notas para un solo caso.
    //
    // Contra qué se midió, dicho en el aviso: si ese día regía una dirección temporal, el
    // Coordinador tiene que saberlo, porque "fuera de rango" sin esa aclaración lo manda a
    // buscar un problema donde no lo hay.
    //
    // Lo que NO va: ni la dirección, ni el motivo de la temporal —que lo escribe el Panel a
    // mano y puede decir "internación"—, ni el nombre del Paciente. Es un mensaje que queda
    // guardado en un hilo de conversación, y ahí no se meten datos sensibles (CLAUDE.md §6).
    const contraQueSeMidio = masCerca?.paciente?.domicilio_es_temporal
      ? 'del domicilio temporal del Paciente, el que regía ese día'
      : 'del domicilio del Paciente';

    await supabase.from('mensajes_asistente').insert({
      asistente_id: guardia.asistente_id,
      prestadora_id: guardia.prestadora_id,
      usuario_id: guardia.asistente_id,
      mensaje: `Aviso automático del sistema: check-in fuera de rango (${distancia} m ${contraQueSeMidio}) en la guardia del ${guardia.fecha}.`,
    }).then(({ error: errorNota }) => {
      if (errorNota) console.error('Error registrando nota de check-in fuera de rango:', errorNota.message);
    });
  }

  res.json({ ok: true, dentroDeRango, distanciaMetros: distancia, comprobacion: comprobacion.estado });
});

// ============================================================================
// Los dos actos deliberados de antes de llegar (pendiente #101): «salgo ahora» y «voy
// demorado».
//
// POR QUÉ SON DOS BOTONES Y NO UN SEGUIMIENTO. El sistema se apoya en el acto de la persona.
// Quien avisa que sale, y quien avisa que va demorado y por qué, hizo algo, y eso lo protege.
// Lo que el sistema calcula solo es un hecho, no un mérito de nadie, y por eso se guarda con
// otro código de origen y no se mezcla nunca con el aviso que dio la persona.
//
// LA MEDIDA DE ESTO SON LOS MINUTOS DE AVISO que le da a la Prestadora para cubrir la guardia.
// De ahí salen dos decisiones: ninguno de los dos botones se traba —ni por GPS, ni por hora, ni
// por conexión: van a la cola de la aplicación como el check-in—, y el aviso de demora sale
// hacia el Coordinador en el momento, sin esperar la vuelta del proceso de fondo.
// ============================================================================

// Cuánto se guarda del medio de transporte. Es texto libre, igual que en el Panel: quien lo
// escribe describe su viaje, no elige de una lista que alguien tuvo que adivinar antes.
const LARGO_MAXIMO_MEDIO_TRANSPORTE = 60;

function medioDeTransporteDelPedido(body) {
  const medio = body?.medioTransporte;
  if (typeof medio !== 'string') return null;
  const limpio = medio.trim().slice(0, LARGO_MAXIMO_MEDIO_TRANSPORTE);
  return limpio || null;
}

appAsistentesRouter.post('/guardias/:id/salida', requiereRolAsistente, async (req, res) => {
  const { lat, lng } = req.body || {};

  // El punto de salida es opcional a propósito. Sin él la hora de salida se guarda igual y lo
  // único que se pierde es la estimación de llegada, que pasa a ser "no se sabe". Trabar el
  // botón porque el GPS no contestó adentro de un edificio sería perder justamente los minutos
  // de aviso que este botón existe para ganar.
  const hayPunto = typeof lat === 'number' && typeof lng === 'number';
  if ((lat !== undefined && lat !== null && typeof lat !== 'number')
    || (lng !== undefined && lng !== null && typeof lng !== 'number')) {
    return res.status(400).json({ error: 'Ubicación inválida' });
  }

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }

  // NINGUNO DE ESTOS DOS CASOS CONTESTA UN ERROR, y no es una comodidad: un pedido de la cola
  // sin conexión que falla queda marcado con error y **corta la cola entera**
  // (`pwa-asistentes/src/lib/sincronizarCola.js`), así que un rechazo acá dejaría trabado el
  // check-in que viene atrás. Los dos son situaciones normales, no pedidos mal armados.
  //
  // Ya registrada: el mismo pedido llegó dos veces. Se contesta con la hora que ya estaba.
  if (guardia.salida_checkin_at) {
    return res.json({ ok: true, yaRegistrado: true, salidaAt: guardia.salida_checkin_at });
  }
  // Ya llegó: la salida quedó en la cola y se sincroniza recién ahora, con la persona adentro
  // de la casa. Guardarla con la hora de este momento sería escribir que salió después de
  // llegar. No se guarda nada y se dice por qué.
  if (guardia.checkin_at) {
    return res.json({ ok: true, yaLlego: true });
  }

  const salidaAt = new Date().toISOString();
  const { error } = await supabase
    .from('guardias')
    .update({
      salida_checkin_at: salidaAt,
      salida_lat: hayPunto ? lat : null,
      salida_lng: hayPunto ? lng : null,
      medio_transporte: medioDeTransporteDelPedido(req.body),
    })
    .eq('id', guardia.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId);

  if (error) {
    return responderError(res, error);
  }

  res.json({ ok: true, salidaAt });
});

appAsistentesRouter.post('/guardias/:id/aviso-demora', requiereRolAsistente, async (req, res) => {
  // Un motivo que no está en la lista se guarda como `otro` en vez de rechazar el aviso, por lo
  // mismo que ya hace `datosDeComprobacion` unos renglones más arriba: la lista puede haber
  // cambiado y el teléfono tener todavía la anterior, y eso es un desajuste de versiones, no una
  // razón para perder un aviso de demora. Lo que importa es que la Prestadora se entere.
  const pedido = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
  const motivo = MOTIVOS_DEMORA.includes(pedido) ? pedido : 'otro';

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }
  // Igual que en la salida: no es un error, es un aviso que llegó tarde desde la cola sin
  // conexión y ya no describe nada. Contestar con error trabaría el resto de la cola.
  if (guardia.checkin_at) {
    return res.json({ ok: true, yaLlego: true });
  }

  // Un aviso por guardia mientras el anterior siga abierto. Sin esto, la cola sin conexión
  // podría dejar tres filas iguales y el Coordinador vería tres alertas de la misma persona por
  // el mismo viaje.
  const { data: yaAbierta } = await supabase
    .from('alertas_tempranas_guardia')
    .select('id, motivo, detectado_at')
    .eq('guardia_id', guardia.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .eq('fuente', FUENTE_AVISO_DEMORA_ASISTENTE)
    .is('resuelto_at', null)
    .maybeSingle();

  if (yaAbierta) {
    return res.json({ ok: true, yaRegistrado: true, avisoAt: yaAbierta.detectado_at, motivo: yaAbierta.motivo });
  }

  const detectadoAt = new Date().toISOString();
  const { data: alerta, error } = await supabase
    .from('alertas_tempranas_guardia')
    .insert({
      prestadora_id: guardia.prestadora_id,
      guardia_id: guardia.id,
      fuente: FUENTE_AVISO_DEMORA_ASISTENTE,
      motivo,
      reportado_por: req.usuarioAsistente.id,
      detectado_at: detectadoAt,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    return responderError(res, error);
  }

  // El aviso sale ahora, no en la próxima vuelta del proceso de fondo: entre una cosa y la otra
  // hay hasta cinco minutos, y cinco minutos son la mitad del margen con el que se consigue un
  // reemplazo. Se usa el mismo evento configurable que ya emite la insistencia, así que la
  // Prestadora que lo apagó no recibe nada por esta puerta tampoco.
  //
  // Si el envío falla, la fila queda con `ultima_notificacion_at` en blanco y el proceso de
  // fondo lo reintenta solo. Nunca se le devuelve un error a quien avisó: su acto ya está
  // guardado, que es lo que lo protege.
  try {
    // Lo lee el Coordinador, así que sale en el idioma de la Prestadora y no en el del teléfono
    // del Asistente que dio el aviso.
    const idioma = await idiomaDeLaPrestadora(guardia.prestadora_id);
    await notificarCoordinador({
      evento: 'alerta_temprana_guardia',
      prestadoraId: guardia.prestadora_id,
      ...aviso('aviso_demora_asistente', idioma, {
        fecha: guardia.fecha,
        horaInicio: guardia.hora_inicio,
        origen: aviso('origen_de_alerta', idioma, { fuente: FUENTE_AVISO_DEMORA_ASISTENTE }).texto,
        motivo,
      }),
    });
    if (alerta?.id) {
      await supabase
        .from('alertas_tempranas_guardia')
        .update({ ultima_notificacion_at: detectadoAt, veces_notificado: 1 })
        .eq('id', alerta.id);
    }
  } catch (e) {
    console.error('Error avisando al Coordinador del aviso de demora:', e.message);
  }

  res.json({ ok: true, avisoAt: detectadoAt, motivo });
});

/* El botón de emergencia de la Guardia Activa.
   --------------------------------------------------------------------------
   Es lo que se aprieta cuando pasa algo que no admite esperar al cierre de la guardia. No tiene
   lista de tipos para elegir: se escribe qué está pasando y se manda. Quien está en el medio de
   una emergencia no tiene que buscar su caso en un desplegable, y clasificarlas es una decisión
   de negocio de la Prestadora que no se inventa acá.

   LO QUE ESCRIBIÓ NO SALE HACIA AFUERA. El aviso inmediato dice que hay una emergencia, de qué
   guardia y de cuándo; el texto se lee entrando al Panel (`celtatech/CLAUDE.md` §6).

   Y NO SE PUEDE APAGAR. El evento está en el catálogo con `se_puede_apagar: false`: la Prestadora
   elige por qué canal sale y a qué dirección, nunca si sale. */
appAsistentesRouter.post('/guardias/:id/emergencia', requiereRolAsistente, async (req, res) => {
  const detalle = typeof req.body?.detalle === 'string' ? req.body.detalle.trim() : '';
  if (!detalle) {
    return responderError(res, new ErrorConMotivo('faltan_datos', 'emergencia sin detalle'));
  }

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }

  /* Cuándo pasó, no cuándo se pudo enviar. Es la única ruta de la aplicación que acepta el momento
     del teléfono, y tiene motivo: un aviso que estuvo media hora en la cola sin conexión guardado
     con la hora de la sincronización contaría mal lo que pasó, y acá esa media hora es el dato.
     Se acepta sólo hacia atrás: una hora futura sería un reloj mal puesto, y con eso no se escribe
     nada. */
  const delTelefono = Date.parse(req.body?.ocurrido_at ?? '');
  const ahora = Date.now();
  const reportadoAt = new Date(Number.isNaN(delTelefono) || delTelefono > ahora ? ahora : delTelefono).toISOString();

  const { data: emergencia, error } = await supabase
    .from('emergencias_guardia')
    .insert({
      prestadora_id: guardia.prestadora_id,
      guardia_id: guardia.id,
      reportado_por: req.usuarioAsistente.id,
      reportado_at: reportadoAt,
      // Un tope, para que un teléfono con un problema no escriba un texto sin fin. Se recorta y se
      // guarda igual: un aviso de emergencia no se pierde porque alguien escribió de más.
      detalle: detalle.slice(0, 2000),
    })
    .select('id')
    .maybeSingle();

  if (error) {
    return responderError(res, error);
  }

  // Igual que el aviso de demora: se guarda primero y se avisa después, adentro de un `try`. Si el
  // envío falla, la fila queda con `ultima_notificacion_at` en blanco y nunca se le devuelve un
  // error a quien avisó — su acto ya está guardado, que es lo que lo protege.
  try {
    const idioma = await idiomaDeLaPrestadora(guardia.prestadora_id);
    await notificarCoordinador({
      evento: 'emergencia_en_guardia',
      prestadoraId: guardia.prestadora_id,
      ...aviso('emergencia_en_guardia', idioma, {
        fecha: guardia.fecha,
        horaInicio: guardia.hora_inicio,
      }),
    });
    if (emergencia?.id) {
      await supabase
        .from('emergencias_guardia')
        .update({ ultima_notificacion_at: new Date().toISOString(), veces_notificado: 1 })
        .eq('id', emergencia.id);
    }
  } catch (e) {
    console.error('Error avisando al Coordinador de una emergencia en guardia:', e.message);
  }

  res.json({ ok: true, reportadoAt });
});

/* «No puedo continuar»: el botón de la que se quedó de más.
   --------------------------------------------------------------------------
   Aparece solamente cuando su turno ya terminó y ella sigue adentro porque el relevo no llegó.

   NO LA LIBERA, Y ESO NO ES UN DESCUIDO. Irse deja al Paciente solo, y eso la expone a ella: el
   producto no puede ofrecerle un botón que la meta en un problema. Lo que hace este botón es
   decirle a quien coordina, con la máxima urgencia, que la persona que está tapando el agujero ya
   no da más. De ahí en adelante decide quien coordina, que es quien puede ir, mandar a alguien o
   hablar con la familia.

   SIN ESTE BOTÓN, UNA EMERGENCIA PROPIA DE ELLA LA DEJA SIN NADA QUE APRETAR. El botón de
   emergencia de la guardia deja de estar cuando la guardia terminó, y justo en el rato de más es
   cuando más falta hace.

   SE PUEDE APRETAR UNA SOLA VEZ POR EXTENSIÓN. Repetirlo no agrega ninguna información —quien
   coordina ya está enterado— y multiplicaría avisos iguales, que terminan en un filtro del correo.

   LO QUE ESCRIBIÓ NO SALE HACIA AFUERA. El aviso dice que pasó y de qué turno; el texto se lee
   entrando al Panel (`celtatech/CLAUDE.md` §6). Y el detalle es opcional: quien está en el medio
   de algo puede no estar en condiciones de escribir nada. */
appAsistentesRouter.post('/guardias/:id/no-puedo-continuar', requiereRolAsistente, async (req, res) => {
  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }

  const { data: extension, error: errorExtension } = await supabase
    .from('extensiones_de_turno')
    .select('id, no_puede_continuar_at')
    .eq('guardia_id', guardia.id)
    .eq('prestadora_id', guardia.prestadora_id)
    .is('hasta_at', null)
    .maybeSingle();

  if (errorExtension) {
    return responderError(res, errorExtension);
  }
  // Sin extensión abierta no hay nada que avisar: su turno está corriendo y para eso está el botón
  // de emergencia, que sí está a mano en esa pantalla.
  if (!extension) {
    return responderError(res, new ErrorConMotivo('no_encontrado', 'no hay extension abierta'));
  }
  if (extension.no_puede_continuar_at) {
    return res.json({ ok: true, avisadoAt: extension.no_puede_continuar_at });
  }

  const detalle = typeof req.body?.detalle === 'string' ? req.body.detalle.trim() : '';

  // Cuándo pasó, no cuándo se pudo enviar, con el mismo criterio que el aviso de emergencia: un
  // aviso que estuvo media hora en la cola sin conexión guardado con la hora de la sincronización
  // contaría mal lo que pasó. Se acepta sólo hacia atrás: una hora futura es un reloj mal puesto.
  const delTelefono = Date.parse(req.body?.ocurrido_at ?? '');
  const ahora = Date.now();
  const avisadoAt = new Date(Number.isNaN(delTelefono) || delTelefono > ahora ? ahora : delTelefono).toISOString();

  const { error } = await supabase
    .from('extensiones_de_turno')
    .update({
      no_puede_continuar_at: avisadoAt,
      // Un tope, para que un teléfono con un problema no escriba un texto sin fin. Se recorta y se
      // guarda igual: un aviso así no se pierde porque alguien escribió de más.
      no_puede_continuar_detalle: detalle ? detalle.slice(0, 2000) : null,
    })
    .eq('id', extension.id)
    .eq('prestadora_id', guardia.prestadora_id);

  if (error) {
    return responderError(res, error);
  }

  // Se guarda primero y se avisa después, adentro de un `try`. Si el envío falla, la fila queda con
  // `ultima_notificacion_at` en blanco y nunca se le devuelve un error a quien avisó: su acto ya
  // está guardado, que es lo que la protege.
  try {
    const idioma = await idiomaDeLaPrestadora(guardia.prestadora_id);
    await notificarCoordinador({
      evento: 'no_puede_continuar_la_extension',
      prestadoraId: guardia.prestadora_id,
      ...aviso('no_puede_continuar_la_extension', idioma, {
        fecha: guardia.fecha,
        horaInicio: guardia.hora_inicio,
        horaFin: guardia.hora_fin,
      }),
    });
    await supabase
      .from('extensiones_de_turno')
      .update({ ultima_notificacion_at: new Date().toISOString(), veces_notificado: 1 })
      .eq('id', extension.id)
      .eq('prestadora_id', guardia.prestadora_id);
  } catch (e) {
    console.error('Error avisando al Coordinador de que no puede continuar la extension:', e.message);
  }

  res.json({ ok: true, avisadoAt });
});

/* El descanso adentro de la guardia.
   --------------------------------------------------------------------------
   En una guardia de 24, 48 o 72 horas la Asistente descansa en el domicilio, generalmente de
   noche, cuando el Paciente duerme, SIN DEJAR DE ESTAR DISPONIBLE. Estas dos rutas son las que
   dejan constancia de ese rato.

   LO QUE ESTO NO HACE, Y NO ES UN OLVIDO. No descuenta horas —la guardia se paga por lo que dura
   y ninguna cuenta mira esta tabla—, no cierra ni interrumpe la guardia, y no marca ninguna
   ausencia. Quien está disponible está trabajando.

   NO SE LE AVISA A NADIE. Descansar de noche en un turno largo es lo normal, no un incidente. Un
   aviso al Coordinador por cada descanso convertiría lo corriente en algo que hay que justificar.

   NO HAY TOPE NI HORARIO PERMITIDO. Cuánto y cuándo sale de cómo viene el servicio ese día, no de
   un número fijado de antemano (decisión del Desarrollador). */
appAsistentesRouter.post('/guardias/:id/descanso/empezar', requiereRolAsistente, async (req, res) => {
  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }

  // Mismo criterio que el aviso de emergencia: se acepta el momento del teléfono, sólo hacia
  // atrás. Una hora futura es un reloj mal puesto.
  const delTelefono = Date.parse(req.body?.ocurrido_at ?? '');
  const ahora = Date.now();
  const inicioAt = new Date(Number.isNaN(delTelefono) || delTelefono > ahora ? ahora : delTelefono).toISOString();

  const { data: descanso, error } = await supabase
    .from('descansos_guardia')
    .insert({
      prestadora_id: guardia.prestadora_id,
      guardia_id: guardia.id,
      registrado_por: req.usuarioAsistente.id,
      inicio_at: inicioAt,
      nota: typeof req.body?.nota === 'string' ? req.body.nota.trim().slice(0, 2000) || null : null,
    })
    .select('id, inicio_at')
    .maybeSingle();

  if (error) {
    return responderError(res, error);
  }

  res.json({ ok: true, descanso });
});

appAsistentesRouter.post('/guardias/:id/descanso/terminar', requiereRolAsistente, async (req, res) => {
  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }

  const delTelefono = Date.parse(req.body?.ocurrido_at ?? '');
  const ahora = Date.now();
  const finAt = new Date(Number.isNaN(delTelefono) || delTelefono > ahora ? ahora : delTelefono).toISOString();

  const { data: abierto } = await supabase
    .from('descansos_guardia')
    .select('id, inicio_at')
    .eq('guardia_id', guardia.id)
    .is('fin_at', null)
    .maybeSingle();

  if (!abierto) {
    return res.status(404).json({ error: 'No hay un descanso abierto' });
  }

  // Un momento del teléfono anterior al inicio dejaría la fila fuera de la restricción de la base
  // y el error saldría como falla del sistema. Ante un reloj que no cierra, vale el de acá.
  const fin = finAt > abierto.inicio_at ? finAt : new Date(ahora).toISOString();

  const { error } = await supabase
    .from('descansos_guardia')
    .update({ fin_at: fin })
    .eq('id', abierto.id);

  if (error) {
    return responderError(res, error);
  }

  res.json({ ok: true, finAt: fin });
});

// ============================================================================
// Reporte Diario — estructurar (IA Nivel 1, no persiste todavía)
// ============================================================================

appAsistentesRouter.post('/guardias/:id/reporte/estructurar', requiereRolAsistente, exigeVisible('asistente_relato_con_ia'), async (req, res) => {
  const { textoLibre } = req.body;
  if (!textoLibre || typeof textoLibre !== 'string') {
    return res.status(400).json({ error: 'Falta el texto del reporte' });
  }

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }

  try {
    const estructurado = await estructurarReporteIA(textoLibre, req.usuarioAsistente.prestadoraId);
    res.json({ estructurado });
  } catch (error) {
    // El detalle queda en el registro del servidor y no sale hacia afuera: de acá puede venir
    // el mensaje crudo del proveedor de IA. Lo que ve el teléfono es qué hacer ahora.
    console.error('Error estructurando el reporte con IA:', error.message);
    res.status(500).json({ error: 'No se pudo estructurar el reporte con IA — hace falta completar los campos a mano' });
  }
});

// Foto opcional del reporte, subida antes de confirmar.
appAsistentesRouter.post(
  '/guardias/:id/reporte/foto',
  requiereRolAsistente,
  exigeVisible('asistente_foto_en_el_reporte'),
  upload.single('foto'),
  manejarErrorMulter,
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Falta la foto' });
    }
    const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
    if (!guardia) {
      return res.status(404).json({ error: 'Guardia no encontrada' });
    }

    const extension = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
    const ruta = `${guardia.prestadora_id}/${guardia.id}/${Date.now()}.${extension}`;

    const { error } = await supabase.storage
      .from('reportes-fotos')
      .upload(ruta, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (error) {
      return responderError(res, error);
    }

    res.json({ fotoUrl: ruta });
  }
);

// Confirmar y enviar: persiste el reporte (ya revisado por el Asistente) y avisa a la Familia.
//
// Hasta el 2026-08-06 este mismo endpoint hacía además el check-out y pasaba la guardia a
// 'completada'. Se separó (tarea 66a, pendiente #113) porque el cierre de guardia no tenía
// botón propio en ningún lado: terminaba siendo un efecto secundario invisible de mandar el
// reporte, y el pase de guardia por QR necesita que cerrar sea un acto con entidad propia.
// El orden de negocio no cambió: sigue sin poder cerrarse una guardia sin reporte — eso ahora
// lo valida POST /guardias/:id/checkout.
appAsistentesRouter.post('/guardias/:id/reporte/confirmar', requiereRolAsistente, async (req, res) => {
  const { pacienteId, textoLibre, alimentacion, medicacion, signosVitales, estadoAnimo, incidentes, observaciones, fotoUrl } = req.body;

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }
  if (!guardia.checkin_at) {
    return res.status(400).json({ error: 'No se puede cargar el reporte sin check-in previo' });
  }

  // De quién habla este reporte. Cuando el turno cubre a una sola persona no hace falta
  // decirlo —es esa— y así las versiones de la aplicación que todavía no lo mandan siguen
  // funcionando. Cuando cubre a varias, no se adivina: escribir la comida y la medicación en
  // la hoja de la persona equivocada es un daño que después nadie encuentra.
  let pacientes;
  try {
    pacientes = await pacientesDeGuardia(guardia, 'id, nombre');
  } catch (e) {
    return responderError(res, e);
  }
  const paciente = pacienteId ? pacientes.find((p) => p.id === pacienteId) : pacientes.length === 1 ? pacientes[0] : null;
  if (!paciente) {
    return res.status(400).json({
      error: pacienteId
        ? 'Ese Paciente no está en este turno'
        : 'Falta decir de qué Paciente habla el reporte',
      motivo: 'falta_paciente',
    });
  }

  const reportes = await reportesDeLaGuardia(guardia.id);
  if (reportes.some((r) => r.paciente_id === paciente.id)) {
    // yaRegistrado: true — mismo criterio que en /checkin (Fase 9, cliente offline). Antes
    // esta protección contra el envío duplicado la daba el guard de checkout_at; al separar
    // el cierre del reporte, la da la existencia del reporte mismo.
    return res.status(400).json({ error: `${paciente.nombre} ya tiene su Reporte Diario cargado en este turno`, yaRegistrado: true });
  }

  // Lo que la Prestadora apagó tampoco se guarda, aunque venga en el pedido: la pantalla no lo
  // pidió, así que si llega es porque alguien lo mandó a mano. Guardarlo sería meter en la
  // historia clínica de un Paciente un dato que esa Prestadora decidió no tomar.
  const visibilidad = await visibilidadDelPedido(req);

  const { data: reporte, error: errorReporte } = await supabase
    .from('reportes')
    .insert({
      prestadora_id: guardia.prestadora_id,
      guardia_id: guardia.id,
      paciente_id: paciente.id,
      texto_libre: textoLibre || null,
      alimentacion: alimentacion || null,
      medicacion: medicacion || [],
      signos_vitales: visibilidad.asistente_signos_vitales ? signosVitales || null : null,
      estado_animo: estadoAnimo || null,
      incidentes: incidentes || null,
      observaciones: observaciones || null,
      foto_url: visibilidad.asistente_foto_en_el_reporte ? fotoUrl || null : null,
      ia_procesado: true,
      confirmado_asistente: true,
    })
    .select('id')
    .single();
  if (errorReporte) {
    return responderError(res, errorReporte);
  }

  const { error: errorGuardia } = await supabase
    .from('guardias')
    .update({ push_reporte_enviado_at: new Date().toISOString() })
    .eq('id', guardia.id);
  if (errorGuardia) {
    return responderError(res, errorGuardia);
  }

  // El aviso va a la Familia de este Paciente y a ninguna otra: el reporte habla de él. Si el
  // turno cubre a dos hermanos, cada Familia recibe su aviso cuando le toca, no el del otro.
  const { data: datosPaciente } = await supabase
    .from('pacientes')
    .select('familia_id')
    .eq('id', paciente.id)
    .maybeSingle();
  if (datosPaciente?.familia_id) {
    enviarPushFamilia(datosPaciente.familia_id, {
      titulo: 'Reporte diario disponible',
      cuerpo: `Ya está listo el reporte de la guardia de ${paciente.nombre}.`,
      url: `/pacientes/${paciente.id}/reportes/${reporte.id}`,
    }).catch((err) => console.error('Error enviando push de reporte a Familia:', err.message));
  }

  // IA Nivel 2 — análisis inmediato si el texto libre contiene una palabra clave crítica
  // configurada por la Prestadora (docs/AI_PROMPTS.md:43-45 — nunca hardcodeada). Sin fila
  // configurada, no se dispara nada acá; el análisis nocturno sigue corriendo igual.
  if (textoLibre) {
    supabase
      .from('configuracion_alertas_ia')
      .select('palabras_clave')
      .eq('prestadora_id', guardia.prestadora_id)
      .maybeSingle()
      .then(({ data: config }) => {
        const palabrasClave = config?.palabras_clave || [];
        const textoNormalizado = textoLibre.toLowerCase();
        const contieneCritica = palabrasClave.some((palabra) => textoNormalizado.includes(String(palabra).toLowerCase()));
        if (contieneCritica) {
          // Se revisa a la persona de la que habla el reporte, y a nadie más. Antes había que
          // revisar a todos los del turno porque el texto no decía de quién hablaba; ahora lo
          // dice, y levantar una alerta sobre alguien que no era es ruido que le hace perder
          // confianza a la Familia en las alertas que sí importan.
          analizarPaciente(paciente.id, guardia.prestadora_id).catch((err) =>
            console.error('Error en análisis inmediato de IA Nivel 2:', err.message)
          );
        }
      });
  }

  res.json({ ok: true, reporteId: reporte.id });
});

// ============================================================================
// Check-out — cerrar la guardia. Acto con entidad propia desde el 2026-08-06 (tarea 66a):
// antes ocurría solo como efecto secundario de confirmar el Reporte Diario.
//
// Tres condiciones, en este orden, porque cada una dice algo distinto al Asistente:
//   1. sin check-in previo no hay nada que cerrar;
//   2. no se cierra hasta que cada Paciente del turno tenga su Reporte Diario — la regla de
//      negocio que antes garantizaba el endpoint del reporte, ahora explícita en vez de
//      implícita. Se le dice al Asistente de quiénes falta, porque "falta un reporte" en un
//      turno que cubre a tres personas no le dice cuál le quedó pendiente;
//   3. si checkout_bloqueado está puesto, rige el protocolo de continuidad de guardia (no
//      retirarse sin relevo) y el cierre solo lo libera el Panel con excepción documentada.
//      Sin este guard la base rechazaría el UPDATE por el CHECK
//      guardias_checkout_bloqueado_requiere_excepcion (schema_modulo6_guardias_02.sql) y el
//      Asistente vería un error genérico sin saber por qué no puede irse.
// ============================================================================

appAsistentesRouter.post('/guardias/:id/checkout', requiereRolAsistente, topeDePedidos({ nombre: 'comprobacion_probar_codigo', soloSi: trajoUnCodigo }), async (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Faltan coordenadas GPS' });
  }
  // El código va junto con el GPS, nunca en lugar de él (decisión del Desarrollador, pendiente
  // #113): se junta además de lat/lng de arriba, no en cambio de ellas.
  const comprobacionPedida = datosDeComprobacion(req.body);

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }
  if (!guardia.checkin_at) {
    return res.status(400).json({ error: 'No se puede cerrar una guardia sin check-in previo', motivo: 'falta_checkin' });
  }
  if (guardia.checkout_at) {
    // yaRegistrado: true — mismo criterio que en /checkin (Fase 9, cliente offline).
    return res.status(400).json({ error: 'Esta guardia ya tiene check-out registrado', yaRegistrado: true });
  }
  let faltan;
  try {
    faltan = await pacientesSinReporte(guardia);
  } catch (e) {
    return responderError(res, e);
  }
  if (faltan.length > 0) {
    return res.status(400).json({
      error: `Falta cargar el Reporte Diario de ${faltan.map((p) => p.nombre).join(' y ')} antes de cerrar la guardia`,
      motivo: 'falta_reporte',
      pacientesSinReporte: faltan.map((p) => ({ id: p.id, nombre: p.nombre })),
    });
  }
  if (guardia.checkout_bloqueado) {
    return res.status(409).json({ error: 'Check-out bloqueado por el protocolo de continuidad de guardia', motivo: 'continuidad' });
  }

  // La comprobación de la salida se resuelve antes de cerrar, por el mismo motivo que en el
  // check-in: un código equivocado no cierra la guardia, y el camino de «entro/salgo igual con
  // un motivo» está siempre disponible.
  let comprobacion;
  try {
    comprobacion = await registrarComprobacion({
      guardia, momento: 'checkout', lat, lng, comprobacion: comprobacionPedida,
    });
  } catch (e) {
    return responderError(res, e);
  }

  // Se cierra solamente si sigue activa, y se comprueba que se haya cerrado de verdad. Los
  // controles de arriba se hicieron sobre una lectura anterior: si en el medio entró otro
  // check-out —dos toques seguidos al botón, la aplicación reintentando— acá no queda nada por
  // cambiar, y contestar que sí sin haber cambiado nada es lo que hace que dos guardias
  // superpuestas parezcan cerradas cuando solo se cerró una.
  // Misma regla que en el check-in: la salida se marca siempre, la coordenada solamente con el
  // consentimiento de seguimiento vigente.
  const registraUbicacion = await puedeRegistrarUbicacion(guardia.asistente_id);

  const { data: cerrada, error } = await supabase
    .from('guardias')
    .update({
      checkout_at: new Date().toISOString(),
      checkout_lat: registraUbicacion ? lat : null,
      checkout_lng: registraUbicacion ? lng : null,
      estado: 'completada',
    })
    .eq('id', guardia.id)
    .eq('estado', 'activa')
    .select('id');
  if (error) {
    return responderError(res, error);
  }
  if (!cerrada?.length) {
    // Misma respuesta que el control de arriba: para quien está del otro lado es el mismo caso,
    // y el cliente sin conexión ya sabe qué hacer con `yaRegistrado`.
    return res.status(400).json({ error: 'Esta guardia ya tiene check-out registrado', yaRegistrado: true });
  }

  res.json({ ok: true, comprobacion: comprobacion.estado });
});

// ============================================================================
// El pase de guardia (pendiente #113) — las tres rutas que lo sostienen
// ============================================================================

// El código que este Asistente muestra en su pantalla cuando es él el que se va y llega el
// relevo. Se pide de nuevo cada `segundos`, y cada pedido anula el anterior: eso es lo que hace
// que una foto de la pantalla no sirva un minuto después.
appAsistentesRouter.get('/codigo-de-presencia', requiereRolAsistente, async (req, res) => {
  try {
    const { codigo, segundos, expiraEn } = await codigoParaMostrar({
      prestadoraId: req.usuarioAsistente.prestadoraId,
      sujetoTipo: 'asistente',
      sujetoId: req.usuarioAsistente.id,
    });
    res.json({ codigo, segundos, expiraEn });
  } catch (e) {
    responderError(res, e);
  }
});

// «No hay nadie que me pueda mostrar el código.» Lo escribe el Asistente con sus palabras y
// aparece en la pantalla de la Prestadora. No marca nada: sólo abre el pedido y queda esperando.
appAsistentesRouter.post('/guardias/:id/comprobacion/pedido', requiereRolAsistente, topeDePedidos({ nombre: 'comprobacion_pedir_codigo' }), async (req, res) => {
  const { momento, texto } = req.body || {};
  if (momento !== 'checkin' && momento !== 'checkout') {
    return res.status(400).json({ error: 'Momento inválido', motivo: 'faltan_datos' });
  }

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) return res.status(404).json({ error: 'Guardia no encontrada' });

  try {
    const pedido = await pedirCodigoALaPrestadora({ guardia, momento, texto });
    res.json(pedido);
  } catch (e) {
    responderError(res, e);
  }
});

// En qué quedó ese pedido. La pantalla lo consulta mientras espera, para saber si ya hay un
// código soltado y puede pedirle al Asistente que lo tipee.
appAsistentesRouter.get('/guardias/:id/comprobacion/:momento', requiereRolAsistente, async (req, res) => {
  const { momento } = req.params;
  if (momento !== 'checkin' && momento !== 'checkout') {
    return res.status(400).json({ error: 'Momento inválido', motivo: 'faltan_datos' });
  }

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) return res.status(404).json({ error: 'Guardia no encontrada' });

  const fila = await comprobacionDe(guardia.id, momento);
  if (!fila) return res.json({ estado: null, codigoDisponible: false });

  // Nunca se devuelve la huella ni el código: sólo si ya hay uno esperando que lo tipeen.
  res.json({
    estado: fila.estado,
    codigoDisponible: Boolean(fila.codigo_huella) && new Date(fila.codigo_expira_en) > new Date(),
    codigoExpiraEn: fila.codigo_huella ? fila.codigo_expira_en : null,
  });
});

// Ping de ubicación en vivo durante una guardia activa — la Familia lo lee vía Supabase
// Realtime, nunca por HTTP (PRD_04_05_App_Servicio.md, mapa en tiempo real de la Pantalla
// del Paciente).
appAsistentesRouter.patch('/guardias/:id/ubicacion', requiereRolAsistente, exigeVisible('asistente_ubicacion_en_vivo'), async (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Faltan coordenadas GPS' });
  }

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia || guardia.estado !== 'activa') {
    return res.status(404).json({ error: 'Guardia activa no encontrada' });
  }

  // El mapa en vivo es, literalmente, la ubicación de una persona: sin consentimiento vigente no
  // se guarda nada. No es un error —la guardia sigue su curso y la aplicación no se traba—, así
  // que se contesta que sí y se avisa que la posición no quedó registrada.
  if (!(await puedeRegistrarUbicacion(guardia.asistente_id))) {
    return res.json({ ok: true, ubicacion_registrada: false });
  }

  // Solo mientras la guardia siga activa: si se cerró entre la lectura de arriba y esta línea,
  // el mapa de la Familia no tiene que seguir moviéndose. Y si no se escribió nada, se dice.
  const { data: marcada, error } = await supabase
    .from('guardias')
    .update({ ubicacion_actual_lat: lat, ubicacion_actual_lng: lng, ubicacion_actual_at: new Date().toISOString() })
    .eq('id', guardia.id)
    .eq('estado', 'activa')
    .select('id');
  if (error) {
    return responderError(res, error);
  }
  if (!marcada?.length) {
    return res.status(404).json({ error: 'Guardia activa no encontrada' });
  }

  res.json({ ok: true, ubicacion_registrada: true });
});

// Reportes anteriores del mismo Paciente (botón "Ver reportes anteriores" en Guardia Activa).
appAsistentesRouter.get('/pacientes/:id/reportes', requiereRolAsistente, exigeVisible('asistente_reportes_anteriores'), async (req, res) => {
  if (!(await asistenteAtiendeAlPaciente(req.params.id, req.usuarioAsistente))) {
    return res.status(403).json({ error: 'No tiene guardias asignadas a este Paciente' });
  }

  // El reporte dice de quién habla, así que se piden directo. Antes había que buscar primero
  // todos los turnos que cubrieron a esta persona y después los reportes de esos turnos —una
  // vuelta que además traía los reportes de los otros Pacientes del mismo turno.
  //
  // Se piden la fecha y las observaciones, que es lo único que esta pantalla muestra. Hasta
  // hoy viajaban además el relato entero, la comida, la medicación, los signos vitales, el
  // ánimo, los incidentes y la foto: ocho datos de salud que llegaban al teléfono y que
  // ninguna pantalla dibujaba. Si alguna vez hace falta mostrar alguno, se agrega acá con su
  // interruptor, no se deja "por las dudas" (tarea 65).
  const { data, error } = await supabase
    .from('reportes')
    .select('id, observaciones, created_at, guardias!inner(fecha)')
    .eq('paciente_id', req.params.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) {
    return responderError(res, error);
  }
  res.json({ reportes: data });
});

// ============================================================================
// Notificaciones push (Web Push API + VAPID)
// ============================================================================

appAsistentesRouter.post('/push/suscribir', requiereRolAsistente, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Suscripción push incompleta' });
  }

  const { error } = await guardarSuscripcionPush({
    prestadoraId: req.usuarioAsistente.prestadoraId,
    rol: 'asistente',
    usuarioId: req.usuarioAsistente.id,
    endpoint,
    keys,
    userAgent: req.headers['user-agent'],
  });
  if (error) {
    return responderError(res, error);
  }

  res.json({ ok: true });
});

appAsistentesRouter.delete('/push/suscribir', requiereRolAsistente, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) {
    return res.status(400).json({ error: 'Falta el endpoint de la suscripción' });
  }

  // El filtro por Prestadora va aunque el identificador del Asistente ya sea de una sola: el motor
  // entra con la llave de servicio y se saltea la protección por fila, así que lo único que separa
  // una Prestadora de otra son estos filtros. Y esto borra.
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .eq('endpoint', endpoint)
    .eq('asistente_id', req.usuarioAsistente.id);
  if (error) {
    return responderError(res, error);
  }

  res.json({ ok: true });
});

// ============================================================================
// Descargo del Asistente ante una calificación (pendiente #85, mitigante de diseño no
// opcional del riesgo legal invertido en marketplace — docs/PRD_07_Modalidad_Marketplace.md
// §5). Se carga una sola vez, nunca editable después (misma inmutabilidad que la propia
// calificación) — la policy `asistente_carga_su_descargo` ya bloquea un segundo intento por
// RLS, acá se valida antes también para devolver un mensaje legible.
// ============================================================================

appAsistentesRouter.get('/calificaciones', requiereRolAsistente, async (req, res) => {
  // Mismo motivo que en la baja del aviso al celular: una misma persona tiene una ficha por cada
  // Prestadora donde trabaja, y sin este filtro vería las calificaciones de la otra.
  const { data, error } = await supabase
    .from('calificaciones_asistente')
    .select('id, estrellas, comentario, visible_publica, descargo_asistente, descargo_en, created_at')
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .eq('asistente_id', req.usuarioAsistente.id)
    .order('created_at', { ascending: false });
  if (error) return responderError(res, error);
  res.json({ calificaciones: data });
});

appAsistentesRouter.patch('/calificaciones/:id/descargo', requiereRolAsistente, async (req, res) => {
  const { descargo } = req.body || {};
  // El `motivo` es lo que después le permite a la pantalla decir qué pasó en el idioma de quien
  // mira. Sin él, un 409 se lee como "ya existe un registro igual", que acá no significa nada.
  if (!descargo || !descargo.trim()) {
    return res.status(400).json({ error: 'Falta el texto del descargo', motivo: 'descargo_vacio' });
  }

  const { data: calificacion } = await supabase
    .from('calificaciones_asistente')
    .select('id, descargo_asistente')
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .eq('id', req.params.id)
    .eq('asistente_id', req.usuarioAsistente.id)
    .maybeSingle();

  if (!calificacion) {
    return res.status(404).json({ error: 'Calificación no encontrada', motivo: 'calificacion_no_encontrada' });
  }
  if (calificacion.descargo_asistente) {
    return res.status(409).json({
      error: 'Ya hay un descargo cargado para esta calificación, no puede editarse',
      motivo: 'descargo_ya_cargado',
    });
  }

  // Acá se está guardando un texto que escribió una persona sobre una calificación que la
  // afecta, y que no puede volver a cargar. La base contesta que salió bien aunque no haya
  // encontrado la fila, así que se pide que devuelva la que tocó: si no volvió ninguna, el
  // descargo no quedó guardado y hay que decirlo, nunca contestar que sí.
  const { data: guardada, error } = await supabase
    .from('calificaciones_asistente')
    .update({ descargo_asistente: descargo.trim(), descargo_en: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('asistente_id', req.usuarioAsistente.id)
    .select('id');
  if (error) return responderError(res, error);
  if (!guardada?.length) {
    return res.status(404).json({
      error: 'No se encontró esa calificación, el descargo no quedó guardado',
      motivo: 'calificacion_no_encontrada',
    });
  }

  res.json({ ok: true });
});

// ============================================================================
// EL CHAT CON UNA FAMILIA DE LA VIDRIERA
//
// LA OTRA PUNTA DEL MISMO HILO. Lo que la Familia ve en su aplicación y lo que el Asistente ve
// en la suya es la misma conversación, y las dos entran por `utils/conversacionMarketplace.js`.
// Ahí vive el tapado del dato de contacto, una vez y para los dos lados: tapando nada más lo que
// escribe el Asistente, la Familia pondría su propio número y la llamada saldría igual.
//
// EL HILO LO ABRE LA FAMILIA. Acá no hay ninguna ruta que cree una conversación: el Asistente
// contesta las que le llegaron. Es la vidriera la que va en un solo sentido —la Familia elige—,
// y una ruta para escribirle primero sería una puerta para escribirle a cualquiera.
// ============================================================================

/** El hilo que se pide, comprobando que sea suyo y de esta Prestadora. El que no existe y el
 *  ajeno contestan lo mismo. */
async function conversacionDelAsistente(req) {
  const { data } = await supabase
    .from('conversaciones_marketplace')
    .select('id, prestadora_id, familia_id, asistente_id, ultimo_mensaje_at, sala_videollamada, sala_abierta_at')
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .eq('asistente_id', req.usuarioAsistente.id)
    .maybeSingle();

  if (!data) throw new ErrorConMotivo('no_encontrado');
  return data;
}

/** Corta el paso donde la Prestadora no ofrece la modalidad. */
async function exigeMarketplace(req) {
  if (!(await ofreceMarketplace(req.usuarioAsistente.prestadoraId))) {
    throw new ErrorConMotivo('marketplace_no_habilitado');
  }
}

/** Cómo se llama la Familia del otro lado. El nombre vive en `usuarios`, porque `familias`
 *  guarda la cuenta y no la persona. */
async function nombreDeLaFamilia(familiaId) {
  const { data } = await supabase.from('usuarios').select('nombre').eq('id', familiaId).maybeSingle();
  return data?.nombre || '';
}

appAsistentesRouter.get('/marketplace/conversaciones', requiereRolAsistente, async (req, res) => {
  try {
    await exigeMarketplace(req);
    const { data, error } = await supabase
      .from('conversaciones_marketplace')
      .select('id, familia_id, ultimo_mensaje_at')
      .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
      .eq('asistente_id', req.usuarioAsistente.id)
      .order('ultimo_mensaje_at', { ascending: false, nullsFirst: false });
    if (error) return responderError(res, error);

    const hilos = data || [];
    // Los nombres y los mensajes sin leer, en una consulta cada cosa para toda la lista.
    const [{ data: personas }, { data: sinLeer }] = await Promise.all([
      hilos.length
        ? supabase.from('usuarios').select('id, nombre').in('id', hilos.map((c) => c.familia_id))
        : Promise.resolve({ data: [] }),
      hilos.length
        ? supabase
            .from('mensajes_marketplace')
            .select('conversacion_id')
            .in('conversacion_id', hilos.map((c) => c.id))
            .eq('lado', 'familia')
            .is('leido_at', null)
        : Promise.resolve({ data: [] }),
    ]);

    const nombres = new Map((personas || []).map((p) => [p.id, p.nombre || '']));
    const cuenta = new Map();
    for (const m of sinLeer || []) cuenta.set(m.conversacion_id, (cuenta.get(m.conversacion_id) || 0) + 1);

    res.json({
      conversaciones: hilos.map((c) => ({
        id: c.id,
        familia: { nombre: nombres.get(c.familia_id) || '' },
        ultimo_mensaje_at: c.ultimo_mensaje_at,
        sin_leer: cuenta.get(c.id) || 0,
      })),
    });
  } catch (e) {
    responderError(res, e);
  }
});

appAsistentesRouter.get('/marketplace/conversaciones/:id', requiereRolAsistente, async (req, res) => {
  try {
    await exigeMarketplace(req);
    const conversacion = await conversacionDelAsistente(req);

    const abierto = await contactoAbierto({
      familiaId: conversacion.familia_id,
      asistenteId: conversacion.asistente_id,
    });

    const [mensajes, nombre, enCurso, base] = await Promise.all([
      mensajesDeLaConversacion({ conversacion, abierto }),
      nombreDeLaFamilia(conversacion.familia_id),
      videollamadaEnCurso(conversacion),
      direccionDeVideollamada(conversacion.prestadora_id),
    ]);

    await marcarLeido({ conversacion, lado: LADO.ASISTENTE });

    res.json({
      conversacion: { id: conversacion.id, familia: { nombre } },
      mensajes,
      contacto_abierto: abierto,
      videollamada_disponible: Boolean(base),
      videollamada: enCurso,
    });
  } catch (e) {
    responderError(res, e);
  }
});

appAsistentesRouter.post('/marketplace/conversaciones/:id/mensajes', requiereRolAsistente, async (req, res) => {
  try {
    await exigeMarketplace(req);
    const conversacion = await conversacionDelAsistente(req);

    const cuerpo = String(req.body?.cuerpo ?? '').trim();
    if (!cuerpo) throw new ErrorConMotivo('faltan_datos');

    await escribirMensaje({
      conversacion,
      lado: LADO.ASISTENTE,
      autorUsuarioId: req.usuarioAsistente.id,
      cuerpo,
    });

    const abierto = await contactoAbierto({
      familiaId: conversacion.familia_id,
      asistenteId: conversacion.asistente_id,
    });
    res.json({ mensajes: await mensajesDeLaConversacion({ conversacion, abierto }) });
  } catch (e) {
    responderError(res, e);
  }
});

appAsistentesRouter.post('/marketplace/conversaciones/:id/videollamada', requiereRolAsistente, async (req, res) => {
  try {
    await exigeMarketplace(req);
    const conversacion = await conversacionDelAsistente(req);
    const sala = await abrirVideollamada({
      conversacion,
      lado: LADO.ASISTENTE,
      autorUsuarioId: req.usuarioAsistente.id,
    });
    if (!sala) throw new ErrorConMotivo('videollamada_no_configurada');
    res.json(sala);
  } catch (e) {
    responderError(res, e);
  }
});

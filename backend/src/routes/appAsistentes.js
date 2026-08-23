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
import { guardarSuscripcionPush } from '../utils/suscripcionesPush.js';

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
    .select('id, prestadora_id, asistente_id, paciente_id, fecha, hora_inicio, hora_fin, modalidad, estado, checkin_at, checkout_at, checkout_bloqueado')
    .eq('id', guardiaId)
    .eq('asistente_id', usuarioAsistente.id)
    .eq('prestadora_id', usuarioAsistente.prestadoraId)
    .maybeSingle();
  return data;
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
    .select('id, nombre, telefono, email, foto_url, tipo_asistente_id, zonas, estado, tipo_vinculo, qr_token, tipos_asistente(id, clave, nombre, prestadora_id)')
    .eq('id', req.usuarioAsistente.id)
    .single();
  if (error || !perfil) {
    return res.status(404).json({ error: 'Perfil no encontrado' });
  }

  const { data: certificado } = await supabase
    .from('certificados')
    .select('activo, fecha_emision, fecha_vencimiento')
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

  res.json({ perfil, certificado: certificado || null, marca, visibilidad });
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
    .select('id, paciente_id, fecha, hora_inicio, hora_fin, modalidad, estado, checkin_at, checkout_at, checkout_bloqueado')
    .eq('asistente_id', req.usuarioAsistente.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .order('fecha', { ascending: false })
    .order('hora_inicio', { ascending: false })
    .limit(100);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  try {
    const visibilidad = await visibilidadDelPedido(req);
    const guardias = await conPacientes(data ?? [], camposDePacienteParaElAsistente(visibilidad));
    res.json({ guardias: await conDomicilioDelDia(guardias) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

appAsistentesRouter.get('/guardias/:id', requiereRolAsistente, async (req, res) => {
  const { data, error } = await supabase
    .from('guardias')
    .select('id, paciente_id, fecha, hora_inicio, hora_fin, modalidad, estado, checkin_at, checkout_at, checkout_bloqueado')
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
    return res.status(500).json({ error: e.message });
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

  res.json({
    guardia,
    tipo,
    tareas,
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

appAsistentesRouter.post('/guardias/:id/checkin', requiereRolAsistente, async (req, res) => {
  const { lat, lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Faltan coordenadas GPS' });
  }

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }
  if (guardia.checkin_at) {
    // yaRegistrado: true — permite que el cliente offline (Fase 9) distinga "ya se había
    // sincronizado antes" de un error real, y dé la acción encolada por sincronizada.
    return res.status(400).json({ error: 'Esta guardia ya tiene check-in registrado', yaRegistrado: true });
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
    return res.status(500).json({ error: e.message });
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

  const { error } = await supabase
    .from('guardias')
    .update({ checkin_at: new Date().toISOString(), checkin_lat: lat, checkin_lng: lng, estado: 'activa' })
    .eq('id', guardia.id);
  if (error) {
    return res.status(500).json({ error: error.message });
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

  res.json({ ok: true, dentroDeRango, distanciaMetros: distancia });
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
      return res.status(500).json({ error: error.message });
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
    return res.status(500).json({ error: e.message });
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
    return res.status(500).json({ error: errorReporte.message });
  }

  const { error: errorGuardia } = await supabase
    .from('guardias')
    .update({ push_reporte_enviado_at: new Date().toISOString() })
    .eq('id', guardia.id);
  if (errorGuardia) {
    return res.status(500).json({ error: errorGuardia.message });
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

appAsistentesRouter.post('/guardias/:id/checkout', requiereRolAsistente, async (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Faltan coordenadas GPS' });
  }

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
    return res.status(500).json({ error: e.message });
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

  // Se cierra solamente si sigue activa, y se comprueba que se haya cerrado de verdad. Los
  // controles de arriba se hicieron sobre una lectura anterior: si en el medio entró otro
  // check-out —dos toques seguidos al botón, la aplicación reintentando— acá no queda nada por
  // cambiar, y contestar que sí sin haber cambiado nada es lo que hace que dos guardias
  // superpuestas parezcan cerradas cuando solo se cerró una.
  const { data: cerrada, error } = await supabase
    .from('guardias')
    .update({
      checkout_at: new Date().toISOString(),
      checkout_lat: lat,
      checkout_lng: lng,
      estado: 'completada',
    })
    .eq('id', guardia.id)
    .eq('estado', 'activa')
    .select('id');
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  if (!cerrada?.length) {
    // Misma respuesta que el control de arriba: para quien está del otro lado es el mismo caso,
    // y el cliente sin conexión ya sabe qué hacer con `yaRegistrado`.
    return res.status(400).json({ error: 'Esta guardia ya tiene check-out registrado', yaRegistrado: true });
  }

  res.json({ ok: true });
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

  // Solo mientras la guardia siga activa: si se cerró entre la lectura de arriba y esta línea,
  // el mapa de la Familia no tiene que seguir moviéndose. Y si no se escribió nada, se dice.
  const { data: marcada, error } = await supabase
    .from('guardias')
    .update({ ubicacion_actual_lat: lat, ubicacion_actual_lng: lng, ubicacion_actual_at: new Date().toISOString() })
    .eq('id', guardia.id)
    .eq('estado', 'activa')
    .select('id');
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  if (!marcada?.length) {
    return res.status(404).json({ error: 'Guardia activa no encontrada' });
  }

  res.json({ ok: true });
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
    return res.status(500).json({ error: error.message });
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
    return res.status(500).json({ error: error.message });
  }

  res.json({ ok: true });
});

appAsistentesRouter.delete('/push/suscribir', requiereRolAsistente, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) {
    return res.status(400).json({ error: 'Falta el endpoint de la suscripción' });
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('asistente_id', req.usuarioAsistente.id);
  if (error) {
    return res.status(500).json({ error: error.message });
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
  const { data, error } = await supabase
    .from('calificaciones_asistente')
    .select('id, estrellas, comentario, visible_publica, descargo_asistente, descargo_en, created_at')
    .eq('asistente_id', req.usuarioAsistente.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ calificaciones: data });
});

appAsistentesRouter.patch('/calificaciones/:id/descargo', requiereRolAsistente, async (req, res) => {
  const { descargo } = req.body || {};
  if (!descargo || !descargo.trim()) {
    return res.status(400).json({ error: 'Falta el texto del descargo' });
  }

  const { data: calificacion } = await supabase
    .from('calificaciones_asistente')
    .select('id, descargo_asistente')
    .eq('id', req.params.id)
    .eq('asistente_id', req.usuarioAsistente.id)
    .maybeSingle();

  if (!calificacion) {
    return res.status(404).json({ error: 'Calificación no encontrada' });
  }
  if (calificacion.descargo_asistente) {
    return res.status(409).json({ error: 'Ya hay un descargo cargado para esta calificación, no puede editarse' });
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
  if (error) return res.status(500).json({ error: error.message });
  if (!guardada?.length) {
    return res.status(404).json({ error: 'No se encontró esa calificación, el descargo no quedó guardado' });
  }

  res.json({ ok: true });
});

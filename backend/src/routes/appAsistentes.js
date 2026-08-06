import { Router } from 'express';
import multer from 'multer';
import { requiereRolAsistente } from '../middleware/requiereRolAsistente.js';
import { supabase } from '../db/connection.js';
import { estructurarReporteIA, distanciaMetros } from '../utils/reporteIA.js';
import { enviarPushFamilia } from '../utils/push.js';
import { analizarPaciente } from '../utils/revisarAlertasIA.js';
import { resolverVitalesHabilitados } from '../utils/vitalesReferencia.js';

export const appAsistentesRouter = Router();

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

// Punto único de verdad de "esta guardia ya tiene su Reporte Diario" (regla 12 de §7):
// lo consultan el guard de reporte duplicado y el guard de cierre sin reporte.
async function reporteDeLaGuardia(guardiaId) {
  const { data } = await supabase
    .from('reportes')
    .select('id')
    .eq('guardia_id', guardiaId)
    .maybeSingle();
  return data;
}

// ============================================================================
// Mi Perfil
// ============================================================================

appAsistentesRouter.get('/perfil', requiereRolAsistente, async (req, res) => {
  const { data: perfil, error } = await supabase
    .from('asistentes')
    .select('id, nombre, telefono, email, foto_url, especialidades, zonas, estado, tipo_vinculo, qr_token')
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

  res.json({ perfil, certificado: certificado || null });
});

// ============================================================================
// Mis Guardias
// ============================================================================

appAsistentesRouter.get('/guardias', requiereRolAsistente, async (req, res) => {
  const { data, error } = await supabase
    .from('guardias')
    .select('id, paciente_id, fecha, hora_inicio, hora_fin, modalidad, estado, checkin_at, checkout_at, checkout_bloqueado, pacientes(nombre, domicilio, lat, lng)')
    .eq('asistente_id', req.usuarioAsistente.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .order('fecha', { ascending: false })
    .order('hora_inicio', { ascending: false })
    .limit(100);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json({ guardias: data });
});

appAsistentesRouter.get('/guardias/:id', requiereRolAsistente, async (req, res) => {
  const { data, error } = await supabase
    .from('guardias')
    .select('id, paciente_id, fecha, hora_inicio, hora_fin, modalidad, estado, checkin_at, checkout_at, checkout_bloqueado, pacientes(id, nombre, domicilio, lat, lng, patologias)')
    .eq('id', req.params.id)
    .eq('asistente_id', req.usuarioAsistente.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .maybeSingle();

  if (error || !data) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }

  const vitales = await resolverVitalesHabilitados(data.paciente_id, req.usuarioAsistente.prestadoraId);
  // La pantalla necesita saberlo para ofrecer el cierre recién cuando hay reporte cargado,
  // en vez de dejar apretar un botón que el backend va a rechazar.
  const reporte = await reporteDeLaGuardia(data.id);

  res.json({
    guardia: data,
    reporteCargado: !!reporte,
    vitalesHabilitados: vitales.habilitados,
    rangosVitales: vitales.rangos,
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

  const { data: paciente } = await supabase
    .from('pacientes')
    .select('lat, lng, familia_id, nombre')
    .eq('id', guardia.paciente_id)
    .maybeSingle();

  const { data: config } = await supabase
    .from('configuracion_ausencia_automatica')
    .select('metros_tolerancia_checkin')
    .eq('prestadora_id', guardia.prestadora_id)
    .maybeSingle();
  const tolerancia = config?.metros_tolerancia_checkin ?? 150;

  let dentroDeRango = true;
  let distancia = null;
  if (paciente?.lat != null && paciente?.lng != null) {
    distancia = Math.round(distanciaMetros(lat, lng, paciente.lat, paciente.lng));
    dentroDeRango = distancia <= tolerancia;
  }

  const { error } = await supabase
    .from('guardias')
    .update({ checkin_at: new Date().toISOString(), checkin_lat: lat, checkin_lng: lng, estado: 'activa' })
    .eq('id', guardia.id);
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (paciente?.familia_id) {
    // Push inmediato a la Familia — docs/PRD_04_05_App_Servicio.md:58 ("el Asistente llegó
    // al domicilio"). Se envía una sola vez porque checkin_at ya se validó arriba como no
    // seteado antes de este UPDATE.
    enviarPushFamilia(paciente.familia_id, {
      titulo: 'Tu Asistente llegó',
      cuerpo: `El Asistente llegó al domicilio de ${paciente.nombre}.`,
      url: `/pacientes/${guardia.paciente_id}`,
    }).catch((err) => console.error('Error enviando push de llegada a Familia:', err.message));
    await supabase.from('guardias').update({ push_llegada_enviado_at: new Date().toISOString() }).eq('id', guardia.id);
  }

  if (!dentroDeRango && req.usuarioAsistente.prestadoraId) {
    // Nota automática al coordinador (PRD_04_05_App_Servicio.md) — se registra en
    // mensajes_asistente, el mismo canal que ya usa el Panel para comunicación con Asistentes,
    // en vez de crear una tabla nueva de notas para un solo caso.
    await supabase.from('mensajes_asistente').insert({
      asistente_id: guardia.asistente_id,
      prestadora_id: guardia.prestadora_id,
      usuario_id: guardia.asistente_id,
      mensaje: `Aviso automático del sistema: check-in fuera de rango (${distancia} m del domicilio del Paciente) en la guardia del ${guardia.fecha}.`,
    }).then(({ error: errorNota }) => {
      if (errorNota) console.error('Error registrando nota de check-in fuera de rango:', errorNota.message);
    });
  }

  res.json({ ok: true, dentroDeRango, distanciaMetros: distancia });
});

// ============================================================================
// Reporte Diario — estructurar (IA Nivel 1, no persiste todavía)
// ============================================================================

appAsistentesRouter.post('/guardias/:id/reporte/estructurar', requiereRolAsistente, async (req, res) => {
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
    res.status(500).json({ error: 'No se pudo estructurar el reporte con IA — completá los campos a mano' });
  }
});

// Foto opcional del reporte, subida antes de confirmar.
appAsistentesRouter.post(
  '/guardias/:id/reporte/foto',
  requiereRolAsistente,
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
  const { textoLibre, alimentacion, medicacion, signosVitales, estadoAnimo, incidentes, observaciones, fotoUrl } = req.body;

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }
  if (!guardia.checkin_at) {
    return res.status(400).json({ error: 'No se puede cargar el reporte sin check-in previo' });
  }
  if (await reporteDeLaGuardia(guardia.id)) {
    // yaRegistrado: true — mismo criterio que en /checkin (Fase 9, cliente offline). Antes
    // esta protección contra el envío duplicado la daba el guard de checkout_at; al separar
    // el cierre del reporte, la da la existencia del reporte mismo.
    return res.status(400).json({ error: 'Esta guardia ya tiene su Reporte Diario cargado', yaRegistrado: true });
  }

  const { data: reporte, error: errorReporte } = await supabase
    .from('reportes')
    .insert({
      prestadora_id: guardia.prestadora_id,
      guardia_id: guardia.id,
      texto_libre: textoLibre || null,
      alimentacion: alimentacion || null,
      medicacion: medicacion || [],
      signos_vitales: signosVitales || null,
      estado_animo: estadoAnimo || null,
      incidentes: incidentes || null,
      observaciones: observaciones || null,
      foto_url: fotoUrl || null,
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

  const { data: paciente } = await supabase
    .from('pacientes')
    .select('familia_id, nombre')
    .eq('id', guardia.paciente_id)
    .maybeSingle();
  if (paciente?.familia_id) {
    enviarPushFamilia(paciente.familia_id, {
      titulo: 'Reporte diario disponible',
      cuerpo: `Ya está listo el reporte de la guardia de ${paciente.nombre}.`,
      url: `/pacientes/${guardia.paciente_id}/reportes/${reporte.id}`,
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
          analizarPaciente(guardia.paciente_id, guardia.prestadora_id).catch((err) =>
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
//   2. sin Reporte Diario cargado no se cierra — la regla de negocio que antes garantizaba
//      el endpoint del reporte, ahora explícita en vez de implícita;
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
  if (!(await reporteDeLaGuardia(guardia.id))) {
    return res.status(400).json({ error: 'Falta cargar el Reporte Diario antes de cerrar la guardia', motivo: 'falta_reporte' });
  }
  if (guardia.checkout_bloqueado) {
    return res.status(409).json({ error: 'Check-out bloqueado por el protocolo de continuidad de guardia', motivo: 'continuidad' });
  }

  const { error } = await supabase
    .from('guardias')
    .update({
      checkout_at: new Date().toISOString(),
      checkout_lat: lat,
      checkout_lng: lng,
      estado: 'completada',
    })
    .eq('id', guardia.id);
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ ok: true });
});

// Ping de ubicación en vivo durante una guardia activa — la Familia lo lee vía Supabase
// Realtime, nunca por HTTP (PRD_04_05_App_Servicio.md, mapa en tiempo real de la Pantalla
// del Paciente).
appAsistentesRouter.patch('/guardias/:id/ubicacion', requiereRolAsistente, async (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Faltan coordenadas GPS' });
  }

  const guardia = await guardiaDelAsistente(req.params.id, req.usuarioAsistente);
  if (!guardia || guardia.estado !== 'activa') {
    return res.status(404).json({ error: 'Guardia activa no encontrada' });
  }

  const { error } = await supabase
    .from('guardias')
    .update({ ubicacion_actual_lat: lat, ubicacion_actual_lng: lng, ubicacion_actual_at: new Date().toISOString() })
    .eq('id', guardia.id);
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ ok: true });
});

// Reportes anteriores del mismo Paciente (botón "Ver reportes anteriores" en Guardia Activa).
appAsistentesRouter.get('/pacientes/:id/reportes', requiereRolAsistente, async (req, res) => {
  const { data: guardiaPropia } = await supabase
    .from('guardias')
    .select('id')
    .eq('paciente_id', req.params.id)
    .eq('asistente_id', req.usuarioAsistente.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .limit(1)
    .maybeSingle();
  if (!guardiaPropia) {
    return res.status(403).json({ error: 'No tenés guardias asignadas a este Paciente' });
  }

  const { data, error } = await supabase
    .from('reportes')
    .select('id, texto_libre, alimentacion, medicacion, signos_vitales, estado_animo, incidentes, observaciones, foto_url, created_at, guardias!inner(paciente_id, fecha)')
    .eq('guardias.paciente_id', req.params.id)
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

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        prestadora_id: req.usuarioAsistente.prestadoraId,
        asistente_id: req.usuarioAsistente.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: req.headers['user-agent'] || null,
      },
      { onConflict: 'endpoint' }
    );
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
    return res.status(409).json({ error: 'Ya cargaste un descargo para esta calificación, no puede editarse' });
  }

  const { error } = await supabase
    .from('calificaciones_asistente')
    .update({ descargo_asistente: descargo.trim(), descargo_en: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('asistente_id', req.usuarioAsistente.id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

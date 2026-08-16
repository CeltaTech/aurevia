import { supabase } from '../db/connection.js';
import { enviarPushAsistente } from './push.js';
import { enviarWhatsApp } from './whatsapp.js';

// Aviso automático al Asistente cuando se cierra el servicio de su Paciente por una causa
// ajena a su desempeño (Fase 6, docs/PLAN dentro de
// C:\Users\Usuario\.claude\plans\distributed-scribbling-wirth.md). El Coordinador debe avisar
// verbalmente primero (señal de respeto, decisión del Desarrollador 2026-07-22); este proceso
// es el resguardo que dispara push + WhatsApp solo si esa llamada no quedó marcada dentro del
// plazo configurado por la Prestadora (configuracion_aviso_cese_asistente).
//
// Usa el service role (bypassa RLS) porque procesa cierres de todas las prestadoras según su
// propia configuración — no hay un usuario de panel logueado en este proceso.
export async function revisarAvisosAutomaticosCese() {
  const { data: configuraciones, error: errorConfig } = await supabase
    .from('configuracion_aviso_cese_asistente')
    .select('prestadora_id, horas_plazo_aviso_verbal')
    .eq('activo', true);

  if (errorConfig) {
    console.error('Error consultando configuracion_aviso_cese_asistente:', errorConfig.message);
    return;
  }
  if (!configuraciones?.length) return;

  const ahora = new Date();

  for (const { prestadora_id: prestadoraId, horas_plazo_aviso_verbal: horasPlazo } of configuraciones) {
    const limite = new Date(ahora.getTime() - horasPlazo * 60 * 60 * 1000).toISOString();

    const { data: pendientes, error: errorPendientes } = await supabase
      .from('cierre_servicio_asistentes')
      .select('id, asistente_id, cierre_id, cierres_servicio_paciente(motivo, motivo_detalle), asistentes(nombre, telefono)')
      .eq('prestadora_id', prestadoraId)
      .is('avisado_verbalmente_at', null)
      .is('aviso_automatico_enviado_at', null)
      .lte('created_at', limite);

    if (errorPendientes) {
      console.error(`Error consultando avisos de cese pendientes (prestadora ${prestadoraId}):`, errorPendientes.message);
      continue;
    }

    for (const pendiente of pendientes ?? []) {
      await enviarAvisoCese({ pendiente, prestadoraId });
    }
  }
}

async function enviarAvisoCese({ pendiente, prestadoraId }) {
  const titulo = 'Aviso: finalización de servicio';
  const cuerpo = 'Se cerró el servicio en el que participaba. Para más información, puede comunicarse con el coordinador.';

  await enviarPushAsistente(pendiente.asistente_id, { titulo, cuerpo });

  const telefono = pendiente.asistentes?.telefono;
  if (telefono) {
    try {
      await enviarWhatsApp({ prestadoraId, telefono, texto: `${titulo}\n\n${cuerpo}` });
    } catch (err) {
      console.error(`Error enviando WhatsApp de aviso de cese (asistente ${pendiente.asistente_id}):`, err.message);
    }
  }

  const { error: errorUpdate } = await supabase
    .from('cierre_servicio_asistentes')
    .update({ aviso_automatico_enviado_at: new Date().toISOString() })
    .eq('id', pendiente.id);
  if (errorUpdate) {
    console.error(`Error marcando aviso automático de cese enviado (${pendiente.id}):`, errorUpdate.message);
  }
}

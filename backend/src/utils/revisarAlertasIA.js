import { supabase } from '../db/connection.js';
import { analizarAlertaIA } from './alertasIA.js';
import { notificarCoordinador } from './whatsapp.js';
import { enviarPushFamilia } from './push.js';
import { medicacionVigenteDelPaciente } from './medicacionIndicaciones.js';

// Lo que vale mientras la Prestadora no haya elegido otra cosa. Son los mismos valores que
// tienen por defecto las columnas de `configuracion_alertas_ia` en la base: están escritos en
// los dos lados a propósito, para que una Prestadora sin fila guardada se comporte igual que
// una que guardó los valores de fábrica, y así no haga falta sembrarle la fila a nadie.
export const VALORES_POR_DEFECTO_ALERTAS_IA = {
  palabras_clave: [],
  reportes_a_analizar: 7,
  roja_avisa_familia: true,
  amarilla_avisa_familia: false,
  amarilla_avisa_coordinador: true,
};

// Los mismos topes que la regla de la base (migración 20260811150000). Se exponen para que el
// backend rechace el valor antes de que la base lo rechace: así el Panel recibe un mensaje en
// castellano y no el error crudo de Postgres.
export const LIMITES_ALERTAS_IA = {
  reportes_a_analizar_minimo: 1,
  reportes_a_analizar_maximo: 30,
};

// Cómo revisa esta Prestadora: cuánto material mira y a quién le avisa. Si todavía no eligió
// nada, valen los valores de fábrica de acá arriba.
async function configuracionAlertasIA(prestadoraId) {
  const { data } = await supabase
    .from('configuracion_alertas_ia')
    .select('reportes_a_analizar, roja_avisa_familia, amarilla_avisa_familia, amarilla_avisa_coordinador')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  return { ...VALORES_POR_DEFECTO_ALERTAS_IA, ...data };
}

// IA Nivel 2 (Alertas por patrones, docs/AI_PROMPTS.md:41-79). Dos disparadores:
// (a) análisis nocturno de todo Paciente con reportes nuevos desde su último análisis,
// (b) análisis inmediato si un reporte recién confirmado contiene una palabra clave crítica
// (configuracion_alertas_ia, nunca hardcodeada — llamado directamente desde
// appAsistentes.js en vez de por este cron, así que analizarPaciente queda exportado).
export async function revisarAlertasIA() {
  const { data: pacientes, error } = await supabase
    .from('pacientes')
    .select('id, prestadora_id, ultimo_analisis_ia_at');

  if (error) {
    console.error('Error consultando pacientes para IA Nivel 2:', error.message);
    return;
  }

  for (const paciente of pacientes ?? []) {
    let query = supabase
      .from('reportes')
      .select('id, created_at')
      .eq('paciente_id', paciente.id)
      .limit(1);
    if (paciente.ultimo_analisis_ia_at) {
      query = query.gt('created_at', paciente.ultimo_analisis_ia_at);
    }
    const { data: hayNuevos } = await query;
    if (!hayNuevos?.length) continue;

    await analizarPaciente(paciente.id, paciente.prestadora_id);
  }
}

// Analiza los últimos N reportes de un Paciente y persiste una alerta si corresponde. Se
// reutiliza tanto desde el cron nocturno como desde el disparo inmediato por palabra clave.
export async function analizarPaciente(pacienteId, prestadoraId) {
  const { data: paciente } = await supabase
    .from('pacientes')
    .select('patologias, familia_id')
    .eq('id', pacienteId)
    .maybeSingle();
  if (!paciente) return;

  // pacientes.medicacion_habitual queda retirada (pendiente #62, docs/PENDIENTES.md): la
  // IA analiza la medicación vigente real, derivada de indicaciones_medicacion.
  const medicacionVigente = await medicacionVigenteDelPaciente(pacienteId);

  const configuracion = await configuracionAlertasIA(prestadoraId);

  // Los reportes de esta persona, y solo los de esta persona. Antes se llegaba a ellos por los
  // turnos que la cubrieron, y si el turno cubría a dos, la IA leía las dos historias juntas y
  // podía levantar una alerta sobre alguien por lo que le pasaba al otro.
  const { data: reportes, error: errorReportes } = await supabase
    .from('reportes')
    .select(
      'id, texto_libre, alimentacion, medicacion, signos_vitales, estado_animo, incidentes, observaciones, created_at'
    )
    .eq('paciente_id', pacienteId)
    .order('created_at', { ascending: false })
    .limit(configuracion.reportes_a_analizar);

  if (errorReportes || !reportes?.length) return;

  let resultado;
  try {
    resultado = await analizarAlertaIA(
      { patologias: paciente.patologias, medicacionHabitual: medicacionVigente },
      reportes.map((r) => ({
        id: r.id,
        texto_libre: r.texto_libre,
        alimentacion: r.alimentacion,
        medicacion: r.medicacion,
        signos_vitales: r.signos_vitales,
        estado_animo: r.estado_animo,
        incidentes: r.incidentes,
        observaciones: r.observaciones,
        fecha: r.created_at,
      })),
      prestadoraId,
    );
  } catch (err) {
    console.error(`Error analizando IA Nivel 2 para paciente ${pacienteId}:`, err.message);
    return;
  }

  await supabase.from('pacientes').update({ ultimo_analisis_ia_at: new Date().toISOString() }).eq('id', pacienteId);

  if (!resultado || resultado.nivel === 'verde') return;

  const { data: alerta, error: errorAlerta } = await supabase
    .from('alertas')
    .insert({
      prestadora_id: prestadoraId,
      paciente_id: pacienteId,
      nivel: resultado.nivel,
      descripcion: resultado.descripcion,
      detalle_coordinador: resultado.detalle_coordinador,
      campos_preocupantes: resultado.campos_preocupantes,
      reportes_relacionados: reportes.map((r) => r.id),
    })
    .select('id')
    .single();
  if (errorAlerta) {
    console.error(`Error insertando alerta IA Nivel 2 para paciente ${pacienteId}:`, errorAlerta.message);
    return;
  }

  // A quién le llega cada nivel lo elige la Prestadora desde el Panel (pendiente #64). Antes
  // estaba escrito acá para todo el mundo: la roja al Coordinador y a la Familia, la amarilla
  // solo al Coordinador. Sigue siendo lo que pasa si nadie eligió otra cosa, pero ya no es una
  // decisión del programa.
  //
  // Lo único que no se configura: una alerta ROJA siempre le llega al Coordinador. Si la
  // revisión encontró algo urgente sobre un Paciente, alguien de la Prestadora tiene que
  // enterarse; ese es el piso del producto.
  const esRoja = resultado.nivel === 'roja';
  const avisarCoordinador = esRoja || configuracion.amarilla_avisa_coordinador;
  const avisarFamilia = esRoja ? configuracion.roja_avisa_familia : configuracion.amarilla_avisa_familia;

  if (avisarCoordinador) {
    await notificarCoordinador({
      evento: 'alerta_ia_nivel2',
      prestadoraId,
      asunto: esRoja ? 'Alerta ROJA de IA — Paciente' : 'Alerta AMARILLA de IA — Paciente',
      texto: resultado.detalle_coordinador || resultado.descripcion || 'Ver detalle en el Panel.',
    });
  }

  if (avisarFamilia && paciente.familia_id) {
    enviarPushFamilia(paciente.familia_id, {
      // El aviso a la Familia se mide según el nivel: la amarilla no es una urgencia y
      // anunciarla con las palabras de la roja asusta sin motivo. Antes solo salía la roja,
      // así que este segundo texto no existía.
      titulo: esRoja ? 'Alerta sobre el Paciente' : 'Novedad sobre el Paciente',
      cuerpo:
        resultado.descripcion
        || (esRoja
          ? 'Hay una novedad importante para revisar en la app.'
          : 'Hay algo para mirar sin apuro en la app.'),
      url: `/pacientes/${pacienteId}/alertas`,
    }).catch((err) => console.error('Error enviando push de alerta roja a Familia:', err.message));
  }

  return alerta;
}

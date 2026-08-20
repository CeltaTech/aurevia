import { supabase } from '../db/connection.js';
import { sumarDias } from './fechas.js';
import { pacientesDeSeries, anotarPacientesEnGuardias } from './pacientesDeGuardia.js';

const DIAS_GENERACION_DEFAULT = 90;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

function generarFechasFaltantes(desdeExclusiveISO, hastaInclusiveISO, diasSemana) {
  const diaIndices = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
  const indicesElegidos = diasSemana.map((d) => diaIndices[d]);
  const inicio = new Date(`${desdeExclusiveISO}T00:00:00Z`);
  inicio.setUTCDate(inicio.getUTCDate() + 1);
  const fin = new Date(`${hastaInclusiveISO}T00:00:00Z`);
  const fechas = [];
  for (let f = inicio; f <= fin; f = new Date(f.getTime() + UN_DIA_MS)) {
    if (indicesElegidos.includes(f.getUTCDay())) fechas.push(f.toISOString().slice(0, 10));
  }
  return fechas;
}

// Mantiene siempre `dias_generacion_series_guardia` días de guardias concretas generadas por
// delante de "hoy" para cada serie abierta (`vigente_hasta IS NULL`) — sin esto, la generación
// única que hace NuevaGuardiaModal.jsx al crear la serie deja de producir guardias nuevas en
// silencio pasado ese horizonte. Proceso 100% interno, nunca visible en ninguna pantalla (ver
// docs/PENDIENTES.md #18 punto 2). Corre una vez por día
// (ver server.js), mismo patrón de recorrido por prestadora que revisarVencimientos.
export async function extenderSeriesGuardiaAbiertas() {
  const { data: prestadoras, error: errorPrestadoras } = await supabase
    .from('prestadoras')
    .select('id, dias_generacion_series_guardia')
    .eq('estado', 'certificada');

  if (errorPrestadoras) {
    console.error('Error consultando prestadoras activas:', errorPrestadoras.message);
    return;
  }

  const hoyISO = new Date().toISOString().slice(0, 10);

  for (const { id: prestadoraId, dias_generacion_series_guardia: diasConfigurados } of prestadoras ?? []) {
    const horizonte = diasConfigurados ?? DIAS_GENERACION_DEFAULT;
    const limiteISO = sumarDias(hoyISO, horizonte);

    const { data: series, error: errorSeries } = await supabase
      .from('series_guardias')
      .select('id, asistente_id, paciente_id, dias_semana, hora_inicio, hora_fin, modalidad')
      .eq('prestadora_id', prestadoraId)
      .eq('estado', 'activa')
      .is('vigente_hasta', null);

    if (errorSeries) {
      console.error(`Error consultando series abiertas de ${prestadoraId}:`, errorSeries.message);
      continue;
    }

    // A quiénes cubre cada serie. Una serie puede cubrir a más de un Paciente —el matrimonio
    // que vive en la misma casa—, y las guardias que se generan solas tienen que llevarlos a
    // todos. Sin esto, la serie arranca bien y de a poco se le va cayendo el segundo Paciente:
    // las primeras guardias las creó el Panel con la lista completa, y todas las de más
    // adelante saldrían con uno solo, sin que nadie se entere.
    let pacientesPorSerie;
    try {
      pacientesPorSerie = await pacientesDeSeries(series ?? []);
    } catch (e) {
      console.error(`Error leyendo los Pacientes de las series de ${prestadoraId}:`, e.message);
      continue;
    }

    for (const serie of series ?? []) {
      const { data: ultimaGuardia, error: errorUltima } = await supabase
        .from('guardias')
        .select('fecha')
        .eq('serie_id', serie.id)
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (errorUltima) {
        console.error(`Error consultando última guardia de la serie ${serie.id}:`, errorUltima.message);
        continue;
      }

      const desdeExclusive = ultimaGuardia?.fecha ?? hoyISO;
      if (desdeExclusive >= limiteISO) continue;

      const fechasFaltantes = generarFechasFaltantes(desdeExclusive, limiteISO, serie.dias_semana);
      if (fechasFaltantes.length === 0) continue;

      const filas = fechasFaltantes.map((fecha) => ({
        prestadora_id: prestadoraId,
        serie_id: serie.id,
        asistente_id: serie.asistente_id,
        paciente_id: serie.paciente_id,
        fecha,
        hora_inicio: serie.hora_inicio,
        hora_fin: serie.hora_fin,
        modalidad: serie.modalidad,
      }));

      const { data: creadas, error: errorInsert } = await supabase.from('guardias').insert(filas).select('id');
      if (errorInsert) {
        console.error(`Error extendiendo guardias de la serie ${serie.id}:`, errorInsert.message);
        continue;
      }

      // Cada fecha es una guardia distinta y cada una lleva su propia lista de a quiénes
      // atiende: no alcanza con que la lista esté cargada una vez en la serie.
      try {
        await anotarPacientesEnGuardias(
          (creadas ?? []).map((g) => g.id),
          pacientesPorSerie.get(serie.id) ?? [],
          prestadoraId
        );
      } catch (e) {
        console.error(`Error anotando los Pacientes de las guardias de la serie ${serie.id}:`, e.message);
      }
    }
  }
}

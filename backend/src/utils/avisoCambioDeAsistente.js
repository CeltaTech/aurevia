import { supabase } from '../db/connection.js';
import { notificarCoordinador } from './whatsapp.js';
import { enviarPushFamilia } from './push.js';
import { configuracionEvento } from './email.js';
import { pacientesDeGuardias } from './pacientesDeGuardia.js';
import { aviso } from '../i18n/avisos.js';
import { idiomaDeLaPrestadora } from '../i18n/idiomaDeLaPrestadora.js';

// Aviso de que una o varias guardias pasaron a manos de otro Asistente.
//
// Lo pide el Panel, que es donde se reasigna: ahí se cambia el Asistente de una guardia, se la
// arrastra a otra fila del cuadro y se asigna la cobertura de una ausencia. El Panel no puede
// mandar este aviso por su cuenta —habla con la base directo y no tiene push, ni WhatsApp, ni
// correo—, así que llama a `routes/panelGuardias.js` y ahí se entra por acá.
//
// **El Asistente nuevo llega explícito y no se lee de `guardias.asistente_id`.** Quien llama puede
// pedir el aviso con las guardias tal como estaban antes de moverlas, y ahí esa columna todavía
// nombra al Asistente anterior: si el aviso la mirara, anunciaría el cambio nombrando justamente a
// quien deja de tenerlas.
//
// **Un solo aviso para todas las guardias, y no uno por guardia.** Una ausencia puede dejar diez
// turnos descubiertos, y diez avisos por una sola decisión serían diez correos al Coordinador por
// algo que se hizo de una vez.
export const EVENTO_CAMBIO_DE_ASISTENTE = 'cambio_de_asistente';

// Ordena por cuándo ocurre el turno, que es el orden en que le sirve a quien lee: primero lo que
// pasa antes. Función aparte para que las dos armadas de abajo ordenen igual.
function porCuandoOcurre(a, b) {
  return `${a.fecha} ${a.hora_inicio ?? ''}`.localeCompare(`${b.fecha} ${b.hora_inicio ?? ''}`);
}

function nombresDePacientes(pacientes) {
  return (pacientes ?? []).map((p) => p.nombre).filter(Boolean);
}

// Los turnos como los lee el Coordinador: todos juntos, con sus Pacientes.
export function turnosDelAviso(guardias, pacientesPorGuardia) {
  return [...(guardias ?? [])].sort(porCuandoOcurre).map((guardia) => ({
    fecha: guardia.fecha,
    horaInicio: guardia.hora_inicio,
    horaFin: guardia.hora_fin,
    pacientes: nombresDePacientes(pacientesPorGuardia?.get(guardia.id)),
  }));
}

// Los mismos turnos, pero repartidos por Familia: a cada una le toca ver sólo los suyos.
//
// Un turno que cubre a dos Pacientes de la misma Familia aparece una vez y no dos: es un solo
// turno, y contarlo dos veces le diría «2 guardias» a quien tiene una.
export function turnosPorFamilia(guardias, pacientesPorGuardia) {
  const porFamilia = new Map();

  for (const guardia of [...(guardias ?? [])].sort(porCuandoOcurre)) {
    const pacientes = pacientesPorGuardia?.get(guardia.id) ?? [];
    const familias = new Set(pacientes.map((p) => p.familia_id).filter(Boolean));

    for (const familiaId of familias) {
      const suyos = porFamilia.get(familiaId) ?? [];
      suyos.push({
        fecha: guardia.fecha,
        horaInicio: guardia.hora_inicio,
        horaFin: guardia.hora_fin,
        pacientes: nombresDePacientes(pacientes.filter((p) => p.familia_id === familiaId)),
      });
      porFamilia.set(familiaId, suyos);
    }
  }

  return porFamilia;
}

// El nombre de un Asistente, acotado a la Prestadora: un identificador de otra nunca devuelve un
// nombre. Sin esto, mandar un identificador ajeno alcanzaría para leer a quién pertenece
// (CLAUDE.md §6).
async function nombreDelAsistente(asistenteId, prestadoraId) {
  if (!asistenteId) return null;
  const { data } = await supabase
    .from('asistentes')
    .select('id, nombre')
    .eq('id', asistenteId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  return data?.nombre ?? null;
}

// El aviso completo. Nunca tira: quien lo llama ya cambió la guardia, y hacer fallar la operación
// por un canal que no salió mostraría como fallido algo que salió bien.
export async function avisarCambioDeAsistente({ guardias, prestadoraId, asistenteNuevoId, asistenteAnteriorId }) {
  if (!guardias?.length || !prestadoraId) return;

  const idioma = await idiomaDeLaPrestadora(prestadoraId);

  let pacientesPorGuardia = new Map();
  try {
    pacientesPorGuardia = await pacientesDeGuardias(guardias, 'id, nombre, familia_id');
  } catch (e) {
    console.error(`Error leyendo los Pacientes de las guardias que cambiaron de Asistente (prestadora ${prestadoraId}):`, e.message);
  }

  const [asistenteNuevo, asistenteAnterior] = await Promise.all([
    nombreDelAsistente(asistenteNuevoId, prestadoraId),
    nombreDelAsistente(asistenteAnteriorId, prestadoraId),
  ]);

  const datos = { asistenteNuevo, asistenteAnterior, turnos: turnosDelAviso(guardias, pacientesPorGuardia) };

  try {
    await notificarCoordinador({
      evento: EVENTO_CAMBIO_DE_ASISTENTE,
      prestadoraId,
      ...aviso(EVENTO_CAMBIO_DE_ASISTENTE, idioma, datos),
    });
  } catch (e) {
    console.error(`Error avisando al Coordinador el cambio de Asistente (prestadora ${prestadoraId}):`, e.message);
  }

  // A la Familia le llega sólo si la Prestadora lo encendió. El valor de arranque es que no
  // (`VALORES_POR_DEFECTO_AVISO`), y encenderlo desde acá sería decidir por ella cómo trabaja.
  const config = await configuracionEvento(EVENTO_CAMBIO_DE_ASISTENTE, prestadoraId);
  if (!config?.notificar_familia) return;

  for (const [familiaId, turnos] of turnosPorFamilia(guardias, pacientesPorGuardia)) {
    try {
      await enviarPushFamilia(familiaId, {
        ...aviso(`${EVENTO_CAMBIO_DE_ASISTENTE}_familia`, idioma, { asistenteNuevo, turnos }),
        url: '/',
      });
    } catch (e) {
      console.error(`Error avisando a la Familia ${familiaId} el cambio de Asistente:`, e.message);
    }
  }
}

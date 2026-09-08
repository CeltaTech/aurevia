import { supabase } from './supabaseClient';
import { cambiarPacienteDeGuardia } from './cambiarPacienteDeGuardia';
import { mensajeDeError } from './errores';

/* Arrastrar una guardia dentro de la grilla: un solo lugar para lo que eso significa.
   =========================================================================================

   POR QUÉ ESTÁ ACÁ Y NO DENTRO DE UNA PANTALLA. Soltar una guardia en otra celda no es
   escribir una columna: son tres decisiones distintas, y cuál se toma depende de qué está
   mostrando la grilla en ese momento.

     1. Si las filas son Asistentes, mover la guardia cambia quién la hace.
     2. Si las filas son Pacientes, mover la guardia cambia a quién cubre — y eso no es una
        columna, porque un turno puede cubrir a varias personas a la vez. Esa cuenta vive en
        `lib/cambiarPacienteDeGuardia.js` y acá solo se la llama.
     3. En cualquiera de las dos, la columna nueva es la fecha; y en la vista de línea de
        tiempo, además, la posición horizontal ES la hora, así que vienen las dos horas ya
        calculadas por la grilla, que es la única que sabe cuánto duraba el turno.

   Y una cosa más que es fácil olvidar: si la guardia estaba publicada como disponible y se le
   asigna un Asistente, deja de estarlo. La base tiene una restricción que no permite las dos
   cosas juntas, así que sin ese paso el movimiento entero falla.

   Dos pantallas usan la misma grilla —el Estado actual y la de Guardias—, así que todo esto se
   escribe una sola vez y las dos la llaman (regla del punto único de verdad, CeltaTech §8).

   POR QUÉ FALLA CERRADO ANTE UNA VISTA DESCONOCIDA. Las dos ramas escriben en lugares
   distintos: una guarda un identificador en `asistente_id` y la otra rehace la lista de
   Pacientes del turno. Si la vista llegara vacía o con un valor que no se entiende, elegir
   cualquiera de las dos guardaría el dato en el lugar equivocado — un Paciente metido en la
   columna del Asistente, o al revés. Adivinar no es una opción, así que no se mueve nada y se
   avisa (regla «todo control de acceso falla cerrado», CeltaTech §5). */

/** Las dos únicas cosas que puede haber en las filas de la grilla. */
const VISTAS = ['asistente', 'paciente'];

/**
 * @param {object} guardia  La guardia entera, como está hoy — hacen falta `ofrecida_at` para
 *                          saber si estaba publicada, y `paciente_id` y `prestadora_id` para
 *                          rehacer la lista de Pacientes. Con el id solo no alcanzaría.
 * @param {object} movimiento  Lo que informa la grilla al soltar:
 *   - `fila`: a qué fila se la llevó (un Asistente o un Paciente, según la vista).
 *   - `filaOrigen`: de qué fila se la sacó. Solo se usa en la vista por Paciente.
 *   - `fecha`: en qué día quedó.
 *   - `vista`: qué hay en las filas, `'asistente'` o `'paciente'`. Viene con el movimiento y no
 *     se lee del estado de la pantalla: la grilla puede estar mostrando otra cosa de la que la
 *     pantalla cree si nadie la controla.
 *   - `horaInicio` y `horaFin`: solo desde la línea de tiempo. Si no vienen, el horario no se
 *     toca.
 * @param {object} t  Los textos del idioma en que está el Panel. Se piden desde afuera porque
 *                          acá no se sabe en qué idioma está, y hacen falta para que ningún
 *                          error de la base llegue crudo a la pantalla.
 * @returns {Promise<{ error: string | null }>} El motivo si algo falló, o null si salió todo.
 */
export async function moverGuardia(guardia, { fila, filaOrigen, fecha, vista, horaInicio, horaFin }, t = null) {
  if (!guardia?.id) return { error: null };

  if (!VISTAS.includes(vista)) {
    return { error: mensajeDeError(new Error(`Vista de grilla desconocida: ${String(vista)}`), t, 'moverGuardia') };
  }

  const porPaciente = vista === 'paciente';

  if (porPaciente) {
    const { error: falla } = await cambiarPacienteDeGuardia(guardia, filaOrigen, fila, t);
    if (falla) return { error: falla };
  }

  const cambios = { fecha };
  if (!porPaciente) cambios.asistente_id = fila;
  if (horaInicio && horaFin) {
    cambios.hora_inicio = horaInicio;
    cambios.hora_fin = horaFin;
  }
  if (cambios.asistente_id && guardia.ofrecida_at) {
    cambios.ofrecida_at = null;
    cambios.ofrecida_por = null;
    cambios.oferta_limite_at = null;
  }

  const { error } = await supabase.from('guardias').update(cambios).eq('id', guardia.id);
  return { error: error ? mensajeDeError(error, t) : null };
}

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { mensajeDeError } from '../../lib/errores';
import { claseBadgeTono } from '../../lib/tonos';
import { con } from '../../lib/textos';
import { hoyISO, horaDelMomento } from '../../lib/horarios';
import { EstadoLista } from '../../components/layout/EstadoLista';
import {
  cargarPacientesDeGuardias,
  conPacientes,
  textoDePacientes,
} from '../../lib/pacientesDeGuardia';
import { situacionDeGuardia, tonoDeGuardia } from '../../lib/semaforoGuardia';
import { useUmbrales } from '../../context/UmbralesContext';

/* Lo que este Asistente ya trabajó.
   ==========================================================================

   Hasta acá, saber si alguien cumplió sus turnos obligaba a abrir la pantalla de Guardias y
   filtrarla por su nombre, período por período. El dato estaba; lo que faltaba era mirarlo
   desde la persona.

   SE MUESTRA LO QUE YA PASÓ, Y SÓLO ESO. Lo que tiene por delante ya se ve en la grilla de
   Guardias y, contado, en la lista del plantel. Mezclar las dos cosas en una sola tabla haría
   que un turno todavía no trabajado se lea como un antecedente.

   No se decide nada acá: la situación de cada guardia sale del semáforo
   (`lib/semaforoGuardia.js`) y a quiénes atendió, de `lib/pacientesDeGuardia.js`, que es el
   único lugar que sabe que hay dos maneras de tener un Paciente cargado. */

/* Cuántas filas como mucho. Un Asistente con dos años de antigüedad tiene cientos de guardias
   atrás: esto es una ficha, no la pantalla de Guardias. Cuando se llega al tope se dice, que es
   lo que evita que alguien crea que está viendo toda la historia. */
const TOPE = 50;

/* Las columnas de `guardias` que hacen falta. Las cuatro últimas no se muestran como tales: las
   necesita `situacionDeGuardia` para decidir en qué situación quedó cada turno. */
const COLUMNAS =
  'id, fecha, hora_inicio, hora_fin, paciente_id, estado, asistente_id, ofrecida_at, oferta_limite_at, checkin_at, checkout_at';

export function GuardiasTab({ asistente }) {
  const { t, locale } = useLocale();
  const [datos, setDatos] = useState({ filas: [], tope: false });
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  /* Los umbrales de esta Prestadora, los mismos que pinta la grilla de Guardias: un turno que
     allá figura sin cerrar no puede figurar acá como completado. */
  const umbrales = useUmbrales();

  const cargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { data, error: errorGuardias } = await supabase
        .from('guardias')
        .select(COLUMNAS)
        .eq('asistente_id', asistente.id)
        .lte('fecha', hoyISO())
        .order('fecha', { ascending: false })
        .order('hora_inicio', { ascending: false })
        .limit(TOPE);

      if (errorGuardias) throw errorGuardias;

      const guardias = data ?? [];
      const porGuardia = await cargarPacientesDeGuardias(guardias.map((g) => g.id));

      // Los nombres se piden aparte y en una sola consulta: pedirlos anidados a `guardias`
      // traería el mismo nombre repetido una vez por turno.
      const idsPacientes = [
        ...new Set([...porGuardia.values()].flat().concat(guardias.map((g) => g.paciente_id))),
      ].filter(Boolean);
      const { data: pacientes, error: errorPacientes } = idsPacientes.length
        ? await supabase.from('pacientes').select('id, nombre').in('id', idsPacientes)
        : { data: [], error: null };
      if (errorPacientes) throw errorPacientes;

      const nombres = Object.fromEntries((pacientes ?? []).map((p) => [p.id, p.nombre]));
      const ctx = { umbrales };
      const filas = conPacientes(guardias, porGuardia, nombres).map((g) => ({
        ...g,
        situacion: situacionDeGuardia(g, ctx),
        tono: tonoDeGuardia(g, ctx),
      }));

      setDatos({ filas, tope: filas.length === TOPE });
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [asistente.id, t, umbrales]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <EstadoLista
      estado={estado}
      error={error}
      vacio={estado === 'listo' && datos.filas.length === 0}
      recargar={cargar}
      mensajeVacio={t.asistentes.historial.vacio}
      ayudaVacio={t.asistentes.historial.vacio_ayuda}
    >
      <>
        {datos.tope && (
          <p className="panel-explicacion">{con(t.asistentes.historial.tope, { n: TOPE })}</p>
        )}
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.asistentes.historial.col_fecha}</th>
              <th>{t.asistentes.historial.col_horario}</th>
              <th>{t.asistentes.historial.col_paciente}</th>
              <th>{t.asistentes.historial.col_registro}</th>
              <th>{t.asistentes.historial.col_situacion}</th>
            </tr>
          </thead>
          <tbody>
            {datos.filas.map((g) => (
              <tr key={g.id}>
                <td>{g.fecha}</td>
                <td>
                  {g.hora_inicio} – {g.hora_fin}
                </td>
                <td>{textoDePacientes(g.pacientes_nombres, t.guardias.pacientes_y_mas)}</td>
                {/* La llegada y la salida que quedaron registradas. Cuando falta alguna de las
                    dos se dice que no quedó registro, que no es lo mismo que decir que no
                    trabajó: el turno pudo cumplirse y el registro no haberse hecho. */}
                <td>
                  {g.checkin_at || g.checkout_at
                    ? `${horaDelMomento(g.checkin_at, locale) || '—'} – ${horaDelMomento(g.checkout_at, locale) || '—'}`
                    : t.asistentes.historial.sin_registro}
                </td>
                <td>
                  <span className={claseBadgeTono(g.tono)}>{t.guardias.situacion[g.situacion]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    </EstadoLista>
  );
}

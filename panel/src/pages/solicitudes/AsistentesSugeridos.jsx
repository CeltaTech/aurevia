import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { asistentesParaSolicitud } from '../../lib/asistentesParaSolicitud';

/* A quién proponerle esta Solicitud, adentro de la misma ventana donde se la está leyendo.
   Hasta ahora, para pasar de una Solicitud a una guardia había que memorizar la localidad y el
   servicio pedido, salir a la pantalla de Guardias y buscar ahí a quién ponerle el turno.

   QUIÉN DECIDE QUÉ. El orden y los motivos salen de `lib/asistentesParaSolicitud.js`, que es el
   punto único de verdad; acá sólo se trae el plantel, se traduce cada motivo y se abre la
   ventana de guardia nueva con el Asistente ya elegido. Ninguna regla de negocio vive en este
   archivo.

   POR QUÉ SE MUESTRAN POCOS Y DESPUÉS TODOS. El plantel de una Prestadora mediana son decenas de
   personas, y una lista así adentro de una ventana obliga a desplazarse para llegar al botón de
   guardar. Se muestran los primeros —que son los que más encajan— y el resto queda a un clic,
   sin que nadie desaparezca. */

const CUANTOS_PRIMERO = 5;

export function AsistentesSugeridos({ solicitud, onAsignar }) {
  const { t } = useLocale();
  const ts = t.solicitudes.sugeridos;
  const [plantel, setPlantel] = useState([]);
  const [pacientes, setPacientes] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [todos, setTodos] = useState(false);

  const cargar = useCallback(async () => {
    setEstado('cargando');

    // Se pide el plantel entero y no sólo a los activos: quién sigue estando lo decide
    // `asistentesParaSolicitud`, que es donde está escrita esa regla una sola vez. Las columnas
    // son las justas para ordenar la lista; ningún dato del Paciente ni domicilio alguno viaja
    // hasta acá (CLAUDE.md §6).
    const [{ data: filas, error }, { data: susPacientes, error: errorPacientes }] =
      await Promise.all([
        supabase
          .from('asistentes')
          .select('id, nombre, estado, zonas, especialidades, disponible_para_ofertas')
          .is('deleted_at', null),
        solicitud.familia_id
          ? supabase
              .from('pacientes')
              .select('id')
              .eq('familia_id', solicitud.familia_id)
              .is('deleted_at', null)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (error || errorPacientes) {
      setEstado('error');
      return;
    }

    setPlantel(filas ?? []);
    setPacientes(susPacientes ?? []);
    setEstado('listo');
  }, [solicitud.familia_id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const sugeridos = useMemo(
    () => asistentesParaSolicitud(solicitud, plantel),
    [solicitud, plantel],
  );

  const visibles = todos ? sugeridos : sugeridos.slice(0, CUANTOS_PRIMERO);

  // Una guardia necesita a quién se atiende, y eso recién existe cuando la Solicitud se convirtió
  // en Familia con su Paciente. Mientras tanto la lista se muestra igual —sirve para saber a
  // quién llamar— y lo que falta se dice con todas las letras en vez de dejar un botón apagado
  // sin explicación.
  const puedeAsignar = Boolean(solicitud.familia_id) && pacientes.length > 0;
  const porQueNo = !solicitud.familia_id
    ? ts.falta_familia
    : pacientes.length === 0
      ? ts.sin_pacientes
      : null;

  return (
    <section className="panel-resultado-calculo">
      <h3>{ts.titulo}</h3>
      <p className="panel-lateral-subtitulo">{ts.explicacion}</p>

      <EstadoLista
        estado={estado}
        recargar={cargar}
        vacio={sugeridos.length === 0}
        mensajeVacio={ts.vacio}
      >
        <>
          {porQueNo && <p className="estado-vacio">{porQueNo}</p>}

          {visibles.map((fila) => (
            <div key={fila.asistente.id} className="candidato">
              <div className="candidato-cabecera">
                <span className="candidato-nombre">{fila.asistente.nombre}</span>
                <span className="candidato-puntaje">{fila.puntaje}</span>
                {puedeAsignar && (
                  <Button
                    onClick={() =>
                      onAsignar({
                        asistenteId: fila.asistente.id,
                        pacienteIds: pacientes.map((p) => p.id),
                      })
                    }
                  >
                    {ts.asignar}
                  </Button>
                )}
              </div>

              <div className="candidato-motivos">
                {fila.aFavor.length > 0 && (
                  <ul>
                    {fila.aFavor.map((motivo) => (
                      <li key={motivo} className="motivo-a-favor">
                        {ts[`motivo_${motivo}`]}
                      </li>
                    ))}
                  </ul>
                )}
                {fila.enContra.length > 0 && (
                  <ul>
                    {fila.enContra.map((motivo) => (
                      <li key={motivo} className="motivo-en-contra">
                        {ts[`motivo_${motivo}`]}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}

          {sugeridos.length > CUANTOS_PRIMERO && (
            <Button variant="secondary" onClick={() => setTodos((antes) => !antes)}>
              {todos ? ts.ver_menos : ts.ver_todos}
            </Button>
          )}
        </>
      </EstadoLista>
    </section>
  );
}

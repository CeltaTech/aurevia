import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { supabase } from '../../lib/supabaseClient';
import { cargarGuardiasDePacientes } from '../../lib/pacientesDeGuardia';
import { ORIGEN, equipoDelPaciente, reglaDeEquipoDe } from '../../lib/equipoDelPaciente';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';

// Quiénes son el equipo de este Paciente.
//
// La lista se arma sola —quienes tienen turnos habituales con él, más quien lo coordina— y la
// Coordinadora la corrige: puede sumar, sacar y marcar quién cubre francos. Lo único que se
// guarda son esas correcciones; la lista entera se vuelve a deducir cada vez que se abre esta
// pantalla, así que quien empezó a venir aparece sola y quien dejó de venir desaparece sola.
//
// Quién entra sin que nadie la ponga no se decide acá: la regla vive en
// `src/lib/equipoDelPaciente.js`, que se copia al motor, y los dos números que la gobiernan los
// configura cada Prestadora.
export function EquipoDelPaciente({ paciente, puedeEditar, onClose }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();

  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [errorFila, setErrorFila] = useState(null);
  const [enCurso, setEnCurso] = useState(null);

  const [datos, setDatos] = useState(null);
  const [candidatas, setCandidatas] = useState([]);
  const [aSumar, setASumar] = useState('');

  const explicar = useCallback((e) => mensajeDeError(e, t, 'equipo_paciente'), [t]);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    setErrorFila(null);

    try {
      const guardias = await cargarGuardiasDePacientes(
        [paciente.id],
        'id, asistente_id, fecha, hora_inicio, hora_fin, dias_hasta_el_fin, estado'
      );

      const [vinculosSerie, configuracion, decisiones] = await Promise.all([
        supabase.from('series_guardias_pacientes').select('serie_id').eq('paciente_id', paciente.id),
        supabase
          .from('configuracion_equipo_paciente')
          .select('regla')
          .eq('prestadora_id', paciente.prestadora_id)
          .maybeSingle(),
        supabase.from('equipo_paciente').select('*').eq('paciente_id', paciente.id),
      ]);
      if (vinculosSerie.error) throw vinculosSerie.error;
      if (configuracion.error) throw configuracion.error;
      if (decisiones.error) throw decisiones.error;

      // La serie puede venir por la lista o por la columna vieja, igual que las guardias.
      const idsSerie = [...new Set((vinculosSerie.data ?? []).map((v) => v.serie_id).filter(Boolean))];
      const [porLista, porColumnaVieja] = await Promise.all([
        idsSerie.length
          ? supabase.from('series_guardias').select('id, asistente_id, estado, vigente_hasta').in('id', idsSerie)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('series_guardias')
          .select('id, asistente_id, estado, vigente_hasta')
          .eq('paciente_id', paciente.id),
      ]);
      if (porLista.error) throw porLista.error;
      if (porColumnaVieja.error) throw porColumnaVieja.error;
      const series = [
        ...new Map([...(porLista.data ?? []), ...(porColumnaVieja.data ?? [])].map((s) => [s.id, s])).values(),
      ];

      // Todas las guardias que volvieron tocan a este Paciente: se preguntó por él.
      const pacientesPorGuardia = new Map(guardias.map((g) => [g.id, [paciente.id]]));

      // Se arma dos veces a propósito, y es barato: la primera dice quiénes son las Asistentes,
      // de ahí salen las zonas, y recién con las zonas se sabe quién coordina a este Paciente.
      const armar = (coordinadoresQueAlcanzan) =>
        equipoDelPaciente({
          pacienteId: paciente.id,
          guardias,
          pacientesPorGuardia,
          series,
          decisiones: decisiones.data ?? [],
          regla: reglaDeEquipoDe(configuracion.data?.regla),
          coordinadoresQueAlcanzan,
        });
      const armado = armar([]);

      // Los nombres, y las zonas del equipo, que son las que dicen quién lo coordina.
      const idsAsistentes = [
        ...new Set([...armado.asistentes, ...armado.afuera].map((a) => a.asistente_id)),
      ];
      const [fichas, todas] = await Promise.all([
        idsAsistentes.length
          ? supabase.from('asistentes').select('id, nombre, apellido, zonas').in('id', idsAsistentes)
          : Promise.resolve({ data: [], error: null }),
        // Para el desplegable de «sumar a alguien». La vista recorta lo que un Coordinador puede
        // ver de una Asistente; acá alcanza con el nombre.
        supabase.from('asistentes').select('id, nombre, apellido').order('apellido'),
      ]);
      if (fichas.error) throw fichas.error;
      if (todas.error) throw todas.error;
      const porId = new Map((fichas.data ?? []).map((a) => [a.id, a]));

      const zonasDelEquipo = [
        ...new Set(armado.asistentes.flatMap((a) => porId.get(a.asistente_id)?.zonas ?? [])),
      ];
      const alcanzan = zonasDelEquipo.length
        ? await supabase
            .from('usuarios')
            .select('id, nombre, apellido, rol')
            .eq('rol', 'coordinador')
            .overlaps('zonas', zonasDelEquipo)
        : { data: [], error: null };
      if (alcanzan.error) throw alcanzan.error;

      const conCoordinadores = armar((alcanzan.data ?? []).map((u) => u.id));

      const nombresDeUsuario = new Map(
        [...(alcanzan.data ?? [])].map((u) => [u.id, `${u.apellido ?? ''} ${u.nombre ?? ''}`.trim()])
      );

      setDatos({
        ...conCoordinadores,
        nombreDeAsistente: (id) => {
          const ficha = porId.get(id) ?? (todas.data ?? []).find((a) => a.id === id);
          return ficha ? `${ficha.apellido ?? ''} ${ficha.nombre ?? ''}`.trim() : id;
        },
        nombreDeUsuario: (id) => nombresDeUsuario.get(id) || id,
      });

      const yaEstan = new Set([
        ...conCoordinadores.asistentes.map((a) => a.asistente_id),
        ...conCoordinadores.afuera.map((a) => a.asistente_id),
      ]);
      setCandidatas((todas.data ?? []).filter((a) => !yaEstan.has(a.id)));
      setEstado('listo');
    } catch (e) {
      setError(explicar(e));
      setEstado('error');
    }
  }, [paciente.id, paciente.prestadora_id, explicar]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  /** Deja escrita una decisión sobre una persona. Reemplaza la anterior, no se apila. */
  async function decidir(fila, cambios) {
    setEnCurso(fila.asistente_id ?? fila.usuario_id);
    setErrorFila(null);
    const { error: errorUpsert } = await supabase.from('equipo_paciente').upsert(
      {
        prestadora_id: paciente.prestadora_id,
        paciente_id: paciente.id,
        asistente_id: fila.asistente_id ?? null,
        usuario_id: fila.usuario_id ?? null,
        situacion: 'sumada',
        ...cambios,
      },
      { onConflict: fila.asistente_id ? 'paciente_id,asistente_id' : 'paciente_id,usuario_id' }
    );
    setEnCurso(null);
    if (errorUpsert) {
      setErrorFila(explicar(errorUpsert));
      return;
    }
    recargar();
  }

  /** Saca la corrección y deja que el sistema vuelva a deducir sola a esa persona. */
  async function volverADeducir(fila) {
    setEnCurso(fila.asistente_id ?? fila.usuario_id);
    setErrorFila(null);
    let consulta = supabase.from('equipo_paciente').delete().eq('paciente_id', paciente.id);
    consulta = fila.asistente_id
      ? consulta.eq('asistente_id', fila.asistente_id)
      : consulta.eq('usuario_id', fila.usuario_id);
    const { error: errorDelete } = await consulta;
    setEnCurso(null);
    if (errorDelete) {
      setErrorFila(explicar(errorDelete));
      return;
    }
    recargar();
  }

  async function sacar(fila) {
    if (!(await confirmarDestructivo(t.equipo_paciente.confirmar_sacar))) return;
    decidir(fila, { situacion: 'sacada', cubre_francos: false });
  }

  const explicacionDeOrigen = useMemo(
    () => ({
      [ORIGEN.POR_SUS_TURNOS]: t.equipo_paciente.origen_por_sus_turnos,
      [ORIGEN.POR_SU_SERIE]: t.equipo_paciente.origen_por_su_serie,
      [ORIGEN.A_MANO]: t.equipo_paciente.origen_a_mano,
      [ORIGEN.POR_SU_ZONA]: t.equipo_paciente.origen_por_su_zona,
    }),
    [t]
  );

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>
          {t.equipo_paciente.titulo} — {paciente.nombre}
        </h2>
        <p className="panel-explicacion">{t.equipo_paciente.explicacion}</p>

        {estado === 'cargando' && <p className="estado-cargando">{t.comun.cargando}</p>}
        {estado === 'error' && <Alert variant="error">{error || t.comun.error_generico}</Alert>}

        {estado === 'listo' && datos && (
          <>
            {errorFila && <Alert variant="error">{errorFila}</Alert>}

            <h3>{t.equipo_paciente.asistentes_titulo}</h3>
            {datos.asistentes.length === 0 ? (
              <p className="estado-vacio">{t.equipo_paciente.sin_asistentes}</p>
            ) : (
              <table className="panel-tabla">
                <thead>
                  <tr>
                    <th>{t.equipo_paciente.col_persona}</th>
                    <th>{t.equipo_paciente.col_por_que}</th>
                    <th>{t.equipo_paciente.col_turnos}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {datos.asistentes.map((a) => (
                    <tr key={a.asistente_id}>
                      <td>
                        {datos.nombreDeAsistente(a.asistente_id)}
                        {a.cubre_francos && <> — {t.equipo_paciente.cubre_francos}</>}
                      </td>
                      <td>{explicacionDeOrigen[a.origen]}</td>
                      <td>{a.turnos}</td>
                      <td>
                        {puedeEditar && (
                          <>
                            <Button
                              variant="secondary"
                              disabled={enCurso === a.asistente_id}
                              onClick={() => decidir(a, { cubre_francos: !a.cubre_francos })}
                            >
                              {a.cubre_francos
                                ? t.equipo_paciente.no_cubre_francos
                                : t.equipo_paciente.marcar_cubre_francos}
                            </Button>{' '}
                            <Button
                              variant="secondary"
                              disabled={enCurso === a.asistente_id}
                              onClick={() => sacar(a)}
                            >
                              {t.equipo_paciente.sacar}
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {puedeEditar && candidatas.length > 0 && (
              <p>
                <label htmlFor="equipo-sumar">{t.equipo_paciente.sumar}</label>{' '}
                <select id="equipo-sumar" value={aSumar} onChange={(e) => setASumar(e.target.value)}>
                  <option value="">—</option>
                  {candidatas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {`${a.apellido ?? ''} ${a.nombre ?? ''}`.trim()}
                    </option>
                  ))}
                </select>{' '}
                <Button
                  variant="secondary"
                  disabled={!aSumar || enCurso === aSumar}
                  onClick={() => {
                    const id = aSumar;
                    setASumar('');
                    decidir({ asistente_id: id }, { situacion: 'sumada' });
                  }}
                >
                  {t.equipo_paciente.agregar}
                </Button>
              </p>
            )}

            <h3>{t.equipo_paciente.coordinacion_titulo}</h3>
            <p className="panel-explicacion">{t.equipo_paciente.coordinacion_explicacion}</p>
            {datos.coordinadores.length === 0 ? (
              <p className="estado-vacio">{t.equipo_paciente.sin_coordinacion}</p>
            ) : (
              <ul>
                {datos.coordinadores.map((c) => (
                  <li key={c.usuario_id}>
                    {datos.nombreDeUsuario(c.usuario_id)} — {explicacionDeOrigen[c.origen]}
                    {puedeEditar && c.decidido && (
                      <>
                        {' '}
                        <Button
                          variant="secondary"
                          disabled={enCurso === c.usuario_id}
                          onClick={() => volverADeducir(c)}
                        >
                          {t.equipo_paciente.volver_a_deducir}
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {datos.afuera.length > 0 && (
              <>
                <h3>{t.equipo_paciente.afuera_titulo}</h3>
                <p className="panel-explicacion">{t.equipo_paciente.afuera_explicacion}</p>
                <ul>
                  {datos.afuera.map((a) => (
                    <li key={a.asistente_id}>
                      {datos.nombreDeAsistente(a.asistente_id)}
                      {puedeEditar && (
                        <>
                          {' '}
                          <Button
                            variant="secondary"
                            disabled={enCurso === a.asistente_id}
                            onClick={() => volverADeducir(a)}
                          >
                            {t.equipo_paciente.volver_a_deducir}
                          </Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        <Button variant="secondary" onClick={onClose}>
          {t.comun.cerrar}
        </Button>
      </div>
    </div>
  );
}

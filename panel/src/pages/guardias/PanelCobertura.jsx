import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { con } from '../../lib/textos';
import { candidatosParaGuardia } from '../../lib/candidatos';
import { avisosDeAsignacion } from '../../lib/avisosAsignacion';
import { COLUMNAS_ESTADO_MATRICULA, mensajeDeBloqueo } from '../../lib/matricula';

/* El panel lateral para cubrir una vacante.
   ==========================================================================

   QUÉ RESUELVE. Hoy, tapar un hueco es un recorrido: se abre la guardia, se sale a otra
   pantalla a mirar quién está libre, se vuelve, se elige a alguien del desplegable y se
   guarda. Cada paso pierde de vista al anterior. Este panel pone las tres cosas —el hueco,
   quién puede tomarlo y por qué— una al lado de la otra, sin salir de la grilla.

   LA DECISIÓN DE FONDO: EL PUNTAJE NO DECIDE. Los Asistentes vienen ordenados por un
   puntaje, pero lo que se muestra son LOS MOTIVOS, a favor y en contra, con el mismo peso
   visual. Quien coordina sabe cosas que el sistema no sabe —que esa familia no quiere que
   vuelva tal persona, que aquella está con un tema personal—, así que el sistema propone
   un orden y explica su razonamiento; elegir sigue siendo de la Coordinadora. Un panel que
   dijera "asignale a este" y escondiera el porqué sería más rápido y peor.

   POR QUÉ HAY DOS CAMINOS. "Asignársela" es para cuando ya se sabe a quién: se le pone y
   listo. "Invitar a varios" es para cuando no: se les pregunta a cuatro a la vez, con un
   plazo, y el primero que acepta se la queda. El segundo camino no existía —antes una
   guardia se podía publicar, pero sin saber a quién se le había ofrecido ni hasta cuándo—
   y es la razón de ser de la tabla `ofertas_guardia`.

   LOS CUATRO ESTADOS (CLAUDE.md §7 regla 3) se manejan acá adentro, porque este panel
   carga datos propios que ninguna otra pantalla necesita: las matriculas, los papeles y
   las invitaciones ya hechas. Cargarlos en la pantalla de arriba obligaría a traerlos
   siempre, aunque nadie abra el panel. */

/** Cuánto se mira hacia atrás y hacia adelante para saber si un Asistente está ocupado. */
const DIAS_DE_CONTEXTO = 14;

export function PanelCobertura({ guardia, asistentes, onCerrar, onHecho }) {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const tp = t.guardias.cobertura_panel;
  const ta = t.guardias.avisos;
  const tm = t.matricula;

  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [datos, setDatos] = useState(null);
  const [elegidos, setElegidos] = useState(() => new Set());
  const [limite, setLimite] = useState('');
  const [enCurso, setEnCurso] = useState(null); // 'asignar:<id>' | 'invitar' | 'retirar:<id>'
  const [porConfirmar, setPorConfirmar] = useState(null); // { asistenteId, avisos }
  const contenedor = useRef(null);

  const nombrePorAsistente = useMemo(
    () => Object.fromEntries((asistentes ?? []).map((a) => [a.id, a.nombre])),
    [asistentes]
  );

  /* La base tiene la última palabra sobre la Matrícula: aunque esta pantalla ya deje afuera a
     quien no puede, hay caminos por los que el bloqueo aparece igual —dos personas trabajando
     a la vez, o una Matrícula que se venció con el panel abierto—. Cuando eso pasa, el mensaje
     crudo de la base no se muestra nunca: se traduce al motivo y a qué hacer al respecto. */
  const mostrarFalla = useCallback(
    (falla) => setError(mensajeDeBloqueo(falla, tm) ?? falla.message),
    [tm]
  );

  const cargar = useCallback(async () => {
    if (!guardia) return;
    setEstado('cargando');
    setError(null);

    // El rango de contexto es sobre la fecha de la guardia, no sobre hoy: si se está
    // cubriendo un hueco del mes que viene, lo que importa es quién está ocupado ESE mes.
    const desde = new Date(`${guardia.fecha}T00:00:00`);
    desde.setDate(desde.getDate() - DIAS_DE_CONTEXTO);
    const hasta = new Date(`${guardia.fecha}T00:00:00`);
    hasta.setDate(hasta.getDate() + DIAS_DE_CONTEXTO);
    const iso = (d) => d.toISOString().slice(0, 10);

    const [gs, hs, ds, os, em] = await Promise.all([
      supabase
        .from('guardias')
        .select('id, asistente_id, paciente_id, fecha, hora_inicio, hora_fin, estado')
        .gte('fecha', iso(desde))
        .lte('fecha', iso(hasta)),
      supabase.from('matriculas_asistente').select('*'),
      supabase.from('documentos_asistente').select('*'),
      supabase.from('ofertas_guardia').select('*').eq('guardia_id', guardia.id),
      // Quién necesita Matrícula, cuál, y si esta Prestadora exige que alguien la haya
      // comprobado. Viene ya resuelto de la base —no se decide acá— para que la pantalla diga
      // exactamente lo mismo que después van a hacer cumplir los disparadores al guardar.
      supabase.from('estado_matricula_asistente').select(COLUMNAS_ESTADO_MATRICULA),
    ]);

    const fallo = gs.error || hs.error || ds.error || os.error || em.error;
    if (fallo) {
      setError(fallo.message);
      setEstado('error');
      return;
    }

    setDatos({
      asistentes: asistentes ?? [],
      guardias: gs.data ?? [],
      matriculas: hs.data ?? [],
      documentos: ds.data ?? [],
      ofertas: os.data ?? [],
      estadoMatricula: em.data ?? [],
      ahora: new Date(),
    });
    setEstado('listo');
  }, [guardia, asistentes]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Salir con Escape. Es lo que hace cualquier panel que tape parte de la pantalla, y quien
  // trabaja todo el día con el teclado lo va a intentar antes que buscar la cruz.
  useEffect(() => {
    function alTeclado(e) {
      if (e.key === 'Escape') onCerrar();
    }
    document.addEventListener('keydown', alTeclado);
    return () => document.removeEventListener('keydown', alTeclado);
  }, [onCerrar]);

  // El foco entra al panel al abrirse; si no, seguiría en el chip de atrás y quien usa
  // lector de pantalla no se enteraría de que se abrió algo.
  useEffect(() => {
    contenedor.current?.focus();
  }, []);

  const candidatos = useMemo(() => {
    if (!datos || !guardia) return [];
    return candidatosParaGuardia(guardia, datos);
  }, [datos, guardia]);

  const ofertas = datos?.ofertas ?? [];

  function alternarElegido(id) {
    setElegidos((previos) => {
      const nuevos = new Set(previos);
      if (nuevos.has(id)) nuevos.delete(id);
      else nuevos.add(id);
      return nuevos;
    });
  }

  /* Un paso antes de escribir: ¿hay algo que convenga mirar?
     Si no hay nada, se asigna y listo —no se le pone una pregunta de más a quien está tapando
     un hueco con el reloj en contra. Si hay algo, se muestra y se pregunta. El aviso nunca
     impide asignar: la Coordinadora sabe cosas que la base no sabe. */
  function pedirAsignar(asistenteId) {
    const avisos = avisosDeAsignacion(guardia, asistenteId, datos ?? {});
    if (avisos.length === 0) {
      asignarDirecto(asistenteId);
      return;
    }
    setPorConfirmar({ asistenteId, avisos });
  }

  async function asignarDirecto(asistenteId) {
    setPorConfirmar(null);
    setEnCurso(`asignar:${asistenteId}`);
    setError(null);
    // Al asignar, la guardia deja de estar ofrecida. No es prolijidad: la base tiene una
    // restricción que impide que una guardia con Asistente siga publicada, así que sin
    // limpiar estas tres columnas la operación entera falla.
    const { error: falla } = await supabase
      .from('guardias')
      .update({
        asistente_id: asistenteId,
        ofrecida_at: null,
        ofrecida_por: null,
        oferta_limite_at: null,
      })
      .eq('id', guardia.id);
    setEnCurso(null);
    if (falla) {
      mostrarFalla(falla);
      return;
    }
    onHecho?.();
  }

  async function invitar() {
    if (elegidos.size === 0) return;
    setEnCurso('invitar');
    setError(null);

    const ahoraISO = new Date().toISOString();
    const filas = Array.from(elegidos).map((asistenteId) => ({
      prestadora_id: usuario.prestadora_id,
      guardia_id: guardia.id,
      asistente_id: asistenteId,
      invitado_por: usuario.id,
    }));

    // Las dos escrituras van juntas y en este orden: primero la guardia queda publicada con
    // su plazo, después las invitaciones. Al revés, una invitación podría existir para una
    // guardia que todavía no figura como ofrecida.
    const { error: fallaGuardia } = await supabase
      .from('guardias')
      .update({
        ofrecida_at: ahoraISO,
        ofrecida_por: usuario.id,
        oferta_limite_at: limite ? new Date(limite).toISOString() : null,
      })
      .eq('id', guardia.id);

    if (fallaGuardia) {
      setEnCurso(null);
      mostrarFalla(fallaGuardia);
      return;
    }

    const { error: fallaOfertas } = await supabase.from('ofertas_guardia').insert(filas);
    setEnCurso(null);
    if (fallaOfertas) {
      mostrarFalla(fallaOfertas);
      return;
    }
    setElegidos(new Set());
    onHecho?.();
    cargar();
  }

  async function retirarInvitacion(ofertaId) {
    setEnCurso(`retirar:${ofertaId}`);
    setError(null);
    const { error: falla } = await supabase.from('ofertas_guardia').delete().eq('id', ofertaId);
    setEnCurso(null);
    if (falla) {
      mostrarFalla(falla);
      return;
    }
    cargar();
  }

  if (!guardia) return null;

  const subtitulo = con(tp.subtitulo, {
    paciente: guardia.paciente_nombre ?? '—',
    fecha: guardia.fecha,
    desde: guardia.hora_inicio,
    hasta: guardia.hora_fin,
  });

  return (
    <>
      <div className="panel-lateral-fondo" onClick={onCerrar} />
      <aside
        className="panel-lateral"
        role="dialog"
        aria-modal="true"
        aria-label={tp.titulo}
        tabIndex={-1}
        ref={contenedor}
      >
        <header className="panel-lateral-header">
          <div>
            <h2>{tp.titulo}</h2>
            <p className="panel-lateral-subtitulo">{subtitulo}</p>
          </div>
          <Button variant="secondary" onClick={onCerrar}>
            {t.comun.cerrar}
          </Button>
        </header>

        <div className="panel-lateral-cuerpo">
          {error && <Alert variant="error">{error}</Alert>}

          {estado === 'cargando' && <p className="estado-cargando">{t.comun.cargando}</p>}

          {estado === 'error' && !error && (
            <Alert variant="error">
              {t.comun.error_generico}{' '}
              <Button variant="secondary" onClick={cargar}>
                {t.comun.reintentar}
              </Button>
            </Alert>
          )}

          {estado === 'listo' && (
            <>
              {ofertas.length > 0 && (
                <section>
                  <h3>{tp.invitados_titulo}</h3>
                  {guardia.oferta_limite_at && (
                    <p className="panel-lateral-subtitulo">
                      {con(
                        new Date(guardia.oferta_limite_at) < new Date()
                          ? tp.limite_vencido
                          : tp.limite_vence,
                        { fecha: new Date(guardia.oferta_limite_at).toLocaleString() }
                      )}
                    </p>
                  )}
                  {ofertas.map((o) => (
                    <div key={o.id} className="invitado-fila">
                      <span>{nombrePorAsistente[o.asistente_id] ?? '—'}</span>
                      <span>
                        {o.respuesta === 'acepta'
                          ? tp.invitado_acepta
                          : o.respuesta === 'rechaza'
                            ? tp.invitado_rechaza
                            : tp.invitado_sin_respuesta}
                      </span>
                      <Button
                        variant="secondary"
                        disabled={enCurso !== null}
                        onClick={() => retirarInvitacion(o.id)}
                      >
                        {tp.retirar_invitacion}
                      </Button>
                    </div>
                  ))}
                </section>
              )}

              <section>
                <h3>{tp.candidatos_titulo}</h3>
                <p className="panel-lateral-subtitulo">{tp.candidatos_ayuda}</p>

                {candidatos.length === 0 ? (
                  <p className="estado-vacio">{tp.sin_candidatos}</p>
                ) : (
                  candidatos.map((c) => (
                    <div
                      key={c.asistente.id}
                      className={`candidato${elegidos.has(c.asistente.id) ? ' candidato-elegido' : ''}`}
                    >
                      <div className="candidato-cabecera">
                        <label className="candidato-nombre">
                          <input
                            type="checkbox"
                            checked={elegidos.has(c.asistente.id)}
                            disabled={c.bloqueado || c.yaInvitado || enCurso !== null}
                            onChange={() => alternarElegido(c.asistente.id)}
                          />
                          {c.asistente.nombre}
                        </label>
                        <span className="candidato-puntaje">{c.puntaje}</span>
                        <Button
                          disabled={c.bloqueado || enCurso !== null}
                          onClick={() => pedirAsignar(c.asistente.id)}
                        >
                          {enCurso === `asignar:${c.asistente.id}`
                            ? tp.asignando
                            : tp.asignar_directo}
                        </Button>
                      </div>

                      {/* Los avisos se abren DENTRO de la fila de la persona y no en una ventana
                          aparte: así se sigue viendo de quién se está hablando y los motivos que
                          se acaban de leer no desaparecen de la pantalla al preguntar. */}
                      {porConfirmar?.asistenteId === c.asistente.id && (
                        <div className="avisos-asignacion" role="alert">
                          <span className="avisos-asignacion-titulo">{ta.titulo}</span>
                          <ul>
                            {porConfirmar.avisos.map((a, i) => (
                              <li key={`a${i}`}>{con(ta[a.clave], a.valores)}</li>
                            ))}
                          </ul>
                          <p>{ta.ayuda}</p>
                          <div className="avisos-asignacion-botones">
                            <Button
                              disabled={enCurso !== null}
                              onClick={() => asignarDirecto(c.asistente.id)}
                            >
                              {ta.asignar_igual}
                            </Button>
                            <Button variant="secondary" onClick={() => setPorConfirmar(null)}>
                              {ta.volver}
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="candidato-motivos">
                        {c.aFavor.length > 0 && (
                          <ul>
                            {c.aFavor.map((m, i) => (
                              <li key={`f${i}`} className="motivo-a-favor">
                                {con(tp[m.clave], m.valores)}
                              </li>
                            ))}
                          </ul>
                        )}
                        {c.enContra.length > 0 && (
                          <ul>
                            {c.enContra.map((m, i) => (
                              <li key={`c${i}`} className="motivo-en-contra">
                                {con(tp[m.clave], m.valores)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </section>

              <section>
                <h3>{tp.invitar_titulo}</h3>
                <p className="panel-lateral-subtitulo">{tp.invitar_ayuda}</p>
                <label>
                  {tp.invitar_limite}
                  <input
                    type="datetime-local"
                    value={limite}
                    onChange={(e) => setLimite(e.target.value)}
                    disabled={enCurso !== null}
                  />
                </label>
                {elegidos.size === 0 && (
                  <p className="estado-vacio">{tp.invitar_sin_elegidos}</p>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="panel-lateral-pie">
          <Button
            disabled={elegidos.size === 0 || enCurso !== null || estado !== 'listo'}
            onClick={invitar}
          >
            {enCurso === 'invitar' ? tp.invitando : con(tp.invitar_boton, { n: elegidos.size })}
          </Button>
        </footer>
      </aside>
    </>
  );
}

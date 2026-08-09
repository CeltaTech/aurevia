import { useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';

const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DIAS_GENERACION_SIN_VIGENCIA_HASTA_DEFAULT = 90;

export function NuevaGuardiaModal({ onClose, onCreada }) {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const [esSerie, setEsSerie] = useState(false);
  const [asistentes, setAsistentes] = useState([]);
  const [pacientes, setPacientes] = useState([]);
  const [diasGeneracion, setDiasGeneracion] = useState(DIAS_GENERACION_SIN_VIGENCIA_HASTA_DEFAULT);
  const [asistenteId, setAsistenteId] = useState('');
  // A quiénes atiende el turno. Es una lista y no un valor suelto porque una guardia puede
  // cubrir a más de una persona: un matrimonio en su casa, o un grupo en un asilo.
  const [pacienteIds, setPacienteIds] = useState([]);
  const [modalidad, setModalidad] = useState('');
  const [horaInicio, setHoraInicio] = useState('');
  const [horaFin, setHoraFin] = useState('');
  const [fecha, setFecha] = useState('');
  const [diasSemana, setDiasSemana] = useState([]);
  const [vigenteDesde, setVigenteDesde] = useState('');
  const [vigenteHasta, setVigenteHasta] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function cargarListas() {
      const [{ data: asistentesData }, { data: pacientesData }, { data: prestadoraData }] = await Promise.all([
        supabase.from('asistentes').select('id, nombre').eq('estado', 'activo').order('nombre'),
        // Se pide también el domicilio: cuando dos personas viven en la misma casa, verlo al
        // lado del nombre es lo que hace evidente que ese turno los cubre a los dos.
        supabase.from('pacientes').select('id, nombre, domicilio').is('deleted_at', null).order('nombre'),
        supabase.from('prestadoras').select('dias_generacion_series_guardia').eq('id', usuario.prestadora_id).single(),
      ]);
      setAsistentes(asistentesData ?? []);
      setPacientes(pacientesData ?? []);
      if (prestadoraData?.dias_generacion_series_guardia) {
        setDiasGeneracion(prestadoraData.dias_generacion_series_guardia);
      }
    }
    cargarListas();
  }, [usuario.prestadora_id]);

  function togglePaciente(id) {
    setPacienteIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function toggleDia(dia) {
    setDiasSemana((prev) => (prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]));
  }

  function generarFechasSerie(desde, hasta, dias) {
    const diaIndices = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
    const indicesElegidos = dias.map((d) => diaIndices[d]);
    const fechaInicio = new Date(`${desde}T00:00:00`);
    const fechaFin = hasta
      ? new Date(`${hasta}T00:00:00`)
      : new Date(fechaInicio.getTime() + diasGeneracion * 24 * 60 * 60 * 1000);
    const fechas = [];
    for (let f = fechaInicio; f <= fechaFin; f = new Date(f.getTime() + 24 * 60 * 60 * 1000)) {
      if (indicesElegidos.includes(f.getDay())) {
        fechas.push(f.toISOString().slice(0, 10));
      }
    }
    return fechas;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (pacienteIds.length === 0) {
      setError(t.guardias.nueva_guardia.error_sin_pacientes);
      return;
    }

    if (esSerie && diasSemana.length === 0) {
      setError(t.guardias.nueva_guardia.error_dias_semana);
      return;
    }

    setGuardando(true);

    // La columna `paciente_id` está en retiro pero todavía la leen muchas pantallas, así que
    // se le escribe el primero de la lista. Un disparador de la base se encarga de que ese
    // Paciente quede también en `guardia_pacientes`; acá se agregan los demás.
    // Ver la migración 20260807190000_una_guardia_puede_cubrir_varios_pacientes.sql.
    const [primero, ...resto] = pacienteIds;

    if (!esSerie) {
      const { data: guardia, error: errorInsert } = await supabase
        .from('guardias')
        .insert({
          prestadora_id: usuario.prestadora_id,
          asistente_id: asistenteId || null,
          paciente_id: primero,
          fecha,
          hora_inicio: horaInicio,
          hora_fin: horaFin,
          modalidad,
        })
        .select('id')
        .single();

      if (errorInsert) {
        setGuardando(false);
        setError(mensajeDeError(errorInsert, t));
        return;
      }

      if (resto.length > 0) {
        const { error: errorPacientes } = await supabase.from('guardia_pacientes').insert(
          resto.map((id) => ({
            guardia_id: guardia.id,
            paciente_id: id,
            prestadora_id: usuario.prestadora_id,
          })),
        );
        if (errorPacientes) {
          setGuardando(false);
          setError(mensajeDeError(errorPacientes, t));
          return;
        }
      }

      setGuardando(false);
      onCreada();
      return;
    }

    const { data: serie, error: errorSerie } = await supabase
      .from('series_guardias')
      .insert({
        prestadora_id: usuario.prestadora_id,
        asistente_id: asistenteId || null,
        paciente_id: primero,
        dias_semana: diasSemana,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        modalidad,
        vigente_desde: vigenteDesde,
        vigente_hasta: vigenteHasta || null,
      })
      .select()
      .single();

    if (errorSerie) {
      setGuardando(false);
      setError(mensajeDeError(errorSerie, t));
      return;
    }

    if (resto.length > 0) {
      const { error: errorPacientesSerie } = await supabase.from('series_guardias_pacientes').insert(
        resto.map((id) => ({
          serie_id: serie.id,
          paciente_id: id,
          prestadora_id: usuario.prestadora_id,
        })),
      );
      if (errorPacientesSerie) {
        setGuardando(false);
        setError(mensajeDeError(errorPacientesSerie, t));
        return;
      }
    }

    const fechas = generarFechasSerie(vigenteDesde, vigenteHasta, diasSemana);
    const filasGuardias = fechas.map((f) => ({
      prestadora_id: usuario.prestadora_id,
      serie_id: serie.id,
      asistente_id: asistenteId || null,
      paciente_id: primero,
      fecha: f,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      modalidad,
    }));

    const { data: guardiasCreadas, error: errorGuardias } = await supabase
      .from('guardias')
      .insert(filasGuardias)
      .select('id');

    if (errorGuardias) {
      setGuardando(false);
      setError(mensajeDeError(errorGuardias, t));
      return;
    }

    // Cada fecha de la serie es una guardia distinta, y cada una lleva su propia lista de a
    // quiénes atiende. No alcanza con cargarla una vez en la serie.
    if (resto.length > 0 && guardiasCreadas?.length > 0) {
      const filasPacientes = guardiasCreadas.flatMap((g) =>
        resto.map((id) => ({
          guardia_id: g.id,
          paciente_id: id,
          prestadora_id: usuario.prestadora_id,
        })),
      );
      const { error: errorPacientesGuardias } = await supabase
        .from('guardia_pacientes')
        .insert(filasPacientes);
      if (errorPacientesGuardias) {
        setGuardando(false);
        setError(mensajeDeError(errorPacientesGuardias, t));
        return;
      }
    }

    setGuardando(false);
    onCreada();
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.guardias.nueva_guardia.titulo}</h2>

        {error && <Alert variant="error">{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <FormField
            label={t.guardias.nueva_guardia.es_serie}
            name="es_serie"
            type="checkbox"
            checked={esSerie}
            onChange={(e) => setEsSerie(e.target.checked)}
          />

          {/* El Asistente dejó de ser obligatorio: una guardia puede crearse sin nadie todavía.
              Es el caso más común de una Prestadora — se sabe que el martes hay que cubrir a
              este Paciente antes de saber quién lo va a hacer. */}
          <FormField
            label={t.guardias.nueva_guardia.asistente}
            name="asistente_id"
            type="select"
            value={asistenteId}
            onChange={(e) => setAsistenteId(e.target.value)}
          >
            <option value="">{t.guardias.nueva_guardia.sin_asistente}</option>
            {asistentes.map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </FormField>
          <p className="panel-explicacion">{t.guardias.nueva_guardia.sin_asistente_ayuda}</p>

          {/* Una lista de marcar y no un desplegable: el desplegable deja elegir uno solo, y
              acá el turno puede cubrir a varios. */}
          <div className="form-field">
            <label>
              {t.guardias.nueva_guardia.pacientes}
              <span className="required">*</span>
            </label>
            {pacientes.length === 0 ? (
              <p className="panel-explicacion">{t.guardias.nueva_guardia.pacientes_sin_ninguno}</p>
            ) : (
              <div className="panel-lista-pacientes">
                {pacientes.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={pacienteIds.includes(p.id)}
                      onChange={() => togglePaciente(p.id)}
                    />
                    <span>
                      {p.nombre}
                      {p.domicilio && <small>{p.domicilio}</small>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <p className="panel-explicacion">{t.guardias.nueva_guardia.pacientes_ayuda}</p>

          <FormField
            label={t.guardias.nueva_guardia.modalidad}
            name="modalidad"
            required
            placeholder={t.guardias.nueva_guardia.modalidad_placeholder}
            value={modalidad}
            onChange={(e) => setModalidad(e.target.value)}
          />

          <FormField
            label={t.guardias.nueva_guardia.hora_inicio}
            name="hora_inicio"
            type="time"
            required
            value={horaInicio}
            onChange={(e) => setHoraInicio(e.target.value)}
          />

          <FormField
            label={t.guardias.nueva_guardia.hora_fin}
            name="hora_fin"
            type="time"
            required
            value={horaFin}
            onChange={(e) => setHoraFin(e.target.value)}
          />

          {!esSerie && (
            <FormField
              label={t.guardias.nueva_guardia.fecha}
              name="fecha"
              type="date"
              required
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          )}

          {esSerie && (
            <>
              <div className="form-field">
                <label>{t.guardias.nueva_guardia.dias_semana}</label>
                <div className="panel-filtros">
                  {DIAS_SEMANA.map((dia) => (
                    <label key={dia} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <input type="checkbox" checked={diasSemana.includes(dia)} onChange={() => toggleDia(dia)} />
                      {t.guardias.nueva_guardia.dias[dia]}
                    </label>
                  ))}
                </div>
              </div>

              <FormField
                label={t.guardias.nueva_guardia.vigente_desde}
                name="vigente_desde"
                type="date"
                required
                value={vigenteDesde}
                onChange={(e) => setVigenteDesde(e.target.value)}
              />

              <FormField
                label={t.guardias.nueva_guardia.vigente_hasta}
                name="vigente_hasta"
                type="date"
                value={vigenteHasta}
                onChange={(e) => setVigenteHasta(e.target.value)}
              />
              <p className="panel-explicacion">{t.guardias.nueva_guardia.vigente_hasta_ayuda}</p>
            </>
          )}

          <div className="panel-modal-acciones">
            <Button variant="secondary" type="button" onClick={onClose} disabled={guardando}>
              {t.comun.cancelar}
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? t.guardias.nueva_guardia.creando : t.guardias.nueva_guardia.crear}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

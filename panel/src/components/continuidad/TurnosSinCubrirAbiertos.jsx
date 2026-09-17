import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { supabase } from '../../lib/supabaseClient';
import { EstadoLista } from '../layout/EstadoLista';
import { Button } from '../ui/Button';
import { FormField } from '../ui/FormField';
import { Alert } from '../ui/Alert';
import { cargarPacientesDeGuardias, conPacientes, pacientesDeGuardia } from '../../lib/pacientesDeGuardia';
import { diaDelMomento } from '../../lib/horarios';
import { con } from '../../lib/textos';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';
import {
  CIERRES_POSIBLES,
  esDefectoGrave,
  horasHastaElTurno,
} from '../../lib/incidenteTurnoSinCubrir';

/* LOS TURNOS QUE QUEDARON SIN NADIE, Y POR QUÉ NO SE VAN SOLOS DE ACÁ

   Un turno sin Asistente asignado produce un aviso, y el aviso se termina cuando se manda. Esta
   sección muestra la otra mitad: el turno queda abierto hasta que una persona diga cómo terminó.
   Quien abre y quien insiste es el motor; quien cierra a mano es quien coordina.

   EL FINAL QUE SE ELIGE NO ES UN TRÁMITE. Que el turno haya quedado en manos de la familia no es
   una variante de «cubierto»: es un defecto grave que no se pudo solucionar, y así queda escrito.
   Por eso ese final trae un cartel antes de guardarlo, y no se esconde detrás de una lista igual
   a las otras.

   LO QUE CIERRA SOLO NO APARECE ACÁ. Si apareció una Asistente asignada, o el turno se canceló,
   el motor lo cierra sin preguntar: eso ya está escrito en la base. Lo que nadie puede saber
   mirando la base es si alguien de la casa terminó cuidando. */

const TABLA = 'incidentes_turno_sin_cubrir';

export function TurnosSinCubrirAbiertos() {
  const { t } = useLocale();
  const [abiertos, setAbiertos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [cerrando, setCerrando] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { data, error: errorIncidentes } = await supabase
        .from(TABLA)
        .select('id, guardia_id, abierto_at, veces_recordado')
        .is('resuelto_at', null)
        .order('abierto_at', { ascending: true });
      if (errorIncidentes) throw errorIncidentes;

      const filas = data ?? [];
      const idsGuardias = [...new Set(filas.map((f) => f.guardia_id).filter(Boolean))];
      const { data: guardias, error: errorGuardias } = idsGuardias.length
        ? await supabase
            .from('guardias')
            .select('id, paciente_id, fecha, hora_inicio, hora_fin')
            .in('id', idsGuardias)
        : { data: [], error: null };
      if (errorGuardias) throw errorGuardias;

      const mapaPacientes = await cargarPacientesDeGuardias(idsGuardias);

      // Los nombres se piden aparte porque el vínculo guarda ids. Un Paciente cuyo nombre no
      // vuelva no se inventa: `conPacientes` lo deja en nulo y acá se dibuja un guión.
      const idsPacientes = [
        ...new Set((guardias ?? []).flatMap((g) => pacientesDeGuardia(g, mapaPacientes))),
      ];
      const { data: nombres, error: errorPacientes } = idsPacientes.length
        ? await supabase.from('pacientes').select('id, nombre').in('id', idsPacientes)
        : { data: [], error: null };
      if (errorPacientes) throw errorPacientes;
      const nombresPorId = Object.fromEntries((nombres ?? []).map((p) => [p.id, p.nombre]));

      // Un turno puede atender a más de un Paciente; se nombran todos.
      const porId = new Map(
        conPacientes(guardias ?? [], mapaPacientes, nombresPorId).map((g) => [g.id, g])
      );

      setAbiertos(
        filas.map((f) => {
          const guardia = porId.get(f.guardia_id) ?? null;
          return {
            ...f,
            guardia,
            pacientes: guardia?.pacientes ?? [],
            horas: guardia ? horasHastaElTurno(guardia) : null,
          };
        })
      );
      setEstado('listo');
    } catch (e) {
      setError(mensajeDeError(e, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => { recargar(); }, [recargar]);

  return (
    <>
      <h2>{t.continuidad.turnos_vacios_titulo}</h2>
      <p className="panel-explicacion">{t.continuidad.turnos_vacios_explicacion}</p>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && abiertos.length === 0}
        recargar={recargar}
        mensajeVacio={t.continuidad.turnos_vacios_vacio}
      >
        {abiertos.map((i) => (
          <div key={i.id} className="panel-guardia-card guardia-ausente">
            <div>
              <strong>
                {i.guardia ? `${i.guardia.fecha} · ${i.guardia.hora_inicio} – ${i.guardia.hora_fin}` : '—'}
              </strong>
              <div>
                {t.continuidad.col_paciente}:{' '}
                {i.pacientes.map((p) => p.nombre).filter(Boolean).join(', ') || '—'}
              </div>
              {/* Cuánto falta, o cuánto hace que tenía que haber empezado. Son la misma cuenta y
                  se dicen distinto a propósito: una pide apurarse, la otra ya es una falla. */}
              {i.horas !== null && (
                <div className="panel-guardia-alerta">
                  {i.horas >= 0
                    ? con(t.continuidad.turnos_vacios_empieza_en, { n: Math.round(i.horas) })
                    : con(t.continuidad.turnos_vacios_empezo_hace, { n: Math.round(-i.horas) })}
                </div>
              )}
              <div>
                {t.continuidad.turnos_vacios_abierto_desde}: {diaDelMomento(i.abierto_at) || '—'}
              </div>
              <div>
                {con(t.continuidad.turnos_vacios_recordatorios, { n: i.veces_recordado ?? 0 })}
              </div>
            </div>
            <div className="panel-modal-acciones">
              <Button onClick={() => setCerrando(i)}>{t.continuidad.turnos_vacios_cerrar}</Button>
            </div>
          </div>
        ))}
      </EstadoLista>

      {cerrando && (
        <CerrarTurnoVacio
          incidente={cerrando}
          onClose={() => setCerrando(null)}
          onCerrado={() => { setCerrando(null); recargar(); }}
        />
      )}
    </>
  );
}

function CerrarTurnoVacio({ incidente, onClose, onCerrado }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const { usuario } = useAuth();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [comoTermino, setComoTermino] = useState(CIERRES_POSIBLES[0]);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar() {
    if (!(await confirmarDestructivo(t.continuidad.turnos_vacios_confirmar_cerrar))) return;
    setGuardando(true);
    setError(null);
    try {
      const { error: errorUpdate } = await supabase
        .from(TABLA)
        .update({
          resuelto_at: new Date().toISOString(),
          resuelto_como: comoTermino,
          resuelto_por: usuario?.id ?? null,
          nota: nota.trim() || null,
        })
        .eq('id', incidente.id);
      if (errorUpdate) throw errorUpdate;
      onCerrado();
    } catch (e) {
      setError(mensajeDeError(e, t));
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h3 id={modal.idTitulo}>{t.continuidad.turnos_vacios_como_termino}</h3>

        <FormField
          label={t.continuidad.turnos_vacios_como_termino}
          name="como-termino"
          type="select"
          value={comoTermino}
          onChange={(e) => setComoTermino(e.target.value)}
        >
          {CIERRES_POSIBLES.map((cierre) => (
            <option key={cierre} value={cierre}>
              {t.continuidad[`turnos_vacios_cierre_${cierre}`]}
            </option>
          ))}
        </FormField>

        {/* El cartel sale antes de guardar, no después: quien lo cierra tiene que saber qué está
            dejando escrito mientras todavía puede elegir otra cosa. */}
        {esDefectoGrave(comoTermino) && (
          <Alert variant="error">{t.continuidad.turnos_vacios_defecto_grave}</Alert>
        )}

        <FormField
          label={t.continuidad.turnos_vacios_nota}
          name="nota-cierre"
          type="textarea"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />

        {error && <Alert variant="error">{error}</Alert>}

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            {t.comun.cancelar}
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {t.continuidad.turnos_vacios_guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

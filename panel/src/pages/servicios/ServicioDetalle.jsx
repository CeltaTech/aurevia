import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleContext';
import { traducirValor } from '../../i18n/valores';
import { supabase } from '../../lib/supabaseClient';
import { formatearImporte } from '../../lib/dinero';
import { claseBadge } from '../../lib/tonos';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { mensajeDeError } from '../../lib/errores';

// Cuántas guardias se traen a la ficha. Un Servicio de meses puede tener cientos, y esta
// pantalla no es la grilla de guardias: acá alcanza con las más próximas para entender de
// qué se trata el Servicio. Quien quiera verlas todas va a Guardias.
const GUARDIAS_A_MOSTRAR = 20;

export function ServicioDetalle() {
  const { t, locale } = useLocale();
  const { id } = useParams();
  const navigate = useNavigate();
  const [servicio, setServicio] = useState(null);
  const [prestaciones, setPrestaciones] = useState([]);
  const [guardias, setGuardias] = useState([]);
  const [nombresPaciente, setNombresPaciente] = useState({});
  const [nombresAsistente, setNombresAsistente] = useState({});
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);

    const { data: s, error: fallaServicio } = await supabase
      .from('servicios')
      .select('id, etiqueta, estado, created_at, familia_id, familias(id, solicitudes!familias_solicitud_id_fkey(nombre, telefono, email, localidad))')
      .eq('id', id)
      .single();

    if (fallaServicio) {
      // PGRST116 es "la consulta no devolvió ninguna fila": no es una falla, es que ese
      // Servicio no existe, y se avisa distinto.
      setError(fallaServicio.code === 'PGRST116' ? null : mensajeDeError(fallaServicio, t));
      setEstado(fallaServicio.code === 'PGRST116' ? 'no_encontrado' : 'error');
      return;
    }

    // Los nombres de Pacientes y Asistentes se traen en listas aparte y se cruzan por id,
    // como ya hace Estado actual: es una consulta más, pero evita depender de que PostgREST
    // adivine bien el vínculo cuando una tabla tiene varias claves hacia la misma.
    const [{ data: pr, error: fallaPrestaciones }, { data: gu, error: fallaGuardias }] = await Promise.all([
      supabase
        .from('prestaciones')
        .select('id, tipo_servicio, precio_final, moneda, estado, nota, paciente_id, created_at')
        .eq('servicio_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('guardias')
        .select('id, fecha, hora_inicio, hora_fin, estado, paciente_id, asistente_id')
        .eq('servicio_id', id)
        .order('fecha', { ascending: false })
        .limit(GUARDIAS_A_MOSTRAR),
    ]);

    if (fallaPrestaciones || fallaGuardias) {
      setError(mensajeDeError(fallaPrestaciones ?? fallaGuardias, t));
      setEstado('error');
      return;
    }

    const idsPaciente = [...new Set([...(pr ?? []), ...(gu ?? [])].map((r) => r.paciente_id).filter(Boolean))];
    const idsAsistente = [...new Set((gu ?? []).map((r) => r.asistente_id).filter(Boolean))];

    const [pacientes, asistentes] = await Promise.all([
      idsPaciente.length
        ? supabase.from('pacientes').select('id, nombre').in('id', idsPaciente)
        : Promise.resolve({ data: [] }),
      idsAsistente.length
        ? supabase.from('asistentes').select('id, nombre').in('id', idsAsistente)
        : Promise.resolve({ data: [] }),
    ]);

    setServicio(s);
    setPrestaciones(pr ?? []);
    setGuardias(gu ?? []);
    setNombresPaciente(Object.fromEntries((pacientes.data ?? []).map((p) => [p.id, p.nombre])));
    setNombresAsistente(Object.fromEntries((asistentes.data ?? []).map((a) => [a.id, a.nombre])));
    setEstado('listo');
  }, [id, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  // Los Pacientes del Servicio no son un dato guardado: se deducen de a quién le llegan sus
  // prestaciones y sus guardias. Es una de las señales de que hoy el Servicio está armado al
  // revés, colgando del Paciente en vez de al derecho (pendiente #125).
  const pacientesDelServicio = useMemo(() => {
    const ids = [...new Set([...prestaciones, ...guardias].map((r) => r.paciente_id).filter(Boolean))];
    return ids.map((idPaciente) => ({ id: idPaciente, nombre: nombresPaciente[idPaciente] || '—' }));
  }, [prestaciones, guardias, nombresPaciente]);

  if (estado === 'cargando') {
    return <p className="estado-cargando">{t.comun.cargando}</p>;
  }

  if (estado === 'no_encontrado') {
    return (
      <div>
        <Button variant="secondary" onClick={() => navigate('/servicios')}>
          {t.servicios.detalle.volver}
        </Button>
        <Alert variant="error">{t.servicios.detalle.no_encontrado}</Alert>
      </div>
    );
  }

  if (estado === 'error') {
    return (
      <div>
        <Button variant="secondary" onClick={() => navigate('/servicios')}>
          {t.servicios.detalle.volver}
        </Button>
        <Alert variant="error">
          {error || t.comun.error_generico}{' '}
          <Button variant="secondary" onClick={recargar}>{t.comun.reintentar}</Button>
        </Alert>
      </div>
    );
  }

  const contacto = servicio.familias?.solicitudes;

  return (
    <div>
      <Button variant="secondary" onClick={() => navigate('/servicios')}>
        {t.servicios.detalle.volver}
      </Button>

      <h1>{servicio.etiqueta || '—'}</h1>
      <p>
        <span className={claseBadge(servicio.estado)}>
          {traducirValor(t.servicios, `estado_${servicio.estado}`)}
        </span>{' '}
        <strong>{t.servicios.col_alta}:</strong> {new Date(servicio.created_at).toLocaleDateString()}
      </p>

      <Alert variant="info">
        <strong>{t.servicios.solo_lectura_titulo}.</strong> {t.servicios.solo_lectura_texto}
      </Alert>

      <section className="dashboard-seccion">
        <div className="dashboard-seccion-header">
          <h2 className="dashboard-seccion-titulo">{t.servicios.detalle.bloque_cliente}</h2>
        </div>
        <p><strong>{contacto?.nombre || '—'}</strong></p>
        <p>{contacto?.localidad || '—'}</p>
        <p>{contacto?.telefono || '—'} · {contacto?.email || '—'}</p>
        {servicio.familia_id && (
          <Button variant="secondary" onClick={() => navigate(`/familias/${servicio.familia_id}`)}>
            {t.servicios.detalle.cliente_ver_ficha}
          </Button>
        )}
      </section>

      <section className="dashboard-seccion">
        <div className="dashboard-seccion-header">
          <h2 className="dashboard-seccion-titulo">{t.servicios.detalle.bloque_pacientes}</h2>
        </div>
        {pacientesDelServicio.length === 0 ? (
          <p className="estado-vacio">{t.servicios.detalle.sin_pacientes}</p>
        ) : (
          <ul>
            {pacientesDelServicio.map((p) => (
              <li key={p.id}>{p.nombre}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="dashboard-seccion">
        <div className="dashboard-seccion-header">
          <h2 className="dashboard-seccion-titulo">{t.servicios.detalle.bloque_prestaciones}</h2>
        </div>
        {prestaciones.length === 0 ? (
          <p className="estado-vacio">{t.servicios.detalle.sin_prestaciones}</p>
        ) : (
          <table className="panel-tabla">
            <thead>
              <tr>
                <th>{t.servicios.detalle.col_que}</th>
                <th>{t.servicios.detalle.col_para_quien}</th>
                <th>{t.servicios.detalle.col_precio}</th>
                <th>{t.servicios.detalle.col_estado}</th>
                <th>{t.servicios.detalle.col_nota}</th>
              </tr>
            </thead>
            <tbody>
              {prestaciones.map((p) => (
                <tr key={p.id}>
                  <td>{p.tipo_servicio}</td>
                  <td>{nombresPaciente[p.paciente_id] || '—'}</td>
                  <td>{formatearImporte(p.precio_final, p.moneda, locale)}</td>
                  <td>
                    <span className={claseBadge(p.estado)}>
                      {traducirValor(t.servicios, `estado_${p.estado}`)}
                    </span>
                  </td>
                  <td>{p.nota || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="dashboard-seccion">
        <div className="dashboard-seccion-header">
          <h2 className="dashboard-seccion-titulo">{t.servicios.detalle.bloque_guardias}</h2>
          <p className="dashboard-seccion-subtitulo">
            {t.servicios.detalle.guardias_mostradas.replace('{n}', String(GUARDIAS_A_MOSTRAR))}
          </p>
        </div>
        {guardias.length === 0 ? (
          <p className="estado-vacio">{t.servicios.detalle.sin_guardias}</p>
        ) : (
          <table className="panel-tabla">
            <thead>
              <tr>
                <th>{t.servicios.detalle.col_fecha}</th>
                <th>{t.servicios.detalle.col_horario}</th>
                <th>{t.servicios.detalle.col_para_quien}</th>
                <th>{t.servicios.detalle.col_asistente}</th>
                <th>{t.servicios.detalle.col_estado}</th>
              </tr>
            </thead>
            <tbody>
              {guardias.map((g) => (
                <tr key={g.id}>
                  <td>{g.fecha}</td>
                  <td>{g.hora_inicio?.slice(0, 5)} – {g.hora_fin?.slice(0, 5)}</td>
                  <td>{nombresPaciente[g.paciente_id] || '—'}</td>
                  <td>
                    {g.asistente_id
                      ? nombresAsistente[g.asistente_id] || '—'
                      : t.servicios.detalle.sin_cubrir}
                  </td>
                  {/* El estado de la guardia se traduce con los textos de Guardias, no con
                      unos propios: es el mismo estado, y tener dos listas de nombres para lo
                      mismo termina con la misma guardia diciendo dos cosas distintas según
                      la pantalla (regla 12). */}
                  <td>
                    <span className={claseBadge(g.estado)}>
                      {traducirValor(t.guardias, `estado_${g.estado}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

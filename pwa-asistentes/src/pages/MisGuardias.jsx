import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { traducirValor } from '../i18n/valores';
import { listarCola } from '../lib/colaOffline';
import { suscribirseASincronizacion } from '../lib/sincronizarCola';
import AvisoConsentimientoPendiente from '../components/AvisoConsentimientoPendiente';

// Una guardia de un día anterior que sigue en curso es una guardia que nadie cerró. Antes no
// podía pasar, porque el cierre venía pegado al envío del reporte; desde que cerrar es un acto
// propio (tarea 66a) sí puede, así que la lista lo tiene que mostrar.
function quedoSinCerrar(guardia) {
  if (guardia.estado !== 'activa' || guardia.checkout_at) return false;
  const hoy = new Date();
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  return guardia.fecha < hoyISO;
}

export default function MisGuardias() {
  const { t } = useLocale();
  const [guardias, setGuardias] = useState(null);
  const [error, setError] = useState('');
  const [guardiasPendientes, setGuardiasPendientes] = useState(new Set());

  function revisarPendientes() {
    listarCola().then((cola) => setGuardiasPendientes(new Set(cola.map((item) => item.guardiaId))));
  }

  useEffect(() => {
    let activo = true;
    api
      .misGuardias()
      .then(({ guardias: data }) => {
        if (activo) setGuardias(data);
      })
      .catch(() => {
        if (activo) setError(t.comun.error_generico);
      });
    revisarPendientes();
    const desuscribir = suscribirseASincronizacion(revisarPendientes);
    return () => {
      activo = false;
      desuscribir();
    };
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (guardias === null) return <div className="estado-cargando">{t.comun.cargando}</div>;
  if (guardias.length === 0)
    return (
      <div>
        <AvisoConsentimientoPendiente />
        <div className="estado-vacio">{t.guardias.sin_guardias}</div>
      </div>
    );

  return (
    <div>
      <AvisoConsentimientoPendiente />
      <h1>{t.guardias.titulo}</h1>
      {guardias.map((g) => (
        <Link key={g.id} to={`/guardias/${g.id}`} className={`guardia-card guardia-${g.estado}`} style={{ display: 'block', textDecoration: 'none' }}>
          <div className="guardia-card-paciente">{g.pacientes?.nombre}</div>
          <div className="guardia-card-detalle">
            {g.fecha} · {g.hora_inicio?.slice(0, 5)} - {g.hora_fin?.slice(0, 5)}
          </div>
          <span className="badge">{traducirValor(t.guardias, `estado_${g.estado}`)}</span>
          {quedoSinCerrar(g) && <span className="badge badge-alerta">{t.guardias.sin_cerrar}</span>}
          {guardiasPendientes.has(g.id) && (
            <span className="badge badge-alerta">
              <span aria-hidden="true">⏳</span> {t.comun.pendiente_de_enviar}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

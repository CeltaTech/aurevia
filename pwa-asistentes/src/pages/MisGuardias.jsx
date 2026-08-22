import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { traducirValor } from '../i18n/valores';
import { listarCola } from '../lib/colaOffline';
import { suscribirseASincronizacion } from '../lib/sincronizarCola';
import { con } from '../lib/textos';
import { quedoSinCerrar } from '../lib/guardiaSinCerrar';
import AvisoConsentimientoPendiente from '../components/AvisoConsentimientoPendiente';
import { hayDomicilioTemporal } from '../components/DomicilioTemporal';

// En la tarjeta de una guardia no entran diez nombres, así que se muestran los dos primeros y
// se dice cuántos faltan. La lista completa está adentro, al abrir la guardia.
function nombresDeLaTarjeta(guardia, t) {
  const nombres = (guardia.pacientes ?? []).map((p) => p.nombre).filter(Boolean);
  if (nombres.length === 0) return t.guardias.sin_paciente;
  const visibles = nombres.slice(0, 2);
  const restantes = nombres.length - visibles.length;
  if (restantes > 0) visibles.push(con(t.guardias.y_mas, { n: restantes }));
  return visibles.join(' · ');
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

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (guardias === null) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;
  if (guardias.length === 0)
    return (
      <div>
        <AvisoConsentimientoPendiente />
        {/* El título va también cuando no hay ninguna guardia. Sin él, la pantalla vacía no
            tiene encabezado y quien la recorre con un lector de pantalla no sabe dónde
            está. */}
        <h1>{t.guardias.titulo}</h1>
        <div className="estado-vacio" role="status">{t.guardias.sin_guardias}</div>
      </div>
    );

  return (
    <div>
      <AvisoConsentimientoPendiente />
      <h1>{t.guardias.titulo}</h1>
      {guardias.map((g) => (
        <Link key={g.id} to={`/guardias/${g.id}`} className={`guardia-card guardia-${g.estado}`} style={{ display: 'block', textDecoration: 'none' }}>
          <div className="guardia-card-paciente">{nombresDeLaTarjeta(g, t)}</div>
          <div className="guardia-card-detalle">
            {g.fecha} · {g.hora_inicio?.slice(0, 5)} - {g.hora_fin?.slice(0, 5)}
          </div>
          <span className="badge">{traducirValor(t.guardias, `estado_${g.estado}`)}</span>
          {/* Esta tarjeta no muestra direcciones —alcanza con saber a quién y a qué hora—, pero
              sí tiene que avisar cuando la de ese día no es la de siempre: es lo que hace abrir
              la guardia antes de salir, en lugar de arrancar de memoria hacia la casa de
              siempre. La dirección y el motivo están adentro. */}
          {hayDomicilioTemporal(g.pacientes) && (
            <span className="badge badge-alerta">{t.domicilio.temporal}</span>
          )}
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

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { traducirValor } from '../i18n/valores';
import { listarCola } from '../lib/colaOffline';
import { motivoQueSeMuestra } from '../lib/reglasDeLaCola';
import { suscribirseASincronizacion } from '../lib/sincronizarCola';
import { con } from '../lib/textos';
import { mensajeDeError } from '../lib/errores';
import { quedoSinCerrar } from '../lib/guardiaSinCerrar';
import AvisoConsentimientoPendiente from '../components/AvisoConsentimientoPendiente';
import { hayDomicilioTemporal } from '../components/DomicilioTemporal';

// LA PANTALLA DE INICIO PIDE SUS DATOS POR ZONAS SEPARADAS, y cada zona tiene sus cuatro estados
// y su propio botón de volver a intentar. Antes era una sola carga: si fallaba, la pantalla
// entera se reemplazaba por un renglón de error, sin nada para tocar. Eso es un callejón sin
// salida — quien acaba de entrar a trabajar se queda sin ver sus turnos y sin poder hacer nada.
//
// Las zonas son dos, y ninguna se lleva a la otra por delante:
//
//   1. LOS TURNOS, que los pide el motor.
//   2. LO QUE ESPERA SEÑAL EN ESTE TELÉFONO, que sale de la cola guardada en el aparato. No
//      depende del motor: cuando el motor no contesta es justamente cuando más importa, porque
//      es lo que le dice a la persona que lo que hizo no se perdió.
//
// El aviso de consentimiento es su propia zona desde antes y se ocupa de lo suyo.

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

  // Zona 1: los turnos.
  const [guardias, setGuardias] = useState(null);
  const [errorGuardias, setErrorGuardias] = useState('');
  const [pidiendoGuardias, setPidiendoGuardias] = useState(false);

  // Zona 2: lo que espera señal. `null` mientras no se leyó todavía.
  const [enEsteTelefono, setEnEsteTelefono] = useState(null);
  const [errorCola, setErrorCola] = useState('');
  const [pidiendoCola, setPidiendoCola] = useState(false);

  const pedirGuardias = useCallback(() => {
    setErrorGuardias('');
    setPidiendoGuardias(true);
    return api
      .misGuardias()
      .then(({ guardias: data }) => setGuardias(data ?? []))
      .catch((e) => setErrorGuardias(mensajeDeError(e, t, 'cargar mis guardias')))
      .finally(() => setPidiendoGuardias(false));
  }, [t]);

  // Qué guardias tienen algo esperando en este teléfono, y cuál de ellas quedó con un rechazo.
  // La cola ya viene filtrada por quien tiene la sesión abierta: lo de otra cuenta no se lista.
  const pedirCola = useCallback(() => {
    setErrorCola('');
    setPidiendoCola(true);
    return listarCola()
      .then((cola) => {
        const porGuardia = new Map();
        for (const item of cola) {
          const motivo = motivoQueSeMuestra(item);
          if (!porGuardia.has(item.guardiaId)) porGuardia.set(item.guardiaId, '');
          if (motivo) porGuardia.set(item.guardiaId, motivo);
        }
        setEnEsteTelefono(porGuardia);
      })
      .catch((e) => setErrorCola(mensajeDeError(e, t, 'leer lo que espera señal')))
      .finally(() => setPidiendoCola(false));
  }, [t]);

  useEffect(() => {
    pedirGuardias();
    pedirCola();
    const desuscribir = suscribirseASincronizacion(pedirCola);
    return desuscribir;
  }, [pedirGuardias, pedirCola]);

  return (
    <div>
      <AvisoConsentimientoPendiente />
      {/* El título va siempre, también cuando algo falló y cuando no hay ninguna guardia. Sin él,
          la pantalla no tiene encabezado y quien la recorre con un lector de pantalla no sabe
          dónde está. */}
      <h1>{t.guardias.titulo}</h1>

      {errorCola && (
        <div className="alert alert-error" role="alert">
          {errorCola}
          <button type="button" className="btn btn-secondary" onClick={pedirCola} disabled={pidiendoCola}>
            {t.comun.reintentar}
          </button>
        </div>
      )}

      {errorGuardias && (
        <div className="alert alert-error" role="alert">
          {errorGuardias}
          <button type="button" className="btn btn-secondary" onClick={pedirGuardias} disabled={pidiendoGuardias}>
            {t.comun.reintentar}
          </button>
        </div>
      )}

      {/* Lo que ya estaba leído se queda donde está: un intento que falla no borra la lista. */}
      {guardias === null && !errorGuardias && (
        <div className="estado-cargando" role="status">{t.comun.cargando}</div>
      )}

      {guardias !== null && guardias.length === 0 && (
        <div className="estado-vacio" role="status">{t.guardias.sin_guardias}</div>
      )}

      {(guardias ?? []).map((g) => (
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
          {/* Lo que espera señal, y lo que el motor rechazó. En una tarjeta de lista no entra la
              frase entera del rechazo: acá se dice cuál es la guardia y el motivo se lee adentro,
              que es donde hay lugar para contarlo. */}
          {enEsteTelefono?.has(g.id) && (
            <span className="badge badge-alerta">
              {enEsteTelefono.get(g.id) ? (
                t.comun.no_se_pudo_enviar
              ) : (
                <>
                  <span aria-hidden="true">⏳</span> {t.comun.pendiente_de_enviar}
                </>
              )}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

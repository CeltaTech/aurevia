import { useState } from 'react';
import { api } from '../lib/api';
import { con } from '../lib/textos';
import { mensajeDeError } from '../lib/errores';
import { horaDelMomento } from '../lib/horarios';
import { obtenerUbicacion } from '../lib/ubicacionDelTelefono';
import { agregarACola, nuevoId } from '../lib/colaOffline';
import { sincronizarCola } from '../lib/sincronizarCola';
import { MOTIVOS_DEMORA } from '../lib/motivosDemora';

/**
 * Los dos actos de antes de llegar (pendiente #101): «salgo ahora» y «voy demorado».
 *
 * DE QUÉ SE TRATA. Todo esto se apoya en el acto de la persona, no en su puesto. Quien avisa que
 * sale, y quien avisa que va demorado y por qué, hizo algo, y ese acto lo protege: queda guardado
 * como suyo. Lo que el sistema calcula solo —que la cuenta dice que no llega— es un hecho, no un
 * mérito de nadie, se guarda con otro origen y nunca se mezcla con esto.
 *
 * LA MEDIDA DE ESTA PANTALLA SON LOS MINUTOS DE AVISO que le gana a la Prestadora para cubrir la
 * guardia. De ahí salen todas las decisiones de acá:
 *
 *   - NINGUNO DE LOS DOS BOTONES SE TRABA. Sin GPS la salida se registra igual y lo único que se
 *     pierde es la estimación. Sin conexión los dos van a la cola del teléfono, como el check-in,
 *     y salen solos cuando vuelve la señal.
 *   - EL MEDIO DE TRANSPORTE NO ES OBLIGATORIO. Preguntar antes de dejar avisar es una forma de
 *     que nadie avise.
 *   - LOS MOTIVOS SON CINCO Y SALEN DE UN SOLO LADO (`lib/motivosDemora.js`), en los tres
 *     idiomas. Ninguno se escribe adentro de esta pantalla.
 *
 * LO QUE SE MUESTRA SON HECHOS, NO VEREDICTOS. «Aviso de demora dado a las 14:19, motivo:
 * transporte». Nunca «llegó tarde» ni nada que se le parezca: la conclusión la saca el
 * Coordinador, no un programa.
 */
export default function AntesDeLlegar({ t, locale, guardiaId, guardia, salidaPendiente, avisoPendiente, alRegistrar }) {
  const [abriendoSalida, setAbriendoSalida] = useState(false);
  const [medioTransporte, setMedioTransporte] = useState('');
  const [registrandoSalida, setRegistrandoSalida] = useState(false);

  const [abriendoDemora, setAbriendoDemora] = useState(false);
  const [motivo, setMotivo] = useState(MOTIVOS_DEMORA[0]);
  const [avisandoDemora, setAvisandoDemora] = useState(false);

  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  // Lo que quedó anotado en este teléfono mientras el aviso espera señal. Sin esto, quien avisó
  // sin conexión no ve nada de lo que hizo hasta que vuelve la red, y vuelve a apretar.
  const [demoraEnEsteTelefono, setDemoraEnEsteTelefono] = useState(null);

  const salidaRegistrada = Boolean(guardia?.salida_checkin_at);

  async function alSalir() {
    setError('');
    setAviso('');
    setRegistrandoSalida(true);
    // La ubicación se pide, y si no contesta se sigue igual. Es la diferencia entre un botón que
    // gana minutos de aviso y uno que se traba adentro de un edificio.
    let punto = null;
    try {
      punto = await obtenerUbicacion();
    } catch {
      punto = null;
    }
    const datos = { ...(punto ?? {}), medioTransporte: medioTransporte.trim() || undefined };
    try {
      const resultado = await api.registrarSalida(guardiaId, datos);
      if (resultado.yaLlego) setAviso(t.antes_de_llegar.ya_llego);
      else if (!punto) setAviso(t.antes_de_llegar.salida_sin_ubicacion);
      setAbriendoSalida(false);
      setMedioTransporte('');
      alRegistrar?.();
    } catch (e) {
      if (!(e instanceof TypeError)) {
        setError(mensajeDeError(e, t, 'registrar la salida'));
        setRegistrandoSalida(false);
        return;
      }
      // Sin señal: se guarda en el teléfono y sale solo. La hora que le va a quedar es la de
      // cuando llegue al motor y no la de ahora — se dice así en pantalla, sin disimularlo.
      await agregarACola({ id: nuevoId(), tipo: 'salida', guardiaId, payload: datos });
      setAviso(t.antes_de_llegar.sin_conexion);
      setAbriendoSalida(false);
      setMedioTransporte('');
      alRegistrar?.();
      sincronizarCola();
    } finally {
      setRegistrandoSalida(false);
    }
  }

  async function alAvisarDemora() {
    setError('');
    setAviso('');
    setAvisandoDemora(true);
    const datos = { motivo };
    try {
      const resultado = await api.avisarDemora(guardiaId, datos);
      if (resultado.yaLlego) setAviso(t.antes_de_llegar.ya_llego);
      else {
        setDemoraEnEsteTelefono({ at: resultado.avisoAt, motivo: resultado.motivo ?? motivo });
        setAviso(t.antes_de_llegar.aviso_enviado);
      }
      setAbriendoDemora(false);
      alRegistrar?.();
    } catch (e) {
      if (!(e instanceof TypeError)) {
        setError(mensajeDeError(e, t, 'avisar la demora'));
        setAvisandoDemora(false);
        return;
      }
      await agregarACola({ id: nuevoId(), tipo: 'aviso_demora', guardiaId, payload: datos });
      setDemoraEnEsteTelefono({ at: null, motivo });
      setAviso(t.antes_de_llegar.sin_conexion);
      setAbriendoDemora(false);
      alRegistrar?.();
      sincronizarCola();
    } finally {
      setAvisandoDemora(false);
    }
  }

  const hayDemoraAvisada = Boolean(demoraEnEsteTelefono) || avisoPendiente;

  return (
    <div style={{ marginTop: '1rem' }}>
      <h2 style={{ fontSize: '1rem' }}>{t.antes_de_llegar.titulo}</h2>
      <p className="guardia-card-detalle">{t.antes_de_llegar.explicacion}</p>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {aviso && <div className="alert alert-info" role="status">{aviso}</div>}

      {/* La salida. Registrada, lo que queda en pantalla es el hecho y su hora, y el botón
          desaparece: no hay nada que volver a apretar. */}
      {salidaRegistrada && (
        <div className="alert alert-info" role="status">
          {con(t.antes_de_llegar.salida_registrada, { hora: horaDelMomento(guardia.salida_checkin_at, locale) })}
          {guardia.medio_transporte
            ? ` ${con(t.antes_de_llegar.salida_medio, { medio: guardia.medio_transporte })}`
            : ''}
        </div>
      )}

      {!salidaRegistrada && salidaPendiente && (
        <div className="alert alert-info" role="status">
          <span aria-hidden="true">⏳</span> {t.comun.pendiente_de_enviar}
        </div>
      )}

      {!salidaRegistrada && !salidaPendiente && !abriendoSalida && (
        <button className="btn btn-primary btn-full" onClick={() => setAbriendoSalida(true)}>
          {t.antes_de_llegar.salgo_ahora}
        </button>
      )}

      {!salidaRegistrada && !salidaPendiente && abriendoSalida && (
        <div>
          {/* Texto libre y opcional, igual que en el Panel: quien viaja describe su viaje, no
              elige de una lista que alguien tuvo que adivinar antes. */}
          <div className="form-field" style={{ marginTop: '0.5rem' }}>
            <label htmlFor="salida-medio-transporte">{t.antes_de_llegar.medio_transporte}</label>
            <input
              id="salida-medio-transporte"
              type="text"
              maxLength={60}
              value={medioTransporte}
              placeholder={t.antes_de_llegar.medio_transporte_placeholder}
              onChange={(e) => setMedioTransporte(e.target.value)}
              disabled={registrandoSalida}
            />
          </div>
          <button className="btn btn-primary btn-full" onClick={alSalir} disabled={registrandoSalida}>
            {registrandoSalida ? t.antes_de_llegar.registrando_salida : t.antes_de_llegar.confirmar_salida}
          </button>
          <button
            className="btn btn-secondary btn-full"
            onClick={() => setAbriendoSalida(false)}
            disabled={registrandoSalida}
            style={{ marginTop: '0.5rem' }}
          >
            {t.comun.cancelar}
          </button>
        </div>
      )}

      {/* El aviso de demora. No depende de haber marcado la salida: se puede ir demorado antes de
          salir, y de hecho ése es el aviso que más minutos gana. */}
      {hayDemoraAvisada && (
        <div className="alert alert-alerta" role="status" style={{ marginTop: '1rem' }}>
          {demoraEnEsteTelefono?.at
            ? con(t.antes_de_llegar.demora_dada, {
                hora: horaDelMomento(demoraEnEsteTelefono.at, locale),
                motivo: t.antes_de_llegar[`motivo_${demoraEnEsteTelefono.motivo}`] ?? demoraEnEsteTelefono.motivo,
              })
            : t.comun.pendiente_de_enviar}
        </div>
      )}

      {!hayDemoraAvisada && !abriendoDemora && (
        <button
          className="btn btn-secondary btn-full"
          onClick={() => setAbriendoDemora(true)}
          style={{ marginTop: '1rem' }}
        >
          {t.antes_de_llegar.voy_demorado}
        </button>
      )}

      {!hayDemoraAvisada && abriendoDemora && (
        <div style={{ marginTop: '1rem' }}>
          <p className="guardia-card-detalle">{t.antes_de_llegar.motivo_pregunta}</p>
          {MOTIVOS_DEMORA.map((m) => (
            <label
              key={m}
              htmlFor={`demora-motivo-${m}`}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
            >
              <input
                id={`demora-motivo-${m}`}
                type="radio"
                name="demora-motivo"
                value={m}
                checked={motivo === m}
                onChange={() => setMotivo(m)}
                disabled={avisandoDemora}
              />
              {t.antes_de_llegar[`motivo_${m}`]}
            </label>
          ))}
          <p className="guardia-card-detalle" style={{ marginTop: '0.75rem' }}>
            {t.antes_de_llegar.motivo_para_que_sirve}
          </p>
          <button
            className="btn btn-primary btn-full"
            onClick={alAvisarDemora}
            disabled={avisandoDemora}
          >
            {avisandoDemora ? t.antes_de_llegar.avisando_demora : t.antes_de_llegar.confirmar_demora}
          </button>
          <button
            className="btn btn-secondary btn-full"
            onClick={() => setAbriendoDemora(false)}
            disabled={avisandoDemora}
            style={{ marginTop: '0.5rem' }}
          >
            {t.comun.cancelar}
          </button>
        </div>
      )}
    </div>
  );
}

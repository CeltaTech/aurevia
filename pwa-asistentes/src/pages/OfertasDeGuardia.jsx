import { Fragment, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { con } from '../lib/textos';
import { mensajeDeError } from '../lib/errores';
import DomicilioTemporal, { domiciliosDeLaGuardia } from '../components/DomicilioTemporal';

// Las guardias que le ofrecieron y todavía puede tomar.
//
// La misma guardia se le ofrece a varios a la vez, y se la queda el primero que contesta. Por
// eso hay dos cosas a la vista en cada tarjeta: hasta cuándo hay tiempo, y cuánto queda de ese
// tiempo. Sin eso, aceptar es apostar.
//
// Una oferta que se venció o que ganó otro no aparece: no hay nada que hacer con ella. Si
// alguien acepta justo cuando eso pasa, el motor lo dice con todas las letras — nunca falla
// en silencio ni deja dos personas con el mismo turno.

// Cuánto falta para el plazo, en la unidad más grande que tenga sentido. Días si faltan días,
// horas si faltan horas, minutos sobre el final. Nadie necesita "faltan 2 días, 4 horas y 13
// minutos": necesita saber si tiene que decidir ahora o puede pensarlo.
function cuantoQueda(limiteISO, t) {
  if (!limiteISO) return null;

  const minutos = Math.floor((new Date(limiteISO).getTime() - Date.now()) / 60000);
  if (minutos < 1) return t.ofertas.limite_ya_casi;

  const dias = Math.floor(minutos / 1440);
  if (dias >= 1) return dias === 1 ? t.ofertas.limite_un_dia : con(t.ofertas.limite_dias, { n: dias });

  const horas = Math.floor(minutos / 60);
  if (horas >= 1) return horas === 1 ? t.ofertas.limite_una_hora : con(t.ofertas.limite_horas, { n: horas });

  return minutos === 1 ? t.ofertas.limite_un_minuto : con(t.ofertas.limite_minutos, { n: minutos });
}

function TarjetaDeOferta({ oferta, onResponder, enCurso, t, locale }) {
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const guardia = oferta.guardia;
  const nombres = (guardia.pacientes ?? []).map((p) => p.nombre).filter(Boolean);
  // Las direcciones distintas de la guardia, sin repetir la del matrimonio que vive junto, y
  // cada una sabiendo si es la de siempre o una temporal. Antes de decidir si se toma el turno
  // hay que saber adónde hay que ir de verdad.
  const domicilios = domiciliosDeLaGuardia(guardia.pacientes);
  const queda = cuantoQueda(guardia.oferta_limite_at, t);
  const ocupado = enCurso !== null;

  return (
    <div className="guardia-card guardia-programada">
      <div className="guardia-card-paciente">
        {nombres.length > 0 ? nombres.join(' · ') : t.guardias.sin_paciente}
      </div>
      <div className="guardia-card-detalle">
        {guardia.fecha} · {guardia.hora_inicio?.slice(0, 5)} - {guardia.hora_fin?.slice(0, 5)}
      </div>
      {domicilios.map((domicilio) => (
        <Fragment key={domicilio.domicilio}>
          <div className="guardia-card-detalle">{domicilio.domicilio}</div>
          <DomicilioTemporal paciente={domicilio} t={t} />
        </Fragment>
      ))}

      {/* El plazo, cuando lo hay. Sin plazo la oferta queda abierta hasta que alguien la tome,
          y decirlo es mejor que dejar el renglón vacío. */}
      <p className="oferta-limite">
        {guardia.oferta_limite_at
          ? con(t.ofertas.hasta, {
              cuando: new Date(guardia.oferta_limite_at).toLocaleString(locale, {
                dateStyle: 'short',
                timeStyle: 'short',
              }),
            })
          : t.ofertas.sin_limite}
      </p>
      {queda && <span className="badge">{queda}</span>}

      {!rechazando && (
        <div className="oferta-botones">
          <button
            className="btn btn-primary"
            disabled={ocupado}
            onClick={() => onResponder(oferta, 'acepta')}
          >
            {enCurso === `acepta:${oferta.id}` ? t.ofertas.aceptando : t.ofertas.aceptar}
          </button>
          <button className="btn btn-secondary" disabled={ocupado} onClick={() => setRechazando(true)}>
            {t.ofertas.rechazar}
          </button>
        </div>
      )}

      {/* El motivo se pregunta, no se exige: obligar a explicarse antes de poder decir que no
          es una forma de que nadie diga que no, y lo que la Prestadora necesita saber es que
          este turno hay que ofrecerlo a otro. */}
      {rechazando && (
        <div style={{ marginTop: '1rem' }}>
          <div className="form-field">
            <label htmlFor={`motivo-${oferta.id}`}>{t.ofertas.motivo}</label>
            <textarea
              id={`motivo-${oferta.id}`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              placeholder={t.ofertas.motivo_ejemplo}
            />
          </div>
          <div className="oferta-botones">
            <button
              className="btn btn-primary"
              disabled={ocupado}
              onClick={() => onResponder(oferta, 'rechaza', motivo)}
            >
              {enCurso === `rechaza:${oferta.id}` ? t.ofertas.enviando : t.ofertas.confirmar_rechazo}
            </button>
            <button
              className="btn btn-secondary"
              disabled={ocupado}
              onClick={() => {
                setRechazando(false);
                setMotivo('');
              }}
            >
              {t.comun.cancelar}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OfertasDeGuardia() {
  const { t, locale } = useLocale();
  // El número que lleva la pestaña de abajo lo dibuja el Layout, así que cada vez que esta
  // pantalla se entera de cuántas ofertas hay, se lo avisa. Sin esto, alguien que acaba de
  // aceptar sigue viendo el número viejo hasta que cierra la aplicación.
  const { avisarOfertas } = useOutletContext() ?? {};
  const [ofertas, setOfertas] = useState(null);
  const [error, setError] = useState('');
  const [enCurso, setEnCurso] = useState(null);
  const [tomada, setTomada] = useState(null);

  function cargar() {
    return api
      .ofertas()
      .then(({ ofertas: data }) => {
        setOfertas(data ?? []);
        avisarOfertas?.((data ?? []).length);
      })
      .catch((e) => setError(mensajeDeError(e, t, 'ofertas')));
  }

  useEffect(() => {
    cargar();
  }, []);

  async function responder(oferta, respuesta, motivo) {
    setEnCurso(`${respuesta}:${oferta.id}`);
    setError('');
    // El cartel de la guardia anterior se apaga antes de contestar la siguiente. Si no, quien
    // acaba de tomar una y pierde la de al lado ve las dos cosas juntas: "quedó tomada" arriba
    // y "la tomó otro" abajo, que leídas de corrido se contradicen.
    setTomada(null);
    try {
      const resultado = await api.responderOferta(oferta.id, respuesta, motivo);
      if (resultado.respuesta === 'acepta') setTomada(resultado.guardiaId);
    } catch (e) {
      // Casi siempre es que el turno lo tomó otro o que se venció el plazo. Las dos cosas se
      // arreglan con la misma lista al día, así que se explica y se vuelve a cargar.
      setError(mensajeDeError(e, t, 'responder oferta'));
    }
    setEnCurso(null);
    await cargar();
  }

  if (error && ofertas === null) return <div className="alert alert-error" role="alert">{error}</div>;
  if (ofertas === null) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  return (
    <div>
      <h1>{t.ofertas.titulo}</h1>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {tomada && (
        <div className="alert alert-info" role="status">
          {t.ofertas.tomada}{' '}
          <Link to={`/guardias/${tomada}`}>{t.ofertas.ver_el_turno}</Link>
        </div>
      )}

      {ofertas.length === 0 ? (
        <div className="estado-vacio" role="status">{t.ofertas.sin_ofertas}</div>
      ) : (
        ofertas.map((oferta) => (
          <TarjetaDeOferta
            key={oferta.id}
            oferta={oferta}
            onResponder={responder}
            enCurso={enCurso}
            t={t}
            locale={locale}
          />
        ))
      )}
    </div>
  );
}

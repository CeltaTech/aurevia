import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../lib/api';
import { mensajeDeError } from '../lib/errores';
import { MOTIVOS_SIN_COMPROBAR } from '../lib/motivosSinComprobar';

const LECTOR_ID = 'lector-codigo-de-presencia';

// Cada cuánto se le vuelve a preguntar al motor si en la Prestadora ya soltaron el código. No es
// una regla de negocio ni una decisión de ninguna Prestadora: es el pulso de una pantalla que
// está esperando, y el Asistente está parado en la puerta mientras tanto. Mismo criterio que el
// sondeo del cobro por QR en la aplicación de las Familias.
const SONDEO_MS = 4000;

/**
 * El pase de guardia, al marcar la llegada y al cerrar (pendiente #113).
 *
 * NO SE ESCANEA NINGÚN CARTEL. Un cartel pegado en el domicilio es un secreto permanente a la
 * vista de cualquiera que pase por la puerta: se fotografía una vez y sirve desde cualquier lado.
 * Lo que se lee acá es un código que alguien muestra en la pantalla de su teléfono y que se
 * renueva solo cada pocos segundos.
 *
 * HAY DOS CAMINOS Y UN PISO:
 *
 *   Plan A — lo muestra quien está en la casa: la Familia, o el Asistente que se va cuando hay
 *   relevo. Se lee con la cámara o se tipea; las dos cosas terminan en el mismo pedido.
 *
 *   Plan B — no hay nadie que pueda mostrarlo. El Asistente lo cuenta con sus palabras, eso
 *   aparece en la pantalla de la Prestadora, y quien está de turno suelta un código que vale para
 *   esta guardia, este momento y unos pocos minutos. Mientras espera, esta pantalla pregunta sola.
 *
 *   El piso — si en la Prestadora tampoco atiende nadie, se entra igual eligiendo un motivo. La
 *   guardia NUNCA se traba: esto no es una puerta, y ninguna rama de acá adentro termina sin una
 *   salida hacia adelante.
 *
 * `onListo(comprobacion)` recibe { codigo } o { motivoSinComprobar, detalle } y devuelve
 * { ok: true } o { ok: false, mensaje }. Cuando el motor rechaza el código —equivocado, vencido,
 * o de otra casa— este componente se queda abierto con el aviso: cerrarlo dejaría al Asistente
 * en la puerta sin nada que apretar.
 */
export default function PaseDeGuardia({ t, guardiaId, momento, onListo, onCancelar }) {
  // codigo · pidiendo · esperando · sin_comprobar
  const [paso, setPaso] = useState('codigo');
  const [codigo, setCodigo] = useState('');
  const [texto, setTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [detalle, setDetalle] = useState('');
  // Lo que salió mal en el último intento de comprobar. Es un aviso y no un error: siempre queda
  // algo para hacer abajo.
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [codigoDisponible, setCodigoDisponible] = useState(false);
  // La cámara se prende desde un efecto y nunca desde un clic: el lector se engancha a un elemento
  // del documento por su identificador, y ese elemento sólo existe mientras se está pidiendo el
  // código. Este contador es lo que vuelve a disparar el efecto, ya con la pantalla dibujada.
  const [intento, setIntento] = useState(0);
  const lectorRef = useRef(null);
  const leyendoRef = useRef(false);
  const vivoRef = useRef(true);

  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
    };
  }, []);

  const detenerCamara = useCallback(async () => {
    if (lectorRef.current && leyendoRef.current) {
      leyendoRef.current = false;
      try {
        await lectorRef.current.stop();
        lectorRef.current.clear();
      } catch {
        // la cámara ya pudo haberse detenido sola
      }
    }
  }, []);

  /* Entregar lo comprobado hacia arriba. Es el único camino de salida: los dos planes y el piso
     terminan acá, con formas distintas del mismo dato. */
  const entregar = useCallback(
    async (comprobacion) => {
      if (enviando) return;
      setEnviando(true);
      setAviso('');
      setError('');
      await detenerCamara();
      try {
        const resultado = await onListo(comprobacion);
        if (resultado && resultado.ok === false && vivoRef.current) {
          setAviso(resultado.mensaje);
          setCodigo('');
          // La cámara se apagó para mandar el pedido; si el código no sirvió, hay que volver a
          // prenderla para que se pueda intentar de nuevo sin salir y entrar de la pantalla.
          if (paso === 'codigo') setIntento((n) => n + 1);
        }
      } finally {
        if (vivoRef.current) setEnviando(false);
      }
    },
    [detenerCamara, enviando, onListo, paso],
  );

  // ---- Plan A: la cámara -------------------------------------------------------------------

  useEffect(() => {
    if (paso !== 'codigo') return undefined;
    let cancelado = false;

    (async () => {
      try {
        const lector = new Html5Qrcode(LECTOR_ID);
        lectorRef.current = lector;
        leyendoRef.current = true;
        await lector.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250 },
          (leido) => {
            if (!leyendoRef.current || cancelado) return;
            leyendoRef.current = false;
            setCodigo(String(leido ?? '').trim());
            entregar({ codigo: String(leido ?? '').trim() });
          },
          () => {},
        );
      } catch {
        // Sin cámara, sin permiso, o el navegador no la deja usar acá. No se avisa nada: abajo
        // está el mismo código para tipear, que es exactamente lo mismo con más trabajo.
        leyendoRef.current = false;
      }
    })();

    return () => {
      cancelado = true;
      detenerCamara();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, intento]);

  // ---- Plan B: el pedido a la Prestadora ---------------------------------------------------

  async function pedirALaPrestadora() {
    setEnviando(true);
    setError('');
    setAviso('');
    await detenerCamara();
    try {
      await api.pedirCodigoALaPrestadora(guardiaId, { momento, texto });
      if (vivoRef.current) setPaso('esperando');
    } catch (e) {
      if (vivoRef.current) setError(mensajeDeError(e, t, 'pedir el código a la Prestadora'));
    } finally {
      if (vivoRef.current) setEnviando(false);
    }
  }

  // Mientras espera, la pantalla pregunta sola. El código nunca viaja hasta acá: lo único que se
  // consulta es si ya hay uno esperando que lo tipeen.
  useEffect(() => {
    if (paso !== 'esperando') return undefined;
    let cancelado = false;

    async function mirar() {
      try {
        const estado = await api.estadoDeComprobacion(guardiaId, momento);
        if (!cancelado) setCodigoDisponible(Boolean(estado.codigoDisponible));
      } catch {
        // Sin señal o con el motor caído, el próximo ciclo vuelve a preguntar. Y si nunca llega,
        // abajo está el botón de entrar igual.
      }
    }

    mirar();
    const reloj = setInterval(mirar, SONDEO_MS);
    return () => {
      cancelado = true;
      clearInterval(reloj);
    };
  }, [paso, guardiaId, momento]);

  // ---- El piso -----------------------------------------------------------------------------

  async function irAlPiso() {
    await detenerCamara();
    setAviso('');
    setError('');
    setPaso('sin_comprobar');
  }

  async function volverAlCodigo() {
    setAviso('');
    setError('');
    setPaso('codigo');
    setIntento((n) => n + 1);
  }

  const titulo = momento === 'checkin' ? t.pase_de_guardia.titulo_checkin : t.pase_de_guardia.titulo_checkout;

  const botonEntrarIgual = (
    <button type="button" className="btn btn-secondary btn-full" onClick={irAlPiso} disabled={enviando} style={{ marginTop: '0.5rem' }}>
      {momento === 'checkin' ? t.pase_de_guardia.entrar_igual : t.pase_de_guardia.cerrar_igual}
    </button>
  );

  const campoDelCodigo = (
    <>
      <div className="form-field">
        <label htmlFor="pase-codigo">{t.pase_de_guardia.codigo_label}</label>
        <input
          id="pase-codigo"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          disabled={enviando}
        />
      </div>
      <button
        type="button"
        className="btn btn-primary btn-full"
        onClick={() => entregar({ codigo: codigo.trim() })}
        disabled={enviando || !codigo.trim()}
      >
        {enviando ? t.pase_de_guardia.confirmando : t.pase_de_guardia.confirmar_codigo}
      </button>
    </>
  );

  return (
    <div className="guardia-card" style={{ marginTop: '1rem' }}>
      <p className="guardia-card-paciente">{titulo}</p>

      {aviso && <div className="alert alert-alerta" role="status">{aviso}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {paso === 'codigo' && (
        <>
          <p className="guardia-card-detalle">{t.pase_de_guardia.instrucciones}</p>
          <div id={LECTOR_ID} style={{ width: '100%', borderRadius: '12px', overflow: 'hidden' }} />
          <p className="guardia-card-detalle" style={{ marginTop: '0.75rem' }}>{t.pase_de_guardia.o_tipear}</p>
          {campoDelCodigo}
          <button
            type="button"
            className="btn btn-secondary btn-full"
            onClick={() => { setPaso('pidiendo'); setAviso(''); setError(''); detenerCamara(); }}
            disabled={enviando}
            style={{ marginTop: '0.5rem' }}
          >
            {t.pase_de_guardia.nadie_para_mostrar}
          </button>
          {botonEntrarIgual}
        </>
      )}

      {paso === 'pidiendo' && (
        <>
          <p className="guardia-card-detalle">{t.pase_de_guardia.pedido_explicacion}</p>
          <div className="form-field">
            <label htmlFor="pase-texto">{t.pase_de_guardia.pedido_label}</label>
            <textarea
              id="pase-texto"
              rows={3}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={t.pase_de_guardia.pedido_ejemplo}
              disabled={enviando}
            />
          </div>
          <button type="button" className="btn btn-primary btn-full" onClick={pedirALaPrestadora} disabled={enviando}>
            {enviando ? t.pase_de_guardia.avisando : t.pase_de_guardia.avisar_a_la_prestadora}
          </button>
          <button type="button" className="btn btn-secondary btn-full" onClick={volverAlCodigo} disabled={enviando} style={{ marginTop: '0.5rem' }}>
            {t.pase_de_guardia.volver_al_codigo}
          </button>
          {botonEntrarIgual}
        </>
      )}

      {paso === 'esperando' && (
        <>
          {codigoDisponible ? (
            <>
              <div className="alert alert-success" role="status">{t.pase_de_guardia.codigo_soltado}</div>
              {campoDelCodigo}
            </>
          ) : (
            <>
              <div className="estado-cargando" role="status">{t.pase_de_guardia.esperando}</div>
              <p className="guardia-card-detalle">{t.pase_de_guardia.esperando_explicacion}</p>
            </>
          )}
          {botonEntrarIgual}
        </>
      )}

      {paso === 'sin_comprobar' && (
        <>
          <p className="guardia-card-detalle">{t.pase_de_guardia.sin_comprobar_titulo}</p>
          {MOTIVOS_SIN_COMPROBAR.map((m) => (
            <label key={m} htmlFor={`pase-motivo-${m}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
              <input
                id={`pase-motivo-${m}`}
                type="radio"
                name="pase-motivo"
                value={m}
                checked={motivo === m}
                onChange={() => setMotivo(m)}
                disabled={enviando}
              />
              {t.pase_de_guardia[`motivo_${m}`]}
            </label>
          ))}
          <div className="form-field" style={{ marginTop: '0.75rem' }}>
            <label htmlFor="pase-detalle">{t.pase_de_guardia.detalle_label}</label>
            <textarea
              id="pase-detalle"
              rows={2}
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              disabled={enviando}
            />
          </div>
          <p className="guardia-card-detalle">
            {momento === 'checkin' ? t.pase_de_guardia.sin_comprobar_aviso : t.pase_de_guardia.sin_comprobar_aviso_cierre}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-full"
            onClick={() => entregar({ motivoSinComprobar: motivo, detalle })}
            disabled={enviando || !motivo}
          >
            {enviando ? t.pase_de_guardia.confirmando : t.pase_de_guardia.sin_comprobar_continuar}
          </button>
          <button type="button" className="btn btn-secondary btn-full" onClick={volverAlCodigo} disabled={enviando} style={{ marginTop: '0.5rem' }}>
            {t.pase_de_guardia.volver_al_codigo}
          </button>
        </>
      )}

      <button
        type="button"
        className="btn btn-secondary btn-full"
        onClick={async () => { await detenerCamara(); onCancelar(); }}
        disabled={enviando}
        style={{ marginTop: '0.5rem' }}
      >
        {t.comun.cancelar}
      </button>
    </div>
  );
}

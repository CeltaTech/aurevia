import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const LECTOR_ID = 'lector-qr-guardia';

// Los cuatro motivos técnicos fijos con los que la base guarda por qué no se pudo leer el
// cartel (guardia_escaneos.excepcion_motivo, migración 20260908160000). No es un catálogo de
// la Prestadora — es del mismo tipo que errores.motivos: un código fijo, traducido acá.
const MOTIVOS_EXCEPCION = ['sin_camara', 'permiso_denegado', 'no_legible', 'otro'];

/**
 * El escaneo del cartel del domicilio, al marcar el check-in y al cerrar la guardia
 * (pendiente #113). Decisión del Desarrollador: el escaneo nunca traba la guardia. Si la
 * cámara no arranca, o el Asistente dice que no puede leer el cartel, se elige un motivo y
 * se sigue igual — es una excepción registrada, no un error que corta el paso.
 *
 * onListo(escaneo) se llama exactamente una vez, con:
 *   { qrLeido: true, qrToken }                    — se leyó el cartel
 *   { qrLeido: false, qrExcepcionMotivo: motivo }  — no se pudo, y éste es el motivo
 *
 * onCancelar() se llama si el Asistente se arrepiente de todo el paso (por ejemplo, apretó
 * "Cerrar la guardia" por error): ahí no se llama a onListo y no se marca ni check-in ni
 * check-out.
 */
export default function EscaneoQR({ t, onListo, onCancelar }) {
  const lectorRef = useRef(null);
  const escaneandoRef = useRef(false);
  const [estado, setEstado] = useState('pidiendo_permiso'); // pidiendo_permiso | escaneando | excepcion
  const [motivo, setMotivo] = useState('');
  // La cámara se prende desde un efecto y nunca desde el clic. El lector de QR se engancha a un
  // elemento del documento por su identificador, y ese elemento sólo existe mientras se está
  // pidiendo permiso o escaneando: si «Volver a intentar» prendiera la cámara ahí mismo, el
  // elemento todavía no estaría puesto y el intento fallaría siempre. El contador es lo que
  // dispara el efecto de nuevo, ya con la pantalla dibujada.
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    iniciarCamara();
    return () => {
      detenerCamara();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intento]);

  function volverAIntentar() {
    setMotivo('');
    setEstado('pidiendo_permiso');
    setIntento((n) => n + 1);
  }

  async function iniciarCamara() {
    try {
      const lector = new Html5Qrcode(LECTOR_ID);
      lectorRef.current = lector;
      escaneandoRef.current = true;
      await lector.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        (qrToken) => manejarLectura(qrToken),
        () => {},
      );
      setEstado('escaneando');
    } catch {
      // Sin cámara, sin permiso, o el navegador no la deja usar acá: el motivo exacto lo
      // elige el Asistente abajo — no se adivina cuál de los cuatro fue.
      escaneandoRef.current = false;
      setEstado('excepcion');
    }
  }

  async function detenerCamara() {
    if (lectorRef.current && escaneandoRef.current) {
      escaneandoRef.current = false;
      try {
        await lectorRef.current.stop();
        lectorRef.current.clear();
      } catch {
        // la cámara ya pudo haberse detenido
      }
    }
  }

  async function manejarLectura(qrToken) {
    if (!escaneandoRef.current) return;
    escaneandoRef.current = false;
    await detenerCamara();
    onListo({ qrLeido: true, qrToken });
  }

  async function pedirExcepcion() {
    await detenerCamara();
    setEstado('excepcion');
  }

  function confirmarExcepcion() {
    if (!motivo) return;
    onListo({ qrLeido: false, qrExcepcionMotivo: motivo });
  }

  async function cancelar() {
    await detenerCamara();
    onCancelar();
  }

  return (
    <div className="guardia-card" style={{ marginTop: '1rem' }}>
      {(estado === 'pidiendo_permiso' || estado === 'escaneando') && (
        <>
          {estado === 'pidiendo_permiso' && (
            <div className="estado-cargando" role="status">{t.escaneo.pidiendo_permiso}</div>
          )}
          <p className="guardia-card-detalle">{t.escaneo.instrucciones}</p>
          <div id={LECTOR_ID} style={{ width: '100%', borderRadius: '12px', overflow: 'hidden' }} />
          <button type="button" className="btn btn-secondary btn-full" onClick={pedirExcepcion} style={{ marginTop: '1rem' }}>
            {t.escaneo.no_puedo_escanear}
          </button>
        </>
      )}

      {estado === 'excepcion' && (
        <>
          <p className="guardia-card-detalle">{t.escaneo.excepcion_titulo}</p>
          {MOTIVOS_EXCEPCION.map((m) => (
            <label key={m} htmlFor={`escaneo-motivo-${m}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
              <input
                id={`escaneo-motivo-${m}`}
                type="radio"
                name="escaneo-motivo"
                value={m}
                checked={motivo === m}
                onChange={() => setMotivo(m)}
              />
              {t.escaneo[`excepcion_motivo_${m}`]}
            </label>
          ))}
          <p className="guardia-card-detalle" style={{ marginTop: '0.75rem' }}>{t.escaneo.excepcion_aviso}</p>
          <button
            type="button"
            className="btn btn-primary btn-full"
            onClick={confirmarExcepcion}
            disabled={!motivo}
            style={{ marginTop: '1rem' }}
          >
            {t.escaneo.excepcion_continuar}
          </button>
          <button type="button" className="btn btn-secondary btn-full" onClick={volverAIntentar} style={{ marginTop: '0.5rem' }}>
            {t.escaneo.volver_a_intentar}
          </button>
        </>
      )}

      <button type="button" className="btn btn-secondary btn-full" onClick={cancelar} style={{ marginTop: '0.5rem' }}>
        {t.escaneo.cancelar}
      </button>
    </div>
  );
}

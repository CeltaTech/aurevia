import { useState } from 'react';
import { api } from '../lib/api';
import { con } from '../lib/textos';
import { mensajeDeError } from '../lib/errores';
import { horaDelMomento } from '../lib/horarios';
import { agregarACola, nuevoId } from '../lib/colaOffline';
import { sincronizarCola } from '../lib/sincronizarCola';

/**
 * El botón de emergencia de la guardia en curso.
 *
 * QUÉ RESUELVE. Durante una guardia puede pasar algo que no admite esperar al cierre: una caída,
 * una descompensación, un accidente del propio Asistente. Hasta acá lo único que había era el
 * Reporte Diario, que se escribe al final, y los dos actos de antes de llegar. Quien tenía un
 * problema adentro de la casa se salía del producto y llamaba por teléfono, y de eso no quedaba
 * constancia en ningún lado.
 *
 * NO HAY LISTA DE TIPOS PARA ELEGIR, Y ES A PROPÓSITO. Se escribe qué está pasando y se manda.
 * Quien está en el medio de una emergencia no tiene que buscar su caso en un desplegable, y ahí
 * donde el aviso de demora sí tiene lista —porque sus motivos son estadística de ausentismo y un
 * texto libre no se traduce— acá lo que hace falta es que el Coordinador entienda qué pasa.
 *
 * DOS PASOS Y NO UNO. El botón abre el formulario y recién el segundo manda. Un botón de un solo
 * toque en una pantalla que se lleva en el bolsillo se aprieta solo, y una emergencia falsa gasta
 * exactamente lo que este botón viene a ganar.
 *
 * SIN SEÑAL SE DICE CON TODAS LAS LETRAS. El aviso se guarda en el teléfono y sale solo cuando
 * vuelva la conexión, igual que el check-in, pero acá eso no se muestra con el mismo cartelito
 * gris de «pendiente de enviar»: mientras la cola no salga **no se enteró nadie**, y quien reportó
 * tiene que saberlo para poder llamar por otro medio.
 */
export default function EmergenciaEnGuardia({ t, locale, guardiaId, alRegistrar }) {
  const tr = t.emergencia;
  const [abriendo, setAbriendo] = useState(false);
  const [detalle, setDetalle] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  // Lo que pasó con este aviso, en este teléfono: o salió y a qué hora, o quedó esperando señal.
  const [reportado, setReportado] = useState(null);

  async function alReportar() {
    setError('');
    setEnviando(true);
    // El momento en que pasó viaja con el aviso. Si esto queda media hora en la cola, esa media
    // hora es justamente el dato que no se puede perder.
    // El identificador del envío se pone antes del primer intento, para que un reenvío no
    // anote la misma emergencia dos veces.
    const clienteUuid = nuevoId();
    const datos = { detalle: detalle.trim(), ocurrido_at: new Date().toISOString(), clienteUuid };
    try {
      const resultado = await api.avisarEmergencia(guardiaId, datos);
      setReportado({ at: resultado.reportadoAt, enviado: true });
      setAbriendo(false);
      setDetalle('');
      alRegistrar?.();
    } catch (e) {
      if (!(e instanceof TypeError)) {
        setError(mensajeDeError(e, t, 'reportar la emergencia'));
        setEnviando(false);
        return;
      }
      await agregarACola({ id: clienteUuid, tipo: 'emergencia', guardiaId, payload: datos });
      setReportado({ at: datos.ocurrido_at, enviado: false });
      setAbriendo(false);
      setDetalle('');
      alRegistrar?.();
      sincronizarCola();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {/* Salió: se dice la hora y que el Coordinador ya lo tiene. Quedó en la cola: se dice que
          todavía no lo recibió nadie y que conviene avisar por otro medio. Son dos situaciones
          distintas y no se cuentan con el mismo cartel. */}
      {reportado && (
        <div className={reportado.enviado ? 'alert alert-info' : 'alert alert-error'} role="alert">
          {reportado.enviado
            ? con(tr.reportada, { hora: horaDelMomento(reportado.at, locale) })
            : tr.sin_conexion}
        </div>
      )}

      {!abriendo && (
        <button className="btn btn-secondary btn-full" onClick={() => setAbriendo(true)}>
          {reportado ? tr.reportar_otra : tr.boton}
        </button>
      )}

      {abriendo && (
        <div>
          <h2 style={{ fontSize: '1rem' }}>{tr.titulo}</h2>
          <p className="guardia-card-detalle">{tr.explicacion}</p>

          <div className="form-field" style={{ marginTop: '0.5rem' }}>
            <label htmlFor="emergencia-detalle">{tr.detalle}</label>
            <textarea
              id="emergencia-detalle"
              rows={4}
              maxLength={2000}
              value={detalle}
              placeholder={tr.detalle_placeholder}
              onChange={(e) => setDetalle(e.target.value)}
              disabled={enviando}
            />
          </div>

          <button
            className="btn btn-primary btn-full"
            onClick={alReportar}
            disabled={enviando || !detalle.trim()}
          >
            {enviando ? tr.enviando : tr.confirmar}
          </button>
          <button
            className="btn btn-secondary btn-full"
            onClick={() => {
              setAbriendo(false);
              setError('');
            }}
            disabled={enviando}
            style={{ marginTop: '0.5rem' }}
          >
            {t.comun.cancelar}
          </button>
        </div>
      )}
    </div>
  );
}

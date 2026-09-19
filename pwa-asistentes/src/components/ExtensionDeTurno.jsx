import { useState } from 'react';
import { api } from '../lib/api';
import { con } from '../lib/textos';
import { mensajeDeError } from '../lib/errores';
import { horaDelMomento } from '../lib/horarios';
import { agregarACola, nuevoId } from '../lib/colaOffline';
import { sincronizarCola } from '../lib/sincronizarCola';

/**
 * Lo que ve la que se quedó de más porque el relevo no llegó.
 *
 * QUÉ RESUELVE. Hasta acá, cuando el relevo no aparecía, la pantalla seguía mostrando un turno
 * terminado y nada más. La persona estaba adentro de una casa, sin saber si alguien estaba
 * buscando a quien la reemplace, y sin ningún botón que sirviera para su propia situación. Del
 * lado del producto ese rato no existía.
 *
 * TRES COSAS, Y NINGUNA MÁS. Le dice desde cuándo está de más, en qué anda la búsqueda, y le da
 * por dónde avisar que no puede continuar.
 *
 * NO LE PREGUNTA SI ACEPTA QUEDARSE, Y NO ES UN DESCUIDO. Quedarse hasta el relevo es un deber del
 * oficio: irse deja al Paciente solo y eso la expone a ella. Un botón para soltar el turno sería
 * ofrecerle meterse en un problema. Por eso el texto le pide, no le ordena, y por eso tampoco hay
 * nada acá que trabe el cierre de su turno: si decide irse, puede.
 *
 * LA BÚSQUEDA SE CUENTA SIN NOMBRES. Quién faltó, quién viene, a quién se le ofreció: nada de eso.
 * No le sirve —no puede llamar a nadie desde adentro de un turno— y decirle que faltó una
 * compañera es hablar de una persona a sus espaldas. Se le cuentan los pasos ya dados, que es lo
 * único que le contesta la pregunta real: ¿me están dejando sola?
 *
 * DOS PASOS Y NO UNO para el «no puedo continuar», por lo mismo que la emergencia: un botón de un
 * solo toque en una pantalla que se lleva en el bolsillo se aprieta solo.
 *
 * SIN SEÑAL SE DICE CON TODAS LAS LETRAS: mientras la cola no salga **no se enteró nadie**, y
 * tiene que saberlo para poder avisar por otro medio.
 */
export default function ExtensionDeTurno({ t, locale, guardiaId, extension, alAvisar }) {
  const tr = t.extension;
  const [abriendo, setAbriendo] = useState(false);
  const [detalle, setDetalle] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  // Lo que pasó con este aviso en este teléfono: o salió y a qué hora, o quedó esperando señal.
  const [avisado, setAvisado] = useState(null);

  if (!extension) return null;

  // El aviso ya salió en otro momento —desde otro teléfono, o antes de recargar la pantalla—. Se
  // muestra igual: que ya avisó es justamente lo que necesita ver para no volver a intentarlo.
  const yaAviso = avisado || (extension.noPuedeContinuarAt ? { at: extension.noPuedeContinuarAt, enviado: true } : null);

  async function alNoPoderContinuar() {
    setError('');
    setEnviando(true);
    // El identificador del envío se pone antes del primer intento, para que un reenvío no
    // anote el mismo aviso dos veces.
    const clienteUuid = nuevoId();
    const datos = { detalle: detalle.trim(), ocurrido_at: new Date().toISOString(), clienteUuid };
    try {
      const resultado = await api.noPuedeContinuar(guardiaId, datos);
      setAvisado({ at: resultado.avisadoAt, enviado: true });
      setAbriendo(false);
      setDetalle('');
      alAvisar?.();
    } catch (e) {
      if (!(e instanceof TypeError)) {
        setError(mensajeDeError(e, t, 'avisar que no puede continuar'));
        setEnviando(false);
        return;
      }
      await agregarACola({ id: clienteUuid, tipo: 'no_puede_continuar', guardiaId, payload: datos });
      setAvisado({ at: datos.ocurrido_at, enviado: false });
      setAbriendo(false);
      setDetalle('');
      alAvisar?.();
      sincronizarCola();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="alert alert-info" role="status" style={{ marginTop: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{tr.titulo}</h2>
      <p>{con(tr.desde, { hora: horaDelMomento(extension.desdeAt, locale) })}</p>
      <p>{tr.sigue_a_cargo}</p>

      <p style={{ marginBottom: '0.25rem' }}>{tr.busqueda}</p>
      <ul>
        {/* El camino entero y no `tr.pasos[…]`: el verificador de textos huérfanos reconoce
            así que estas cinco claves se usan, aunque la clave la elija el motor. */}
        {(extension.pasos ?? []).map((paso) => (
          <li key={paso}>{t.extension.pasos[paso] ?? paso}</li>
        ))}
      </ul>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {yaAviso && (
        <div className={yaAviso.enviado ? 'alert alert-info' : 'alert alert-error'} role="alert">
          {yaAviso.enviado
            ? con(tr.avisado, { hora: horaDelMomento(yaAviso.at, locale) })
            : tr.sin_conexion}
        </div>
      )}

      {!yaAviso && !abriendo && (
        <button className="btn btn-secondary btn-full" onClick={() => setAbriendo(true)}>
          {tr.boton}
        </button>
      )}

      {abriendo && (
        <div>
          <p className="guardia-card-detalle">{tr.explicacion}</p>

          <div className="form-field" style={{ marginTop: '0.5rem' }}>
            <label htmlFor="extension-detalle">{tr.detalle}</label>
            {/* El detalle no es obligatorio, y eso es la decisión: quien está en el medio de algo
                puede no estar en condiciones de escribir nada, y el aviso tiene que poder salir
                igual. */}
            <textarea
              id="extension-detalle"
              rows={4}
              maxLength={2000}
              value={detalle}
              placeholder={tr.detalle_placeholder}
              onChange={(e) => setDetalle(e.target.value)}
              disabled={enviando}
            />
          </div>

          <button className="btn btn-primary btn-full" onClick={alNoPoderContinuar} disabled={enviando}>
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

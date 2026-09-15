import { useEffect, useRef, useState } from 'react';
import { dictar, hayDictado } from '../lib/dictado';

/**
 * El micrófono que acompaña a una caja de texto.
 *
 * SE PONE AL LADO DE LA CAJA, NO ADENTRO. Lo dictado se agrega a lo que ya hay escrito y se
 * corrige ahí mismo: el dictado es otra forma de escribir, no un camino aparte con su propia
 * pantalla de confirmación.
 *
 * ES UNO SOLO PARA TODAS LAS CAJAS. Cada lugar que quiera dictar le pasa el valor actual y cómo
 * cambiarlo; qué motor de voz se usa, en qué idioma escucha y qué se dice cuando algo sale mal
 * está escrito una sola vez, acá y en `lib/dictado.js`.
 *
 * DONDE NO HAY RECONOCIMIENTO DE VOZ, NO HAY BOTÓN. No se muestra apagado ni con una explicación:
 * un botón que nunca va a funcionar en ese teléfono es una promesa rota en cada pantalla.
 *
 * @param {object} props
 * @param {object} props.t        Los textos de la pantalla.
 * @param {string} props.locale   En qué idioma escuchar.
 * @param {string} props.valor    Lo que hay escrito hoy en la caja.
 * @param {(texto: string) => void} props.alCambiar  Cómo se escribe en la caja.
 * @param {string} props.campo    Cómo se llama la caja que acompaña. Va en el nombre del botón, que
 *                                si no se llamaría «Dictar» tres veces en la misma pantalla y quien
 *                                la recorre con un lector no sabría cuál es cuál.
 * @param {boolean} [props.disabled]
 */
export default function BotonDeDictado({ t, locale, valor, alCambiar, campo, disabled }) {
  const tr = t.dictado;
  const [escuchando, setEscuchando] = useState(false);
  const [parcial, setParcial] = useState('');
  const [aviso, setAviso] = useState('');
  const cortar = useRef(null);
  // Lo que hay escrito, sin que la función que escucha se quede con una copia vieja: el
  // reconocedor se crea una vez y sigue llamando a la misma función mientras dura el dictado.
  const valorActual = useRef(valor);
  valorActual.current = valor;

  // Si alguien se va de la pantalla con el micrófono abierto, se cierra. Un teléfono escuchando
  // adentro de la casa de otra persona no queda encendido porque se tocó «volver».
  useEffect(() => () => cortar.current?.(), []);

  if (!hayDictado()) return null;

  function alternar() {
    if (escuchando) {
      cortar.current?.();
      return;
    }
    setAviso('');
    setEscuchando(true);
    cortar.current = dictar({
      idioma: locale,
      alReconocer: (texto) => {
        const hasta = valorActual.current ?? '';
        // Un espacio en el medio, y ninguno al principio: quien dicta sobre una caja vacía no
        // tiene por qué empezar con un espacio, y quien dicta sobre un texto que ya venía no
        // tiene por qué pegar las dos frases.
        alCambiar(hasta.trim() ? `${hasta.replace(/\s+$/, '')} ${texto}` : texto);
      },
      alEscuchar: setParcial,
      alTerminar: (motivo) => {
        setEscuchando(false);
        setParcial('');
        cortar.current = null;
        setAviso(motivo ? tr[`error_${motivo}`] : '');
      },
    });
  }

  return (
    <>
      <button
        type="button"
        className={`btn btn-secondary${escuchando ? ' dictado-escuchando' : ''}`}
        onClick={alternar}
        disabled={disabled}
        aria-pressed={escuchando}
        aria-label={`${escuchando ? tr.escuchando : tr.dictar}: ${campo}`}
        style={{ fontSize: '0.85rem', padding: '0.4rem 0.9rem', marginTop: '0.4rem' }}
      >
        <span aria-hidden="true">🎤</span> {escuchando ? tr.escuchando : tr.dictar}
      </button>

      {/* Lo que va oyendo se muestra aparte y no se guarda: sirve para ver que está escuchando de
          verdad, y desaparece en cuanto el reconocedor lo da por firme y pasa a la caja. */}
      {escuchando && (
        <p className="guardia-card-detalle" aria-live="polite">
          {parcial || tr.hable_ahora}
        </p>
      )}

      {aviso && (
        <p className="guardia-card-detalle" role="status">
          {aviso}
        </p>
      )}
    </>
  );
}

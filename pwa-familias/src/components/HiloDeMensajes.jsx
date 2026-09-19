import { useEffect, useRef, useState } from 'react';

// EL HILO DE MENSAJES DEL MARKETPLACE, DIBUJADO UNA SOLA VEZ.
//
// Vive acá y no adentro de una pantalla porque lo dibujan dos aplicaciones: la de la Familia y
// la del Asistente. Es la misma conversación mirada desde las dos puntas, y si cada una la
// dibujara por su cuenta, el aviso de que el dato de contacto está tapado terminaría diciendo
// una cosa de un lado y otra del otro —o faltando de uno—. Por eso este archivo tiene original
// y copia, y la copia la genera `scripts/sincronizar_copias.mjs`: nunca se edita a mano.
//
// QUÉ NO SABE. De quién es cada punta, cómo se llama la otra persona, ni cómo se piden los
// mensajes. Recibe la lista ya armada y quién es «yo». Así sirve igual en las dos aplicaciones,
// que tienen pantallas y direcciones distintas.
//
// EL AVISO DEL TAPADO NO ES DECORACIÓN. Quien escribe su teléfono y ve tres puntos tiene que
// entender qué pasó, y sobre todo tiene que saber que lo que el producto no reconoce sí se ve
// del otro lado. El producto avisa, no bloquea (`celtatech/CLAUDE.md` §7).
//
// Y EL AVISO ESTÁ SIEMPRE. Lo que se tapa no se guarda, así que no hay ningún momento en que
// deje de valer: abrir el contacto de esta persona no destapa nada de lo ya dicho.
//
// EL MOTIVO SE LE MUESTRA A QUIEN ESCRIBIÓ, Y NO AL OTRO LADO. Quien puso su número necesita
// saber por qué quedaron marcas en su mensaje; decirle al que lo recibe qué forma se reconoció es
// enseñarle cuál probar la próxima vez. El texto sale del catálogo, en los tres idiomas.
// Qué dice la línea de un mensaje tapado. A quien lo escribió, el motivo del catálogo en su
// idioma; al otro lado, que se tapó algo y nada más. Sin motivo guardado —una regla que se
// desactivó después— queda la frase neutra, que siempre alcanza.
function motivoDelTapado(mensaje, ladoPropio, locale, t) {
  if (mensaje.lado !== ladoPropio) return t.chat.tapado_en_este_mensaje;
  return mensaje.motivo_tapado?.[locale] || t.chat.tapado_en_este_mensaje;
}

export default function HiloDeMensajes({
  mensajes,
  ladoPropio,
  locale,
  videollamada,
  videollamadaDisponible,
  alLlamar,
  alEnviar,
  t,
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [llamando, setLlamando] = useState(false);
  const fondo = useRef(null);

  // Una conversación se lee por el final. Sin esto, cada vez que llega algo hay que arrastrar la
  // pantalla para verlo.
  useEffect(() => {
    fondo.current?.scrollIntoView({ block: 'end' });
  }, [mensajes]);

  async function enviar(evento) {
    evento.preventDefault();
    const cuerpo = texto.trim();
    if (!cuerpo || enviando) return;
    setEnviando(true);
    try {
      await alEnviar(cuerpo);
      setTexto('');
    } finally {
      setEnviando(false);
    }
  }

  async function llamar() {
    if (llamando) return;
    setLlamando(true);
    try {
      await alLlamar();
    } finally {
      setLlamando(false);
    }
  }

  const hayAlgoTapado = mensajes.some((m) => m.tapado);

  return (
    <div className="hilo-de-mensajes">
      {/* Se dice siempre, no sólo cuando ya se tapó algo: quien está por escribir su número
          tiene que enterarse antes y no después. */}
      <p className="aviso-suave" role="note">
        {t.chat.contacto_tapado}
        {hayAlgoTapado ? ` ${t.chat.contacto_tapado_ya_paso}` : ''}
      </p>

      {/* La videollamada sólo aparece donde la Prestadora dijo dónde se hacen las suyas. Sin eso
          no hay proveedor, y un botón que no lleva a ningún lado es peor que no tenerlo. */}
      {videollamadaDisponible && (
        <div className="hilo-videollamada">
          {videollamada ? (
            <a className="btn btn-primary" href={videollamada.url} target="_blank" rel="noreferrer">
              {t.chat.entrar_a_la_videollamada}
            </a>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={llamar} disabled={llamando}>
              {llamando ? t.chat.enviando : t.chat.empezar_videollamada}
            </button>
          )}
        </div>
      )}

      {mensajes.length === 0 ? (
        <div className="estado-vacio" role="status">{t.chat.sin_mensajes}</div>
      ) : (
        <ul className="lista-mensajes">
          {mensajes.map((m) => (
            <li key={m.id} className={`mensaje mensaje-${m.lado === ladoPropio ? 'propio' : 'ajeno'}`}>
              {/* Un mensaje automático no lo escribió nadie: su cuerpo es una clave, y la frase
                  que se lee sale de las traducciones. Escrito como si lo hubiera dicho una
                  persona, diría algo que esa persona no dijo. */}
              <p className="mensaje-cuerpo">
                {m.automatico ? t.chat.avisos[m.cuerpo] || t.chat.sin_mensajes : m.cuerpo}
              </p>
              <p className="mensaje-cuando">
                {new Date(m.created_at).toLocaleString(locale)}
                {m.tapado && ` · ${motivoDelTapado(m, ladoPropio, locale, t)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div ref={fondo} />

      <form className="form-mensaje" onSubmit={enviar}>
        <label className="solo-lectores-pantalla" htmlFor="mensaje-nuevo">
          {t.chat.escribir}
        </label>
        <textarea
          id="mensaje-nuevo"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={t.chat.escribir}
          rows={2}
        />
        <button type="submit" className="btn btn-primary" disabled={enviando || !texto.trim()}>
          {enviando ? t.chat.enviando : t.chat.enviar}
        </button>
      </form>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { EstadoLista } from '../layout/EstadoLista';

const API_URL = import.meta.env.VITE_API_URL;

// El envío pasa siempre por el backend: el token de WhatsApp de cada Prestadora vive en la
// bóveda de Supabase y nunca puede llegar al navegador (CLAUDE.md §6).
async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/whatsapp${path}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.codigo || resultado.error);
  return resultado;
}

// Un mensaje saliente que la IA redactó pero nadie envió todavía.
function esBorrador(mensaje) {
  return (
    mensaje.direccion === 'saliente' &&
    !mensaje.enviado_automaticamente &&
    !mensaje.revisado_por_coordinador_at
  );
}

export function HiloWhatsapp({ conversacionId, onCambio }) {
  const { t } = useLocale();
  const [mensajes, setMensajes] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [descartando, setDescartando] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('mensajes_whatsapp')
      .select('id, direccion, texto, generado_por_ia, enviado_automaticamente, revisado_por_coordinador_at, created_at')
      .eq('conversacion_id', conversacionId)
      .order('created_at', { ascending: true });

    if (errorConsulta) {
      setError(errorConsulta.message);
      setEstado('error');
      return;
    }

    const filas = data ?? [];
    setMensajes(filas);
    // La respuesta que sugirió la IA arranca escrita en el cuadro de texto: el Coordinador
    // la corrige si hace falta y la manda, en vez de escribir todo de cero.
    const borrador = [...filas].reverse().find(esBorrador);
    setTexto(borrador ? borrador.texto : '');
    setEstado('listo');
  }, [conversacionId]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function enviar() {
    if (!texto.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      await llamarApi(`/conversaciones/${conversacionId}/responder`, {
        method: 'POST',
        body: JSON.stringify({ texto: texto.trim() }),
      });
      recargar();
      onCambio?.();
    } catch (err) {
      setError(
        err.message === 'whatsapp_no_configurado'
          ? t.comunicacion.whatsapp_no_configurado
          : t.comunicacion.error_envio_whatsapp,
      );
    } finally {
      setEnviando(false);
    }
  }

  async function descartar() {
    setDescartando(true);
    setError(null);
    try {
      await llamarApi(`/conversaciones/${conversacionId}/descartar`, { method: 'POST' });
      recargar();
      onCambio?.();
    } catch {
      setError(t.comun.error_generico);
    } finally {
      setDescartando(false);
    }
  }

  const hayBorrador = mensajes.some(esBorrador);

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && mensajes.length === 0}
        recargar={recargar}
        mensajeVacio={t.comunicacion.sin_mensajes_whatsapp}
      >
        <div className="panel-chat-hilo">
          {mensajes.map((m) => (
            <div
              key={m.id}
              className={`panel-chat-burbuja ${m.direccion === 'saliente' ? 'panel-chat-burbuja-propia' : ''} ${
                esBorrador(m) ? 'panel-chat-burbuja-borrador' : ''
              }`}
            >
              <div className="panel-chat-burbuja-autor">
                {m.direccion === 'entrante' ? t.comunicacion.autor_contacto : t.comunicacion.autor_prestadora}
                {m.generado_por_ia && ` · ${t.comunicacion.redactado_por_ia}`}
                {esBorrador(m) && ` · ${t.comunicacion.sin_enviar}`}
              </div>
              <div className="panel-chat-burbuja-texto">{m.texto}</div>
              <div className="panel-chat-burbuja-hora">{new Date(m.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </EstadoLista>

      <div className="panel-chat-envio">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={t.comunicacion.placeholder_whatsapp}
          rows={3}
        />
        <Button onClick={enviar} disabled={enviando || !texto.trim()}>
          {enviando ? t.comun.guardando : t.comunicacion.enviar_whatsapp}
        </Button>
        {hayBorrador && (
          <Button variant="secondary" onClick={descartar} disabled={descartando}>
            {t.comunicacion.descartar_borrador}
          </Button>
        )}
      </div>
    </div>
  );
}

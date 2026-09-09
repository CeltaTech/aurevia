import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { usePedidosDeCodigo } from '../context/PedidosDeCodigoContext';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { useModalAccesible } from '../hooks/useModalAccesible';
import { TONO, claseBadgeTono } from '../lib/tonos';
import { llamarApiComprobaciones } from '../lib/apiComprobaciones';
import { mensajeDeError } from '../lib/errores';

/* El pase de guardia visto desde la Prestadora (pendiente #113).
   ==========================================================================

   DOS LISTAS, Y UNA SOLA ES URGENTE.

     Arriba, quién está esperando. El Asistente llegó al domicilio y no tiene a quién pedirle el
     código: no hay nadie de la Familia, o nadie que pueda usar el teléfono. Escribió con sus
     palabras qué pasa y está parado en la puerta. Quien está de turno lo resuelve como esa
     Prestadora decida —llamando a la casa, por videollamada, como sea— y recién entonces suelta
     el código. Esta lista se refresca sola: ver `context/PedidosDeCodigoContext.jsx`.

     Abajo, qué quedó sin comprobar. La guardia nunca se traba: si en la Prestadora no atendió
     nadie, el Asistente entró igual eligiendo un motivo de una lista corta. Eso ya pasó, no hay
     nada que apurar, y queda acá hasta que alguien lo mire y lo cierre.

   EL CÓDIGO SE MUESTRA UNA SOLA VEZ, Y ES A PROPÓSITO. Del lado de la base queda su huella, no
   él, así que ni esta pantalla ni ninguna otra lo puede volver a mostrar. Quien lo suelta se lo
   dicta al Asistente en ese momento. Si se perdió, se suelta otro: el anterior deja de valer.

   CERRAR NO ES APROBAR NI RECHAZAR. Es decir que alguien la miró. Lo que se haya averiguado va
   en la nota, y la fila queda con quién la cerró y cuándo. No existe un botón de "rechazar"
   porque la llegada ya ocurrió: negarla después no la borra. */

function aLaHora(iso) {
  if (!iso) return '—';
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? '—' : fecha.toLocaleString();
}

function horario(fila) {
  const partes = [fila.fecha, fila.horaInicio && fila.horaFin ? `${fila.horaInicio}–${fila.horaFin}` : null];
  return partes.filter(Boolean).join(' · ') || '—';
}

/* La ventana que pide la nota antes de cerrar. La nota es opcional —a veces no hay nada que
   contar— así que el botón de cerrar no la exige. */
function CerrarSinComprobar({ fila, onCerrado, onClose }) {
  const { t } = useLocale();
  const modal = useModalAccesible(onClose);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleCerrar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApiComprobaciones(`/${fila.id}/cerrar`, {
        method: 'POST',
        body: JSON.stringify({ nota }),
      });
      onCerrado();
    } catch (err) {
      setError(mensajeDeError(err, t));
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.pase_de_guardia.cerrar_titulo}</h2>
        <p className="panel-explicacion">{t.pase_de_guardia.cerrar_explicacion}</p>
        {error && <Alert variant="error">{error}</Alert>}
        <FormField
          label={t.pase_de_guardia.cerrar_nota}
          name="nota"
          type="textarea"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          ayuda={t.pase_de_guardia.cerrar_nota_ayuda}
        />
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={handleCerrar} disabled={guardando}>
            {guardando ? t.comun.guardando : t.pase_de_guardia.cerrar_accion}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PaseDeGuardia() {
  const { t } = useLocale();
  const { pedidos, estado: estadoPedidos, error: errorPedidos, recargar: recargarPedidos } = usePedidosDeCodigo();

  /* Los códigos que se soltaron desde esta pantalla, mientras siga abierta. No se guardan en
     ningún lado y no vuelven del servidor: es la única ventana de tiempo en la que existen en
     claro, y termina cuando quien atiende recarga la pantalla. */
  const [codigosSoltados, setCodigosSoltados] = useState({});
  const [soltandoId, setSoltandoId] = useState(null);
  const [errorAlSoltar, setErrorAlSoltar] = useState(null);

  const [sinComprobar, setSinComprobar] = useState([]);
  const [estadoSinComprobar, setEstadoSinComprobar] = useState('cargando');
  const [errorSinComprobar, setErrorSinComprobar] = useState(null);
  const [cerrando, setCerrando] = useState(null);

  const recargarSinComprobar = useCallback(async () => {
    setEstadoSinComprobar('cargando');
    setErrorSinComprobar(null);
    try {
      const lista = await llamarApiComprobaciones('/sin-comprobar');
      setSinComprobar(Array.isArray(lista) ? lista : []);
      setEstadoSinComprobar('listo');
    } catch (err) {
      setErrorSinComprobar(mensajeDeError(err, t));
      setEstadoSinComprobar('error');
    }
  }, [t]);

  useEffect(() => {
    recargarSinComprobar();
  }, [recargarSinComprobar]);

  async function soltarCodigo(pedido) {
    setSoltandoId(pedido.id);
    setErrorAlSoltar(null);
    try {
      const { codigo, minutos } = await llamarApiComprobaciones(`/${pedido.id}/codigo`, { method: 'POST' });
      setCodigosSoltados((anteriores) => ({ ...anteriores, [pedido.id]: { codigo, minutos } }));
      // Se vuelve a preguntar en el momento en vez de esperar el próximo refresco: así la fila
      // queda marcada como que ya tiene código vigente para cualquier otro que esté mirando.
      recargarPedidos();
    } catch (err) {
      setErrorAlSoltar(mensajeDeError(err, t));
    } finally {
      setSoltandoId(null);
    }
  }

  return (
    <div>
      <h1>{t.pase_de_guardia.titulo}</h1>
      <p className="panel-explicacion">{t.pase_de_guardia.explicacion}</p>

      <h2>{t.pase_de_guardia.pedidos_titulo}</h2>
      <p className="panel-explicacion">{t.pase_de_guardia.pedidos_explicacion}</p>

      {/* El error de un refresco que falló cuando la lista ya estaba cargada: la lista se queda
          donde está y el aviso va al lado, porque borrarla escondería un pedido que sigue
          esperando. */}
      {estadoPedidos === 'listo' && errorPedidos && <Alert variant="error">{errorPedidos}</Alert>}
      {errorAlSoltar && <Alert variant="error">{errorAlSoltar}</Alert>}

      <EstadoLista
        estado={estadoPedidos}
        error={errorPedidos}
        vacio={estadoPedidos === 'listo' && pedidos.length === 0}
        recargar={recargarPedidos}
        mensajeVacio={t.pase_de_guardia.pedidos_vacio}
        ayudaVacio={t.pase_de_guardia.pedidos_vacio_ayuda}
      >
        {pedidos.map((pedido) => {
          const soltado = codigosSoltados[pedido.id];
          return (
            <div key={pedido.id} className="panel-guardia-card guardia-ausente">
              <div>
                {/* Si es la llegada o la salida es un dato, no un estado: no hay nada mejor ni
                    peor en ninguna de las dos, así que va con el tono que dice justamente eso. */}
                <strong>{pedido.asistente || '—'}</strong>{' '}
                <span className={claseBadgeTono(TONO.INFO)}>
                  {t.pase_de_guardia[`momento_${pedido.momento}`] ?? pedido.momento}
                </span>
                <div>{horario(pedido)}</div>
                <div>{t.pase_de_guardia.pedido_desde}: {aLaHora(pedido.pedidoEn)}</div>
                {pedido.texto ? (
                  <p className="panel-resultado-calculo">{pedido.texto}</p>
                ) : (
                  <div>{t.pase_de_guardia.pedido_sin_texto}</div>
                )}
                {soltado && (
                  <div className="panel-codigo-soltado">
                    <span className="panel-codigo-soltado-numero">{soltado.codigo}</span>
                    <span>{t.pase_de_guardia.codigo_vale_minutos.replace('{minutos}', soltado.minutos)}</span>
                    <span className="panel-codigo-soltado-aviso">{t.pase_de_guardia.codigo_una_sola_vez}</span>
                  </div>
                )}
                {!soltado && pedido.codigoVigente && (
                  <div className="panel-guardia-alerta">
                    {t.pase_de_guardia.codigo_ya_soltado.replace('{hora}', aLaHora(pedido.codigoEmitidoEn))}
                  </div>
                )}
              </div>
              <div className="panel-modal-acciones">
                <Button
                  variant={pedido.codigoVigente ? 'secondary' : 'primary'}
                  onClick={() => soltarCodigo(pedido)}
                  disabled={soltandoId === pedido.id}
                >
                  {soltandoId === pedido.id
                    ? t.pase_de_guardia.soltando
                    : pedido.codigoVigente
                      ? t.pase_de_guardia.soltar_otro
                      : t.pase_de_guardia.soltar}
                </Button>
              </div>
            </div>
          );
        })}
      </EstadoLista>

      <h2>{t.pase_de_guardia.sin_comprobar_titulo}</h2>
      <p className="panel-explicacion">{t.pase_de_guardia.sin_comprobar_explicacion}</p>

      <EstadoLista
        estado={estadoSinComprobar}
        error={errorSinComprobar}
        vacio={estadoSinComprobar === 'listo' && sinComprobar.length === 0}
        recargar={recargarSinComprobar}
        mensajeVacio={t.pase_de_guardia.sin_comprobar_vacio}
        ayudaVacio={t.pase_de_guardia.sin_comprobar_vacio_ayuda}
      >
        {sinComprobar.map((fila) => (
          <div key={fila.id} className="panel-guardia-card guardia-ausente">
            <div>
              <strong>{fila.asistente || '—'}</strong>{' '}
              <span className={claseBadgeTono(TONO.INFO)}>
                {t.pase_de_guardia[`momento_${fila.momento}`] ?? fila.momento}
              </span>
              <div>{horario(fila)}</div>
              <div>{t.pase_de_guardia.ocurrida_en}: {aLaHora(fila.ocurridaEn)}</div>
              <div>
                {t.pase_de_guardia.col_motivo}: {t.pase_de_guardia[`motivo_${fila.motivo}`] ?? fila.motivo}
              </div>
              {fila.detalle && <p className="panel-resultado-calculo">{fila.detalle}</p>}
            </div>
            <div className="panel-modal-acciones">
              <Button onClick={() => setCerrando(fila)}>{t.pase_de_guardia.cerrar_accion}</Button>
            </div>
          </div>
        ))}
      </EstadoLista>

      {cerrando && (
        <CerrarSinComprobar
          fila={cerrando}
          onClose={() => setCerrando(null)}
          onCerrado={() => {
            setCerrando(null);
            recargarSinComprobar();
          }}
        />
      )}
    </div>
  );
}

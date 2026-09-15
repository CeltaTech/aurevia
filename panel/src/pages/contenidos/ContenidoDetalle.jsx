import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiContenidos } from '../../lib/apiContenidos';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';

/* Una pieza de la biblioteca, para escribirla o cambiarla.
   ==========================================================================

   El texto se guarda tal como lo escribe la Prestadora y no se traduce: lo escribió una persona,
   en su idioma, para las Familias que ella atiende. Lo traducido es el marco de esta pantalla.

   El enlace es opcional y tiene que empezar con `https://`. Acá no se suben archivos.

   Lo que se escribe no se publica solo: el interruptor de abajo es lo que decide si la Familia lo
   ve, y una pieza nueva nace sin publicar. */
export function ContenidoDetalle({ contenido, soloLectura, onClose, onGuardado }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const esNuevo = !contenido;

  const [titulo, setTitulo] = useState(contenido?.titulo || '');
  const [cuerpo, setCuerpo] = useState(contenido?.cuerpo || '');
  const [enlace, setEnlace] = useState(contenido?.enlace_url || '');
  const [orden, setOrden] = useState(contenido?.orden ?? 0);
  const [publicado, setPublicado] = useState(contenido?.publicado ?? false);
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [error, setError] = useState(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApiContenidos(esNuevo ? '/' : `/${contenido.id}`, {
        method: esNuevo ? 'POST' : 'PATCH',
        body: JSON.stringify({
          titulo,
          cuerpo,
          enlace_url: enlace,
          orden,
          publicado,
        }),
      });
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, t));
      setGuardando(false);
    }
  }

  async function borrar() {
    setBorrando(true);
    setError(null);
    try {
      await llamarApiContenidos(`/${contenido.id}`, { method: 'DELETE' });
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, t));
      setBorrando(false);
    }
  }

  const ocupado = guardando || borrando;

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{esNuevo ? t.contenidos.nuevo : contenido.titulo}</h2>

        {error && <Alert variant="error">{error}</Alert>}

        <FormField
          label={t.contenidos.campo_titulo}
          name="titulo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          disabled={soloLectura}
          required
        />

        <FormField
          label={t.contenidos.campo_cuerpo}
          name="cuerpo"
          type="textarea"
          rows={10}
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          disabled={soloLectura}
          required
        />

        <FormField
          label={t.contenidos.campo_enlace}
          name="enlace_url"
          value={enlace}
          onChange={(e) => setEnlace(e.target.value)}
          disabled={soloLectura}
        />
        <p className="panel-explicacion">{t.contenidos.campo_enlace_explicacion}</p>

        <FormField
          label={t.contenidos.campo_orden}
          name="orden"
          type="number"
          value={orden}
          onChange={(e) => setOrden(e.target.value)}
          disabled={soloLectura}
        />

        <FormField
          label={t.contenidos.campo_publicado}
          name="publicado"
          type="checkbox"
          checked={publicado}
          onChange={(e) => setPublicado(e.target.checked)}
          disabled={soloLectura}
        />
        <p className="panel-explicacion">{t.contenidos.campo_publicado_explicacion}</p>

        {/* Borrar es definitivo y por eso se pregunta antes, diciendo qué se va a hacer y cómo
            cancelar. No lo apunta nadie: acá no queda ningún vínculo colgando. */}
        {confirmandoBorrado && (
          <Alert variant="warning">
            <p>{t.contenidos.borrar_confirmar}</p>
            <Button variant="secondary" onClick={() => setConfirmandoBorrado(false)} disabled={ocupado}>
              {t.comun.cancelar}
            </Button>{' '}
            <Button onClick={borrar} disabled={ocupado}>
              {borrando ? t.comun.guardando : t.contenidos.borrar_si}
            </Button>
          </Alert>
        )}

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={ocupado}>
            {soloLectura ? t.comun.cerrar : t.comun.cancelar}
          </Button>
          {!soloLectura && !esNuevo && !confirmandoBorrado && (
            <Button variant="secondary" onClick={() => setConfirmandoBorrado(true)} disabled={ocupado}>
              {t.contenidos.borrar}
            </Button>
          )}
          {!soloLectura && (
            <Button onClick={guardar} disabled={ocupado}>
              {guardando ? t.comun.guardando : t.comun.guardar}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

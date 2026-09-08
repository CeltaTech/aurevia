import { useCallback, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiPanel } from '../../lib/apiPanel';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';

/* Qué ve cada persona del círculo de cuidado.
   ==========================================================================

   POR QUÉ EXISTE ESTA PANTALLA. Hasta acá, cualquiera que la Prestadora anotara en el círculo
   familiar veía exactamente lo mismo que el titular, y no había forma de darle menos a uno que
   a otro. Ahora el titular dice qué puede ver cada uno.

   QUIÉN DECIDE, QUE NO ES UN DETALLE. El titular no configura nada por su cuenta: le dice a la
   Prestadora qué puede ver cada persona de su círculo, la Prestadora lo carga acá, y al guardar
   el motor arma el documento en castellano con eso escrito. El titular lo firma —en papel o
   confirmándolo desde su aplicación—, y así, el día que alguien diga «yo nunca autoricé eso»,
   está la instrucción con nombre, fecha y firma. Por eso el documento aparece DESPUÉS de
   guardar: lo escribe el motor, que es el único que sabe qué quedó guardado.

   LA LISTA NO SE ESCRIBE ACÁ. Las once casillas, con su descripción y su ayuda, viven en
   `backend/src/utils/catalogoCirculoFamiliar.js`, que es el único lugar donde se agrega o se
   saca una. Esta pantalla dibuja lo que le llega, en el orden que le llega: una casilla nueva
   aparece sola, sin tocar este archivo.

   SE MANDA UNA SOLA INSTRUCCIÓN CON TODO. No una por persona ni una por casilla: lo que el
   titular firma es el estado completo de su círculo en una fecha. Guardar de a pedacitos
   dejaría al titular firmando algo distinto de lo que rige. */

/* Las dos casillas que «Sólo mirar» apaga: son las únicas del catálogo con las que alguien
   del círculo ESCRIBE algo —calificar al trabajador, pedir un cambio de medicación—; el resto
   sólo deja leer. Están escritas acá y en ningún otro lado de esta pantalla. El día que el
   catálogo sume una tercera acción de escritura, el motor tendría que decir cuáles son en vez
   de que el Panel las conozca de memoria; mientras sean estas dos, la lista alcanza. */
const ACCIONES_QUE_ESCRIBEN = ['circulo_califica_al_asistente', 'circulo_pide_medicacion'];

/* De la respuesta del motor a lo que la pantalla va tildando: { usuarioId: { clave: bool } }.
   `permitido` ya viene con el tope de la Prestadora aplicado, así que lo topado arranca apagado
   sin que esta pantalla tenga que resolverlo de nuevo. */
function accesosElegidosDe(miembros) {
  return Object.fromEntries(
    (miembros ?? []).map((miembro) => [
      miembro.usuarioId,
      Object.fromEntries((miembro.accesos ?? []).map((acceso) => [acceso.clave, acceso.permitido])),
    ]),
  );
}

export function AccesosDelCirculoModal({ familiaId, miembros, puedeEditar, usuarioIdInicial, onClose, onGuardado }) {
  const { t } = useLocale();
  const [elegido, setElegido] = useState(() => accesosElegidosDe(miembros));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [documento, setDocumento] = useState(null);

  /* Con el documento en pantalla la instrucción ya se guardó, así que cerrar tiene que avisarle
     a la pantalla de atrás para que se vuelva a leer: si sólo cerrara, la tabla seguiría
     mostrando los accesos viejos y el cartel de la firma pendiente no aparecería. */
  const cerrar = useCallback(() => {
    if (documento) {
      onGuardado();
      return;
    }
    onClose();
  }, [documento, onGuardado, onClose]);

  const modal = useModalAccesible(cerrar);

  /* La persona desde cuyo renglón se abrió la ventana queda a la vista sola. Sin esto, en un
     círculo de cinco personas hay que buscarla a mano en una lista larga. */
  const seccionInicial = useCallback((nodo) => {
    nodo?.scrollIntoView?.({ block: 'start' });
  }, []);

  function cambiar(usuarioId, clave, valor) {
    setElegido((anterior) => ({ ...anterior, [usuarioId]: { ...anterior[usuarioId], [clave]: valor } }));
  }

  /* Los atajos escriben las casillas, no un dato aparte: lo que se guarda —y lo que va a decir
     el documento— es siempre el estado de las once. Un «modo» guardado al lado tendría que
     volver a interpretarse en cada lugar que lea los accesos, y ahí empiezan las dos verdades. */
  function aplicarAtajo(miembro, modo) {
    setElegido((anterior) => ({
      ...anterior,
      [miembro.usuarioId]: Object.fromEntries(
        (miembro.accesos ?? []).map((acceso) => [
          acceso.clave,
          // Lo que la Prestadora tiene apagado para toda su aplicación no lo enciende ningún
          // atajo: ese tope no lo puede levantar la instrucción de una Familia.
          acceso.topado ? false : modo === 'todo' || !ACCIONES_QUE_ESCRIBEN.includes(acceso.clave),
        ]),
      ),
    }));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const resultado = await llamarApiPanel(`/cuentas/familia/${familiaId}/circulo/instruccion`, {
        method: 'POST',
        body: JSON.stringify({ accesos: elegido }),
      });
      setDocumento(resultado.instruccion.documento_texto);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  if (documento) {
    return <DocumentoDeLaInstruccion texto={documento} onCerrar={cerrar} recienGuardado />;
  }

  return (
    <div className="panel-modal-fondo" onClick={cerrar}>
      <div className="panel-modal panel-modal-ancho" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.familias.circulo.accesos_titulo}</h2>
        <p className="panel-explicacion">{t.familias.circulo.accesos_explicacion}</p>

        {error && <Alert variant="error">{error}</Alert>}

        {(miembros ?? []).map((miembro) => (
          <div
            key={miembro.usuarioId}
            className="circulo-persona"
            ref={miembro.usuarioId === usuarioIdInicial ? seccionInicial : undefined}
          >
            <h3>{miembro.nombre || miembro.email || '—'}</h3>
            <p className="panel-explicacion">{miembro.email || '—'}</p>

            {puedeEditar && (
              <div className="circulo-atajos">
                <Button variant="secondary" onClick={() => aplicarAtajo(miembro, 'todo')} disabled={guardando}>
                  {t.familias.circulo.accesos_darle_todo}
                </Button>
                <Button variant="secondary" onClick={() => aplicarAtajo(miembro, 'solo_mirar')} disabled={guardando}>
                  {t.familias.circulo.accesos_solo_mirar}
                </Button>
              </div>
            )}

            {(miembro.accesos ?? []).map((acceso) => (
              <FormField
                key={acceso.clave}
                // El nombre lleva adentro a quién pertenece la casilla: la misma clave aparece
                // una vez por persona, y dos campos con el mismo identificador dejan la etiqueta
                // apuntando siempre al primero.
                name={`${miembro.usuarioId}-${acceso.clave}`}
                type="checkbox"
                label={acceso.descripcion}
                ayuda={
                  acceso.topado ? (
                    <>
                      {acceso.ayuda} <strong>{t.familias.circulo.accesos_topado}</strong>
                    </>
                  ) : (
                    acceso.ayuda
                  )
                }
                checked={elegido[miembro.usuarioId]?.[acceso.clave] ?? false}
                disabled={acceso.topado || !puedeEditar || guardando}
                onChange={(e) => cambiar(miembro.usuarioId, acceso.clave, e.target.checked)}
              />
            ))}
          </div>
        ))}

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={cerrar} disabled={guardando}>
            {puedeEditar ? t.comun.cancelar : t.comun.cerrar}
          </Button>
          {puedeEditar && (
            <Button onClick={guardar} disabled={guardando}>
              {guardando ? t.comun.guardando : t.familias.circulo.accesos_guardar}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* El texto que firma el titular, tal como lo escribió el motor.
   ==========================================================================

   El Panel no lo arma ni lo retoca: lo muestra. El documento tiene que decir exactamente lo
   mismo que quedó guardado, y el único que sabe qué quedó guardado es quien lo guardó.

   Se imprime con el mismo mecanismo que el informe para la Obra Social: `#area-imprimible` es
   lo único que la hoja conserva (ver la regla `@media print` de `index.css`), y los botones
   llevan `no-imprimir` para no salir en el papel que alguien va a firmar. */
export function DocumentoDeLaInstruccion({ texto, fecha, recienGuardado = false, onCerrar }) {
  const { t } = useLocale();
  const modal = useModalAccesible(onCerrar);

  return (
    <div className="panel-modal-fondo" onClick={onCerrar}>
      <div className="panel-modal panel-modal-ancho" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <div className="no-imprimir">
          <h2 id={modal.idTitulo}>{t.familias.circulo.documento_titulo}</h2>
          {recienGuardado && <Alert variant="success">{t.familias.circulo.documento_guardado}</Alert>}
          <p className="panel-explicacion">{t.familias.circulo.documento_explicacion}</p>
          {fecha && (
            <dl className="panel-detalle-lista">
              <dt>{t.familias.circulo.documento_fecha}</dt>
              <dd>{new Date(fecha).toLocaleDateString()}</dd>
            </dl>
          )}
        </div>

        <div id="area-imprimible">
          <div className="documento-instruccion">{texto}</div>
        </div>

        <div className="panel-modal-acciones no-imprimir">
          <Button variant="secondary" onClick={onCerrar}>
            {t.comun.cerrar}
          </Button>
          <Button onClick={() => window.print()}>{t.familias.circulo.documento_imprimir}</Button>
        </div>
      </div>
    </div>
  );
}

/* Registrar que llegó el papel firmado.
   ==========================================================================

   El archivo es opcional a propósito: lo que cierra la instrucción es que la Prestadora declare
   que el titular firmó, y hay Prestadoras que archivan el papel afuera del sistema. Obligar a
   subirlo dejaría instrucciones firmadas sin poder registrarse, que es peor que registrarlas
   sin adjunto. */
export function RegistrarPapelFirmadoModal({ familiaId, instruccionId, onClose, onRegistrado }) {
  const { t } = useLocale();
  const modal = useModalAccesible(onClose);
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function registrar() {
    setGuardando(true);
    setError(null);
    try {
      const cuerpo = new FormData();
      if (archivo) cuerpo.append('archivo', archivo);
      await llamarApiPanel(`/cuentas/familia/${familiaId}/circulo/instruccion/${instruccionId}/papel`, {
        method: 'POST',
        body: cuerpo,
      });
      onRegistrado();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.familias.circulo.papel_titulo}</h2>
        <p className="panel-explicacion">{t.familias.circulo.papel_explicacion}</p>

        {error && <Alert variant="error">{error}</Alert>}

        <FormField
          label={t.familias.circulo.papel_archivo}
          name="papel_firmado"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          ayuda={t.familias.circulo.papel_archivo_ayuda}
          onChange={(e) => setArchivo(e.target.files?.[0] || null)}
        />

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            {t.comun.cancelar}
          </Button>
          <Button onClick={registrar} disabled={guardando}>
            {guardando ? t.familias.circulo.papel_registrando : t.familias.circulo.papel_confirmar}
          </Button>
        </div>
      </div>
    </div>
  );
}

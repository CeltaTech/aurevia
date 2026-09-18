import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { traducirValor } from '../../i18n/valores';
import { con } from '../../lib/textos';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { FINANCIADORES, FINANCIADORES_POSIBLES } from '../../lib/facturacionDeFamilias';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';

/* Lo que el Pagador firma, y los papeles que se le piden.
   ==========================================================================

   EL TEXTO ES DE LA PRESTADORA. Es un documento hacia un tercero suyo, no hacia CeltaTech, así
   que lo escribe, lo adopta o lo reemplaza ella. El producto le entrega un modelo a título de
   sugerencia y nada más, y esta pantalla es donde se lo entrega: acá lo tiene delante, y puede
   editarlo, poner el suyo o dejar el modelo. Que es un modelo, que no es asesoramiento legal y
   que adoptarlo es decisión suya se lo dice esta pantalla, no el papel que firma el Pagador.

   VACIARLO NO LA DEJA SIN TEXTO: vuelve a regir el modelo del producto. Así, el día que el
   modelo mejore, ninguna Prestadora queda con la versión vieja sin haber decidido nada. */
export function ConsentimientoPagadorTab() {
  const { t } = useLocale();

  return (
    <div>
      <h2>{t.configuracion.consentimiento_pagador_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.consentimiento_pagador_explicacion}</p>
      <ElTextoQueFirma />
      <LosPapelesQueSePiden />
    </div>
  );
}

function ElTextoQueFirma() {
  const { t } = useLocale();
  const [datos, setDatos] = useState(null);
  const [cuerpo, setCuerpo] = useState('');
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const vigente = await llamarApi('/consentimiento-pagador');
      setDatos(vigente);
      setCuerpo(vigente.cuerpo ?? '');
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/consentimiento-pagador', {
        method: 'PUT',
        body: JSON.stringify({ cuerpo }),
      });
      setGuardado(true);
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
      {datos && (
        <div>
          {error && <Alert variant="error">{error}</Alert>}
          {guardado && <Alert variant="info">{t.configuracion.consentimiento_pagador_guardado}</Alert>}

          {/* De dónde salió el texto que se está viendo. Sin esto, quien lo lee no puede saber si
              está mirando algo que decidió su Prestadora o algo que vino de fábrica. */}
          <Alert variant="info">
            {datos.esDelProducto
              ? t.configuracion.consentimiento_pagador_es_modelo
              : t.configuracion.consentimiento_pagador_es_propio}
          </Alert>

          <FormField
            label={t.configuracion.consentimiento_pagador_cuerpo}
            name="consentimiento_pagador_cuerpo"
            type="textarea"
            rows={20}
            value={cuerpo}
            onChange={(e) => {
              setCuerpo(e.target.value);
              setGuardado(false);
            }}
          />

          {/* Los marcadores los manda el motor, del mismo archivo que después los reemplaza: la
              lista no se puede despegar de lo que de verdad anda. */}
          <p className="panel-explicacion">
            {t.configuracion.consentimiento_pagador_marcadores} {datos.marcadores.join('  ')}
          </p>
          {/* Uno de los marcadores no se comporta como los demás, y quien escriba su propio texto
              no tiene cómo adivinarlo. */}
          <p className="panel-explicacion">
            {t.configuracion.consentimiento_pagador_marcador_apoderado}
          </p>

          <Button onClick={guardar} disabled={guardando}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>{' '}
          {!datos.esDelProducto && (
            <Button
              variant="secondary"
              onClick={() => {
                setCuerpo('');
                setGuardado(false);
              }}
              disabled={guardando}
            >
              {t.configuracion.consentimiento_pagador_volver_al_modelo}
            </Button>
          )}
        </div>
      )}
    </EstadoLista>
  );
}

/* Qué papeles exige cada financiador.

   El producto no siembra ninguno: eso lo sabe la Prestadora que trabaja con ese financiador, y
   adivinarlo desde acá sería inventar un requisito que nadie pidió. Vacío quiere decir «no se
   exige ninguno», y es una respuesta válida. */
function LosPapelesQueSePiden() {
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [tipos, setTipos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [creandoNuevo, setCreandoNuevo] = useState(false);
  const [enCurso, setEnCurso] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { tipos: filas } = await llamarApi('/documentos-pagador');
      setTipos(filas);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function toggleActivo(tipo) {
    setEnCurso(tipo.id);
    setError(null);
    try {
      await llamarApi(`/documentos-pagador/${tipo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !tipo.activo }),
      });
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setEnCurso(null);
    }
  }

  // No se borra: se apaga. Un tipo borrado se llevaría puestos los papeles ya cargados con él, y
  // lo que se quiso decir es «esto ya no se pide más», no «esto nunca se pidió».
  async function dejarDePedir(tipo) {
    if (!(await confirmarDestructivo(t.configuracion.papeles_pagador_confirmar_apagar))) return;
    setEnCurso(tipo.id);
    setError(null);
    try {
      await llamarApi(`/documentos-pagador/${tipo.id}`, { method: 'DELETE' });
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setEnCurso(null);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.papeles_pagador_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.papeles_pagador_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}

      <div className="panel-filtros">
        <Button onClick={() => setCreandoNuevo(true)}>{t.configuracion.papeles_pagador_nuevo}</Button>
      </div>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && tipos.length === 0}
        recargar={recargar}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.papeles_pagador_col_nombre}</th>
              <th>{t.configuracion.papeles_pagador_col_financiador}</th>
              <th>{t.configuracion.papeles_pagador_col_vencimiento}</th>
              <th>{t.configuracion.papeles_pagador_col_activo}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tipos.map((tipo) => (
              <tr key={tipo.id}>
                <td>{tipo.nombre}</td>
                <td>
                  {tipo.financiador_tipo
                    ? traducirValor(t.familias, `financiador_${tipo.financiador_tipo}`)
                    : t.configuracion.papeles_pagador_todos_los_financiadores}
                </td>
                <td>{tipo.requiere_vencimiento ? t.comun.si : t.comun.no}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={tipo.activo}
                    onChange={() => toggleActivo(tipo)}
                    disabled={enCurso === tipo.id}
                    aria-label={con(t.comun.campo_de_fila, {
                      campo: t.configuracion.papeles_pagador_col_activo,
                      nombre: tipo.nombre,
                    })}
                  />
                </td>
                <td>
                  {tipo.activo && (
                    <button onClick={() => dejarDePedir(tipo)} disabled={enCurso === tipo.id}>
                      {t.configuracion.papeles_pagador_dejar_de_pedir}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNuevo && (
        <NuevoPapelDelPagador
          onClose={() => setCreandoNuevo(false)}
          onCreado={() => {
            setCreandoNuevo(false);
            recargar();
          }}
        />
      )}
    </div>
  );
}

function NuevoPapelDelPagador({ onClose, onCreado }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const [nombre, setNombre] = useState('');
  const [financiador, setFinanciador] = useState('');
  const [requiereVencimiento, setRequiereVencimiento] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/documentos-pagador', {
        method: 'POST',
        body: JSON.stringify({
          nombre,
          financiador_tipo: financiador || null,
          requiere_vencimiento: requiereVencimiento,
        }),
      });
      onCreado();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.configuracion.papeles_pagador_nuevo}</h2>
        {error && <Alert variant="error">{error}</Alert>}

        <FormField
          label={t.configuracion.papeles_pagador_col_nombre}
          name="papel_pagador_nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
        />

        {/* Vacío es «a todos los financiadores», y así se guarda. La Familia no aparece en la
            lista: cuando paga la Familia no hay financiador a quien pedirle papeles. */}
        <FormField
          label={t.configuracion.papeles_pagador_col_financiador}
          name="papel_pagador_financiador"
          type="select"
          value={financiador}
          onChange={(e) => setFinanciador(e.target.value)}
        >
          <option value="">{t.configuracion.papeles_pagador_todos_los_financiadores}</option>
          {FINANCIADORES_POSIBLES.filter((f) => f !== FINANCIADORES.FAMILIA).map((f) => (
            <option key={f} value={f}>
              {traducirValor(t.familias, `financiador_${f}`)}
            </option>
          ))}
        </FormField>

        <FormField
          label={t.configuracion.papeles_pagador_col_vencimiento}
          name="papel_pagador_vencimiento"
          type="checkbox"
          checked={requiereVencimiento}
          onChange={(e) => setRequiereVencimiento(e.target.checked)}
        />

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            {t.comun.cancelar}
          </Button>
          <Button onClick={guardar} disabled={guardando || !nombre.trim()}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

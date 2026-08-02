import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { TiposAsistenteTab } from './TiposAsistenteTab';

/* Cómo es el plantel: qué tipos de Asistente existen —con sus tareas y su
   matrícula— y qué documentación se les exige. */
export function ConfiguracionAsistentes() {
  return (
    <>
      <TiposAsistenteTab />
      <TabDocumentos />
    </>
  );
}

function TabDocumentos() {
  const { t } = useLocale();
  const [tipos, setTipos] = useState([]);
  const [diasAviso, setDiasAviso] = useState('');
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [creandoNuevo, setCreandoNuevo] = useState(false);
  const [actualizandoId, setActualizandoId] = useState(null);
  const [guardandoPlazo, setGuardandoPlazo] = useState(false);
  const [plazoGuardado, setPlazoGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { tipos: filas, dias_aviso_vencimiento_documentos } = await llamarApi('/documentos-tipo');
      setTipos(filas);
      setDiasAviso(String(dias_aviso_vencimiento_documentos));
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function toggleActivo(fila) {
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/documentos-tipo/${fila.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nombre: fila.nombre, requiere_vencimiento: fila.requiere_vencimiento, activo: !fila.activo }),
      });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  async function guardarPlazo() {
    setGuardandoPlazo(true);
    setError(null);
    setPlazoGuardado(false);
    try {
      await llamarApi('/documentos-tipo/plazo-aviso', {
        method: 'PATCH',
        body: JSON.stringify({ dias: Number(diasAviso) }),
      });
      setPlazoGuardado(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoPlazo(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.documentos_plazo_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.documentos_plazo_explicacion}</p>
      {error && <Alert variant="error">{error}</Alert>}
      {plazoGuardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      <FormField
        label={t.configuracion.documentos_plazo_dias}
        name="dias_aviso"
        type="number"
        value={diasAviso}
        onChange={(e) => { setDiasAviso(e.target.value); setPlazoGuardado(false); }}
      />
      <Button onClick={guardarPlazo} disabled={guardandoPlazo || !diasAviso}>
        {guardandoPlazo ? t.comun.guardando : t.comun.guardar}
      </Button>

      <h2>{t.configuracion.documentos_tipos_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.documentos_tipos_explicacion}</p>
      <div className="panel-filtros">
        <Button onClick={() => setCreandoNuevo(true)}>{t.configuracion.documentos_tipos_nuevo}</Button>
      </div>
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && tipos.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.documentos_tipos_col_nombre}</th>
              <th>{t.configuracion.documentos_tipos_col_requiere_vencimiento}</th>
              <th>{t.configuracion.documentos_tipos_col_activo}</th>
            </tr>
          </thead>
          <tbody>
            {tipos.map((tipo) => (
              <tr key={tipo.id}>
                <td>{tipo.nombre}</td>
                <td>{tipo.requiere_vencimiento ? t.comun.si : t.comun.no}</td>
                <td>
                  <input type="checkbox" checked={tipo.activo} onChange={() => toggleActivo(tipo)} disabled={actualizandoId === tipo.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNuevo && (
        <NuevoTipoDocumento onClose={() => setCreandoNuevo(false)} onCreado={() => { setCreandoNuevo(false); recargar(); }} />
      )}
    </div>
  );
}

function NuevoTipoDocumento({ onClose, onCreado }) {
  const { t } = useLocale();
  const [nombre, setNombre] = useState('');
  const [requiereVencimiento, setRequiereVencimiento] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/documentos-tipo', {
        method: 'POST',
        body: JSON.stringify({ nombre, requiere_vencimiento: requiereVencimiento }),
      });
      onCreado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.configuracion.documentos_tipos_nuevo}</h2>
        {error && <Alert variant="error">{error}</Alert>}
        <FormField label={t.configuracion.documentos_tipos_col_nombre} name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        <FormField
          label={t.configuracion.documentos_tipos_col_requiere_vencimiento}
          name="requiere_vencimiento"
          type="checkbox"
          checked={requiereVencimiento}
          onChange={(e) => setRequiereVencimiento(e.target.checked)}
        />
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={handleGuardar} disabled={guardando || !nombre}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

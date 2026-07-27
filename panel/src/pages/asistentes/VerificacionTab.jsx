import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { useEtapasIncorporacion } from '../../hooks/useEtapasIncorporacion';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';

const ESTADOS = ['pendiente', 'aprobada', 'rechazada'];

export function VerificacionTab({ asistente }) {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const { filas: etapas, estado: estadoEtapas, error: errorEtapas } = useEtapasIncorporacion(asistente.prestadora_id);
  const [verificaciones, setVerificaciones] = useState([]);
  const [estadoCarga, setEstadoCarga] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardandoEtapa, setGuardandoEtapa] = useState(null);

  const recargar = useCallback(async () => {
    setEstadoCarga('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('verificaciones_asistente')
      .select('*')
      .eq('asistente_id', asistente.id);
    if (errorConsulta) {
      setError(errorConsulta.message);
      setEstadoCarga('error');
      return;
    }
    setVerificaciones(data ?? []);
    setEstadoCarga('listo');
  }, [asistente.id]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function actualizarEtapa(fila, cambios) {
    setGuardandoEtapa(fila.etapa);
    setError(null);
    const completaAhora = cambios.estado && cambios.estado !== 'pendiente' && fila.estado === 'pendiente';
    const { error: errorUpdate } = await supabase
      .from('verificaciones_asistente')
      .update({
        ...cambios,
        revisado_por: completaAhora ? usuario?.id : fila.revisado_por,
        completado_en: completaAhora ? new Date().toISOString() : fila.completado_en,
      })
      .eq('id', fila.id);
    setGuardandoEtapa(null);
    if (errorUpdate) {
      setError(t.comun.error_generico);
      return;
    }
    recargar();
  }

  const todasAprobadas = verificaciones.length > 0 && verificaciones.every((v) => v.estado === 'aprobada');
  const estadoCombinado = estadoCarga === 'error' || estadoEtapas === 'error'
    ? 'error'
    : (estadoCarga === 'listo' && estadoEtapas === 'listo' ? 'listo' : 'cargando');

  return (
    <div>
      <h2>{t.asistentes.verificacion.titulo}</h2>
      <p className="panel-explicacion">{t.asistentes.verificacion.explicacion}</p>
      {(error || errorEtapas) && <Alert variant="error">{error || errorEtapas}</Alert>}
      {todasAprobadas && <Alert variant="info">{t.asistentes.verificacion.proceso_completo}</Alert>}

      <EstadoLista estado={estadoCombinado} error={error || errorEtapas} vacio={estadoCombinado === 'listo' && verificaciones.length === 0} recargar={recargar}>
        {etapas.map((etapaFila) => {
          const fila = verificaciones.find((v) => v.etapa === etapaFila.clave);
          if (!fila) return null;
          return (
            <div key={etapaFila.clave} className="panel-card-verificacion">
              <h3>{etapaFila.nombre}</h3>
              <FormField
                label={t.asistentes.verificacion.col_estado}
                name={`estado-${etapaFila.clave}`}
                type="select"
                value={fila.estado}
                onChange={(e) => actualizarEtapa(fila, { estado: e.target.value })}
                disabled={guardandoEtapa === etapaFila.clave}
              >
                {ESTADOS.map((estadoOpcion) => (
                  <option key={estadoOpcion} value={estadoOpcion}>{t.asistentes.verificacion[`estado_${estadoOpcion}`]}</option>
                ))}
              </FormField>
              <FormField
                label={t.comun.nota_interna}
                name={`notas-${etapaFila.clave}`}
                type="textarea"
                value={fila.notas || ''}
                onChange={(e) => setVerificaciones((prev) => prev.map((v) => (v.id === fila.id ? { ...v, notas: e.target.value } : v)))}
                onBlur={() => actualizarEtapa(fila, { notas: fila.notas || '' })}
                disabled={guardandoEtapa === etapaFila.clave}
              />
              {fila.completado_en && (
                <p className="panel-explicacion">
                  {t.asistentes.verificacion.completado_en} {new Date(fila.completado_en).toLocaleDateString()}
                </p>
              )}
              {guardandoEtapa === etapaFila.clave && <p className="panel-explicacion">{t.comun.guardando}</p>}
            </div>
          );
        })}
      </EstadoLista>
    </div>
  );
}

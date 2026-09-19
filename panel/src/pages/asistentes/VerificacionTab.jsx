import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { useEtapasIncorporacion } from '../../hooks/useEtapasIncorporacion';
import { yaCargo } from '../../hooks/useCatalogo';
import { supabase } from '../../lib/supabaseClient';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { avanceDeIncorporacion } from '../../lib/avanceDeIncorporacion';
import { FotosDeIdentidad } from './FotosDeIdentidad';
import { ReferenciasLaborales } from './ReferenciasLaborales';

const ESTADOS = ['pendiente', 'aprobada', 'rechazada'];

export function VerificacionTab({ asistente }) {
  const { t, locale } = useLocale();
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
      setError(mensajeDeError(errorConsulta, t));
      setEstadoCarga('error');
      return;
    }
    setVerificaciones(data ?? []);
    setEstadoCarga('listo');
  }, [asistente.id, t]);

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

  // Cuánto lleva hecho, contado contra el catálogo de etapas de esta Prestadora y no contra las
  // filas guardadas: son ellas las que arman su proceso y lo cambian cuando quieren.
  const avance = avanceDeIncorporacion(etapas, verificaciones);
  const estadoCombinado = estadoCarga === 'error' || estadoEtapas === 'error'
    ? 'error'
    : (estadoCarga === 'listo' && yaCargo(estadoEtapas) ? 'listo' : 'cargando');

  return (
    <div>
      <h2>{t.asistentes.verificacion.titulo}</h2>
      <p className="panel-explicacion">{t.asistentes.verificacion.explicacion}</p>
      {(error || errorEtapas) && <Alert variant="error">{error || errorEtapas}</Alert>}
      {estadoCombinado === 'listo' && avance.completo && <Alert variant="info">{t.asistentes.verificacion.proceso_completo}</Alert>}

      {/* Cuánto lleva hecho, en una línea y con barra. Sin etapas configuradas no se muestra: un
          contador de cero sobre cero no dice nada, y lo que hay que resolver ahí es cargar el
          catálogo, que se hace en Configuración. */}
      {estadoCombinado === 'listo' && avance.hayEtapas && (
        <div className="panel-avance-incorporacion">
          <p className="panel-avance-texto">
            {t.asistentes.verificacion.avance
              .replace('{{aprobadas}}', avance.aprobadas)
              .replace('{{total}}', avance.total)
              .replace('{{porcentaje}}', avance.porcentaje)}
            {avance.rechazadas > 0 && ` · ${t.asistentes.verificacion.avance_rechazadas.replace('{{rechazadas}}', avance.rechazadas)}`}
          </p>
          <div
            className="panel-avance-barra"
            role="progressbar"
            aria-valuenow={avance.porcentaje}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t.asistentes.verificacion.titulo}
          >
            <span style={{ width: `${avance.porcentaje}%` }} />
          </div>
        </div>
      )}

      {/* Antes de las etapas, y afuera de su lista: las dos fotos son de la persona y no de una
          etapa, porque las claves de las etapas las inventa cada Prestadora y ninguna se puede
          nombrar desde acá. Carga sus propios datos, así que trae sus propios cuatro estados. */}
      <FotosDeIdentidad asistente={asistente} />

      {/* Y por el mismo motivo, las referencias laborales: son de la persona, llegan solas desde
          su postulación y ninguna clave de etapa las puede nombrar. También trae sus cuatro
          estados, porque también carga sus propios datos. */}
      <ReferenciasLaborales asistente={asistente} />

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
                  {t.asistentes.verificacion.completado_en} {new Date(fila.completado_en).toLocaleDateString(locale)}
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

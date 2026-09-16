import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiPanel } from '../../lib/apiPanel';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';

/**
 * Los descansos de una guardia larga, vistos y anotados desde el Panel.
 *
 * QUÉ ES UN DESCANSO ACÁ. Hay guardias de 24, 48 y 72 horas que cubre una sola persona, y nadie
 * puede estar dos días sin dormir: en el domicilio se descansa, generalmente de noche, cuando el
 * Paciente duerme, sin dejar de estar disponible. Eso no se descuenta de lo que se le paga, no
 * interrumpe el turno y no la saca de la guardia. No es una ausencia.
 *
 * POR QUÉ LA COORDINADORA TAMBIÉN LO ANOTA. La Asistente lo marca desde su guardia en curso, pero
 * la que estuvo cuarenta y ocho horas adentro puede haberse olvidado, y ese rato igual existió.
 *
 * ACÁ SE ANOTA UN RATO YA TERMINADO, con su principio y su fin. Empezar uno abierto es de la
 * Asistente, que es la que está adentro.
 *
 * POR QUÉ PASA POR EL MOTOR. La migración que crea la tabla sólo le dio permiso de lectura a quien
 * tiene sesión: escribir es del motor, que además resuelve la Prestadora por la Organización activa
 * de quien llama y no por lo que venga en el pedido.
 */
export function DescansosDeLaGuardia({ guardiaId }) {
  const { t } = useLocale();
  const tr = t.guardias.detalle.descansos;
  const [descansos, setDescansos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const { descansos: filas } = await llamarApiPanel(`/guardias/${guardiaId}/descansos`);
      setDescansos(filas ?? []);
    } catch (e) {
      setError(mensajeDeError(e, t));
    } finally {
      setCargando(false);
    }
  }, [guardiaId, t]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function handleAnotar() {
    setError(null);
    setGuardando(true);
    try {
      await llamarApiPanel(`/guardias/${guardiaId}/descansos`, {
        method: 'POST',
        body: JSON.stringify({
          inicio_at: new Date(inicio).toISOString(),
          fin_at: new Date(fin).toISOString(),
          nota: nota.trim() || null,
        }),
      });
      setInicio('');
      setFin('');
      setNota('');
      await cargar();
    } catch (e) {
      setError(mensajeDeError(e, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-resultado-calculo">
      <h3>{tr.titulo}</h3>
      <p className="panel-explicacion">{tr.explicacion}</p>

      {error && <Alert variant="error">{error}</Alert>}

      {cargando && <p className="panel-explicacion">{t.comun.cargando}</p>}

      {!cargando && descansos.length === 0 && <p className="panel-explicacion">{tr.vacio}</p>}

      {!cargando && descansos.length > 0 && (
        <ul className="panel-momentos-registrados">
          {descansos.map((d) => (
            <li key={d.id}>
              {new Date(d.inicio_at).toLocaleString()} –{' '}
              {d.fin_at ? new Date(d.fin_at).toLocaleString() : tr.en_curso}
              {d.nota ? ` · ${d.nota}` : ''}
            </li>
          ))}
        </ul>
      )}

      <FormField
        label={tr.inicio}
        name="descanso_inicio"
        type="datetime-local"
        value={inicio}
        onChange={(e) => setInicio(e.target.value)}
      />
      <FormField
        label={tr.fin}
        name="descanso_fin"
        type="datetime-local"
        value={fin}
        onChange={(e) => setFin(e.target.value)}
      />
      <FormField
        label={tr.nota}
        name="descanso_nota"
        ayuda={tr.nota_ayuda}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
      />
      <Button variant="secondary" onClick={handleAnotar} disabled={guardando || !inicio || !fin}>
        {guardando ? tr.anotando : tr.anotar}
      </Button>
    </div>
  );
}

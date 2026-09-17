import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';

/* Cómo se le paga el período a quien cobra un monto fijo.
   ==========================================================================

   ES UNA SOLA PREGUNTA, Y APARECE UNA VEZ CADA TANTO. A quien cobra por hora o por guardia se le
   paga lo que hizo, y no hay nada que decidir acá. La pregunta existe con el monto fijo —por
   semana o por mes— y solamente cuando la persona entró o se fue a mitad del período: o se le
   paga la parte de los días que estuvo, o se le paga el monto entero igual.

   LAS DOS FORMAS SE USAN, así que el sistema no elige por nadie: sale de fábrica pagando la parte
   proporcional, y cada Prestadora lo cambia si su arreglo con la gente es el otro.

   NO SE GUARDA LO QUE NO SE TOCÓ. Lo que viaja al motor es solamente lo que difiere de fábrica, y
   el motor lo vuelve a filtrar. La cuenta vive en `lib/formaDePago.js`, que es el mismo archivo
   que usa el motor. */
export function PagoAsistentesTab() {
  const { t } = useLocale();
  const [regla, setRegla] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { configuracion } = await llamarApi('/pago-asistentes');
      setRegla(configuracion.regla);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function cambiar(clave, valor) {
    setGuardado(false);
    setRegla((previa) => ({ ...previa, [clave]: valor }));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      await llamarApi('/pago-asistentes', { method: 'PUT', body: JSON.stringify({ regla }) });
      setGuardado(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.pago_asistentes_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.pago_asistentes_explicacion}</p>
      {error && <Alert variant="error">{error}</Alert>}
      {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      <EstadoLista estado={estado} error={error} recargar={recargar}>
        {regla && (
          <>
            <FormField
              label={t.configuracion.pago_asistentes_prorratear}
              name="prorratear_monto_fijo"
              type="checkbox"
              checked={regla.prorratear_monto_fijo}
              ayuda={t.configuracion.pago_asistentes_prorratear_ayuda}
              onChange={(e) => cambiar('prorratear_monto_fijo', e.target.checked)}
            />
            <Button onClick={guardar} disabled={guardando}>
              {guardando ? t.comun.guardando : t.comun.guardar}
            </Button>
          </>
        )}
      </EstadoLista>
    </div>
  );
}

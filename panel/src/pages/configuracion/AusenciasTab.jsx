import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { REGLA_QUE_SE_PUEDE_TOCAR } from '../../lib/avisoDeAusencia';

/* Con cuánta anticipación una falta se considera avisada con tiempo.
   ==========================================================================

   DE ACÁ SALE SI UNA FALTA LLEGA COMO TAREA O COMO ALARMA. La distancia entre el momento en que la
   persona avisó y el primer turno que deja sin nadie se compara con este número. Por encima, la
   Coordinadora la resuelve cuando puede y se le dice una sola vez. Por debajo, es un turno que
   empieza enseguida y se insiste cada tantas horas hasta que esté tapado.

   NO SE GUARDA LO QUE NO SE TOCÓ. Lo que viaja al motor es solamente lo que difiere de fábrica, y
   el motor lo vuelve a filtrar. Así, el día que cambie un valor de fábrica, alcanza a todas las
   Prestadoras salvo en lo que cada una decidió. La cuenta y los bordes viven en
   `lib/avisoDeAusencia.js`, que es el mismo archivo que usa el motor. */
export function AusenciasTab() {
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
      const { configuracion } = await llamarApi('/ausencias');
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

  // El campo vacío no se manda como cero: cero horas dejaría a todas las faltas fuera de la alarma,
  // y el motor lo rechazaría. Mientras el campo está vacío no se puede guardar.
  function cambiar(clave, texto) {
    setGuardado(false);
    setRegla((previa) => ({ ...previa, [clave]: texto === '' ? '' : Number(texto) }));
  }

  const completos = regla && Object.values(regla).every((valor) => valor !== '' && Number.isFinite(valor));

  async function guardar() {
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      await llamarApi('/ausencias', { method: 'PUT', body: JSON.stringify({ regla }) });
      setGuardado(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.ausencias_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.ausencias_explicacion}</p>
      {error && <Alert variant="error">{error}</Alert>}
      {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      <EstadoLista estado={estado} error={error} recargar={recargar}>
        {regla && (
          <>
            <FormField
              label={t.configuracion.ausencias_horas_con_tiempo}
              name="horas_para_considerarla_con_tiempo"
              type="number"
              min={REGLA_QUE_SE_PUEDE_TOCAR.horas_para_considerarla_con_tiempo.minimo}
              max={REGLA_QUE_SE_PUEDE_TOCAR.horas_para_considerarla_con_tiempo.maximo}
              value={regla.horas_para_considerarla_con_tiempo}
              ayuda={t.configuracion.ausencias_horas_con_tiempo_ayuda}
              onChange={(e) => cambiar('horas_para_considerarla_con_tiempo', e.target.value)}
            />
            <FormField
              label={t.configuracion.ausencias_horas_entre_avisos}
              name="horas_entre_avisos"
              type="number"
              min={REGLA_QUE_SE_PUEDE_TOCAR.horas_entre_avisos.minimo}
              max={REGLA_QUE_SE_PUEDE_TOCAR.horas_entre_avisos.maximo}
              value={regla.horas_entre_avisos}
              ayuda={t.configuracion.ausencias_horas_entre_avisos_ayuda}
              onChange={(e) => cambiar('horas_entre_avisos', e.target.value)}
            />
            <Button onClick={guardar} disabled={guardando || !completos}>
              {guardando ? t.comun.guardando : t.comun.guardar}
            </Button>
          </>
        )}
      </EstadoLista>
    </div>
  );
}

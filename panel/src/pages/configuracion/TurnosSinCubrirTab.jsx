import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { REGLA_QUE_SE_PUEDE_TOCAR } from '../../lib/incidenteTurnoSinCubrir';

/* A cuántas horas un turno sin nadie deja de ser un renglón y pasa a ser grave.
   ==========================================================================

   SON DOS NÚMEROS Y NADA MÁS. A cuántas horas de empezar un turno que sigue sin Asistente abre un
   expediente, y cada cuánto se le vuelve a recordar a quien lo puede tapar.

   LO QUE NO SE CONFIGURA ACÁ, Y POR QUÉ. Ni a quién le llega ni si se manda. El recordatorio va a
   quien coordina a ese Paciente, que es quien puede taparlo, y no a una dirección elegible; y un
   defecto grave no se apaga. Dibujar acá una casilla para apagarlo sería ofrecer algo que el
   producto no hace.

   NO SE GUARDA LO QUE NO SE TOCÓ. Viaja solamente lo que difiere de fábrica, y el motor lo vuelve
   a filtrar. Así el día que cambie un valor de fábrica alcanza a todas las Prestadoras salvo en lo
   que cada una decidió. La cuenta y los bordes viven en `lib/incidenteTurnoSinCubrir.js`, que es el
   mismo archivo que usa el motor. */
export function TurnosSinCubrirTab() {
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
      const { configuracion } = await llamarApi('/incidentes-turno-sin-cubrir');
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

  // El campo vacío no se manda como cero: con cero horas el expediente se abriría recién al empezar
  // el turno, que es justo cuando ya no se puede tapar. Mientras el campo está vacío no se guarda.
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
      await llamarApi('/incidentes-turno-sin-cubrir', { method: 'PUT', body: JSON.stringify({ regla }) });
      setGuardado(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.turnos_sin_cubrir_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.turnos_sin_cubrir_explicacion}</p>
      {error && <Alert variant="error">{error}</Alert>}
      {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      <EstadoLista estado={estado} error={error} recargar={recargar}>
        {regla && (
          <>
            <FormField
              label={t.configuracion.turnos_sin_cubrir_horas_para_abrirlo}
              name="horas_para_abrirlo"
              type="number"
              min={REGLA_QUE_SE_PUEDE_TOCAR.horas_para_abrirlo.minimo}
              max={REGLA_QUE_SE_PUEDE_TOCAR.horas_para_abrirlo.maximo}
              value={regla.horas_para_abrirlo}
              ayuda={t.configuracion.turnos_sin_cubrir_horas_para_abrirlo_ayuda}
              onChange={(e) => cambiar('horas_para_abrirlo', e.target.value)}
            />
            <FormField
              label={t.configuracion.turnos_sin_cubrir_horas_entre_recordatorios}
              name="horas_entre_recordatorios"
              type="number"
              min={REGLA_QUE_SE_PUEDE_TOCAR.horas_entre_recordatorios.minimo}
              max={REGLA_QUE_SE_PUEDE_TOCAR.horas_entre_recordatorios.maximo}
              value={regla.horas_entre_recordatorios}
              ayuda={t.configuracion.turnos_sin_cubrir_horas_entre_recordatorios_ayuda}
              onChange={(e) => cambiar('horas_entre_recordatorios', e.target.value)}
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

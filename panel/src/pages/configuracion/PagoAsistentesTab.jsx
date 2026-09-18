import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import {
  FRECUENCIAS,
  FRECUENCIAS_POSIBLES,
  FRECUENCIA_QUE_SE_PUEDE_TOCAR,
} from '../../lib/frecuenciaDePago';

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
   que usa el motor.

   Y ABAJO, LA OTRA PREGUNTA DEL DINERO, QUE NO ES LA MISMA. Con qué se mide el trabajo —hora,
   guardia, semana o mes— se elige en la ficha de cada persona. Cada cuánto cobra se elige acá, y
   son independientes: se le puede pagar por hora y cobrar por mes. Esto es lo que rige para toda
   la Prestadora; con cada persona se puede arreglar distinto desde su ficha. No cambia ningún
   importe: sólo desde qué día hasta qué día va cada período. Vive en `lib/frecuenciaDePago.js`,
   que también es el mismo archivo que usa el motor. */
export function PagoAsistentesTab() {
  const { t } = useLocale();
  const [regla, setRegla] = useState(null);
  const [frecuencia, setFrecuencia] = useState(null);
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
      setFrecuencia(configuracion.frecuencia);
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

  function cambiarFrecuencia(clave, valor) {
    setGuardado(false);
    setFrecuencia((previa) => ({ ...previa, [clave]: valor }));
  }

  // Un campo vacío no es un cero: se deja escribir mientras se borra, y lo que viaja al motor
  // es el número. Si quedó vacío al guardar, vale lo de fábrica, que es lo que el motor hace
  // con cualquier valor fuera de borde.
  function cambiarDiasHastaElPago(texto) {
    if (texto === '') return cambiarFrecuencia('dias_hasta_el_pago', '');
    const numero = Number(texto);
    if (Number.isInteger(numero)) cambiarFrecuencia('dias_hasta_el_pago', numero);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      await llamarApi('/pago-asistentes', { method: 'PUT', body: JSON.stringify({ regla, frecuencia }) });
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
        {regla && frecuencia && (
          <>
            <FormField
              label={t.configuracion.pago_asistentes_prorratear}
              name="prorratear_monto_fijo"
              type="checkbox"
              checked={regla.prorratear_monto_fijo}
              onChange={(e) => cambiar('prorratear_monto_fijo', e.target.checked)}
            />

            <h2>{t.configuracion.frecuencia_pago_titulo}</h2>
            <p className="panel-explicacion">{t.configuracion.frecuencia_pago_explicacion}</p>

            <FormField
              label={t.configuracion.frecuencia_pago_cada_cuanto}
              name="frecuencia_cada_cuanto"
              type="select"
              value={frecuencia.cada_cuanto}
              onChange={(e) => cambiarFrecuencia('cada_cuanto', e.target.value)}
            >
              {FRECUENCIAS_POSIBLES.map((cual) => (
                <option key={cual} value={cual}>
                  {t.configuracion.frecuencia_pago_cada_cuanto_opciones[cual]}
                </option>
              ))}
            </FormField>

            {/* El día de corte sólo significa algo cuando se cierra por semana: mostrarlo
                siempre haría creer que el mes también depende de él. */}
            {frecuencia.cada_cuanto === FRECUENCIAS.SEMANA && (
              <FormField
                label={t.configuracion.frecuencia_pago_dia_de_corte}
                name="frecuencia_dia_de_corte"
                type="select"
                value={frecuencia.dia_de_corte}
                onChange={(e) => cambiarFrecuencia('dia_de_corte', Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((dia) => (
                  <option key={dia} value={dia}>
                    {t.configuracion.frecuencia_pago_dias[dia]}
                  </option>
                ))}
              </FormField>
            )}

            <FormField
              label={t.configuracion.frecuencia_pago_dias_hasta_el_pago}
              name="frecuencia_dias_hasta_el_pago"
              type="number"
              min={FRECUENCIA_QUE_SE_PUEDE_TOCAR.dias_hasta_el_pago.minimo}
              max={FRECUENCIA_QUE_SE_PUEDE_TOCAR.dias_hasta_el_pago.maximo}
              value={frecuencia.dias_hasta_el_pago}
              onChange={(e) => cambiarDiasHastaElPago(e.target.value)}
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

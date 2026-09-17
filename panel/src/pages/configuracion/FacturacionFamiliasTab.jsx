import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { PLAZO_MAXIMO_EN_DIAS, plazoQueSePuedeGuardar } from '../../lib/facturacionDeFamilias';

/* A qué plazo pagan las Familias lo que se les factura.
   ==========================================================================

   PARA QUÉ SIRVE ESTE NÚMERO. De acá sale la fecha de vencimiento de cada factura, y de esa
   fecha sale si una Familia figura en mora. Hasta entonces la fecha se escribía a mano cada vez
   que se generaba una tanda, igual para todas.

   NO HAY VALOR DE FÁBRICA, Y ES A PROPÓSITO. A qué plazo paga cada Familia es parte de lo que se
   acordó con ella, y un plazo que invente el sistema pondría facturas en mora sin que nadie lo
   haya decidido. Mientras esto quede vacío, la pantalla de saldos sigue pidiendo la fecha.

   Y VACÍO NO ES CERO. Cero quiere decir «paga el mismo día», que es un acuerdo posible.

   Lo de acá rige para toda la Prestadora; con una Familia en particular se puede acordar otro
   plazo desde su ficha, y ese gana. La cuenta vive en `lib/facturacionDeFamilias.js`, que es el
   mismo archivo que usa el motor. */
export function FacturacionFamiliasTab() {
  const { t } = useLocale();
  const [dias, setDias] = useState('');
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { configuracion } = await llamarApi('/facturacion-familias');
      setDias(configuracion.dias_hasta_el_vencimiento === null ? '' : String(configuracion.dias_hasta_el_vencimiento));
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  // La misma comprobación que hace el motor antes de escribir, leída del archivo compartido: así
  // el botón no ofrece guardar algo que después se rechaza.
  const revisado = plazoQueSePuedeGuardar(dias === '' ? '' : Number(dias));

  async function guardar() {
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      await llamarApi('/facturacion-familias', {
        method: 'PUT',
        body: JSON.stringify({ dias_hasta_el_vencimiento: dias === '' ? '' : Number(dias) }),
      });
      setGuardado(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.facturacion_familias_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.facturacion_familias_explicacion}</p>
      {error && <Alert variant="error">{error}</Alert>}
      {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      <EstadoLista estado={estado} error={error} recargar={recargar}>
        <>
          <FormField
            label={t.configuracion.facturacion_familias_dias}
            name="dias_hasta_el_vencimiento"
            type="number"
            min="0"
            max={PLAZO_MAXIMO_EN_DIAS}
            value={dias}
            ayuda={t.configuracion.facturacion_familias_dias_ayuda}
            error={!revisado.ok ? t.configuracion.facturacion_familias_fuera_de_borde : undefined}
            onChange={(e) => {
              setDias(e.target.value);
              setGuardado(false);
            }}
          />
          <Button onClick={guardar} disabled={guardando || !revisado.ok}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </>
      </EstadoLista>
    </div>
  );
}

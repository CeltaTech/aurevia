import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiMarketplace } from '../../lib/apiMarketplace';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';

/* Los plazos con los que cobra la Prestadora.
   ==========================================================================

   Con cuántos días se avisa un cobro que viene, cuántos días se conserva el acceso cuando un
   cobro no entra, y cuántos días vive el cupón de la red de cobranza. Los tres estaban escritos
   en el motor y son decisiones comerciales de cara a la Familia, así que los elige ella.

   Los números con los que arranca salen de la base, igual que el resto de su configuración: acá
   no hay ninguno escrito. Verlos es de la administración y cambiarlos es del Admin de la
   Prestadora, con el mismo candado que las formas de cobro. */
export function PlazosDelCobro({ soloLectura }) {
  const { t } = useLocale();
  const [plazos, setPlazos] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardados, setGuardados] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { plazos: filas } = await llamarApiMarketplace('/plazos-de-cobro');
      setPlazos(filas);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function cambiar(campo, valor) {
    setGuardados(false);
    setPlazos((anteriores) => ({ ...anteriores, [campo]: valor }));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const { plazos: guardadosEnLaBase } = await llamarApiMarketplace('/plazos-de-cobro', {
        method: 'PATCH',
        body: JSON.stringify(plazos),
      });
      setPlazos(guardadosEnLaBase);
      setGuardados(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    }
    setGuardando(false);
  }

  if (estado === 'cargando') return <p>{t.comun.cargando}</p>;
  if (estado === 'error') {
    return (
      <div>
        <Alert variant="error">{error}</Alert>
        <Button onClick={recargar}>{t.comun.reintentar}</Button>
      </div>
    );
  }

  return (
    <section>
      <h2>{t.marketplace.plazos_titulo}</h2>

      {error && <Alert variant="error">{error}</Alert>}
      {guardados && <Alert variant="success">{t.marketplace.plazos_guardados}</Alert>}

      <FormField
        label={t.marketplace.plazo_aviso_antes_del_cobro}
        name="dias_de_aviso_antes_del_cobro"
        type="number"
        min="1"
        value={plazos?.dias_de_aviso_antes_del_cobro ?? ''}
        onChange={(e) => cambiar('dias_de_aviso_antes_del_cobro', e.target.value)}
        disabled={soloLectura}
      />

      <FormField
        label={t.marketplace.plazo_gracia_por_cobro_rechazado}
        name="dias_de_gracia_por_cobro_rechazado"
        type="number"
        min="1"
        value={plazos?.dias_de_gracia_por_cobro_rechazado ?? ''}
        onChange={(e) => cambiar('dias_de_gracia_por_cobro_rechazado', e.target.value)}
        disabled={soloLectura}
      />

      <FormField
        label={t.marketplace.plazo_vida_del_cupon}
        name="dias_de_vida_del_cupon"
        type="number"
        min="1"
        value={plazos?.dias_de_vida_del_cupon ?? ''}
        onChange={(e) => cambiar('dias_de_vida_del_cupon', e.target.value)}
        disabled={soloLectura}
      />

      {!soloLectura && (
        <Button onClick={guardar} disabled={guardando}>
          {t.comun.guardar}
        </Button>
      )}
    </section>
  );
}

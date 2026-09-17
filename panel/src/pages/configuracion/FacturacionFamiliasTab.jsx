import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import {
  LARGO_MINIMO_DEL_SECRETO_DEL_AVISO,
  PLAZO_MAXIMO_EN_DIAS,
  plazoQueSePuedeGuardar,
} from '../../lib/facturacionDeFamilias';

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
  const [sigue, setSigue] = useState(true);
  const [prestadoraId, setPrestadoraId] = useState(null);
  const [avisoConectado, setAvisoConectado] = useState(false);
  const [secreto, setSecreto] = useState('');
  const [guardandoSecreto, setGuardandoSecreto] = useState(false);
  const [facturacionConectada, setFacturacionConectada] = useState(false);
  const [secretoDeFacturacion, setSecretoDeFacturacion] = useState('');
  const [guardandoSecretoDeFacturacion, setGuardandoSecretoDeFacturacion] = useState(false);
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
      setSigue(configuracion.sigue_la_cobranza !== false);
      setAvisoConectado(!!configuracion.aviso_de_restriccion_conectado);
      setFacturacionConectada(!!configuracion.aviso_de_facturacion_conectado);
      setPrestadoraId(configuracion.prestadora_id ?? null);
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
        body: JSON.stringify({
          dias_hasta_el_vencimiento: dias === '' ? '' : Number(dias),
          sigue_la_cobranza: sigue,
        }),
      });
      setGuardado(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  // El secreto se guarda aparte del resto, y a propósito: va a la caja fuerte de la base por otra
  // puerta, no vuelve a salir nunca, y guardarlo junto con lo demás obligaría a volver a
  // escribirlo cada vez que se cambia el plazo de pago.
  async function guardarSecreto() {
    setGuardandoSecreto(true);
    setError(null);
    try {
      await llamarApi('/facturacion-familias/secreto-del-aviso', {
        method: 'PUT',
        body: JSON.stringify({ secreto }),
      });
      setSecreto('');
      setAvisoConectado(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardandoSecreto(false);
    }
  }

  // El secreto con el que firma el software de facturación. Es otro, y no el de arriba: el que
  // factura y el que sigue la cobranza pueden ser de dos proveedores que no se conocen.
  async function guardarSecretoDeFacturacion() {
    setGuardandoSecretoDeFacturacion(true);
    setError(null);
    try {
      await llamarApi('/facturacion-familias/secreto-del-aviso-de-facturacion', {
        method: 'PUT',
        body: JSON.stringify({ secreto: secretoDeFacturacion }),
      });
      setSecretoDeFacturacion('');
      setFacturacionConectada(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardandoSecretoDeFacturacion(false);
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
          <FormField
            label={t.configuracion.cobranza_sigue_titulo}
            name="sigue_la_cobranza"
            type="checkbox"
            checked={sigue}
            ayuda={t.configuracion.cobranza_sigue_ayuda}
            onChange={(e) => {
              setSigue(e.target.checked);
              setGuardado(false);
            }}
          />
          <Button onClick={guardar} disabled={guardando || !revisado.ok}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>

          {/* Que el software de facturación avise solo lo que emitió. Se ofrece siempre, sin
              importar quién sigue la cobranza: son dos decisiones distintas, y facturar lo hace
              siempre alguien de afuera. Mientras no haya secreto cargado, no entra ningún aviso,
              y se sigue anotando a mano o con el archivo. */}
          <section>
            <h3>{t.configuracion.facturacion_aviso_titulo}</h3>
            <p className="panel-explicacion">{t.configuracion.facturacion_aviso_explicacion}</p>
            {prestadoraId && (
              <FormField
                label={t.configuracion.facturacion_aviso_direccion}
                name="direccion_del_aviso_de_facturacion"
                value={`${import.meta.env.VITE_API_URL}/api/avisos-de-facturacion/${prestadoraId}`}
                readOnly
                ayuda={t.configuracion.facturacion_aviso_direccion_ayuda}
              />
            )}
            <Alert variant="info">
              {facturacionConectada
                ? t.configuracion.facturacion_aviso_conectado
                : t.configuracion.facturacion_aviso_sin_conectar}
            </Alert>
            <FormField
              label={t.configuracion.facturacion_aviso_secreto}
              name="secreto_del_aviso_de_facturacion"
              type="password"
              value={secretoDeFacturacion}
              ayuda={t.configuracion.facturacion_aviso_secreto_ayuda}
              onChange={(e) => setSecretoDeFacturacion(e.target.value)}
            />
            <Button
              onClick={guardarSecretoDeFacturacion}
              disabled={
                guardandoSecretoDeFacturacion ||
                secretoDeFacturacion.trim().length < LARGO_MINIMO_DEL_SECRETO_DEL_AVISO
              }
            >
              {guardandoSecretoDeFacturacion ? t.comun.guardando : t.comun.guardar}
            </Button>
          </section>

          {!sigue && (
            <section>
              <h3>{t.configuracion.cobranza_aviso_titulo}</h3>
              <p className="panel-explicacion">{t.configuracion.cobranza_aviso_explicacion}</p>
              {prestadoraId && (
                <FormField
                  label={t.configuracion.cobranza_aviso_direccion}
                  name="direccion_del_aviso"
                  value={`${import.meta.env.VITE_API_URL}/api/avisos-de-cobranza/${prestadoraId}`}
                  readOnly
                  ayuda={t.configuracion.cobranza_aviso_direccion_ayuda}
                />
              )}
              <Alert variant="info">
                {avisoConectado
                  ? t.configuracion.cobranza_aviso_conectado
                  : t.configuracion.cobranza_aviso_sin_conectar}
              </Alert>
              <FormField
                label={t.configuracion.cobranza_aviso_secreto}
                name="secreto_del_aviso"
                type="password"
                value={secreto}
                ayuda={t.configuracion.cobranza_aviso_secreto_ayuda}
                onChange={(e) => setSecreto(e.target.value)}
              />
              <Button
                onClick={guardarSecreto}
                disabled={guardandoSecreto || secreto.trim().length < LARGO_MINIMO_DEL_SECRETO_DEL_AVISO}
              >
                {guardandoSecreto ? t.comun.guardando : t.comun.guardar}
              </Button>
            </section>
          )}
        </>
      </EstadoLista>
    </div>
  );
}

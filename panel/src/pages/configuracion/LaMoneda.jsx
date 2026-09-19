import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';

/* En qué moneda trabaja esta Prestadora.
   ==========================================================================

   QUÉ DECIDE. La moneda con la que se guardan los importes que se carguen de acá en adelante:
   los precios de una lista, lo que se le factura a una Familia, lo que se le paga a una
   Asistente. La base la completa sola al insertar cada fila
   (`public.moneda_de_prestadora`), así que ninguna pantalla la pregunta de nuevo.

   QUÉ NO CAMBIA. Nada de lo ya guardado. Cada importe lleva su propia moneda al lado, puesta
   el día que se anotó, y ésa no se toca nunca: un importe anotado en pesos se sigue leyendo en
   pesos. Acá no se convierte ningún importe ni se guarda ninguna cotización.

   DE DÓNDE SALE LA LISTA. Del catálogo de la base, el mismo del que sale la moneda al dar de
   alta una Prestadora. No está escrita acá: se amplía agregándole una fila al catálogo.

   CÓMO SE ESCRIBE CADA OPCIÓN. El código de tres letras es lo que se guarda, y el nombre al
   lado lo pone el navegador en el idioma que esté elegido: no hay ninguna lista de nombres de
   monedas escrita a mano, que además habría que mantener en tres idiomas. */
export function LaMoneda() {
  const { t, locale } = useLocale();
  const { refrescarUsuario } = useAuth();
  const [moneda, setMoneda] = useState('');
  const [monedas, setMonedas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const datos = await llamarApi('/moneda');
      setMoneda(datos.moneda ?? '');
      setMonedas(datos.monedas ?? []);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t, 'configuración de la moneda'));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      const datos = await llamarApi('/moneda', {
        method: 'PATCH',
        body: JSON.stringify({ moneda }),
      });
      setMoneda(datos.moneda);
      // La moneda viaja junto con el usuario, y de ahí la leen los importes que se muestran
      // antes de guardarse. Sin este refresco, las proyecciones seguirían escritas en la moneda
      // anterior hasta que alguien volviera a entrar.
      await refrescarUsuario();
      setGuardado(true);
    } catch (err) {
      setError(mensajeDeError(err, t, 'configuración de la moneda'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.moneda_titulo}</h2>
      {error && <Alert variant="error">{error}</Alert>}
      {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && monedas.length === 0}
        mensajeVacio={t.configuracion.moneda_sin_catalogo}
        recargar={recargar}
      >
        <>
          <FormField
            label={t.configuracion.moneda_campo}
            name="moneda"
            type="select"
            value={moneda}
            onChange={(e) => {
              setMoneda(e.target.value);
              setGuardado(false);
            }}
          >
            {monedas.map((codigo) => (
              <option key={codigo} value={codigo}>
                {comoSeLlama(codigo, locale)}
              </option>
            ))}
          </FormField>
          <Button onClick={guardar} disabled={guardando || !moneda}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </>
      </EstadoLista>
    </div>
  );
}

/* El código y, si el navegador lo sabe, cómo se llama esa moneda en el idioma elegido. Si no lo
   sabe queda el código solo, que es lo que se guarda: nunca un nombre inventado. */
function comoSeLlama(codigo, locale) {
  try {
    const nombre = new Intl.DisplayNames([locale], { type: 'currency' }).of(codigo);
    return nombre && nombre !== codigo ? `${codigo} — ${nombre}` : codigo;
  } catch {
    return codigo;
  }
}

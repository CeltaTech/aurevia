import { useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { llamarApiPanel } from '../lib/apiPanel';
import { mensajeDeError } from '../lib/errores';
import { EstadoLista } from '../components/layout/EstadoLista';
import { TelefonoDeLaCuenta } from '../components/cuenta/TelefonoDeLaCuenta';
import { useCuentaSegura } from '../components/cuenta/useCuentaSegura';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';

/* LA SEGURIDAD DE LA PROPIA CUENTA.
   ==========================================================================

   Tres cosas, y son de quien está mirando la pantalla: verificar el número que tiene cargado,
   cambiarlo, y cerrar la sesión en todos los equipos.

   EL NÚMERO NO LLEGA HASTA ACÁ. El motor contesta si hay uno cargado y si está verificado, nada
   más: para verificarlo no hace falta leerlo, y para cambiarlo se escribe el nuevo.

   ESTO NO APARECE EN LA CONFIGURACIÓN DE LA PRESTADORA. Cómo se entra y cómo se recupera la clave
   es igual para todas y para todos los roles. */
export function CuentaSegura() {
  const { t, locale } = useLocale();
  const { estado, error, datos, recargar } = useCuentaSegura();

  return (
    <div>
      <h1>{t.cuenta_segura.titulo}</h1>

      <EstadoLista estado={estado} error={error} recargar={recargar}>
        {datos && (
          <>
            <TelefonoDeLaCuenta datos={datos} recargar={recargar} />
            <Equipos datos={datos} locale={locale} />
            <CerrarSesiones />
          </>
        )}
      </EstadoLista>
    </div>
  );
}

/* Desde qué aparatos se entró. No se muestra ningún dato del aparato —ni navegador, ni lugar—
   porque no se guarda ninguno: lo único que hay es cuándo fue la primera entrada y cuándo la
   última. */
function Equipos({ datos, locale }) {
  const { t } = useLocale();
  const fecha = (valor) => (valor ? new Date(valor).toLocaleString(locale) : '—');

  return (
    <section className="dashboard-seccion">
      <h2>{t.cuenta_segura.equipos_titulo}</h2>
      <EstadoLista estado="listo" vacio={datos.equipos.length === 0} mensajeVacio={t.cuenta_segura.equipos_vacio}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.cuenta_segura.equipo_desde}</th>
              <th>{t.cuenta_segura.equipo_ultima}</th>
            </tr>
          </thead>
          <tbody>
            {datos.equipos.map((equipo) => (
              <tr key={equipo.id}>
                <td>{fecha(equipo.desde)}</td>
                <td>{fecha(equipo.ultima)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </section>
  );
}

/* Cerrar la sesión en todos los equipos. Se hace desde otro equipo y con la clave, que son las dos
   condiciones que no cumple quien se llevó el aparato. */
function CerrarSesiones() {
  const { t } = useLocale();
  const [claveActual, setClaveActual] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function cerrar(evento) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await llamarApiPanel('/cuenta-segura/cerrar-sesiones', {
        method: 'POST',
        body: JSON.stringify({ claveActual }),
      });
      setClaveActual('');
      // Esta sesión también se cerró: se vuelve a la entrada.
      window.location.reload();
    } catch (err) {
      setError(mensajeDeError(err, t, 'CuentaSegura'));
      setEnviando(false);
    }
  }

  return (
    <section className="dashboard-seccion">
      <h2>{t.cuenta_segura.cerrar_sesiones_titulo}</h2>
      {error && <Alert variant="error">{error}</Alert>}
      <form onSubmit={cerrar}>
        <FormField
          label={t.cuenta_segura.clave_actual}
          name="claveActualCierre"
          type="password"
          autoComplete="current-password"
          required
          value={claveActual}
          onChange={(e) => setClaveActual(e.target.value)}
        />
        <Button type="submit" disabled={enviando || !claveActual}>
          {enviando ? t.comun.guardando : t.cuenta_segura.cerrar_sesiones}
        </Button>
      </form>
    </section>
  );
}

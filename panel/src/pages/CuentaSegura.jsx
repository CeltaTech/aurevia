import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { llamarApiPanel } from '../lib/apiPanel';
import { mensajeDeError } from '../lib/errores';
import { EstadoLista } from '../components/layout/EstadoLista';
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
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [datos, setDatos] = useState(null);

  const cargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      setDatos(await llamarApiPanel('/cuenta-segura'));
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t, 'CuentaSegura'));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div>
      <h1>{t.cuenta_segura.titulo}</h1>

      <EstadoLista estado={estado} error={error} recargar={cargar}>
        {datos && (
          <>
            <Telefono datos={datos} recargar={cargar} />
            <Equipos datos={datos} locale={locale} />
            <CerrarSesiones />
          </>
        )}
      </EstadoLista>
    </div>
  );
}

/* El número: verificarlo si ya está cargado, o cambiarlo por otro.
   Cambiarlo pide la clave actual, el nuevo nace sin verificar y el código sale hacia él. */
function Telefono({ datos, recargar }) {
  const { t } = useLocale();
  const [codigo, setCodigo] = useState('');
  const [telefono, setTelefono] = useState('');
  const [claveActual, setClaveActual] = useState('');
  const [pidiendo, setPidiendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [hayCodigo, setHayCodigo] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [errorCaja, setErrorCaja] = useState(null);

  async function pedirCodigo() {
    setErrorCaja(null);
    setAviso(null);
    setPidiendo(true);
    try {
      await llamarApiPanel('/cuenta-segura/telefono/codigo', { method: 'POST' });
      setHayCodigo(true);
      setAviso(t.cuenta_segura.codigo_enviado);
    } catch (err) {
      setErrorCaja(mensajeDeError(err, t, 'CuentaSegura'));
    } finally {
      setPidiendo(false);
    }
  }

  async function confirmar(evento) {
    evento.preventDefault();
    setErrorCaja(null);
    setAviso(null);
    setEnviando(true);
    try {
      await llamarApiPanel('/cuenta-segura/telefono/confirmar', {
        method: 'POST',
        body: JSON.stringify({ codigo }),
      });
      setCodigo('');
      setHayCodigo(false);
      await recargar();
    } catch (err) {
      setErrorCaja(mensajeDeError(err, t, 'CuentaSegura'));
    } finally {
      setEnviando(false);
    }
  }

  async function cambiar(evento) {
    evento.preventDefault();
    setErrorCaja(null);
    setAviso(null);
    setEnviando(true);
    try {
      await llamarApiPanel('/cuenta-segura/telefono/cambiar', {
        method: 'POST',
        body: JSON.stringify({ claveActual, telefono }),
      });
      setClaveActual('');
      setTelefono('');
      setHayCodigo(true);
      setAviso(t.cuenta_segura.codigo_enviado);
      await recargar();
    } catch (err) {
      setErrorCaja(mensajeDeError(err, t, 'CuentaSegura'));
    } finally {
      setEnviando(false);
    }
  }

  const estadoDelNumero = !datos.telefonoCargado
    ? t.cuenta_segura.sin_telefono
    : datos.telefonoVerificado
      ? t.cuenta_segura.telefono_verificado
      : t.cuenta_segura.telefono_sin_verificar;

  return (
    <section className="dashboard-seccion">
      <h2>{t.cuenta_segura.telefono_titulo}</h2>
      <p>{estadoDelNumero}</p>

      {errorCaja && <Alert variant="error">{errorCaja}</Alert>}
      {aviso && <Alert variant="success">{aviso}</Alert>}

      {!datos.viaDeTelefono && <Alert variant="info">{t.cuenta_segura.sin_via}</Alert>}

      {datos.viaDeTelefono && datos.telefonoCargado && !datos.telefonoVerificado && (
        <Button variant="secondary" onClick={pedirCodigo} disabled={pidiendo || enviando}>
          {pidiendo ? t.comun.guardando : t.cuenta_segura.pedir_codigo}
        </Button>
      )}

      {datos.viaDeTelefono && hayCodigo && (
        <form onSubmit={confirmar}>
          <FormField
            label={t.cuenta_segura.codigo}
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
          <Button type="submit" disabled={enviando || !codigo}>
            {enviando ? t.comun.guardando : t.cuenta_segura.confirmar}
          </Button>
        </form>
      )}

      <form onSubmit={cambiar}>
        <h3>{t.cuenta_segura.cambiar_telefono_titulo}</h3>
        <FormField
          label={t.cuenta_segura.telefono_nuevo}
          name="telefono"
          type="tel"
          autoComplete="tel"
          required
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
        />
        <FormField
          label={t.cuenta_segura.clave_actual}
          name="claveActual"
          type="password"
          autoComplete="current-password"
          required
          value={claveActual}
          onChange={(e) => setClaveActual(e.target.value)}
        />
        <Button type="submit" disabled={enviando || !telefono || !claveActual}>
          {enviando ? t.comun.guardando : t.cuenta_segura.cambiar_telefono}
        </Button>
      </form>
    </section>
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

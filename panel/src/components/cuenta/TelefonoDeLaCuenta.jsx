import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiPanel } from '../../lib/apiPanel';
import { mensajeDeError } from '../../lib/errores';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { FormField } from '../ui/FormField';

/* EL TELÉFONO DE LA PROPIA CUENTA: verificarlo si ya está cargado, o cambiarlo por otro.

   Está acá y no adentro de una pantalla porque se ofrece desde dos —la seguridad de la cuenta y
   la propia contraseña—, y una segunda copia sería un segundo mecanismo: dos formas de pedir el
   código, y el arreglo hecho en una sola.

   Cambiarlo pide la contraseña actual, el número nuevo nace sin verificar y el código sale hacia
   él, que es lo que hace que verificar signifique algo.

   VERIFICAR NO ES REQUISITO DE NADA. Quien no lo hace sigue entrando y recuperando la contraseña
   por correo, y esta sección no impide ni esconde nada. */
export function TelefonoDeLaCuenta({ datos, recargar }) {
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

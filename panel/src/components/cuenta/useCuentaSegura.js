import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiPanel } from '../../lib/apiPanel';
import { mensajeDeError } from '../../lib/errores';

/* CÓMO ESTÁ LA PROPIA CUENTA, UNA SOLA VEZ Y PARA LAS DOS PANTALLAS.

   Lo consultan la pantalla de seguridad de la cuenta y la de la propia contraseña, que son los
   dos lugares desde donde se ofrece verificar el teléfono. Escrito dos veces, el día que cambie
   lo que contesta el motor cambiaría en una sola.

   EL NÚMERO NO LLEGA HASTA ACÁ. El motor contesta si hay uno cargado, si está verificado y si esa
   Prestadora tiene por dónde mandar un código; nada de eso necesita leer el número.

   Los cuatro estados quedan a la vista de quien lo usa: `estado` vale «cargando», «error» o
   «listo», y el vacío lo decide cada pantalla con lo que dibuja. */
export function useCuentaSegura() {
  const { t } = useLocale();
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [datos, setDatos] = useState(null);

  const recargar = useCallback(async () => {
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
    recargar();
  }, [recargar]);

  return { estado, error, datos, recargar };
}

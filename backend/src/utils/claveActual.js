import { createClient } from '@supabase/supabase-js';
import { ErrorConMotivo } from './errorConMotivo.js';

// COMPROBAR LA CLAVE ACTUAL, DEL LADO DEL MOTOR.
//
// QUÉ PROTEGE. Cambiar el número de teléfono con el que se entra, y cerrar la sesión en todos los
// equipos, son dos cosas que no puede hacer quien se sienta un minuto en una máquina abierta. Tener
// la sesión adelante no alcanza: hay que saber la clave.
//
// POR QUÉ NO SE HACE EN LA PANTALLA. `MiClave.jsx` la comprueba del lado del navegador para cambiar
// la clave propia, y ahí alcanza porque el servicio de acceso vuelve a pedirla igual al escribir la
// nueva. Acá no: lo que sigue lo escribe el motor con la llave maestra, así que si la comprobación
// viviera en la pantalla, quien llame a la dirección directamente se la saltea.
//
// SE USA LA LLAVE PÚBLICA Y NO LA MAESTRA. La maestra cambia la clave de cualquiera sin conocer la
// anterior, que es justo lo contrario de lo que hay que averiguar. Con la pública se intenta entrar
// como esa persona: si entra, la clave era ésa.
//
// Y EL CLIENTE NO GUARDA LA SESIÓN. `persistSession: false` y `autoRefreshToken: false`: lo único
// que interesa es si el intento entró o no. Sin eso, el proceso del motor acumularía sesiones de
// gente que sólo quiso comprobar su clave.

let cliente = null;

function clientePublico() {
  const url = process.env.SUPABASE_URL;
  const llave = process.env.SUPABASE_ANON_KEY;
  if (!url || !llave) return null;

  if (!cliente) {
    cliente = createClient(url, llave, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cliente;
}

/** Sólo para las pruebas: obliga a rearmar el cliente con las variables de entorno de ahora. */
export function olvidarClientePublico() {
  cliente = null;
}

/**
 * ¿Esta es la clave actual de esta cuenta?
 *
 * Falla cerrado: sin llave pública configurada no se puede comprobar nada, y lo que corresponde es
 * negar. Una comprobación que se saltea cuando falta una variable de entorno no es una
 * comprobación (CLAUDE.md de la empresa §5).
 */
export async function esLaClaveActual({ email, clave }) {
  if (!email || !clave) return false;

  const publico = clientePublico();
  if (!publico) {
    console.error('claveActual: falta SUPABASE_ANON_KEY; no se puede comprobar la clave y se niega');
    return false;
  }

  const { data, error } = await publico.auth.signInWithPassword({ email, password: clave });
  if (error || !data?.user) return false;

  // La sesión que se acaba de abrir se cierra en el acto: acá no se estaba entrando a ningún lado.
  await publico.auth.signOut().catch(() => {});
  return true;
}

/** Lo mismo, pero lanzando el motivo que la pantalla traduce. */
export async function exigirLaClaveActual({ email, clave }) {
  if (!(await esLaClaveActual({ email, clave }))) {
    throw new ErrorConMotivo('clave_actual_incorrecta');
  }
}

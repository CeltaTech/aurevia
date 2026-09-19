import { hayViaDeTelefono } from './codigoAlTelefono.js';
import { telefonoConfirmadoPorLaPrestadora } from './habilitarCambioDeClave.js';

// CUÁNDO UN NÚMERO SIRVE DE LLAVE.
//
// Tener el número verificado no alcanza por sí solo, y el caso que lo muestra es el de siempre:
// alguien se queda con la cuenta abierta un rato, cambia el número por el suyo, lo verifica con el
// código que le llega a él, y desde ese momento la recuperación de la clave le pertenece. La espera
// es lo que le da tiempo al dueño a enterarse por el aviso de correo, que sale en el mismo momento
// en que el número cambia.
//
// CUÁNTO SE ESPERA ES UNA DECISIÓN QUE TODAVÍA NO ESTÁ TOMADA, así que no se inventa acá: se lee del
// entorno. El valor de fábrica es cero, o sea sin espera, que es exactamente lo que el producto hace
// hoy: a nadie se le saca nada mientras la decisión no llegue. Puesto el número de horas, la espera
// empieza a regir sola, sin tocar una línea.
//
// Y LA SALIDA YA ESTÁ CONSTRUIDA: si quien atiende el llamado confirma que ese número es de esa
// persona, no se espera nada. Es el paso 17 resolviendo el caso de quien cambió de número y no puede
// esperar a que le crean.

const HORAS_POR_OMISION = 0;

/** Cuántas horas espera un número recién verificado antes de servir de llave. */
export function horasDeEsperaDelTelefonoNuevo() {
  const texto = String(process.env.HORAS_DE_ESPERA_DEL_TELEFONO_NUEVO ?? '').trim();
  if (!texto) return HORAS_POR_OMISION;

  const numero = Number(texto);
  if (!Number.isInteger(numero) || numero < 0) {
    console.warn('segundoFactorDelTelefono: HORAS_DE_ESPERA_DEL_TELEFONO_NUEVO no es un entero de cero para arriba; se usa el valor de fábrica');
    return HORAS_POR_OMISION;
  }
  return numero;
}

/**
 * ¿Ya pasó la espera desde que ese número se verificó?
 *
 * Sin fecha de verificación, no. Una fecha ausente o ilegible no puede dar por cumplida una espera
 * (`celtatech/CLAUDE.md` §5: todo control de acceso falla cerrado).
 */
export function pasoLaEspera(verificadoEn, ahora = Date.now()) {
  if (!verificadoEn) return false;
  const momento = new Date(verificadoEn).getTime();
  if (!Number.isFinite(momento)) return false;
  return ahora - momento >= horasDeEsperaDelTelefonoNuevo() * 60 * 60 * 1000;
}

/**
 * ¿A esta cuenta se le puede pedir el código del teléfono?
 *
 * Son cuatro condiciones y todas tienen que darse: que haya número, que esté verificado, que la
 * Prestadora tenga por dónde mandarlo, y que el número ya no esté en espera —o que la Prestadora lo
 * haya confirmado, que es el atajo—.
 *
 * `cuenta` necesita `id`, `prestadora_id`, `telefono` y `telefono_verificado_en`.
 */
export async function elTelefonoSirveDeSegundoFactor(cuenta) {
  if (!cuenta?.telefono || !cuenta?.telefono_verificado_en) return false;
  if (!(await hayViaDeTelefono(cuenta.prestadora_id))) return false;
  if (pasoLaEspera(cuenta.telefono_verificado_en)) return true;
  return telefonoConfirmadoPorLaPrestadora({ usuarioId: cuenta.id, telefono: cuenta.telefono });
}

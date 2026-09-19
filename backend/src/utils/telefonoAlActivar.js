import { supabase } from '../db/connection.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import { correoDe } from './correoDeUnaPersona.js';
import { exigirLaClaveActual } from './claveActual.js';
import {
  mandarCodigoAlTelefono,
  comprobarCodigoDelTelefono,
  hayViaDeTelefono,
  telefonoAceptable,
  normalizarTelefono,
  USO_VERIFICAR,
} from './codigoAlTelefono.js';
import {
  registrarActividad,
  ACCION_VERIFICACION_DE_TELEFONO,
} from './registroDeActividad.js';

// VERIFICAR EL TELÉFONO EN EL MISMO MOMENTO EN QUE SE ACTIVA LA CUENTA.
//
// QUÉ RESUELVE. Hasta acá el número sólo se podía verificar desde el Panel, con la sesión ya
// abierta, y había que saber que esa pantalla existe. El momento en que alguien elige su
// contraseña es el único en el que está seguro de tener el teléfono en la mano.
//
// NO ES UN SEGUNDO MECANISMO. El código, el tope por hora, el vencimiento y los intentos son los
// de `utils/codigoAlTelefono.js`, los mismos que usa la pantalla de la cuenta. Acá lo único
// propio es de quién es la cuenta cuando todavía no hay sesión.
//
// NO ES REQUISITO DE NADA. Sin número escrito no pasa nada, sin vía de teléfono en esa Prestadora
// no pasa nada, y un envío que falla no deshace la activación: la cuenta ya quedó activa y esa
// persona entra con su contraseña y trabaja. Verificar es una oferta.
//
// EL NÚMERO NO VUELVE HACIA LA PANTALLA NI ENTRA EN NINGÚN REGISTRO, y el código tampoco. Lo
// único que viaja es si salió un código y cuándo vence.

/** La cuenta, con lo justo para decidir. Nunca sale de acá hacia afuera. */
async function cuentaDe(usuarioId) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, prestadora_id, telefono, telefono_verificado_en')
    .eq('id', usuarioId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Le manda el código al número que acaba de escribir quien activó la cuenta.
 *
 * EL NÚMERO SE GUARDA SIN VERIFICAR, y recién el código lo vuelve una llave. Es el mismo estado en
 * el que nace cualquier número cargado por otra persona, así que nada empeora si el código no
 * llega.
 *
 * SÓLO SE MANDA SI ESA PERSONA ESCRIBIÓ UN NÚMERO. Sin eso, activar una cuenta le dispararía un
 * mensaje a alguien que no lo pidió, y cada mensaje lo paga la Prestadora.
 *
 * @returns {Promise<{ codigoEnviado: boolean, vence?: string }>}
 */
export async function ofrecerElCodigoAlActivar({ usuarioId, telefono }) {
  const escrito = String(telefono ?? '').trim();
  if (!escrito || !telefonoAceptable(escrito)) return { codigoEnviado: false };

  const cuenta = await cuentaDe(usuarioId);
  if (!cuenta?.prestadora_id) return { codigoEnviado: false };

  const numero = normalizarTelefono(escrito);

  // Si el número es otro, el que había deja de estar verificado. `telefono_verificado_en` lo pone
  // en nulo un disparador de la base además de esto: el motor escribe con la llave maestra, y esa
  // red de abajo es la que sigue estando el día que otro camino toque esta columna.
  const { error } = await supabase
    .from('usuarios')
    .update({ telefono: numero, telefono_verificado_en: null })
    .eq('id', cuenta.id);
  if (error) throw new Error(error.message);

  if (!(await hayViaDeTelefono(cuenta.prestadora_id))) return { codigoEnviado: false };

  try {
    const { vence } = await mandarCodigoAlTelefono({
      usuario: { ...cuenta, telefono: numero },
      uso: USO_VERIFICAR,
    });
    return { codigoEnviado: true, vence };
  } catch (e) {
    // Que no salga el código no deshace nada: la cuenta quedó activa y el número, cargado y sin
    // verificar. Del error se anota el motivo, nunca el número.
    console.warn('telefonoAlActivar: el número quedó cargado pero el código no salió:', e.message);
    return { codigoEnviado: false };
  }
}

/**
 * Escribir el código, todavía sin sesión.
 *
 * SE PIDE LA CONTRASEÑA QUE ACABA DE ELEGIR, y es lo que sostiene todo el paso. El enlace del
 * correo dice de quién es la cuenta y nada más; sin la contraseña, quien se quedara con ese correo
 * podría colgarle a la cuenta un número suyo, y un número verificado recupera la clave.
 *
 * SE MARCA VERIFICADO SÓLO SI EL NÚMERO SIGUE SIENDO EL MISMO al que se le mandó el código. Entre
 * el pedido y la respuesta pudo haber cambiado, y marcar entonces daría por verificado un número
 * que nadie comprobó. Es la misma comprobación que hace la pantalla de la cuenta.
 */
export async function verificarElTelefonoAlActivar({ usuarioId, clave, codigo }) {
  const cuenta = await cuentaDe(usuarioId);
  if (!cuenta) throw new ErrorConMotivo('no_encontrado');

  const email = await correoDe(cuenta.id);
  if (!email) throw new ErrorConMotivo('clave_actual_incorrecta');
  await exigirLaClaveActual({ email, clave });

  const usado = await comprobarCodigoDelTelefono({
    usuarioId: cuenta.id,
    uso: USO_VERIFICAR,
    codigo,
  });

  if (normalizarTelefono(usado.telefono) !== normalizarTelefono(cuenta.telefono)) {
    throw new ErrorConMotivo('codigo_incorrecto');
  }

  const { error } = await supabase
    .from('usuarios')
    .update({ telefono_verificado_en: new Date().toISOString() })
    .eq('id', cuenta.id);
  if (error) throw new Error(error.message);

  await registrarActividad(
    { id: cuenta.id, prestadoraId: cuenta.prestadora_id },
    ACCION_VERIFICACION_DE_TELEFONO,
    { tablaAfectada: 'usuarios', registroId: cuenta.id, detalle: { via: 'whatsapp' } },
  );
}

import crypto from 'node:crypto';
import { supabase } from '../db/connection.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import {
  codigoNuevoParaGuardar,
  codigoCoincide,
  estaVencido,
  sumarIntento,
  seAgotaronLosIntentos,
  vencimientoEnMinutos,
} from './codigoDeUnSoloUso.js';
import { enviarWhatsAppPorPlantilla } from './whatsapp.js';

// EL CÓDIGO QUE VA AL TELÉFONO, Y NADA MÁS QUE EL CÓDIGO.
//
// QUÉ RESUELVE. `usuarios.telefono` es un dato que alguien tecleó y que nadie comprobó nunca. Si
// quedó escrito el número viejo, el código de recuperación le llega a un desconocido y con eso ese
// desconocido entra. Verificarlo es lo que convierte ese dato en una llave.
//
// SIRVE PARA TRES COSAS Y ES UN SOLO MECANISMO: verificar el número, entrar desde un equipo nuevo y
// recuperar la clave. Escribirlo tres veces sería tener tres topes distintos y arreglar el defecto
// en uno solo (CLAUDE.md de la empresa, «ningún patrón repetido sin punto único de verdad»).
//
// ESTO NO SE CONFIGURA POR PRESTADORA. Cómo se entra y cómo se recupera la clave es igual para
// todas. Lo que la Prestadora sí tiene es su canal de WhatsApp, y de ahí sale la única diferencia
// real: si esa Prestadora todavía no tiene aprobada la plantilla del código, la vía del teléfono no
// se le ofrece a nadie y el correo sigue funcionando. **A nadie se le saca nada.**
//
// EL NÚMERO NO VIAJA POR LA DIRECCIÓN WEB NI SE ESCRIBE EN NINGÚN REGISTRO, y el código tampoco.
// Las dos cosas son datos sensibles (`docs/REGLAS_PRODUCTOS_CAREONYS.md` §4). Lo que se anota
// cuando algo falla es que falló, nunca a quién ni con qué número.

export const USO_VERIFICAR = 'verificar_el_telefono';
export const USO_EQUIPO_NUEVO = 'entrar_desde_un_equipo_nuevo';
export const USO_RECUPERAR = 'recuperar_la_clave';

export const USOS_DEL_CODIGO = [USO_VERIFICAR, USO_EQUIPO_NUEVO, USO_RECUPERAR];

// La plantilla con la que sale el código, buscada por su nombre fijo.
//
// POR QUÉ NO PASA POR `configuracion_notificaciones` como los demás avisos. Ahí cada Prestadora
// enciende, apaga y elige plantilla; si el código saliera por ese camino, apagar un aviso apagaría
// el segundo factor, que es justamente lo que no se configura. Acá el nombre está fijo y lo único
// que la Prestadora hace es darla de alta y esperar que Meta la apruebe.
export const PLANTILLA_DEL_CODIGO = 'codigo_de_acceso';

const MINUTOS_POR_OMISION = 10;
const TOPE_POR_HORA_POR_OMISION = 5;

/**
 * Cuántos minutos vive el código. Se lee en cada pedido y no una sola vez al arrancar, para que
 * cambiarlo no obligue a reiniciar y para que las pruebas puedan moverlo.
 *
 * Un valor vacío, no entero o menor que uno se trata como si no estuviera: es el caso corriente del
 * renglón puesto y sin completar, y dejar que eso mande daría un código que nace vencido —o uno que
 * no vence nunca, según de qué lado se equivoque quien lo carga—.
 */
export function minutosDeVidaDelCodigo() {
  return enteroDelEntorno(
    process.env.MINUTOS_DEL_CODIGO_AL_TELEFONO,
    MINUTOS_POR_OMISION,
    'MINUTOS_DEL_CODIGO_AL_TELEFONO',
  );
}

/**
 * Cuántos códigos se le mandan como mucho a un mismo número en una hora.
 *
 * CADA ENVÍO CUESTA PLATA, y lo paga la Prestadora. Sin tope, cualquiera desde afuera pide códigos
 * hasta que a ella le llegue la factura. El tope del motor (`middleware/topeDePedidos.js`) no sirve
 * para esto: cuenta por persona con sesión, y dos de los tres usos ocurren sin ninguna.
 */
export function topeDeCodigosPorHora() {
  return enteroDelEntorno(
    process.env.TOPE_CODIGOS_AL_TELEFONO_POR_HORA,
    TOPE_POR_HORA_POR_OMISION,
    'TOPE_CODIGOS_AL_TELEFONO_POR_HORA',
  );
}

function enteroDelEntorno(crudo, porOmision, nombre) {
  const texto = String(crudo ?? '').trim();
  if (!texto) return porOmision;

  const numero = Number(texto);
  if (!Number.isInteger(numero) || numero < 1) {
    console.warn(`codigoAlTelefono: ${nombre} no es un entero mayor que cero; se usa el valor de fábrica`);
    return porOmision;
  }
  return numero;
}

/**
 * El número, escrito siempre igual. Se le sacan los espacios, los guiones y los paréntesis, que son
 * adorno de quien lo escribe, y se conserva el `+` inicial, que sí cambia a qué número se llama.
 *
 * Hace falta para dos cosas: para que el tope cuente el mismo número como el mismo aunque se haya
 * tecleado distinto, y para que la huella de un número sea siempre la misma.
 */
export function normalizarTelefono(telefono) {
  const texto = String(telefono ?? '').trim();
  if (!texto) return '';
  const digitos = texto.replace(/[^\d]/g, '');
  if (!digitos) return '';
  return texto.startsWith('+') ? `+${digitos}` : digitos;
}

/** ¿Esto puede ser un número de teléfono? Corto o larguísimo no lo es, y falla cerrado. */
export function telefonoAceptable(telefono) {
  const normalizado = normalizarTelefono(telefono);
  const digitos = normalizado.replace(/[^\d]/g, '');
  return digitos.length >= 8 && digitos.length <= 15;
}

/**
 * La huella del número.
 *
 * Donde hay que poder contestar «¿es el mismo número?» y no «¿cuál es?», se guarda esto. Vale para
 * el tope de pedidos y para lo que la Prestadora confirma por teléfono: en los dos casos alcanza
 * con reconocerlo, y así el renglón que queda no dice a quién se le mandó nada.
 */
export function huellaDelTelefono(telefono) {
  return crypto.createHash('sha256').update(normalizarTelefono(telefono)).digest('hex');
}

/**
 * ¿Esta Prestadora tiene por dónde mandar un código?
 *
 * Es la única diferencia real entre Prestadoras, y no es una configuración del segundo factor: es
 * si su canal de WhatsApp ya tiene aprobada la plantilla con la que sale el código. Mientras no la
 * tenga, la vía del teléfono no se ofrece y todo el mundo sigue entrando y recuperando por correo.
 */
export async function hayViaDeTelefono(prestadoraId) {
  return (await plantillaDelCodigo(prestadoraId)) !== null;
}

async function plantillaDelCodigo(prestadoraId) {
  if (!prestadoraId) return null;

  const { data, error } = await supabase
    .from('plantillas_whatsapp')
    .select('id, nombre_interno, idioma, cuerpo_texto, estado')
    .eq('prestadora_id', prestadoraId)
    .eq('nombre_interno', PLANTILLA_DEL_CODIGO)
    .eq('estado', 'aprobada')
    .maybeSingle();

  if (error) {
    console.error('codigoAlTelefono: no se pudo resolver la plantilla del código:', error.message);
    return null;
  }
  return data ?? null;
}

async function pedidosEnLaUltimaHora(huella) {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('pedidos_de_codigo_al_telefono')
    .select('id', { count: 'exact', head: true })
    .eq('telefono_huella', huella)
    .gte('pedido_en', desde);

  if (error) {
    // Falla cerrado: un tope que se saltea cuando la base no contesta no es un tope, y acá lo que
    // se protege es la plata de la Prestadora.
    console.error('codigoAlTelefono: no se pudieron contar los pedidos:', error.message);
    return Number.POSITIVE_INFINITY;
  }
  return Number.isFinite(count) ? count : Number.POSITIVE_INFINITY;
}

/**
 * Manda un código al teléfono de esta persona y deja la fila con la que después se comprueba.
 *
 * EL CÓDIGO SE VA POR LA MISMA VÍA QUE SE ESTÁ VERIFICANDO, que es lo que hace que verificar sirva:
 * mandarlo a otro lado probaría que esa persona lee el otro lado, no que este número es suyo.
 *
 * No devuelve el código. Sale una sola vez, por WhatsApp, y de acá no vuelve a salir nunca: ni
 * hacia la pantalla, ni hacia el registro del servidor.
 *
 * @returns {Promise<{ vence: string }>} cuándo vence, que es lo único que la pantalla necesita.
 */
export async function mandarCodigoAlTelefono({ usuario, uso, telefono }) {
  if (!usuario?.id || !usuario?.prestadora_id) throw new ErrorConMotivo('faltan_datos');
  if (!USOS_DEL_CODIGO.includes(uso)) throw new ErrorConMotivo('faltan_datos');

  const numero = normalizarTelefono(telefono ?? usuario.telefono);
  if (!telefonoAceptable(numero)) throw new ErrorConMotivo('telefono_invalido');

  const plantilla = await plantillaDelCodigo(usuario.prestadora_id);
  if (!plantilla) throw new ErrorConMotivo('via_de_telefono_no_disponible');

  const huella = huellaDelTelefono(numero);
  if ((await pedidosEnLaUltimaHora(huella)) >= topeDeCodigosPorHora()) {
    throw new ErrorConMotivo('demasiados_pedidos', 'Se alcanzó el tope de códigos por hora para ese número');
  }

  // Los códigos anteriores del mismo acto se dan por anulados antes de emitir el nuevo: pedir dos
  // veces no deja dos códigos vivos, deja uno. Es lo mismo que hace la recuperación por correo con
  // sus enlaces.
  await supabase
    .from('codigos_al_telefono')
    .update({ anulado_en: new Date().toISOString() })
    .eq('usuario_id', usuario.id)
    .eq('uso', uso)
    .is('verificado_en', null)
    .is('anulado_en', null);

  const minutos = minutosDeVidaDelCodigo();
  const { codigo, campos } = codigoNuevoParaGuardar(vencimientoEnMinutos(minutos));

  const { data: fila, error } = await supabase
    .from('codigos_al_telefono')
    .insert({
      prestadora_id: usuario.prestadora_id,
      usuario_id: usuario.id,
      uso,
      telefono: numero,
      ...campos,
    })
    .select('id, codigo_expira_en')
    .single();
  if (error) throw new Error(error.message);

  // El pedido se anota antes de mandar. Si el envío falla, el renglón queda igual: lo que el tope
  // cuenta son los pedidos, y un envío que falló ya costó el intento contra el proveedor.
  await supabase
    .from('pedidos_de_codigo_al_telefono')
    .insert({ prestadora_id: usuario.prestadora_id, telefono_huella: huella });

  try {
    await enviarWhatsAppPorPlantilla({
      prestadoraId: usuario.prestadora_id,
      telefono: numero,
      plantilla,
      valores: [codigo, String(minutos)],
    });
  } catch (e) {
    // El código emitido se anula: si no saliera y quedara vivo, sería un secreto de seis dígitos
    // abierto que nadie va a usar. Del error se anota el motivo, nunca el número ni el código.
    await supabase
      .from('codigos_al_telefono')
      .update({ anulado_en: new Date().toISOString() })
      .eq('id', fila.id);
    console.error('codigoAlTelefono: no se pudo mandar el código:', e.message);
    throw new ErrorConMotivo('via_de_telefono_no_disponible');
  }

  return { vence: fila.codigo_expira_en };
}

/**
 * Comprueba el código que alguien tipeó.
 *
 * EL ORDEN IMPORTA Y ES EL MISMO DE TODO EL PRODUCTO: primero el vencimiento, después el intento.
 * Un código vencido no gasta intento, así que quien pide uno nuevo porque el anterior se le venció
 * llega con los cinco enteros. Y el intento lo suma la base en un solo paso, que es lo que hace que
 * el tope sea un tope aunque lleguen dos pedidos juntos.
 *
 * @returns {Promise<{ id: string, telefono: string }>} la fila que se acaba de usar.
 */
export async function comprobarCodigoDelTelefono({ usuarioId, uso, codigo }) {
  if (!usuarioId || !USOS_DEL_CODIGO.includes(uso)) throw new ErrorConMotivo('faltan_datos');

  const { data: fila, error } = await supabase
    .from('codigos_al_telefono')
    .select('id, telefono, codigo_huella, codigo_expira_en, verificado_en, anulado_en')
    .eq('usuario_id', usuarioId)
    .eq('uso', uso)
    .is('verificado_en', null)
    .is('anulado_en', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  // Sin código pendiente se contesta lo mismo que con un código equivocado. Distinguirlos diría si
  // hubo un pedido para esa cuenta, y eso ya es información sobre la cuenta.
  if (!fila) throw new ErrorConMotivo('codigo_incorrecto');

  if (estaVencido(fila.codigo_expira_en)) throw new ErrorConMotivo('codigo_vencido');

  const intentos = await sumarIntento({ tabla: 'codigos_al_telefono', id: fila.id });
  if (seAgotaronLosIntentos(intentos)) throw new ErrorConMotivo('demasiados_intentos');

  if (!codigoCoincide(codigo, fila.codigo_huella)) throw new ErrorConMotivo('codigo_incorrecto');

  // Se toma condicionado a que siga libre: dos pedidos simultáneos con el mismo código no pasan los
  // dos, y un código de un solo uso no queda sirviendo de nuevo.
  const { data: tomado, error: errorTomar } = await supabase
    .from('codigos_al_telefono')
    .update({ verificado_en: new Date().toISOString() })
    .eq('id', fila.id)
    .is('verificado_en', null)
    .select('id')
    .maybeSingle();
  if (errorTomar) throw new Error(errorTomar.message);
  if (!tomado) throw new ErrorConMotivo('codigo_incorrecto');

  return { id: fila.id, telefono: fila.telefono };
}

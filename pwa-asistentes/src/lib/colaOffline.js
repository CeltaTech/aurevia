// Cola de acciones pendientes de sincronizar (check-in y confirmación de Reporte Diario)
// cuando el Asistente se queda sin señal. Ver Fase 9 del plan de rediseño de frontend —
// IndexedDB en vez de Background Sync API (no soportada en Safari/iOS), reintento manual
// al abrir/volver a la app.
//
// ACÁ ESTÁ EL DEPÓSITO; LAS REGLAS ESTÁN EN `reglasDeLaCola.js`. Este archivo abre la base del
// teléfono, guarda y borra. Qué se manda, qué se descarta y cuándo se deja de intentar se decide
// allá, que es donde se puede probar sin un teléfono delante.
//
// CADA ÍTEM QUEDA FIRMADO POR QUIEN LO ANOTÓ, y esa firma es lo que impide que la cola de una
// persona salga con la sesión de otra. Un teléfono lo usa más de una persona, y cada Prestadora
// es una cuenta distinta: sin la firma, la llegada que anotó una se registraría a nombre de la
// que entró después. Lo que no es de la sesión abierta no se lista, así que no se muestra ni se
// manda, y se descarta.

import { IDENTIDAD } from '../config/identidadProducto.js';
import { supabase } from './supabaseClient';
import { loQueSeManda, loQueSeMuestra, loQueSeDescarta, conIntentoFallido } from './reglasDeLaCola';

// Se nombra por el código técnico del producto, nunca por su nombre comercial: esta base
// vive dentro del teléfono del Asistente y puede tener check-ins y Reportes esperando señal.
// Si el nombre cambiara con la marca, la app abriría una base vacía y esos datos quedarían
// huérfanos en el dispositivo, sin sincronizar y sin forma de recuperarlos.
const DB_NOMBRE = `${IDENTIDAD.codigo}-offline`;
// La versión 2 agrega la firma de la sesión y la cuenta de intentos. Lo anotado por la versión
// anterior no tiene firma, así que queda como de otra sesión y se descarta: no hay forma de saber
// con qué cuenta se anotó, y mandarlo con la que esté abierta ahora es justo lo que no puede
// pasar.
const DB_VERSION = 2;
const ALMACEN = 'cola';

function abrirDB() {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(DB_NOMBRE, DB_VERSION);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains(ALMACEN)) {
        db.createObjectStore(ALMACEN, { keyPath: 'id' });
      }
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

async function transaccion(modo, ejecutar) {
  const db = await abrirDB();
  const almacen = db.transaction(ALMACEN, modo).objectStore(ALMACEN);
  return new Promise((resolve, reject) => {
    const pedido = ejecutar(almacen);
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

export function nuevoId() {
  return crypto.randomUUID();
}

/**
 * Quién tiene la sesión abierta en este teléfono, o `null` si no hay ninguna.
 *
 * Sale de la sesión verificada y no de nada que se le pueda pedir a la pantalla.
 */
export async function duenoDeLaSesion() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    // Sin poder resolver de quién es la sesión, no hay dueño: falla cerrado. Nada se manda y
    // nada se descarta.
    return null;
  }
}

// tipo: 'salida' | 'aviso_demora' | 'checkin' | 'reporte' | 'checkout'. payload: datos a enviar.
// guardiaId: para agrupar/mostrar. El orden de creación es el orden de envío, y así los dos
// avisos de antes de llegar (pendiente #101) salen antes que la llegada, que es el orden en que
// pasaron.
//
// `ocurridoEn` es la hora del hecho puesta por el teléfono, y se anota en el momento de encolar,
// no en el de mandar: lo que importa de un check-in que esperó tres horas de señal es cuándo
// llegó la persona, no cuándo apareció la red. Viaja al motor junto con el envío, y allá se
// guarda en su propia columna, aparte de la hora en que el dato llegó a la base.
export async function agregarACola({ id, tipo, guardiaId, payload }) {
  const item = {
    id,
    tipo,
    guardiaId,
    payload,
    duenoId: await duenoDeLaSesion(),
    creadoEn: Date.now(),
    ocurridoEn: new Date().toISOString(),
    intentos: 0,
    situacion: null,
    ultimoIntentoEn: null,
  };
  await transaccion('readwrite', (almacen) => almacen.put(item));
  return item;
}

/** Todo lo que hay anotado en este teléfono, sea de quien sea. Uso interno. */
async function todoLoAnotado() {
  const resultado = await transaccion('readonly', (almacen) => almacen.getAll());
  return resultado || [];
}

/**
 * La cola de quien tiene la sesión abierta, en orden de creación.
 *
 * Nunca devuelve lo de otra sesión. Es el único lugar por el que la cola sale del teléfono, así
 * que con esto alcanza para que lo ajeno no se muestre ni se mande.
 */
export async function listarCola() {
  const dueno = await duenoDeLaSesion();
  if (!dueno) return [];
  return loQueSeMuestra(await todoLoAnotado(), dueno);
}

/**
 * Lo que se manda: la cola de esta sesión sin lo que ya agotó sus intentos.
 *
 * Es la única puerta por la que algo sale del teléfono hacia el motor, y las dos reglas están
 * puestas en ella: el dueño y el tope.
 */
export async function colaParaMandar() {
  const dueno = await duenoDeLaSesion();
  if (!dueno) return [];
  return loQueSeManda(await todoLoAnotado(), dueno);
}

/**
 * Borra lo que quedó de otra sesión. Se llama al arrancar la sincronización.
 *
 * Devuelve cuántos ítems se descartaron, que es lo que miran las pruebas.
 */
export async function descartarLoDeOtrasSesiones() {
  const dueno = await duenoDeLaSesion();
  if (!dueno) return 0;
  const ajenos = loQueSeDescarta(await todoLoAnotado(), dueno);
  for (const item of ajenos) await quitarDeCola(item.id);
  return ajenos.length;
}

export async function quitarDeCola(id) {
  return transaccion('readwrite', (almacen) => almacen.delete(id));
}

/**
 * Anota que este envío falló, con el motivo ya clasificado en una de las ocho situaciones.
 *
 * Suma un intento. Cuando la cuenta llega al tope, el ítem deja de mandarse y se queda a la
 * vista con su motivo: no se borra, porque lo que la persona ya hizo no desaparece en silencio.
 */
export async function marcarIntentoFallido(id, situacion) {
  const db = await abrirDB();
  const almacen = db.transaction(ALMACEN, 'readwrite').objectStore(ALMACEN);
  return new Promise((resolve, reject) => {
    const pedidoGet = almacen.get(id);
    pedidoGet.onsuccess = () => {
      const item = pedidoGet.result;
      if (!item) return resolve(null);
      const actualizado = conIntentoFallido(item, situacion);
      const pedidoPut = almacen.put(actualizado);
      pedidoPut.onsuccess = () => resolve(actualizado);
      pedidoPut.onerror = () => reject(pedidoPut.error);
    };
    pedidoGet.onerror = () => reject(pedidoGet.error);
  });
}

export async function pendientesDeGuardia(guardiaId) {
  const cola = await listarCola();
  return cola.filter((item) => item.guardiaId === guardiaId);
}

// ---------------------------------------------------------------------------
// resumenDelPlantel.js — las dos cuentas que la lista de Asistentes hace de un vistazo
//
// QUÉ PROBLEMA RESUELVE
// Para saber si un Asistente tiene los papeles al día o cuántos turnos le quedan por delante
// había que entrar a su ficha, de a uno. Con un plantel de decenas de personas, eso es abrir y
// cerrar decenas de fichas para contestar una pregunta que la lista puede contestar sola.
//
// POR QUÉ NO SE CUENTA ADENTRO DE LA PANTALLA
// Son dos cuentas, no dos consultas: la de guardias se apoya en el semáforo
// (`lib/semaforoGuardia.js`) y la de papeles en la regla de vencimientos
// (`lib/reglaVencimientos.js`). Escribirlas adentro de la pantalla sería la tercera vez que
// alguien decide qué es "activa" y la octava que alguien decide qué es "por vencer". Acá se
// juntan los dos resultados y no se decide ninguno de los dos.
//
// SE CUENTA LO QUE SE TRAJO, Y SE DICE
// Las dos funciones reciben las filas ya cargadas y no consultan nada. Si la pantalla pidió las
// guardias de los próximos treinta días, el número es de treinta días: ni esta función ni la
// pantalla pueden inventar lo que no se pidió.
// ---------------------------------------------------------------------------

import { comparable } from './textoComparable';
import { estaActiva } from './semaforoGuardia';
import {
  DIAS_AVISO_POR_DEFECTO,
  ESTADO_VENCIMIENTO,
  diasParaVencer,
  estadoDeVencimiento,
} from './reglaVencimientos';

const lista = (x) => (Array.isArray(x) ? x : []);

/**
 * Hasta cuántos días adelante se cuentan las guardias de la lista.
 *
 * Una Prestadora que genera guardias por serie tiene turnos cargados hasta fin de año: traerlos
 * todos para poner un número al lado de cada nombre sería pedir miles de filas para mostrar
 * decenas. Un mes es lo que alguien tiene delante cuando mira el plantel, y el número de días
 * aparece escrito en la pantalla para que nadie crea que está viendo el total.
 */
export const DIAS_DE_HORIZONTE = 30;

/**
 * Cuántas guardias activas tiene cada Asistente.
 *
 * @param guardias  filas de `guardias` con las columnas que pide `situacionDeGuardia`, ya
 *                  acotadas al rango que la pantalla quiera contar.
 * @param ctx       lo que recibe el semáforo: `{ ahora, umbrales }`.
 * @returns `Map` de identificador de Asistente a cantidad. Quien no tenga ninguna no aparece.
 */
export function guardiasActivasPorAsistente(guardias, ctx = {}) {
  const cuenta = new Map();
  for (const guardia of lista(guardias)) {
    if (!guardia?.asistente_id) continue;
    if (!estaActiva(guardia, ctx)) continue;
    cuenta.set(guardia.asistente_id, (cuenta.get(guardia.asistente_id) ?? 0) + 1);
  }
  return cuenta;
}

/** De peor a mejor. El primero que aparezca es el que se muestra. */
const GRAVEDAD = [
  ESTADO_VENCIMIENTO.VENCIDO,
  ESTADO_VENCIMIENTO.POR_VENCER,
  ESTADO_VENCIMIENTO.VIGENTE,
];

/**
 * En qué estado está la documentación de cada Asistente: la del papel que peor esté.
 *
 * Se muestra el peor y no un promedio porque un solo papel vencido ya impide trabajar: promediarlo
 * con otros cinco al día diría "casi bien" de alguien que no puede tomar un turno.
 *
 * **Un Asistente sin papeles con vencimiento no aparece en el resultado**, y eso no es lo mismo
 * que tenerlos al día: es que no hay nada que vencer o que nadie cargó nada. Mostrarlo como
 * vigente sería afirmar algo que ninguna fila dice.
 *
 * @param documentos  filas de `documentos_asistente` con `asistente_id`, `fecha_vencimiento` y,
 *                    si vino, `tipos_documento_asistente.requiere_vencimiento`.
 * @param diasAviso   la ventana de aviso de la Prestadora.
 * @param desde       desde qué día se cuenta. Se pasa en las pruebas.
 * @returns `Map` de identificador de Asistente a una clave de `ESTADO_VENCIMIENTO`.
 */
export function documentacionPorAsistente(
  documentos,
  diasAviso = DIAS_AVISO_POR_DEFECTO,
  desde = new Date(),
) {
  const porAsistente = new Map();

  for (const documento of lista(documentos)) {
    if (!documento?.asistente_id || !documento.fecha_vencimiento) continue;
    // El tipo puede no haber venido en la consulta; en ese caso manda la fecha, que está cargada.
    // Lo que no se hace es descartar un papel por un dato que no se pidió.
    if (documento.tipos_documento_asistente?.requiere_vencimiento === false) continue;

    const estado = estadoDeVencimiento(
      diasParaVencer(documento.fecha_vencimiento, desde),
      diasAviso,
    );
    const anterior = porAsistente.get(documento.asistente_id);
    if (!anterior || GRAVEDAD.indexOf(estado) < GRAVEDAD.indexOf(anterior)) {
      porAsistente.set(documento.asistente_id, estado);
    }
  }

  return porAsistente;
}

/**
 * Las opciones de un filtro, sacadas de lo que el plantel tiene cargado.
 *
 * Las zonas y las especialidades las escribió a mano quien cargó cada ficha, así que la misma
 * zona aparece escrita de varias maneras —`San Isidro`, `san isidro`, `SAN ISIDRO`—. Se agrupan
 * con `comparable` (`textoComparable.js`), que es el mismo criterio con el que la sugerencia de
 * la Solicitud acerca las dos puntas, y se muestra la primera forma que apareció.
 *
 * **Las opciones salen del plantel y no de un catálogo** a propósito: un filtro armado con el
 * catálogo de la Prestadora ofrecería zonas donde no hay nadie y —peor— dejaría afuera lo que
 * alguien escribió sin que estuviera en la lista, que es justo lo que hay que poder encontrar.
 *
 * @param filas   el plantel.
 * @param campo   `'zonas'` o `'especialidades'`.
 * @returns array de textos, ordenado alfabéticamente, sin repetidos.
 */
export function opcionesDelPlantel(filas, campo) {
  const vistas = new Map();
  for (const fila of lista(filas)) {
    for (const texto of lista(fila?.[campo])) {
      const clave = comparable(texto);
      if (!clave || vistas.has(clave)) continue;
      vistas.set(clave, String(texto).trim());
    }
  }
  return [...vistas.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * ¿Esta ficha tiene el valor elegido en el filtro?
 *
 * Compara con el mismo criterio con el que se armaron las opciones: si no, elegir `San Isidro`
 * dejaría afuera a quien escribió `san isidro`, que es la persona que se estaba buscando.
 * Sin nada elegido no filtra nada.
 */
export function coincideConElFiltro(fila, campo, elegido) {
  if (!elegido) return true;
  const buscado = comparable(elegido);
  return lista(fila?.[campo]).some((texto) => comparable(texto) === buscado);
}

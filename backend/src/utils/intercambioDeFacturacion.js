// ---------------------------------------------------------------------------
// intercambioDeFacturacion.js — qué sale hacia el facturador y qué vuelve de él
//
// POR QUÉ EXISTE ESTE ARCHIVO. Careonys no emite comprobantes: manda a facturar y guarda lo que
// el software de facturación de la Prestadora le informa. Ese ida y vuelta puede pasar de tres
// maneras —cargado a mano factura por factura, por un archivo que se baja y se sube, o por una
// conexión directa con ese software—, y las tres mueven exactamente los mismos datos. Acá está
// escrito una sola vez cuáles son, así las tres vías entran por la misma puerta y agregar la
// tercera no obliga a rehacer las otras dos.
//
// QUÉ SALE. Por cada factura que todavía no tiene comprobante anotado: de quién es, con qué
// cliente del otro lado se corresponde esa Familia, a quién se le reclama, de qué período, en qué
// moneda, por cuánto y para cuándo. La referencia al cliente del otro lado va vacía mientras esa
// Familia no esté apareada, y ahí el software de facturación lo resuelve por el nombre como
// siempre lo hizo.
//
// QUÉ VUELVE. Los tres datos de siempre —cómo se llama el comprobante, qué número tiene y cuánto
// quedó adeudando la Familia— más el vencimiento, si quien emitió informa uno distinto del
// acordado. El nombre del comprobante es texto que se guarda y no se interpreta: cambia de país en
// país y el producto no conoce ninguno.
//
// LOS TÍTULOS DE LAS COLUMNAS NO SE TRADUCEN. No son texto de pantalla: son la forma del archivo
// que el otro software tiene que leer y escribir. Traducirlos haría que el mismo archivo tuviera
// tres formas distintas según el idioma de quien lo bajó, y ninguna Prestadora podría dejar
// configurado su software una sola vez. Por eso se nombran por su función y no cambian nunca.
//
// NO IMPORTA NADA A PROPÓSITO. Este archivo lo usa el Panel y el motor usa una copia generada
// (`backend/src/utils/intercambioDeFacturacion.js`, ver `scripts/copias_entre_apps.mjs`).
// ---------------------------------------------------------------------------

import { loQueEstaMalEnLoFacturado } from './facturacionDeFamilias.js';

/** Las columnas del archivo que Careonys entrega para que la Prestadora facture. */
export const COLUMNAS_QUE_SALEN = [
  'factura_id',
  'familia',
  'cliente_externo',
  'financiador_tipo',
  'financiador_nombre',
  'periodo',
  'moneda',
  'monto_a_facturar',
  'fecha_vencimiento',
];

/** Las columnas del archivo que Careonys lee para anotar lo que se emitió. */
export const COLUMNAS_QUE_VUELVEN = [
  'factura_id',
  'comprobante_tipo',
  'comprobante_numero',
  'monto_facturado',
  'fecha_vencimiento',
];

/**
 * Las columnas del archivo con el que se aparea cada Familia con el cliente del otro software.
 *
 * Es el mismo archivo para las dos direcciones: se baja con las Familias y la referencia que ya
 * tengan —vacía las que todavía no—, se completa al lado de cada una y se vuelve a subir. Así una
 * Prestadora que ya tenía sus clientes cargados antes de empezar aparea todo de una vez, sin
 * buscar Familia por Familia.
 */
export const COLUMNAS_DEL_APAREO = ['familia_id', 'familia', 'cliente_externo'];

/**
 * Cuál de las clases de conexión del catálogo es la del software que emite los comprobantes.
 *
 * Está escrita una sola vez porque es la que usa todo lo de este archivo: el catálogo dice qué
 * clases existen, y ésta dice cuál de ellas es la que a este ida y vuelta le importa.
 */
export const CONEXION_DE_FACTURACION = 'facturacion';

/** Largo máximo de la referencia, el mismo que acepta la base. */
export const LARGO_MAXIMO_DEL_CLIENTE_EXTERNO = 128;

/**
 * Lo que informó una fila sobre el apareo de una Familia.
 *
 * La referencia vacía no es un error: quiere decir que esa Familia no está apareada, y es lo que
 * trae el archivo recién bajado. Qué se hace con ella lo decide la función de abajo.
 */
export function elApareoDeLaFila(fila) {
  return {
    familia_id: String(fila?.familia_id ?? '').trim(),
    cliente_externo: String(fila?.cliente_externo ?? '').trim(),
  };
}

/**
 * Qué se hace con un renglón del archivo de apareo: anotarlo, borrarlo, saltearlo o rechazarlo.
 *
 * Está acá y no adentro de la ruta por lo mismo que la decisión de lo facturado: es lo único que
 * puede salir mal y se prueba sin base.
 *
 * Borrar la referencia es una decisión legítima —se cambió de software, o se apareó a la Familia
 * equivocada—, así que una celda vaciada a propósito borra. Lo que no puede pasar es que el
 * archivo bajado y vuelto a subir sin tocar nada borre todo, y por eso una fila vacía que ya
 * estaba vacía se cuenta como que no cambió nada.
 */
export function queHacerConLaFilaDeApareo(apareo, { yaVista = false, apareada = null } = {}) {
  if (!esIdentificador(apareo?.familia_id)) return { resultado: 'rechazado', motivo: 'familia_id' };
  if (yaVista) return { resultado: 'rechazado', motivo: 'repetida' };

  const referencia = apareo?.cliente_externo ?? '';
  if (referencia.length > LARGO_MAXIMO_DEL_CLIENTE_EXTERNO) {
    return { resultado: 'rechazado', motivo: 'cliente_externo' };
  }

  if (referencia === '') return apareada ? { resultado: 'borrado' } : { resultado: 'sin_cambio' };
  if (referencia === apareada) return { resultado: 'sin_cambio' };
  return { resultado: 'apareado' };
}

/**
 * Cuántas filas como máximo se leen de un archivo de una vez.
 *
 * El mismo tope que el lote de cobros, y por el mismo motivo: un archivo enorme cargado por error
 * no puede quedarse con el motor. Quien tenga más, sube dos archivos.
 */
export const TOPE_DE_FILAS = 500;

/**
 * Con qué se separan las columnas al escribir.
 *
 * El punto y coma, porque es lo que abre en columnas cuando el sistema está en castellano o en
 * portugués, que es donde se usa el producto. Al leer no importa: se reconoce el que traiga el
 * archivo.
 */
const SEPARADOR_AL_ESCRIBIR = ';';

/** Con cuáles se prueba al leer, en este orden. */
const SEPARADORES_POSIBLES = [';', ',', '\t'];

/** Un valor de una celda, escrito de forma que sobreviva a los puntos y coma y a las comillas. */
function celda(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  if (!/["\r\n;,\t]/.test(texto)) return texto;
  return `"${texto.replace(/"/g, '""')}"`;
}

/**
 * Un archivo de texto con estas filas, listo para bajar.
 *
 * Lleva adelante la marca que hace que la planilla de cálculo lo abra con los acentos en su lugar.
 * Sin ella, un nombre con eñe se ve roto y la Prestadora cree que el archivo vino mal.
 */
export function armarArchivo(filas, columnas = COLUMNAS_QUE_SALEN) {
  const renglones = [columnas.join(SEPARADOR_AL_ESCRIBIR)];
  for (const fila of filas) {
    renglones.push(columnas.map((c) => celda(fila[c])).join(SEPARADOR_AL_ESCRIBIR));
  }
  return `﻿${renglones.join('\r\n')}\r\n`;
}

/** Cuál de los separadores usa este renglón: el que más veces aparece fuera de comillas. */
function separadorDe(renglon) {
  let elegido = SEPARADOR_AL_ESCRIBIR;
  let mejor = 0;
  for (const candidato of SEPARADORES_POSIBLES) {
    const veces = renglon.split(candidato).length - 1;
    if (veces > mejor) {
      mejor = veces;
      elegido = candidato;
    }
  }
  return elegido;
}

/** Los valores de un renglón, respetando las comillas y los separadores que estén adentro. */
function valoresDe(renglon, separador) {
  const valores = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < renglon.length; i += 1) {
    const letra = renglon[i];
    if (entreComillas) {
      if (letra === '"' && renglon[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else if (letra === '"') {
        entreComillas = false;
      } else {
        actual += letra;
      }
    } else if (letra === '"') {
      entreComillas = true;
    } else if (letra === separador) {
      valores.push(actual);
      actual = '';
    } else {
      actual += letra;
    }
  }
  valores.push(actual);
  return valores.map((v) => v.trim());
}

/**
 * Las filas de un archivo, con cada valor debajo del título de su columna.
 *
 * Los títulos se comparan en minúscula y sin espacios de sobra, porque una planilla de cálculo
 * puede devolverlos con otra caja de la que salieron. Un renglón vacío se saltea: casi todos los
 * archivos terminan con uno.
 */
export function leerArchivo(texto) {
  const limpio = String(texto ?? '').replace(/^﻿/, '');
  const renglones = limpio.split(/\r\n|\n|\r/).filter((r) => r.trim() !== '');
  if (renglones.length === 0) return { columnas: [], filas: [] };

  const separador = separadorDe(renglones[0]);
  const columnas = valoresDe(renglones[0], separador).map((c) => c.toLowerCase());

  const filas = renglones.slice(1, TOPE_DE_FILAS + 1).map((renglon) => {
    const valores = valoresDe(renglon, separador);
    const fila = {};
    columnas.forEach((columna, i) => {
      fila[columna] = valores[i] ?? '';
    });
    return fila;
  });

  return { columnas, filas };
}

/**
 * Un número escrito como lo escribe una planilla de cálculo, convertido a número.
 *
 * Hace falta porque el mismo importe se escribe `1.234,56` en castellano y `1,234.56` en inglés, y
 * el archivo lo devuelve tal como lo guardó quien lo abrió. Manda el último separador: lo que está
 * a su derecha son los centavos.
 */
export function numeroDeArchivo(valor) {
  const texto = String(valor ?? '').trim().replace(/\s/g, '');
  if (texto === '') return NaN;

  const ultimaComa = texto.lastIndexOf(',');
  const ultimoPunto = texto.lastIndexOf('.');
  if (ultimaComa === -1 && ultimoPunto === -1) return Number(texto);

  const corte = Math.max(ultimaComa, ultimoPunto);
  const entero = texto.slice(0, corte).replace(/[.,]/g, '');
  const decimales = texto.slice(corte + 1);
  // Tres dígitos a la derecha del último separador no son centavos: es el separador de miles.
  if (decimales.length === 3 && !/[.,]/.test(texto.slice(0, corte))) return Number(entero + decimales);
  return Number(`${entero}.${decimales}`);
}

/**
 * Una fecha escrita como la escribe una planilla de cálculo, en la forma que guarda la base.
 *
 * Se aceptan la forma con el año adelante y la de día, mes y año separados por barra, que es la
 * que devuelve Excel en castellano y en portugués. Cualquier otra cosa se devuelve vacía, y la
 * comprobación de más abajo la rechaza diciendo cuál es el dato.
 */
export function fechaDeArchivo(valor) {
  const texto = String(valor ?? '').trim();
  if (texto === '') return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);

  const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  if (barras) {
    const [, dia, mes, anio] = barras;
    return `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }
  return '';
}

/**
 * Lo que informó el archivo sobre una factura, con cada dato en la forma en que se guarda.
 *
 * Es la traducción de una fila a lo que espera la puerta por la que se anota lo facturado. Si el
 * archivo no trae una columna, el dato queda sin informar y no se pisa lo que ya había.
 */
export function loFacturadoDeLaFila(fila) {
  const facturado = {
    factura_id: String(fila?.factura_id ?? '').trim(),
    monto_facturado: numeroDeArchivo(fila?.monto_facturado),
    comprobante_tipo: String(fila?.comprobante_tipo ?? '').trim(),
    comprobante_numero: String(fila?.comprobante_numero ?? '').trim() || null,
  };
  if (fila?.fecha_vencimiento !== undefined && String(fila.fecha_vencimiento).trim() !== '') {
    facturado.fecha_vencimiento = fechaDeArchivo(fila.fecha_vencimiento);
  }
  return facturado;
}

/* Un identificador de los que usa la base. Se comprueba la forma antes de preguntarle a la base,
   porque un identificador mal escrito —una celda corrida, un número de comprobante puesto en la
   columna equivocada— la hace contestar con un error de tipo, y eso cortaría el archivo entero en
   lugar de rechazar ese renglón. */
export function esIdentificador(valor) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(valor ?? ''));
}

/**
 * Qué se hace con un renglón del archivo: anotarlo, saltearlo o rechazarlo.
 *
 * Está acá y no adentro de la ruta para que se pueda probar sin base: la decisión es lo único que
 * puede salir mal, y depende de tres cosas nada más —lo que dice el renglón, si esa factura
 * apareció antes en el mismo archivo, y qué encontró la base—.
 *
 * `factura` es lo que la base devolvió para ese identificador, o `null` si no encontró nada
 * **de esta Prestadora**: quién es de quién lo resuelve la consulta, no esta función.
 *
 * Una factura que ya tiene comprobante anotado no se pisa. Así subir dos veces el mismo archivo
 * no hace daño, y se respeta que una factura emitida no cambia: lo que salió mal se arregla con
 * una corrección, que tiene su propia puerta.
 */
export function queHacerConLaFilaFacturada(facturado, { yaVista = false, factura = null } = {}) {
  if (!esIdentificador(facturado?.factura_id)) return { resultado: 'rechazado', motivo: 'factura_id' };
  if (yaVista) return { resultado: 'ya_facturada' };

  const problema = loQueEstaMalEnLoFacturado(facturado);
  if (problema) return { resultado: 'rechazado', motivo: problema };

  if (!factura) return { resultado: 'rechazado', motivo: 'no_encontrada' };
  if (factura.facturado_at) return { resultado: 'ya_facturada' };

  return { resultado: 'anotado' };
}

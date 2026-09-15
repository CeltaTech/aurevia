/**
 * Lo que se compara cuando se prueba una restauración, separado de lo que la ejecuta.
 *
 * QUÉ RESUELVE. Un respaldo que sube todas las noches no prueba nada hasta el día que se
 * restaura. La prueba que se hizo una vez comparó la base restaurada contra la de producción a
 * ojo, tabla por tabla, y ese es justo el trabajo que no conviene hacer a mano: es largo, es
 * aburrido, y el error que se escapa es el de la tabla que nadie miró.
 *
 * POR QUÉ ESTÁ ACÁ Y NO ADENTRO DEL SCRIPT. Bajar un respaldo de producción, levantar una base
 * efímera y restaurar adentro pide credenciales que viven en la caja fuerte, así que ese script
 * lo corre el Desarrollador y no se puede probar desde acá. Lo que sí se puede probar es esto:
 * decidir cuál es el respaldo más nuevo, y decidir si lo que volvió es igual a lo que había. Si
 * esa decisión vive suelta adentro del script, no la prueba nadie nunca.
 *
 * UNA COMPARACIÓN QUE NO PUEDE FALLAR NO PRUEBA NADA. Hoy producción tiene tablas enteras en
 * cero. Comparar cero contra cero da igual y da verde, y ese verde es mentira: la misma
 * comparación daría verde con el respaldo vacío. Por eso cada comparación devuelve además
 * cuántas tablas tenían datos y cuántos archivos había: con ninguno, el veredicto es que la
 * prueba no probó nada, que no es lo mismo que decir que salió bien.
 *
 * NO ENTRA NINGÚN DATO DE NADIE. Se comparan nombres de tabla, cantidades y tamaños. Nunca el
 * contenido de una fila, y de los archivos, nunca la ruta: la ruta de un certificado dice de
 * quién es. Lo que sale de acá va a la pantalla del Desarrollador, y tiene que poder pegarse en
 * cualquier lado sin pensarlo dos veces.
 */

/** Nombre de un volcado en el bucket, tal como lo escribe `backup_a_buckets.mjs`. */
const VOLCADO = /^([a-z0-9_-]+)_backup_(.+)\.sql\.gz$/;

/**
 * El respaldo más nuevo de una lista de claves del bucket.
 *
 * El nombre lleva la fecha en formato ISO con los dos puntos cambiados por guiones, así que el
 * orden alfabético ya es el cronológico y no hace falta interpretar la fecha. Las claves del
 * espejo de archivos (`archivos/...`) quedan afuera: no son volcados.
 */
export function elegirElUltimoRespaldo(claves) {
  const volcados = claves.filter((clave) => VOLCADO.test(clave)).sort();
  if (volcados.length === 0) {
    throw new Error('No hay ningún volcado en el bucket: el respaldo nunca subió, o subió con otro nombre.');
  }
  return volcados[volcados.length - 1];
}

/**
 * Qué tablas de la base real no aparecieron en la restaurada, y cuáles aparecieron de más.
 *
 * Las de más importan tanto como las que faltan: una tabla que está en el volcado y ya no está
 * en producción quiere decir que el volcado quedó viejo.
 */
export function diferenciasDeTablas(enProduccion, enLaRestaurada) {
  const restauradas = new Set(enLaRestaurada);
  const reales = new Set(enProduccion);
  return {
    faltan: enProduccion.filter((tabla) => !restauradas.has(tabla)),
    sobran: enLaRestaurada.filter((tabla) => !reales.has(tabla)),
  };
}

/**
 * Qué tablas volvieron con distinta cantidad de filas.
 *
 * Recibe dos mapas de tabla a cantidad. Devuelve además `conDatos`, que es cuántas tablas tenían
 * al menos una fila en producción: sin ninguna, la comparación entera es un cero contra cero.
 */
export function diferenciasDeConteo(enProduccion, enLaRestaurada) {
  const distintas = [];
  let conDatos = 0;
  for (const [tabla, cantidad] of Object.entries(enProduccion)) {
    if (cantidad > 0) conDatos += 1;
    const restaurada = enLaRestaurada[tabla];
    if (restaurada !== cantidad) {
      distintas.push({ tabla, produccion: cantidad, restaurada: restaurada ?? null });
    }
  }
  return { distintas, conDatos, comparadas: Object.keys(enProduccion).length };
}

/**
 * Qué archivos del almacenamiento no están en el espejo del bucket, o están con otro tamaño.
 *
 * Los dos inventarios son mapas de clave a tamaño, con la clave ya en la forma del espejo
 * (`archivos/<depósito>/<ruta>`), que es la que arma `claveEnElDestino`. Lo que devuelve son
 * cantidades y el depósito, nunca la ruta.
 */
export function diferenciasDeArchivos(enElAlmacenamiento, enElEspejo) {
  const faltan = new Map();
  const distintos = new Map();
  const sumar = (mapa, clave) => {
    const deposito = depositoDeLaClave(clave);
    mapa.set(deposito, (mapa.get(deposito) || 0) + 1);
  };

  for (const [clave, tamano] of Object.entries(enElAlmacenamiento)) {
    if (!(clave in enElEspejo)) sumar(faltan, clave);
    else if (enElEspejo[clave] !== tamano) sumar(distintos, clave);
  }

  return {
    faltan: Object.fromEntries(faltan),
    distintos: Object.fromEntries(distintos),
    comparados: Object.keys(enElAlmacenamiento).length,
  };
}

/** El depósito al que pertenece una clave del espejo. Sin la ruta, que dice de quién es. */
export function depositoDeLaClave(clave) {
  const partes = clave.split('/');
  return partes.length >= 2 && partes[0] === 'archivos' ? partes[1] : '(fuera del espejo)';
}

/**
 * El veredicto de la prueba entera, en una sola pieza.
 *
 * Tres resultados y no dos. `roto` es que algo volvió mal. `no_probado` es que todo coincidió
 * pero no había nada que comparar —ni una fila, ni un archivo—, y entonces el verde no significa
 * nada. `bien` exige las dos cosas: que nada difiera y que hubiera algo que mirar.
 */
export function veredicto({ tablas, conteos, archivos }) {
  const motivos = [];
  if (tablas.faltan.length > 0) {
    motivos.push(`${tablas.faltan.length} tablas no volvieron: ${tablas.faltan.join(', ')}.`);
  }
  if (tablas.sobran.length > 0) {
    motivos.push(`${tablas.sobran.length} tablas del volcado ya no existen en producción: ${tablas.sobran.join(', ')}.`);
  }
  for (const d of conteos.distintas) {
    motivos.push(`${d.tabla}: ${d.produccion} filas en producción y ${d.restaurada ?? 'ninguna tabla'} en la restaurada.`);
  }
  for (const [deposito, cantidad] of Object.entries(archivos.faltan)) {
    motivos.push(`${cantidad} archivos de ${deposito} no están en el espejo.`);
  }
  for (const [deposito, cantidad] of Object.entries(archivos.distintos)) {
    motivos.push(`${cantidad} archivos de ${deposito} están en el espejo con otro tamaño.`);
  }
  if (motivos.length > 0) return { estado: 'roto', motivos };

  const vacios = [];
  if (conteos.conDatos === 0) vacios.push('ninguna tabla tenía una sola fila');
  if (archivos.comparados === 0) vacios.push('no había ningún archivo cargado');
  if (vacios.length > 0) {
    return {
      estado: 'no_probado',
      motivos: [
        `Todo coincidió, y aun así la prueba no probó nada: ${vacios.join(' y ')}. `
        + 'Un respaldo vacío pasa esta misma comparación. Cargar datos de prueba y repetirla.',
      ],
    };
  }

  return {
    estado: 'bien',
    motivos: [
      `${conteos.comparadas} tablas y ${archivos.comparados} archivos volvieron iguales, `
      + `con datos en ${conteos.conDatos} tablas.`,
    ],
  };
}

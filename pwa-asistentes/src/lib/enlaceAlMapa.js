// Cómo se le entrega una dirección al mapa del teléfono.
//
// POR QUÉ NO SE ARMA LA DIRECCIÓN WEB DE NINGÚN SERVICIO DE MAPAS. Un enlace a un mapa en la web
// lleva el domicilio escrito adentro de la dirección, y esa dirección la ven el servicio de
// mapas, el historial del navegador y cualquiera que mire el tráfico por el camino. Dónde vive
// una persona que recibe cuidados es dato sensible, y no va en una dirección ni en un parámetro
// (CLAUDE.md de CeltaTech, «Seguridad, privacidad y auditoría»). Los dos esquemas de acá abajo no
// salen del aparato: se le entrega el lugar al teléfono y él abre la aplicación de mapas que la
// persona tenga instalada y haya elegido. El producto no elige proveedor por nadie.
//
// Y SON DOS PORQUE NO HAY UNO SOLO. `geo:` es el esquema estándar, y lo entienden Android y los
// escritorios con una aplicación de mapas instalada. Los aparatos de Apple no lo entienden y usan
// `maps:`. Un enlace `geo:` en un iPhone no abre nada y tampoco avisa, que es peor que no
// ponerlo.
//
// SE PREFIEREN LAS COORDENADAS al texto de la dirección cuando las hay. Son exactas —una
// dirección escrita se puede parecer a otra en otro barrio— y además así el texto del domicilio
// no viaja ni siquiera hasta la aplicación de mapas.

function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Si el aparato es de los que no entienden `geo:`. */
export function esAparatoDeApple(agente) {
  return /iPhone|iPad|iPod|Macintosh/i.test(String(agente ?? ''));
}

/**
 * El enlace que abre este lugar en el mapa del teléfono, o null si no hay nada que abrir.
 *
 * `lugar` es un Paciente, o cualquier objeto con `domicilio`, `lat` y `lng` — lo que devuelve
 * `domiciliosDeLaGuardia` sirve tal cual. Devolver null y no una cadena vacía es a propósito:
 * quien llama tiene que poder dibujar el domicilio sin enlace, que es lo que corresponde cuando
 * la Prestadora apagó el dato o cuando todavía no hay dirección cargada.
 */
export function enlaceAlMapa(lugar, agente = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  const texto = typeof lugar?.domicilio === 'string' ? lugar.domicilio.trim() : '';
  const lat = numero(lugar?.lat);
  const lng = numero(lugar?.lng);
  const hayCoordenadas = lat !== null && lng !== null;
  if (!hayCoordenadas && !texto) return null;

  const apple = esAparatoDeApple(agente);
  if (hayCoordenadas) {
    const par = `${lat},${lng}`;
    return apple ? `maps://?ll=${par}&q=${encodeURIComponent(par)}` : `geo:${par}?q=${encodeURIComponent(par)}`;
  }
  return apple ? `maps://?q=${encodeURIComponent(texto)}` : `geo:0,0?q=${encodeURIComponent(texto)}`;
}

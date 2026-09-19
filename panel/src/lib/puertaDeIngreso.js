import { IDENTIDAD } from '../config/identidadProducto.js';

// LA PUERTA POR DONDE SE ENTRÓ.
//
// QUÉ RESUELVE. Cada Prestadora entra por su propia dirección, del tipo
// `cuidardelsur.careonys.com`. De ahí sale de qué Prestadora se trata, y de ningún otro lado: ni de
// un casillero donde se elija, ni de un encabezado, ni de lo que venga adentro del pedido, que lo
// escribe quien llama.
//
// POR QUÉ HACE FALTA SABERLO ANTES DE LA CLAVE. La misma persona tiene una cuenta distinta en cada
// Prestadora donde trabaja, y con qué correo se le habla al servicio de acceso lleva la Prestadora
// adentro (`lib/correoDeAcceso.js`). Sin saber de cuál se trata no hay ninguna cuenta que abrir.
//
// Y DE PASO NO SE INSINÚA NADA. Un correo que tiene cuenta en otra Prestadora arma, en esta puerta,
// una cuenta de acceso que no existe: falla igual que un correo que no existe en ninguna parte, por
// el mismo camino y con el mismo mensaje. Nadie averigua dónde más trabaja una persona probando su
// correo.
//
// CÓMO SE LE DICE AL MOTOR. El motor ya sabe resolver una Prestadora, y lo hace por un segmento de
// la dirección —`/api/publico/:prestadora/…`—, que busca contra `configuracion_prestadora.dominio`
// (`backend/src/middleware/resolverPrestadoraPublica.js`). No se inventa otro mecanismo: la
// pantalla traduce el subdominio del navegador a ese segmento, y el motor queda como está.

/**
 * Qué segmento le corresponde a la dirección desde la que se abrió la pantalla.
 *
 * `cuidardelsur.careonys.com` es la Prestadora `cuidardelsur`; una dirección propia de ella
 * —`panel.cuidardelsur.com.ar`— viaja entera, porque entera es como quedaría cargada. `localhost`
 * viaja entero también, que es lo que hace que la máquina de trabajo entre por la Prestadora de
 * pruebas.
 *
 * Una dirección vacía devuelve vacío, y con eso el motor contesta que no reconoce ninguna
 * Prestadora: no se adivina, y no se cae a ninguna por descarte.
 *
 * @param {string} direccion  el nombre de la máquina del navegador (`window.location.hostname`)
 * @returns {string}
 */
export function segmentoDeLaPuerta(direccion) {
  const nombre = String(direccion ?? '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  if (!nombre) return '';

  const sufijo = `.${String(IDENTIDAD.dominio ?? '').toLowerCase()}`;
  if (sufijo.length > 1 && nombre.endsWith(sufijo)) {
    const primera = nombre.slice(0, -sufijo.length);
    // Sólo la primera etiqueta: `algo.otra.careonys.com` no es la Prestadora `algo.otra`, y
    // devolverlo así haría que una dirección de más niveles buscara un dominio que nadie cargó.
    return primera.split('.')[0] ?? '';
  }

  return nombre;
}

/**
 * ¿Se sabe de qué Prestadora es esta puerta?
 *
 * Falla cerrado: mientras no haya una Prestadora con su identificador, la pantalla no ofrece
 * entrar. Un valor vacío no decide nada acá (`celtatech/CLAUDE.md` §5).
 *
 * @param {{ prestadoraId?: string|null }|null|undefined} prestadora
 * @returns {boolean}
 */
export function laPuertaEstaReconocida(prestadora) {
  return Boolean(prestadora && typeof prestadora.prestadoraId === 'string' && prestadora.prestadoraId.trim());
}

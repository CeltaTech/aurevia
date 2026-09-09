import { ErrorConMotivo, responderError } from '../utils/errorConMotivo.js';

// Un tope de pedidos por minuto para las rutas donde se piden y se prueban códigos de un solo
// uso (pendiente #177).
//
// POR QUÉ HACE FALTA. El código de seis dígitos tiene su propio tope de intentos, pero ese tope
// vive en la fila de la base y sólo protege esa fila. Nada impedía que un mismo teléfono pidiera
// códigos sin parar, ni que probara códigos contra el camino que todavía no lleva cuenta —el que
// alguien muestra en la pantalla de su teléfono, que se renueva solo cada pocos segundos y no
// tiene contador—. En la firma del titular es más claro todavía: ahí quien prueba los códigos es
// exactamente la misma persona que los pide.
//
// EL NÚMERO NO ESTÁ ESCRITO EN EL CÓDIGO. Sale de la variable de entorno
// `TOPE_PEDIDOS_POR_MINUTO`, documentada en `backend/.env.example`, con un valor de fábrica acá
// para el caso corriente de un archivo de entorno con el renglón sin completar. Es el mismo
// criterio del nombre del modelo de IA (`config/modeloIA.js`).
//
// POR QUÉ ES CONFIGURACIÓN DEL PRODUCTO Y NO REGLA DE CADA PRESTADORA. Es una defensa contra el
// abuso de la plataforma, no una diferencia entre Prestadoras. Si viviera en la base, cada
// Prestadora podría subirse su propio techo de fuerza bruta —y la que se equivocara al cargarlo
// dejaría el agujero abierto sin que nadie se entere—; además hace falta que valga también en
// pedidos donde todavía no se resolvió de qué Prestadora se trata. La decisión definitiva es del
// Desarrollador y está planteada en el informe.
//
// QUIÉN CUENTA COMO "EL MISMO". La identidad la resuelve el motor de la sesión ya verificada
// —`req.usuarioFamilia`, `req.usuarioAsistente`, `req.usuarioPanel`—, nunca un dato que venga en
// el pedido: un encabezado o una dirección de red los elige quien llama. Si no hay identidad
// resuelta, se niega: todo control de acceso falla cerrado (CLAUDE.md §5).
//
// LO QUE ESTE TOPE NO ES. La cuenta vive en la memoria de este proceso. Con varias copias del
// motor corriendo a la vez, cada una lleva la suya y el tope efectivo se multiplica por la
// cantidad de copias. Alcanza para lo que tiene que frenar —probar seis dígitos de a uno—, y el
// día que el motor corra repartido, esto se muda a un contador compartido sin cambiar las rutas.

const VENTANA_MS = 60 * 1000;
const TOPE_POR_OMISION = 10;

/**
 * Cuántos pedidos por minuto se toleran. Se lee en cada pedido y no una sola vez al arrancar,
 * para que cambiarlo no obligue a reiniciar y para que las pruebas puedan moverlo.
 *
 * Un valor vacío, con espacios, no entero o menor que uno se trata como si no estuviera: es el
 * caso corriente del renglón puesto y sin completar, y dejar que eso mande apagaría el tope.
 */
export function topePedidosPorMinuto() {
  const crudo = String(process.env.TOPE_PEDIDOS_POR_MINUTO ?? '').trim();
  if (!crudo) return TOPE_POR_OMISION;

  const numero = Number(crudo);
  if (!Number.isInteger(numero) || numero < 1) {
    console.warn('topeDePedidos: TOPE_PEDIDOS_POR_MINUTO no es un número entero mayor que cero; se usa el valor de fábrica');
    return TOPE_POR_OMISION;
  }
  return numero;
}

// Clave -> las horas de los pedidos que todavía entran en la ventana.
const pedidos = new Map();

// Se limpia sobre la marcha y no con una tarea de fondo: el motor ya lanza varias al arrancar, y
// una décima que sólo existe para vaciar un mapa mantendría vivo el proceso en las pruebas.
let desdeLaUltimaLimpieza = 0;
const PEDIDOS_ENTRE_LIMPIEZAS = 500;

function limpiarViejos(corte) {
  for (const [clave, marcas] of pedidos) {
    const vivas = marcas.filter((marca) => marca > corte);
    if (vivas.length === 0) pedidos.delete(clave);
    else pedidos.set(clave, vivas);
  }
}

/** Sólo para las pruebas: deja el contador como recién arrancado. */
export function olvidarPedidos() {
  pedidos.clear();
  desdeLaUltimaLimpieza = 0;
}

function quienPide(req) {
  return req.usuarioFamilia?.id ?? req.usuarioAsistente?.id ?? req.usuarioPanel?.id ?? null;
}

/**
 * Arma el control para una ruta.
 *
 * `nombre` separa las cuentas: gastar los pedidos de la firma no tiene que dejar sin pedidos al
 * pase de guardia. `soloSi` permite contar nada más que los pedidos que corresponde —en la
 * llegada y en la salida de una guardia, únicamente los que traen un código—, para que el piso
 * siga intacto: entrar eligiendo un motivo nunca se frena, o el tope trabaría la guardia, que es
 * justamente lo que este producto no hace.
 */
export function topeDePedidos({ nombre, soloSi = null }) {
  if (!nombre) throw new Error('topeDePedidos: falta el nombre del tope');

  return function controlarTopeDePedidos(req, res, next) {
    if (typeof soloSi === 'function' && !soloSi(req)) return next();

    const quien = quienPide(req);
    if (!quien) {
      // Sin identidad resuelta no se cuenta: se niega. Pasa si este control quedara montado
      // antes del que verifica la sesión, y es preferible una ruta que no anda a un tope que no
      // frena nada.
      console.warn(`topeDePedidos: pedido sin identidad resuelta en «${nombre}»; se niega`);
      return responderError(res, new ErrorConMotivo('demasiados_pedidos', 'No se pudo identificar quién hace el pedido'));
    }

    const ahora = Date.now();
    const corte = ahora - VENTANA_MS;

    if (++desdeLaUltimaLimpieza >= PEDIDOS_ENTRE_LIMPIEZAS) {
      desdeLaUltimaLimpieza = 0;
      limpiarViejos(corte);
    }

    const clave = `${nombre}:${quien}`;
    const marcas = (pedidos.get(clave) ?? []).filter((marca) => marca > corte);

    if (marcas.length >= topePedidosPorMinuto()) {
      pedidos.set(clave, marcas);
      // Queda constancia de quién y en qué tope, nunca el código ni el contenido del pedido
      // (CLAUDE.md §6).
      console.warn(`topeDePedidos: se alcanzó el tope de «${nombre}» para ${quien}`);
      return responderError(res, new ErrorConMotivo('demasiados_pedidos', 'Demasiados pedidos en poco tiempo'));
    }

    marcas.push(ahora);
    pedidos.set(clave, marcas);
    return next();
  };
}

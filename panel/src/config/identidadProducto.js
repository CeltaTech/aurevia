// ---------------------------------------------------------------------------
// identidadProducto.js — Identidad de marca del producto (Etapa 0.5)
//
// ARCHIVO ESPEJADO. Existe una copia byte a byte idéntica en:
//   backend/src/config/identidadProducto.js
//   panel/src/config/identidadProducto.js
//   pwa-asistentes/src/config/identidadProducto.js
//   pwa-familias/src/config/identidadProducto.js
//
// No se comparte por import desde un único archivo en la raíz porque cada unidad
// se despliega por separado y sin acceso al resto del repo: `railway up` sube solo
// backend/ (.github/workflows/deploy-backend.yml:31) y cada frontend tiene su
// propio vercel.json con su root directory. Un import a ../../identidad.js
// compilaría en local y rompería en producción.
//
// La sincronía de las 4 copias la garantiza scripts/verificar_identidad.mjs, que
// falla el build si difieren — el punto único de verdad de CLAUDE.md §7 regla 12
// se sostiene con un invariante verificado, no con un import que el despliegue
// no permite.
//
// CÓMO SE LE CAMBIA EL NOMBRE AL PRODUCTO
//   1. Editar los valores de IDENTIDAD en este archivo.
//   2. Correr `node scripts/sincronizar_identidad.mjs` desde la raíz del repo.
//   3. Listo. No hay que tocar ningún otro archivo: todo texto visible usa los
//      marcadores {{producto}} / {{productoCorto}} / {{dominio}} y se resuelve en
//      tiempo de ejecución.
//
// `codigo` es la única excepción: NO se cambia nunca. Es la clave técnica con la
// que CeltaTech identifica al producto y con la que se arman las claves de
// entitlements (`aurevia.pacientes.activos_max`) — por eso siguen diciendo
// `aurevia` aunque la marca ya sea Careonys. Renombrar la marca no toca un
// solo dato guardado. Ver PLAN_SEPARACION_CELTATECH.md, Etapa 0.5.
//
// A partir de la Etapa 3 la fuente de verdad de estos valores pasa a ser CeltaTech y
// se replican por el mismo canal que los entitlements. Hasta entonces esta config
// ES la fuente de verdad. Los puntos de consumo no cambian cuando eso pase.
//
// ===========================================================================
// LO QUE ESTE ARCHIVO NO ES: LA MARCA DE LA PRESTADORA
// ===========================================================================
//
// Acá viven tres marcas distintas y no se mezclan nunca:
//
//   CeltaTech      — la empresa. No la ve nadie dentro del producto.
//   Careonys    — el producto. La ve quien trabaja EN la Prestadora
//                 (Admin_prestadora, Coordinador) y sabe qué software usa.
//   Prestadora  — la empresa que presta el cuidado. Es la única marca que
//                 tiene sentido para una Familia o un Asistente.
//
// Una Familia contrató a la Prestadora, no a CeltaTech, y probablemente no sepa
// que Careonys existe. Mostrarle la marca del software donde espera la de su
// Prestadora no es un detalle estético: le dice que su proveedor es otro.
//
// REGLA: en toda pantalla, email o notificación dirigida a una Familia o a un
// Asistente, la marca PRINCIPAL la pone la Prestadora —`prestadoras.nombre_
// fantasia`, leída del tenant de esa sesión— y nunca IDENTIDAD. Este módulo es
// para las superficies del producto: el Panel, y lo que es técnicamente del
// producto y no de ninguna Prestadora en particular.
//
// El modelo es CO-BRANDING (decidido por el Desarrollador el 2026-07-27, no
// marca blanca total): el producto sí aparece ante una Familia, pero solo en
// una línea discreta al pie —"con la tecnología de {{producto}}"— que se apaga
// con el entitlement `aurevia.marca.personalizada`. Ese es el ÚNICO uso
// admitido de IDENTIDAD en una superficie de Familia o de Asistente.
//
// Hoy eso NO se cumple: las dos PWA muestran el nombre del producto como marca
// principal en su encabezado y en las notificaciones push, y el email de
// activación —que se manda solo a Familias y Asistentes— también. Es anterior a
// este archivo y está registrado como pendiente #95 en docs/PENDIENTES.md.
// Mientras siga abierto, no agregar ningún uso nuevo de IDENTIDAD en las PWA
// fuera de esa línea al pie.
//
// Excepción decidida junto con el modelo: el nombre y el ícono de la PWA
// instalada en el teléfono (manifiesto, <title>) SÍ llevan la marca del
// producto. Hay un solo build para todas las Prestadoras y no puede ser de otro
// modo sin un manifiesto dinámico por tenant.
// ---------------------------------------------------------------------------

export const IDENTIDAD = {
  // Clave técnica inmutable. Nunca se renombra ni se traduce (ver cabecera).
  // Sigue diciendo 'aurevia' a propósito, aunque la marca hoy sea Careonys: es
  // justamente lo que este campo promete. Cambiarlo invalidaría todas las claves
  // de entitlements ya guardadas (`aurevia.pacientes.activos_max`).
  codigo: 'aurevia',

  // Nombre comercial completo. Resuelve el marcador {{producto}}.
  nombre: 'Careonys',

  // Nombre corto para espacios reducidos: título de PWA instalada bajo el ícono,
  // encabezado móvil, notificación push. Resuelve {{productoCorto}}.
  // Límite práctico: 12 caracteres — Android trunca el short_name más largo.
  nombreCorto: 'Careonys',

  // Lo que la persona ve en el resumen de su tarjeta. Campo propio, NO derivado
  // del nombre: Stripe lo limita a 22 caracteres y no acepta acentos ni símbolos.
  // Si el nombre comercial no entra o lleva acentos, este campo se escribe aparte.
  descriptorPago: 'CAREONYS',

  // Dominio propio, sin protocolo ni barra final. Resuelve {{dominio}}.
  // Registrado por el Desarrollador el 2026-07-28 y delegado a Cloudflare
  // (`anna`/`otto.ns.cloudflare.com`). Todavía no tiene ningún registro cargado,
  // así que hoy no responde: este campo es para texto visible, no para armar
  // URLs. Las URLs de las apps siguen viniendo de variables de entorno
  // (PWA_ASISTENTES_URL, PWA_FAMILIAS_URL) hasta que se hagan apuntar acá.
  dominio: 'careonys.com',

  // Remitente que se muestra en los emails salientes. Vacío = se usa el que ya
  // trae el transporte SMTP (backend/src/utils/email.js). Es solo el nombre
  // visible del remitente, nunca la casilla ni la credencial — esas siguen en
  // variables de entorno (CLAUDE.md §6).
  remitenteEmail: '',

  // Casilla de contacto de la marca. Hoy la usa el "subject" VAPID de las
  // notificaciones push (backend/src/utils/push.js): la dirección a la que el
  // servicio de push del navegador escribe si hay un problema con los envíos.
  // ATENCIÓN: careonys.com sí está registrado, pero todavía no tiene correo
  // configurado — esta casilla no recibe nada por ahora. Es igual mejor que lo
  // que había antes (soporte@aurevia.app, sobre un dominio que ni siquiera
  // estaba registrado). Queda pendiente darle de alta el correo de verdad.
  emailSoporte: 'soporte@careonys.com',

  // Colores del manifiesto de las PWA y del sistema de diseño.
  colorPrimario: '#1a2744',
  colorFondo: '#ffffff',

  // Rutas públicas de los archivos de marca, servidas desde public/ de cada app.
  // Contrato de qué archivos tienen que existir: docs/MARCA.md.
  // isotipo = la marca sola (el símbolo). logotipo = símbolo + nombre.
  // logotipo en null mientras no exista el archivo: los puntos de consumo tienen
  // que tolerar null y caer al texto, nunca romper por una imagen que falta.
  isotipo: '/favicon.svg',
  logotipo: null,
};

// ---------------------------------------------------------------------------
// Validación de la configuración
//
// Corre al importar el módulo, a propósito: una identidad mal escrita tiene que
// hacer ruido al arrancar el proceso o al compilar el frontend, no seis meses
// después cuando Stripe rechace un descriptor de 30 caracteres en una cobranza
// real. Un error acá siempre es un error de configuración de quien editó el
// archivo, nunca una condición que pueda aparecer en producción con una config
// válida.
// ---------------------------------------------------------------------------

const MAX_DESCRIPTOR_PAGO = 22;

function validarIdentidad(identidad) {
  const problemas = [];

  if (!/^[a-z][a-z0-9_]*$/.test(identidad.codigo)) {
    problemas.push(`codigo "${identidad.codigo}": solo minúsculas, dígitos y guión bajo, empezando por letra — es la clave técnica con la que CeltaTech identifica al producto`);
  }
  if (!identidad.nombre || !identidad.nombre.trim()) {
    problemas.push('nombre: no puede estar vacío, es lo que ve la persona en pantalla');
  }
  if (!identidad.nombreCorto || !identidad.nombreCorto.trim()) {
    problemas.push('nombreCorto: no puede estar vacío, es el título de la PWA instalada');
  }
  if (identidad.descriptorPago.length > MAX_DESCRIPTOR_PAGO) {
    problemas.push(`descriptorPago "${identidad.descriptorPago}": ${identidad.descriptorPago.length} caracteres, el máximo es ${MAX_DESCRIPTOR_PAGO} (límite de Stripe)`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(identidad.descriptorPago)) {
    problemas.push(`descriptorPago "${identidad.descriptorPago}": no puede llevar acentos ni caracteres fuera de ASCII imprimible — las pasarelas los rechazan o los mutilan`);
  }
  if (identidad.dominio && /^https?:\/\/|\/$/.test(identidad.dominio)) {
    problemas.push(`dominio "${identidad.dominio}": sin protocolo y sin barra final (ej. "careonys.com")`);
  }

  if (problemas.length > 0) {
    throw new Error(`identidadProducto.js tiene la configuración mal escrita:\n  - ${problemas.join('\n  - ')}`);
  }
}

validarIdentidad(IDENTIDAD);

// ---------------------------------------------------------------------------
// Sustitución de marcadores
//
// Todo texto visible que nombre al producto escribe {{producto}} en vez del
// nombre. Estas dos funciones lo resuelven: aplicarIdentidad para un texto
// suelto, sustituirIdentidadProfundo para el árbol entero de traducciones.
// ---------------------------------------------------------------------------

const MARCADORES = {
  '{{producto}}': () => IDENTIDAD.nombre,
  '{{productoCorto}}': () => IDENTIDAD.nombreCorto,
  '{{dominio}}': () => IDENTIDAD.dominio,
};

const PATRON_MARCADOR = /\{\{(producto|productoCorto|dominio)\}\}/g;

// Reemplaza los marcadores de un texto suelto. Si no hay marcadores devuelve la
// misma referencia, sin crear un string nuevo.
export function aplicarIdentidad(texto) {
  if (typeof texto !== 'string' || !texto.includes('{{')) return texto;
  return texto.replace(PATRON_MARCADOR, (marcador) => MARCADORES[marcador]());
}

// Recorre un objeto/array anidado y devuelve una copia con los marcadores ya
// resueltos en todos sus strings. Pensado para el árbol de i18n completo, que se
// consume como objeto plano (t.auth.titulo), no como función t('auth.titulo') —
// por eso la sustitución pasa acá una sola vez y ningún punto de consumo cambia.
//
// El resultado se cachea por identidad de objeto: el árbol de un idioma se
// recorre una vez por sesión aunque se cambie de idioma y se vuelva.
const cacheProfundo = new WeakMap();

export function sustituirIdentidadProfundo(valor) {
  if (typeof valor === 'string') return aplicarIdentidad(valor);
  if (valor === null || typeof valor !== 'object') return valor;

  const cacheado = cacheProfundo.get(valor);
  if (cacheado !== undefined) return cacheado;

  const copia = Array.isArray(valor)
    ? valor.map(sustituirIdentidadProfundo)
    : Object.fromEntries(Object.entries(valor).map(([clave, v]) => [clave, sustituirIdentidadProfundo(v)]));

  cacheProfundo.set(valor, copia);
  return copia;
}

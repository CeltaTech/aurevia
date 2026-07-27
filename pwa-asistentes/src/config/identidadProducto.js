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
// que Xeitra identifica al producto y con la que se arman las claves de
// entitlements (`aurevia.pacientes.activos_max`). Renombrar la marca no toca un
// solo dato guardado. Ver PLAN_SEPARACION_XEITRA.md, Etapa 0.5.
//
// A partir de la Etapa 3 la fuente de verdad de estos valores pasa a ser Xeitra y
// se replican por el mismo canal que los entitlements. Hasta entonces esta config
// ES la fuente de verdad. Los puntos de consumo no cambian cuando eso pase.
// ---------------------------------------------------------------------------

export const IDENTIDAD = {
  // Clave técnica inmutable. Nunca se renombra ni se traduce (ver cabecera).
  codigo: 'aurevia',

  // Nombre comercial completo. Resuelve el marcador {{producto}}.
  nombre: 'Aurevia',

  // Nombre corto para espacios reducidos: título de PWA instalada bajo el ícono,
  // encabezado móvil, notificación push. Resuelve {{productoCorto}}.
  // Límite práctico: 12 caracteres — Android trunca el short_name más largo.
  nombreCorto: 'Aurevia',

  // Lo que la persona ve en el resumen de su tarjeta. Campo propio, NO derivado
  // del nombre: Stripe lo limita a 22 caracteres y no acepta acentos ni símbolos.
  // Si el nombre comercial no entra o lleva acentos, este campo se escribe aparte.
  descriptorPago: 'AUREVIA',

  // Dominio propio, sin protocolo ni barra final. Resuelve {{dominio}}.
  // Vacío hoy: no hay dominio registrado (confirmado por el Desarrollador el
  // 2026-07-27). Las URLs de las apps siguen viniendo de variables de entorno
  // (PWA_ASISTENTES_URL, PWA_FAMILIAS_URL) — este campo es para texto visible.
  dominio: '',

  // Remitente que se muestra en los emails salientes. Vacío = se usa el que ya
  // trae el transporte SMTP (backend/src/utils/email.js). Es solo el nombre
  // visible del remitente, nunca la casilla ni la credencial — esas siguen en
  // variables de entorno (CLAUDE.md §6).
  remitenteEmail: '',

  // Casilla de contacto de la marca. Hoy la usa el "subject" VAPID de las
  // notificaciones push (backend/src/utils/push.js): la dirección a la que el
  // servicio de push del navegador escribe si hay un problema con los envíos.
  // ATENCIÓN: el dominio aurevia.app NO está registrado — esta casilla no
  // existe todavía y no recibe nada. Queda acá, tal como estaba, para no
  // cambiar el comportamiento actual; se corrige cuando haya dominio.
  emailSoporte: 'soporte@aurevia.app',

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
    problemas.push(`codigo "${identidad.codigo}": solo minúsculas, dígitos y guión bajo, empezando por letra — es la clave técnica con la que Xeitra identifica al producto`);
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
    problemas.push(`dominio "${identidad.dominio}": sin protocolo y sin barra final (ej. "aurevia.com")`);
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

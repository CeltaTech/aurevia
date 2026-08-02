// Punto único de verdad del COLOR DE SEÑAL en el Panel (regla 12 de CLAUDE.md §7).
// ============================================================================
//
// El problema que resuelve. Hasta acá, cada pantalla escribía su propia clase de color:
// `badge-aprobado` en una, `badge-vigente` en otra, `badge-certificada` en otra — todas del
// mismo verde, todas definidas por separado en `index.css`. Eran veinte reglas de CSS que
// decían lo mismo. Y no era gratis: la pantalla de Matrículas pedía una clase
// `badge-verde` que directamente no existía en el CSS, así que ese cartel se veía gris.
// Nadie lo notó porque no rompe nada: simplemente se ve mal.
//
// La idea. Hay solo CINCO significados posibles para un cartel de estado, y no más:
//
//   exito    → esto está bien, no hay nada que hacer          (verde)
//   atencion → esto todavía no está cerrado, mirálo           (naranja)
//   critico  → esto está mal y alguien tiene que actuar       (rojo)
//   info     → esto es un dato, no es bueno ni malo           (azul)
//   neutro   → no hay información, o no aplica                (gris)
//
// Los estados del negocio son muchos ("aprobado", "vencida", "en_gestion", "fuera_de_rango")
// pero todos caen en uno de esos cinco. Este archivo es el único lugar donde está escrito
// cuál cae en cuál. `variables.css` dice de qué color se pinta cada tono; acá se dice qué
// estado le toca a cada tono. Ninguna pantalla decide un color.
//
// Cómo se usa:
//   import { claseBadge } from '../lib/tonos';
//   <span className={claseBadge(f.estado)}>{t.facturacion[`estado_${f.estado}`]}</span>
//
// Cómo se agrega un estado nuevo: se agrega UNA línea en la tabla de abajo. No se toca el
// CSS, no se toca ninguna pantalla. Si alguien se olvida, el estado nuevo sale gris
// (neutro), que es feo pero no está mal — nunca sale de un color que mienta.

/** Los cinco tonos. No hay un sexto. */
export const TONO = {
  EXITO: 'exito',
  ATENCION: 'atencion',
  CRITICO: 'critico',
  INFO: 'info',
  NEUTRO: 'neutro',
};

// Qué estado del negocio corresponde a qué tono.
// Los nombres son los que realmente usa la base de datos (comprobados el 2026-07-31 contra
// las restricciones CHECK de la base viva), más los pocos que solo existen en pantalla.
const TONO_POR_ESTADO = {
  // --- Está bien ---
  activo: TONO.EXITO,
  activa: TONO.EXITO,
  aprobado: TONO.EXITO,
  aprobada: TONO.EXITO,
  aceptada: TONO.EXITO,
  al_dia: TONO.EXITO,
  asignada: TONO.EXITO,
  certificada: TONO.EXITO,
  completada: TONO.EXITO,
  conectada: TONO.EXITO,
  confirmada: TONO.EXITO,
  confirmado: TONO.EXITO,
  cubierta: TONO.EXITO,
  exitoso: TONO.EXITO,
  finalizada: TONO.EXITO,
  otorgado: TONO.EXITO,
  pagada: TONO.EXITO,
  validado: TONO.EXITO,
  verde: TONO.EXITO,
  verificado: TONO.EXITO,
  vigente: TONO.EXITO,

  // --- Falta algo, mirálo ---
  amarilla: TONO.ATENCION,
  ausente: TONO.ATENCION,
  borrador: TONO.ATENCION,
  en_certificacion: TONO.ATENCION,
  en_gestion: TONO.ATENCION,
  en_revision: TONO.ATENCION,
  enviada_meta: TONO.ATENCION,
  nueva: TONO.ATENCION,
  ofrecida: TONO.ATENCION,
  parcial: TONO.ATENCION,
  pausada: TONO.ATENCION,
  pendiente: TONO.ATENCION,
  por_vencer: TONO.ATENCION,
  prospecto: TONO.ATENCION,
  sin_cubrir: TONO.ATENCION,
  trial: TONO.ATENCION,

  // --- Está mal, alguien tiene que actuar ---
  anulado: TONO.CRITICO,
  cancelada: TONO.CRITICO,
  cesado: TONO.CRITICO,
  dada_de_baja: TONO.CRITICO,
  de_baja: TONO.CRITICO,
  descartado: TONO.CRITICO,
  error: TONO.CRITICO,
  fallido: TONO.CRITICO,
  fuera_de_rango: TONO.CRITICO,
  incidente: TONO.CRITICO,
  rechazada: TONO.CRITICO,
  rechazado: TONO.CRITICO,
  roja: TONO.CRITICO,
  suspendida: TONO.CRITICO,
  vencida: TONO.CRITICO,
  vencido: TONO.CRITICO,

  // --- Es un dato, ni bueno ni malo ---
  programada: TONO.INFO,

  // --- No hay información, o no aplica ---
  inactivo: TONO.NEUTRO,
  omitir: TONO.NEUTRO,
  otro: TONO.NEUTRO,
  sin_datos: TONO.NEUTRO,
  sin_domicilio: TONO.NEUTRO,
};

/**
 * Qué tono le toca a un estado. Un estado que no esté en la tabla sale neutro: gris, sin
 * decir nada, que es preferible a inventarle un significado.
 */
export function tonoDeEstado(estado) {
  return TONO_POR_ESTADO[estado] ?? TONO.NEUTRO;
}

/**
 * La clase CSS completa del cartel de estado. Se pone tal cual en `className`.
 * Ejemplo: claseBadge('vencida') → 'badge badge-critico'
 */
export function claseBadge(estado) {
  return `badge badge-${tonoDeEstado(estado)}`;
}

/**
 * La clase de un cartel cuando el tono se sabe de antemano y no viene de un estado de la
 * base. Ejemplo: un aviso de "hay un incidente" que no es una columna, es una condición.
 */
export function claseBadgeTono(tono) {
  return `badge badge-${Object.values(TONO).includes(tono) ? tono : TONO.NEUTRO}`;
}

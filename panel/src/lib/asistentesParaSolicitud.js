// ---------------------------------------------------------------------------
// asistentesParaSolicitud.js — a quién proponerle una Solicitud de Servicio que recién llegó
//
// QUÉ CONTESTA Y QUÉ NO
// La Solicitud es lo primero que se sabe de una Familia: un teléfono, una localidad, qué tipo de
// servicio necesita y en qué días y horarios, escrito por quien llamó. Todavía no hay Paciente,
// no hay domicilio con altura y no hay ninguna guardia. Así que acá no se puede preguntar nada de
// lo que decide `candidatos.js` —si ese día ya tiene otro turno, si le queda descanso, cuántos
// kilómetros hay hasta la casa—: no hay día, no hay casa y no hay turno.
//
// Lo que sí se puede cruzar es lo que las dos partes ya declararon: la zona donde trabaja cada
// Asistente contra la localidad pedida, sus especialidades contra el servicio pedido, y si esa
// persona se puso disponible para que le ofrezcan trabajo. Es exactamente lo que pide el flujo de
// asignación del Panel (`docs/PRD_02_Panel_Admin.md:125`): *"Sistema sugiere Asistentes por zona
// + especialidad + disponibilidad"*.
//
// **Nadie del plantel queda afuera de la lista.** Igual que en `candidatos.js`: quien no encaja
// aparece al fondo con el motivo a la vista, porque una lista que esconde gente deja a quien mira
// preguntándose por qué no está fulana, sin ninguna respuesta en ninguna pantalla. El único que
// no aparece es quien ya no trabaja en la Prestadora, que no es un candidato descartado: no es un
// candidato.
//
// **Es una sugerencia y nada más.** Quien elige es la persona que atiende la Solicitud, que sabe
// cosas que no están en ninguna columna. Por eso todo lo de acá suma o resta puntos y nada
// bloquea.
//
// LOS TEXTOS SE COMPARAN, NO SE RESUELVEN
// La localidad la escribió quien llenó el formulario y las zonas las escribió quien cargó la
// ficha, sin ninguna lista en común. `nombranLoMismo` acerca las dos puntas lo que se puede
// (`textoComparable.js`); lo que no coincida por escribirse distinto va a quedar al fondo, y por
// eso queda al fondo y no afuera.
// ---------------------------------------------------------------------------

import { estaDisponibleParaOfertas, estaEnElPlantel } from './candidatos';
import { nombranLoMismo } from './textoComparable';

/** Las claves de motivo que la pantalla traduce. Nunca texto visible acá adentro. */
export const MOTIVO_SOLICITUD = {
  CUBRE_LA_ZONA: 'cubre_la_zona',
  OTRA_ZONA: 'otra_zona',
  SIN_ZONAS_CARGADAS: 'sin_zonas_cargadas',
  TIENE_LA_ESPECIALIDAD: 'tiene_la_especialidad',
  OTRA_ESPECIALIDAD: 'otra_especialidad',
  SIN_ESPECIALIDADES_CARGADAS: 'sin_especialidades_cargadas',
  SE_OFRECE: 'se_ofrece',
  NO_SE_OFRECE: 'no_se_ofrece',
};

/**
 * Cuánto pesa cada cosa. La zona pesa más que la especialidad porque es la que no se arregla
 * hablando: a alguien que trabaja en otra punta de la provincia no se lo convence de tomar el
 * caso, y a alguien que hace otra especialidad a veces sí. Y estar disponible pesa menos que las
 * dos, porque es lo más fácil de que cambie: es una tecla en la aplicación del Asistente.
 */
export const PESOS_SOLICITUD = {
  zona: 3,
  especialidad: 2,
  disponible: 1,
};

const lista = (x) => (Array.isArray(x) ? x : []);

/**
 * El plantel ordenado de mejor a peor para una Solicitud.
 *
 * @param solicitud   la fila de `solicitudes`. Se le miran `localidad` y `tipo_servicio`; un
 *                    campo vacío no se cruza con nada y no suma ni resta.
 * @param asistentes  el plantel de la Prestadora, entero. Quién sigue estando se decide acá
 *                    adentro, no en la consulta de la pantalla.
 * @param opciones    `{ pesos }`, para pisar los de arriba sin tocar este archivo.
 *
 * @returns array ordenado. Cada elemento: `{ asistente, puntaje, aFavor: [], enContra: [] }`,
 *          donde los dos últimos son claves de `MOTIVO_SOLICITUD`.
 */
export function asistentesParaSolicitud(solicitud, asistentes, opciones = {}) {
  if (!solicitud) return [];
  const pesos = { ...PESOS_SOLICITUD, ...(opciones.pesos ?? {}) };

  const evaluados = lista(asistentes)
    .filter(estaEnElPlantel)
    .map((asistente) => evaluar(asistente, solicitud, pesos));

  // El desempate por nombre es para que la lista no baile entre dos recargas cuando dos
  // Asistentes empatan: una lista que se reordena sola es una lista en la que no se confía.
  return evaluados.sort((a, b) => {
    if (b.puntaje !== a.puntaje) return b.puntaje - a.puntaje;
    return String(a.asistente?.nombre ?? '').localeCompare(String(b.asistente?.nombre ?? ''));
  });
}

function evaluar(asistente, solicitud, pesos) {
  const aFavor = [];
  const enContra = [];
  let puntaje = 0;

  // La zona. Una ficha sin zonas cargadas no es una ficha que trabaje en cualquier lado: es una
  // ficha a la que le falta el dato, y eso se dice con esas palabras en vez de contarlo como que
  // no cubre la zona, que sería afirmar algo que nadie cargó.
  const zonas = lista(asistente?.zonas);
  if (solicitud.localidad) {
    if (!zonas.length) {
      enContra.push(MOTIVO_SOLICITUD.SIN_ZONAS_CARGADAS);
    } else if (zonas.some((zona) => nombranLoMismo(zona, solicitud.localidad))) {
      aFavor.push(MOTIVO_SOLICITUD.CUBRE_LA_ZONA);
      puntaje += pesos.zona;
    } else {
      enContra.push(MOTIVO_SOLICITUD.OTRA_ZONA);
    }
  }

  const especialidades = lista(asistente?.especialidades);
  if (solicitud.tipo_servicio) {
    if (!especialidades.length) {
      enContra.push(MOTIVO_SOLICITUD.SIN_ESPECIALIDADES_CARGADAS);
    } else if (especialidades.some((e) => nombranLoMismo(e, solicitud.tipo_servicio))) {
      aFavor.push(MOTIVO_SOLICITUD.TIENE_LA_ESPECIALIDAD);
      puntaje += pesos.especialidad;
    } else {
      enContra.push(MOTIVO_SOLICITUD.OTRA_ESPECIALIDAD);
    }
  }

  // Lo decide el Asistente desde su aplicación, no la Prestadora: por eso se dice y no se
  // esconde a nadie. Quien atiende la Solicitud puede llamarlo igual.
  if (estaDisponibleParaOfertas(asistente)) {
    aFavor.push(MOTIVO_SOLICITUD.SE_OFRECE);
    puntaje += pesos.disponible;
  } else {
    enContra.push(MOTIVO_SOLICITUD.NO_SE_OFRECE);
  }

  return { asistente, puntaje, aFavor, enContra };
}

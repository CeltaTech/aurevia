// Punto único de verdad de QUIÉN PUEDE CUBRIR UN HUECO (regla 12 de CLAUDE.md §7).
// ============================================================================
//
// La pregunta que contesta. Hay una Guardia sin Asistente y alguien de la Prestadora tiene que
// elegir a quién llamar. Este archivo ordena a los Asistentes de la Prestadora de mejor a peor
// para ese hueco puntual, y —esto es lo importante— **dice por qué** cada uno quedó donde
// quedó, motivo por motivo.
//
// Por qué el "por qué" no es un adorno. Un puntaje solo es una caja negra: quien mira la
// pantalla ve "Ana 82, Luis 74" y no tiene forma de saber si eso tiene sentido. Y muchas veces
// no lo tiene, porque hay cosas que el sistema no sabe (que Luis pidió no volver a esa casa,
// que la Familia se lleva mejor con Ana). Por eso la lista se entrega con los motivos a la
// vista: el puntaje ordena, la persona decide.
//
// Qué NO hace este archivo: no toca la base, no arma texto y no sabe en qué idioma está el
// Panel. Devuelve **claves de traducción más los valores a reemplazar** —
// `{ clave: 'motivo_ocupado', valores: { desde: '08:00', hasta: '16:00' } }`— y la pantalla
// arma la frase con `t.guardias.cobertura_panel[clave]`. Es la única forma de que el mismo
// cálculo sirva en los tres idiomas (regla 2 de CLAUDE.md §7).
//
// Todas las cuentas de reloj salen de `lib/horarios.js`, nunca de comparar textos de hora a
// mano: la guardia de noche empieza a las 22:00 y termina a las 06:00 del día siguiente, y
// cualquier cuenta que lea esas dos horas literalmente da mal justo en el caso más común.
//
// ----------------------------------------------------------------------------
// La cercanía: cuándo se dice y cuándo se calla
// ----------------------------------------------------------------------------
//
// Desde que el legajo del Asistente guarda su domicilio (`asistentes.domicilio`, `lat`, `lng`),
// la distancia hasta la casa del Paciente entra como un criterio más. Pero **solo cuando los
// dos puntos existen de verdad**: si a cualquiera de los dos le falta la ubicación, este
// archivo no dice nada sobre cercanía, ni a favor ni en contra. Un candidato ordenado por una
// distancia inventada es peor que un candidato sin ese criterio, porque parece confiable.
//
// Y es distancia en línea recta, no tiempo de viaje. Cinco kilómetros del otro lado de un río
// pueden ser una hora de colectivo. Por eso la cercanía suma bastante menos que la continuidad
// y el motivo que se muestra dice los kilómetros, para que quien lee la lista pueda corregir
// con lo que sabe del barrio.
//
// ----------------------------------------------------------------------------
// Un criterio que la gente espera ver y que HOY NO SE PUEDE CALCULAR
// ----------------------------------------------------------------------------
//
// "La autorización de la Obra Social está agotada."
// Ese dato no existe todavía en ningún lado. `pacientes.obra_social` es el nombre de la obra
// social, no un cupo de horas autorizadas ni un saldo. Haría falta guardar la autorización
// (período, horas o guardias autorizadas, consumidas) para poder avisarlo.
//
// Mientras eso no exista, este archivo no lo nombra. Cuando exista, es un peso más en `PESOS`
// y una comprobación más abajo — nada del resto cambia.

import { distanciaKm } from './distancia';
import {
  inicioDeGuardia,
  finDeGuardia,
  horasDeGuardia,
  seSuperponen,
  horasDeDescansoEntre,
} from './horarios';
import {
  BLOQUEO,
  estadoDe,
  matriculaQueMandaAl,
  motivoDeBloqueo,
} from './matricula';
import { trabajaEnModalidad } from './modalidades';
import { DIAS_AVISO_POR_DEFECTO } from './reglaVencimientos';
import { idsDePacientes } from './pacientesDeGuardia';

/**
 * Cuánto suma o resta cada criterio.
 *
 * Son reglas operativas y, como los umbrales de `semaforoGuardia.js`, **no deberían estar
 * escritas en el código**: la regla 1 de CLAUDE.md §7 dice que una regla operativa sale de
 * configuración. El día que la Prestadora pueda decir "a mí la continuidad me importa el doble
 * y las horas extra no me importan", estos números salen de su configuración. Para que ese
 * cambio sea de una línea y no una cacería por todo el proyecto, están todos juntos acá y
 * **todas** las funciones los reciben por parámetro: se pasa el objeto de la Prestadora en
 * lugar de este, y nada más cambia.
 *
 * La escala está pensada para que **la continuidad gane**. Para el Paciente y su Familia, que
 * venga alguien que ya conocen vale más que cualquier otra comodidad de la agenda: tres
 * guardias previas con ese Paciente pesan más que todo lo demás a favor sumado.
 */
export const PESOS = {
  /** Por cada vez que ya atendió a este Paciente. */
  continuidad_por_vez: 12,
  /** Tope de la continuidad: a partir de acá, más veces ya no mueven la aguja. */
  continuidad_maxima: 60,
  /** Nunca lo atendió. Resta poco: no es un problema, es solo que no hay nada a favor. */
  sin_continuidad: -5,

  /** No tiene ninguna guardia que se pise con esta. */
  libre: 10,
  /** Ya tiene una guardia encima. Bloquea igual; el número es para que quede al fondo. */
  ocupado: -1000,

  /**
   * Tiene una ausencia registrada que cubre la fecha de la guardia. Bloquea igual que estar
   * ocupado y resta lo mismo por el mismo motivo: el número no decide nada —el bloqueo ya está
   * decidido—, solo la manda al fondo para que no se mezcle con quienes sí pueden tomarla.
   */
  ausencia: -1000,

  /** Tiene la Matrícula que su tipo le exige, vigente y comprobada. */
  matricula_ok: 8,
  /** La tiene bien, pero está por vencerse. Resta y se avisa; no bloquea. */
  matricula_vence: -10,
  /**
   * Los tres motivos que sí bloquean. Restan lo mismo que estar ocupado y por el mismo motivo:
   * el número no decide nada —el bloqueo ya lo decidió la base—, solo los manda al fondo de la
   * lista para que no se mezclen con los que sí pueden tomar la guardia.
   */
  matricula_falta: -1000,
  matricula_vencida: -1000,
  matricula_sin_verificar: -1000,

  /**
   * El Asistente no trabaja en la modalidad de esta guardia. Bloquea, y resta lo mismo que los
   * demás bloqueos por el mismo motivo: el número no decide nada, solo lo manda al fondo.
   */
  modalidad_distinta: -1000,

  papeles_ok: 5,
  papeles_vencen: -10,

  /**
   * Vive cerca de la casa del Paciente. Suma parecido a estar libre y bastante menos que la
   * continuidad, a propósito: la cuenta es en línea recta y no sabe nada del tránsito, del
   * colectivo ni del río que puede haber en el medio. Es una ayuda para ordenar la lista, no
   * un veredicto.
   */
  cerca: 10,
  /** Vive lejos. Resta, no bloquea: hay gente que viaja una hora todos los días y está bien. */
  lejos: -12,

  /** Lo máximo que resta acercarse al tope de horas. Se aplica proporcional, no de golpe. */
  horas_cerca_del_tope: -15,
  /** Con esta guardia se pasa del tope semanal. Resta mucho, pero no bloquea. */
  horas_pasa_el_tope: -30,

  descanso_ok: 6,
  descanso_corto: -25,
};

/**
 * Los topes y umbrales. Mismo criterio que `PESOS` y que el `UMBRALES` de
 * `semaforoGuardia.js`: hoy son estos números y son iguales para toda Prestadora, **y no
 * deberían serlo**. Están todos juntos acá y se reciben por parámetro para que el día que
 * salgan de la configuración de la Prestadora el cambio sea de una línea.
 */
export const TOPES = {
  /**
   * Horas semanales máximas. Es el valor de respaldo: si el Asistente tiene cargado su propio
   * `asistentes.horas_semanales`, manda el suyo (ver `topeSemanalDe`). Un tope por persona es
   * más justo que uno igual para todos, y esa columna ya existe.
   */
  horas_semanales: 48,

  /** Horas mínimas de descanso entre el fin de una guardia y el inicio de la siguiente. */
  horas_descanso_minimo: 12,

  /**
   * Descansos más largos que esto no se comentan. Decir "descansa 300 h desde su guardia
   * anterior" es ruido: si hace tres días que no trabaja, el dato no aporta nada.
   */
  horas_descanso_a_mencionar: 24,

  /** Desde qué proporción del tope semanal ya conviene avisar que se está acercando. */
  proporcion_horas_para_avisar: 0.75,

  /**
   * Con cuántos días de anticipación se avisa que un papel o una Matrícula vence.
   *
   * Arranca en el mismo número que el resto del producto: si mañana se cambia el valor de
   * arranque, no puede quedar un rincón avisando con otro plazo.
   */
  dias_aviso_vencimiento: DIAS_AVISO_POR_DEFECTO,

  /** Qué día arranca la semana para contar horas. 1 = lunes (0 sería domingo). */
  dia_inicio_semana: 1,

  /**
   * Los dos bordes de la cercanía, en kilómetros en línea recta entre el domicilio del Asistente
   * y el del Paciente.
   *
   * Hasta `km_cerca` cuenta a favor; desde `km_lejos` cuenta en contra; **en el medio no se dice
   * nada**. Ese silencio es deliberado: a doce kilómetros no hay nada que opinar, y forzar un
   * veredicto para cada candidato llenaría la lista de renglones que no ayudan a decidir.
   */
  km_cerca: 8,
  km_lejos: 25,
};

/** Las claves de traducción que devuelve este archivo. Viven en `t.guardias.cobertura_panel`. */
export const MOTIVO = {
  CONTINUIDAD: 'motivo_continuidad',
  SIN_CONTINUIDAD: 'motivo_sin_continuidad',
  LIBRE: 'motivo_libre',
  OCUPADO: 'motivo_ocupado',
  /**
   * Uno solo para las cuatro clases de ausencia que admite la tabla, y el texto que se muestra
   * no nombra ninguna: dice que esa persona no está disponible ese día y nada más. Una licencia
   * por enfermedad es información de salud (CLAUDE.md §6) y no tiene por qué leerse desde una
   * lista de candidatos; el tipo ni siquiera llega hasta este archivo (ver `ausenciaQueTapa`).
   */
  AUSENCIA: 'motivo_ausencia',
  MATRICULA_OK: 'motivo_matricula_ok',
  MATRICULA_VENCE: 'motivo_matricula_vence',
  MATRICULA_FALTA: 'motivo_matricula_falta',
  MATRICULA_VENCIDA: 'motivo_matricula_vencida',
  MATRICULA_SIN_VERIFICAR: 'motivo_matricula_sin_verificar',
  /**
   * Uno por modalidad, en vez de uno solo con la modalidad adentro. La frase la arma la
   * pantalla reemplazando valores a secas, así que un `{modalidad}` le llegaría en crudo
   * —"marketplace", en minúscula y sin traducir— justo en el motivo que explica por qué
   * alguien no puede tomar la guardia.
   */
  MODALIDAD_DIRECTA: 'motivo_modalidad_directa',
  MODALIDAD_MARKETPLACE: 'motivo_modalidad_marketplace',
  MODALIDAD_SUBCONTRATACION: 'motivo_modalidad_subcontratacion',
  PAPELES_OK: 'motivo_papeles_ok',
  PAPELES_VENCEN: 'motivo_papeles_vencen',
  CERCA: 'motivo_cerca',
  LEJOS: 'motivo_lejos',
  HORAS: 'motivo_horas',
  HORAS_PASA: 'motivo_horas_pasa',
  DESCANSO: 'motivo_descanso',
  DESCANSO_CORTO: 'motivo_descanso_corto',
};

/**
 * Qué motivo le corresponde a cada modalidad de guardia.
 *
 * La subcontratación tiene el suyo porque ninguna persona nuestra puede estar en esa modalidad
 * —la regla de la columna solo admite las otras dos—, así que una guardia subcontratada bloquea a
 * todo el plantel. Decirlo con las palabras del caso evita que quien mira crea que se trata de
 * un error de carga: esa guardia la cubre la otra empresa, y su gente no está en esta base
 * (decisión del Desarrollador, 2026-08-19).
 */
const MOTIVO_POR_MODALIDAD = {
  directa: MOTIVO.MODALIDAD_DIRECTA,
  marketplace: MOTIVO.MODALIDAD_MARKETPLACE,
  subcontratacion: MOTIVO.MODALIDAD_SUBCONTRATACION,
};

// ============================================================================
// Ayudas chicas
// ============================================================================

/** Las horas se muestran con un decimal como mucho: "7.5 h" sí, "7.4999999 h" no. */
const redondear = (n) => Math.round(n * 10) / 10;

/** `hora_inicio` puede venir como '08:00:00'. En pantalla se muestra 'HH:MM'. */
const hhmm = (h) => (typeof h === 'string' ? h.slice(0, 5) : h);

/**
 * El día de un `Date` en el formato en que lo guarda la base: '2026-08-01'.
 * Se corre por la zona horaria antes de recortar, porque `toISOString` a secas pasa a UTC y en
 * Argentina eso cambia el día para todo lo que pase antes de las 21:00.
 */
const diaDe = (fecha) => {
  const corrida = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
};

/** Suma días a una fecha '2026-08-01' y devuelve otra igual. */
const sumarDiasISO = (fechaISO, dias) => {
  const f = new Date(`${fechaISO}T00:00:00`);
  f.setDate(f.getDate() + dias);
  return diaDe(f);
};

const lista = (x) => (Array.isArray(x) ? x : []);

// ============================================================================
// LAS COMPROBACIONES COMPARTIDAS
//
// Todo lo que sigue está exportado a propósito. `avisosAsignacion.js` contesta una pregunta
// distinta —"¿qué puede salir mal si le doy esta guardia a este Asistente?"— pero se apoya en
// exactamente las mismas cuentas: si se pisa con otra guardia, cuánto descansa, cuántas horas
// lleva en la semana, qué papeles vencen. Escribirlas dos veces sería garantizar que algún día
// la lista de candidatos diga una cosa y el aviso de confirmación diga otra sobre la misma
// persona y la misma guardia — el error más difícil de encontrar, porque no rompe nada: solo
// hace que nadie vuelva a confiar en la pantalla. Están escritas una sola vez, acá
// (regla 12 de CLAUDE.md §7).
// ============================================================================

/**
 * El único valor de `asistentes.estado` que significa que esa persona sigue trabajando en la
 * Prestadora. La columna admite tres —`activo`, `inactivo` y `cesado`, por la regla
 * `asistentes_estado_check` de la base— y los otros dos son formas de haberse ido: uno con
 * vuelta y el otro sin ella.
 */
export const ESTADO_ACTIVO = 'activo';

/**
 * ¿Sigue en el plantel? Es lo único que este archivo le pregunta al estado del Asistente, y
 * está escrito una sola vez para que la respuesta no se bifurque (regla 12 de CLAUDE.md §7).
 */
export function estaEnElPlantel(asistente) {
  return asistente?.estado === ESTADO_ACTIVO;
}

/**
 * Las guardias que ocupan realmente a un Asistente.
 *
 * Se sacan las canceladas —una guardia cancelada no ocupa a nadie— y la guardia que se está
 * evaluando, para el caso de una reasignación: una guardia nunca se pisa consigo misma.
 */
export function guardiasDeAsistente(asistenteId, guardias, excluirGuardiaId = null) {
  return lista(guardias).filter(
    (g) =>
      g.asistente_id === asistenteId &&
      g.estado !== 'cancelada' &&
      (!excluirGuardiaId || g.id !== excluirGuardiaId)
  );
}

/**
 * La guardia del Asistente que se pisa con esta, o `null` si no hay ninguna.
 * Nadie puede estar en dos casas a la vez: esto es lo único que bloquea sin discusión.
 */
export function guardiaQueSePisa(guardia, guardiasDelAsistente) {
  return lista(guardiasDelAsistente).find((g) => seSuperponen(g, guardia)) ?? null;
}

/**
 * La ausencia registrada del Asistente que tapa esta guardia, o `null` si no hay ninguna.
 *
 * Estar de licencia pesa exactamente lo mismo que tener otra guardia encima: los dos casos
 * contestan que esa persona no está ese día. Por eso bloquea y no descuenta puntos.
 *
 * Se compara contra los **dos** días que puede ocupar la guardia, el primero y el último: la de
 * noche arranca a las 22:00 y termina a las 06:00 del día siguiente, y una licencia que empieza
 * ese día siguiente igual la parte al medio.
 *
 * Una ausencia sin `fecha_fin` es una que sigue abierta, no una que terminó: cuenta desde su
 * inicio y hacia adelante sin límite. Tratarla como cerrada sería dar por trabajando a quien
 * está de licencia y todavía no tiene fecha de vuelta, que es el caso más común de todos.
 *
 * **El tipo de ausencia no entra acá, a propósito.** Una licencia por enfermedad o por accidente
 * es información de salud (CLAUDE.md §6) y no tiene por qué salir del legajo, ni viajar hasta
 * una lista de candidatos, ni terminar en un renglón de pantalla. Y no hace ninguna falta: las
 * cuatro clases que admite la tabla contestan lo mismo a la única pregunta de acá —ese día esa
 * persona no está—, así que distinguirlas agregaría un dato sensible sin cambiar ninguna
 * decisión. Quien llama tampoco lo trae en su consulta.
 */
export function ausenciaQueTapa(asistenteId, ausencias, primerDia, ultimoDia) {
  return (
    lista(ausencias).find(
      (a) =>
        a.asistente_id === asistenteId &&
        a.fecha_inicio &&
        a.fecha_inicio <= ultimoDia &&
        (!a.fecha_fin || a.fecha_fin >= primerDia)
    ) ?? null
  );
}

/**
 * Cuántas horas de descanso le quedan al Asistente alrededor de esta guardia, mirando tanto la
 * guardia anterior como la siguiente. Devuelve `null` si no tiene ninguna guardia cerca.
 *
 * Se mira para los dos lados porque el descanso corto se puede producir de las dos maneras:
 * porque salió hace poco, o porque entra enseguida después.
 */
export function descansoMasCorto(guardia, guardiasDelAsistente) {
  let menor = null;
  for (const otra of lista(guardiasDelAsistente)) {
    if (seSuperponen(otra, guardia)) continue; // eso ya es superposición, no descanso corto
    const horas =
      finDeGuardia(otra) <= inicioDeGuardia(guardia)
        ? horasDeDescansoEntre(otra, guardia)
        : horasDeDescansoEntre(guardia, otra);
    if (horas < 0) continue;
    if (menor === null || horas < menor) menor = horas;
  }
  return menor;
}

/**
 * Los dos bordes de la semana a la que pertenece una fecha '2026-08-01'.
 * `desde` incluido, `hasta` excluido.
 */
export function limitesDeSemana(fechaISO, diaInicio = TOPES.dia_inicio_semana) {
  const desde = new Date(`${fechaISO}T00:00:00`);
  const corrimiento = (desde.getDay() - diaInicio + 7) % 7;
  desde.setDate(desde.getDate() - corrimiento);
  const hasta = new Date(desde);
  hasta.setDate(hasta.getDate() + 7);
  return { desde, hasta };
}

/**
 * El tope semanal que le corresponde a este Asistente: el suyo si lo tiene cargado, y si no el
 * general. Un tope por persona es más justo que uno igual para todos, y la columna ya existe.
 */
export function topeSemanalDe(asistente, topes = TOPES) {
  const propio = Number(asistente?.horas_semanales);
  return Number.isFinite(propio) && propio > 0 ? propio : topes.horas_semanales;
}

/**
 * Cuántas horas lleva el Asistente en la semana de esta guardia, sin contarla y contándola.
 *
 * Una guardia cuenta en la semana en la que **empieza**. La de las 22:00 del domingo que
 * termina el lunes a las 06:00 cuenta entera en la semana del domingo: partirla al medio sería
 * más exacto en el papel y mucho más difícil de entender para quien lee el número.
 */
export function cargaSemanal(guardia, guardiasDelAsistente, topes = TOPES) {
  const { desde, hasta } = limitesDeSemana(guardia.fecha, topes.dia_inicio_semana);
  let horas = 0;
  for (const g of lista(guardiasDelAsistente)) {
    const inicio = inicioDeGuardia(g);
    if (inicio >= desde && inicio < hasta) horas += horasDeGuardia(g);
  }
  return { sinEsta: horas, conEsta: horas + horasDeGuardia(guardia) };
}

/**
 * La Matrícula del Asistente que está vigente en un momento dado, o `null` si no tiene ninguna.
 *
 * La cuenta no está acá: vive en `lib/matricula.js`, junto con el resto de la regla de
 * Matrícula, porque la usan también las pantallas que no arman listas de candidatos. Esto es
 * solo el nombre con el que este archivo y `avisosAsignacion.js` la venían llamando.
 */
export function matriculaVigenteAl(asistenteId, matriculas, momento, tipo = null) {
  return matriculaQueMandaAl(asistenteId, matriculas, momento, tipo);
}

/**
 * El papel del Asistente que vence primero, o `null`. Los que no tienen fecha de vencimiento no
 * cuentan: no se sabe si vencen, y suponer que sí sería inventar.
 */
export function papelQueVencePrimero(asistenteId, documentos) {
  const conFecha = lista(documentos).filter(
    (d) => d.asistente_id === asistenteId && d.fecha_vencimiento
  );
  if (!conFecha.length) return null;
  return conFecha.reduce((mejor, d) =>
    d.fecha_vencimiento < mejor.fecha_vencimiento ? d : mejor
  );
}

/**
 * Cuántas veces este Asistente ya atendió a esta gente.
 *
 * "Ya atendió" significa que la guardia empezó antes de ahora y no se canceló ni quedó como
 * ausencia. Una guardia futura ya asignada no es continuidad todavía: es una intención.
 *
 * Recibe la lista de Pacientes del hueco, no uno solo, y cuenta la guardia si el Asistente ya
 * atendió a **alguno** de ellos: quien viene atendiendo hace meses a la señora de la casa no
 * es un desconocido porque ahora el turno incluya también al marido. Contar por un solo
 * Paciente le borraba toda la historia y lo mandaba al fondo de la lista de candidatos.
 *
 * El número depende del rango de guardias que la pantalla haya cargado. Si trajo un mes, el
 * conteo es de ese mes. Es una limitación conocida y no se disimula: se cuenta lo que hay.
 */
export function vecesQueAtendio(asistenteId, pacienteIds, guardias, ahora) {
  const buscados = new Set((pacienteIds ?? []).filter(Boolean));
  if (buscados.size === 0) return 0;
  return lista(guardias).filter(
    (g) =>
      g.asistente_id === asistenteId &&
      idsDePacientes(g).some((id) => buscados.has(id)) &&
      g.estado !== 'cancelada' &&
      g.estado !== 'ausente' &&
      inicioDeGuardia(g) < ahora
  ).length;
}

/**
 * Qué clave de traducción le corresponde a cada motivo de bloqueo de la Matrícula, y cuánto
 * resta. Los tres motivos vienen de `lib/matricula.js`, que es donde vive la regla.
 */
/**
 * A cuántos kilómetros vive el Asistente del Paciente más cercano de esta guardia, o `null`.
 *
 * Devuelve `null` —y no un número grande, ni un cero— cuando falta cualquiera de los dos puntos:
 * si el Asistente no tiene su domicilio ubicado en el mapa, o si ninguno de los Pacientes de la
 * guardia lo tiene. Quien llama tiene que callarse en ese caso. Una distancia inventada es peor
 * que ninguna distancia, porque parece confiable y nadie la vuelve a revisar.
 *
 * Con varios Pacientes se toma **el más cercano**, que es lo único que se puede afirmar: el
 * Asistente viaja hasta esa casa y las demás le quedan a un paso. Promediar daría un número que
 * no corresponde a ningún viaje real.
 *
 * Es distancia en línea recta (`lib/distancia.js`), no tiempo de viaje.
 */
export function kmHastaElPaciente(asistente, pacientes) {
  const lat = Number(asistente?.lat);
  const lng = Number(asistente?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let menor = null;
  for (const paciente of lista(pacientes)) {
    const pLat = Number(paciente?.lat);
    const pLng = Number(paciente?.lng);
    if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;
    const km = distanciaKm(lat, lng, pLat, pLng);
    if (menor === null || km < menor) menor = km;
  }
  return menor;
}

const MOTIVO_DE_BLOQUEO = {
  [BLOQUEO.SIN_MATRICULA]: { clave: MOTIVO.MATRICULA_FALTA, peso: 'matricula_falta' },
  [BLOQUEO.VENCIDA]: { clave: MOTIVO.MATRICULA_VENCIDA, peso: 'matricula_vencida' },
  [BLOQUEO.SIN_VERIFICAR]: {
    clave: MOTIVO.MATRICULA_SIN_VERIFICAR,
    peso: 'matricula_sin_verificar',
  },
};

// ============================================================================
// La lista de candidatos
// ============================================================================

/**
 * Ordena a los Asistentes de la Prestadora de mejor a peor para cubrir un hueco.
 *
 * @param hueco     la fila de `guardias` sin Asistente que hay que tapar.
 * @param datos     lo que la pantalla ya cargó:
 *                    asistentes     → el plantel de la Prestadora, entero. Quién sigue estando
 *                                     se decide acá adentro, no en la consulta de la pantalla
 *                                     (ver `estaEnElPlantel` y el porqué unas líneas más abajo)
 *                    guardias       → todas las del rango, para ver ocupación y carga semanal
 *                    ausencias      → filas de `ausencias` que se pisan con el rango cargado,
 *                                     con `asistente_id`, `fecha_inicio` y `fecha_fin` y nada
 *                                     más: el tipo de ausencia no viaja (CLAUDE.md §6). Si no
 *                                     vienen, nadie se bloquea por ausencia
 *                    matriculas     → filas de `matriculas_asistente`
 *                    estadoMatricula→ filas de la vista `estado_matricula_asistente`: dicen si
 *                                     el tipo de cada Asistente exige Matrícula, cuál, y si la
 *                                     Prestadora es estricta. Si no vienen, nadie se bloquea
 *                                     por Matrícula.
 *                    documentos     → filas de `documentos_asistente`
 *                    ofertas        → filas de `ofertas_guardia` de este hueco
 *                    pacientes      → filas de `pacientes` con `id`, `lat` y `lng`, para poder
 *                                     medir la distancia. Si no vienen, no se dice nada de la
 *                                     cercanía; ningún otro criterio cambia.
 *                    ahora          → Date
 * @param opciones  `{ pesos, topes }` — todos opcionales, todos para pisar
 *                  los valores de arriba sin tocar este archivo.
 *
 * @returns array ordenado de mejor a peor. Cada elemento:
 *   { asistente, puntaje, aFavor: [{clave, valores}], enContra: [...], bloqueado, yaInvitado }
 *
 * Los bloqueados **también vienen en la lista**, al final y con su motivo a la vista. Sacarlos
 * haría que quien mira se pregunte por qué falta fulano y no encuentre respuesta en ningún
 * lado; verlo al fondo con "ese día ya tiene una guardia de 08:00 a 16:00" cierra la pregunta.
 */
export function candidatosParaGuardia(hueco, datos = {}, opciones = {}) {
  if (!hueco) return [];

  const pesos = { ...PESOS, ...(opciones.pesos ?? {}) };
  const topes = { ...TOPES, ...(opciones.topes ?? {}) };
  const ahora = datos.ahora ?? new Date();

  /* Quien ya no trabaja en la Prestadora se va de la lista.
     ------------------------------------------------------------------------------------------
     POR QUÉ EL FILTRO VIVE ACÁ Y NO EN LA CONSULTA DE LA PANTALLA. La pantalla que abre el panel
     de cobertura pide el plantel una sola vez y lo usa para tres cosas distintas: poner el
     nombre del Asistente en cada guardia ya asignada de la grilla, llenar los desplegables de
     reasignación, y alimentar esta lista. Filtrar en esa consulta arreglaría esta lista y
     rompería la primera: una guardia de la semana pasada que cubrió alguien que después fue
     cesado se quedaría sin nombre, con un guión donde antes había una persona.
     Y sobre todo, la pregunta "¿a quién se puede proponer para un hueco?" es de este archivo,
     que es el punto único de verdad (regla 12 de CLAUDE.md §7). Dejarla escrita en cada consulta
     que arme una lista de candidatos es garantizar que la próxima pantalla se la olvide.

     POR QUÉ SE VAN Y NO QUEDAN AL FONDO CON SU MOTIVO, que es lo que hace todo el resto de este
     archivo. La diferencia es real: los bloqueados de más abajo son gente del plantel que no
     puede tomar ESTA guardia, y verlos ahí cierra la pregunta "¿por qué no aparece fulana?".
     Quien ya no trabaja en la Prestadora no es un candidato bloqueado: no es un candidato.
     Arrastrarlo por el fondo de todos los huecos, para siempre, sería ruido. */
  const asistentes = lista(datos.asistentes).filter(estaEnElPlantel);
  const guardias = lista(datos.guardias);
  const ausencias = lista(datos.ausencias);
  const matriculas = lista(datos.matriculas);
  const documentos = lista(datos.documentos);
  const ofertas = lista(datos.ofertas);
  const estadosMatricula = lista(datos.estadoMatricula);

  // Los Pacientes de este hueco, una sola vez para toda la lista: la distancia se mide contra
  // los mismos puntos para cada Asistente, y volver a filtrarlos por candidato sería recorrer
  // la lista entera de Pacientes tantas veces como plantel tenga la Prestadora.
  const buscados = new Set(idsDePacientes(hueco).filter(Boolean));
  const pacientesDelHueco = lista(datos.pacientes).filter((p) => buscados.has(p?.id));

  // Los ya invitados, en un conjunto: preguntarlo una vez por Asistente sobre un array sería
  // recorrer la lista de ofertas otras tantas veces para nada.
  const yaInvitados = new Set(
    ofertas
      .filter((o) => !hueco.id || !o.guardia_id || o.guardia_id === hueco.id)
      .map((o) => o.asistente_id)
  );

  const evaluados = asistentes.map((asistente) =>
    evaluarAsistente(asistente, {
      hueco,
      guardias,
      ausencias,
      matriculas,
      documentos,
      pacientesDelHueco,
      ahora,
      pesos,
      topes,
      estadoMatricula: estadoDe(asistente.id, estadosMatricula),
      yaInvitado: yaInvitados.has(asistente.id),
    })
  );

  // Primero los que se pueden asignar, después los bloqueados; dentro de cada grupo, por
  // puntaje. El desempate por nombre es para que la lista no baile entre dos recargas cuando
  // dos Asistentes empatan: una lista que se reordena sola es una lista en la que no se confía.
  return evaluados.sort((a, b) => {
    if (a.bloqueado !== b.bloqueado) return a.bloqueado ? 1 : -1;
    if (b.puntaje !== a.puntaje) return b.puntaje - a.puntaje;
    return String(a.asistente?.nombre ?? '').localeCompare(String(b.asistente?.nombre ?? ''));
  });
}

/** Todo lo que se mira de un solo Asistente. Devuelve el elemento de la lista, sin ordenar. */
function evaluarAsistente(asistente, ctx) {
  const { hueco, guardias, matriculas, documentos, ahora, pesos, topes } = ctx;

  const aFavor = [];
  const enContra = [];
  let puntaje = 0;
  let bloqueado = false;

  const suma = (destino, clave, valores, peso) => {
    destino.push(valores ? { clave, valores } : { clave, valores: {} });
    puntaje += peso;
  };

  const propias = guardiasDeAsistente(asistente.id, guardias, hueco.id);

  // El último día que ocupa la guardia. La de noche arranca a las 22:00 y termina a las 06:00
  // del día siguiente, así que "el día de la guardia" en realidad son dos, y las dos
  // comprobaciones que miran el almanaque —la ausencia y la Matrícula— tienen que llegar hasta
  // el final y no quedarse en el comienzo. Es el mismo día que mira la base.
  const ultimoDiaDeLaGuardia = diaDe(finDeGuardia(hueco));

  // --- 1. Continuidad. El criterio que más pesa: para el Paciente y su Familia, que venga
  //        alguien conocido vale más que cualquier comodidad de la agenda.
  const veces = vecesQueAtendio(asistente.id, idsDePacientes(hueco), guardias, ahora);
  if (veces > 0) {
    const puntos = Math.min(veces * pesos.continuidad_por_vez, pesos.continuidad_maxima);
    suma(aFavor, MOTIVO.CONTINUIDAD, { n: veces }, puntos);
  } else {
    suma(enContra, MOTIVO.SIN_CONTINUIDAD, null, pesos.sin_continuidad);
  }

  // --- 2. ¿Está libre a esa hora? Lo único que bloquea sin discusión posible.
  const choque = guardiaQueSePisa(hueco, propias);
  if (choque) {
    bloqueado = true;
    suma(
      enContra,
      MOTIVO.OCUPADO,
      { desde: hhmm(choque.hora_inicio), hasta: hhmm(choque.hora_fin) },
      pesos.ocupado
    );
  } else {
    suma(aFavor, MOTIVO.LIBRE, null, pesos.libre);
  }

  // --- 2 bis. La modalidad de trabajo. Bloquea igual que estar ocupado, y por un motivo
  //        parecido: en prestación directa la Prestadora dirige el trabajo y en marketplace el
  //        Asistente elige qué toma (CLAUDE.md §3). Quien no trabaja en la modalidad de esta
  //        guardia no es que esté peor puesto que otro: es que esa guardia no es para él.
  //
  //        La regla la hace cumplir la base, en las tres puertas. Acá se la anticipa para que
  //        el motivo se vea antes de elegir a esa persona (`lib/modalidades.js`).
  const motivoDeModalidad = MOTIVO_POR_MODALIDAD[hueco.canal_modalidad];
  if (motivoDeModalidad && !trabajaEnModalidad(asistente, hueco.canal_modalidad)) {
    bloqueado = true;
    suma(enContra, motivoDeModalidad, null, pesos.modalidad_distinta);
  }

  // --- 2 ter. Ausencias registradas. Bloquea igual que estar ocupado, y por el mismo motivo:
  //        quien tiene una ausencia que cubre esa fecha no está ese día, y eso no se arregla
  //        con un descuento de puntaje.
  //
  //        Es la única comprobación de este archivo que empezó siendo un error a favor: sin
  //        ella, quien estaba de licencia no solo aparecía, aparecía **arriba**, porque no
  //        tenía ninguna guardia encima y se llevaba los puntos de "ese día lo tiene libre".
  //
  //        El motivo que se muestra no dice de qué ausencia se trata, y el tipo ni siquiera
  //        llega hasta acá: la razón está escrita en `ausenciaQueTapa` (CLAUDE.md §6).
  if (ausenciaQueTapa(asistente.id, ctx.ausencias, hueco.fecha, ultimoDiaDeLaGuardia)) {
    bloqueado = true;
    suma(enContra, MOTIVO.AUSENCIA, null, pesos.ausencia);
  }

  // --- 3. Matrícula. Bloquea cuando el tipo de Asistente la exige y algo no está en orden.
  //
  //        La regla no se decide acá: se decide en la base, que además la hace cumplir en las
  //        otras tres puertas (asignar, invitar, aceptar). Acá se la anticipa, para que el
  //        motivo esté a la vista antes de que alguien elija a esta persona y se choque con
  //        la pared. La cuenta vive una sola vez, en `lib/matricula.js`.
  //
  //        Se mira contra el día en que la guardia **termina**, no el que empieza: lo que
  //        importa es que la Matrícula llegue hasta el final (ver `ultimoDiaDeLaGuardia`).
  const bloqueoMatricula = motivoDeBloqueo(
    asistente.id,
    ctx.estadoMatricula,
    matriculas,
    ultimoDiaDeLaGuardia
  );

  if (bloqueoMatricula) {
    bloqueado = true;
    const { clave, peso } = MOTIVO_DE_BLOQUEO[bloqueoMatricula];
    suma(enContra, clave, null, pesos[peso]);
  } else {
    // No está bloqueado, pero puede estar por vencerse: eso se avisa y resta, nunca bloquea.
    const matricula = matriculaVigenteAl(
      asistente.id,
      matriculas,
      ultimoDiaDeLaGuardia,
      ctx.estadoMatricula?.tipo_matricula ?? null
    );
    if (matricula) {
      const limiteAviso = sumarDiasISO(hueco.fecha, topes.dias_aviso_vencimiento);
      if (matricula.vigente_hasta && matricula.vigente_hasta <= limiteAviso) {
        suma(
          enContra,
          MOTIVO.MATRICULA_VENCE,
          { fecha: matricula.vigente_hasta },
          pesos.matricula_vence
        );
      } else {
        suma(aFavor, MOTIVO.MATRICULA_OK, null, pesos.matricula_ok);
      }
    }
    // Si no hay Matrícula y tampoco hay bloqueo, es que su tipo no la exige: no se dice nada.
    // "Matrícula vigente" sería mentira y "no tiene Matrícula" sonaría a problema sin serlo.
  }

  // --- 4. Documentación. Si el Asistente no tiene ningún papel con vencimiento cargado no se
  //        dice nada: "papeles al día" sería mentira, porque lo que pasa es que no hay papeles
  //        cargados, y no hay clave de traducción para esa tercera situación.
  const papel = papelQueVencePrimero(asistente.id, documentos);
  if (papel) {
    const limiteAviso = sumarDiasISO(hueco.fecha, topes.dias_aviso_vencimiento);
    if (papel.fecha_vencimiento <= limiteAviso) {
      suma(enContra, MOTIVO.PAPELES_VENCEN, { fecha: papel.fecha_vencimiento }, pesos.papeles_vencen);
    } else {
      suma(aFavor, MOTIVO.PAPELES_OK, null, pesos.papeles_ok);
    }
  }

  // --- 5. Horas de la semana. Pasarse del tope no bloquea: la Prestadora puede decidir pagarlo,
  //        y una guardia sin cubrir es peor que una hora extra. Solo tiene que verse.
  const tope = topeSemanalDe(asistente, topes);
  const carga = cargaSemanal(hueco, propias, topes);
  if (carga.conEsta > tope) {
    suma(enContra, MOTIVO.HORAS_PASA, { tope: redondear(tope) }, pesos.horas_pasa_el_tope);
  } else if (carga.sinEsta >= tope * topes.proporcion_horas_para_avisar) {
    // Resta proporcional: cuanto más cerca del tope, más resta. No es lo mismo estar al 76 %
    // que al 99 %, y un castigo fijo trataría esos dos casos igual.
    const cercania = Math.min(carga.conEsta / tope, 1);
    suma(
      enContra,
      MOTIVO.HORAS,
      { horas: redondear(carga.sinEsta), tope: redondear(tope) },
      pesos.horas_cerca_del_tope * cercania
    );
  }

  // --- 6. Descanso entre guardias. Tampoco bloquea, por el mismo motivo que las horas.
  const descanso = descansoMasCorto(hueco, propias);
  if (descanso !== null) {
    if (descanso < topes.horas_descanso_minimo) {
      suma(enContra, MOTIVO.DESCANSO_CORTO, { horas: redondear(descanso) }, pesos.descanso_corto);
    } else if (descanso <= topes.horas_descanso_a_mencionar) {
      suma(aFavor, MOTIVO.DESCANSO, { horas: redondear(descanso) }, pesos.descanso_ok);
    }
  }

  // --- 7. Cercanía. No bloquea nunca: hay gente que viaja una hora todos los días y lo tiene
  //        resuelto. Y se calla cuando falta cualquiera de los dos domicilios en el mapa, que
  //        hoy es lo más común, porque nadie convierte todavía una dirección escrita en un par
  //        de coordenadas. El motivo muestra los kilómetros para que quien lee la lista pueda
  //        corregir con lo que sabe del barrio: son en línea recta, no de viaje.
  const km = kmHastaElPaciente(asistente, ctx.pacientesDelHueco);
  if (km !== null) {
    if (km <= topes.km_cerca) {
      suma(aFavor, MOTIVO.CERCA, { km: redondear(km) }, pesos.cerca);
    } else if (km >= topes.km_lejos) {
      suma(enContra, MOTIVO.LEJOS, { km: redondear(km) }, pesos.lejos);
    }
    // Entre un borde y el otro no se dice nada: a doce kilómetros no hay nada que opinar.
  }

  return {
    asistente,
    puntaje: Math.round(puntaje),
    aFavor,
    enContra,
    bloqueado,
    yaInvitado: ctx.yaInvitado,
  };
}

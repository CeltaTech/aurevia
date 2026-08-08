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
// Dos criterios que la gente espera ver y que HOY NO SE PUEDEN CALCULAR
// ----------------------------------------------------------------------------
//
// 1. "A cuántos kilómetros vive el Asistente del Paciente."
//    El Paciente sí tiene ubicación (`pacientes.lat`, `pacientes.lng`), pero el Asistente
//    **no**: la tabla `asistentes` no tiene ni latitud, ni longitud, ni una zona comparable
//    con la del Paciente (tiene `zonas`, que es una lista de nombres escritos a mano, y
//    `pacientes` no tiene una columna de zona contra la cual compararla).
//    No se estima, no se simula y no se inventa un número: un candidato ordenado por una
//    distancia imaginaria es peor que un candidato sin ese criterio, porque parece confiable.
//    Para tenerlo haría falta una de estas dos cosas, y es una decisión de esquema:
//      a) `asistentes.lat` / `asistentes.lng` (domicilio del Asistente), o
//      b) una zona de verdad —una tabla de zonas con id— referenciada por `asistentes` y por
//         `pacientes`, para poder preguntar "¿es la misma zona?" sin comparar textos sueltos.
//
// 2. "La autorización de la Obra Social está agotada."
//    Ese dato no existe todavía en ningún lado. `pacientes.obra_social` es el nombre de la
//    obra social, no un cupo de horas autorizadas ni un saldo. Haría falta guardar la
//    autorización (período, horas o guardias autorizadas, consumidas) para poder avisarlo.
//
// Mientras esas dos cosas no existan, este archivo no las nombra. Cuando existan, cada una es
// un peso más en `PESOS` y una comprobación más abajo — nada del resto cambia.

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

  papeles_ok: 5,
  papeles_vencen: -10,

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

  /** Con cuántos días de anticipación se avisa que un papel o una Matrícula vence. */
  dias_aviso_vencimiento: 30,

  /** Qué día arranca la semana para contar horas. 1 = lunes (0 sería domingo). */
  dia_inicio_semana: 1,
};

/** Las claves de traducción que devuelve este archivo. Viven en `t.guardias.cobertura_panel`. */
export const MOTIVO = {
  CONTINUIDAD: 'motivo_continuidad',
  SIN_CONTINUIDAD: 'motivo_sin_continuidad',
  LIBRE: 'motivo_libre',
  OCUPADO: 'motivo_ocupado',
  MATRICULA_OK: 'motivo_matricula_ok',
  MATRICULA_VENCE: 'motivo_matricula_vence',
  MATRICULA_FALTA: 'motivo_matricula_falta',
  MATRICULA_VENCIDA: 'motivo_matricula_vencida',
  MATRICULA_SIN_VERIFICAR: 'motivo_matricula_sin_verificar',
  PAPELES_OK: 'motivo_papeles_ok',
  PAPELES_VENCEN: 'motivo_papeles_vencen',
  HORAS: 'motivo_horas',
  HORAS_PASA: 'motivo_horas_pasa',
  DESCANSO: 'motivo_descanso',
  DESCANSO_CORTO: 'motivo_descanso_corto',
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
 *                    asistentes     → los activos de la Prestadora
 *                    guardias       → todas las del rango, para ver ocupación y carga semanal
 *                    matriculas     → filas de `matriculas_asistente`
 *                    estadoMatricula→ filas de la vista `estado_matricula_asistente`: dicen si
 *                                     el tipo de cada Asistente exige Matrícula, cuál, y si la
 *                                     Prestadora es estricta. Si no vienen, nadie se bloquea
 *                                     por Matrícula.
 *                    documentos     → filas de `documentos_asistente`
 *                    ofertas        → filas de `ofertas_guardia` de este hueco
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

  const asistentes = lista(datos.asistentes);
  const guardias = lista(datos.guardias);
  const matriculas = lista(datos.matriculas);
  const documentos = lista(datos.documentos);
  const ofertas = lista(datos.ofertas);
  const estadosMatricula = lista(datos.estadoMatricula);

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
      matriculas,
      documentos,
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

  // --- 3. Matrícula. Bloquea cuando el tipo de Asistente la exige y algo no está en orden.
  //
  //        La regla no se decide acá: se decide en la base, que además la hace cumplir en las
  //        otras tres puertas (asignar, invitar, aceptar). Acá se la anticipa, para que el
  //        motivo esté a la vista antes de que alguien elija a esta persona y se choque con
  //        la pared. La cuenta vive una sola vez, en `lib/matricula.js`.
  //
  //        Se mira contra el día en que la guardia **termina**, no el que empieza: la de noche
  //        arranca a las 22:00 y termina a las 06:00 del día siguiente, y lo que importa es que
  //        la Matrícula llegue hasta el final. Es el mismo día que mira la base.
  const ultimoDiaDeLaGuardia = diaDe(finDeGuardia(hueco));
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

  return {
    asistente,
    puntaje: Math.round(puntaje),
    aFavor,
    enContra,
    bloqueado,
    yaInvitado: ctx.yaInvitado,
  };
}

// ---------------------------------------------------------------------------
// indicadoresDeducidos.js — los indicios de dependencia que el sistema ya sabe
//
// POR QUÉ EXISTE. El puntaje de riesgo de reclasificación se arma con siete indicadores, y
// hasta hoy los siete se tildaban a mano, uno por uno, Asistente por Asistente. Tres de ellos
// no hacen falta preguntarlos: la ficha ya dice hace cuánto entró la persona, cuántas horas
// hace por semana y en cuántas zonas trabaja. `docs/PRD_02B_Gestion_Personal.md:130` pide que
// el puntaje se recalcule cuando cambian esos datos; deducirlos en el momento en que se
// muestran hace que eso sea literal: cambian las horas y el número cambia, sin que nadie
// apriete nada.
//
// LOS OTROS CUATRO SIGUEN A MANO, y no es una deuda: exclusividad de facturación, herramientas
// provistas, horario fijo impuesto y supervisión directa no tienen de dónde salir. La
// exclusividad de facturación además no se podría deducir cruzando Organizaciones, que es justo
// lo que el aislamiento prohíbe.
//
// NINGÚN UMBRAL ESTÁ ESCRITO ACÁ. A partir de cuántos meses o de cuántas horas el indicio está
// pleno es un valor legal —cambia por jurisdicción y con el tiempo—, así que sale de
// `escalas_legales` (`tipo = 'umbral_riesgo_dependencia'`) a la escala vigente a la fecha del
// cálculo. Si el umbral no está, el indicador no se deduce: queda como esté cargado a mano y se
// avisa, igual que hace `calcularScoreRiesgo` cuando le falta un peso.
// ---------------------------------------------------------------------------
import { obtenerValorEscala } from './escalasLegales';

// Los tres que salen de la ficha. El resto de `INDICADORES_RIESGO` se carga a mano.
export const INDICADORES_DEDUCIDOS = [
  'antiguedad_vinculo',
  'horas_semanales_promedio',
  'exclusividad_zona',
];

// Meses de calendario entre dos fechas escritas como `AAAA-MM-DD`. Se cuenta sobre el texto y
// no sobre un `Date`: una fecha sin hora se lee como medianoche UTC, y en un huso al oeste eso
// cae el día anterior, que a principio de mes cambia el mes entero.
function mesesEntre(desde, hasta) {
  const [anioA, mesA, diaA] = desde.split('-').map(Number);
  const [anioB, mesB, diaB] = hasta.split('-').map(Number);
  const meses = (anioB - anioA) * 12 + (mesB - mesA);
  return diaB < diaA ? meses - 1 : meses;
}

// Un indicio parcial es indicio: media jornada sobre el umbral vale medio indicador, no cero.
// Por encima del umbral no sigue creciendo, porque el indicio ya está pleno.
function proporcion(valor, umbral) {
  return Math.min(1, Math.max(0, valor / umbral));
}

/**
 * Qué indicadores se deducen de la ficha, y cuáles no se pudieron deducir.
 *
 * Devuelve `{ valores, sinDeducir }`. En `valores` va cada indicador deducido con su número
 * 0-1 y con qué dato de la ficha salió, para que la pantalla lo explique en vez de mostrar un
 * número que aparece solo. En `sinDeducir` va cada indicador que quedó afuera con el motivo:
 * `sin_dato` si la ficha no lo tiene cargado, `sin_umbral` si falta el valor legal vigente.
 */
export function deducirIndicadores(asistente, escalasResueltas, hoy) {
  const valores = {};
  const sinDeducir = [];

  // Antigüedad del vínculo. Cuanto más largo, más se parece a un empleo.
  const umbralMeses = obtenerValorEscala(escalasResueltas, 'umbral_riesgo_dependencia', 'antiguedad_vinculo');
  if (!asistente?.fecha_alta) {
    sinDeducir.push({ indicador: 'antiguedad_vinculo', motivo: 'sin_dato' });
  } else if (!(umbralMeses > 0)) {
    // Un umbral en cero no es un umbral: dividir por él daría infinito y el indicador quedaría
    // pleno para cualquiera. Se trata como si no estuviera.
    sinDeducir.push({ indicador: 'antiguedad_vinculo', motivo: 'sin_umbral' });
  } else {
    const meses = Math.max(0, mesesEntre(asistente.fecha_alta, hoy));
    valores.antiguedad_vinculo = { valor: proporcion(meses, umbralMeses), dato: meses, umbral: umbralMeses };
  }

  // Horas semanales. Una carga cercana a la jornada completa es el indicio más fuerte de los
  // tres que se deducen.
  const umbralHoras = obtenerValorEscala(escalasResueltas, 'umbral_riesgo_dependencia', 'horas_semanales_promedio');
  const horas = Number(asistente?.horas_semanales);
  if (!asistente?.horas_semanales || Number.isNaN(horas)) {
    sinDeducir.push({ indicador: 'horas_semanales_promedio', motivo: 'sin_dato' });
  } else if (!(umbralHoras > 0)) {
    sinDeducir.push({ indicador: 'horas_semanales_promedio', motivo: 'sin_umbral' });
  } else {
    valores.horas_semanales_promedio = { valor: proporcion(horas, umbralHoras), dato: horas, umbral: umbralHoras };
  }

  // Exclusividad de zona. No lleva umbral: aceptar trabajo en un solo lugar es el indicio, y eso
  // no depende de ningún número. Con varios lugares el indicio no está, y eso es un dato.
  //
  // Se cuentan los lugares guardados de la ficha, que es lo que la pantalla le adjunta. Una ficha
  // que todavía no los trajo no cuenta cero: cuenta sin dato, porque cero diría que esa persona
  // no acepta trabajar en ninguna parte.
  const lugares = Array.isArray(asistente?.lugares) ? asistente.lugares : null;
  if (!lugares || lugares.length === 0) {
    sinDeducir.push({ indicador: 'exclusividad_zona', motivo: 'sin_dato' });
  } else {
    valores.exclusividad_zona = { valor: lugares.length === 1 ? 1 : 0, dato: lugares.length, umbral: null };
  }

  return { valores, sinDeducir };
}

/**
 * Los siete indicadores listos para el cálculo: lo deducido pisa lo guardado, y lo que no se
 * pudo deducir queda como esté cargado a mano.
 *
 * Lo deducido pisa y no al revés porque la ficha es la verdad: si alguien tildó «trabaja en una
 * sola zona» y después se le asignaron tres, el tilde viejo no puede seguir mandando.
 */
export function indicadoresParaElPuntaje(guardados, deducidos) {
  const listos = { ...(guardados ?? {}) };
  for (const [indicador, { valor }] of Object.entries(deducidos)) {
    listos[indicador] = valor;
  }
  return listos;
}

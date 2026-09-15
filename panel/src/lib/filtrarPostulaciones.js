// Qué postulaciones quedan después de los filtros de la pantalla de Postulantes.
//
// POR QUÉ ESTÁ ACÁ Y NO ADENTRO DE LA PANTALLA. Empezó siendo cinco condiciones escritas adentro
// del `useMemo` de `pages/Postulaciones.jsx`. Hoy son once, y varias no son una comparación sino
// una decisión: qué pasa con quien no dijo cuánto pretende cobrar, o qué significa "viaja al
// menos 20 km" para alguien que no declaró distancia. Esas decisiones no se prueban desde una
// pantalla; acá sí, con datos inventados y sin navegador.
//
// UN FILTRO VACÍO NO FILTRA. Todos los campos arrancan en texto vacío, que es lo que devuelve un
// desplegable sin elegir y una casilla de número sin escribir. Vacío deja pasar todo.
//
// QUIEN NO DIJO EL DATO QUEDA AFUERA CUANDO EL DATO SE PIDE. Si se busca gente que pretenda hasta
// cierto honorario, quien no lo dijo no cumple la condición: no se sabe cuánto pretende, y
// meterla adentro del resultado la haría pasar por alguien que dijo un número bajo. Mientras no se
// toque ese filtro, aparece como todas las demás.

import { contieneCodigo } from './postulacionCodigos';

function coincideBusqueda(postulacion, texto) {
  if (!texto) return true;
  const buscado = texto.toLowerCase();
  return ['nombre', 'email', 'telefono'].some(
    (campo) => postulacion[campo]?.toLowerCase().includes(buscado),
  );
}

// Un número, o `null` cuando no hay ninguno. Sirve para los dos lados: lo escrito en una casilla
// —que llega siempre como texto, y vacío significa "sin filtro"— y lo guardado en la fila.
//
// El vacío se pregunta a mano y no con `Number.isFinite` a secas, porque `Number(null)` da cero y
// cero es un número perfectamente finito: quien no dijo cuánto pretende cobrar entraría en
// cualquier filtro "hasta tanto" como si no pretendiera nada. Y lo escrito a medias —"-", "1e"—
// tampoco filtra: un filtro que todavía no se entiende no puede vaciar la lista.
function dato(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * @param {Array<object>} filas       las postulaciones traídas de la base
 * @param {object} f                  los filtros de la pantalla, tal como los guarda `useFiltros`
 * @returns {Array<object>} las que cumplen todas las condiciones puestas
 */
export function filtrarPostulaciones(filas, f = {}) {
  const lista = Array.isArray(filas) ? filas : [];
  const honorarioDesde = dato(f.honorario_desde);
  const honorarioHasta = dato(f.honorario_hasta);
  const distanciaDesde = dato(f.distancia_desde);

  return lista.filter((p) => {
    if (!coincideBusqueda(p, f.busqueda)) return false;
    if (f.estado && p.estado !== f.estado) return false;
    if (!contieneCodigo(p.especialidades, f.especialidad)) return false;
    if (!contieneCodigo(p.zonas, f.zona)) return false;
    if (!contieneCodigo(p.disponibilidad, f.disponibilidad)) return false;
    if (f.situacion_fiscal && p.situacion_fiscal !== f.situacion_fiscal) return false;

    // Quien no marcó que está disponible para urgencias no lo está: la columna nace en falso y
    // sólo es cierta si la persona la marcó.
    if (f.urgencias === 'si' && p.disponible_urgencias !== true) return false;

    // Por horas o cama adentro. Son dos columnas independientes —alguien puede ofrecer las dos, o
    // ninguna—, así que se pregunta por la que se eligió y no se deduce la otra.
    if (f.tipo_servicio === 'con_retiro' && p.disponible_con_retiro !== true) return false;
    if (f.tipo_servicio === 'sin_retiro' && p.disponible_sin_retiro !== true) return false;

    if (honorarioDesde !== null || honorarioHasta !== null) {
      const pretende = dato(p.honorario_pretendido);
      if (pretende === null) return false;
      if (honorarioDesde !== null && pretende < honorarioDesde) return false;
      if (honorarioHasta !== null && pretende > honorarioHasta) return false;
    }

    // "Viaja al menos tantos kilómetros": quien no declaró distancia no se sabe hasta dónde va.
    if (distanciaDesde !== null) {
      const viaja = dato(p.distancia_maxima_km);
      if (viaja === null || viaja < distanciaDesde) return false;
    }

    return true;
  });
}

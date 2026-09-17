// Dónde está cada Familia, y cuáles quedan cuando se busca por una localidad.
//
// DÓNDE ESTÁ UNA FAMILIA. En sus Pacientes, que son quienes tienen domicilio: la Familia no tiene
// uno propio. Por eso lo que se junta es un conjunto de lugares y no uno solo —dos Pacientes de la
// misma Familia pueden vivir en localidades distintas— y por eso el Paciente dado de baja no
// cuenta: la Familia ya no está donde vivía quien se fue.
//
// SE COMPARAN IDENTIFICADORES, NUNCA NOMBRES. Lo guardado en la ficha del Paciente es cuál lugar.
// Buscar por el nombre traería juntas dos localidades que se llaman igual en provincias distintas,
// y dejaría afuera a la que alguien escribió con una tilde de más. El nombre se busca recién al
// mostrarlo, en el catálogo, así que corregirlo una vez lo corrige en todas las fichas.
//
// ESTÁ ACÁ Y NO ADENTRO DE LA PANTALLA porque son decisiones, no dibujo: qué Paciente cuenta, qué
// pasa con el que todavía no tiene localidad elegida y qué localidades vale la pena ofrecer. Eso
// se prueba con datos inventados y sin navegador.
//
// EL DOMICILIO ES DATO SENSIBLE: acá no entra ni la calle ni la altura, sólo la localidad
// (celtatech/CLAUDE.md §6).

/**
 * Cada Familia con las localidades de sus Pacientes vivos y cuántos son.
 *
 * @param {Array<object>} filas          las Familias traídas de la base, con sus Pacientes adentro
 * @param {(id: string) => string} nombreDeLugar  cómo se llama un lugar, según el catálogo
 */
export function familiasConSuLocalidad(filas, nombreDeLugar = () => '') {
  return (Array.isArray(filas) ? filas : []).map((fam) => {
    const vivos = (fam.pacientes ?? []).filter((paciente) => !paciente.deleted_at);
    const lugares = [...new Set(vivos.map((paciente) => paciente.lugar_id).filter(Boolean))];
    return {
      ...fam,
      cuantosPacientes: vivos.length,
      lugares,
      nombresDeLugares: lugares.map(nombreDeLugar).filter(Boolean).sort(),
    };
  });
}

/**
 * Las que cumplen los filtros de la pantalla. Vacío no filtra.
 *
 * La localidad se elige de una lista y el texto libre no la mira: son dos maneras distintas de
 * buscar, y mezclarlas haría que escribir «Belgrano» contestara por las dos localidades que se
 * llaman así.
 */
export function filtrarFamilias(familias, f = {}) {
  const buscado = String(f.busqueda ?? '').trim().toLowerCase();

  return (Array.isArray(familias) ? familias : []).filter((fam) => {
    if (f.lugar && !(fam.lugares ?? []).includes(f.lugar)) return false;
    if (!buscado) return true;
    return ['nombre', 'email', 'telefono'].some(
      (campo) => fam.solicitudes?.[campo]?.toLowerCase().includes(buscado),
    );
  });
}

/**
 * Las localidades que vale la pena ofrecer en el filtro: aquellas donde vive alguien.
 *
 * Una del catálogo donde no hay ningún Paciente es una opción que siempre contesta vacío, y quien
 * la elige no sabe si no hay nadie ahí o si la pantalla se rompió.
 */
export function localidadesConFamilias(familias, catalogo) {
  const habitados = new Set((Array.isArray(familias) ? familias : []).flatMap((fam) => fam.lugares ?? []));
  return (catalogo ?? [])
    .filter((lugar) => habitados.has(lugar.id))
    .map((lugar) => ({ id: lugar.id, nombre: lugar.nombre }));
}

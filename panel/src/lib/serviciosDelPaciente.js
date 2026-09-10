// Qué Servicios acepta la base para un Paciente.
//
// La regla no se inventa acá: es la misma que aplica la base en
// `interno.exigir_paciente_y_servicio_del_mismo_contratante`, que llaman los disparadores de
// `prestaciones`, `guardias`, `guardia_pacientes` y `cierres_servicio_paciente`. Dice una sola
// cosa: **cuando el Cliente del Servicio es una Familia, el Paciente tiene que ser de esa
// Familia**. Cuando el Cliente es de otro tipo —una Obra Social, una empresa— ese vínculo no
// existe en la base y no se supone ninguno.
//
// Está en un archivo aparte porque la usan dos pantallas —el alta de Prestaciones y el alta de
// Guardias— y una regla repetida en dos lugares se despega en el tercero. Que a qué Prestadora
// pertenece cada Servicio ya lo resuelve la protección por fila, así que acá no se vuelve a
// preguntar.

export function servicioSirveParaFamilia(servicio, familiaId) {
  if (servicio?.tipo_contratante !== 'familia') return true;
  return Boolean(familiaId) && servicio.contratante_id === familiaId;
}

// Un turno puede cubrir a más de un Paciente, y la base los controla a todos. Así que el
// Servicio se puede ofrecer sólo si le sirve a cada uno de los que cubre.
export function serviciosParaFamilias(servicios, familiaIds) {
  if (familiaIds.length === 0) return [];
  return servicios.filter((s) => familiaIds.every((familiaId) => servicioSirveParaFamilia(s, familiaId)));
}

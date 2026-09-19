/* El catálogo de listas de opciones que trae el producto, guardado en un archivo.
 *
 * Esto NO es la fuente: la fuente es la base, y es de ahí de donde lo lee toda pantalla. Esto es
 * lo que queda cuando no hay con quién hablar —el aparato se quedó sin internet o el servidor no
 * contesta—, para que un desplegable de fábrica se siga dibujando en vez de quedar vacío.
 *
 * Tiene sólo lo general: lo que agrega cada Prestadora no puede estar acá, porque se carga
 * después y es de ella. Y no tiene identificadores, porque los pone la base: quien lo consume
 * junta por la clave de la lista.
 *
 * Lo que dice este archivo es exactamente lo que siembra la migración
 * `20261001150000_las_listas_de_opciones.sql`. Si una de las dos cambia, cambian las dos. */
export const LISTAS_DE_OPCIONES_DE_FABRICA = {
  disponibilidad: {
    i18n: { 'es-AR': 'Disponibilidad', en: 'Availability', 'pt-BR': 'Disponibilidade' },
    admite_opciones_propias: true,
    opciones: [
      { clave: 'manana', i18n: { 'es-AR': 'Mañana', en: 'Morning', 'pt-BR': 'Manhã' }, orden: 10 },
      { clave: 'tarde', i18n: { 'es-AR': 'Tarde', en: 'Afternoon', 'pt-BR': 'Tarde' }, orden: 20 },
      { clave: 'noche', i18n: { 'es-AR': 'Noche', en: 'Night', 'pt-BR': 'Noite' }, orden: 30 },
      {
        clave: 'fines_semana',
        i18n: { 'es-AR': 'Fines de semana', en: 'Weekends', 'pt-BR': 'Fins de semana' },
        orden: 40,
      },
    ],
  },
  situacion_fiscal: {
    i18n: { 'es-AR': 'Situación fiscal', en: 'Tax status', 'pt-BR': 'Situação fiscal' },
    admite_opciones_propias: false,
    opciones: [
      {
        clave: 'monotributo',
        i18n: {
          'es-AR': 'Monotributo',
          en: 'Monotributo (self-employed)',
          'pt-BR': 'Monotributo (autônomo)',
        },
        orden: 10,
      },
    ],
  },
};

/* Las opciones de una lista, con la misma forma que devuelve la base, para que quien las reciba
   no tenga que distinguir de dónde salieron. */
export function opcionesDeFabrica(claveDeLaLista) {
  const laLista = LISTAS_DE_OPCIONES_DE_FABRICA[claveDeLaLista];
  if (!laLista) return [];
  return laLista.opciones.map((opcion) => ({
    id: `de_fabrica:${claveDeLaLista}:${opcion.clave}`,
    prestadora_id: null,
    clave: opcion.clave,
    i18n: opcion.i18n,
    orden: opcion.orden,
    activa: true,
  }));
}

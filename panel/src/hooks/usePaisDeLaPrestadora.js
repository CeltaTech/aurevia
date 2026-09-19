import { useCatalogo } from './useCatalogo';

/* En qué país opera la Prestadora activa.
 *
 * Lo necesitan los catálogos que no son de ella sino de su jurisdicción —las escalas legales, las
 * fórmulas de cese, con qué documentos se identifica una Persona—: son contenido legal curado por
 * país, y una Prestadora no los decide. Antes cada uno de esos tres traía el país por su cuenta,
 * con su propio manejo del error, así que un país que no se pudo leer significaba tres cosas
 * distintas según la pantalla. */
export function usePaisDeLaPrestadora(prestadoraId) {
  const { filas, estado, error, recargar } = useCatalogo('prestadoras', {
    columnas: 'pais',
    filtros: { id: prestadoraId },
    orden: null,
    requiere: [prestadoraId],
  });

  return { pais: filas[0]?.pais ?? null, estado, error, recargar };
}

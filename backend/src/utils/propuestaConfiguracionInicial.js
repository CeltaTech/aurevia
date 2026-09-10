import { supabase } from '../db/connection.js';
import { catalogoDeTiposAsistente, resolverTipoAsistenteEnCatalogo } from './cuentasPanel.js';
import { CAMPOS_LISTA, valorDesdeFila } from './importacionIA.js';

/* Qué configuración inicial propone una planilla que la Prestadora ya tiene.
   ==========================================================================

   POR QUÉ EXISTE. La guía de primeros pasos le pide a una Prestadora nueva ocho cosas, y casi
   todas ya están escritas en la planilla con la que venía trabajando. Esto lee esa planilla
   —con la misma lectura que ya usa la importación, no una nueva— y contesta qué traería.

   Y CONTESTA ALGO MÁS, QUE ES EL MOTIVO REAL. La importación no crea zonas de cobertura ni
   tipos de Asistente: una zona que la planilla nombra y la Prestadora no configuró entra como
   texto suelto en la ficha de la persona, y un tipo que no calza con el catálogo deja al
   Asistente sin tipo —y el tipo es lo que decide si a esa persona se le va a exigir Matrícula
   (ver `resolverTipoAsistentePorNombre`)—. Eso se descubría después, revisando de a uno. Acá se
   dice antes de importar, para que la configuración se cargue primero y el archivo entre entero.

   NO CREA NADA. Es una lectura y una comparación. Quien confirma sigue siendo la persona, en la
   pantalla de importación, que es donde están los dos frenos: revisar el mapeo y conformar el
   resultado real. */

/* Cuántos valores distintos se miran de una columna. Una planilla de Asistentes tiene un
   puñado de zonas y de tipos; un archivo con cientos de valores distintos en esas columnas ya
   no es un catálogo, es otra cosa, y listar todo eso no ayudaría a nadie a decidir. */
const TOPE_VALORES_DISTINTOS = 50;

/* Deja un texto comparable conservando los números.
   No reutiliza el normalizador de los tipos de Asistente —que borra todo lo que no sea
   letra— porque un código de zona los lleva adentro: con ese normalizador, "AMBA 1" y
   "AMBA 2" serían la misma zona. */
function comparable(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/* Los valores distintos que trae una columna de la planilla, con el texto tal como vino —es
   lo que se muestra en pantalla— y comparados sin mayúsculas, tildes ni puntuación. */
function valoresDistintos(filas, mapeo, tipo, campo) {
  const esLista = CAMPOS_LISTA[tipo].has(campo);
  const vistos = new Map();

  for (const fila of filas) {
    const valor = valorDesdeFila(fila, mapeo, campo, esLista);
    const textos = esLista ? valor : valor === undefined ? [] : [valor];
    for (const texto of textos) {
      const clave = comparable(texto);
      if (!clave || vistos.has(clave)) continue;
      vistos.set(clave, String(texto).trim());
      if (vistos.size >= TOPE_VALORES_DISTINTOS) return [...vistos.values()];
    }
  }

  return [...vistos.values()];
}

/**
 * @returns {Promise<{filasTotales:number, zonasNuevas:string[], tiposNuevos:string[]}>}
 *   `zonasNuevas` y `tiposNuevos` son lo que la planilla nombra y la configuración de esa
 *   Prestadora todavía no tiene. Para una planilla de Familias las dos van vacías: ese archivo
 *   no trae configuración, trae Familias.
 */
export async function proponerConfiguracionInicial({ tipo, filas, mapeo, prestadoraId }) {
  const filasTotales = filas.length;
  if (tipo !== 'asistente') return { filasTotales, zonasNuevas: [], tiposNuevos: [] };

  const zonasDeLaPlanilla = valoresDistintos(filas, mapeo, tipo, 'zonas');
  const tiposDeLaPlanilla = valoresDistintos(filas, mapeo, tipo, 'tipo_asistente');

  // El motor entra a la base con la llave maestra: el filtro por Prestadora se escribe acá a
  // mano o no existe (celtatech/CLAUDE.md §5).
  const { data: zonas, error } = await supabase
    .from('zonas_cobertura')
    .select('codigo, nombre')
    .eq('prestadora_id', prestadoraId);
  if (error) throw new Error(error.message);

  // Una zona se reconoce por su código o por su nombre: la planilla puede traer cualquiera
  // de los dos, y las dos formas son la misma zona.
  const yaConfiguradas = new Set();
  for (const zona of zonas || []) {
    yaConfiguradas.add(comparable(zona.codigo));
    yaConfiguradas.add(comparable(zona.nombre));
  }

  const catalogo = await catalogoDeTiposAsistente(prestadoraId);

  return {
    filasTotales,
    zonasNuevas: zonasDeLaPlanilla.filter((nombre) => !yaConfiguradas.has(comparable(nombre))),
    tiposNuevos: tiposDeLaPlanilla.filter((nombre) => resolverTipoAsistenteEnCatalogo(nombre, catalogo) === null),
  };
}

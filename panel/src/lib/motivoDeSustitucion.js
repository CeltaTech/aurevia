// Cómo se llama la causa de una sustitución. La decisión —clave traducida o nombre escrito por la
// Prestadora— vive en `motivoDeCatalogo.js`; acá queda dónde están las traducciones de este
// catálogo.

import { nombreDeMotivo, nombreDeMotivoGuardado } from './motivoDeCatalogo';

export { esMotivoDeFabrica, valorGuardado } from './motivoDeCatalogo';

const PREFIJO = 'sustitucion_motivo_';

export function nombreMotivoSustitucion(motivo, t) {
  return nombreDeMotivo(motivo, t.asistentes.ausencias, PREFIJO);
}

export function nombreMotivoSustitucionGuardado(valor, t) {
  return nombreDeMotivoGuardado(valor, t.asistentes?.ausencias, PREFIJO);
}

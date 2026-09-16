// Cómo se llama un motivo de cierre y qué se guarda cuando se cierra la atención de un Paciente.
//
// La decisión —clave traducida o nombre escrito por la Prestadora— es la misma en todos los
// catálogos de motivos y vive en `motivoDeCatalogo.js`. Acá queda sólo lo que es de éste: dónde
// están sus traducciones.
//
// Está en un archivo aparte porque lo usan tres pantallas —el cierre, la lista de cierres avisados
// y la administración del catálogo—, y repetido en tres lugares se despega en el cuarto.

import { nombreDeMotivo, nombreDeMotivoGuardado } from './motivoDeCatalogo';

export { esMotivoDeFabrica, valorGuardado } from './motivoDeCatalogo';

const PREFIJO = 'cierre_servicio_motivo_';

export function nombreMotivo(motivo, t) {
  return nombreDeMotivo(motivo, t.prestaciones, PREFIJO);
}

export function nombreMotivoGuardado(valor, t) {
  return nombreDeMotivoGuardado(valor, t.prestaciones, PREFIJO);
}

// Cómo se muestra el tipo de un Asistente: qué ES —cuidador/a, enfermero/a,
// kinesiólogo/a, médico/a y los que agregue cada Prestadora—.
//
// Un tipo puede venir de dos lados y eso cambia de dónde sale su nombre:
//
//   prestadora_id vacío   → tipo general de CeltaTech. En la base guarda una
//                           clave (`enfermero`) y el nombre visible sale de los
//                           archivos de traducción, en el idioma de quien mira.
//   prestadora_id cargado → tipo que creó esa Prestadora. Guarda el nombre como
//                           dato, escrito por ella, y no se traduce.
//
// Esa distinción hace falta en las tres pantallas: el Panel, la aplicación de
// la Familia y la del Asistente. En las tres tiene que decir lo mismo, así que
// vive escrita una sola vez (`CLAUDE.md` §7, regla 12).
//
// Este archivo es el original de dos copias idénticas, una por aplicación,
// porque cada una se publica por su cuenta y no puede leer de las otras. La
// lista está en `scripts/copias_entre_apps.mjs` y la máquina las compara en
// cada subida — nunca se edita una copia a mano.

import { traducirValor } from '../i18n/valores';

export function esTipoGeneral(tipo) {
  return !tipo?.prestadora_id;
}

// El nombre para mostrar. No devuelve nunca la clave cruda: `traducirValor`
// pone un guion si falta la traducción, y avisa en desarrollo.
export function nombreTipo(tipo, t) {
  if (!tipo) return '—';
  if (esTipoGeneral(tipo)) return traducirValor(t.tipos_asistente, `tipo_${tipo.clave}`);
  return tipo.nombre || '—';
}

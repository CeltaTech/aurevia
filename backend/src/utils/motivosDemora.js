// La lista corta de motivos con los que el Asistente avisa que va demorado (pendiente #101).
//
// Son códigos fijos, no un catálogo de la Prestadora: lo que el Asistente lee sale de i18n, en
// los tres idiomas. Un catálogo por Prestadora acá no serviría, porque su nombre es texto libre
// y el texto libre no se traduce; y este aviso lo da alguien apurado, en la calle, en el idioma
// en que tenga el teléfono.
//
// EXISTE DOS VECES porque la pantalla que los ofrece y el motor que los valida se despliegan por
// separado y no pueden importarse entre sí. El original es `pwa-asistentes/src/lib/motivosDemora.js`
// y la copia del motor la mantiene
// `scripts/sincronizar_copias.mjs`, y `scripts/verificar_identidad.mjs` corta la construcción si
// alguna de las dos se despegó. Nunca se edita la copia a mano.
//
// EL ORDEN ES EL DE LA PANTALLA. Primero los dos del viaje, que son los más frecuentes; después
// los dos que pasan antes de salir; y `otro` al final, que es el que queda cuando ninguno de los
// anteriores describe lo que pasó.
//
// SON MOTIVOS, NO EXCUSAS NI CULPAS. Lo que se guarda es lo que la persona eligió decir, y así se
// muestra: «motivo: transporte». Quien saca una conclusión de eso es el Coordinador.
export const MOTIVOS_DEMORA = [
  'transporte',
  'transito',
  'salud',
  'imprevisto_familiar',
  'otro',
];

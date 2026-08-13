// Qué interruptor de la Prestadora decide cada pantalla ENTERA de esta aplicación.
//
// Está escrito una sola vez porque la misma decisión se toma en dos lugares distintos: el
// botón que lleva a la pantalla (`pages/PacienteDetalle.jsx`, `pages/AsistenteAsignado.jsx`)
// y la ruta que la abre (`App.jsx`). Con la clave copiada en los dos alcanzaría con
// olvidarse de uno para que la pantalla siguiera entrando escribiendo la dirección a mano,
// que es justamente lo que un menú escondido no resuelve (CLAUDE.md §7 regla 12).
//
// Acá van solamente las pantallas enteras. Los bloques que se apagan adentro de una pantalla
// —los signos vitales del reporte, el mapa en vivo, las calificaciones— se preguntan en el
// único lugar donde se dibujan, así que no necesitan un nombre acá.
export const INTERRUPTOR_DE_LA_PANTALLA = {
  alertas: 'familia_alertas_de_la_revision',
  escanearAsistente: 'familia_verifica_con_codigo',
  suscripcion: 'familia_pagos_y_suscripcion',
  medicacion: 'familia_medicacion_del_paciente',
};

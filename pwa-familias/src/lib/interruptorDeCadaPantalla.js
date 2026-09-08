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

// Qué acceso del círculo familiar decide cada pantalla. Es el mismo mapa que el de arriba, pero
// de la otra decisión, y las dos tienen que decir que sí para que la pantalla se dibuje.
//
// SON DOS DECISIONES DISTINTAS Y NO SE MEZCLAN. El de arriba es lo que la Prestadora ofrece en
// toda su aplicación: si apagó la medicación, no la ve ninguna Familia suya. Éste es lo que el
// titular de la cuenta le pidió a la Prestadora para cada persona anotada en su círculo: si le
// negó los reportes a un hermano, ese hermano no los ve, aunque la Prestadora los ofrezca.
//
// El titular ve todo, siempre: el motor le contesta las once claves en verdadero, así que no hay
// ningún caso especial escrito acá.
//
// Hay más pantallas acá que arriba porque hay cosas que la Prestadora no puede apagar —los
// reportes, la agenda de guardias— y el titular sí le puede negar a alguien de su círculo.
//
// Y como allá, acá van solamente las pantallas enteras. Lo que se apaga adentro de una pantalla
// —el mapa en vivo, el botón de calificar, el de pedir medicación— se pregunta en el único lugar
// donde se dibuja.
export const ACCESO_DEL_CIRCULO_DE_LA_PANTALLA = {
  alertas: 'circulo_alertas',
  escanearAsistente: 'circulo_verifica_con_codigo',
  suscripcion: 'circulo_dinero',
  medicacion: 'circulo_medicacion',
  reportes: 'circulo_reportes',
  guardias: 'circulo_guardias',
};

/**
 * Si esta pantalla se dibuja o no. Junta las dos decisiones en un solo lugar, que es lo mismo que
 * ya hacían los dos mapas por separado: el botón que lleva a la pantalla y la ruta que la abre
 * tienen que contestar igual, o queda un botón que rebota.
 *
 * Una pantalla que no está en un mapa no está restringida por esa decisión. Eso no es fallar
 * abierto: es que ahí no hay nada declarado que restringir. Lo que sí está declarado se pregunta
 * siempre, y quien no lo tiene no pasa.
 *
 * `seVe` viene de `useSeVe()` y `puedeVer` de `useCirculo()`. Se reciben como argumento porque
 * esto es una regla, no un componente: así se prueba sola y no arrastra ningún contexto.
 */
export function pantallaPermitida(pantalla, seVe, puedeVer) {
  const interruptor = INTERRUPTOR_DE_LA_PANTALLA[pantalla];
  const acceso = ACCESO_DEL_CIRCULO_DE_LA_PANTALLA[pantalla];

  if (interruptor && !seVe(interruptor)) return false;
  if (acceso && !puedeVer(acceso)) return false;
  return true;
}

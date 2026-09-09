// La lista corta de motivos con los que el Asistente entra sin comprobar (pendiente #113).
//
// Son códigos fijos, no un catálogo de la Prestadora: lo que el Asistente lee sale de i18n,
// igual que `falta_reporte` o `continuidad`. Por eso están escritos y no salen de la base.
//
// EXISTE DOS VECES porque la pantalla que los ofrece y el motor que los valida se despliegan por
// separado y no pueden importarse entre sí. Éste es el original; la copia del motor la mantiene
// `scripts/sincronizar_copias.mjs`, y `scripts/verificar_identidad.mjs` corta la construcción si
// alguna de las dos se despegó. Nunca se edita la copia a mano.
//
// EL ORDEN ES EL DE LA PANTALLA. Primero los dos que cuentan que no hubo con quién hacer el pase,
// después los dos que cuentan que el teléfono no pudo, y `otro` al final, que es el que queda
// cuando ninguno de los anteriores describe lo que pasó.
export const MOTIVOS_SIN_COMPROBAR = [
  'nadie_para_mostrar',
  'prestadora_no_responde',
  'sin_camara',
  'sin_conexion',
  'otro',
];

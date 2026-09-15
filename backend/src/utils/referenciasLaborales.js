/* Las referencias laborales de un Asistente, y cuándo alcanzan.
   ==========================================================================

   QUÉ SON. El formulario de postulación pide hasta cinco referencias laborales
   (`docs/PRD_03_Reclutamiento.md`), con nombre y teléfono. Quedan guardadas adentro de la
   postulación como un documento que se lee entero, y eso alcanza para recibirlas: no alcanza para
   trabajarlas. Al incorporar al Asistente se copian a una fila cada una, y ahí sí se puede llamar
   a cada persona y dejar constancia de qué contestó.

   POR QUÉ NO CUELGAN DE UNA ETAPA. Por lo mismo que las dos fotos de identidad: cada Prestadora
   define las etapas de su propio proceso y elige sus claves, así que no hay ninguna clave que el
   código pueda nombrar. Las referencias son de la persona, no de una etapa.

   Y POR QUÉ EL MÍNIMO NO BLOQUEA NADA. El producto avisa, no prohíbe (`CLAUDE.md` §7). Que falten
   referencias verificadas se ve en la pantalla; quién puede incorporarse igual lo decide la
   Prestadora, que es la que responde por esa persona.

   ESTE ARCHIVO SE COPIA AL MOTOR (`scripts/copias_entre_apps.mjs`) y no importa nada. La pantalla
   necesita saber qué resultados ofrecer y si se llegó al mínimo; el motor, qué resultados acepta.
   Escrito de los dos lados, alcanza una letra de diferencia para que la pantalla ofrezca un
   resultado que el motor rechaza. */

/* Los cuatro resultados posibles de haber llamado a una referencia, nombrados de a uno: son a la
   vez lo que se guarda en la base y lo que la pantalla le manda al motor. Se nombran por lo que
   son y no se renombran (`CLAUDE.md` §8). */
export const RESULTADO_PENDIENTE = 'pendiente';
export const RESULTADO_VERIFICADA = 'verificada';
export const RESULTADO_NO_RESPONDE = 'no_responde';
export const RESULTADO_RECHAZADA = 'rechazada';

export const RESULTADOS_DE_REFERENCIA = [
  RESULTADO_PENDIENTE,
  RESULTADO_VERIFICADA,
  RESULTADO_NO_RESPONDE,
  RESULTADO_RECHAZADA,
];

/** ¿Este resultado es uno de los cuatro? Falla cerrado: lo que no está en la lista, no entra. */
export function esResultadoDeReferencia(resultado) {
  return RESULTADOS_DE_REFERENCIA.includes(resultado);
}

/* Cuántas referencias admite la postulación, que es de donde salen. No se puede exigir verificar
   más de las que se pueden cargar, así que este número es también el tope del mínimo
   configurable. */
export const TOPE_DE_REFERENCIAS = 5;

/** Cuántas de estas referencias quedaron efectivamente verificadas. */
export function contarVerificadas(referencias) {
  if (!Array.isArray(referencias)) return 0;
  return referencias.filter((una) => una?.resultado === RESULTADO_VERIFICADA).length;
}

/**
 * Cómo está esta persona respecto de lo que su Prestadora espera.
 *
 * `minimo` sale de la configuración de la Prestadora, nunca de un número escrito acá: cuántas
 * referencias hacen falta lo decide cada una. Si no hay configuración —o el mínimo es cero— no
 * hay nada que esperar, y entonces no hay nada que avisar.
 *
 * Falla cerrado en la única dirección que importa: con datos que no se pudieron resolver, el
 * resultado es «todavía no», no «ya está» (`CLAUDE.md` §5).
 */
export function estadoDeLasReferencias(referencias, minimo) {
  const verificadas = contarVerificadas(referencias);
  const exigidas = Number.isInteger(minimo) && minimo > 0 ? minimo : 0;
  return {
    verificadas,
    exigidas,
    faltan: Math.max(exigidas - verificadas, 0),
    alcanza: verificadas >= exigidas,
    seExigenReferencias: exigidas > 0,
  };
}

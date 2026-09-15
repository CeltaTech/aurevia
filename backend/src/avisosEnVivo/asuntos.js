/* De qué avisa el canal en vivo. El original vive acá y el Panel tiene una copia idéntica.
   ==========================================================================

   ESTÁ APARTE DEL CANAL PORQUE LO NECESITAN LOS DOS LADOS. El motor empuja uno de estos nombres y
   el Panel se suscribe a uno de estos nombres; escrito en cada lado por separado, un nombre mal
   tipeado no rompe nada y deja una pantalla que no se actualiza nunca. Las dos carpetas se
   despliegan por su cuenta y no pueden importarse entre sí, así que el punto único de verdad es
   este archivo y una copia que se mantiene igual por máquina: el grupo está anotado en
   `scripts/copias_entre_apps.mjs` y `scripts/verificar_identidad.mjs` corta la construcción si
   se despegan.

   POR EL CANAL NO VIAJA NINGÚN DATO: el aviso dice qué cambió, nunca qué quedó. Quien lo recibe
   vuelve a pedir lo que necesita por la ruta de siempre, que comprueba la sesión y filtra por la
   Organización. */

export const ASUNTOS = {
  /** Cambió la lista de pedidos de código esperando que la Prestadora los resuelva. */
  PEDIDOS_DE_CODIGO: 'pedidos_de_codigo',
};

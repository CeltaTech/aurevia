import { supabase } from '../db/connection.js';

/* El candado de «esta modalidad de negocio está encendida en esta Prestadora».
   ==========================================================================

   POR QUÉ EXISTE. Hasta ahora las pantallas y las rutas de Marketplace se abrían por rol y
   nada más. El menú del Panel sí escondía sus enlaces cuando la Prestadora no tenía la
   modalidad encendida (`panel/src/components/layout/Layout.jsx`), pero esconder un enlace no
   es un candado: escribiendo la dirección a mano se entraba igual, y el motor contestaba
   como si la modalidad estuviera encendida. Una Prestadora que trabaja solamente en
   prestación directa llegaba así a las pasarelas de cobro, a las suscripciones y a las
   calificaciones del Marketplace.

   QUIÉN MANDA. Éste. Lo del Panel es para no mostrar lo que no corresponde; lo que de verdad
   niega es esto, porque cualquiera puede llamar a la dirección sin pasar por la pantalla.

   DE DÓNDE SALE LA RESPUESTA. De la función `prestadora_tiene_modalidad_activa`, que ya
   existía en la base y no llamaba nadie. Es la misma fila que lee la Configuración para
   pintar el casillero y la misma que mira la base cuando frena una asignación de guardia por
   modalidad, así que las tres respuestas no pueden discrepar.

   FALLA CERRADO (CLAUDE.md §5). Sin Organización activa, con un error de la base o con
   cualquier respuesta que no sea exactamente `true`, se niega. No se compara contra un valor
   vacío ni se deja que un `undefined` decida: la única forma de pasar es que la base conteste
   que sí.

   Se usa así, siempre después de `requiereRolPanel` —que es quien deja puesto
   `req.usuarioPanel`— y después del corte por Organización activa:

     router.use(requiereRolPanel);
     router.use(exigirOrganizacionActiva);
     router.use(exigirModalidad('marketplace'));

   El texto del error no es el que lee la persona: la frase vive en las traducciones, en los
   tres idiomas, y se busca por el `motivo` (`panel/src/lib/errores.js`). */

/** El código con el que el Panel encuentra la frase traducida. */
export const MOTIVO_MODALIDAD_NO_ACTIVA = 'modalidad_no_activa';

export function exigirModalidad(modalidad) {
  return async function soloConLaModalidadActiva(req, res, next) {
    const prestadoraId = req.usuarioPanel?.prestadoraId;
    if (!prestadoraId) return negar(res);

    const { data, error } = await supabase.rpc('prestadora_tiene_modalidad_activa', {
      p_prestadora_id: prestadoraId,
      p_modalidad: modalidad,
    });

    if (error) {
      // Que la comprobación falle no puede quedar en silencio: sin este registro, un problema
      // de la base se ve desde afuera igual que una modalidad apagada. El identificador de la
      // Prestadora no entra acá (CLAUDE.md §6).
      console.error(`No se pudo comprobar la modalidad ${modalidad}:`, error.message);
      return negar(res);
    }

    if (data !== true) return negar(res);

    next();
  };
}

function negar(res) {
  return res.status(403).json({
    error: 'La Prestadora no tiene esta modalidad activa',
    motivo: MOTIVO_MODALIDAD_NO_ACTIVA,
  });
}

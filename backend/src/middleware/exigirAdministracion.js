import { esAdminOSuperior } from '../utils/roles.js';

/* El candado de "esto es de la administración de la Prestadora".
   ==========================================================================

   Hasta el 2026-09-04 este mismo control estaba escrito cinco veces, una por ruta, y con
   tres nombres distintos —dos `requiereAdminOSuperior`, un `requiereAdmin`, un
   `soloAdministracion`—. Buscar cualquiera de esos nombres devolvía varios resultados que
   parecían la misma función y no lo eran: la de marketplace dejaba pasar al Coordinador y
   las otras no.

   Ahora quién entra sale de un solo lugar (utils/roles.js, copia de panel/src/lib/roles.js)
   y el control se escribe una vez, acá. Lo único que cambia de una ruta a otra es el texto
   del error, que se pasa como argumento: no es lo mismo negar la configuración que negar
   una acción sobre remuneraciones, y quien lee la respuesta tiene que entender qué le
   negaron. Lo que no puede diferir es quién entra.

   Se usa así:

     const soloAdministracion = exigirAdministracion('Solo Admin puede crear cuentas');
     router.post('/', requiereRolPanel, soloAdministracion, async (req, res) => { ... });

   Va siempre DESPUÉS de requiereRolPanel, que es quien deja `req.usuarioPanel` puesto. Sin
   él, `req.usuarioPanel?.rol` da `undefined` y la respuesta es negar (CLAUDE.md §5, «todo
   control de acceso falla cerrado»). */
export function exigirAdministracion(mensaje) {
  return function soloAdministracion(req, res, next) {
    if (!esAdminOSuperior(req.usuarioPanel?.rol)) {
      return res.status(403).json({ error: mensaje });
    }
    next();
  };
}

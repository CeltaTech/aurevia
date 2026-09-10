import { esAdminOSuperior, esAdminDePrestadora } from '../utils/roles.js';

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

/* El candado más angosto: esto es de la Prestadora y de nadie más.
   ==========================================================================

   El de arriba deja pasar a Superadmin, y está bien que lo haga: Superadmin es quien da
   soporte y necesita ver y arreglar la configuración de una Prestadora. Pero hay un puñado de
   cosas donde no corresponde, y son **los secretos de la Prestadora**: la clave con la que
   ella habla con un tercero. Superadmin es un rol técnico de CeltaTech, y CeltaTech no tiene
   por qué poder leer ni reemplazar esa clave. La sesión de soporte técnico tampoco lo
   habilita: esa sesión existe para mirar los datos de una Organización por vez y queda
   auditada, no para alcanzar sus credenciales.

   Se usa igual que el otro, y también va DESPUÉS de requiereRolPanel:

     const soloAdminDePrestadora = exigirAdminDePrestadora('Solo Admin puede ver esta clave');
     router.get('/whatsapp', soloAdminDePrestadora, async (req, res) => { ... });

   Cuando la ruta ya está detrás de `exigirAdministracion` a nivel de router, éste se agrega
   encima en la ruta puntual: el de afuera dice «esto es de la administración» y el de adentro
   «y además, de esta parte Superadmin queda afuera». Sumar candados nunca abre nada, y así el
   resto de las rutas del router no cambia de comportamiento.

   Quién es quién sale del mismo punto único de verdad que el resto
   (utils/roles.js, copia de panel/src/lib/roles.js), no de comparar contra
   `'admin_prestadora'` acá adentro. Ante un rol ausente o desconocido, niega: `undefined`
   no es `'admin_prestadora'` (CLAUDE.md §5, «todo control de acceso falla cerrado»). */
export function exigirAdminDePrestadora(mensaje) {
  return function soloAdminDePrestadora(req, res, next) {
    if (!esAdminDePrestadora(req.usuarioPanel?.rol)) {
      return res.status(403).json({ error: mensaje });
    }
    next();
  };
}

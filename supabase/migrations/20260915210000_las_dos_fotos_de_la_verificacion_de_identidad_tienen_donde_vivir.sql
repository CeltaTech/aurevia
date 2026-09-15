--
-- Las dos fotos de la verificación de identidad tienen dónde vivir
--
-- La etapa de verificación de identidad del Proceso de Incorporación de Asistentes compara la
-- foto del documento con la foto de la persona (`docs/PRD_03_Reclutamiento.md`). No había ningún
-- lado donde guardar esas dos fotos: quien revisaba las recibía por fuera del producto —por
-- correo, por mensaje— y marcaba la etapa a mano. Acá está dónde.
--
-- EL DEPÓSITO ES PRIVADO Y NO LLEVA POLÍTICAS, A PROPÓSITO, igual que `certificados-medicos`,
-- `autorizaciones-monitoreo` y `documentos-cese`. Adentro hay imágenes de documentos de
-- identidad, que son de lo más sensible que guarda el producto: con la cara y el número alcanza
-- para hacerse pasar por esa persona en otro lado. Nadie lo alcanza con su propio pase. Lo
-- escribe y lo lee el motor con la llave maestra y dirección firmada de un minuto, después de
-- comprobar que el Asistente es de la Prestadora de quien pide
-- (`backend/src/routes/panelVerificacionIdentidad.js`). Con la protección por fila encendida y
-- ninguna política que lo nombre, la base lo niega sola por cualquier otro camino: falla cerrado,
-- que es como tiene que fallar.
--
-- LA RUTA EMPIEZA POR LA PRESTADORA —`<prestadora>/<asistente>/<tipo>`—, como la de todos los
-- demás depósitos, y no lleva adentro el nombre de nadie ni su documento. Va sin extensión: la
-- ruta se arma con esos tres datos cada vez que hay que buscar una foto, así que tiene que dar
-- siempre lo mismo, y el formato viaja en el tipo de contenido. Los tipos son dos y están
-- escritos una sola vez, en `panel/src/lib/fotosDeIdentidad.js`.
--
-- LO QUE ESTA MIGRACIÓN NO TRAE. Comparar las dos caras sola, que es lo que el documento fuente
-- describe como «comparación por IA», no se construye todavía: son datos biométricos y el
-- producto no tiene documento legal de protección de datos personales del que sacar el aviso
-- —«si el país no tiene documento, no hay aviso» (`celtatech/CLAUDE.md` §7)—, y además no hay
-- proveedor elegido (`docs/SECURITY.md`, decisiones de seguridad pendientes). Guardar las dos
-- fotos para que una persona las mire no es ninguna de las dos cosas, y es lo que hoy falta.
--

INSERT INTO storage.buckets (id, name, public)
VALUES ('fotos-identidad', 'fotos-identidad', false)
ON CONFLICT (id) DO UPDATE SET public = false;

NOTIFY pgrst, 'reload schema';

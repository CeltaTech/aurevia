-- Se deshace la correspondencia con el cliente del otro software.
-- ==========================================================================
--
-- POR QUÉ. Las dos tablas que esta migración borra nacieron de un paso que nadie pidió: lo
-- escribí yo en el plan y lo construí como si fuera una decisión tomada. El Desarrollador lo
-- retiró, así que la base tiene que volver a como estaba.
--
-- POR QUÉ NO SE BORRA EL ARCHIVO DE LA MIGRACIÓN ANTERIOR. Porque ya corrió, acá y en la nube.
-- Una migración aplicada no se edita y no se saca: se corrige con otra adelante, que es ésta. Si
-- se borrara el archivo, una base reconstruida desde cero no tendría estas tablas y la de
-- producción sí, y las dos dejarían de dar lo mismo.
--
-- NO SE PIERDE NINGÚN DATO. Las dos tablas se crearon hoy y nunca las usó nadie: no hay ninguna
-- Prestadora trabajando, así que no hay ni una referencia anotada.

BEGIN;

DROP TRIGGER IF EXISTS trg_auditoria_soporte ON public.clientes_externos_de_familias;
DROP TRIGGER IF EXISTS trg_prestadora_del_cliente_externo ON public.clientes_externos_de_familias;

DROP TABLE IF EXISTS public.clientes_externos_de_familias;
DROP TABLE IF EXISTS public.catalogo_conexiones_externas;

DROP FUNCTION IF EXISTS interno.prestadora_del_cliente_externo();

COMMIT;

NOTIFY pgrst, 'reload schema';

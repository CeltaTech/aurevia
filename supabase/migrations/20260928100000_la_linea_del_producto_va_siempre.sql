-- La línea del producto al pie va siempre, y el producto deja de preguntar qué contrató nadie.
-- ============================================================================================
--
-- QUÉ CAMBIA. La línea "con la tecnología de Careonys" que ven la Familia y el Asistente al pie
-- se muestra siempre. Antes se consultaba si esa Prestadora tenía contratada la función que la
-- apagaba; esa consulta se elimina, junto con toda la maquinaria que la sostenía.
--
-- POR QUÉ. Es el crédito de quién hizo el software, no una función que se venda: algo tiene que
-- decir ahí. Y quien no contrató el producto no tiene acceso a estas pantallas, así que no hay
-- ningún caso que atender.
--
-- Y ADEMÁS, ES LA REGLA DE LA EMPRESA. `celtatech/CLAUDE.md` §2: el producto no restringe por
-- razones comerciales. Quién tiene qué es de CeltaTech. Ésta era la única puerta viva por la que
-- Careonys preguntaba qué había contratado un cliente.
--
-- QUÉ SE BORRA, Y QUÉ SE PIERDE CON ESO. Las dos tablas de módulos contratados no las lee ni las
-- escribe ninguna pantalla ni ninguna ruta del motor: lo único que las consultaba era la función
-- que se va. Lo que se pierde son las filas que digan qué módulo tiene contratada cada
-- Prestadora, que es un dato comercial de CeltaTech y no de este producto.

DROP FUNCTION IF EXISTS "public"."prestadora_oculta_marca_producto"("p_prestadora_id" "uuid");

DROP TABLE IF EXISTS "public"."prestadora_modulos";
DROP TABLE IF EXISTS "public"."catalogo_modulos";

NOTIFY pgrst, 'reload schema';

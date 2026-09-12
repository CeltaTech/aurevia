-- El consumo de IA se mide, el importe es de CeltaTech.
-- ==========================================================================
--
-- `uso_ia` cuenta cuántos tokens de inteligencia artificial gastó cada Prestadora. Eso se queda:
-- es consumo del producto y el producto tiene que saberlo.
--
-- Lo que se va es el dinero. `precios_ia_modelo` guardaba cuánto sale un millón de tokens de cada
-- modelo, `cambios_precio_ia_pendientes` era la bandeja de la vigilancia mensual de los precios
-- del proveedor, y `uso_ia.costo_usd` convertía el conteo en un importe en dólares. Ninguna de las
-- tres es del producto: el producto declara sus capacidades y mide su consumo, y cuánto vale ese
-- consumo, cómo se reparte y a quién se le cobra es de CeltaTech y vive en su panel
-- (`celtatech/CLAUDE.md` §2).
--
-- El daño no era teórico. El precio quedaba escrito de los dos lados, con dos respuestas posibles
-- para la misma pregunta; y como el registro del consumo no se hacía si no había precio cargado,
-- una configuración comercial ausente dejaba al producto sin medir nada. Por eso hoy las tres
-- tablas están vacías.
--
-- Nada se pierde: las tres tablas están sin una sola fila, y el código que las usaba está guardado
-- entero en el estante de la empresa, en `Codigos-utiles/vigilancia-del-precio-de-la-ia/`.

ALTER TABLE public.uso_ia DROP COLUMN IF EXISTS costo_usd;

DROP TABLE IF EXISTS public.cambios_precio_ia_pendientes;
DROP TABLE IF EXISTS public.precios_ia_modelo;

NOTIFY pgrst, 'reload schema';

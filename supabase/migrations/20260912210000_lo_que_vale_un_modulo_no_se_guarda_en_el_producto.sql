-- Lo que vale un módulo no se guarda en el producto.
-- ==========================================================================
--
-- `catalogo_modulos` dice qué sabe hacer Careonys: una fila por capacidad, con su clave y su
-- nombre. Dos de sus columnas decían además cuánto sale contratarla y en qué moneda, y eso es
-- concepto comercial adentro del producto, que es justo lo que la regla fundamental de CeltaTech
-- no admite: el producto declara sus capacidades y las trata como texto opaco; quién tiene qué y
-- cuánto paga por ello es de CeltaTech y vive en su panel.
--
-- El daño no es teórico. Con el precio acá, cada cambio de catálogo comercial sería una migración
-- del producto, y el mismo precio terminaría escrito de los dos lados, con dos respuestas posibles
-- para la misma pregunta.
--
-- Ninguna pantalla, ninguna ruta del motor y ninguna vista leen estas dos columnas, y la única
-- fila del catálogo las tiene vacías, así que sacarlas no pierde ningún dato.

ALTER TABLE public.catalogo_modulos
  DROP COLUMN IF EXISTS precio_addon,
  DROP COLUMN IF EXISTS moneda_addon;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- La marca que ven la Familia y el Asistente es la de su Prestadora.
--
-- QUÉ HACE
-- Tres cosas, chicas cada una. Primero, le da a la Prestadora un lugar donde
-- guardar su logo. Segundo, crea el depósito de archivos donde ese logo vive,
-- con sus reglas de quién puede subirlo. Tercero, anota en el catálogo la
-- función paga que apaga la línea del producto al pie de la pantalla.
--
-- POR QUÉ
-- Una Familia contrató a la Prestadora, no a CeltaTech, y lo más probable es
-- que ni sepa que Careonys existe. Un Asistente trabaja para la Prestadora.
-- Para los dos, la marca de arriba tiene que ser la de la empresa con la que
-- firmaron. La del producto queda en una línea discreta al pie, "con la
-- tecnología de Careonys". Es el modelo de co-branding que decidió el
-- Desarrollador el 2026-07-27 y que está escrito en `CLAUDE.md` §7, regla 1.
--
-- POR QUÉ SOLO EL LOGO Y NO LOS COLORES
-- Porque los colores ya se descartaron: la paleta y la tipografía son del
-- producto y no se cambian por Prestadora. Lo que cambia es el nombre —que ya
-- existe, es `nombre_fantasia`— y el logo, que es lo único que faltaba.
--
-- EL LOGO ES OPCIONAL A PROPÓSITO
-- Una Prestadora que todavía no subió su logo no queda con la pantalla rota:
-- se le muestra su nombre escrito, que es lo que ya tiene. El logo mejora la
-- pantalla, no la habilita.
--
-- POR QUÉ EL DEPÓSITO ES PÚBLICO
-- Un logo es lo contrario de un dato sensible: está en la puerta del local y
-- en la página web de la empresa, y su razón de existir es que lo vea todo el
-- mundo. Hacerlo privado obligaría a pedir un permiso firmado cada vez que se
-- dibuja el encabezado, para proteger algo que nadie quiere proteger. Lo que
-- sí se cuida es **quién sube**: eso está cerrado abajo, y con llave.
-- Cuidado al copiar esta decisión: vale para logos y no vale para nada más.
-- El día que haya que guardar un certificado, una foto de un Paciente o un
-- documento de un Asistente, va en un depósito privado, no en este.
--
-- CÓMO SE ORDENAN LOS ARCHIVOS ADENTRO
-- Cada Prestadora tiene su carpeta y la carpeta se llama como su identificador:
--
--     marca-prestadoras/<id de la Prestadora>/logo.png
--
-- No es una convención de nombres bonita: es de lo que se agarran las reglas
-- de abajo para saber de quién es cada archivo. Si un archivo se guarda fuera
-- de la carpeta que le toca, no se puede subir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. El campo
-- ----------------------------------------------------------------------------

ALTER TABLE public.prestadoras
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN public.prestadoras.logo_url IS
  'Dirección del logo de la Prestadora, la marca que ven la Familia y el '
  'Asistente. Vacío significa que todavía no lo subió: en ese caso las '
  'pantallas muestran nombre_fantasia escrito. Los archivos viven en el '
  'depósito marca-prestadoras, en la carpeta de esa Prestadora.';

-- ----------------------------------------------------------------------------
-- 2. El depósito de archivos
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('marca-prestadoras', 'marca-prestadoras', true)
ON CONFLICT (id) DO NOTHING;

-- Leer: cualquiera. Es un logo (ver el encabezado).
DROP POLICY IF EXISTS "marca_prestadoras_lectura_publica" ON storage.objects;
CREATE POLICY "marca_prestadoras_lectura_publica"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'marca-prestadoras');

-- Escribir: solo dentro de la carpeta propia.
--
-- `storage.foldername(name)` parte la ruta del archivo en pedazos, y el
-- primero es la carpeta. Se compara contra `current_tenant()`, que es la misma
-- función que decide de qué Prestadora es cada sesión en todo el resto del
-- sistema (`CLAUDE.md` §7, regla 12: la decisión se escribe una sola vez).
-- Así una Prestadora no puede pisar el logo de otra ni por accidente ni a
-- propósito, aunque arme el pedido a mano.
--
-- Las tres operaciones que modifican van juntas y con la misma condición:
-- subir, reemplazar y borrar. Dejar una afuera sería dejar la puerta abierta.
DROP POLICY IF EXISTS "marca_prestadoras_sube_su_propio_logo" ON storage.objects;
CREATE POLICY "marca_prestadoras_sube_su_propio_logo"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'marca-prestadoras'
    AND (storage.foldername(name))[1] = public.current_tenant()::text
  );

DROP POLICY IF EXISTS "marca_prestadoras_reemplaza_su_propio_logo" ON storage.objects;
CREATE POLICY "marca_prestadoras_reemplaza_su_propio_logo"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'marca-prestadoras'
    AND (storage.foldername(name))[1] = public.current_tenant()::text
  )
  WITH CHECK (
    bucket_id = 'marca-prestadoras'
    AND (storage.foldername(name))[1] = public.current_tenant()::text
  );

DROP POLICY IF EXISTS "marca_prestadoras_borra_su_propio_logo" ON storage.objects;
CREATE POLICY "marca_prestadoras_borra_su_propio_logo"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'marca-prestadoras'
    AND (storage.foldername(name))[1] = public.current_tenant()::text
  );

-- ----------------------------------------------------------------------------
-- 3. La función paga que apaga la línea del producto
-- ----------------------------------------------------------------------------
--
-- La línea "con la tecnología de Careonys" se muestra siempre, salvo que la
-- Prestadora tenga contratada la función que la apaga. El default es que se
-- vea: si el catálogo no dice nada, no está contratada.
--
-- La clave se llama `aurevia.marca.personalizada` y **no se renombra** aunque
-- el producto ya no se llame Aurevia. Es un identificador guardado, de los que
-- manda nombrar por función y no tocar más (`CLAUDE.md` §7, regla 13): el día
-- que CeltaTech le venda esta función a una Prestadora, la fila que quede
-- escrita en su cuenta va a decir esta clave, y "limpiarla" para que haga
-- juego con el nombre nuevo es exactamente cómo se rompen las cosas.

INSERT INTO public.catalogo_modulos (key, nombre, descripcion)
VALUES (
  'aurevia.marca.personalizada',
  'Marca sin la línea del producto',
  'Apaga la línea del producto al pie de las pantallas que ven la Familia y el '
  'Asistente. Sin esta función contratada, la línea se muestra, que es el '
  'comportamiento por defecto.'
)
ON CONFLICT (key) DO NOTHING;

-- Un solo lugar decide si esa línea se ve, y es este.
--
-- Hoy lo pregunta el backend, que entra con la llave maestra y podría hacer la
-- consulta suelta en cada ruta. Está escrito como función igual, por la regla
-- 12: mañana la misma pregunta la va a tener que contestar otra pantalla u
-- otra política, y la respuesta tiene que ser una sola. La condición repetida
-- en tres lados es la que después se cambia en dos.
CREATE OR REPLACE FUNCTION public.prestadora_oculta_marca_producto(p_prestadora_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM prestadora_modulos pm
    WHERE pm.prestadora_id = p_prestadora_id
      AND pm.modulo_key = 'aurevia.marca.personalizada'
      AND pm.activo
  )
$$;

COMMENT ON FUNCTION public.prestadora_oculta_marca_producto(UUID) IS
  'Devuelve verdadero solo si esa Prestadora tiene contratada la función que '
  'apaga la línea del producto al pie. Ausente = no contratada = la línea se '
  'muestra.';

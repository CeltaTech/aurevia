-- ============================================================================
-- Contenido y recursos para cuidadores familiares
--
-- QUÉ ESTABA MAL. `docs/PRD_07_Modalidad_Marketplace.md` lo nombra entre lo que la Familia sigue
-- usando después de conseguir al Asistente —«Contenido y recursos para cuidadores familiares»—, y
-- no existía en ningún lado: ni tabla, ni ruta, ni pantalla. La Familia que cuida en su casa no
-- tenía de dónde leer nada de lo que su Prestadora sabe.
--
-- QUÉ HACE. Crea `contenidos_para_familias`: la biblioteca que cada Prestadora escribe para las
-- Familias de su Organización. Un título, un texto, y opcionalmente un enlace a algo que ella ya
-- publica en otro lado. Cada pieza se publica o se guarda sin publicar, y ese interruptor lo mueve
-- ella.
--
-- POR QUÉ NO VIENE NADA DE FÁBRICA. CeltaTech no escribe contenido de cuidado: no es su oficio y
-- no responde por él. Una Prestadora nueva arranca con la biblioteca vacía, que es el estado real,
-- y no con textos de nadie firmados como si fueran suyos. De ahí también que esta tabla no tenga
-- siembra ni entre en `sembrar_configuracion_prestadora`.
--
-- POR QUÉ NO SE TRADUCE EL TEXTO. Lo que se guarda acá lo escribió una persona de la Prestadora,
-- en su idioma, para las Familias que ella atiende. Traducirlo sería reescribirlo. Lo que sí se
-- traduce es el marco de la pantalla —el título de la sección, los botones, el estado vacío—, que
-- vive en las traducciones de cada aplicación. Es la misma línea que separa `clave` de `nombre` en
-- `motivos_cierre_servicio`, con la diferencia de que acá no hay ningún texto de fábrica, así que
-- no hace falta la columna `clave`.
--
-- LO QUE NO SE HACE ACÁ. No hay archivos ni videos subidos: un depósito de archivos es esquema
-- propio, con sus políticas y su dirección firmada, y es una decisión aparte. Lo que hay es un
-- enlace opcional, obligado a viajar por `https://`. Y no hay ninguna puerta comercial adentro:
-- el producto no restringe por lo que un cliente pagó (`celtatech/CLAUDE.md` §2).
--
-- Y NO SE ATA A UNA MODALIDAD. El PRD lo nombra en marketplace porque ahí hace falta explicarlo,
-- pero una Familia de prestación directa también cuida en su casa. Poner un candado de modalidad
-- sería inventar una restricción que nadie pidió.
--
-- CÓMO SE VUELVE ATRÁS. `DROP TABLE public.contenidos_para_familias;` y borrar el renglón
-- `escribir_contenido_para_familias` de `catalogo_acciones_permisos`. Nada más depende de esto.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.contenidos_para_familias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  cuerpo text NOT NULL,
  enlace_url text,
  orden integer NOT NULL DEFAULT 0,
  publicado boolean NOT NULL DEFAULT false,
  creado_por uuid REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contenidos_para_familias_titulo_con_texto CHECK (btrim(titulo) <> ''),
  CONSTRAINT contenidos_para_familias_cuerpo_con_texto CHECK (btrim(cuerpo) <> ''),
  -- El enlace lo va a tocar alguien desde un teléfono. Que tenga que empezar por `https://` deja
  -- afuera de un saque las direcciones sin cifrar y cualquier esquema que no sea una página web.
  CONSTRAINT contenidos_para_familias_enlace_es_https CHECK (
    enlace_url IS NULL OR enlace_url ~ '^https://'
  ),
  -- La clave compuesta que necesita cualquier clave foránea que quiera apuntar acá sin perder de
  -- vista de qué Prestadora es la fila.
  CONSTRAINT contenidos_para_familias_id_prestadora UNIQUE (id, prestadora_id)
);

-- Dos piezas con el mismo título adentro de la misma Prestadora son dos piezas indistinguibles en
-- la lista de la Familia. Se rechaza sin distinguir mayúsculas, que es como lo lee una persona.
CREATE UNIQUE INDEX IF NOT EXISTS contenidos_para_familias_titulo_unico
  ON public.contenidos_para_familias (prestadora_id, lower(titulo));

-- El orden en el que la Familia los ve, que es la consulta que más se hace.
CREATE INDEX IF NOT EXISTS contenidos_para_familias_por_orden
  ON public.contenidos_para_familias (prestadora_id, publicado, orden, created_at);

COMMENT ON TABLE public.contenidos_para_familias IS
  'La biblioteca que cada Prestadora escribe para las Familias de su Organización: contenido y recursos para quien cuida en su casa. Sin siembra de fábrica y sin traducción: lo escribe la Prestadora.';
COMMENT ON COLUMN public.contenidos_para_familias.titulo IS
  'Título tal como lo escribió la Prestadora. No se traduce.';
COMMENT ON COLUMN public.contenidos_para_familias.cuerpo IS
  'Texto tal como lo escribió la Prestadora. No se traduce.';
COMMENT ON COLUMN public.contenidos_para_familias.enlace_url IS
  'Enlace opcional a material que la Prestadora ya publica en otro lado. Siempre https://. Acá no se guardan archivos.';
COMMENT ON COLUMN public.contenidos_para_familias.publicado IS
  'Si la Familia lo ve. Lo mueve la Prestadora; sin publicar, la pieza existe solamente para ella.';
COMMENT ON COLUMN public.contenidos_para_familias.orden IS
  'En qué orden se muestran. A igual número, manda la fecha de creación.';

ALTER TABLE public.contenidos_para_familias ENABLE ROW LEVEL SECURITY;

-- El Panel de la Prestadora ve su biblioteca entera, publicada o no: sin eso nadie podría revisar
-- un borrador. Quién de adentro la escribe no lo decide esta política —lo decide el permiso que
-- se agrega más abajo—, así que acá alcanza con que sea gente del Panel de esa Prestadora.
CREATE POLICY prestadora_lee_su_contenido ON public.contenidos_para_familias
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND u.rol IN ('admin_prestadora', 'coordinador', 'superadmin')
    )
  );

CREATE POLICY admin_prestadora_escribe_su_contenido ON public.contenidos_para_familias
  FOR ALL
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND u.rol = 'admin_prestadora'
    )
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND u.rol = 'admin_prestadora'
    )
  );

-- La Familia ve lo publicado de su propia Prestadora. Lo no publicado no existe para ella: un
-- borrador es un texto a medio escribir, y que se filtre es exactamente lo que el interruptor
-- viene a evitar.
CREATE POLICY familia_ve_el_contenido_publicado ON public.contenidos_para_familias
  FOR SELECT
  USING (
    publicado
    AND prestadora_id = (
      SELECT f.prestadora_id FROM public.familias f
       WHERE f.id = interno.familia_id_de_usuario(auth.uid())
    )
  );

-- El permiso de tabla no es la política: sin esto, una política perfecta bloquea en vez de
-- proteger (`celtatech/CLAUDE.md` §9).
GRANT ALL ON TABLE public.contenidos_para_familias TO anon;
GRANT ALL ON TABLE public.contenidos_para_familias TO authenticated;
GRANT ALL ON TABLE public.contenidos_para_familias TO service_role;

-- ============================================================================
-- Quién escribe la biblioteca lo decide cada Prestadora
-- ============================================================================

-- El producto no reparte el trabajo de adentro de una Prestadora: pone la acción en el catálogo y
-- cada una la configura en Configuración › Accesos. El valor de fábrica es «sólo Admin» porque
-- esto es texto que sale firmado por la Prestadora hacia todas sus Familias. Abrirlo al
-- Coordinador es un clic.
INSERT INTO public.catalogo_acciones_permisos (accion, default_solo_admin, orden)
SELECT 'escribir_contenido_para_familias', true, 11
 WHERE NOT EXISTS (
   SELECT 1 FROM public.catalogo_acciones_permisos WHERE accion = 'escribir_contenido_para_familias'
 );

-- ============================================================================
-- Que lo de arriba haya quedado como dice
-- ============================================================================

DO $comprobacion$
DECLARE
  cuantas_politicas integer;
BEGIN
  IF to_regclass('public.contenidos_para_familias') IS NULL THEN
    RAISE EXCEPTION 'No quedó creada la tabla contenidos_para_familias';
  END IF;

  SELECT count(*) INTO cuantas_politicas
    FROM pg_policy WHERE polrelid = 'public.contenidos_para_familias'::regclass;
  IF cuantas_politicas <> 3 THEN
    RAISE EXCEPTION 'contenidos_para_familias quedó con % políticas y tienen que ser 3', cuantas_politicas;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'public.contenidos_para_familias'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'contenidos_para_familias quedó sin protección por fila';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.catalogo_acciones_permisos WHERE accion = 'escribir_contenido_para_familias'
  ) THEN
    RAISE EXCEPTION 'No quedó la acción escribir_contenido_para_familias en el catálogo de permisos';
  END IF;
END
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

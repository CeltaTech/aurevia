-- ==========================================================================================
-- Las listas de opciones: un registro de dos pisos, y ninguna migración más por lista nueva
-- ==========================================================================================
--
-- QUÉ PASABA. Cada lista de opciones del producto costaba una migración propia: una tabla para
-- los motivos de cierre, otra para las causas de sustitución, otra para los finales de un turno
-- sin cubrir, otra para las etapas de incorporación. Todas con la misma forma —clave, nombre,
-- orden, activo, prestadora_id— y todas con sus políticas, sus permisos y su pantalla. Y las que
-- no llegaron a ser tabla quedaron escritas adentro de una pantalla: la disponibilidad y la
-- situación fiscal de una postulación viven hoy en el archivo de traducciones, recorridas con un
-- bucle para dibujar dos desplegables. Eso contradice dos reglas de la empresa a la vez —los
-- catálogos salen de la base, y nunca se escribe una lista de opciones adentro de una pantalla—
-- y además deja a cada Prestadora sin poder agregar la suya.
--
-- QUÉ QUEDA. Un registro genérico de dos pisos:
--
--   · El piso de abajo es lo que trae el producto: filas con `prestadora_id` nulo, iguales para
--     todas las Prestadoras, con el texto en los tres idiomas adentro de cada opción.
--   · El piso de arriba es lo que agrega cada Prestadora: filas con su `prestadora_id`, que sólo
--     ella ve y sólo ella escribe.
--
-- Una lista nueva pasa a ser una fila, no una migración. Una opción nueva de una Prestadora pasa
-- a ser una fila que carga ella, no un pedido de desarrollo.
--
-- LOS TRES IDIOMAS VAN ADENTRO DE CADA OPCIÓN, Y LA BASE RECHAZA LA QUE VENGA INCOMPLETA. Es el
-- molde que ya estrenó `reglas_de_los_mensajes.motivo`: un `jsonb` con `es-AR`, `en` y `pt-BR`,
-- y un CHECK que no deja guardar la que le falte uno. Así la traducción viaja con la opción y no
-- hay que ir a buscarla a un archivo del navegador.
--
-- LA MARCA DE QUÉ LISTAS ADMITEN OPCIONES PROPIAS. No todas pueden abrirse. La disponibilidad de
-- un postulante es de cada Prestadora y se abre; la situación fiscal no, porque se compara entre
-- Organizaciones y contra la ley de cada país, y una Prestadora que se inventara una categoría
-- dejaría de ser comparable. La marca es `admite_opciones_propias`, y quien la hace cumplir es la
-- base, no la pantalla.
--
-- LAS DOS REGLAS QUE VENÍAN ESCRITAS ADENTRO DE UNA PANTALLA. Las dos estaban resueltas en
-- Careonys Match, pero adentro del archivo de su pantalla de opciones propias, así que sólo
-- valían mientras la carga pasara por ahí. Acá salen de la pantalla y quedan donde no se pueden
-- esquivar:
--
--   1. DESDE QUÉ NÚMERO SE ORDENAN LAS OPCIONES PROPIAS. Lo que agrega la Prestadora va detrás
--      del catálogo general, no intercalado entre sus opciones. Se cuenta desde 100 y la primera
--      propia queda en 101. Acá es `interno.orden_desde_el_que_cuentan_las_opciones_propias()`,
--      una restricción que lo exige y un disparador que asigna el número solo, así que la
--      pantalla ya no lo calcula ni puede equivocarse.
--
--   2. EN QUÉ IDIOMAS SE EXIGE EL TEXTO. La regla de i18n rige el texto que escribe el producto,
--      no el que carga el cliente: a una Prestadora no se le puede pedir que traduzca a tres
--      idiomas lo que escribió para su gente. Por eso la opción general va con los tres idiomas y
--      la propia con uno solo. Acá son dos funciones —`interno.i18n_completo` e
--      `interno.i18n_minimo`— usadas por el CHECK de las dos tablas, que es el único lugar donde
--      esa diferencia está escrita.
--
-- QUÉ NO SE TOCÓ. Las tablas de catálogo que ya existen —`motivos_cierre_servicio`,
-- `motivos_sustitucion_guardia`, `finales_turno_sin_cubrir`, `opciones_postulacion`,
-- `tipos_asistente`, `zonas_cobertura` y las demás— siguen como están. Mudarlas es una tarea
-- aparte, con sus datos y sus pantallas, y mezclarla acá dejaría las dos cosas a medias. Este
-- registro es donde nacen las listas de acá en adelante, y donde entran las que hoy no tienen
-- tabla ninguna.
--
-- CÓMO SE VUELVE ATRÁS. Las dos tablas son nuevas y nada apunta a ellas: se borran y el producto
-- queda como estaba. Lo único que se pierde son las opciones que haya cargado una Prestadora.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Las dos reglas de i18n, escritas una sola vez
-- ---------------------------------------------------------------------------
--
-- Viven en `interno` porque no las llama ningún navegador: las llaman los CHECK de las dos
-- tablas. Y llevan permiso para `authenticated` porque una restricción se evalúa con los
-- permisos de quien inserta: sin eso, guardar una opción daría `42501 permission denied for
-- function` y el mensaje no hablaría de la restricción.

CREATE OR REPLACE FUNCTION interno.i18n_completo(p_texto jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
AS $$
  SELECT p_texto IS NOT NULL
     AND jsonb_typeof(p_texto) = 'object'
     AND btrim(coalesce(p_texto ->> 'es-AR', '')) <> ''
     AND btrim(coalesce(p_texto ->> 'en', '')) <> ''
     AND btrim(coalesce(p_texto ->> 'pt-BR', '')) <> '';
$$;

COMMENT ON FUNCTION interno.i18n_completo(jsonb) IS
  'El texto esta en los tres idiomas. Es lo que se le exige a lo que escribe el producto.';

CREATE OR REPLACE FUNCTION interno.i18n_minimo(p_texto jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
AS $$
  SELECT p_texto IS NOT NULL
     AND jsonb_typeof(p_texto) = 'object'
     AND btrim(coalesce(p_texto ->> 'es-AR', '')) <> '';
$$;

COMMENT ON FUNCTION interno.i18n_minimo(jsonb) IS
  'El texto esta en un idioma. Es lo que se le exige a lo que carga una Prestadora: queda como ella lo escribio.';

-- ---------------------------------------------------------------------------
-- 2. Desde qué número se ordenan las opciones propias
-- ---------------------------------------------------------------------------
--
-- Se cuenta desde acá y la primera propia queda en 101. El número no es caprichoso: deja cien
-- lugares para que el producto ordene su catálogo general y que lo que agregue la Prestadora
-- caiga detrás y no entre medio. Un solo lugar lo dice, y lo consumen la restricción, el
-- disparador y la pantalla.

CREATE OR REPLACE FUNCTION interno.orden_desde_el_que_cuentan_las_opciones_propias()
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
AS $$
  SELECT 100;
$$;

COMMENT ON FUNCTION interno.orden_desde_el_que_cuentan_las_opciones_propias() IS
  'Las opciones que agrega una Prestadora se numeran desde acá hacia arriba, para que queden detrás del catálogo general en vez de intercalarse.';

REVOKE ALL ON FUNCTION interno.i18n_completo(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION interno.i18n_minimo(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION interno.orden_desde_el_que_cuentan_las_opciones_propias() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.i18n_completo(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION interno.i18n_minimo(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION interno.orden_desde_el_que_cuentan_las_opciones_propias() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Las listas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.listas_de_opciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nulo es la lista que trae el producto, igual para todas. Con Prestadora, la que armó ella.
  prestadora_id uuid REFERENCES public.prestadoras (id) ON DELETE CASCADE,
  -- Nombre guardado: se nombra por lo que la lista es y no se renombra nunca. Es lo que cita la
  -- pantalla que pide una lista, así que cambiarlo dejaría a esa pantalla sin catálogo.
  clave text NOT NULL,
  -- El título de la lista, adentro de la lista.
  i18n jsonb NOT NULL,
  -- La marca: si esta lista admite opciones propias de una Prestadora. Falsa quiere decir que la
  -- lista es la que trae el producto y nada más, porque lo que guarda se compara entre
  -- Organizaciones o contra la ley.
  admite_opciones_propias boolean NOT NULL DEFAULT false,
  orden smallint NOT NULL DEFAULT 0,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT la_clave_de_la_lista_no_esta_vacia CHECK (length(btrim(clave)) > 0),

  -- La regla 2, escrita una sola vez: los tres idiomas a lo que trae el producto, uno solo a lo
  -- que carga una Prestadora.
  CONSTRAINT el_titulo_de_la_lista_esta_en_los_idiomas_que_le_tocan CHECK (
    CASE
      WHEN prestadora_id IS NOT NULL THEN interno.i18n_minimo(i18n)
      ELSE interno.i18n_completo(i18n)
    END
  )
);

COMMENT ON TABLE public.listas_de_opciones IS
  'Las listas de opciones del producto y las que agrega cada Prestadora. Una lista nueva es una fila, no una migracion.';
COMMENT ON COLUMN public.listas_de_opciones.prestadora_id IS
  'Nulo: la lista que trae el producto, igual para todas. Con valor: la que armo esa Prestadora.';
COMMENT ON COLUMN public.listas_de_opciones.clave IS
  'Nombre guardado. Lo cita la pantalla que pide la lista, asi que no se renombra.';
COMMENT ON COLUMN public.listas_de_opciones.admite_opciones_propias IS
  'Si esta lista admite opciones propias de una Prestadora. Falsa cuando lo que guarda se compara entre Organizaciones o contra la ley.';

-- Una clave no se repite. Van dos índices y no uno porque para Postgres dos nulos son distintos:
-- con una sola restricción sobre (prestadora_id, clave), el catálogo general podría tener la
-- misma lista dos veces sin que nada lo frenara.
CREATE UNIQUE INDEX IF NOT EXISTS una_lista_general_por_clave
  ON public.listas_de_opciones (clave) WHERE prestadora_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS una_lista_propia_por_clave_y_prestadora
  ON public.listas_de_opciones (prestadora_id, clave) WHERE prestadora_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Las opciones
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.opciones_de_lista (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid REFERENCES public.prestadoras (id) ON DELETE CASCADE,
  lista_id uuid NOT NULL REFERENCES public.listas_de_opciones (id) ON DELETE CASCADE,
  -- Lo que queda guardado en la ficha de quien eligió esta opción. No se renombra: lo que ya se
  -- eligió se guardó con esta clave.
  clave text NOT NULL,
  i18n jsonb NOT NULL,
  orden integer NOT NULL DEFAULT 0,
  -- Una opción no se borra: se apaga. Borrarla dejaría sin nombre a todo lo que ya la eligió.
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT la_clave_de_la_opcion_no_esta_vacia CHECK (length(btrim(clave)) > 0),

  CONSTRAINT el_texto_de_la_opcion_esta_en_los_idiomas_que_le_tocan CHECK (
    CASE
      WHEN prestadora_id IS NOT NULL THEN interno.i18n_minimo(i18n)
      ELSE interno.i18n_completo(i18n)
    END
  ),

  -- La regla 1, escrita una sola vez: lo que agrega la Prestadora queda detrás del catálogo
  -- general. El disparador de más abajo asigna el número solo, así que desde la pantalla esto no
  -- se puede incumplir; la restricción está para que tampoco se pueda por ninguna otra vía.
  CONSTRAINT la_opcion_propia_va_detras_del_catalogo_general CHECK (
    CASE
      WHEN prestadora_id IS NOT NULL
        THEN orden > interno.orden_desde_el_que_cuentan_las_opciones_propias()
      ELSE orden <= interno.orden_desde_el_que_cuentan_las_opciones_propias()
    END
  )
);

COMMENT ON TABLE public.opciones_de_lista IS
  'Las opciones de cada lista: las que trae el producto, con los tres idiomas, y las que agrega cada Prestadora, en el idioma en que las escribio.';
COMMENT ON COLUMN public.opciones_de_lista.clave IS
  'Lo que queda guardado en la ficha de quien eligio esta opcion. No se renombra.';
COMMENT ON COLUMN public.opciones_de_lista.orden IS
  'En que orden se ofrecen. Lo general hasta 100; lo propio de una Prestadora, desde 101.';
COMMENT ON COLUMN public.opciones_de_lista.activa IS
  'Una opcion no se borra: se apaga. Apagada deja de ofrecerse y sigue nombrando lo que ya se eligio.';

CREATE UNIQUE INDEX IF NOT EXISTS una_opcion_general_por_clave_en_su_lista
  ON public.opciones_de_lista (lista_id, clave) WHERE prestadora_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS una_opcion_propia_por_clave_en_su_lista
  ON public.opciones_de_lista (lista_id, prestadora_id, clave) WHERE prestadora_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS las_opciones_se_buscan_por_lista
  ON public.opciones_de_lista (lista_id, orden);

-- ---------------------------------------------------------------------------
-- 5. Lo que ninguna restricción puede mirar: la fila de al lado
-- ---------------------------------------------------------------------------
--
-- Una restricción sólo ve su propia fila. Cuatro cosas de este registro dependen de otra fila, y
-- por eso van en un disparador. El disparador no es `SECURITY DEFINER` a propósito: corre con los
-- permisos de quien inserta, así que lo que no alcanza a ver la persona tampoco lo ve él, y una
-- lista de otra Prestadora se comporta como una lista que no existe. Fallar cerrado.

CREATE OR REPLACE FUNCTION interno.la_opcion_no_cruza_prestadoras()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'interno'
AS $$
DECLARE
  la_lista public.listas_de_opciones%ROWTYPE;
BEGIN
  SELECT * INTO la_lista FROM public.listas_de_opciones WHERE id = NEW.lista_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La lista de opciones no existe o no es de esta Prestadora.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 1. Una opción del producto cuelga de una lista del producto. Colgarla de la lista de una
  --    Prestadora la volvería visible para las demás sin que nadie lo hubiera decidido.
  IF NEW.prestadora_id IS NULL AND la_lista.prestadora_id IS NOT NULL THEN
    RAISE EXCEPTION 'Una opción del producto no puede colgar de la lista de una Prestadora.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Una opción de una Prestadora cuelga de una lista del producto o de la suya, nunca de la
  --    de otra.
  IF NEW.prestadora_id IS NOT NULL
     AND la_lista.prestadora_id IS NOT NULL
     AND la_lista.prestadora_id <> NEW.prestadora_id THEN
    RAISE EXCEPTION 'Esa lista es de otra Prestadora.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. La marca. Una lista que no admite opciones propias es la que trae el producto y nada más.
  IF NEW.prestadora_id IS NOT NULL
     AND la_lista.prestadora_id IS NULL
     AND NOT la_lista.admite_opciones_propias THEN
    RAISE EXCEPTION 'La lista «%» no admite opciones propias de una Prestadora.', la_lista.clave
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Una Prestadora no puede repetir una clave que el producto ya trae: quedarían dos opciones
  --    distintas guardándose con el mismo valor, y lo elegido dejaría de querer decir una cosa
  --    sola.
  IF NEW.prestadora_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.opciones_de_lista o
        WHERE o.lista_id = NEW.lista_id
          AND o.prestadora_id IS NULL
          AND o.clave = NEW.clave
     ) THEN
    RAISE EXCEPTION 'La opción «%» ya viene con el producto en esa lista.', NEW.clave
      USING ERRCODE = 'P0001';
  END IF;

  -- Y el número de orden de una opción propia lo pone la base, no la pantalla: se cuenta desde el
  -- número que dice `interno.orden_desde_el_que_cuentan_las_opciones_propias()` mirando sólo las
  -- propias, así que lo nuevo cae detrás del catálogo general y detrás de lo que ella ya cargó.
  IF TG_OP = 'INSERT' AND NEW.prestadora_id IS NOT NULL AND NEW.orden = 0 THEN
    SELECT coalesce(max(o.orden), interno.orden_desde_el_que_cuentan_las_opciones_propias()) + 1
      INTO NEW.orden
      FROM public.opciones_de_lista o
     WHERE o.lista_id = NEW.lista_id
       AND o.prestadora_id = NEW.prestadora_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION interno.la_opcion_no_cruza_prestadoras() IS
  'Las cuatro cosas de una opcion que dependen de la fila de su lista, mas el numero de orden de una opcion propia.';

REVOKE ALL ON FUNCTION interno.la_opcion_no_cruza_prestadoras() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.la_opcion_no_cruza_prestadoras() TO authenticated, service_role;

DROP TRIGGER IF EXISTS la_opcion_no_cruza_prestadoras ON public.opciones_de_lista;
CREATE TRIGGER la_opcion_no_cruza_prestadoras
  BEFORE INSERT OR UPDATE ON public.opciones_de_lista
  FOR EACH ROW EXECUTE FUNCTION interno.la_opcion_no_cruza_prestadoras();

-- Y una lista propia no puede llamarse igual que una del producto: la pantalla que pide una lista
-- la pide por su clave, y con dos habría que decidir cuál gana en cada lectura.
CREATE OR REPLACE FUNCTION interno.la_lista_propia_no_pisa_a_la_del_producto()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'interno'
AS $$
BEGIN
  IF NEW.prestadora_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.listas_de_opciones l
        WHERE l.prestadora_id IS NULL
          AND l.clave = NEW.clave
     ) THEN
    RAISE EXCEPTION 'La lista «%» ya viene con el producto.', NEW.clave
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION interno.la_lista_propia_no_pisa_a_la_del_producto() IS
  'Una lista propia no puede llamarse igual que una que trae el producto.';

REVOKE ALL ON FUNCTION interno.la_lista_propia_no_pisa_a_la_del_producto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.la_lista_propia_no_pisa_a_la_del_producto() TO authenticated, service_role;

DROP TRIGGER IF EXISTS la_lista_propia_no_pisa_a_la_del_producto ON public.listas_de_opciones;
CREATE TRIGGER la_lista_propia_no_pisa_a_la_del_producto
  BEFORE INSERT OR UPDATE ON public.listas_de_opciones
  FOR EACH ROW EXECUTE FUNCTION interno.la_lista_propia_no_pisa_a_la_del_producto();

-- ---------------------------------------------------------------------------
-- 6. Quién lee y quién escribe
-- ---------------------------------------------------------------------------
--
-- Leer alcanza el catálogo del producto más lo propio de la Prestadora de la sesión; escribir,
-- sólo lo propio. La Prestadora nunca sale del pedido: la resuelve `interno.current_tenant()`
-- adentro de `interno.escribe_el_catalogo()`, que es el punto único de verdad de «el personal de
-- esta Prestadora, sobre lo suyo».
--
-- Lo que trae el producto no lo escribe nadie con sesión: entra por migración, con la llave de
-- servicio. Por eso las políticas de escritura exigen `prestadora_id IS NOT NULL`.

ALTER TABLE public.listas_de_opciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opciones_de_lista ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listas_de_opciones_las_lee_su_prestadora ON public.listas_de_opciones;
CREATE POLICY listas_de_opciones_las_lee_su_prestadora
  ON public.listas_de_opciones
  FOR SELECT TO authenticated
  USING (prestadora_id IS NULL OR interno.lee_la_configuracion(prestadora_id));

DROP POLICY IF EXISTS listas_de_opciones_las_escribe_el_personal ON public.listas_de_opciones;
CREATE POLICY listas_de_opciones_las_escribe_el_personal
  ON public.listas_de_opciones
  FOR ALL TO authenticated
  USING (prestadora_id IS NOT NULL AND interno.escribe_el_catalogo(prestadora_id))
  WITH CHECK (prestadora_id IS NOT NULL AND interno.escribe_el_catalogo(prestadora_id));

DROP POLICY IF EXISTS opciones_de_lista_las_lee_su_prestadora ON public.opciones_de_lista;
CREATE POLICY opciones_de_lista_las_lee_su_prestadora
  ON public.opciones_de_lista
  FOR SELECT TO authenticated
  USING (prestadora_id IS NULL OR interno.lee_la_configuracion(prestadora_id));

DROP POLICY IF EXISTS opciones_de_lista_las_escribe_el_personal ON public.opciones_de_lista;
CREATE POLICY opciones_de_lista_las_escribe_el_personal
  ON public.opciones_de_lista
  FOR ALL TO authenticated
  USING (prestadora_id IS NOT NULL AND interno.escribe_el_catalogo(prestadora_id))
  WITH CHECK (prestadora_id IS NOT NULL AND interno.escribe_el_catalogo(prestadora_id));

-- La cerradura sin la puerta no deja pasar a nadie: sin estos permisos, la política perfecta de
-- arriba devuelve `42501 permission denied for table` y el mensaje no habla de RLS.
REVOKE ALL ON TABLE public.listas_de_opciones FROM anon, authenticated;
REVOKE ALL ON TABLE public.opciones_de_lista FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.listas_de_opciones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.opciones_de_lista TO authenticated;
GRANT ALL ON TABLE public.listas_de_opciones TO service_role;
GRANT ALL ON TABLE public.opciones_de_lista TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Las dos listas que hoy están escritas adentro de una pantalla
-- ---------------------------------------------------------------------------
--
-- Son las dos que quedaban del filtro de Postulaciones: las zonas y las especialidades ya salen
-- de la base, y estas dos seguían en el archivo de traducciones, recorridas con un bucle para
-- dibujar dos desplegables. El texto es el mismo que ya estaba escrito ahí, en los tres idiomas.
--
-- La disponibilidad se abre: cada Prestadora arma sus turnos y ninguna lista de fábrica los
-- cubre. La situación fiscal no: es una categoría de la ley de cada país y se compara entre
-- Organizaciones; una Prestadora que se inventara una la volvería incomparable, y lo que
-- corresponde ahí es cargar el país que falte en el catálogo del producto.

INSERT INTO public.listas_de_opciones (prestadora_id, clave, i18n, admite_opciones_propias, orden)
VALUES
  (NULL, 'disponibilidad',
   '{"es-AR": "Disponibilidad", "en": "Availability", "pt-BR": "Disponibilidade"}'::jsonb,
   true, 10),
  (NULL, 'situacion_fiscal',
   '{"es-AR": "Situación fiscal", "en": "Tax status", "pt-BR": "Situação fiscal"}'::jsonb,
   false, 20)
ON CONFLICT DO NOTHING;

INSERT INTO public.opciones_de_lista (prestadora_id, lista_id, clave, i18n, orden)
SELECT NULL, l.id, v.clave, v.i18n, v.orden
  FROM public.listas_de_opciones l
  JOIN (VALUES
    ('disponibilidad', 'manana',
     '{"es-AR": "Mañana", "en": "Morning", "pt-BR": "Manhã"}'::jsonb, 10),
    ('disponibilidad', 'tarde',
     '{"es-AR": "Tarde", "en": "Afternoon", "pt-BR": "Tarde"}'::jsonb, 20),
    ('disponibilidad', 'noche',
     '{"es-AR": "Noche", "en": "Night", "pt-BR": "Noite"}'::jsonb, 30),
    ('disponibilidad', 'fines_semana',
     '{"es-AR": "Fines de semana", "en": "Weekends", "pt-BR": "Fins de semana"}'::jsonb, 40),
    ('situacion_fiscal', 'monotributo',
     '{"es-AR": "Monotributo", "en": "Monotributo (self-employed)", "pt-BR": "Monotributo (autônomo)"}'::jsonb, 10)
  ) AS v (lista, clave, i18n, orden) ON v.lista = l.clave
 WHERE l.prestadora_id IS NULL
ON CONFLICT DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

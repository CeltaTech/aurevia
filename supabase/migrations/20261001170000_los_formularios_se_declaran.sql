-- Los formularios se declaran, no se dibujan.
--
-- QUÉ FALTA HOY. Los campos, las validaciones y los pasos de cada formulario se escriben pantalla
-- por pantalla. Agregar un dato al Legajo de un Asistente es tocar el código de una pantalla, y
-- lo que una Prestadora necesita pedir de más no se puede pedir sin publicar una versión nueva.
--
-- QUÉ AGREGA. Tres tablas que guardan la declaración: qué formularios hay, qué secciones tiene
-- cada uno y qué casilleros tiene cada sección, con su tipo, si es obligatorio, su largo máximo,
-- qué formatos de archivo acepta, si la sección se repite, y bajo qué condición el formulario
-- pasa a ser obligatorio. La pantalla no escribe ningún casillero a mano: lee de acá y dibuja.
--
-- DOS NIVELES, COMO `tipos_asistente`. Con `prestadora_id` vacío la fila la trae el producto: la
-- ven todas y no la toca ninguna. Con dato, la agregó esa Prestadora y sólo la ve ella. Es el
-- mismo reparto que ya usa `public.tipos_asistente`, y por eso las reglas de acceso copian su
-- forma.
--
-- POR QUÉ EL TEXTO VISIBLE ESTÁ ACÁ Y NO EN LAS TRADUCCIONES. Una Prestadora puede agregar sus
-- propios formularios, y lo que ella escribe no está en ningún archivo de traducción del producto.
-- Entonces el texto viaja con la declaración, en los tres idiomas, y una restricción rechaza la
-- fila a la que le falte uno. Si mañana se admitiera cargar uno solo, el Panel en inglés mostraría
-- castellano y nadie se enteraría hasta que un cliente lo vea.
--
-- NINGÚN CASILLERO LLEVA EXPLICACIÓN DEBAJO. No hay columna de ayuda, ni de aclaración, ni de
-- globo al pasar el puntero, y no se agrega. Si un casillero necesita explicación, lo que está mal
-- es el casillero.
--
-- CÓMO SE VUELVE ATRÁS.
--   DROP TABLE IF EXISTS public.formulario_campos;
--   DROP TABLE IF EXISTS public.formulario_secciones;
--   DROP TABLE IF EXISTS public.formularios_declarados;
--   DROP FUNCTION IF EXISTS interno.texto_en_los_tres_idiomas(jsonb);

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El punto único que decide si un texto está completo
-- ---------------------------------------------------------------------------
-- Vive en `interno` porque PostgREST no publica ese esquema: es una comprobación de la base, no
-- una dirección web. La llaman las restricciones de las tres tablas en lugar de repetir la misma
-- condición tres veces.

CREATE OR REPLACE FUNCTION interno.texto_en_los_tres_idiomas(texto jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT texto IS NOT NULL
     AND jsonb_typeof(texto) = 'object'
     AND coalesce(length(btrim(texto ->> 'es-AR')), 0) > 0
     AND coalesce(length(btrim(texto ->> 'en')), 0) > 0
     AND coalesce(length(btrim(texto ->> 'pt-BR')), 0) > 0;
$$;

COMMENT ON FUNCTION interno.texto_en_los_tres_idiomas(jsonb) IS 'Verdadero si el texto trae los tres idiomas con contenido. Única definición: las restricciones de los formularios declarados la llaman en lugar de repetir la condición.';

REVOKE ALL ON FUNCTION interno.texto_en_los_tres_idiomas(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.texto_en_los_tres_idiomas(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION interno.texto_en_los_tres_idiomas(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION interno.texto_en_los_tres_idiomas(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. El formulario
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.formularios_declarados (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prestadora_id uuid,
    -- Nombre guardado: se nombra por lo que hace y no se renombra nunca. El texto visible sale
    -- de `titulo`.
    clave text NOT NULL,
    -- Sobre qué trabaja el formulario. Son palabras del glosario.
    ambito text NOT NULL,
    titulo jsonb NOT NULL,
    orden integer DEFAULT 100 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT formularios_declarados_pkey PRIMARY KEY (id),
    CONSTRAINT formularios_declarados_prestadora_fkey
        FOREIGN KEY (prestadora_id) REFERENCES public.prestadoras(id) ON DELETE CASCADE,
    CONSTRAINT formularios_declarados_ambito_check
        CHECK (ambito = ANY (ARRAY['asistente'::text, 'paciente'::text, 'familia'::text, 'servicio'::text])),
    CONSTRAINT formularios_declarados_titulo_completo
        CHECK (interno.texto_en_los_tres_idiomas(titulo))
);

-- La clave identifica al formulario adentro de su nivel: el producto no puede declarar dos
-- iguales, y una Prestadora tampoco. Van dos índices porque en Postgres dos filas con
-- `prestadora_id` vacío no chocan entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS formularios_declarados_clave_del_producto
    ON public.formularios_declarados (clave) WHERE prestadora_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS formularios_declarados_clave_de_la_prestadora
    ON public.formularios_declarados (prestadora_id, clave) WHERE prestadora_id IS NOT NULL;

-- Lo usa la clave foránea compuesta de las secciones, para que una sección no pueda colgar de un
-- formulario de otra Prestadora.
CREATE UNIQUE INDEX IF NOT EXISTS formularios_declarados_id_prestadora
    ON public.formularios_declarados (id, prestadora_id);

COMMENT ON TABLE public.formularios_declarados IS 'Qué formularios existen. La pantalla no escribe casilleros a mano: lee de acá y dibuja.';
COMMENT ON COLUMN public.formularios_declarados.prestadora_id IS 'NULL = formulario que trae el producto, lo ven todas las Prestadoras y ninguna lo puede tocar. Con dato = lo agregó esa Prestadora y sólo lo ve ella.';
COMMENT ON COLUMN public.formularios_declarados.titulo IS 'El título visible en los tres idiomas: es-AR, en y pt-BR. Una restricción rechaza la fila a la que le falte uno.';

-- ---------------------------------------------------------------------------
-- 3. Las secciones
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.formulario_secciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    formulario_id uuid NOT NULL,
    -- Repetida del formulario para que la regla de acceso no tenga que ir a buscarla, y atada por
    -- la clave foránea compuesta de más abajo para que no se pueda despegar.
    prestadora_id uuid,
    clave text NOT NULL,
    titulo jsonb NOT NULL,
    -- Si se repite, la persona puede cargar varios bloques iguales: tres estudios, dos domicilios.
    repetible boolean DEFAULT false NOT NULL,
    maximo_repeticiones integer,
    -- Bajo qué condición esta sección pasa a ser obligatoria. Vacío = obligatoria desde que se
    -- abre el formulario. Con dato, es una condición del motor: `tipo_asistente.requiere_matricula
    -- == true`, `modalidad == 'domiciliaria'`.
    obligatoria_cuando text,
    orden integer DEFAULT 100 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT formulario_secciones_pkey PRIMARY KEY (id),
    CONSTRAINT formulario_secciones_formulario_fkey
        FOREIGN KEY (formulario_id) REFERENCES public.formularios_declarados(id) ON DELETE CASCADE,
    CONSTRAINT formulario_secciones_misma_prestadora
        FOREIGN KEY (formulario_id, prestadora_id)
        REFERENCES public.formularios_declarados(id, prestadora_id) ON DELETE CASCADE,
    CONSTRAINT formulario_secciones_titulo_completo
        CHECK (interno.texto_en_los_tres_idiomas(titulo)),
    CONSTRAINT formulario_secciones_tope_solo_si_repite
        CHECK (maximo_repeticiones IS NULL OR (repetible = true AND maximo_repeticiones > 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS formulario_secciones_clave_por_formulario
    ON public.formulario_secciones (formulario_id, clave);
CREATE UNIQUE INDEX IF NOT EXISTS formulario_secciones_id_prestadora
    ON public.formulario_secciones (id, prestadora_id);

COMMENT ON COLUMN public.formulario_secciones.obligatoria_cuando IS 'Vacío: la sección es obligatoria desde que se abre el formulario. Con dato: es la condición que la vuelve obligatoria, escrita como la lee el motor.';

-- ---------------------------------------------------------------------------
-- 4. Los casilleros
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.formulario_campos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seccion_id uuid NOT NULL,
    prestadora_id uuid,
    clave text NOT NULL,
    tipo text NOT NULL,
    -- Sólo la etiqueta. No hay columna de ayuda y no se agrega: un casillero se explica solo.
    etiqueta jsonb NOT NULL,
    obligatorio boolean DEFAULT false NOT NULL,
    -- Obligatorio nada más que si se cumple esta condición; o justamente si no se cumple.
    obligatorio_si text,
    no_obligatorio_si text,
    -- Largo máximo del texto. En un casillero de archivo no se usa.
    maximo integer,
    -- Qué formatos de archivo acepta. Vacío en todo lo que no sea archivo.
    formatos text[],
    -- De qué lista de opciones salen las opciones, para los casilleros de lista. La lista sale de
    -- la base, nunca escrita adentro de la pantalla.
    lista_de_opciones text,
    -- Si el dato vence, y entonces el motor pide además hasta cuándo vale.
    vigencia boolean DEFAULT false NOT NULL,
    orden integer DEFAULT 100 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT formulario_campos_pkey PRIMARY KEY (id),
    CONSTRAINT formulario_campos_seccion_fkey
        FOREIGN KEY (seccion_id) REFERENCES public.formulario_secciones(id) ON DELETE CASCADE,
    CONSTRAINT formulario_campos_misma_prestadora
        FOREIGN KEY (seccion_id, prestadora_id)
        REFERENCES public.formulario_secciones(id, prestadora_id) ON DELETE CASCADE,
    CONSTRAINT formulario_campos_tipo_check
        CHECK (tipo = ANY (ARRAY[
            'texto'::text, 'texto_largo'::text, 'fecha'::text, 'anio'::text, 'mes_anio'::text,
            'casilla'::text, 'archivo'::text, 'telefono'::text, 'lista'::text, 'lista_multiple'::text
        ])),
    CONSTRAINT formulario_campos_etiqueta_completa
        CHECK (interno.texto_en_los_tres_idiomas(etiqueta)),
    CONSTRAINT formulario_campos_maximo_positivo
        CHECK (maximo IS NULL OR maximo > 0),
    -- Los formatos son del casillero de archivo y de ningún otro; y un casillero de archivo sin
    -- formatos acepta cualquier cosa, que no es lo que quiere decir dejarlo vacío.
    CONSTRAINT formulario_campos_formatos_solo_en_archivo
        CHECK ((tipo = 'archivo' AND formatos IS NOT NULL AND array_length(formatos, 1) > 0)
               OR (tipo <> 'archivo' AND formatos IS NULL)),
    -- Un casillero de lista sin lista de opciones no tiene de dónde sacarlas.
    CONSTRAINT formulario_campos_lista_de_opciones_solo_en_lista
        CHECK ((tipo IN ('lista', 'lista_multiple') AND lista_de_opciones IS NOT NULL)
               OR (tipo NOT IN ('lista', 'lista_multiple') AND lista_de_opciones IS NULL)),
    -- Las dos condiciones opuestas juntas dejan al casillero sin manera de resolverse.
    CONSTRAINT formulario_campos_una_sola_condicion
        CHECK (obligatorio_si IS NULL OR no_obligatorio_si IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS formulario_campos_clave_por_seccion
    ON public.formulario_campos (seccion_id, clave);

COMMENT ON TABLE public.formulario_campos IS 'Los casilleros de cada sección. No hay columna de ayuda: un casillero lleva su etiqueta y nada más.';
COMMENT ON COLUMN public.formulario_campos.formatos IS 'Qué formatos de archivo acepta el casillero. Lo que acepta el depósito manda igual: esto no lo amplía.';
COMMENT ON COLUMN public.formulario_campos.lista_de_opciones IS 'De que lista de opciones elige este casillero. Es la clave de una fila de listas_de_opciones; las opciones salen de la base y nunca escritas adentro de la pantalla.';

-- ---------------------------------------------------------------------------
-- 5. Quién ve y quién toca
-- ---------------------------------------------------------------------------
-- Copian la forma de `tipos_asistente`: todas leen lo del producto y lo propio; la Prestadora
-- gestiona lo suyo; el Superadmin gestiona lo del producto. Nadie alcanza lo de otra Prestadora.

ALTER TABLE public.formularios_declarados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formulario_secciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formulario_campos ENABLE ROW LEVEL SECURITY;

CREATE POLICY todos_leen_formularios_visibles ON public.formularios_declarados
    FOR SELECT USING (prestadora_id IS NULL OR prestadora_id = interno.current_tenant());
CREATE POLICY admin_prestadora_gestiona_formularios_propios ON public.formularios_declarados
    USING (prestadora_id = interno.current_tenant() AND interno.es_admin_prestadora())
    WITH CHECK (prestadora_id = interno.current_tenant() AND interno.es_admin_prestadora());
CREATE POLICY superadmin_gestiona_formularios ON public.formularios_declarados
    USING (interno.es_superadmin()) WITH CHECK (interno.es_superadmin());

CREATE POLICY todos_leen_secciones_visibles ON public.formulario_secciones
    FOR SELECT USING (prestadora_id IS NULL OR prestadora_id = interno.current_tenant());
CREATE POLICY admin_prestadora_gestiona_secciones_propias ON public.formulario_secciones
    USING (prestadora_id = interno.current_tenant() AND interno.es_admin_prestadora())
    WITH CHECK (prestadora_id = interno.current_tenant() AND interno.es_admin_prestadora());
CREATE POLICY superadmin_gestiona_secciones ON public.formulario_secciones
    USING (interno.es_superadmin()) WITH CHECK (interno.es_superadmin());

CREATE POLICY todos_leen_campos_visibles ON public.formulario_campos
    FOR SELECT USING (prestadora_id IS NULL OR prestadora_id = interno.current_tenant());
CREATE POLICY admin_prestadora_gestiona_campos_propios ON public.formulario_campos
    USING (prestadora_id = interno.current_tenant() AND interno.es_admin_prestadora())
    WITH CHECK (prestadora_id = interno.current_tenant() AND interno.es_admin_prestadora());
CREATE POLICY superadmin_gestiona_campos ON public.formulario_campos
    USING (interno.es_superadmin()) WITH CHECK (interno.es_superadmin());

-- El permiso de tabla no es la RLS: sin esto, una política perfecta bloquea en vez de proteger.
GRANT SELECT ON public.formularios_declarados TO authenticated;
GRANT SELECT ON public.formulario_secciones TO authenticated;
GRANT SELECT ON public.formulario_campos TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.formularios_declarados TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.formulario_secciones TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.formulario_campos TO authenticated;
GRANT ALL ON public.formularios_declarados TO service_role;
GRANT ALL ON public.formulario_secciones TO service_role;
GRANT ALL ON public.formulario_campos TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

--
-- La ficha deja de ser la cuenta
--
-- Hasta acá la ficha del Asistente y la de la Familia *eran* la cuenta: `asistentes.id` y
-- `familias.id` no tenían identificador propio, guardaban el de la cuenta y lo declaraban con una
-- clave foránea contra `usuarios`. Mientras cada persona estaba en una sola Prestadora eso
-- alcanzaba. Con la membresía ya no: la misma persona puede asistir en dos Prestadoras, y
-- entonces necesita dos fichas —dos legajos de trabajo, con su antigüedad, sus matrículas y sus
-- guardias de cada lado— colgando de una sola cuenta.
--
-- LO QUE NACE ACÁ ES `usuario_id`, EN LAS DOS TABLAS. La ficha pasa a tener identificador propio
-- y una columna aparte que dice de qué cuenta cuelga. Una cuenta puede tener una ficha por
-- Prestadora y no más de una, que es lo que dice la restricción nueva.
--
-- NINGUNA CLAVE FORÁNEA SE TOCA, y ése es todo el motivo de hacerlo así. Las cincuenta y seis que
-- apuntan a una ficha apuntan a `asistentes.id` o a `familias.id`, que siguen siendo la clave
-- primaria y siguen valiendo lo mismo en cada fila que ya existe: `usuario_id` se llena con el
-- valor que ya tenía `id`. Nada que hoy esté guardado cambia de número. Lo único que se retira es
-- la clave foránea que ataba `id` a `usuarios`, que es justamente la que impedía que la ficha
-- fuera otra cosa que la cuenta.
--
-- Y LAS FICHAS NUEVAS SE NUMERAN SOLAS. Hasta hoy el identificador de la ficha lo traía el motor,
-- porque era el de la cuenta. De acá en más lo pone la base.
--
-- LO QUE PREGUNTABA POR LA CUENTA PASA A PREGUNTAR POR LA FICHA. Tres funciones internas y
-- veintitrés políticas comparaban el identificador de una ficha contra el de quien inició sesión,
-- dando por sentado que eran el mismo número. Se reescriben todas para pasar por la ficha de la
-- Prestadora donde está parada la sesión. Es el mismo resultado mientras haya una sola ficha por
-- persona, y el correcto cuando haya dos.
--

-- 1. La ficha del Asistente ---------------------------------------------------------------------

ALTER TABLE public.asistentes ADD COLUMN IF NOT EXISTS usuario_id uuid;

UPDATE public.asistentes SET usuario_id = id WHERE usuario_id IS NULL;

ALTER TABLE public.asistentes ALTER COLUMN usuario_id SET NOT NULL;

ALTER TABLE public.asistentes DROP CONSTRAINT IF EXISTS asistentes_usuario_id_fkey;
ALTER TABLE public.asistentes
  ADD CONSTRAINT asistentes_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

-- Una cuenta tiene a lo sumo una ficha de Asistente por Prestadora. Dos en la misma sería la
-- misma persona contratada dos veces en el mismo lugar, que no es un caso: es un error de carga.
ALTER TABLE public.asistentes DROP CONSTRAINT IF EXISTS asistentes_una_ficha_por_cuenta_y_prestadora;
ALTER TABLE public.asistentes
  ADD CONSTRAINT asistentes_una_ficha_por_cuenta_y_prestadora UNIQUE (usuario_id, prestadora_id);

CREATE INDEX IF NOT EXISTS asistentes_por_usuario ON public.asistentes (usuario_id);

-- Acá se corta la atadura. `id` deja de ser el identificador de la cuenta y pasa a ser el de la
-- ficha; sigue siendo la clave primaria y sigue valiendo lo mismo en cada fila ya guardada.
ALTER TABLE public.asistentes DROP CONSTRAINT IF EXISTS asistentes_id_fkey;
ALTER TABLE public.asistentes ALTER COLUMN id SET DEFAULT gen_random_uuid();

COMMENT ON COLUMN public.asistentes.usuario_id IS
  'De qué cuenta cuelga esta ficha. Una cuenta puede tener una ficha por Prestadora; la ficha es el legajo de trabajo en esa Prestadora y la cuenta es la persona.';

-- 2. La ficha de la Familia ---------------------------------------------------------------------

ALTER TABLE public.familias ADD COLUMN IF NOT EXISTS usuario_id uuid;

UPDATE public.familias SET usuario_id = id WHERE usuario_id IS NULL;

ALTER TABLE public.familias ALTER COLUMN usuario_id SET NOT NULL;

ALTER TABLE public.familias DROP CONSTRAINT IF EXISTS familias_usuario_id_fkey;
ALTER TABLE public.familias
  ADD CONSTRAINT familias_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

ALTER TABLE public.familias DROP CONSTRAINT IF EXISTS familias_una_ficha_por_cuenta_y_prestadora;
ALTER TABLE public.familias
  ADD CONSTRAINT familias_una_ficha_por_cuenta_y_prestadora UNIQUE (usuario_id, prestadora_id);

CREATE INDEX IF NOT EXISTS familias_por_usuario ON public.familias (usuario_id);

ALTER TABLE public.familias DROP CONSTRAINT IF EXISTS familias_id_fkey;
ALTER TABLE public.familias ALTER COLUMN id SET DEFAULT gen_random_uuid();

COMMENT ON COLUMN public.familias.usuario_id IS
  'De qué cuenta cuelga esta ficha. Es la cuenta del titular; el resto del círculo familiar cuelga de `miembros_familia`.';

-- 3. Cuál es la ficha de quien está usando el sistema -------------------------------------------

-- El punto único donde se resuelve eso. Quien entró tiene una cuenta; la ficha que le corresponde
-- depende de en qué Prestadora esté parado, y eso lo contesta `current_tenant()`. Va en `interno`
-- porque la llaman las políticas y no tiene por qué ser una dirección web.
CREATE OR REPLACE FUNCTION interno.asistente_de_la_sesion()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'interno'
AS $$
  SELECT a.id
    FROM asistentes a
   WHERE a.usuario_id = auth.uid()
     AND a.prestadora_id = interno.current_tenant()
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION interno.asistente_de_la_sesion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.asistente_de_la_sesion() TO authenticated, service_role;

COMMENT ON FUNCTION interno.asistente_de_la_sesion() IS
  'La ficha de Asistente de quien inició sesión, en la Prestadora donde está parado. Nula si en esa Prestadora no es Asistente.';

-- 4. Lo que preguntaba por la cuenta pasa a preguntar por la ficha ------------------------------

-- Antes: existe una fila de `asistentes` cuyo identificador es el de quien entró. Ahora: existe
-- una ficha suya, en la Prestadora donde está parado.
CREATE OR REPLACE FUNCTION interno.es_asistente()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'interno'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM asistentes a
     WHERE a.usuario_id = auth.uid()
       AND a.prestadora_id = interno.current_tenant()
  );
$$;

-- El titular de la Familia se reconocía porque su cuenta era la ficha. Ahora se lo reconoce por
-- la columna que lo dice. Se acota a la Prestadora donde está parado: la misma persona puede ser
-- titular en dos, y entonces «su» ficha depende de dónde esté.
CREATE OR REPLACE FUNCTION interno.familia_id_de_usuario(p_usuario_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'interno'
AS $$
  SELECT COALESCE(
    (SELECT f.id FROM familias f
      WHERE f.usuario_id = p_usuario_id
        AND f.prestadora_id = interno.current_tenant()
      LIMIT 1),
    (SELECT m.familia_id FROM miembros_familia m
      WHERE m.usuario_id = p_usuario_id
      LIMIT 1)
  )
$$;

CREATE OR REPLACE FUNCTION interno.circulo_puede(p_usuario uuid, p_clave text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'interno'
AS $$
  SELECT CASE
    WHEN p_usuario IS NULL THEN false
    WHEN EXISTS (
      SELECT 1 FROM familias f
       WHERE f.usuario_id = p_usuario
         AND f.prestadora_id = interno.current_tenant()
    ) THEN true
    ELSE COALESCE(
      (SELECT p.permitido
         FROM permisos_circulo_familiar p
        WHERE p.usuario_id = p_usuario
          AND p.clave = p_clave),
      false
    )
  END
$$;

-- 5. Las políticas que comparaban una ficha contra la cuenta ------------------------------------

-- El Asistente lee su propia ficha. Antes decía `id = auth.uid()`, que era verdad sólo mientras
-- la ficha y la cuenta fueran el mismo número.
DROP POLICY IF EXISTS asistente_lee_su_ficha ON public.asistentes;
CREATE POLICY asistente_lee_su_ficha ON public.asistentes
  FOR SELECT TO authenticated
  USING (usuario_id = auth.uid());

-- Y las veintitrés que comparan el identificador de una ficha contra el de quien entró. Se
-- reescriben con el mismo texto, cambiando a qué se compara: la ficha de la sesión en vez de la
-- cuenta. Se hace recorriendo el catálogo y no a mano, tabla por tabla, porque escribir veintitrés
-- veces la misma corrección es escribir veintitrés veces la misma oportunidad de equivocarse. La
-- comprobación del final falla si quedó alguna sin cambiar.
DO $bloque$
DECLARE
  p            record;
  v_qual       text;
  v_check      text;
  v_roles      text;
  v_permissive text;
  v_sql        text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (COALESCE(qual, '') || COALESCE(with_check, ''))
           ~ '(asistente_id|familia_id)\s*=\s*auth\.uid\(\)'
  LOOP
    v_qual  := p.qual;
    v_check := p.with_check;

    v_qual  := regexp_replace(v_qual,  'asistente_id(\s*)=(\s*)auth\.uid\(\)',
                              'asistente_id\1=\2interno.asistente_de_la_sesion()', 'g');
    v_check := regexp_replace(v_check, 'asistente_id(\s*)=(\s*)auth\.uid\(\)',
                              'asistente_id\1=\2interno.asistente_de_la_sesion()', 'g');

    v_qual  := regexp_replace(v_qual,  'familia_id(\s*)=(\s*)auth\.uid\(\)',
                              'familia_id\1=\2interno.familia_id_de_usuario(auth.uid())', 'g');
    v_check := regexp_replace(v_check, 'familia_id(\s*)=(\s*)auth\.uid\(\)',
                              'familia_id\1=\2interno.familia_id_de_usuario(auth.uid())', 'g');

    v_roles      := array_to_string(p.roles, ', ');
    v_permissive := CASE WHEN p.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END;

    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);

    v_sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
                    p.policyname, p.schemaname, p.tablename, v_permissive, p.cmd, v_roles);
    IF v_qual  IS NOT NULL THEN v_sql := v_sql || format(' USING (%s)', v_qual); END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || format(' WITH CHECK (%s)', v_check); END IF;

    EXECUTE v_sql;
  END LOOP;
END
$bloque$;

-- Que no haya quedado ninguna. Si esto salta, la migración entera se deshace.
DO $control$
DECLARE
  v_quedan int;
BEGIN
  SELECT count(*) INTO v_quedan
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (COALESCE(qual, '') || COALESCE(with_check, ''))
         ~ '(asistente_id|familia_id)\s*=\s*auth\.uid\(\)';

  IF v_quedan > 0 THEN
    RAISE EXCEPTION 'Quedaron % políticas comparando una ficha contra la cuenta', v_quedan;
  END IF;
END
$control$;

NOTIFY pgrst, 'reload schema';

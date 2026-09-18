-- El Padrón: un Legajo por Persona, y los roles lo citan.
-- =======================================================
--
-- QUÉ FALTABA. En este producto una persona está escrita en tantos lugares como papeles cumple.
-- Quien contrata no tiene dónde vivir: su nombre es un renglón de la solicitud que originó la
-- Familia. Quien paga tampoco: es texto tecleado en `familias.financiador_nombre`. El Paciente
-- existe sólo colgado de una Familia. El Asistente es una fila de `asistentes`. Los familiares son
-- filas de `usuarios`. La obra social no existe: es `pacientes.obra_social`, una columna de texto.
--
-- POR QUÉ ROMPE. La misma persona contrata el Servicio de una Familia, paga el de otra y años
-- después necesita cuidados y es Paciente de una tercera. Siempre es la misma persona. Escrita
-- cuatro veces son cuatro personas distintas, y el día que se la mira no se sabe cómo se comportó
-- en las otras tres. Se pierde justo lo que sirve para decidir.
--
-- QUÉ QUEDA. El Padrón de la Prestadora: un Legajo por Persona, física o jurídica. El Legajo
-- guarda quién es esa Persona y nada más —nombre, documento, domicilio, teléfono, correo— y lleva
-- su número, único adentro de la Prestadora.
--
-- EL LEGAJO NO GUARDA NINGÚN ROL. Ni contratante, ni pagador, ni Paciente, ni familiar. El rol
-- vive donde ocurre —en la contratación, en el Servicio, en la Familia— y desde ahí se señala cuál
-- Legajo es. Por eso la misma Persona puede cumplir tres papeles sin duplicarse. Y por eso el
-- Legajo tampoco guarda permisos: rol nunca significa permisos, y acá no hay ni una cosa ni la
-- otra.
--
-- EL LEGAJO NO SE BORRA NUNCA. Que termine el Servicio a un Paciente da de baja el Servicio, no el
-- Legajo. Lo que se conserva es el historial de cómo se comportó esa Persona en cada papel que
-- cumplió, porque con quien dejó de ser Cliente se vuelve a cruzar. El borrado lo impide un
-- disparador, no la buena voluntad de quien escribe la pantalla, y además `authenticated` no tiene
-- el permiso de tabla para borrar.
--
-- Y POR ESO EL NÚMERO NO SE REASIGNA. Se asigna solo, uno más que el mayor de esa Prestadora. Como
-- ningún renglón se va, ese número no vuelve a caerle a nadie más. No se elige a mano: un número
-- elegido a mano es un número repetido esperando.
--
-- LA PERSONA FÍSICA Y LA JURÍDICA ESTÁN EN LA MISMA LISTA, porque cumplen los mismos papeles: una
-- obra social contrata y paga igual que una persona. La distinción ya existe en el derecho y no
-- hubo que inventarla. Lo único que cambia es que la jurídica no tiene apellido y su nombre es la
-- razón social.
--
-- EL DOMICILIO VA PARTIDO, con las mismas piezas que el del Paciente y el de la Asistente. Un
-- domicilio en un solo renglón no se puede buscar ni comparar.
--
-- QUÉ NO HACE ESTA MIGRACIÓN. No toca nada de lo que ya está escrito. Ni los Pacientes, ni las
-- Familias, ni los Asistentes, ni la columna de texto del financiador. Que la contratación cite
-- Legajos, y que los casilleros tecleados pasen a ser listas, son los pasos siguientes del plan:
-- éste sólo levanta el Padrón. Y no hay nada que convertir, porque nunca nadie usó la aplicación y
-- no hay datos cargados de personas reales.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El Padrón
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.legajos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),

  -- El número de legajo. Lo pone el disparador y no se elige: ver el encabezado.
  numero_legajo bigint NOT NULL,

  -- `fisica` es una persona de carne y hueso; `juridica` es una obra social, una prepaga, una
  -- empresa. Las dos contratan y pagan, y por eso están en la misma lista.
  clase text NOT NULL,

  -- De una persona física, el nombre de pila. De una jurídica, la razón social entera.
  nombre text NOT NULL,
  -- Sólo la persona física tiene apellido.
  apellido text,

  -- Con qué se la identifica ante el Estado. El tipo va aparte del número porque cambia por país
  -- y por clase: documento de identidad, pasaporte, identificación fiscal. Qué tipos existen en
  -- cada país es configuración y no se deduce acá.
  documento_tipo text,
  documento_numero text,

  -- El domicilio, con las mismas piezas que el del Paciente y el de la Asistente.
  calle text,
  numero text,
  piso text,
  unidad text,
  lugar_id uuid,

  telefono text,
  email text,

  -- Lo que la Prestadora quiera anotar sobre esta Persona y no entre en ningún casillero.
  notas text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- No hay `deleted_at` a propósito: el Legajo no se borra ni se da de baja.

  CONSTRAINT legajos_clase_conocida
    CHECK (clase IN ('fisica', 'juridica')),

  -- Una persona física sin apellido no se puede reconocer después, y reconocerla es para lo único
  -- que existe el Padrón.
  CONSTRAINT legajos_la_fisica_lleva_apellido
    CHECK (clase <> 'fisica' OR (apellido IS NOT NULL AND btrim(apellido) <> '')),

  -- Una jurídica no tiene apellido: si lo llevara, la razón social quedaría partida en dos y
  -- buscarla por el nombre entero no la encontraría.
  CONSTRAINT legajos_la_juridica_no_lleva_apellido
    CHECK (clase <> 'juridica' OR apellido IS NULL),

  -- El documento va entero o no va: un número sin tipo no dice qué se está mirando.
  CONSTRAINT legajos_el_documento_va_entero
    CHECK ((documento_tipo IS NULL) = (documento_numero IS NULL)),

  CONSTRAINT legajos_el_nombre_no_va_vacio
    CHECK (btrim(nombre) <> ''),

  -- Sirve para que lo que cite un Legajo no pueda ser de otra Organización.
  CONSTRAINT legajos_id_prestadora_unico UNIQUE (id, prestadora_id),

  CONSTRAINT legajos_numero_unico_por_prestadora UNIQUE (prestadora_id, numero_legajo)
);

ALTER TABLE public.legajos
  ADD CONSTRAINT legajos_lugar_fkey
  FOREIGN KEY (lugar_id, prestadora_id)
  REFERENCES public.lugares (id, prestadora_id);

-- La misma Persona no entra dos veces. Se compara por documento, que es lo único que identifica de
-- verdad: dos personas se llaman igual, y el mismo nombre escrito con una tilde de más es otro
-- texto. Sólo alcanza a los Legajos que tienen documento cargado, porque hay Personas de las que
-- al principio se sabe apenas el nombre y el teléfono.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legajos_documento_una_vez_por_prestadora
  ON public.legajos (prestadora_id, documento_tipo, upper(btrim(documento_numero)))
  WHERE documento_numero IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_legajos_por_prestadora
  ON public.legajos (prestadora_id, apellido, nombre);

CREATE INDEX IF NOT EXISTS idx_legajos_por_lugar
  ON public.legajos (lugar_id);

COMMENT ON TABLE public.legajos IS
  'El Padron de la Prestadora: un Legajo por Persona, fisica o juridica. Guarda quien es y nada mas; los roles viven donde ocurren y citan el Legajo. No se borra nunca.';

COMMENT ON COLUMN public.legajos.numero_legajo IS
  'Unico adentro de la Prestadora. Lo asigna el disparador y no se reasigna nunca, porque ningun Legajo se borra.';

COMMENT ON COLUMN public.legajos.clase IS
  'fisica (una persona) o juridica (una obra social, una prepaga, una empresa). Las dos cumplen los mismos papeles.';

COMMENT ON COLUMN public.legajos.nombre IS
  'El nombre de pila de la persona fisica, o la razon social entera de la juridica.';

-- ---------------------------------------------------------------------------
-- 2. El número, que se asigna solo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION interno.asignar_numero_de_legajo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, interno
AS $$
BEGIN
  IF NEW.numero_legajo IS NOT NULL THEN
    RAISE EXCEPTION 'numero_de_legajo_no_se_elige';
  END IF;

  -- El candado es por Prestadora y dura lo que dura la transacción. Sin él, dos altas a la vez
  -- leen el mismo máximo y las dos piden el mismo número: una falla y la otra no, pero la que
  -- falla es un alta perdida por una razón que quien la cargó no puede entender.
  PERFORM pg_advisory_xact_lock(hashtext('legajos:' || NEW.prestadora_id::text));

  SELECT COALESCE(max(numero_legajo), 0) + 1
    INTO NEW.numero_legajo
    FROM public.legajos
   WHERE prestadora_id = NEW.prestadora_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION interno.asignar_numero_de_legajo() IS
  'El numero de legajo, uno mas que el mayor de esa Prestadora. No se reasigna porque ningun Legajo se borra.';

DROP TRIGGER IF EXISTS asignar_numero_legajos ON public.legajos;
CREATE TRIGGER asignar_numero_legajos
  BEFORE INSERT
  ON public.legajos
  FOR EACH ROW EXECUTE FUNCTION interno.asignar_numero_de_legajo();

-- Y una vez puesto no cambia: el número es con lo que se nombra a esa Persona en papeles que ya
-- salieron de acá.
CREATE OR REPLACE FUNCTION interno.el_numero_de_legajo_no_cambia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, interno
AS $$
BEGIN
  IF NEW.numero_legajo IS DISTINCT FROM OLD.numero_legajo THEN
    RAISE EXCEPTION 'numero_de_legajo_no_cambia';
  END IF;
  IF NEW.prestadora_id IS DISTINCT FROM OLD.prestadora_id THEN
    RAISE EXCEPTION 'legajo_no_cambia_de_organizacion';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS el_numero_de_legajo_no_cambia ON public.legajos;
CREATE TRIGGER el_numero_de_legajo_no_cambia
  BEFORE UPDATE
  ON public.legajos
  FOR EACH ROW EXECUTE FUNCTION interno.el_numero_de_legajo_no_cambia();

-- ---------------------------------------------------------------------------
-- 3. El Legajo no se borra
-- ---------------------------------------------------------------------------
--
-- El permiso de tabla ya deja a `authenticated` sin borrar, pero eso no alcanza: la llave de
-- servicio del motor se saltea la RLS y los permisos de tabla. El disparador vale para todos.

CREATE OR REPLACE FUNCTION interno.el_legajo_no_se_borra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, interno
AS $$
BEGIN
  RAISE EXCEPTION 'legajo_no_se_borra';
END;
$$;

COMMENT ON FUNCTION interno.el_legajo_no_se_borra() IS
  'Impide borrar un Legajo. Terminar un Servicio da de baja el Servicio, no la Persona: lo que se conserva es su historial en cada papel que cumplio.';

DROP TRIGGER IF EXISTS el_legajo_no_se_borra ON public.legajos;
CREATE TRIGGER el_legajo_no_se_borra
  BEFORE DELETE
  ON public.legajos
  FOR EACH ROW EXECUTE FUNCTION interno.el_legajo_no_se_borra();

-- ---------------------------------------------------------------------------
-- 4. Quién ve el Padrón y quién lo escribe
-- ---------------------------------------------------------------------------
--
-- Dos acciones del catálogo, con el molde de siempre. Mirar el Padrón no queda reservado a la
-- administración: quien coordina necesita saber quién es la Persona que tiene delante. Escribirlo
-- sí, porque un Legajo mal cargado es una Persona que no existe y que después alguien va a citar.
-- Cada Prestadora mueve las dos perillas desde su Panel.
--
-- Ni la Familia ni el Asistente alcanzan el Padrón: `tiene_permiso` contesta que no a todo rol que
-- no sea administración o coordinación, así que falla cerrado sin escribir ninguna excepción.

INSERT INTO public.catalogo_acciones_permisos (accion, default_solo_admin, orden)
SELECT 'ver_padron', false, 14
 WHERE NOT EXISTS (
   SELECT 1 FROM public.catalogo_acciones_permisos WHERE accion = 'ver_padron'
 );

INSERT INTO public.catalogo_acciones_permisos (accion, default_solo_admin, orden)
SELECT 'editar_padron', true, 15
 WHERE NOT EXISTS (
   SELECT 1 FROM public.catalogo_acciones_permisos WHERE accion = 'editar_padron'
 );

ALTER TABLE public.legajos ENABLE ROW LEVEL SECURITY;

CREATE POLICY legajos_los_lee_su_organizacion
  ON public.legajos
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('ver_padron')
  );

CREATE POLICY legajos_los_carga_quien_puede
  ON public.legajos
  FOR INSERT
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('editar_padron')
  );

CREATE POLICY legajos_los_corrige_quien_puede
  ON public.legajos
  FOR UPDATE
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('editar_padron')
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('editar_padron')
  );

-- El permiso de tabla no es la RLS, y en este esquema una tabla nueva nace con todo dado a `anon`
-- y a `authenticated`. Se da lo que hace falta y nada más: nunca DELETE.
REVOKE ALL ON TABLE public.legajos FROM anon;
REVOKE ALL ON TABLE public.legajos FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.legajos TO authenticated;

DO $permisos$
DECLARE
  firma text;
BEGIN
  FOREACH firma IN ARRAY ARRAY[
    'interno.asignar_numero_de_legajo()',
    'interno.el_numero_de_legajo_no_cambia()',
    'interno.el_legajo_no_se_borra()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, "anon";', firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO "authenticated", "service_role";', firma);
  END LOOP;
END
$permisos$;

-- ---------------------------------------------------------------------------
-- 5. Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'legajos' AND rowsecurity
  ) THEN
    v_faltan := v_faltan || ' el Padron con sus reglas de acceso encendidas;';
  END IF;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'legajos') <> 3 THEN
    v_faltan := v_faltan || ' las tres politicas;';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'legajos'
       AND grantee IN ('anon', 'authenticated') AND privilege_type = 'DELETE'
  ) THEN
    v_faltan := v_faltan || ' el permiso de borrado, que no debia quedar;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.legajos'::regclass AND tgname = 'el_legajo_no_se_borra'
  ) THEN
    v_faltan := v_faltan || ' el disparador que impide borrar;';
  END IF;

  IF (SELECT count(*) FROM public.catalogo_acciones_permisos WHERE accion IN ('ver_padron', 'editar_padron')) <> 2 THEN
    v_faltan := v_faltan || ' las dos acciones del catalogo;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La migracion del Padron no quedo completa:%', v_faltan;
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- El registro de actividad: que hace la gente de una Prestadora
--
-- QUE PASABA HASTA ACA. Lo unico que quedaba anotado era lo que hace CeltaTech adentro de una
-- Prestadora: la sesion de soporte tecnico (`auditoria_soporte_tecnico`), y con el disparador
-- `fn_auditoria_soporte_mutacion()`, que arranca con `IF NOT es_sesion_soporte_activa() THEN
-- RETURN NULL` — o sea que fuera de esa sesion no escribe nada. Aparte quedaban dos casos
-- sueltos —`auditoria_asignaciones_con_aviso` y `auditoria_cambio_dueno_push`— y las
-- advertencias legales mostradas (`auditoria_advertencias_legales`).
--
-- Lo que hace todos los dias la gente de la Prestadora —quien entro, quien le dio de alta una
-- cuenta a quien, quien le cambio los permisos a quien, quien borro que, quien cambio la
-- moneda— no quedaba en ningun lado.
--
-- QUE QUEDA CON ESTO. Una sola tabla, `registro_actividad`, que contesta las cuatro preguntas:
-- quien, cuando, sobre que y que cambio. Cubre lo que pide la regla de la empresa
-- (`celtatech/CLAUDE.md`, «Seguridad, privacidad y auditoria»): entrada administrativa, cambios
-- de permisos o de membresia, borrado de datos, modificaciones criticas y toda accion con
-- consecuencia economica.
--
-- POR QUE NO SE AMPLIA `auditoria_soporte_tecnico`. Son dos cosas distintas y se leen distinto.
-- Aquella contesta «que hizo CeltaTech adentro de una Prestadora ajena» y su alcance es la
-- sesion de soporte; esta contesta «que hizo la gente de la Prestadora en su propia
-- Organizacion». Mezclarlas obligaria a filtrar por origen en cada lectura, y el dia que alguien
-- se olvide del filtro una de las dos preguntas queda mal contestada. La forma, en cambio, es la
-- misma a proposito: mismas columnas para quien, cuando, sobre que tabla y sobre que fila.
--
-- LO QUE NO ENTRA ACA, Y LA BASE LO HACE CUMPLIR. Ninguna clave, ningun dato de contenido,
-- ninguna direccion, ningun importe y ninguna remuneracion. Por eso el registro **no guarda
-- valores libres**: guarda que columnas cambiaron, y los pocos datos con nombre que si se
-- admiten salen de un catalogo (`catalogo_datos_del_registro`). Un dato que no este en ese
-- catalogo hace fallar la escritura. Una lista de lo prohibido se queda corta el primer dia; una
-- lista de lo permitido, no.
--
-- QUIEN ESCRIBE. Solamente el motor, que entra con la llave de servicio (decision escrita en el
-- `CLAUDE.md` de Careonys). No hay politica de INSERT para nadie con sesion: una fila de
-- auditoria que pueda escribir quien esta siendo auditado no prueba nada.
--
-- QUIEN NO PUEDE TOCARLA. Nadie, ni el motor. La ausencia de politica de UPDATE y de DELETE
-- alcanza para quien entra con el pase de una persona, pero no para la llave de servicio, que se
-- saltea las politicas. Por eso ademas hay un disparador que rechaza toda modificacion y todo
-- borrado.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El catalogo de acciones que se registran
--
-- Mismo molde que `catalogo_acciones_permisos`: la clave es opaca y el texto visible sale de las
-- traducciones del Panel, en los tres idiomas. Agregar una accion es una fila, no una version
-- nueva del producto.
--
-- El grupo dice a cual de los cinco casos de la regla de la empresa responde cada accion. Se
-- llama `grupo` y no de otra manera porque «familia» ya nombra otra cosa en este producto.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalogo_acciones_registradas (
  accion text PRIMARY KEY,
  grupo text NOT NULL,
  orden smallint NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalogo_acciones_registradas_grupo_conocido
    CHECK (grupo IN ('entrada_administrativa',
                     'permisos_y_membresia',
                     'borrado_de_datos',
                     'modificacion_critica',
                     'consecuencia_economica'))
);

COMMENT ON TABLE public.catalogo_acciones_registradas IS
  'Que acciones deja anotadas el registro de actividad. La clave es opaca: el texto visible vive en las traducciones del Panel, en los tres idiomas.';

COMMENT ON COLUMN public.catalogo_acciones_registradas.grupo IS
  'A cual de los cinco casos que pide la regla de la empresa responde esta accion.';

INSERT INTO public.catalogo_acciones_registradas (accion, grupo, orden) VALUES
  ('entrada_al_panel',                    'entrada_administrativa', 1),
  ('alta_de_cuenta_del_panel',            'permisos_y_membresia',   2),
  ('cambio_de_datos_de_cuenta_del_panel', 'permisos_y_membresia',   3),
  ('baja_de_cuenta_del_panel',            'permisos_y_membresia',   4),
  ('cambio_de_permisos_de_la_prestadora', 'permisos_y_membresia',   5),
  ('borrado_de_datos',                    'borrado_de_datos',       6),
  ('modificacion_critica',                'modificacion_critica',   7),
  ('cambio_de_moneda',                    'consecuencia_economica', 8)
ON CONFLICT (accion) DO NOTHING;

ALTER TABLE public.catalogo_acciones_registradas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cualquiera_lee_catalogo_acciones_registradas ON public.catalogo_acciones_registradas;
CREATE POLICY cualquiera_lee_catalogo_acciones_registradas ON public.catalogo_acciones_registradas
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.catalogo_acciones_registradas FROM anon;
REVOKE ALL ON TABLE public.catalogo_acciones_registradas FROM authenticated;
GRANT SELECT ON TABLE public.catalogo_acciones_registradas TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. El catalogo de datos que el registro admite
--
-- Es la lista de lo permitido, y la base la hace cumplir. Cada clave que se quiera guardar
-- adentro de `detalle` tiene que estar acá. Lo que no este, no entra.
--
-- Las ocho que nacen con el catalogo son todas opacas: nombres de rol, claves de permiso,
-- alcances, el codigo de una moneda y por donde entro el pedido. Ninguna es una clave, un
-- importe, una remuneracion, una direccion ni contenido de nadie.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalogo_datos_del_registro (
  clave text PRIMARY KEY,
  orden smallint NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.catalogo_datos_del_registro IS
  'Los unicos datos con nombre que el registro de actividad admite adentro de `detalle`. Lista de lo permitido, no de lo prohibido: lo que no figura acá hace fallar la escritura.';

INSERT INTO public.catalogo_datos_del_registro (clave, orden) VALUES
  ('rol_anterior',     1),
  ('rol_nuevo',        2),
  ('accion_permiso',   3),
  ('alcance_anterior', 4),
  ('alcance_nuevo',    5),
  ('moneda_anterior',  6),
  ('moneda_nueva',     7),
  ('metodo',           8),
  ('ruta',             9)
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE public.catalogo_datos_del_registro ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cualquiera_lee_catalogo_datos_del_registro ON public.catalogo_datos_del_registro;
CREATE POLICY cualquiera_lee_catalogo_datos_del_registro ON public.catalogo_datos_del_registro
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.catalogo_datos_del_registro FROM anon;
REVOKE ALL ON TABLE public.catalogo_datos_del_registro FROM authenticated;
GRANT SELECT ON TABLE public.catalogo_datos_del_registro TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. El registro
--
-- Las cuatro preguntas, columna por columna:
--
--   quien      -> usuario_id
--   cuando     -> created_at
--   sobre que  -> accion, tabla_afectada, registro_id
--   que cambio -> campos_cambiados, y detalle cuando el dato que cambio no es sensible
--
-- La Prestadora no se hereda por cascada de nada: el registro tiene que sobrevivir a lo que
-- registra, asi que la referencia no borra en cascada. Un Legajo borrado, una cuenta dada de
-- baja o una fila que ya no existe siguen teniendo su renglon acá.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.registro_actividad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  accion text NOT NULL REFERENCES public.catalogo_acciones_registradas(accion),
  tabla_afectada text,
  registro_id uuid,
  campos_cambiados text[],
  detalle jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.registro_actividad IS
  'Lo que hace la gente de una Prestadora: quien, cuando, sobre que y que cambio. Append-only: no se edita y no se borra, ni con la llave de servicio.';

COMMENT ON COLUMN public.registro_actividad.usuario_id IS
  'Quien hizo la accion. Lo pone el motor con la cuenta de la sesion comprobada, nunca con un valor que venga en el pedido.';

COMMENT ON COLUMN public.registro_actividad.accion IS
  'Que se hizo, en clave opaca del catalogo de acciones registradas.';

COMMENT ON COLUMN public.registro_actividad.tabla_afectada IS
  'Sobre que tabla, cuando la accion recae sobre una.';

COMMENT ON COLUMN public.registro_actividad.registro_id IS
  'Sobre que fila, cuando la accion recae sobre una. Se conserva aunque la fila ya no exista.';

COMMENT ON COLUMN public.registro_actividad.campos_cambiados IS
  'Que cambio: los nombres de las columnas que se tocaron, nunca sus valores. Es la forma de contestar «que cambio» sin guardar contenido de nadie.';

COMMENT ON COLUMN public.registro_actividad.detalle IS
  'Los pocos datos con nombre que el registro admite, que son los del catalogo de datos del registro. Ninguna clave, ningun importe, ninguna remuneracion, ninguna direccion y ningun contenido.';

CREATE INDEX IF NOT EXISTS idx_registro_actividad_prestadora
  ON public.registro_actividad (prestadora_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_registro_actividad_accion
  ON public.registro_actividad (prestadora_id, accion, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_registro_actividad_usuario
  ON public.registro_actividad (usuario_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Lo que no entra: el detalle sale del catalogo o no entra
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION interno.el_registro_de_actividad_solo_lleva_lo_permitido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, interno
AS $$
DECLARE
  v_clave text;
BEGIN
  IF NEW.detalle IS NULL THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.detalle) <> 'object' THEN
    RAISE EXCEPTION 'El detalle del registro de actividad tiene que ser un objeto';
  END IF;

  FOR v_clave IN SELECT jsonb_object_keys(NEW.detalle) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.catalogo_datos_del_registro WHERE clave = v_clave
    ) THEN
      RAISE EXCEPTION 'El registro de actividad no admite el dato %', v_clave;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION interno.el_registro_de_actividad_solo_lleva_lo_permitido() FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.el_registro_de_actividad_solo_lleva_lo_permitido() FROM anon;
GRANT EXECUTE ON FUNCTION interno.el_registro_de_actividad_solo_lleva_lo_permitido() TO service_role;

DROP TRIGGER IF EXISTS trg_registro_actividad_solo_lo_permitido ON public.registro_actividad;
CREATE TRIGGER trg_registro_actividad_solo_lo_permitido
  BEFORE INSERT ON public.registro_actividad
  FOR EACH ROW EXECUTE FUNCTION interno.el_registro_de_actividad_solo_lleva_lo_permitido();

-- ---------------------------------------------------------------------------
-- 5. Un registro de auditoria no se edita y no se borra
--
-- La ausencia de politica de UPDATE y de DELETE ya lo impide para quien entra con el pase de una
-- persona. El disparador esta para el otro caso: la llave de servicio con la que entra el motor
-- se saltea las politicas, y sin esto el mismo programa que escribe el registro podria
-- deshacerlo.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION interno.el_registro_de_actividad_no_se_toca()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, interno
AS $$
BEGIN
  RAISE EXCEPTION 'El registro de actividad no se edita y no se borra';
END;
$$;

REVOKE ALL ON FUNCTION interno.el_registro_de_actividad_no_se_toca() FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.el_registro_de_actividad_no_se_toca() FROM anon;
GRANT EXECUTE ON FUNCTION interno.el_registro_de_actividad_no_se_toca() TO service_role;
GRANT EXECUTE ON FUNCTION interno.el_registro_de_actividad_no_se_toca() TO authenticated;

DROP TRIGGER IF EXISTS trg_registro_actividad_no_se_toca ON public.registro_actividad;
CREATE TRIGGER trg_registro_actividad_no_se_toca
  BEFORE UPDATE OR DELETE ON public.registro_actividad
  FOR EACH ROW EXECUTE FUNCTION interno.el_registro_de_actividad_no_se_toca();

-- ---------------------------------------------------------------------------
-- 6. Quien lo lee
--
-- La Prestadora la resuelve `interno.current_tenant()`, que es el punto unico de verdad y toma
-- la sesion de soporte primero y la Organizacion propia despues. Nunca un valor del pedido.
--
-- Lo lee la administracion de la Prestadora sobre la que se esta parado, y el rol tecnico
-- cuando tiene abierta la sesion de soporte sobre ella. Quien coordina no: el registro dice que
-- hizo cada uno, y eso es de administracion. Falla cerrado: sin Prestadora resuelta,
-- `current_tenant()` no coincide con ninguna fila y no se ve nada.
--
-- No hay politica de INSERT, ni de UPDATE, ni de DELETE, y es a proposito.
-- ---------------------------------------------------------------------------

ALTER TABLE public.registro_actividad ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS administracion_lee_el_registro_de_actividad ON public.registro_actividad;
CREATE POLICY administracion_lee_el_registro_de_actividad ON public.registro_actividad
  FOR SELECT
  TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND (interno.es_superadmin() OR interno.es_admin_prestadora())
  );

REVOKE ALL ON TABLE public.registro_actividad FROM anon;
REVOKE ALL ON TABLE public.registro_actividad FROM authenticated;
GRANT SELECT ON TABLE public.registro_actividad TO authenticated;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_id uuid;
  v_prestadora uuid;
  v_usuario uuid;
  v_fallo boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'registro_actividad'
  ) THEN
    RAISE EXCEPTION 'El registro de actividad no quedo creado';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'registro_actividad'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'El registro de actividad quedo con alguna politica de escritura';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_registro_actividad_no_se_toca'
      AND tgrelid = 'public.registro_actividad'::regclass
  ) THEN
    RAISE EXCEPTION 'El registro de actividad quedo sin la guarda que impide editarlo y borrarlo';
  END IF;

  -- Que las dos guardas frenen de verdad, no que existan. Una comprobacion que no puede fallar
  -- no prueba nada: se escribe una fila, se intenta romperla y se deshace todo.
  SELECT id INTO v_prestadora FROM public.prestadoras LIMIT 1;
  SELECT id INTO v_usuario FROM public.usuarios LIMIT 1;

  IF v_prestadora IS NOT NULL AND v_usuario IS NOT NULL THEN
    v_fallo := false;
    BEGIN
      INSERT INTO public.registro_actividad (prestadora_id, usuario_id, accion, detalle)
      VALUES (v_prestadora, v_usuario, 'entrada_al_panel', jsonb_build_object('importe', 1));
    EXCEPTION WHEN others THEN
      v_fallo := true;
    END;
    IF NOT v_fallo THEN
      RAISE EXCEPTION 'El registro de actividad acepto un dato que no esta en el catalogo';
    END IF;

    INSERT INTO public.registro_actividad (prestadora_id, usuario_id, accion)
    VALUES (v_prestadora, v_usuario, 'entrada_al_panel')
    RETURNING id INTO v_id;

    v_fallo := false;
    BEGIN
      DELETE FROM public.registro_actividad WHERE id = v_id;
    EXCEPTION WHEN others THEN
      v_fallo := true;
    END;
    IF NOT v_fallo THEN
      RAISE EXCEPTION 'El registro de actividad se dejo borrar';
    END IF;

    v_fallo := false;
    BEGIN
      UPDATE public.registro_actividad SET accion = 'cambio_de_moneda' WHERE id = v_id;
    EXCEPTION WHEN others THEN
      v_fallo := true;
    END;
    IF NOT v_fallo THEN
      RAISE EXCEPTION 'El registro de actividad se dejo editar';
    END IF;

    -- La fila de prueba no puede quedar, y borrarla es justamente lo que el disparador impide.
    -- Se lo saltea por unica vez, adentro de la misma migracion que lo creo.
    ALTER TABLE public.registro_actividad DISABLE TRIGGER trg_registro_actividad_no_se_toca;
    DELETE FROM public.registro_actividad WHERE id = v_id;
    ALTER TABLE public.registro_actividad ENABLE TRIGGER trg_registro_actividad_no_se_toca;
  END IF;

  RAISE NOTICE 'El registro de actividad queda escribiendo quien, cuando, sobre que y que cambio.';
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

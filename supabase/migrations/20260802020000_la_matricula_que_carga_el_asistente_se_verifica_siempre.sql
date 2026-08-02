-- ============================================================================
-- La matrícula que carga el propio Asistente siempre necesita que alguien la
-- mire, aunque la Prestadora esté en modo flexible.
--
-- QUÉ HACE
-- Dos cosas. Agrega a `matriculas_asistente` una columna que dice si esa
-- matrícula la cargó el propio Asistente desde su aplicación o alguien de la
-- Prestadora desde el Panel. Y cambia la última decisión de
-- `motivo_bloqueo_matricula()`: si la cargó el Asistente, no alcanza con que
-- esté vigente — hace falta que esté verificada, sin importar el modo.
--
-- POR QUÉ HACE FALTA
-- Estamos por darle al Asistente un botón para subir su matrícula desde su
-- teléfono, que es lo razonable: el papel lo tiene él, no la oficina. Pero eso
-- abre un agujero que sin esta columna no se cierra. En modo flexible alcanza
-- con que la matrícula esté cargada y vigente para poder trabajar. Entonces un
-- Asistente sin matrícula podría escribir cualquier número, poner un
-- vencimiento lejano, y quedar habilitado solo. Se estaría dejando que el
-- interesado se apruebe a sí mismo.
--
-- El modo flexible existe para que la Prestadora pueda arrancar a trabajar
-- mientras termina de juntar los papeles de su gente. Ese permiso es de la
-- Prestadora sobre su propia carga administrativa, no del Asistente sobre su
-- propia matrícula. Esta migración marca esa diferencia.
--
-- Lo que el Asistente sube no se pierde ni se rechaza: queda cargado, visible
-- para la Prestadora, esperando que alguien lo verifique. Lo único que no hace
-- es habilitarlo solo.
--
-- POR QUÉ UNA COLUMNA Y NO MIRAR SI `registrado_por` ESTÁ VACÍO
-- Se podría deducir: si nadie del Panel lo registró, lo cargó el Asistente. Es
-- cierto hoy y deja de serlo el día que aparezca cualquier otra vía de carga
-- —una importación, una migración de datos de otro sistema— que tampoco tenga
-- un usuario del Panel detrás. La columna dice lo que quiere decir y se lee
-- sin tener que reconstruir el razonamiento.
--
-- POR QUÉ ES UNA MIGRACIÓN NUEVA Y NO UNA CORRECCIÓN DE LA ANTERIOR
-- Porque la anterior ya está aplicada, y una migración aplicada no se edita
-- jamás (`MIGRACIONES.md` §4). La función se reemplaza entera con
-- CREATE OR REPLACE, que es la forma normal de cambiar una función en
-- Postgres.
--
-- CÓMO SE VUELVE ATRÁS
-- Con otra migración hacia adelante que vuelva a dejar la función con la
-- condición vieja. La columna puede quedarse: no molesta a nadie y no borra
-- nada. Al momento de aplicar esto la tabla está vacía (0 filas), así que no
-- hay ninguna matrícula ya cargada cuyo significado cambie.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. De dónde vino la matrícula
-- ---------------------------------------------------------------------------

ALTER TABLE public.matriculas_asistente
  ADD COLUMN IF NOT EXISTS cargada_por_el_asistente boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.matriculas_asistente.cargada_por_el_asistente IS
  'Verdadero si la subió el propio Asistente desde su aplicación. Esas siempre necesitan verificación, aunque la Prestadora esté en modo flexible: el interesado no se aprueba a sí mismo.';


-- ---------------------------------------------------------------------------
-- 2. La regla, con la única línea que cambia
--
--    Todo el cuerpo es idéntico al de la migración
--    20260801180000_regla_matricula_vigente.sql. Se repite entero porque
--    Postgres no sabe reemplazar media función. Lo único distinto está al
--    final, y está señalado ahí mismo.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.motivo_bloqueo_matricula(
  p_asistente_id uuid,
  p_dia date DEFAULT CURRENT_DATE
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prestadora_id  uuid;
  v_requiere       boolean;
  v_tipo_matricula text;
  v_modo           text;
  v_tiene_alguna   boolean;
  v_vigente        public.matriculas_asistente%ROWTYPE;
BEGIN
  IF p_asistente_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT a.prestadora_id, t.requiere_matricula, t.tipo_matricula
    INTO v_prestadora_id, v_requiere, v_tipo_matricula
    FROM public.asistentes a
    LEFT JOIN public.tipos_asistente t ON t.id = a.tipo_asistente_id
   WHERE a.id = p_asistente_id;

  -- No existe, no tiene tipo cargado, o su tipo no exige matrícula: la regla no
  -- lo alcanza. Ver el encabezado sobre por qué la falta de tipo no bloquea.
  IF v_requiere IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  SELECT p.modo_control_matricula INTO v_modo
    FROM public.prestadoras p
   WHERE p.id = v_prestadora_id;
  v_modo := COALESCE(v_modo, 'estricto');

  -- ¿Tiene alguna matrícula del tipo que su tipo de Asistente exige? Se
  -- pregunta por separado de "¿tiene una vigente?" porque los dos casos se
  -- resuelven distinto: uno hay que pedirlo, el otro hay que renovarlo.
  SELECT EXISTS (
    SELECT 1 FROM public.matriculas_asistente m
     WHERE m.asistente_id = p_asistente_id
       AND m.tipo = v_tipo_matricula
  ) INTO v_tiene_alguna;

  IF NOT v_tiene_alguna THEN
    RETURN 'sin_matricula';
  END IF;

  -- La que está vigente ese día. Si hubiera varias —pasa cuando se carga la
  -- renovación antes de que caiga la anterior— manda la que vence más tarde, y
  -- la que no vence nunca gana siempre.
  SELECT m.* INTO v_vigente
    FROM public.matriculas_asistente m
   WHERE m.asistente_id = p_asistente_id
     AND m.tipo = v_tipo_matricula
     AND (m.vigente_desde IS NULL OR m.vigente_desde <= p_dia)
     AND (m.vigente_hasta IS NULL OR m.vigente_hasta >= p_dia)
   ORDER BY (m.vigente_hasta IS NULL) DESC, m.vigente_hasta DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'vencida';
  END IF;

  -- ACÁ ESTÁ EL CAMBIO. Antes decía solamente `v_modo = 'estricto'`. Ahora la
  -- verificación también se exige cuando la matrícula la subió el propio
  -- Asistente, porque en modo flexible cargarla sería habilitarse solo.
  IF (v_modo = 'estricto' OR v_vigente.cargada_por_el_asistente)
     AND v_vigente.verificada_at IS NULL THEN
    RETURN 'sin_verificar';
  END IF;

  RETURN NULL;
END;
$$;


NOTIFY pgrst, 'reload schema';

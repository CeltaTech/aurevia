-- ============================================================================
-- La regla dura: sin matrícula vigente y verificada, el Asistente no atiende a
-- nadie.
--
-- QUÉ HACE
-- Tres cosas. Primero, conecta al Asistente con su tipo, que es lo que dice si
-- necesita matrícula o no. Segundo, escribe la regla una sola vez, como una
-- función de la base. Tercero, la hace cumplir en las cuatro puertas por las
-- que un Asistente puede terminar frente a un Paciente.
--
-- POR QUÉ LA REGLA VIVE EN LA BASE Y NO EN LA PANTALLA
-- Las cuatro puertas son distintas y algunas ni siquiera pasan por el Panel:
-- se le asigna una guardia desde el Panel, se lo invita a cubrir un hueco
-- desde el Panel, pero **él acepta desde su teléfono**, y mañana puede haber
-- una quinta puerta que todavía no existe. Si la regla estuviera escrita en
-- cada pantalla, alcanzaría con olvidarse de una para que un Asistente sin
-- matrícula termine en la casa de un Paciente. Escrita acá, la puerta que se
-- olviden de cerrar se cierra sola (regla 12 de `CLAUDE.md` §7).
--
-- POR QUÉ DISPARADORES Y NO POLÍTICAS DE SEGURIDAD (RLS)
-- Una política de seguridad sabe decir que no, pero no sabe decir por qué:
-- devuelve "cero filas" y la pantalla muestra un error genérico o, peor, no
-- muestra nada. La regla de este pendiente es explícita en que **nunca se
-- bloquea en silencio**: el motivo tiene que estar siempre a la vista. Un
-- disparador puede levantar un mensaje con el motivo adentro, y la pantalla lo
-- traduce y lo muestra al lado del nombre. Por eso son disparadores.
--
-- LOS TRES MOTIVOS, Y POR QUÉ SON TRES Y NO UNO
--   sin_matricula  → nunca cargó la matrícula que su tipo exige.
--   vencida        → la cargó, pero ya no está vigente para ese día.
--   sin_verificar  → está cargada y vigente, pero nadie de la Prestadora la
--                    dio por buena todavía.
-- Se separan porque lo que hay que hacer en cada caso es distinto, y quien
-- mira la pantalla necesita saber cuál de las tres cosas le toca: pedirle el
-- papel, pedirle el papel nuevo, o entrar a verificar el que ya está cargado.
-- Un solo motivo genérico ("no habilitado") obligaría a investigar cada vez.
--
-- QUIÉN NO QUEDA ALCANZADO, A PROPÓSITO
-- El Asistente que **no tiene tipo cargado** no se bloquea. Es el mismo
-- criterio que ya usa `panel/src/lib/candidatos.js` con el nivel de
-- complejidad del Paciente: bloquear por un dato que ni siquiera está cargado
-- dejaría a un Paciente sin nadie por un descuido administrativo, que es peor
-- que el riesgo que se quiere evitar. Cuando el tipo se carga, la regla
-- empieza a correr sola. Hoy los 44 Asistentes que hay en la base están sin
-- tipo, así que esta migración **no bloquea a nadie el día que se aplica**:
-- empieza a tener efecto a medida que se les asigna el tipo.
--
-- POR QUÉ LA REGLA SE MIRA SOLO CUANDO CAMBIA EL ASISTENTE DE UNA GUARDIA
-- Está decidido que si a alguien se le vence la matrícula y ya tenía guardias
-- futuras, esas guardias **no se cancelan solas**: aparecen como descubiertas,
-- con el motivo escrito, y una persona decide qué hacer. Si el disparador
-- revisara la regla en cada cambio de la fila, tocar cualquier otra columna de
-- esas guardias —corregir un horario, marcar un check-in— fallaría, y el
-- sistema quedaría trabado justo cuando hay que resolver el problema. Por eso
-- la revisión corre en el alta y cuando **cambia el Asistente**, no siempre.
--
-- Y por lo mismo: si la matrícula se vence mientras el Asistente está
-- trabajando, la guardia en curso termina. Nada acá la interrumpe.
--
-- CONTRA QUÉ DÍA SE MIRA
-- Contra el día en que la guardia **termina**, no el día en que empieza. La
-- guardia de noche empieza el 10 a las 22:00 y termina el 11 a las 06:00: una
-- matrícula que vence el 10 dejaría al Asistente trabajando seis horas sin
-- ella. Es el mismo criterio que ya usa `panel/src/lib/avisosAsignacion.js`
-- para los papeles que vencen.
--
-- ESTRICTO O FLEXIBLE, EN UN SOLO LUGAR
-- Todavía no está contestado qué exige la ley por "verificar" (pendiente #107
-- de `docs/PENDIENTES.md`). Se construye la versión estricta —hace falta que
-- alguien la verifique— porque aflojar después es cambiar una configuración, y
-- endurecer después obliga a revisar todo lo ya cargado. La perilla es
-- `prestadoras.modo_control_matricula` y la lee **únicamente** esta función: el
-- día que la respuesta legal la afloje, se cambia el valor y no se toca una
-- sola línea de código.
--
-- LO QUE ESTE ARCHIVO NO TRAE
-- Las pantallas. Los avisos al Asistente en su aplicación, el contador en el
-- Estado actual de la Prestadora y el motivo al lado del nombre cuando se
-- intenta asignar son trabajo del Panel y de la aplicación del Asistente, y se
-- apoyan todos en la vista `estado_matricula_asistente` que queda creada acá.
--
-- CÓMO SE VUELVE ATRÁS
-- No borra ni cambia ningún dato. Agrega una columna a `asistentes`, una a
-- `prestadoras`, dos funciones, dos disparadores y una vista. Para revertir,
-- una migración nueva hacia adelante que los borre — nunca editando esta
-- (`MIGRACIONES.md` §4).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. El vínculo entre el Asistente y su tipo
--
--    Sin esto la regla no se puede evaluar: "¿necesita matrícula?" es una
--    propiedad del tipo (`tipos_asistente.requiere_matricula`), no de la
--    persona.
--
--    Queda opcional a propósito — ver el encabezado. Y no reemplaza todavía a
--    `asistentes.especialidades`, que es otra cosa (en qué es bueno, no qué
--    es) y que tiene su propio pendiente.
-- ---------------------------------------------------------------------------

ALTER TABLE public.asistentes
  ADD COLUMN IF NOT EXISTS tipo_asistente_id uuid
  REFERENCES public.tipos_asistente(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.asistentes.tipo_asistente_id IS
  'Qué ES este Asistente: cuidador, enfermero, kinesiólogo… Sale del catálogo de dos niveles. Vacío significa "todavía no se cargó", y en ese caso la regla de matrícula no lo alcanza.';

-- La pregunta "¿de qué tipo es?" se hace por Asistente, pero la de "¿a quiénes
-- alcanza este tipo?" se hace al borrar o desactivar un tipo, y sin índice
-- recorre la tabla entera.
CREATE INDEX IF NOT EXISTS idx_asistentes_tipo
  ON public.asistentes (tipo_asistente_id)
  WHERE tipo_asistente_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 2. La perilla: estricto o flexible
--
--    Va en `prestadoras` y no en una tabla nueva porque ahí ya viven las otras
--    reglas de operación de cada Prestadora
--    (`dias_aviso_vencimiento_documentos`, `politica_verificacion_alta_manual`).
--    Inventarle una segunda casa a la misma clase de decisión es exactamente
--    lo que la regla 12 evita.
--
--      estricto → hace falta matrícula vigente Y verificada por alguien de la
--                 Prestadora. Es el valor de arranque.
--      flexible → alcanza con que esté cargada y vigente. La falta de
--                 verificación sigue avisando, pero no impide trabajar.
-- ---------------------------------------------------------------------------

ALTER TABLE public.prestadoras
  ADD COLUMN IF NOT EXISTS modo_control_matricula text NOT NULL DEFAULT 'estricto';

ALTER TABLE public.prestadoras
  DROP CONSTRAINT IF EXISTS prestadoras_modo_control_matricula_check;

ALTER TABLE public.prestadoras
  ADD CONSTRAINT prestadoras_modo_control_matricula_check
  CHECK (modo_control_matricula IN ('estricto', 'flexible'));

COMMENT ON COLUMN public.prestadoras.modo_control_matricula IS
  'Si para trabajar hace falta que la matrícula esté verificada (estricto) o alcanza con que esté cargada y vigente (flexible). Lo lee una sola función: motivo_bloqueo_matricula().';


-- ---------------------------------------------------------------------------
-- 3. La regla, escrita una sola vez
--
--    Devuelve NULL cuando el Asistente puede trabajar ese día, y si no, una de
--    las tres palabras: 'sin_matricula', 'vencida', 'sin_verificar'.
--
--    Devuelve una palabra y no una frase a propósito: el Panel está en tres
--    idiomas y el texto sale de los archivos de traducción, nunca de la base
--    (regla 1 de `CLAUDE.md` §7).
--
--    Es STABLE y no VOLATILE porque dentro de una misma consulta el resultado
--    no cambia: eso le permite a Postgres llamarla una vez por fila en lugar
--    de una vez por uso.
--
--    SECURITY DEFINER: la función tiene que poder mirar la matrícula del
--    Asistente aunque quien dispara la operación no llegue a esa fila por sus
--    permisos. No filtra nada — devuelve una de tres palabras sobre un
--    Asistente cuyo identificador quien pregunta ya tiene en la mano. El
--    `search_path` queda fijado para que nadie pueda cambiar a qué tablas
--    apunta.
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

  IF v_modo = 'estricto' AND v_vigente.verificada_at IS NULL THEN
    RETURN 'sin_verificar';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.motivo_bloqueo_matricula(uuid, date) IS
  'Punto único de verdad de la regla dura de matrícula. NULL = ese día puede trabajar. Si no: sin_matricula, vencida o sin_verificar. Devuelve la palabra, nunca el texto: la traducción vive en el Panel.';

REVOKE ALL ON FUNCTION public.motivo_bloqueo_matricula(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.motivo_bloqueo_matricula(uuid, date) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. El día en que una guardia termina
--
--    `guardias` guarda una fecha y dos horas. La guardia que empieza a las
--    22:00 y termina a las 06:00 termina **al día siguiente**, y comparar
--    contra `fecha` a secas dejaría pasar justo el caso que hay que atajar.
--    Esta cuenta ya existe en `panel/src/lib/horarios.js` para el Panel; acá
--    hace falta también del lado de la base, y se escribe una sola vez para
--    que las dos digan lo mismo.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dia_en_que_termina_guardia(
  p_fecha date,
  p_hora_inicio time,
  p_hora_fin time
)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN p_hora_fin IS NULL OR p_hora_inicio IS NULL THEN p_fecha
           WHEN p_hora_fin <= p_hora_inicio                 THEN p_fecha + 1
           ELSE p_fecha
         END;
$$;

COMMENT ON FUNCTION public.dia_en_que_termina_guardia(date, time, time) IS
  'El día en que termina una guardia. La de noche cruza la medianoche: 22:00 a 06:00 del 10 termina el 11.';


-- ---------------------------------------------------------------------------
-- 5. Puerta 1 — asignarle una guardia
--
--    Se revisa en el alta y cuando cambia el Asistente de una guardia que ya
--    existe. Nunca en otros cambios: ver el encabezado.
--
--    El mensaje de error lleva el motivo entre dos marcas para que la pantalla
--    lo pueda sacar sin adivinar. `ERRCODE` es el de "violación de una regla
--    de integridad", que es exactamente lo que pasó.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.exigir_matricula_en_guardia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_motivo text;
BEGIN
  IF NEW.asistente_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.asistente_id IS NOT DISTINCT FROM OLD.asistente_id THEN
    RETURN NEW;
  END IF;

  v_motivo := public.motivo_bloqueo_matricula(
    NEW.asistente_id,
    public.dia_en_que_termina_guardia(NEW.fecha, NEW.hora_inicio, NEW.hora_fin)
  );

  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION 'matricula_bloquea:%:', v_motivo
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exigir_matricula_en_guardia ON public.guardias;
CREATE TRIGGER trg_exigir_matricula_en_guardia
  BEFORE INSERT OR UPDATE ON public.guardias
  FOR EACH ROW EXECUTE FUNCTION public.exigir_matricula_en_guardia();


-- ---------------------------------------------------------------------------
-- 6. Puertas 2 y 3 — que se le ofrezca la guardia, y que la acepte
--
--    Son dos momentos distintos y hacen falta los dos. Entre la invitación y
--    la respuesta pueden pasar días, y la matrícula puede vencerse justo en el
--    medio: si solo se revisara al invitar, el Asistente aceptaría el lunes una
--    guardia que el viernes ya no podía hacer.
--
--    Al aceptar se mira contra el día en que **termina** la guardia invitada,
--    igual que en la puerta 1.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.exigir_matricula_en_oferta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_motivo text;
  v_dia    date;
BEGIN
  -- Al invitar se mira contra hoy; al aceptar, contra el final de la guardia.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.respuesta IS DISTINCT FROM 'acepta'
       OR NEW.respuesta IS NOT DISTINCT FROM OLD.respuesta THEN
      RETURN NEW;
    END IF;

    SELECT public.dia_en_que_termina_guardia(g.fecha, g.hora_inicio, g.hora_fin)
      INTO v_dia
      FROM public.guardias g
     WHERE g.id = NEW.guardia_id;
  ELSE
    v_dia := CURRENT_DATE;
  END IF;

  v_motivo := public.motivo_bloqueo_matricula(NEW.asistente_id, COALESCE(v_dia, CURRENT_DATE));

  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION 'matricula_bloquea:%:', v_motivo
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exigir_matricula_en_oferta ON public.ofertas_guardia;
CREATE TRIGGER trg_exigir_matricula_en_oferta
  BEFORE INSERT OR UPDATE ON public.ofertas_guardia
  FOR EACH ROW EXECUTE FUNCTION public.exigir_matricula_en_oferta();


-- ---------------------------------------------------------------------------
-- 7. La cuarta puerta, y de dónde salen los tres avisos
--
--    La cuarta puerta es la lista de candidatos para cubrir un hueco: ahí el
--    Asistente bloqueado **no desaparece**, aparece al final con el motivo
--    escrito. Eso lo resuelve el Panel (`panel/src/lib/candidatos.js`), porque
--    la lista se arma sobre datos ya cargados en pantalla y sin volver a la
--    base.
--
--    Para que el Panel y la aplicación del Asistente no vuelvan a escribir la
--    regla por su cuenta, esta vista entrega ya masticado el estado de cada
--    Asistente: si le hace falta matrícula, si está bloqueado y por qué, cuándo
--    se le vence y cuántos días faltan.
--
--    `security_invoker = true` es lo que hace que la vista respete las mismas
--    reglas de aislamiento que las tablas de abajo: quien consulta ve
--    únicamente los Asistentes de su Prestadora, igual que si consultara
--    `asistentes` directamente. Sin esa opción, la vista correría con los
--    permisos de quien la creó y sería un agujero entre Prestadoras.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.estado_matricula_asistente
WITH (security_invoker = true) AS
SELECT
  a.id                AS asistente_id,
  a.prestadora_id,
  a.nombre,
  a.tipo_asistente_id,
  t.requiere_matricula,
  t.tipo_matricula,
  public.motivo_bloqueo_matricula(a.id) AS motivo_bloqueo,
  m.id                AS matricula_id,
  m.vigente_hasta,
  m.verificada_at,
  CASE
    WHEN m.vigente_hasta IS NULL THEN NULL
    ELSE (m.vigente_hasta - CURRENT_DATE)
  END                 AS dias_para_vencer
FROM public.asistentes a
LEFT JOIN public.tipos_asistente t
       ON t.id = a.tipo_asistente_id
LEFT JOIN LATERAL (
  SELECT mm.*
    FROM public.matriculas_asistente mm
   WHERE mm.asistente_id = a.id
     AND mm.tipo = t.tipo_matricula
     AND (mm.vigente_desde IS NULL OR mm.vigente_desde <= CURRENT_DATE)
   ORDER BY (mm.vigente_hasta IS NULL) DESC, mm.vigente_hasta DESC
   LIMIT 1
) m ON true
WHERE a.deleted_at IS NULL;

COMMENT ON VIEW public.estado_matricula_asistente IS
  'Cómo está la matrícula de cada Asistente, ya resuelta: si le hace falta, si está bloqueado y por qué, cuándo vence y cuántos días faltan. La consultan el Estado actual de la Prestadora y la aplicación del Asistente, para que ninguno vuelva a escribir la regla por su cuenta.';

GRANT SELECT ON public.estado_matricula_asistente TO authenticated;
GRANT SELECT ON public.estado_matricula_asistente TO service_role;


NOTIFY pgrst, 'reload schema';

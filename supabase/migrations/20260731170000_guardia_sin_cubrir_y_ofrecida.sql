-- ============================================================================
-- Etapa 1 del rediseño del Panel — la guardia puede existir sin Asistente.
--
-- QUÉ HACE
-- Permite que una guardia (y una serie de guardias) exista sin nadie asignado
-- todavía, y que la Prestadora la publique como disponible para que un
-- Asistente la tome.
--
-- POR QUÉ (esto es lo que no se puede reconstruir leyendo el esquema)
-- Hasta hoy `guardias.asistente_id` era obligatorio. En la práctica eso quiere
-- decir que el sistema no tiene forma de representar el problema más común de
-- una Prestadora: "el martes a la mañana no tengo a nadie para este Paciente".
-- El hueco de cobertura simplemente no existía como dato, así que ninguna
-- pantalla podía mostrarlo y ningún proceso podía avisarlo. Se comprobó el
-- 2026-07-31, antes de escribir esto: no hay un solo endpoint en el backend que
-- cree o edite una guardia — la única inserción viva está en
-- generacionSeriesGuardia.js:91 — y toda la validación de "hace falta un
-- Asistente" vivía en el frontend del Panel.
--
-- EL EFECTO COLATERAL QUE HAY QUE ARREGLAR EN LA MISMA MIGRACIÓN
-- La política RLS `coordinador_gestiona_guardias_de_su_zona` decidía qué ve un
-- Coordinador comparando sus zonas contra las zonas del Asistente de la
-- guardia. Sin Asistente no hay zonas que comparar, la comparación da NULL y la
-- guardia se vuelve invisible — justo para la persona cuyo trabajo es tapar el
-- hueco. Por eso la política se reescribe acá y no en otra migración: si esto
-- se aplicara solo, las guardias sin cubrir quedarían ocultas.
--
-- LO QUE ESTE ARCHIVO NO TRAE
-- El circuito por el cual el Asistente ve la guardia ofrecida en su aplicación
-- y la toma. Acá quedan la columna, la regla y el permiso de lectura; la
-- pantalla y el "tomar la guardia" son tarea aparte.
--
-- CÓMO SE VUELVE ATRÁS
-- No borra datos. Para revertir hay que volver a poner NOT NULL en las dos
-- columnas (solo posible si no quedó ninguna guardia sin cubrir), soltar las
-- restricciones nuevas y restaurar la política anterior, en una migración nueva
-- hacia adelante — nunca editando esta (MIGRACIONES.md §4).
-- ============================================================================


-- ============================================================================
-- 1. Las dos columnas dejan de ser obligatorias
--
--    Van juntas a propósito. `series_guardias` es el molde del que
--    generacionSeriesGuardia.js copia cada guardia nueva: si se relajara solo
--    `guardias` y no el molde, no se podría crear una serie sin Asistente; y si
--    se relajara solo el molde, el proceso que extiende el horizonte fallaría
--    al insertar y el único rastro sería un console.error que nadie mira.
-- ============================================================================
ALTER TABLE guardias        ALTER COLUMN asistente_id DROP NOT NULL;
ALTER TABLE series_guardias ALTER COLUMN asistente_id DROP NOT NULL;

COMMENT ON COLUMN guardias.asistente_id IS
  'NULL = guardia sin cubrir. Es un estado normal y esperado, no un dato faltante.';
COMMENT ON COLUMN series_guardias.asistente_id IS
  'NULL = serie sin Asistente fijo. Las guardias que genera nacen sin cubrir.';


-- ============================================================================
-- 2. Publicar la guardia como disponible
--
--    `ofrecida_at` es la fecha en que la Prestadora la publicó. NULL = todavía
--    no se publicó. Se limpia cuando alguien la toma, porque una guardia con
--    Asistente ya no está disponible para nadie más (lo garantiza la
--    restricción de más abajo, no la buena voluntad del código).
-- ============================================================================
ALTER TABLE guardias ADD COLUMN IF NOT EXISTS ofrecida_at  TIMESTAMPTZ;
ALTER TABLE guardias ADD COLUMN IF NOT EXISTS ofrecida_por UUID REFERENCES usuarios(id);

COMMENT ON COLUMN guardias.ofrecida_at IS
  'Fecha en que la guardia se publicó como disponible para los Asistentes. NULL = no publicada.';
COMMENT ON COLUMN guardias.ofrecida_por IS
  'Usuario del Panel que la publicó.';


-- ============================================================================
-- 3. Barandas — lo que la base no deja que pase aunque el código se equivoque
--
--    Una guardia sin cubrir es un hueco en la agenda: puede estar programada o
--    cancelada, y nada más. No puede estar "activa" (nadie la está haciendo),
--    ni "completada" (nadie la hizo), ni "ausente" (no hay quien faltara).
--
--    Esta última es la importante: sin esta baranda, el proceso automático de
--    ausencias marcaría cada hueco como "un Asistente faltó sin avisar" y
--    dispararía la alerta más grave del sistema contra nadie.
-- ============================================================================
ALTER TABLE guardias
  ADD CONSTRAINT guardias_sin_cubrir_estado_check
  CHECK (asistente_id IS NOT NULL OR estado IN ('programada', 'cancelada'));

-- Sin Asistente no hay quien marque llegada ni salida.
ALTER TABLE guardias
  ADD CONSTRAINT guardias_sin_cubrir_sin_marcas_check
  CHECK (
    asistente_id IS NOT NULL
    OR (checkin_at IS NULL AND checkout_at IS NULL AND salida_checkin_at IS NULL)
  );

-- Solo se ofrece lo que está sin cubrir.
ALTER TABLE guardias
  ADD CONSTRAINT guardias_ofrecida_solo_sin_cubrir_check
  CHECK (ofrecida_at IS NULL OR asistente_id IS NULL);


-- ============================================================================
-- 4. Índice para buscar huecos
--
--    Índice parcial: solo indexa las filas sin cubrir, que son la minoría. La
--    pregunta "¿qué huecos tengo esta semana?" es la que va a hacer el Panel
--    todo el tiempo.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_guardias_sin_cubrir
  ON guardias (prestadora_id, fecha)
  WHERE asistente_id IS NULL;


-- ============================================================================
-- 5. Qué guardias alcanza un Coordinador — punto único de verdad
--
--    Antes esta decisión estaba escrita dentro de la política RLS. Ahora vive
--    en una función, que es la forma de tener un solo lugar donde cambiarla
--    (CLAUDE.md §7.12): las políticas de Postgres no pueden llamar código JS,
--    así que el punto único de verdad tiene que ser una función SQL.
--
--    La regla: un Coordinador alcanza una guardia si comparte zona con el
--    Asistente asignado, y SIEMPRE alcanza las que no tienen Asistente. Un
--    hueco no pertenece a ninguna zona porque la zona salía del Asistente, y
--    esconderle los huecos al Coordinador sería esconderle su propio trabajo.
--    Además, una guardia sin cubrir no contiene ningún dato personal de un
--    Asistente que haya que proteger de otro Coordinador.
-- ============================================================================
CREATE OR REPLACE FUNCTION coordinador_alcanza_guardia(p_asistente_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_asistente_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM usuarios u
        WHERE u.id = auth.uid()
          AND u.zonas && zonas_de_asistente(p_asistente_id)
      );
$$;

COMMENT ON FUNCTION coordinador_alcanza_guardia(UUID) IS
  'Única fuente de verdad para saber si un Coordinador alcanza una guardia. TRUE siempre que la guardia esté sin cubrir; si tiene Asistente, exige zona compartida.';

GRANT EXECUTE ON FUNCTION coordinador_alcanza_guardia(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "coordinador_gestiona_guardias_de_su_zona" ON guardias;

CREATE POLICY "coordinador_gestiona_guardias_de_su_zona" ON guardias
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'coordinador'
    )
    AND coordinador_alcanza_guardia(guardias.asistente_id)
  );


-- ============================================================================
-- 6. El Asistente ve las guardias publicadas
--
--    `asistente_ve_sus_guardias` compara asistente_id = auth.uid(): contra NULL
--    esa comparación nunca da verdadero, así que una guardia sin cubrir es
--    invisible para todos los Asistentes. Correcto por defecto — pero entonces
--    publicarla no serviría de nada. Esta política agrega la única excepción:
--    si está sin cubrir Y publicada, cualquier Asistente de esa misma
--    Prestadora puede verla. Solo lectura; tomarla es otra cosa y todavía no
--    existe.
-- ============================================================================
CREATE POLICY "asistente_ve_guardias_ofrecidas" ON guardias
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND asistente_id IS NULL
    AND ofrecida_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM asistentes a WHERE a.id = auth.uid())
  );


NOTIFY pgrst, 'reload schema';

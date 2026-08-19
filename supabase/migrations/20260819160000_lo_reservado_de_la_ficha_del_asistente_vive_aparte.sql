-- Lo reservado de la ficha del Asistente pasa a vivir en una tabla propia.
--
-- El problema es el mismo que se arregló esta mañana con lo que se le paga, en otras cinco
-- columnas de `asistentes`: `causal_baja` (por qué se lo dio de baja),
-- `score_riesgo_reclasificacion` e `indicadores_riesgo` (el puntaje de riesgo y los motivos
-- que lo forman) y `motivo_exclusion_directo` / `motivo_exclusion_marketplace` (por qué
-- quedó excluido de recibir trabajo). Las reglas de acceso de la base (RLS) deciden a qué
-- FILAS contesta, no a qué COLUMNAS: cualquiera que ya podía ver la ficha del Asistente
-- leía además estos cinco datos, aunque su pantalla no se los mostrara. La vista
-- `asistentes_coordinador` los omite, pero esa vista es solo lo que la pantalla consulta;
-- la tabla sigue contestando a quien le pregunte con su propia sesión.
--
-- Son cinco datos que pueden perjudicar a una persona si circulan: el §6 de CLAUDE.md
-- nombra expresamente las causales de cese entre los datos sensibles.
--
-- El arreglo: se mudan a `datos_reservados_asistente`, que por ser una tabla aparte puede
-- tener su propia regla de acceso. Esa regla consulta `tiene_permiso`, el mismo interruptor
-- que la Prestadora maneja desde la pantalla de permisos, con una acción nueva
-- `ver_datos_reservados_asistente` que arranca cerrada para la Coordinadora. Queda escrita
-- una sola vez y alcanza a cualquiera que pregunte: pantalla nuestra, pantalla futura o
-- consulta directa a la base.
--
-- Los otros siete datos que la vista omite (`tipo_vinculo`, `fecha_baja`, `canales`,
-- `horas_semanales`, `importacion_id`, `pendiente_conformidad`, `prestadora_id`) se quedan
-- donde están a propósito: la Coordinadora los necesita para trabajar.

-- ---------------------------------------------------------------------------
-- 1. La tabla nueva. Conserva los valores por defecto y el rango 0-100 que las
--    columnas traían, para que nada de lo que ya funcionaba cambie de forma.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS datos_reservados_asistente (
  asistente_id                  UUID PRIMARY KEY REFERENCES asistentes(id) ON DELETE CASCADE,
  prestadora_id                 UUID NOT NULL REFERENCES prestadoras(id),
  causal_baja                   TEXT,
  score_riesgo_reclasificacion  INTEGER NOT NULL DEFAULT 0
    CHECK (score_riesgo_reclasificacion >= 0 AND score_riesgo_reclasificacion <= 100),
  indicadores_riesgo            JSONB NOT NULL DEFAULT '{}'::jsonb,
  motivo_exclusion_directo      TEXT,
  motivo_exclusion_marketplace  TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE datos_reservados_asistente IS
  'Lo reservado de la ficha del Asistente: por qué se lo dio de baja, su puntaje de riesgo con los motivos que lo forman, y por qué quedó excluido de recibir trabajo. Vive separado de `asistentes` porque las reglas de acceso de la base filtran filas, no columnas: solo en una tabla propia se puede exigir el permiso `ver_datos_reservados_asistente` para leerlo.';

CREATE INDEX IF NOT EXISTS idx_datos_reservados_asistente_prestadora
  ON datos_reservados_asistente (prestadora_id);

-- ---------------------------------------------------------------------------
-- 2. Se mudan los datos que ya existían. Solo viajan las fichas que tienen algo
--    cargado: un puntaje en cero y un objeto vacío son la ausencia de dato.
-- ---------------------------------------------------------------------------
INSERT INTO datos_reservados_asistente (
  asistente_id, prestadora_id, causal_baja, score_riesgo_reclasificacion,
  indicadores_riesgo, motivo_exclusion_directo, motivo_exclusion_marketplace
)
SELECT id, prestadora_id, causal_baja, COALESCE(score_riesgo_reclasificacion, 0),
       COALESCE(indicadores_riesgo, '{}'::jsonb), motivo_exclusion_directo, motivo_exclusion_marketplace
FROM asistentes
WHERE causal_baja IS NOT NULL
   OR COALESCE(score_riesgo_reclasificacion, 0) <> 0
   OR COALESCE(indicadores_riesgo, '{}'::jsonb) <> '{}'::jsonb
   OR motivo_exclusion_directo IS NOT NULL
   OR motivo_exclusion_marketplace IS NOT NULL
ON CONFLICT (asistente_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. La regla que impide a la Coordinadora tocar los datos laborales nombra
--    columnas que dejan de existir: se la vuelve a escribir sin ellas. Lo que se
--    muda queda protegido por las reglas de la tabla nueva, que no le dan a la
--    Coordinadora ninguna forma de escribir.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bloquear_edicion_laboral_coordinador()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  rol_actual TEXT;
BEGIN
  SELECT rol INTO rol_actual FROM usuarios WHERE id = auth.uid();

  IF rol_actual = 'coordinador' THEN
    IF NEW.tipo_vinculo IS DISTINCT FROM OLD.tipo_vinculo
      OR NEW.horas_semanales IS DISTINCT FROM OLD.horas_semanales
      OR NEW.fecha_baja IS DISTINCT FROM OLD.fecha_baja
    THEN
      RAISE EXCEPTION 'Coordinador no puede modificar datos laborales internos del Asistente (regla 8 de CLAUDE.md)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Se retiran las columnas de la tabla original.
-- ---------------------------------------------------------------------------
ALTER TABLE asistentes
  DROP COLUMN IF EXISTS causal_baja,
  DROP COLUMN IF EXISTS score_riesgo_reclasificacion,
  DROP COLUMN IF EXISTS indicadores_riesgo,
  DROP COLUMN IF EXISTS motivo_exclusion_directo,
  DROP COLUMN IF EXISTS motivo_exclusion_marketplace;

-- ---------------------------------------------------------------------------
-- 5. El interruptor nuevo, en el mismo catálogo que los otros ocho. Arranca
--    cerrado: si la Prestadora no configura nada, solo lo ve la administración.
-- ---------------------------------------------------------------------------
INSERT INTO catalogo_acciones_permisos (accion, default_solo_admin, orden)
VALUES ('ver_datos_reservados_asistente', TRUE, 9)
ON CONFLICT (accion) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Quién puede entrar a la tabla nueva.
--    La puerta (GRANT) se abre solo para sesiones autenticadas y para el motor;
--    nunca para visitantes anónimos. La cerradura (RLS) decide después.
-- ---------------------------------------------------------------------------
ALTER TABLE datos_reservados_asistente ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON datos_reservados_asistente TO authenticated;
GRANT ALL ON datos_reservados_asistente TO service_role;

-- Leer: hay que pertenecer a la misma Prestadora, tener abierto el permiso y poder ver a
-- ese Asistente. Lo último no se vuelve a escribir: el EXISTS consulta `asistentes`, y esa
-- consulta arrastra las reglas que esa tabla ya tiene (Prestadora propia, zona de la
-- Coordinadora, conformidad pendiente).
CREATE POLICY lee_datos_reservados_quien_tiene_el_permiso
  ON datos_reservados_asistente
  FOR SELECT
  USING (
    prestadora_id = current_tenant()
    AND tiene_permiso('ver_datos_reservados_asistente')
    AND EXISTS (
      SELECT 1 FROM asistentes a WHERE a.id = datos_reservados_asistente.asistente_id
    )
  );

-- Escribir: solo la administración de la Prestadora. El permiso habilita a mirar, nunca a
-- cambiar la causa de una baja ni un puntaje de riesgo.
CREATE POLICY carga_datos_reservados_solo_la_administracion
  ON datos_reservados_asistente
  FOR INSERT
  WITH CHECK (
    prestadora_id = current_tenant()
    AND (es_superadmin() OR es_admin_prestadora())
  );

CREATE POLICY edita_datos_reservados_solo_la_administracion
  ON datos_reservados_asistente
  FOR UPDATE
  USING (
    prestadora_id = current_tenant()
    AND (es_superadmin() OR es_admin_prestadora())
  )
  WITH CHECK (
    prestadora_id = current_tenant()
    AND (es_superadmin() OR es_admin_prestadora())
  );

CREATE POLICY borra_datos_reservados_solo_la_administracion
  ON datos_reservados_asistente
  FOR DELETE
  USING (
    prestadora_id = current_tenant()
    AND (es_superadmin() OR es_admin_prestadora())
  );

-- Toda modificación queda registrada, igual que en las demás tablas del sistema.
DROP TRIGGER IF EXISTS trg_auditoria_soporte ON datos_reservados_asistente;
CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON datos_reservados_asistente
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_soporte_mutacion();

NOTIFY pgrst, 'reload schema';

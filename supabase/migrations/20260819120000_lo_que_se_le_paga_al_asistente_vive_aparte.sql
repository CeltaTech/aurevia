-- Lo que se le paga al Asistente pasa a vivir en una tabla propia.
--
-- El problema: las columnas `valor_hora`, `sueldo_basico` y `categoria_cct` estaban
-- dentro de la tabla `asistentes`. Las reglas de acceso de la base (RLS) deciden a qué
-- FILAS contesta, no a qué COLUMNAS, así que cualquiera que ya podía ver la ficha del
-- Asistente podía además leer lo que cobra. Medido en la base local: una Coordinadora
-- con el permiso `ver_pagos_asistente` cerrado obtenía igual los importes, y una Familia
-- también. El §6 de CLAUDE.md prohíbe exponer remuneraciones.
--
-- El arreglo: los tres datos se mudan a `remuneraciones_asistente`, que es una tabla
-- aparte y por lo tanto puede tener su propia regla de acceso. Esa regla consulta
-- `tiene_permiso('ver_pagos_asistente')`, el mismo interruptor que la Prestadora maneja
-- desde la pantalla de permisos. Queda escrita una sola vez y alcanza a cualquiera que
-- pregunte: pantalla nuestra, pantalla futura o consulta directa a la base.
--
-- De paso se retira la regla `familia_ve_asistente_asignado`, que le entregaba a la
-- Familia la ficha entera del Asistente. Ninguna pantalla de la aplicación de Familias
-- consulta esa tabla —todo lo pide por el motor—, así que era una puerta abierta que
-- nadie usaba.

-- ---------------------------------------------------------------------------
-- 1. Una sola definición de "es el administrador de la Prestadora".
--    Hasta ahora esa condición estaba copiada dentro de cada regla. La regla 12 de
--    CLAUDE.md pide una única fuente de verdad; acá empieza a haberla.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION es_admin_prestadora()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
  );
$$;

COMMENT ON FUNCTION es_admin_prestadora() IS
  'Verdadero si quien consulta es el administrador de una Prestadora. Única definición: las reglas de acceso la llaman en lugar de repetir la consulta.';

-- ---------------------------------------------------------------------------
-- 2. La tabla nueva.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remuneraciones_asistente (
  asistente_id   UUID PRIMARY KEY REFERENCES asistentes(id) ON DELETE CASCADE,
  prestadora_id  UUID NOT NULL REFERENCES prestadoras(id),
  valor_hora     NUMERIC(12,2),
  sueldo_basico  NUMERIC(12,2),
  categoria_cct  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE remuneraciones_asistente IS
  'Lo que cobra cada Asistente. Vive separado de `asistentes` porque las reglas de acceso de la base filtran filas, no columnas: solo en una tabla propia se puede exigir el permiso `ver_pagos_asistente` para leerlo.';

CREATE INDEX IF NOT EXISTS idx_remuneraciones_asistente_prestadora
  ON remuneraciones_asistente (prestadora_id);

-- ---------------------------------------------------------------------------
-- 3. Se mudan los datos que ya existían.
-- ---------------------------------------------------------------------------
INSERT INTO remuneraciones_asistente (asistente_id, prestadora_id, valor_hora, sueldo_basico, categoria_cct)
SELECT id, prestadora_id, valor_hora, sueldo_basico, categoria_cct
FROM asistentes
WHERE valor_hora IS NOT NULL
   OR sueldo_basico IS NOT NULL
   OR categoria_cct IS NOT NULL
ON CONFLICT (asistente_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. La regla que impide a la Coordinadora tocar los datos laborales dejaba de
--    compilar al desaparecer las columnas: se la vuelve a escribir sin ellas.
--    Los tres datos mudados quedan protegidos por las reglas de la tabla nueva.
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
      OR NEW.causal_baja IS DISTINCT FROM OLD.causal_baja
      OR NEW.fecha_baja IS DISTINCT FROM OLD.fecha_baja
      OR NEW.score_riesgo_reclasificacion IS DISTINCT FROM OLD.score_riesgo_reclasificacion
      OR NEW.indicadores_riesgo IS DISTINCT FROM OLD.indicadores_riesgo
    THEN
      RAISE EXCEPTION 'Coordinador no puede modificar datos laborales internos del Asistente (regla 8 de CLAUDE.md)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Se retiran las columnas de la tabla original.
-- ---------------------------------------------------------------------------
ALTER TABLE asistentes
  DROP COLUMN IF EXISTS valor_hora,
  DROP COLUMN IF EXISTS sueldo_basico,
  DROP COLUMN IF EXISTS categoria_cct;

-- ---------------------------------------------------------------------------
-- 6. Quién puede entrar a la tabla nueva.
--    La puerta (GRANT) se abre solo para sesiones autenticadas y para el motor;
--    nunca para visitantes anónimos. La cerradura (RLS) decide después.
-- ---------------------------------------------------------------------------
ALTER TABLE remuneraciones_asistente ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON remuneraciones_asistente TO authenticated;
GRANT ALL ON remuneraciones_asistente TO service_role;

-- Leer: hay que pertenecer a la misma Prestadora, tener abierto el permiso
-- `ver_pagos_asistente` y poder ver a ese Asistente. Lo último no se vuelve a escribir:
-- el EXISTS consulta `asistentes`, y esa consulta arrastra las reglas que esa tabla ya
-- tiene (Prestadora propia, zona de la Coordinadora, conformidad pendiente).
CREATE POLICY lee_remuneraciones_quien_tiene_el_permiso
  ON remuneraciones_asistente
  FOR SELECT
  USING (
    prestadora_id = current_tenant()
    AND tiene_permiso('ver_pagos_asistente')
    AND EXISTS (
      SELECT 1 FROM asistentes a WHERE a.id = remuneraciones_asistente.asistente_id
    )
  );

-- Escribir: solo la administración de la Prestadora. El permiso `ver_pagos_asistente`
-- habilita a mirar, nunca a cambiar lo que se paga.
CREATE POLICY carga_remuneraciones_solo_la_administracion
  ON remuneraciones_asistente
  FOR INSERT
  WITH CHECK (
    prestadora_id = current_tenant()
    AND (es_superadmin() OR es_admin_prestadora())
  );

CREATE POLICY edita_remuneraciones_solo_la_administracion
  ON remuneraciones_asistente
  FOR UPDATE
  USING (
    prestadora_id = current_tenant()
    AND (es_superadmin() OR es_admin_prestadora())
  )
  WITH CHECK (
    prestadora_id = current_tenant()
    AND (es_superadmin() OR es_admin_prestadora())
  );

CREATE POLICY borra_remuneraciones_solo_la_administracion
  ON remuneraciones_asistente
  FOR DELETE
  USING (
    prestadora_id = current_tenant()
    AND (es_superadmin() OR es_admin_prestadora())
  );

-- Toda modificación queda registrada, igual que en las otras 38 tablas del sistema.
DROP TRIGGER IF EXISTS trg_auditoria_soporte ON remuneraciones_asistente;
CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON remuneraciones_asistente
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_soporte_mutacion();

-- ---------------------------------------------------------------------------
-- 7. La Familia deja de tener acceso directo a la ficha del Asistente.
--    Su aplicación nunca consulta esta tabla: todo lo pide por el motor.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS familia_ve_asistente_asignado ON asistentes;

-- ---------------------------------------------------------------------------
-- 8. Las dos reglas de `asistentes` que repetían la definición de administrador
--    pasan a usar la función única.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS panel_edita_asistentes ON asistentes;
CREATE POLICY panel_edita_asistentes
  ON asistentes
  FOR ALL
  USING (
    prestadora_id = current_tenant()
    AND (es_superadmin() OR es_admin_prestadora())
  )
  WITH CHECK (
    prestadora_id = current_tenant()
    AND (es_superadmin() OR es_admin_prestadora())
  );

DROP POLICY IF EXISTS admin_lee_asistentes ON asistentes;
CREATE POLICY admin_lee_asistentes
  ON asistentes
  FOR SELECT
  USING (
    prestadora_id = current_tenant()
    AND (es_superadmin() OR es_admin_prestadora())
  );

NOTIFY pgrst, 'reload schema';

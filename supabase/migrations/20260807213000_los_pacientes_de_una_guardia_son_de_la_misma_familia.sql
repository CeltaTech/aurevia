-- ============================================================================
-- Todos los Pacientes de una guardia tienen que ser de la misma Familia
--
-- QUÉ PROBLEMA ARREGLA. La guardia siempre tuvo una regla: el Servicio que
-- factura y el Paciente que atiende tienen que ser de la misma Familia. Esa
-- regla vivía en un disparador de la tabla `guardias`, y se disparaba cuando se
-- escribía la columna `paciente_id`.
--
-- Al pasar la lista de Pacientes a su propia tabla (`guardia_pacientes`), esa
-- lista quedó fuera del alcance del disparador: se podía agregar a la lista de
-- un turno a alguien de otra Familia, y la base lo aceptaba. El camino viejo lo
-- rechazaba y el camino nuevo lo dejaba pasar — la misma operación con dos
-- respuestas distintas, que es exactamente lo que la regla 12 de CLAUDE.md §7
-- pide no tener.
--
-- QUÉ HACE ESTA MIGRACIÓN. Saca la comprobación a una función propia y la
-- cuelga de las dos tablas. Una sola definición de la regla, dos lugares que la
-- llaman: si mañana la regla cambia, cambia en un archivo.
--
-- Las series (`series_guardias_pacientes`) quedan igual de cubiertas, por el
-- mismo motivo y con el mismo disparador.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. La regla, escrita una sola vez
--
--    Recibe los dos ids y no la fila entera, justamente para que la puedan
--    llamar tablas con forma distinta: la guardia tiene el Servicio y el
--    Paciente en la misma fila; la lista de Pacientes tiene el Paciente en la
--    fila y el Servicio hay que ir a buscarlo a la guardia.
--
--    Sin Servicio no hay nada que comparar y la operación pasa: una guardia
--    puede existir antes de saber contra qué Servicio se factura.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION exigir_paciente_y_servicio_de_la_misma_familia(
  p_paciente_id UUID,
  p_servicio_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  familia_paciente UUID;
  familia_servicio UUID;
BEGIN
  IF p_servicio_id IS NULL THEN
    RETURN;
  END IF;

  SELECT familia_id INTO familia_paciente FROM pacientes WHERE id = p_paciente_id;
  SELECT familia_id INTO familia_servicio FROM servicios WHERE id = p_servicio_id;

  IF familia_paciente IS NULL OR familia_servicio IS NULL OR familia_paciente <> familia_servicio THEN
    RAISE EXCEPTION 'El Servicio indicado no pertenece a la misma Familia que el Paciente';
  END IF;
END;
$$;

COMMENT ON FUNCTION exigir_paciente_y_servicio_de_la_misma_familia(UUID, UUID) IS
  'La regla de que un Servicio solo factura Pacientes de su propia Familia, escrita una sola vez. La llaman los disparadores de guardias, guardia_pacientes y series_guardias_pacientes.';

-- ----------------------------------------------------------------------------
-- 2. El disparador viejo de `guardias` pasa a llamar a la regla en vez de
--    llevar su propia copia. El disparador en sí no se toca: sigue siendo el
--    mismo `validar_servicio_guardias`, con el mismo nombre.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validar_servicio_misma_familia()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM exigir_paciente_y_servicio_de_la_misma_familia(NEW.paciente_id, NEW.servicio_id);
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. La misma regla, ahora también sobre la lista de Pacientes de una guardia
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validar_paciente_de_guardia_misma_familia()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  servicio UUID;
BEGIN
  SELECT servicio_id INTO servicio FROM guardias WHERE id = NEW.guardia_id;
  PERFORM exigir_paciente_y_servicio_de_la_misma_familia(NEW.paciente_id, servicio);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_familia_guardia_pacientes ON guardia_pacientes;
CREATE TRIGGER validar_familia_guardia_pacientes
  BEFORE INSERT OR UPDATE ON guardia_pacientes
  FOR EACH ROW EXECUTE FUNCTION validar_paciente_de_guardia_misma_familia();

-- ----------------------------------------------------------------------------
-- 4. Y sobre la lista de Pacientes de una serie, que es la plantilla de la que
--    salen las guardias: si la plantilla ya está mal, todas las guardias que
--    genere van a nacer mal.
--
--    Acá la comprobación es distinta porque la serie no guarda contra qué
--    Servicio se factura — eso lo decide cada guardia. Lo que sí se puede
--    exigir es que toda la gente de una misma serie sea de la misma Familia:
--    una plantilla es "ir a esta casa estos días", y una casa es una Familia.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validar_paciente_de_serie_misma_familia()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  familia_de_la_serie UUID;
  familia_del_paciente UUID;
BEGIN
  SELECT p.familia_id INTO familia_de_la_serie
    FROM series_guardias s JOIN pacientes p ON p.id = s.paciente_id
   WHERE s.id = NEW.serie_id;

  SELECT familia_id INTO familia_del_paciente FROM pacientes WHERE id = NEW.paciente_id;

  IF familia_de_la_serie IS NULL OR familia_del_paciente IS NULL
     OR familia_de_la_serie <> familia_del_paciente THEN
    RAISE EXCEPTION 'Todos los Pacientes de una serie tienen que ser de la misma Familia';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_familia_series_guardias_pacientes ON series_guardias_pacientes;
CREATE TRIGGER validar_familia_series_guardias_pacientes
  BEFORE INSERT OR UPDATE ON series_guardias_pacientes
  FOR EACH ROW EXECUTE FUNCTION validar_paciente_de_serie_misma_familia();

NOTIFY pgrst, 'reload schema';


-- Corrige advisory de seguridad (search_path mutable en funciones SECURITY DEFINER):
-- sin SET search_path fijo, un caller podría manipular el search_path de su sesión
-- para que la función resuelva nombres de tabla/función contra un schema atacante.
CREATE OR REPLACE FUNCTION public.bloquear_edicion_laboral_coordinador()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  rol_actual TEXT;
BEGIN
  SELECT rol INTO rol_actual FROM usuarios WHERE id = auth.uid();

  IF rol_actual = 'coordinador' THEN
    IF NEW.tipo_vinculo IS DISTINCT FROM OLD.tipo_vinculo
      OR NEW.categoria_cct IS DISTINCT FROM OLD.categoria_cct
      OR NEW.valor_hora IS DISTINCT FROM OLD.valor_hora
      OR NEW.sueldo_basico IS DISTINCT FROM OLD.sueldo_basico
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
$function$;

CREATE OR REPLACE FUNCTION public.marcar_prestaciones_a_revisar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF NEW.precio IS DISTINCT FROM OLD.precio THEN
    UPDATE prestaciones
    SET requiere_revision = true
    WHERE precio_lista_id = NEW.id AND estado = 'vigente';
  END IF;
  RETURN NEW;
END;
$function$;
;

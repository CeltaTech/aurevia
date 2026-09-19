-- ---------------------------------------------------------------------------------------
-- EL ESTADO SE RESUELVE, NO SE PISA
-- ---------------------------------------------------------------------------------------
--
-- QUÉ FALTABA. La migración `20261001100000_las_resoluciones.sql` construyó la única puerta:
-- `public.resolver` escribe la fila con el motivo y la firma, y deja el estado igual en la tabla
-- resuelta. Pero la puerta no sirve mientras la pared siga abierta: cualquiera con permiso sobre
-- `postulaciones` o `solicitudes` podía seguir escribiendo `update({ estado })` y la decisión
-- quedaba otra vez sin quién, sin cuándo y sin por qué.
--
-- QUÉ HACE ESTO. Un disparador sobre esas dos tablas: el `estado` sólo puede quedar en lo que diga
-- la última resolución de esa misma fila. Como `resolver` escribe la resolución antes del UPDATE y
-- en la misma transacción, lo que pasa por la puerta entra sin enterarse; lo que se escribe a mano
-- se planta, porque no hay ninguna resolución que diga ese estado.
--
-- SÓLO ESAS DOS. Son las que quedaron cableadas en el Panel. Las alertas, las guardias canceladas
-- y las autorizaciones dadas de baja siguen como estaban hasta que les toque: cerrarles la escritura
-- antes de cablear sus pantallas las dejaría sin forma de resolver nada.
--
-- POR QUÉ NO ES `SECURITY DEFINER`. Está prohibido para un disparador: sumaría código corriendo con
-- privilegio de dueño y le sacaría la protección por fila a lo que consulta por dentro. Corre con el
-- pase de quien escribe, así que la lectura de `resoluciones` pasa por su política y no puede
-- contestar sobre otra Prestadora. De eso se sigue que quien no alcance a leer las resoluciones
-- tampoco puede escribir el estado: es fallar cerrado, que es la respuesta correcta.
--
-- POR QUÉ VIVE EN `interno`. Una función de `public` es además una dirección web, porque PostgREST
-- publica ese esquema. Y es la misma función para las dos tablas —`TG_TABLE_NAME` dice cuál—, para
-- que la regla no quede escrita dos veces.
--
-- POR QUÉ SÓLO CUANDO EL ESTADO CAMBIA. La condición `WHEN` deja pasar sin mirar todo lo demás: la
-- nota interna, el lugar reconocido, la Familia o el Asistente que se enganchan después. Lo que se
-- cierra es el estado, no la tabla.
--
-- CÓMO SE VUELVE ATRÁS, si hiciera falta:
--   DROP TRIGGER IF EXISTS el_estado_se_resuelve_no_se_pisa ON public.postulaciones;
--   DROP TRIGGER IF EXISTS el_estado_se_resuelve_no_se_pisa ON public.solicitudes;
--   DROP FUNCTION IF EXISTS interno.el_estado_se_resuelve_no_se_pisa();
-- ---------------------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION interno.el_estado_se_resuelve_no_se_pisa() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'interno'
    AS $$
DECLARE
  v_estado_resuelto text;
BEGIN
  -- La última resolución de esta misma fila. `created_at` no alcanza para desempatar dentro de una
  -- transacción, así que desempata la secuencia, igual que en `resoluciones_vigentes`.
  SELECT r.estado
    INTO v_estado_resuelto
    FROM public.resoluciones r
   WHERE r.prestadora_id = NEW.prestadora_id
     AND r.tabla = TG_TABLE_NAME
     AND r.fila_id = NEW.id::text
   ORDER BY r.created_at DESC, r.secuencia DESC
   LIMIT 1;

  IF v_estado_resuelto IS NULL OR v_estado_resuelto IS DISTINCT FROM NEW.estado THEN
    RAISE EXCEPTION 'el_estado_se_resuelve_no_se_pisa';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION interno.el_estado_se_resuelve_no_se_pisa() OWNER TO postgres;
REVOKE ALL ON FUNCTION interno.el_estado_se_resuelve_no_se_pisa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.el_estado_se_resuelve_no_se_pisa() TO authenticated, service_role;

COMMENT ON FUNCTION interno.el_estado_se_resuelve_no_se_pisa() IS
  'Impide escribir el estado a mano: solo queda el que diga la ultima resolucion de esa fila, que escribe public.resolver con el motivo y la firma de quien decidio.';

DROP TRIGGER IF EXISTS el_estado_se_resuelve_no_se_pisa ON public.postulaciones;
CREATE TRIGGER el_estado_se_resuelve_no_se_pisa
  BEFORE UPDATE ON public.postulaciones
  FOR EACH ROW
  WHEN (NEW.estado IS DISTINCT FROM OLD.estado)
  EXECUTE FUNCTION interno.el_estado_se_resuelve_no_se_pisa();

DROP TRIGGER IF EXISTS el_estado_se_resuelve_no_se_pisa ON public.solicitudes;
CREATE TRIGGER el_estado_se_resuelve_no_se_pisa
  BEFORE UPDATE ON public.solicitudes
  FOR EACH ROW
  WHEN (NEW.estado IS DISTINCT FROM OLD.estado)
  EXECUTE FUNCTION interno.el_estado_se_resuelve_no_se_pisa();

COMMIT;

NOTIFY pgrst, 'reload schema';

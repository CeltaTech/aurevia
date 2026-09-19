-- ---------------------------------------------------------------------------------------
-- UNA GUARDIA SE CANCELA CON MOTIVO, Y EL MOTIVO SALE DEL CATÁLOGO
-- ---------------------------------------------------------------------------------------
--
-- QUÉ ESTABA MAL. `20261001100000_las_resoluciones.sql` armó el mecanismo y lo estrenó en las
-- postulaciones y en las solicitudes, y dejó anotado que el resto se pasaba después, una por una.
-- Ésta es la siguiente: cancelar una Guardia. Hasta hoy el Panel escribía
-- `update({ estado: 'cancelada', cancelacion_origen, cancelacion_alcance })` —de a una en el
-- detalle de la Guardia, y de a muchas desde la pantalla de entrada— y no quedaba nada más: ni
-- quién lo decidió, ni cuándo, ni por qué. Las dos columnas que sí se guardaban contestan otra
-- pregunta: quién pidió la cancelación y hasta dónde llega, que no es lo mismo que por qué.
--
-- QUÉ HACE ESTO. Le agrega a la siembra los motivos que trae el producto para cancelar una
-- Guardia. Nada más: el mecanismo ya está escrito y las pantallas ya lo llaman. Sin estos motivos
-- el desplegable saldría vacío y no se podría cancelar ninguna Guardia.
--
-- POR QUÉ SE VUELVE A ESCRIBIR LA FUNCIÓN ENTERA. Porque una migración aplicada no se edita. La
-- lista de siembra vive adentro de la función, así que agregar motivos es reemplazarla completa
-- con la lista nueva. La que manda es siempre la última.
--
-- POR QUÉ NO SE PISA NADA. La siembra lleva `ON CONFLICT DO NOTHING` y el índice único es
-- (prestadora_id, tabla, nombre en castellano): volver a correrla sobre una Prestadora que ya
-- tiene sus motivos no toca ninguno, y lo que ella haya editado, apagado o reordenado queda como
-- está. Por eso se la puede llamar de nuevo para todas las que ya están cargadas.
--
-- POR QUÉ EL DISPARADOR DE `20261001180000` NO SE ESTIRA HASTA `guardias`, Y NO ES UN OLVIDO.
-- Ese disparador impide que alguien escriba `estado` a mano en `postulaciones` y `solicitudes`, y
-- su propio encabezado dice por qué son sólo esas dos: cerrarle la escritura a una tabla antes de
-- que todas sus pantallas resuelvan la dejaría sin forma de cambiar de estado. En `guardias` eso
-- no es una etapa que falte: es permanente. La columna `estado` de una Guardia la escribe también
-- el motor cuando el Asistente marca su llegada y su salida desde el teléfono
-- (`backend/src/routes/appAsistentes.js`, en el check-in y en el check-out), y eso no es una
-- resolución que nadie firme con un motivo: es un hecho que pasó. Cerrar esa columna dejaría a los
-- Asistentes sin poder marcar que llegaron. El mismo cuidado vale para el cierre a mano de una
-- Guardia que quedó sin salida marcada, que ya guarda quién la cerró, cuándo y por qué.
--
-- CÓMO SE VUELVE ATRÁS, si hiciera falta:
--   DELETE FROM public.motivos_resolucion WHERE tabla = 'guardias'
--     AND NOT EXISTS (SELECT 1 FROM public.resoluciones r WHERE r.motivo_id = motivos_resolucion.id);
--   -- y se vuelve a poner la versión de `sembrar_motivos_resolucion` de 20261001100000.
-- ---------------------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.sembrar_motivos_resolucion(p_prestadora_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO motivos_resolucion
    (prestadora_id, tabla, estado, nombre_es_ar, nombre_en, nombre_pt_br, pide_detalle, orden)
  VALUES
    -- Postulaciones.
    (p_prestadora_id, 'postulaciones', 'en_revision',
     'Pasa a revisión', 'Moves to review', 'Passa para análise', false, 10),
    (p_prestadora_id, 'postulaciones', 'aprobado',
     'Reúne lo que el puesto pide', 'Meets what the role requires', 'Atende ao que a vaga exige', false, 20),
    (p_prestadora_id, 'postulaciones', 'rechazado',
     'No reúne la experiencia pedida', 'Does not have the required experience', 'Não tem a experiência exigida', false, 30),
    (p_prestadora_id, 'postulaciones', 'rechazado',
     'Queda fuera de las zonas cubiertas', 'Outside the areas covered', 'Fora das áreas atendidas', false, 40),
    (p_prestadora_id, 'postulaciones', 'rechazado',
     'No se presentó a la entrevista', 'Did not attend the interview', 'Não compareceu à entrevista', false, 50),
    (p_prestadora_id, 'postulaciones', 'rechazado',
     'Pidió retirar su postulación', 'Asked to withdraw the application', 'Pediu para retirar a candidatura', false, 60),
    (p_prestadora_id, 'postulaciones', 'rechazado',
     'Otro motivo', 'Other reason', 'Outro motivo', true, 99),
    -- Solicitudes.
    (p_prestadora_id, 'solicitudes', 'en_gestion',
     'Se toma para gestionar', 'Taken up for handling', 'Assumida para tratamento', false, 10),
    (p_prestadora_id, 'solicitudes', 'asignada',
     'Se arma la Guardia con un Asistente', 'The Shift is set up with an Assistant', 'O Plantão foi montado com um Assistente', false, 20),
    (p_prestadora_id, 'solicitudes', 'completada',
     'El Servicio quedó en marcha', 'The Service is up and running', 'O Serviço está em andamento', false, 30),
    (p_prestadora_id, 'solicitudes', 'cancelada',
     'La Familia desistió', 'The Family withdrew', 'A Família desistiu', false, 40),
    (p_prestadora_id, 'solicitudes', 'cancelada',
     'Queda fuera de las zonas cubiertas', 'Outside the areas covered', 'Fora das áreas atendidas', false, 50),
    (p_prestadora_id, 'solicitudes', 'cancelada',
     'No se pudo ubicar a quien llamó', 'The caller could not be reached', 'Não foi possível localizar quem entrou em contato', false, 60),
    (p_prestadora_id, 'solicitudes', 'cancelada',
     'Otro motivo', 'Other reason', 'Outro motivo', true, 99),
    -- Guardias. Por ahora sólo las canceladas: es la decisión que se toma mirando la Guardia y que
    -- hasta hoy no dejaba rastro. La llegada y la salida las escribe el motor cuando pasan, y no
    -- se resuelven con un motivo porque no son una decisión sino un hecho.
    (p_prestadora_id, 'guardias', 'cancelada',
     'La Familia la dio de baja', 'The Family cancelled it', 'A Família cancelou', false, 10),
    (p_prestadora_id, 'guardias', 'cancelada',
     'El Paciente quedó internado', 'The Patient was admitted to hospital', 'O Paciente ficou internado', false, 20),
    (p_prestadora_id, 'guardias', 'cancelada',
     'No se consiguió quién la cubriera', 'Nobody could be found to cover it', 'Não foi possível encontrar quem cobrisse', false, 30),
    (p_prestadora_id, 'guardias', 'cancelada',
     'Terminó el Servicio', 'The Service ended', 'O Serviço terminou', false, 40),
    (p_prestadora_id, 'guardias', 'cancelada',
     'Se había cargado por error', 'It had been entered by mistake', 'Tinha sido cadastrado por engano', false, 50),
    (p_prestadora_id, 'guardias', 'cancelada',
     'Otro motivo', 'Other reason', 'Outro motivo', true, 99)
  ON CONFLICT DO NOTHING;
END;
$$;

ALTER FUNCTION public.sembrar_motivos_resolucion(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sembrar_motivos_resolucion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sembrar_motivos_resolucion(uuid) TO service_role;

COMMENT ON FUNCTION public.sembrar_motivos_resolucion(uuid) IS
  'Carga los motivos de resolucion que trae el producto para una Prestadora. No pisa ninguno: lo que ella ya edito queda como esta.';

-- Las que ya están cargadas se quedaron sin los motivos nuevos, porque la siembra anterior corrió
-- sin ellos. Se las vuelve a sembrar: lo que ya tienen no se toca.
SELECT public.sembrar_motivos_resolucion(id) FROM public.prestadoras;

-- ---------------------------------------------------------------------------
-- Que ninguna Prestadora quede sin poder cancelar una Guardia
-- ---------------------------------------------------------------------------
--
-- Sin motivos para `guardias` el desplegable de la pantalla sale vacío y la cancelación queda
-- trabada. Es exactamente lo que esta migración viene a evitar, así que se comprueba acá y no el
-- día que alguien lo descubra en la pantalla.

DO $comprobacion$
DECLARE
  v_faltan text;
BEGIN
  SELECT string_agg(p.nombre_fantasia, ', ')
    INTO v_faltan
    FROM public.prestadoras p
   WHERE NOT EXISTS (
     SELECT 1 FROM public.motivos_resolucion m
      WHERE m.prestadora_id = p.id AND m.tabla = 'guardias'
   );

  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Estas Prestadoras no podrian cancelar ninguna Guardia: %', v_faltan;
  END IF;
END; $comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

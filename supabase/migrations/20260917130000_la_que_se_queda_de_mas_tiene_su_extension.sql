-- La que se queda de más tiene su extensión, y un botón para decir que no puede seguir.
-- =====================================================================================
--
-- QUÉ FALTABA. Cuando el relevo no llega, la Asistente que está adentro no se va: se queda con el
-- Paciente hasta que aparezca alguien. Eso pasa hoy, en la vida real, y el producto no lo sabía.
-- El turno terminaba a las ocho de la mañana en la pantalla y ella seguía en la casa hasta el
-- mediodía sin que quedara constancia en ningún lado: ni de que estaba, ni desde cuándo, ni de
-- cuántas horas se quedó de más. Un turno que se estira y no se escribe es trabajo que no se paga
-- y una responsabilidad que nadie asumió.
--
-- QUÉ SE AGREGA. Una fila que se abre sola cuando el turno de alguien pasó su hora de fin y el que
-- venía después no arrancó, y que se cierra cuando llega el relevo o cuando ella finalmente se va.
-- Adentro de esa fila vive además el «no puedo continuar»: el único botón que tiene para decir que
-- ella misma tiene una emergencia.
--
-- ESTO NO LA LIBERA, Y NO ES UN OLVIDO. Quedarse hasta el relevo es un deber del oficio —irse deja
-- al Paciente solo, y eso la expone a ella—, así que el producto no le pregunta si acepta quedarse
-- ni le ofrece un botón para soltar el turno. Lo que sí hace es tres cosas que hoy no hacía:
-- decirle que sigue a cargo, mostrarle cómo va la búsqueda del relevo —esperar sin saber si
-- alguien está buscando es lo que rompe a cualquiera— y darle por dónde avisar que no puede
-- seguir. Sin ese último botón, una emergencia propia de ella la deja sin nada que apretar.
--
-- POR QUÉ NO ALCANZA NINGUNA TABLA DE LAS QUE HAY. `incidentes_relevo` es el expediente del relevo
-- que no llegó y cuelga del turno ENTRANTE: dice qué se hizo para cubrirlo, no quién se quedó
-- adentro ni desde cuándo. `incidentes_turno_sin_cubrir` es el del turno que se acercaba sin nadie
-- asignado. Los dos describen el agujero; ninguno describe a la persona que lo está tapando con su
-- cuerpo. Y hay un caso que no abre ninguno de los dos: el relevo existe, tiene a alguien asignado
-- y simplemente todavía no llegó. Ahí también hay una Asistente de más, y hasta hoy no se anotaba.
--
-- POR QUÉ NO CUELGA DEL EXPEDIENTE SINO DE LA GUARDIA. Porque el hecho que se guarda es de ella:
-- estas horas son las suyas. Colgarla de un expediente que puede no existir la haría depender de
-- por qué falta el relevo, cuando lo que importa es que falta.
--
-- DE ACÁ SALEN LAS HORAS DE MÁS. `desde_at` y `hasta_at` son el rato que quedó fuera de su turno.
-- Todavía no hay forma de pagarlas —eso es la forma de pago y las horas extra, más adelante en el
-- plan—, y por eso esta tabla no guarda ningún importe: guarda el hecho, que es lo que después se
-- va a poder liquidar. Un importe escrito acá hoy sería un número calculado con una regla que no
-- existe.
--
-- EL DETALLE DEL «NO PUEDO CONTINUAR» NO SALE HACIA AFUERA. Mismo criterio que la emergencia en
-- guardia: el aviso que le llega al Coordinador dice que pasó, de qué turno y de cuándo. Lo que
-- ella escribió se lee entrando al Panel (`celtatech/CLAUDE.md` §6).
--
-- LO QUE NO DECIDE. Nada. No traba el cierre del turno, no asigna a nadie y no marca ninguna
-- ausencia. Deja constancia.

BEGIN;

CREATE TABLE IF NOT EXISTS public.extensiones_de_turno (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),

  -- El turno que se estiró: el de quien está adentro.
  guardia_id uuid NOT NULL,

  -- El turno que tenía que empezar y no arrancó. Queda en blanco cuando directamente no hay turno
  -- cargado después de éste, que es otra forma de que no venga nadie.
  relevo_guardia_id uuid,

  -- Desde qué momento está de más: la hora de fin de su propio turno. No es cuándo se dio cuenta
  -- el sistema, que puede ser minutos después.
  desde_at timestamptz NOT NULL,
  -- Hasta cuándo. En blanco mientras sigue adentro de más.
  hasta_at timestamptz,

  -- El «no puedo continuar». No la libera: avisa. El detalle es opcional porque quien aprieta esto
  -- puede no estar en condiciones de escribir nada.
  no_puede_continuar_at timestamptz,
  no_puede_continuar_detalle text,

  -- Para que el aviso del «no puedo continuar» se pueda reintentar si el envío falló, con el mismo
  -- molde que la emergencia en guardia.
  ultima_notificacion_at timestamptz,
  veces_notificado integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT extensiones_de_turno_guardia_fkey
    FOREIGN KEY (guardia_id, prestadora_id)
    REFERENCES public.guardias (id, prestadora_id) ON DELETE CASCADE,

  CONSTRAINT extensiones_de_turno_relevo_fkey
    FOREIGN KEY (relevo_guardia_id, prestadora_id)
    REFERENCES public.guardias (id, prestadora_id) ON DELETE SET NULL,

  -- Una extensión que termina antes de empezar no describe nada.
  CONSTRAINT extensiones_de_turno_termina_despues
    CHECK (hasta_at IS NULL OR hasta_at >= desde_at),

  -- Un detalle escrito sin haber apretado el botón sería un texto que nadie sabe de dónde salió.
  CONSTRAINT extensiones_de_turno_detalle_con_su_aviso
    CHECK (no_puede_continuar_detalle IS NULL OR no_puede_continuar_at IS NOT NULL)
);

COMMENT ON TABLE public.extensiones_de_turno IS
  'El rato que una Asistente se queda adentro despues de que termino su turno porque el relevo no llego. Se abre sola y se cierra cuando llega el relevo o cuando ella cierra el turno. De aca salen las horas de mas.';
COMMENT ON COLUMN public.extensiones_de_turno.desde_at IS
  'La hora de fin de su propio turno, no cuando el sistema se dio cuenta.';
COMMENT ON COLUMN public.extensiones_de_turno.no_puede_continuar_detalle IS
  'Lo que escribio quien no puede seguir. Es informacion sensible: no viaja en el aviso que sale por WhatsApp ni por correo, se lee entrando al Panel.';

-- Un turno no puede tener dos extensiones abiertas a la vez. Sí puede tener una cerrada y otra
-- nueva, aunque en la práctica no pase: un turno se estira una vez.
CREATE UNIQUE INDEX IF NOT EXISTS extensiones_de_turno_una_abierta_por_guardia
  ON public.extensiones_de_turno (guardia_id)
  WHERE hasta_at IS NULL;

-- El proceso de fondo recorre las abiertas de cada Prestadora en cada vuelta. Sin este índice
-- recorrería la tabla entera, que crece para siempre porque las cerradas no se borran.
CREATE INDEX IF NOT EXISTS extensiones_de_turno_abiertas
  ON public.extensiones_de_turno (prestadora_id, desde_at)
  WHERE hasta_at IS NULL;

-- ---------------------------------------------------------------------------
-- Quién ve qué
-- ---------------------------------------------------------------------------
--
-- Escribe el motor con la llave de servicio, así que las políticas son de lectura y son la segunda
-- red. La Coordinadora alcanza la extensión si alcanza el turno, con la misma función que ya decide
-- eso para las guardias; la administración de la Prestadora ve las de toda su Organización.
--
-- La Asistente no aparece acá: su aplicación no consulta la base, le pide todo al motor.

ALTER TABLE public.extensiones_de_turno ENABLE ROW LEVEL SECURITY;

CREATE POLICY coordinador_lee_extensiones_de_turno ON public.extensiones_de_turno
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (
      SELECT 1 FROM public.guardias g
       WHERE g.id = extensiones_de_turno.guardia_id
         AND g.prestadora_id = extensiones_de_turno.prestadora_id
         AND interno.coordinador_alcanza_guardia(g.asistente_id)
    )
  );

CREATE POLICY panel_lee_extensiones_de_turno ON public.extensiones_de_turno
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND (
      interno.es_superadmin()
      OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

-- El permiso de tabla no es la protección por fila, y en este esquema una tabla nueva nace con todo
-- dado a `anon` y a `authenticated`. Sin esto, cualquiera con la clave pública leería el detalle de
-- todas las extensiones de todas las Organizaciones.
REVOKE ALL ON TABLE public.extensiones_de_turno FROM anon;
REVOKE ALL ON TABLE public.extensiones_de_turno FROM authenticated;
GRANT SELECT ON TABLE public.extensiones_de_turno TO authenticated;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'extensiones_de_turno'
       AND policyname = 'coordinador_lee_extensiones_de_turno'
  ) THEN
    v_faltan := v_faltan || ' el permiso de la Coordinadora sobre la extension;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'extensiones_de_turno_una_abierta_por_guardia'
  ) THEN
    v_faltan := v_faltan || ' la regla de una sola extension abierta por turno;';
  END IF;

  IF has_table_privilege('anon', 'public.extensiones_de_turno', 'SELECT') THEN
    v_faltan := v_faltan || ' el cierre de la tabla a quien no inicio sesion;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La migracion no dejo lo que dice que deja:%', v_faltan;
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

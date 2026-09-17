-- La Coordinadora carga lo que ya arreglo, y queda constancia de lo que dejo de lado
-- =====================================================================
--
-- QUE FALTABA. El panel que tapa una vacante muestra a cada Asistente con sus motivos a favor y
-- en contra, y deja apagado el boton de asignar cuando alguno de esos motivos es un bloqueo. Son
-- cuatro: se pisa con otra guardia, la modalidad de trabajo es otra, hay una ausencia registrada
-- ese dia, y la Matricula no esta en orden.
--
-- Pero esos cuatro no son la misma clase de cosa. Dos los hace cumplir la base con un disparador
-- -la Matricula y la modalidad-, asi que apretar el boton fallaria igual. Los otros dos son
-- criterio de pantalla: la base los acepta sin decir nada. Y son justo los dos sobre los que quien
-- coordina puede saber algo que el sistema no sabe -que la licencia se corto antes, que las dos
-- guardias que se pisan se estan permutando-. Ahi la pantalla la frenaba sin tener con que.
--
-- El camino para cargarlo igual existia, pero en otra pantalla: el detalle del turno ofrece el
-- plantel entero en un desplegable, sin un solo motivo a la vista. O sea que el sistema dejaba
-- hacerlo exactamente donde no se ve nada, y lo impedia donde estan todos los motivos.
--
-- QUE SE AGREGA. Nada del lado de la base cambia sobre quien puede asignar: eso ya estaba
-- permitido. Lo que se agrega es la constancia. La pantalla dice, con estas palabras, que los
-- avisos «se pueden pasar por arriba, y queda registrado quien lo hizo», y hasta hoy no quedaba
-- registrado en ningun lado. Esta tabla lo registra.
--
-- QUE SE GUARDA, Y QUE NO. Se guarda la decision: quien, cuando, sobre que turno, a quien se lo
-- dio y que avisos tenia delante en ese momento. No se guarda ningun dato de la persona atendida
-- ni de la salud de nadie: los avisos son claves de traduccion y numeros -horas, fechas de
-- vencimiento, horarios- (`celtatech/CLAUDE.md` §6). La ausencia, en particular, viaja como el
-- hecho de que la hay, nunca de que tipo es.
--
-- LO QUE NO DECIDE. Nada. No bloquea, no habilita y no opina. Deja constancia.

BEGIN;

-- ---------------------------------------------------------------------------
-- La constancia
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auditoria_asignaciones_con_aviso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  guardia_id uuid NOT NULL,
  asistente_id uuid NOT NULL REFERENCES public.asistentes(id),

  -- Los avisos que tenia delante, tal como los vio: `[{ "clave": "superposicion",
  -- "valores": { "desde": "08:00", "hasta": "16:00" }, "grave": true }]`. Claves de traduccion y
  -- numeros; nunca texto libre ni nada de la persona atendida.
  avisos jsonb NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT auditoria_asignaciones_con_aviso_guardia_tenant_fk
    FOREIGN KEY (guardia_id, prestadora_id) REFERENCES public.guardias(id, prestadora_id),

  -- Una constancia sin ningun aviso no es una constancia: es ruido. La fila se escribe unicamente
  -- cuando hubo algo que pasar por arriba.
  CONSTRAINT auditoria_asignaciones_con_aviso_hay_algo
    CHECK (jsonb_typeof(avisos) = 'array' AND jsonb_array_length(avisos) > 0)
);

COMMENT ON TABLE public.auditoria_asignaciones_con_aviso IS
  'Quien asigno un turno teniendo avisos delante, y cuales eran. Registra la decision, no el resultado: se escribe antes de asignar.';
COMMENT ON COLUMN public.auditoria_asignaciones_con_aviso.avisos IS
  'Los avisos que se mostraron, como claves de traduccion y valores. Los arma panel/src/lib/avisosAsignacion.js. Nunca datos de la persona atendida ni tipo de ausencia.';

-- Quien audita pregunta por Prestadora y por fecha, de lo mas nuevo hacia atras. Sin este indice
-- recorreria la tabla entera, que solo crece.
CREATE INDEX IF NOT EXISTS auditoria_asignaciones_con_aviso_por_fecha
  ON public.auditoria_asignaciones_con_aviso (prestadora_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Quien escribe y quien lee
-- ---------------------------------------------------------------------------
--
-- La escribe el Panel con la sesion de la persona, asi que la proteccion por fila es la unica
-- defensa y no una segunda red. Escribe cualquiera de los tres roles que pueden asignar; la lee
-- quien audita, que no es quien asigna.

ALTER TABLE public.auditoria_asignaciones_con_aviso ENABLE ROW LEVEL SECURITY;

-- A nombre propio y sobre la propia Prestadora. Sin lo primero, cualquiera podria dejar la
-- constancia a nombre de otro, que es peor que no tener constancia.
CREATE POLICY panel_registra_asignacion_con_aviso ON public.auditoria_asignaciones_con_aviso
  FOR INSERT
  WITH CHECK (
    usuario_id = auth.uid()
    AND prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND u.rol IN ('superadmin', 'admin_prestadora', 'coordinador')
    )
  );

CREATE POLICY admin_prestadora_lee_asignaciones_con_aviso ON public.auditoria_asignaciones_con_aviso
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND (
      interno.es_superadmin()
      OR EXISTS (
        SELECT 1 FROM public.usuarios u
         WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
      )
    )
  );

-- Una constancia que se puede corregir o borrar no es una constancia. Nadie actualiza ni borra:
-- no hay politica para eso, y sin politica la proteccion por fila niega.

-- El permiso de tabla no es la proteccion por fila: sin esto, una politica perfecta devuelve
-- «permiso denegado» con una sesion valida.
REVOKE ALL ON TABLE public.auditoria_asignaciones_con_aviso FROM anon;
REVOKE ALL ON TABLE public.auditoria_asignaciones_con_aviso FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.auditoria_asignaciones_con_aviso TO authenticated;
GRANT ALL ON TABLE public.auditoria_asignaciones_con_aviso TO service_role;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'auditoria_asignaciones_con_aviso'
       AND policyname = 'panel_registra_asignacion_con_aviso'
  ) THEN
    v_faltan := v_faltan || ' el permiso para dejar la constancia;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'auditoria_asignaciones_con_aviso'
       AND policyname = 'admin_prestadora_lee_asignaciones_con_aviso'
  ) THEN
    v_faltan := v_faltan || ' el permiso para leerla;';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'auditoria_asignaciones_con_aviso'
       AND cmd IN ('UPDATE', 'DELETE')
  ) THEN
    v_faltan := v_faltan || ' quedo una politica que permite corregir o borrar la constancia;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La constancia de asignacion quedo a medias:%', v_faltan;
  END IF;
END
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- El equipo del Paciente.
-- =====================================================================
--
-- QUÉ ES UN EQUIPO. Las Asistentes que habitualmente trabajan con un Paciente, más la persona que
-- las coordina. Adentro del equipo puede haber alguien que cubre los francos de las demás.
--
-- QUÉ FALTABA. No había ningún lugar donde consultar quiénes son los de un Paciente. La
-- continuidad existía solamente como puntos al ordenar la lista de candidatos: se contaban las
-- veces que alguien ya lo había atendido. Esa cuenta no distingue a la que está todas las tardes
-- hace dos años de la que cubrió cinco veces el año pasado.
--
-- SE ARMA SOLO Y SE CORRIGE A MANO. El sistema propone el equipo mirando los turnos que ya
-- pasaron y las series vigentes; quien fija es la Coordinadora. El sistema nunca asigna solo.
--
-- QUÉ SE GUARDA ACÁ, Y QUÉ NO. Solamente las correcciones: a quién sumó, a quién sacó y quién
-- cubre francos. Nunca la lista entera. Guardar la lista entera la congelaría el día que se
-- guarda: la que empezó a venir la semana pasada tendría que ser agregada a mano, y la que dejó de
-- venir hace un año seguiría figurando hasta que alguien se acuerde de sacarla. La regla de quién
-- entra solo vive en `panel/src/lib/equipoDelPaciente.js`, que se copia al motor.
--
-- LO QUE NO DECIDE. Nada. No bloquea, no asigna y no reemplaza a la Coordinadora. Es quiénes son,
-- para que el resto del sistema pueda preguntarlo.

BEGIN;

CREATE TABLE IF NOT EXISTS public.equipo_paciente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  paciente_id uuid NOT NULL REFERENCES public.pacientes(id) ON DELETE CASCADE,

  -- Una de las dos, nunca las dos. Quien coordina entra por la misma puerta que las Asistentes
  -- porque también es parte del equipo, y el paso siguiente lo necesita en singular: un aviso que
  -- le llega a seis personas no le llega a ninguna.
  asistente_id uuid REFERENCES public.asistentes(id) ON DELETE CASCADE,
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE CASCADE,

  -- 'sumada' la pone aunque no llegue sola; 'sacada' la deja afuera aunque llegue. No hay una
  -- tercera: que alguien entre porque cumple la regla no es una decisión de nadie, y por eso no
  -- se guarda.
  situacion text NOT NULL,

  -- Quién cubre los francos de las demás. Es a quien se llama primero cuando alguien falta.
  -- «Franquera» es como se dice en el oficio; lo guardado se nombra por lo que hace.
  cubre_francos boolean NOT NULL DEFAULT false,

  -- Por qué la Coordinadora decidió esto. Opcional: la próxima lo lee y entiende.
  motivo text,

  decidido_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT equipo_paciente_situacion_conocida
    CHECK (situacion IN ('sumada', 'sacada')),
  CONSTRAINT equipo_paciente_es_una_persona_o_la_otra
    CHECK (num_nonnulls(asistente_id, usuario_id) = 1),
  -- A quien se sacó del equipo no se le puede marcar que cubre francos.
  CONSTRAINT equipo_paciente_sacada_no_cubre_francos
    CHECK (NOT (situacion = 'sacada' AND cubre_francos))
);

-- Una decisión por persona y por Paciente: la última reemplaza a la anterior, no se apila.
CREATE UNIQUE INDEX IF NOT EXISTS equipo_paciente_una_por_asistente
  ON public.equipo_paciente (paciente_id, asistente_id)
  WHERE asistente_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS equipo_paciente_una_por_usuario
  ON public.equipo_paciente (paciente_id, usuario_id)
  WHERE usuario_id IS NOT NULL;

-- Se consulta siempre por Paciente.
CREATE INDEX IF NOT EXISTS equipo_paciente_por_paciente
  ON public.equipo_paciente (prestadora_id, paciente_id);

COMMENT ON TABLE public.equipo_paciente IS
  'Las correcciones a mano sobre el equipo de un Paciente: a quien se sumo, a quien se saco y quien cubre francos. La lista entera no se guarda: se deduce de las guardias y las series, y estas filas la corrigen. La regla vive en panel/src/lib/equipoDelPaciente.js.';
COMMENT ON COLUMN public.equipo_paciente.situacion IS
  'sumada = entra aunque no llegue sola. sacada = queda afuera aunque llegue. Identificadores permanentes.';
COMMENT ON COLUMN public.equipo_paciente.cubre_francos IS
  'Cubre los francos de las demas. Es a quien se llama primero cuando alguien falta.';

-- ---------------------------------------------------------------------------
-- La fecha del último cambio se mueve sola
-- ---------------------------------------------------------------------------
--
-- En el esquema `interno`, que no está publicado, y sin `SECURITY DEFINER`: un disparador corre
-- con el rol de quien escribe, así que lo que llama por dentro tiene que estar del lado de
-- adentro y con permiso para ese rol (`CLAUDE.md` §6 del producto).

CREATE OR REPLACE FUNCTION interno.equipo_paciente_marca_el_cambio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'interno'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION interno.equipo_paciente_marca_el_cambio() FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.equipo_paciente_marca_el_cambio() FROM anon;
GRANT EXECUTE ON FUNCTION interno.equipo_paciente_marca_el_cambio() TO authenticated;
GRANT EXECUTE ON FUNCTION interno.equipo_paciente_marca_el_cambio() TO service_role;

DROP TRIGGER IF EXISTS equipo_paciente_marca_el_cambio ON public.equipo_paciente;
CREATE TRIGGER equipo_paciente_marca_el_cambio
  BEFORE UPDATE ON public.equipo_paciente
  FOR EACH ROW EXECUTE FUNCTION interno.equipo_paciente_marca_el_cambio();

-- ---------------------------------------------------------------------------
-- Quién ve y quién escribe
-- ---------------------------------------------------------------------------

ALTER TABLE public.equipo_paciente ENABLE ROW LEVEL SECURITY;

-- Lee el Panel de esa Prestadora. La Familia no: quiénes son del equipo se le muestra por otro
-- camino y con otro recorte, y esta tabla guarda además el motivo de cada decisión de adentro.
CREATE POLICY panel_lee_el_equipo_del_paciente ON public.equipo_paciente
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND u.rol IN ('admin_prestadora', 'coordinador', 'superadmin')
    )
  );

-- Escribe la administración de la Prestadora y, si esa Prestadora así lo configuró, la
-- Coordinadora: armar la cobertura es su trabajo. Es corregir una lista que el sistema ya propone,
-- no repartir turnos ni asignar a nadie, así que el valor de fábrica la incluye.
CREATE POLICY coordinacion_corrige_el_equipo_del_paciente ON public.equipo_paciente
  FOR ALL
  USING (
    prestadora_id = interno.current_tenant()
    AND (
      EXISTS (
        SELECT 1 FROM public.usuarios u
         WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
      )
      OR (
        EXISTS (
          SELECT 1 FROM public.usuarios u
           WHERE u.id = auth.uid() AND u.rol = 'coordinador'
        )
        AND public.tiene_permiso('corregir_equipo_del_paciente')
      )
    )
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND (
      EXISTS (
        SELECT 1 FROM public.usuarios u
         WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
      )
      OR (
        EXISTS (
          SELECT 1 FROM public.usuarios u
           WHERE u.id = auth.uid() AND u.rol = 'coordinador'
        )
        AND public.tiene_permiso('corregir_equipo_del_paciente')
      )
    )
  );

-- El producto no reparte el trabajo de adentro de una Prestadora: pone la acción en el catálogo y
-- cada una la configura en Configuración › Accesos. De fábrica la Coordinadora entra, porque esto
-- es exactamente su tarea.
INSERT INTO public.catalogo_acciones_permisos (accion, default_solo_admin, orden)
SELECT 'corregir_equipo_del_paciente', false, 12
 WHERE NOT EXISTS (
   SELECT 1 FROM public.catalogo_acciones_permisos WHERE accion = 'corregir_equipo_del_paciente'
 );

-- El permiso de tabla no es la política: sin esto, una política perfecta bloquea en vez de
-- proteger (`celtatech/CLAUDE.md` §9).
GRANT ALL ON TABLE public.equipo_paciente TO anon;
GRANT ALL ON TABLE public.equipo_paciente TO authenticated;
GRANT ALL ON TABLE public.equipo_paciente TO service_role;

-- ---------------------------------------------------------------------------
-- Con cuántos turnos se entra al equipo lo decide la Prestadora
-- ---------------------------------------------------------------------------
--
-- Los dos números van juntos: «al menos tres turnos en los últimos noventa días». Uno solo no
-- alcanza —tres turnos en dos años no es un equipo, y un turno de la semana pasada tampoco—, y la
-- ventana es lo que hace que quien dejó de venir salga sola. Vacío mientras la Prestadora no toque
-- nada, para que un cambio de valor de fábrica alcance a todas salvo en lo que cada una decidió.

CREATE TABLE IF NOT EXISTS public.configuracion_equipo_paciente (
  prestadora_id uuid PRIMARY KEY REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  regla jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracion_equipo_paciente_regla_es_objeto
    CHECK (jsonb_typeof(regla) = 'object')
);

COMMENT ON TABLE public.configuracion_equipo_paciente IS
  'Con cuantos turnos y en que ventana de dias se entra solo al equipo de un Paciente. Solo lo que esta Prestadora corrio; los valores de fabrica y los bordes viven en panel/src/lib/equipoDelPaciente.js.';

ALTER TABLE public.configuracion_equipo_paciente ENABLE ROW LEVEL SECURITY;

-- Escribe el motor con la llave de servicio, que se saltea la protección por fila; esta política
-- es la segunda red. Lee quien arma la cobertura y tiene que poder entender por qué el equipo
-- salió así.
CREATE POLICY panel_lee_configuracion_equipo_paciente ON public.configuracion_equipo_paciente
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

REVOKE ALL ON TABLE public.configuracion_equipo_paciente FROM anon;
REVOKE ALL ON TABLE public.configuracion_equipo_paciente FROM authenticated;
GRANT SELECT ON TABLE public.configuracion_equipo_paciente TO authenticated;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'equipo_paciente'
       AND policyname = 'coordinacion_corrige_el_equipo_del_paciente'
  ) THEN
    v_faltan := v_faltan || ' la politica de escritura del equipo;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'equipo_paciente_marca_el_cambio' AND NOT tgisinternal
  ) THEN
    v_faltan := v_faltan || ' el disparador de la fecha de cambio;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'equipo_paciente_una_por_asistente'
  ) THEN
    v_faltan := v_faltan || ' el indice unico por Asistente;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La migracion del equipo del Paciente no quedo completa:%', v_faltan;
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

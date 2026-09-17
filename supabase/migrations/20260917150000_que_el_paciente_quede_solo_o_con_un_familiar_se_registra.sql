-- Que el Paciente quede solo, o quede con un familiar, se registra. Y ninguna de las dos cosas
-- cuenta como un turno cubierto.
-- =====================================================================
--
-- QUÉ FALTABA. Cuando no aparece nadie, el turno termina de una de dos maneras que el producto no
-- sabía escribir: el Paciente queda solo, o se queda cuidándolo alguien de la casa. La primera no
-- existía en ninguna tabla. La segunda existía como `excepciones_familiar_relevo`, con un nombre y
-- una forma que dicen otra cosa —una excepción que alguien autoriza—, y colgando de un incidente de
-- relevo, así que sólo servía para uno de los tres caminos por los que un turno se queda sin nadie.
--
-- LO QUE SE ARREGLA DE LA TABLA QUE YA ESTABA. Tres cosas:
--
--   1. Cuelga de la guardia y no del incidente. Un turno se queda sin nadie por tres caminos —el
--      relevo que no llegó, el turno que nunca tuvo a quién asignarle, y la que quedó de más y no
--      puede continuar— y sólo el primero abre un incidente de relevo. El denominador común de los
--      tres es el turno. El incidente queda guardado igual cuando lo hubo, porque dice de dónde
--      salió.
--   2. Quien figura no autoriza: registra. Un familiar es el cliente y no le debe nada a nadie;
--      ningún Coordinador puede pedirle que se quede. Que igual se haya quedado es un hecho que se
--      anota, no un permiso que se concede, y una columna llamada `autorizado_por` dice justamente
--      lo contrario de lo que pasó.
--   3. El motivo deja de ser obligatorio. Era la justificación de la excepción. El familiar no
--      tiene que justificar nada; lo que haya para escribir se escribe si hay algo que escribir.
--
-- POR QUÉ SE TOCA LA TABLA Y NO SE HACE UNA NUEVA AL LADO. Serían dos tablas para el mismo hecho, y
-- el día que alguien cuente cuántas veces terminó cuidando la familia tendría que acordarse de
-- sumar las dos. El nombre guardado no se renombra —es la regla— salvo cuando el nombre dice algo
-- que no es, y éste lo dice: `autorizado_por` afirma una autorización que nunca existió.
--
-- EL CONSENTIMIENTO ES OTRA COSA Y VA APARTE. Que la Familia sepa y acepte que el Paciente va a
-- quedar solo no es lo mismo que un familiar quedándose a cuidar: en un caso no hay nadie en la
-- casa, en el otro sí. Se registran por separado porque se leen por separado, y porque un mismo
-- turno puede tener los dos —la Familia consintió que quedara solo un rato, y después igual se
-- quedó alguien—.
--
-- LO QUE ESTO NO HACE. No cierra ningún turno, no marca ninguna guardia como cubierta, no bloquea
-- nada y no muestra ninguna advertencia legal: para eso haría falta el texto del documento legal de
-- ese país, y hoy ninguno de los veintiún documentos dice nada sobre dejar sola a la persona
-- atendida. Cuando lo diga, el aviso sale de ahí y no de acá.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El familiar que se quedó: mismo hecho, tres orígenes posibles
-- ---------------------------------------------------------------------------

ALTER TABLE public.excepciones_familiar_relevo
  ADD COLUMN IF NOT EXISTS guardia_id uuid,
  ADD COLUMN IF NOT EXISTS origen text;

-- Las filas que ya estaban salieron todas de un incidente de relevo, y ese incidente sabe de qué
-- turno se trata. Sin esto, la columna nueva quedaría vacía justo en las filas que más se miran.
UPDATE public.excepciones_familiar_relevo e
   SET guardia_id = i.guardia_entrante_id
  FROM public.incidentes_relevo i
 WHERE i.id = e.incidente_id
   AND e.guardia_id IS NULL;

UPDATE public.excepciones_familiar_relevo
   SET origen = 'relevo'
 WHERE origen IS NULL;

-- Una fila sin turno no se puede leer: no se sabe de quién se estuvo hablando. Si alguna quedó
-- así —un incidente borrado, un dato a medias—, la migración para acá antes de dejarla escrita.
DO $sin_turno$
BEGIN
  IF EXISTS (SELECT 1 FROM public.excepciones_familiar_relevo WHERE guardia_id IS NULL) THEN
    RAISE EXCEPTION 'Hay familiares registrados sin turno al que colgarlos; se resuelven a mano antes de correr esto.';
  END IF;
END;
$sin_turno$;

ALTER TABLE public.excepciones_familiar_relevo
  ALTER COLUMN guardia_id SET NOT NULL,
  ALTER COLUMN origen SET NOT NULL,
  -- El incidente pasa a ser opcional: los otros dos caminos no abren ninguno.
  ALTER COLUMN incidente_id DROP NOT NULL,
  -- El familiar no justifica nada.
  ALTER COLUMN motivo DROP NOT NULL;

-- Quien figura registra el hecho; no lo autoriza. El nombre viejo afirmaba lo contrario.
ALTER TABLE public.excepciones_familiar_relevo
  RENAME COLUMN autorizado_por TO registrado_por;

ALTER TABLE public.excepciones_familiar_relevo
  DROP CONSTRAINT IF EXISTS excepciones_familiar_relevo_guardia_tenant_fk,
  ADD CONSTRAINT excepciones_familiar_relevo_guardia_tenant_fk
    FOREIGN KEY (guardia_id, prestadora_id) REFERENCES public.guardias(id, prestadora_id),
  DROP CONSTRAINT IF EXISTS excepciones_familiar_relevo_origen_conocido,
  ADD CONSTRAINT excepciones_familiar_relevo_origen_conocido
    CHECK (origen IN ('relevo', 'turno_sin_cubrir', 'extension')),
  -- Terminó antes de empezar es un dato mal cargado, no un caso raro.
  DROP CONSTRAINT IF EXISTS excepciones_familiar_relevo_termina_despues,
  ADD CONSTRAINT excepciones_familiar_relevo_termina_despues
    CHECK (hasta_at IS NULL OR hasta_at >= desde_at);

COMMENT ON TABLE public.excepciones_familiar_relevo IS
  'Un familiar termino cuidando porque la Prestadora no mando a nadie. Es un defecto grave del servicio que no se pudo solucionar, nunca un turno cubierto: no cierra la guardia ni la cuenta como prestada.';
COMMENT ON COLUMN public.excepciones_familiar_relevo.registrado_por IS
  'Quien de la Prestadora dejo escrito el hecho. No lo autorizo: a un familiar no se le pide que se quede.';
COMMENT ON COLUMN public.excepciones_familiar_relevo.origen IS
  'Por cual de los tres caminos el turno quedo sin nadie: relevo, turno_sin_cubrir o extension.';
COMMENT ON COLUMN public.excepciones_familiar_relevo.hasta_at IS
  'Cuando volvio a haber personal en esa casa. Vacio mientras siga sin haberlo.';

-- Mientras siga abierta, esa casa tiene a alguien cuidando que no es de la Prestadora. Son las
-- filas que se miran primero y las que recorre la pantalla de continuidad.
CREATE INDEX IF NOT EXISTS excepciones_familiar_relevo_abiertas
  ON public.excepciones_familiar_relevo (prestadora_id, desde_at)
  WHERE hasta_at IS NULL;

CREATE INDEX IF NOT EXISTS excepciones_familiar_relevo_por_turno
  ON public.excepciones_familiar_relevo (guardia_id);

-- Y el permiso de la Coordinadora tiene que mirar por donde mira ahora la tabla. El que estaba
-- llegaba al turno dando la vuelta por el incidente de relevo; con el incidente vacío —que es el
-- caso de los dos caminos nuevos— esa vuelta no llega a ninguna parte y la fila le queda
-- invisible justo a quien la acaba de escribir. Ahora va derecho al turno, que es la columna que
-- todas las filas tienen.
DROP POLICY IF EXISTS coordinador_gestiona_excepciones_familiar_relevo_de_su_zona ON public.excepciones_familiar_relevo;

CREATE POLICY coordinador_gestiona_excepciones_familiar_relevo_de_su_zona ON public.excepciones_familiar_relevo
  FOR ALL
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (
      SELECT 1 FROM public.guardias g
       WHERE g.id = excepciones_familiar_relevo.guardia_id
         AND g.prestadora_id = excepciones_familiar_relevo.prestadora_id
         AND interno.coordinador_alcanza_guardia(g.asistente_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 2. El consentimiento de la Familia para que el Paciente quede solo
-- ---------------------------------------------------------------------------
--
-- Quién lo dio, cuándo, y hasta cuándo vale. Es el registro de una conversación que ya ocurrió, no
-- un permiso que el sistema pida ni conceda: lo carga quien coordina después de hablar con la
-- Familia. Por eso guarda por qué medio se habló y con qué persona, que es lo que hace falta para
-- poder reconstruir el hecho si alguien lo discute.

CREATE TABLE IF NOT EXISTS public.consentimientos_paciente_solo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  guardia_id uuid NOT NULL,
  paciente_id uuid NOT NULL,

  -- Con quién se habló. El nombre va escrito porque quien atiende el teléfono es una persona, y la
  -- cuenta de la Familia es de todas: saber cuál de ellas dijo que sí es justamente el dato.
  quien_consintio text NOT NULL,
  familia_id uuid REFERENCES public.familias(id),
  -- Por dónde se habló. Los valores de fábrica y lo que significa cada uno viven en
  -- `panel/src/lib/pacienteSolo.js`; escribirlos dos veces los haría divergir.
  medio text NOT NULL,

  -- Desde cuándo y hasta cuándo vale lo que la Familia aceptó. El fin no es opcional: un
  -- consentimiento sin fin no es un consentimiento, es una renuncia.
  desde_at timestamptz NOT NULL,
  hasta_at timestamptz NOT NULL,

  registrado_por uuid NOT NULL REFERENCES public.usuarios(id),
  registrado_at timestamptz NOT NULL DEFAULT now(),
  -- Lo que haya que dejar escrito de la conversación. Nunca datos de salud.
  nota text,

  CONSTRAINT consentimientos_paciente_solo_guardia_tenant_fk
    FOREIGN KEY (guardia_id, prestadora_id) REFERENCES public.guardias(id, prestadora_id),
  CONSTRAINT consentimientos_paciente_solo_paciente_tenant_fk
    FOREIGN KEY (paciente_id, prestadora_id) REFERENCES public.pacientes(id, prestadora_id),

  CONSTRAINT consentimientos_paciente_solo_medio_conocido
    CHECK (medio IN ('telefono', 'en_persona', 'mensaje', 'correo')),
  CONSTRAINT consentimientos_paciente_solo_termina_despues
    CHECK (hasta_at > desde_at),
  CONSTRAINT consentimientos_paciente_solo_con_nombre
    CHECK (length(btrim(quien_consintio)) > 0)
);

COMMENT ON TABLE public.consentimientos_paciente_solo IS
  'La Familia supo y acepto que la persona atendida quedara sola durante un rato de este turno. Registra una conversacion que ya ocurrio; no cubre el turno ni lo cierra.';
COMMENT ON COLUMN public.consentimientos_paciente_solo.quien_consintio IS
  'Nombre de la persona de la Familia con la que se hablo. La cuenta es de todas; quien dijo que si es una.';
COMMENT ON COLUMN public.consentimientos_paciente_solo.hasta_at IS
  'Hasta cuando vale. Obligatorio: un consentimiento sin fin no es un consentimiento.';
COMMENT ON COLUMN public.consentimientos_paciente_solo.nota IS
  'Lo que quedo de la conversacion. Nunca datos de salud de la persona atendida.';

CREATE INDEX IF NOT EXISTS consentimientos_paciente_solo_por_turno
  ON public.consentimientos_paciente_solo (guardia_id);

CREATE INDEX IF NOT EXISTS consentimientos_paciente_solo_vigentes
  ON public.consentimientos_paciente_solo (prestadora_id, hasta_at);

-- ---------------------------------------------------------------------------
-- 3. Quién los ve y quién los escribe
-- ---------------------------------------------------------------------------
--
-- Los dos los escribe el Panel con la sesión de la persona, así que acá la protección por fila es
-- la única defensa y no una segunda red. Mismo reparto que el incidente del turno vacío: la
-- Coordinadora alcanza lo que cuelga de un turno que alcanza, y la administración de la Prestadora
-- alcanza todo lo suyo.

ALTER TABLE public.consentimientos_paciente_solo ENABLE ROW LEVEL SECURITY;

CREATE POLICY coordinador_gestiona_consentimientos_paciente_solo ON public.consentimientos_paciente_solo
  FOR ALL
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (
      SELECT 1 FROM public.guardias g
       WHERE g.id = consentimientos_paciente_solo.guardia_id
         AND g.prestadora_id = consentimientos_paciente_solo.prestadora_id
         AND interno.coordinador_alcanza_guardia(g.asistente_id)
    )
  );

CREATE POLICY panel_gestiona_consentimientos_paciente_solo ON public.consentimientos_paciente_solo
  FOR ALL
  USING (
    (interno.es_superadmin() AND prestadora_id = interno.current_tenant())
    OR (
      prestadora_id = interno.current_tenant()
      AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

-- El permiso de tabla no es la protección por fila: sin esto, una política perfecta devuelve
-- «permiso denegado» con una sesión válida. Molde de tabla que escribe el navegador con sesión.
GRANT ALL ON TABLE public.consentimientos_paciente_solo TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'excepciones_familiar_relevo'
       AND column_name = 'autorizado_por'
  ) THEN
    v_faltan := v_faltan || ' la columna que decia que alguien autorizo al familiar;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'excepciones_familiar_relevo'
       AND column_name = 'guardia_id' AND is_nullable = 'NO'
  ) THEN
    v_faltan := v_faltan || ' el turno del que cuelga el familiar;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'consentimientos_paciente_solo'
       AND policyname = 'coordinador_gestiona_consentimientos_paciente_solo'
  ) THEN
    v_faltan := v_faltan || ' el permiso de la Coordinadora sobre el consentimiento;';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.consentimientos_paciente_solo', 'INSERT') THEN
    v_faltan := v_faltan || ' el permiso de tabla para registrar el consentimiento desde el Panel;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La migracion no dejo lo que dice que deja:%', v_faltan;
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

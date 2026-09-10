-- ============================================================================
-- El precio, el calendario y el cierre cuelgan del Servicio
-- ============================================================================
--
-- Qué estaba mal
-- --------------
-- Lo que se pacta con un Cliente es un Servicio, pero en la base todo lo pactado colgaba del
-- Paciente: el precio y el calendario viven en `prestaciones`, que se buscan por `paciente_id`
-- y nunca escribieron su `servicio_id`; y el cierre vive en `cierres_servicio_paciente`, que
-- sólo sabe de qué Paciente es. Consecuencia práctica: la pantalla del Servicio deduce sus
-- Pacientes al revés, mirando qué prestaciones los nombran, y cerrar la atención de un Paciente
-- no cierra nada que el Cliente reconozca como suyo.
--
-- Qué cambia
-- ----------
-- 1. `cierres_servicio_paciente` gana `servicio_id`, amarrado por clave compuesta contra
--    `servicios (id, prestadora_id)`, igual que las demás: una Prestadora no puede colgar su
--    cierre del Servicio de otra. Y con el mismo disparador que ya controlan las guardias y las
--    prestaciones, para que tampoco pueda cerrar el Servicio de otro Cliente.
-- 2. Todo lo que ya está cargado pasa a colgar de un Servicio. `paciente_id` no se toca: la
--    prestación sigue diciendo a quién se le presta, y ahora además de qué Servicio es.
-- 3. Las dos políticas del Coordinador que hoy preguntan «¿existe un cierre de este Paciente?»
--    pasan a preguntar «¿existe un cierre de este Servicio?».
--
-- Cómo se rellena lo que ya está cargado
-- --------------------------------------
-- Una regla, y se dice entera: **cada Paciente que hoy tiene algo colgado —una prestación, un
-- cierre, una serie o una guardia sin Servicio— recibe un Servicio propio, salvo que su Familia
-- ya tenga exactamente uno vigente, en cuyo caso se cuelga de ése.**
--
-- El caso de «uno propio» es el que preserva exactamente lo que hay: hoy el precio, el
-- calendario y el cierre son de cada Paciente, así que un Servicio por Paciente no cambia
-- ninguna semántica, sólo le pone el envase que faltaba. El caso de «la Familia ya tiene uno»
-- es el mismo criterio que ya aplicó `20260910200000` a las guardias, y se mantiene para no
-- fabricar un segundo Servicio donde ya había un hogar evidente.
--
-- Con más de un Servicio vigente en la Familia no se elige ninguno: se crea el propio. Adivinar
-- ahí es facturarle a quien no corresponde.
--
-- Y no se supone que salió bien: al final se comprueba fila por fila que nada quedó colgado de
-- un Servicio de otra Prestadora ni de otro Cliente, y que no quedó nada sin Servicio. Si algo
-- de eso no cuadra, la migración entera se cae y no deja la base a medio camino.
--
-- Lo que NO se hace acá
-- ---------------------
-- No se sacan columnas viejas: `servicios.familia_id` y la parte de
-- `interno.exigir_contratante_del_servicio()` que la sincroniza salen en una migración aparte,
-- cuando ninguna pantalla las lea. Tampoco se toca la restricción que fija los tres motivos de
-- cierre: los motivos configurables por Prestadora son el paso siguiente.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. El cierre sabe de qué Servicio es
-- ----------------------------------------------------------------------------

ALTER TABLE public.cierres_servicio_paciente
  ADD COLUMN IF NOT EXISTS servicio_id uuid;

ALTER TABLE public.cierres_servicio_paciente
  DROP CONSTRAINT IF EXISTS cierres_servicio_paciente_servicio_tenant_fk;

ALTER TABLE public.cierres_servicio_paciente
  ADD CONSTRAINT cierres_servicio_paciente_servicio_tenant_fk
  FOREIGN KEY (servicio_id, prestadora_id)
  REFERENCES public.servicios (id, prestadora_id);

COMMENT ON COLUMN public.cierres_servicio_paciente.servicio_id IS
  'Qué Servicio se cerró. Es lo que se pactó con el Cliente, y es por donde preguntan las políticas del Coordinador.';

-- Las dos políticas del Coordinador entran por esta columna en cada fila de guardia que tocan.
CREATE INDEX IF NOT EXISTS cierres_servicio_paciente_servicio_id_idx
  ON public.cierres_servicio_paciente (servicio_id) WHERE servicio_id IS NOT NULL;

-- Y la misma regla que ya controlan las guardias y las prestaciones: el Servicio que se cierra
-- tiene que ser uno que le corresponda a ese Paciente. Es la función que ya existe, no una
-- comprobación nueva escrita al lado. Queda creada antes del relleno de más abajo a propósito,
-- así el relleno también pasa por ella.
DROP TRIGGER IF EXISTS "validar_servicio_cierres_servicio_paciente" ON "public"."cierres_servicio_paciente";
CREATE TRIGGER "validar_servicio_cierres_servicio_paciente"
  BEFORE INSERT OR UPDATE OF "servicio_id", "paciente_id"
  ON "public"."cierres_servicio_paciente"
  FOR EACH ROW EXECUTE FUNCTION "interno"."validar_servicio_del_contratante"();

-- ----------------------------------------------------------------------------
-- 2. Quién necesita un Servicio y cuál le toca
-- ----------------------------------------------------------------------------

CREATE TEMP TABLE necesita_servicio ON COMMIT DROP AS
SELECT p.id AS paciente_id, p.prestadora_id, p.familia_id, p.nombre
  FROM public.pacientes p
 WHERE EXISTS (SELECT 1 FROM public.prestaciones x
                WHERE x.paciente_id = p.id AND x.servicio_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.cierres_servicio_paciente x
                WHERE x.paciente_id = p.id AND x.servicio_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.series_guardias x
                WHERE x.paciente_id = p.id AND x.servicio_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.guardias x
                WHERE x.paciente_id = p.id AND x.servicio_id IS NULL);

ALTER TABLE necesita_servicio ADD COLUMN servicio_nuevo uuid;

CREATE TEMP TABLE servicio_del_paciente (
  paciente_id uuid PRIMARY KEY,
  servicio_id uuid NOT NULL
) ON COMMIT DROP;

-- a) La Familia ya tiene exactamente un Servicio vigente: ése.
--    `(array_agg(...))[1]` y no `min(...)`: Postgres no sabe ordenar identificadores. Da igual
--    cuál se tome, porque el `HAVING` deja sólo los casos donde hay exactamente uno.
INSERT INTO servicio_del_paciente (paciente_id, servicio_id)
SELECT n.paciente_id, (array_agg(s.id))[1]
  FROM necesita_servicio n
  JOIN public.servicios s
    ON s.prestadora_id = n.prestadora_id
   AND s.tipo_contratante = 'familia'
   AND s.contratante_id = n.familia_id
   AND s.estado = 'vigente'
 WHERE n.familia_id IS NOT NULL
 GROUP BY n.paciente_id
HAVING count(*) = 1;

-- b) Todos los demás reciben uno propio. La etiqueta es el nombre del Paciente y nada más:
--    es un dato que ya está cargado, no texto que haya que traducir.
UPDATE necesita_servicio
   SET servicio_nuevo = gen_random_uuid()
 WHERE familia_id IS NOT NULL
   AND paciente_id NOT IN (SELECT paciente_id FROM servicio_del_paciente);

INSERT INTO public.servicios (id, prestadora_id, tipo_contratante, contratante_id, etiqueta, estado)
SELECT n.servicio_nuevo, n.prestadora_id, 'familia', n.familia_id, n.nombre, 'vigente'
  FROM necesita_servicio n
 WHERE n.servicio_nuevo IS NOT NULL;

INSERT INTO servicio_del_paciente (paciente_id, servicio_id)
SELECT n.paciente_id, n.servicio_nuevo
  FROM necesita_servicio n
 WHERE n.servicio_nuevo IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Lo que ya está cargado pasa a colgar del Servicio
-- ----------------------------------------------------------------------------
-- Los disparadores `validar_servicio_*` corren en cada una de estas escrituras y vuelven a
-- controlar que el Paciente le corresponda a quien contrató ese Servicio. No hace falta
-- repetir esa comprobación acá: si no diera, la migración se cae sola.

UPDATE public.prestaciones x
   SET servicio_id = d.servicio_id
  FROM servicio_del_paciente d
 WHERE x.servicio_id IS NULL AND x.paciente_id = d.paciente_id;

UPDATE public.cierres_servicio_paciente x
   SET servicio_id = d.servicio_id
  FROM servicio_del_paciente d
 WHERE x.servicio_id IS NULL AND x.paciente_id = d.paciente_id;

UPDATE public.series_guardias x
   SET servicio_id = d.servicio_id
  FROM servicio_del_paciente d
 WHERE x.servicio_id IS NULL AND x.paciente_id = d.paciente_id;

-- La guardia hereda el de su serie antes que el suyo propio, para que todas las guardias de una
-- misma serie facturen al mismo Servicio.
UPDATE public.guardias g
   SET servicio_id = sg.servicio_id
  FROM public.series_guardias sg
 WHERE g.servicio_id IS NULL
   AND g.serie_id = sg.id
   AND sg.servicio_id IS NOT NULL;

UPDATE public.guardias g
   SET servicio_id = d.servicio_id
  FROM servicio_del_paciente d
 WHERE g.servicio_id IS NULL AND g.paciente_id = d.paciente_id;

-- ----------------------------------------------------------------------------
-- 4. Se comprueba, no se supone
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  cruzadas int;
  prest int; cierres int; series int; guardias int;
BEGIN
  SELECT count(*) INTO cruzadas
    FROM (
      SELECT x.servicio_id, x.paciente_id FROM public.prestaciones x               WHERE x.servicio_id IS NOT NULL
      UNION ALL
      SELECT x.servicio_id, x.paciente_id FROM public.cierres_servicio_paciente x  WHERE x.servicio_id IS NOT NULL
      UNION ALL
      SELECT x.servicio_id, x.paciente_id FROM public.series_guardias x            WHERE x.servicio_id IS NOT NULL
      UNION ALL
      SELECT x.servicio_id, x.paciente_id FROM public.guardias x                   WHERE x.servicio_id IS NOT NULL
    ) t
    JOIN public.servicios s ON s.id = t.servicio_id
    JOIN public.pacientes p ON p.id = t.paciente_id
   WHERE s.prestadora_id <> p.prestadora_id
      OR (s.tipo_contratante = 'familia' AND s.contratante_id IS DISTINCT FROM p.familia_id);

  IF cruzadas > 0 THEN
    RAISE EXCEPTION 'quedaron % filas colgadas de un Servicio que no le corresponde a su Paciente', cruzadas;
  END IF;

  SELECT count(*) INTO prest    FROM public.prestaciones              WHERE servicio_id IS NULL;
  SELECT count(*) INTO cierres  FROM public.cierres_servicio_paciente WHERE servicio_id IS NULL;
  SELECT count(*) INTO series   FROM public.series_guardias           WHERE servicio_id IS NULL;
  SELECT count(*) INTO guardias FROM public.guardias                  WHERE servicio_id IS NULL;

  -- Lo único que puede quedar afuera es un Paciente sin Familia: sin Cliente que contrate no hay
  -- Servicio posible, y no se inventa uno. Si aparece, se para acá y se mira caso por caso.
  IF prest + cierres + series + guardias > 0 THEN
    RAISE EXCEPTION 'quedó sin Servicio: % prestaciones, % cierres, % series, % guardias (Pacientes sin Familia)',
      prest, cierres, series, guardias;
  END IF;

  RAISE NOTICE 'Servicios creados para lo que ya estaba cargado: %',
    (SELECT count(*) FROM necesita_servicio WHERE servicio_nuevo IS NOT NULL);
END $$;

-- ----------------------------------------------------------------------------
-- 5. Las dos políticas del Coordinador preguntan por el Servicio
-- ----------------------------------------------------------------------------
-- Además de cambiar de pregunta, ganan la Prestadora adentro del `EXISTS`. La versión vieja no
-- la nombraba: se conformaba con que existiera un cierre de ese Paciente en cualquier
-- Prestadora. Es la misma corrección de aislamiento que ya se aplicó a las claves foráneas.

DROP POLICY IF EXISTS "coordinador_cierra_servicio_guardias" ON public.guardias;

CREATE POLICY "coordinador_cierra_servicio_guardias" ON public.guardias
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u
                 WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (SELECT 1 FROM public.cierres_servicio_paciente c
                 WHERE c.servicio_id = guardias.servicio_id
                   AND c.prestadora_id = guardias.prestadora_id)
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u
                 WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (SELECT 1 FROM public.cierres_servicio_paciente c
                 WHERE c.servicio_id = guardias.servicio_id
                   AND c.prestadora_id = guardias.prestadora_id)
  );

DROP POLICY IF EXISTS "coordinador_cierra_servicio_series_guardias" ON public.series_guardias;

CREATE POLICY "coordinador_cierra_servicio_series_guardias" ON public.series_guardias
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u
                 WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (SELECT 1 FROM public.cierres_servicio_paciente c
                 WHERE c.servicio_id = series_guardias.servicio_id
                   AND c.prestadora_id = series_guardias.prestadora_id)
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u
                 WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (SELECT 1 FROM public.cierres_servicio_paciente c
                 WHERE c.servicio_id = series_guardias.servicio_id
                   AND c.prestadora_id = series_guardias.prestadora_id)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

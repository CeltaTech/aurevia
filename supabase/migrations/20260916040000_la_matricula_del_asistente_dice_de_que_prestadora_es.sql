-- ---------------------------------------------------------------------------------------
-- La Matrícula del Asistente dice de qué Prestadora es
--
-- POR QUÉ. `matriculas_asistente` nació sin la columna de su Organización, y era la única de
-- las tablas que consultan las dos aplicaciones de teléfono a la que le faltaba. Toda tabla
-- nace con clave `uuid` y con la columna de su Organización (`celtatech/CLAUDE.md` §5), y la
-- falta no era decorativa: el motor entra a la base con la llave de servicio y se saltea la
-- protección por fila, así que lo único que separa una Prestadora de otra son los filtros
-- escritos en cada consulta, y una consulta a esta tabla no tenía por dónde filtrar. Quedaba
-- colgada del Asistente, que sí la tiene.
--
-- QUÉ NO ESTABA PASANDO. Hoy el identificador del Asistente es único en toda la base
-- —`asistentes_pkey PRIMARY KEY (id)`—, así que ninguna Prestadora estaba viendo las
-- Matrículas de otra. Esto no cierra una fuga abierta: saca la dependencia de que ese
-- identificador nunca se repita, que es lo que la regla no deja suponer.
--
-- LA CLAVE FORÁNEA VA COMPUESTA, Y AHÍ ESTÁ LO QUE DE VERDAD PROTEGE. Contra
-- `asistentes (id, prestadora_id)`, no contra `prestadoras (id)` por un lado y `asistentes
-- (id)` por el otro. Con la compuesta, una Matrícula no puede quedar colgada de una Prestadora
-- distinta de la de su Asistente ni aunque alguien escriba la fila a mano: la base lo rechaza.
-- Eso es lo que sostiene la política de carga desde el teléfono, que comprueba de quién es la
-- Matrícula y no de qué Prestadora —`asistente_carga_su_matricula`, WITH CHECK (asistente_id =
-- auth.uid())—: sin la clave compuesta, esa política aceptaría una fila con la Prestadora
-- equivocada.
--
-- LAS POLÍTICAS NO CAMBIAN, Y EL MOTIVO SE ESCRIBE ACÁ.
--   - `admin_prestadora_gestiona_matriculas_asistente` y `coordinador_lee_matriculas_asistente`
--     resuelven por EXISTS sobre `asistentes` con `current_tenant()`. Con la clave compuesta
--     puesta, eso es exactamente la misma condición que comparar la columna nueva: la Prestadora
--     de la Matrícula y la de su Asistente ya no pueden diferir. Repetirla sería una segunda
--     escritura de la misma decisión.
--   - `asistente_lee_sus_matriculas` y `asistente_carga_su_matricula` comparan con `auth.uid()`
--     y no pueden usar `current_tenant()`: esa función resuelve la Organización mirando
--     `usuarios`, y un Asistente no tiene fila ahí. Agregársela las dejaría comparando contra
--     nulo, y un control que compara contra nulo no deniega: falla cerrado por accidente y
--     deja a todos los Asistentes sin ver su propia Matrícula.
--
-- LA VISTA. `estado_matricula_asistente` ya exponía `a.prestadora_id`, porque sale del
-- Asistente. Lo que se agrega es la condición en el empalme lateral: la Matrícula que se elige
-- tiene que ser de la misma Prestadora que el Asistente. Se reescribe entera porque una vista
-- se reemplaza completa, y apunta a `interno.motivo_bloqueo_matricula`, que es donde esa
-- función vive desde que las funciones internas salieron del esquema publicado.
-- ---------------------------------------------------------------------------------------

ALTER TABLE public.matriculas_asistente
  ADD COLUMN IF NOT EXISTS prestadora_id uuid;

-- Lo ya guardado se completa desde el Asistente, que es de donde salía la Prestadora hasta hoy.
UPDATE public.matriculas_asistente m
   SET prestadora_id = a.prestadora_id
  FROM public.asistentes a
 WHERE a.id = m.asistente_id
   AND m.prestadora_id IS DISTINCT FROM a.prestadora_id;

ALTER TABLE public.matriculas_asistente
  ALTER COLUMN prestadora_id SET NOT NULL;

-- La de una sola columna se va: la compuesta ya obliga a que el Asistente exista, y dejar las
-- dos sería la misma regla escrita dos veces.
ALTER TABLE public.matriculas_asistente
  DROP CONSTRAINT IF EXISTS matriculas_asistente_asistente_id_fkey;

ALTER TABLE public.matriculas_asistente
  DROP CONSTRAINT IF EXISTS matriculas_asistente_asistente_de_su_prestadora;

ALTER TABLE public.matriculas_asistente
  ADD CONSTRAINT matriculas_asistente_asistente_de_su_prestadora
  FOREIGN KEY (asistente_id, prestadora_id)
  REFERENCES public.asistentes (id, prestadora_id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_matriculas_asistente_prestadora
  ON public.matriculas_asistente USING btree (prestadora_id, asistente_id);

COMMENT ON COLUMN public.matriculas_asistente.prestadora_id IS
  'La Prestadora de la Matrícula. No puede diferir de la de su Asistente: la clave foránea va compuesta contra asistentes (id, prestadora_id).';

CREATE OR REPLACE VIEW public.estado_matricula_asistente WITH (security_invoker='true') AS
 SELECT a.id AS asistente_id,
    a.prestadora_id,
    a.nombre,
    a.tipo_asistente_id,
    t.requiere_matricula,
    t.tipo_matricula,
    p.modo_control_matricula,
    interno.motivo_bloqueo_matricula(a.id) AS motivo_bloqueo,
    m.id AS matricula_id,
    m.vigente_hasta,
    m.verificada_at,
        CASE
            WHEN (m.vigente_hasta IS NULL) THEN NULL::integer
            ELSE (m.vigente_hasta - CURRENT_DATE)
        END AS dias_para_vencer
   FROM (((public.asistentes a
     JOIN public.prestadoras p ON ((p.id = a.prestadora_id)))
     LEFT JOIN public.tipos_asistente t ON ((t.id = a.tipo_asistente_id)))
     LEFT JOIN LATERAL ( SELECT mm.id,
            mm.asistente_id,
            mm.tipo,
            mm.numero_matricula,
            mm.vigente_desde,
            mm.vigente_hasta,
            mm.archivo_url,
            mm.registrado_por,
            mm.created_at,
            mm.verificada_at,
            mm.verificada_por,
            mm.metodo_verificacion,
            mm.nota_verificacion
           FROM public.matriculas_asistente mm
          WHERE ((mm.asistente_id = a.id) AND (mm.prestadora_id = a.prestadora_id) AND (mm.tipo = t.tipo_matricula) AND ((mm.vigente_desde IS NULL) OR (mm.vigente_desde <= CURRENT_DATE)))
          ORDER BY (mm.vigente_hasta IS NULL) DESC, mm.vigente_hasta DESC
         LIMIT 1) m ON (true))
  WHERE (a.deleted_at IS NULL);

NOTIFY pgrst, 'reload schema';

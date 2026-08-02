-- ============================================================================
-- El catálogo de tipos de Asistente, en dos niveles, con sus tareas.
--
-- QUÉ HACE
-- Crea dos tablas: `tipos_asistente` (qué ES un Asistente: cuidador/a,
-- enfermero/a, kinesiólogo/a, médico/a…) y `tareas_tipo_asistente` (qué HACE y
-- qué NO HACE cada uno de esos tipos). Y deja sembrados los cuatro tipos
-- generales que trae CeltaTech de fábrica.
--
-- POR QUÉ (esto no se deduce leyendo el esquema)
-- Hoy el tipo de Asistente se guarda en `asistentes.especialidades`, que es una
-- lista de textos escritos a mano. Eso trae tres problemas que no se ven hasta
-- que la Prestadora tiene cien Asistentes cargados:
--
--   1. "Enfermera", "enfermería" y "Enf." son tres cosas distintas para el
--      sistema y la misma para una persona. Ninguna búsqueda funciona bien.
--   2. No hay dónde escribir qué le corresponde hacer a un enfermero y qué no.
--      Y esa segunda lista es la importante: la confusión con las Familias —que
--      le piden al Asistente cosas que no son suyas— es un problema real y
--      cotidiano, no un detalle de documentación.
--   3. No hay forma de decir "este tipo requiere matrícula". Sin eso, la regla
--      de que un enfermero sin matrícula vigente no puede atender a nadie no se
--      puede aplicar: el sistema no sabe quién es enfermero.
--
-- LOS DOS NIVELES
-- Un tipo puede venir de dos lados, y la columna `prestadora_id` es la que lo
-- dice:
--
--   prestadora_id NULL     → catálogo general de CeltaTech, lo ven todas las
--                            Prestadoras, ninguna lo puede tocar.
--   prestadora_id con dato → lo creó esa Prestadora, solo lo ve ella.
--
-- Es la misma idea de dos niveles que ya usa el producto en otras partes, y
-- evita que cada Prestadora tenga que escribir de cero "enfermero/a".
--
-- POR QUÉ LOS TIPOS GENERALES NO GUARDAN SU NOMBRE ACÁ
-- Los cuatro tipos de fábrica guardan una `clave` (`cuidador`, `enfermero`…) y
-- no un nombre. El nombre visible sale de los archivos de traducción, en los
-- tres idiomas, como todo el texto del producto (regla 1 de `CLAUDE.md` §7). Si
-- el nombre se guardara acá, el Panel en inglés mostraría "enfermero".
--
-- Los tipos que crea una Prestadora sí guardan el nombre como dato, escrito por
-- ella: es información suya, igual que el nombre de un Paciente, y no se
-- traduce. La restricción `tipos_asistente_nombre_segun_nivel` obliga a que
-- cada fila tenga una cosa o la otra, nunca las dos ni ninguna.
--
-- LAS TAREAS SON DOS LISTAS, NO UN PÁRRAFO
-- `tareas_tipo_asistente.clase` vale `corresponde` o `no_corresponde`. Podrían
-- haber sido dos columnas de texto largo, o un párrafo único; son filas con una
-- clase justamente para que la segunda lista pese lo mismo que la primera y se
-- pueda mostrar aparte, ordenada, en la pantalla de la Familia. Un párrafo que
-- mezcla las dos cosas se lee y no se entiende cuál era cuál.
--
-- LO QUE NO SE GUARDA A PROPÓSITO: LAS EXCLUSIONES QUE VIENEN DE LA LEY
-- Hay tareas que un tipo no puede hacer porque no tiene la matrícula que esa
-- tarea exige — por ejemplo, un cuidador no administra inyectables si la
-- configuración de la Prestadora pide matrícula de enfermería para esa vía.
-- Esas exclusiones NO se guardan como filas: se calculan en el momento de
-- mostrarlas, a partir de `configuracion_matricula_via_medicacion`.
--
-- El motivo es que si se guardaran, quedarían dos reglas diciendo cosas
-- distintas sobre lo mismo: la fila escrita hace seis meses y la configuración
-- de hoy. Y la que se lee en pantalla le ganaría a la que protege al Paciente.
-- Calculándolas, no pueden desincronizarse nunca, y la Prestadora tampoco las
-- puede editar para que digan lo contrario.
--
-- LO QUE ESTE ARCHIVO NO TRAE
-- El vínculo entre cada Asistente y su tipo (hoy sigue en
-- `asistentes.especialidades`), y el bloqueo por falta de matrícula. Son las
-- dos tareas siguientes. Acá quedan el catálogo, las tareas y los permisos.
--
-- CÓMO SE VUELVE ATRÁS
-- No toca ninguna tabla existente ni ningún dato. Para revertir: borrar las dos
-- tablas nuevas, en una migración nueva hacia adelante (`MIGRACIONES.md` §4).
-- ============================================================================


-- ============================================================================
-- 1. Los tipos de Asistente
-- ============================================================================
CREATE TABLE IF NOT EXISTS tipos_asistente (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id      UUID REFERENCES prestadoras(id) ON DELETE CASCADE,
  clave              TEXT,
  nombre             TEXT,
  descripcion        TEXT,
  requiere_matricula BOOLEAN NOT NULL DEFAULT false,
  tipo_matricula     TEXT,
  activo             BOOLEAN NOT NULL DEFAULT true,
  orden              INTEGER NOT NULL DEFAULT 100,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tipos_asistente IS
  'Qué ES un Asistente: cuidador/a, enfermero/a, kinesiólogo/a, médico/a y los que agregue cada Prestadora. Distinto de sus Tareas (qué hace) y de su Matrícula (qué lo autoriza).';

COMMENT ON COLUMN tipos_asistente.prestadora_id IS
  'NULL = tipo general de CeltaTech, lo ven todas las Prestadoras y ninguna lo puede tocar. Con dato = lo creó esa Prestadora y solo lo ve ella.';

COMMENT ON COLUMN tipos_asistente.clave IS
  'Solo para los tipos generales. El nombre visible sale de los archivos de traducción, buscándolo por esta clave, para que el Panel en inglés no muestre "enfermero".';

COMMENT ON COLUMN tipos_asistente.nombre IS
  'Solo para los tipos que crea una Prestadora. Es información suya, escrita por ella, y no se traduce.';

COMMENT ON COLUMN tipos_asistente.requiere_matricula IS
  'Si está en verdadero, un Asistente de este tipo sin matrícula cargada, vigente y verificada no puede atender a ningún Paciente.';

COMMENT ON COLUMN tipos_asistente.tipo_matricula IS
  'Qué matrícula exige. Se compara contra matriculas_asistente.tipo y contra configuracion_matricula_via_medicacion.tipo_matricula_requerida — los tres tienen que hablar el mismo idioma o la regla no engancha.';

-- Un tipo general tiene clave y no nombre; uno de Prestadora tiene nombre y no
-- clave. Sin esta restricción se podrían cargar los dos, y entonces no habría
-- forma de saber cuál mostrar.
ALTER TABLE tipos_asistente
  ADD CONSTRAINT tipos_asistente_nombre_segun_nivel
  CHECK (
    (prestadora_id IS NULL     AND clave IS NOT NULL AND nombre IS NULL)
    OR
    (prestadora_id IS NOT NULL AND clave IS NULL     AND nombre IS NOT NULL)
  );

-- Si un tipo pide matrícula, tiene que decir cuál. "Pide matrícula pero no
-- sabemos de qué" no se puede comprobar contra nada y dejaría al Asistente
-- bloqueado sin salida.
ALTER TABLE tipos_asistente
  ADD CONSTRAINT tipos_asistente_matricula_con_tipo
  CHECK (requiere_matricula = false OR tipo_matricula IS NOT NULL);

-- Dos tipos con el mismo nombre dentro de la misma Prestadora serían dos cosas
-- distintas en la pantalla y la misma para quien la mira. Los índices son
-- parciales porque las dos mitades del catálogo se comparan distinto: los
-- generales por clave, los propios por nombre.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tipos_asistente_clave_general
  ON tipos_asistente (clave)
  WHERE prestadora_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tipos_asistente_nombre_prestadora
  ON tipos_asistente (prestadora_id, lower(nombre))
  WHERE prestadora_id IS NOT NULL;

-- Toda pantalla que muestre el catálogo pide lo mismo: los generales más los
-- míos. Este índice es el que hace barata esa consulta.
CREATE INDEX IF NOT EXISTS idx_tipos_asistente_prestadora
  ON tipos_asistente (prestadora_id)
  WHERE activo = true;


-- ============================================================================
-- 2. Las tareas de cada tipo: las que le corresponden y las que no
-- ============================================================================
CREATE TABLE IF NOT EXISTS tareas_tipo_asistente (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_asistente_id  UUID NOT NULL REFERENCES tipos_asistente(id) ON DELETE CASCADE,
  prestadora_id      UUID REFERENCES prestadoras(id) ON DELETE CASCADE,
  clase              TEXT NOT NULL,
  clave              TEXT,
  texto              TEXT,
  orden              INTEGER NOT NULL DEFAULT 100,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tareas_tipo_asistente IS
  'Qué HACE y qué NO HACE cada tipo de Asistente. Dos listas separadas a propósito: la segunda es la que evita la confusión con las Familias.';

COMMENT ON COLUMN tareas_tipo_asistente.clase IS
  'corresponde = le toca hacerlo. no_corresponde = no le toca, y conviene que la Familia lo sepa antes de pedirlo.';

COMMENT ON COLUMN tareas_tipo_asistente.prestadora_id IS
  'Se repite acá aunque se podría llegar a él por el tipo: las políticas de aislamiento comparan contra current_tenant() y salir a buscar el tipo en cada lectura costaría una consulta más y dejaría la regla escrita en dos lugares (CLAUDE.md §7.12).';

ALTER TABLE tareas_tipo_asistente
  ADD CONSTRAINT tareas_tipo_asistente_clase_valida
  CHECK (clase IN ('corresponde', 'no_corresponde'));

-- Mismo criterio que en los tipos: las tareas de fábrica se nombran por clave y
-- se traducen; las que escribe una Prestadora son texto suyo.
ALTER TABLE tareas_tipo_asistente
  ADD CONSTRAINT tareas_tipo_asistente_texto_segun_nivel
  CHECK (
    (prestadora_id IS NULL     AND clave IS NOT NULL AND texto IS NULL)
    OR
    (prestadora_id IS NOT NULL AND clave IS NULL     AND texto IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_tareas_tipo_asistente_tipo
  ON tareas_tipo_asistente (tipo_asistente_id, clase, orden);


-- ============================================================================
-- 3. Quién puede ver y tocar qué
--
--    El catálogo general se lee siempre y no lo edita nadie desde el Panel de
--    una Prestadora — ni siquiera su administradora. Lo edita CeltaTech, que
--    entra como superadmin.
-- ============================================================================
ALTER TABLE tipos_asistente        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tareas_tipo_asistente  ENABLE ROW LEVEL SECURITY;

-- Leer: los generales los ve cualquiera con sesión; los propios, solo la
-- Prestadora dueña.
CREATE POLICY "todos_leen_tipos_asistente_visibles"
  ON tipos_asistente FOR SELECT
  USING (prestadora_id IS NULL OR prestadora_id = current_tenant());

CREATE POLICY "todos_leen_tareas_tipo_asistente_visibles"
  ON tareas_tipo_asistente FOR SELECT
  USING (prestadora_id IS NULL OR prestadora_id = current_tenant());

-- Escribir: solo la administradora de la Prestadora, y solo sobre lo suyo. La
-- condición se repite en USING y en WITH CHECK a propósito: la primera decide
-- qué filas puede tocar, la segunda impide que al guardarlas las mande a otra
-- Prestadora.
CREATE POLICY "admin_prestadora_gestiona_tipos_asistente_propios"
  ON tipos_asistente FOR ALL
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
    )
  )
  WITH CHECK (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
    )
  );

CREATE POLICY "admin_prestadora_gestiona_tareas_tipo_propias"
  ON tareas_tipo_asistente FOR ALL
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
    )
  )
  WITH CHECK (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
    )
  );

-- CeltaTech. Es la única que puede tocar el catálogo general, y además llega a
-- todo lo demás, como en el resto del producto: si una Prestadora deja un tipo
-- mal cargado y pide ayuda, tiene que haber alguien que pueda arreglarlo.
CREATE POLICY "superadmin_gestiona_tipos_asistente"
  ON tipos_asistente FOR ALL
  USING (es_superadmin())
  WITH CHECK (es_superadmin());

CREATE POLICY "superadmin_gestiona_tareas_tipo_asistente"
  ON tareas_tipo_asistente FOR ALL
  USING (es_superadmin())
  WITH CHECK (es_superadmin());

GRANT SELECT, INSERT, UPDATE, DELETE ON tipos_asistente       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tareas_tipo_asistente TO authenticated;
GRANT ALL ON tipos_asistente       TO service_role;
GRANT ALL ON tareas_tipo_asistente TO service_role;


-- ============================================================================
-- 4. Los cuatro tipos que CeltaTech trae de fábrica
--
--    Cuáles piden matrícula lo definió el Desarrollador: médico, enfermero y
--    kinesiólogo sí; cuidador no. Si aparece un quinto tipo general, se agrega
--    en una migración nueva, no editando esta.
--
--    Las tareas de cada uno no se siembran acá: qué le corresponde hacer a un
--    kinesiólogo y qué no es una definición del negocio —y en parte, legal— que
--    todavía no está escrita. Se cargan desde la pantalla de configuración
--    cuando esté, y mientras tanto el catálogo funciona igual: el tipo existe y
--    sirve para exigir la matrícula.
-- ============================================================================
INSERT INTO tipos_asistente (clave, requiere_matricula, tipo_matricula, orden)
VALUES
  ('cuidador',    false, NULL,           10),
  ('enfermero',   true,  'enfermeria',   20),
  ('kinesiologo', true,  'kinesiologia', 30),
  ('medico',      true,  'medicina',     40)
ON CONFLICT DO NOTHING;


NOTIFY pgrst, 'reload schema';

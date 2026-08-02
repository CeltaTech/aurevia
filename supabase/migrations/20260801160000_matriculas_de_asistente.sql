-- ============================================================================
-- La "habilitación" del Asistente pasa a llamarse matrícula, y se guarda cómo
-- se verificó.
--
-- QUÉ HACE
-- Dos cosas. Primero, cambia el nombre: la tabla `habilitaciones_asistente`
-- pasa a `matriculas_asistente`, y la tabla de configuración
-- `configuracion_habilitacion_via_medicacion` pasa a
-- `configuracion_matricula_via_medicacion`. Segundo, agrega cuatro columnas
-- para registrar la verificación de cada matrícula: cuándo se verificó, quién
-- la verificó, por qué medio y una nota.
--
-- POR QUÉ EL CAMBIO DE NOMBRE (esto no se deduce leyendo el esquema)
-- "Habilitación" se leía al revés de lo que significaba. Quien lo lee entiende
-- "las habilidades del Asistente", es decir las tareas de las que es
-- responsable — y esta tabla no guarda tareas: guarda el papel que lo autoriza
-- legalmente a ejercer, con su número, su vencimiento y su archivo. Son dos
-- cosas distintas que además conviven en el producto:
--
--   Tipo de Asistente  → qué ES     (enfermero, kinesiólogo, médico…)
--   Tareas             → qué HACE   (y qué no hace)
--   Matrícula          → qué lo AUTORIZA a ejercer
--
-- Mientras las tres se llamaban parecido, era cuestión de tiempo que alguien
-- escribiera una donde iba la otra. El registro de por qué se cambió está en
-- `docs/claude_history.md`, entrada del 2026-08-01.
--
-- POR QUÉ SE GUARDA EL MÉTODO DE VERIFICACIÓN Y NO UN SÍ/NO
-- La regla de negocio es que una matrícula cargada no alcanza: alguien de la
-- Prestadora tiene que verificarla, y recién ahí el Asistente queda habilitado
-- para atender. Lo que todavía no está respondido es qué exige la ley por
-- "verificar": si alcanza con mirar el papel, o si hay que comprobar el número
-- contra el registro del organismo que lo emitió (pendiente #107 de
-- `docs/PENDIENTES.md`).
--
-- Si se guardara solo un tilde de "verificada sí/no", y la respuesta legal
-- llegara cuando ya hay cientos de Asistentes cargados, no habría forma de
-- saber cuáles se miraron a ojo y cuáles se comprobaron de verdad: habría que
-- rehacerlas todas. Guardando el método, se sabe exactamente cuáles hay que
-- volver a mirar y cuáles ya están bien. Es una columna de texto hoy y evita
-- una auditoría entera mañana.
--
-- Se construye la versión estricta a propósito: aflojar después es cambiar una
-- configuración en un solo lugar; endurecer después obliga a revisar todo lo
-- ya cargado.
--
-- LO QUE ESTE ARCHIVO NO TRAE
-- El vínculo entre el tipo de Asistente y "requiere matrícula, sí o no" — eso
-- necesita primero el catálogo de tipos, que es la migración siguiente. Y el
-- bloqueo en sí (que sin matrícula vigente y verificada no se pueda derivar
-- ningún Paciente), que se apoya en ese vínculo. Acá quedan el nombre correcto
-- y el lugar donde guardar la verificación.
--
-- CÓMO SE VUELVE ATRÁS
-- No borra ni cambia ningún dato: solo cambia nombres y agrega columnas
-- vacías. Para revertir, una migración nueva hacia adelante que deshaga los
-- nombres — nunca editando esta (`MIGRACIONES.md` §4).
--
-- CUIDADO AL APLICARLA
-- Cambiar el nombre de una tabla rompe todo el código que todavía use el
-- nombre viejo. Esta migración se aplica junto con el despliegue del Panel y
-- del backend que ya usan `matriculas_asistente`, no antes.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. La tabla de matrículas y todo lo que cuelga de ella
-- ---------------------------------------------------------------------------

ALTER TABLE public.habilitaciones_asistente RENAME TO matriculas_asistente;

ALTER TABLE public.matriculas_asistente
  RENAME CONSTRAINT habilitaciones_asistente_pkey TO matriculas_asistente_pkey;

ALTER TABLE public.matriculas_asistente
  RENAME CONSTRAINT habilitaciones_asistente_asistente_id_fkey
  TO matriculas_asistente_asistente_id_fkey;

ALTER TABLE public.matriculas_asistente
  RENAME CONSTRAINT habilitaciones_asistente_registrado_por_fkey
  TO matriculas_asistente_registrado_por_fkey;

ALTER INDEX public.idx_habilitaciones_asistente_asistente
  RENAME TO idx_matriculas_asistente_asistente;

-- Las políticas de seguridad se renombran, no se rehacen: el texto de la regla
-- queda guardado ya interpretado, así que sigue apuntando a la tabla correcta
-- sola. Rehacerlas sería la oportunidad de escribir mal una y aflojar un
-- permiso sin darse cuenta.
ALTER POLICY admin_prestadora_gestiona_habilitaciones_asistente
  ON public.matriculas_asistente
  RENAME TO admin_prestadora_gestiona_matriculas_asistente;

ALTER POLICY coordinador_lee_habilitaciones_asistente
  ON public.matriculas_asistente
  RENAME TO coordinador_lee_matriculas_asistente;

COMMENT ON TABLE public.matriculas_asistente IS
  'El papel que autoriza legalmente a un Asistente a ejercer: número, vigencia y archivo. No guarda tareas ni tipo de Asistente — son otras tres cosas.';


-- ---------------------------------------------------------------------------
-- 2. Cómo se verificó cada matrícula
-- ---------------------------------------------------------------------------

ALTER TABLE public.matriculas_asistente
  ADD COLUMN verificada_at       timestamp with time zone,
  ADD COLUMN verificada_por      uuid REFERENCES public.usuarios(id),
  ADD COLUMN metodo_verificacion text,
  ADD COLUMN nota_verificacion   text;

COMMENT ON COLUMN public.matriculas_asistente.verificada_at IS
  'Cuándo se verificó. Mientras esté vacía, la matrícula está cargada pero no aprobada, y el Asistente sigue bloqueado.';

COMMENT ON COLUMN public.matriculas_asistente.verificada_por IS
  'Quién la verificó. Es una persona con nombre, no "el sistema": si mañana se descubre que una matrícula no era válida, tiene que saberse quién la dio por buena.';

COMMENT ON COLUMN public.matriculas_asistente.metodo_verificacion IS
  'Por qué medio se verificó. Existe por el pendiente #107: si la ley termina exigiendo comprobación contra el registro oficial, esta columna dice cuáles hay que volver a mirar.';

COMMENT ON COLUMN public.matriculas_asistente.nota_verificacion IS
  'Aclaración libre de quien verificó. Para el caso raro que no entra en ninguna de las tres formas.';

-- Las tres formas de verificar, de menos a más fuerte. Si aparece una cuarta,
-- se agrega acá y en un solo lugar del Panel.
ALTER TABLE public.matriculas_asistente
  ADD CONSTRAINT matriculas_asistente_metodo_verificacion_valido
  CHECK (
    metodo_verificacion IS NULL
    OR metodo_verificacion IN (
      'documento_a_la_vista',        -- se miró el papel o el archivo cargado
      'constancia_del_organismo',    -- el organismo emitió una constancia a nombre de la Prestadora
      'registro_oficial_en_linea'    -- se comprobó el número contra el registro público del organismo
    )
  );

-- Verificar es un acto completo o no es nada. No puede quedar una matrícula
-- con fecha de verificación pero sin saber quién ni cómo — eso sería peor que
-- no tenerla verificada, porque en pantalla se vería aprobada.
ALTER TABLE public.matriculas_asistente
  ADD CONSTRAINT matriculas_asistente_verificacion_completa
  CHECK (
    (verificada_at IS NULL AND verificada_por IS NULL AND metodo_verificacion IS NULL)
    OR
    (verificada_at IS NOT NULL AND verificada_por IS NOT NULL AND metodo_verificacion IS NOT NULL)
  );

-- El control de vencimientos pregunta todos los días "¿cuáles vencen dentro de
-- los próximos 30 días?". Sin este índice, esa pregunta recorre la tabla
-- entera. Las matrículas sin fecha de vencimiento no entran: nunca vencen, y
-- no tiene sentido cargarlas al índice.
CREATE INDEX idx_matriculas_asistente_vencimiento
  ON public.matriculas_asistente (vigente_hasta)
  WHERE vigente_hasta IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 3. La configuración de qué matrícula exige cada vía de medicación
-- ---------------------------------------------------------------------------

ALTER TABLE public.configuracion_habilitacion_via_medicacion
  RENAME TO configuracion_matricula_via_medicacion;

ALTER TABLE public.configuracion_matricula_via_medicacion
  RENAME COLUMN tipo_habilitacion_requerida TO tipo_matricula_requerida;

ALTER TABLE public.configuracion_matricula_via_medicacion
  RENAME CONSTRAINT configuracion_habilitacion_via_medicacion_pkey
  TO configuracion_matricula_via_medicacion_pkey;

ALTER TABLE public.configuracion_matricula_via_medicacion
  RENAME CONSTRAINT "configuracion_habilitacion_vi_prestadora_id_via_administrac_key"
  TO configuracion_matricula_via_prestadora_via_administracion_key;

ALTER TABLE public.configuracion_matricula_via_medicacion
  RENAME CONSTRAINT configuracion_habilitacion_via_medicacion_prestadora_id_fkey
  TO configuracion_matricula_via_medicacion_prestadora_id_fkey;

ALTER POLICY admin_prestadora_gestiona_config_habilitacion_via
  ON public.configuracion_matricula_via_medicacion
  RENAME TO admin_prestadora_gestiona_config_matricula_via;

ALTER POLICY coordinador_lee_config_habilitacion_via
  ON public.configuracion_matricula_via_medicacion
  RENAME TO coordinador_lee_config_matricula_via;

COMMENT ON TABLE public.configuracion_matricula_via_medicacion IS
  'Qué matrícula exige cada vía de administración de medicación, por Prestadora. Ejemplo: los inyectables piden matrícula de enfermería.';


-- ---------------------------------------------------------------------------
-- 4. La advertencia legal que usa la palabra vieja
--
-- El aviso que aparece cuando se acepta una indicación de medicación y ningún
-- Asistente del Paciente tiene la matrícula que esa vía exige está guardado en
-- la base, no en el código, y se lo busca por su clave. Si la clave se cambia
-- acá y no en el código —o al revés— el aviso deja de aparecer **en silencio**:
-- la búsqueda no encuentra nada y el sistema entiende que no hay nada que
-- advertir. Por eso el cambio de la clave va en la misma migración que el resto
-- del renombre, y el código que la busca se despliega junto con ella.
-- ---------------------------------------------------------------------------

UPDATE public.advertencias_legales
   SET funcion_clave = 'medicacion_via_sin_matricula',
       updated_at    = now()
 WHERE funcion_clave = 'medicacion_via_sin_habilitacion';

-- El historial de quién aceptó qué advertencia se corrige también: si quedara
-- con la clave vieja, una consulta futura por la clave nueva mostraría cero
-- aceptaciones y parecería que nadie fue advertido nunca.
UPDATE public.auditoria_advertencias_legales
   SET funcion_clave = 'medicacion_via_sin_matricula'
 WHERE funcion_clave = 'medicacion_via_sin_habilitacion';


NOTIFY pgrst, 'reload schema';

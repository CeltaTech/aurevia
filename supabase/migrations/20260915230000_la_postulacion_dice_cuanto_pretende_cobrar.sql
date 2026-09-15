-- ---------------------------------------------------------------------------------------
-- La postulación dice cuánto pretende cobrar
--
-- POR QUÉ. La lista de postulantes del Panel tiene que mostrar la pretensión de honorario por
-- hora y poder filtrar por rango (`docs/PRD_03_Reclutamiento.md`, «Panel de administración —
-- sección Postulantes»), y ese dato no estaba guardado en ninguna parte. El PRD lo releva en el
-- formulario a propósito y no lo publica en el sitio: se pregunta sin sesgar la respuesta y se
-- acuerda en la entrevista.
--
-- CON SU MONEDA. Es un importe, así que nace con la columna `moneda` y el mismo disparador que
-- completa la del resto de las tablas desde la Prestadora. Un número suelto no dice cuánto es.
--
-- NO ES OBLIGATORIO. Quien se postula puede no querer decirlo, y una postulación sin ese dato
-- entra igual: la pantalla muestra un guión y quien la revisa lo pregunta en la entrevista.
-- ---------------------------------------------------------------------------------------

ALTER TABLE public.postulaciones
  ADD COLUMN IF NOT EXISTS honorario_pretendido NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS moneda public.moneda_iso;

-- Un honorario en cero o negativo no es una pretensión: es un dato mal cargado.
ALTER TABLE public.postulaciones DROP CONSTRAINT IF EXISTS postulaciones_honorario_positivo;
ALTER TABLE public.postulaciones ADD CONSTRAINT postulaciones_honorario_positivo CHECK (
  honorario_pretendido IS NULL OR honorario_pretendido > 0
);

-- Las postulaciones que ya estaban cargadas no tienen el dato, pero sí tienen Prestadora: la
-- moneda es la de ella, y así la columna puede ser obligatoria desde el principio.
UPDATE public.postulaciones p
  SET moneda = interno.moneda_de_prestadora(p.prestadora_id)
  WHERE p.moneda IS NULL;

DROP TRIGGER IF EXISTS trg_completar_moneda ON public.postulaciones;
CREATE TRIGGER trg_completar_moneda
  BEFORE INSERT ON public.postulaciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_completar_moneda();

-- `prestadora_id` es obligatoria en esta tabla y `prestadoras.moneda` también lo es, así que
-- nunca falta de dónde sacarla.
ALTER TABLE public.postulaciones ALTER COLUMN moneda SET NOT NULL;

COMMENT ON COLUMN public.postulaciones.honorario_pretendido IS
  'Lo que la persona pretende cobrar por hora. Opcional: no decirlo no traba la postulación.';

NOTIFY pgrst, 'reload schema';

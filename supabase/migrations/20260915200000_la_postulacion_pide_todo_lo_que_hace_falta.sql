-- ---------------------------------------------------------------------------------------
-- La postulación pide todo lo que hace falta
--
-- POR QUÉ. `postulaciones` guardaba doce campos y el formulario que describe
-- `docs/PRD_03_Reclutamiento.md:96-165` pide muchos más: la fecha de nacimiento con la que se
-- comprueba la mayoría de edad, el domicilio ubicado en el mapa, la localidad, la
-- nacionalidad, el CUIL, el género, la foto de perfil, el tipo de registro ante AFIP, la obra
-- social, los estudios, la experiencia laboral, las referencias, la experiencia clínica, la
-- distancia máxima desde el domicilio y si acepta urgencias, con retiro y sin retiro.
--
-- CÓMO SE NOMBRAN. Lo que persiste se nombra por lo que hace. Donde la ficha del Asistente ya
-- tiene el dato —domicilio, latitud, longitud— se usa el mismo nombre, porque una postulación
-- aprobada se convierte en Asistente y ahí los dos nombres tienen que coincidir.
--
-- LO QUE ES LISTA DE OPCIONES NO SE ESCRIBE EN LA PANTALLA. Género, nacionalidad, tipo de
-- registro ante AFIP y los cinco subgrupos de experiencia clínica son catálogos, y van a
-- `opciones_postulacion`, una fila por opción y por Prestadora. Nace vacía a propósito: el
-- contenido de esos catálogos es de cada Prestadora, y el sistema no lo inventa.
-- ---------------------------------------------------------------------------------------

-- -----------------------------------------------------------------------------------------
-- 1. Lo que la postulación no sabía preguntar
-- -----------------------------------------------------------------------------------------
ALTER TABLE public.postulaciones
  ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE,
  ADD COLUMN IF NOT EXISTS domicilio TEXT,
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS localidad TEXT,
  ADD COLUMN IF NOT EXISTS nacionalidad TEXT,
  ADD COLUMN IF NOT EXISTS cuil TEXT,
  ADD COLUMN IF NOT EXISTS genero TEXT,
  ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT,
  ADD COLUMN IF NOT EXISTS tipo_registro_afip TEXT,
  ADD COLUMN IF NOT EXISTS obra_social TEXT,
  -- Tres listas que crecen mientras se completa el formulario, cada una con su propia forma.
  -- Van como documento y no como tabla aparte porque son parte de la postulación y no se
  -- consultan por separado: se leen enteras con ella o no se leen.
  ADD COLUMN IF NOT EXISTS estudios JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS experiencia_laboral JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS referencias_laborales JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Las claves del catálogo de experiencia clínica que la persona marcó.
  ADD COLUMN IF NOT EXISTS experiencia_clinica TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS distancia_maxima_km NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS disponible_urgencias BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS disponible_con_retiro BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS disponible_sin_retiro BOOLEAN NOT NULL DEFAULT FALSE;

-- Las tres listas son listas, no cualquier cosa: una forma equivocada se rechaza al escribir y
-- no cuando alguien la quiere leer.
ALTER TABLE public.postulaciones DROP CONSTRAINT IF EXISTS postulaciones_listas_son_listas;
ALTER TABLE public.postulaciones ADD CONSTRAINT postulaciones_listas_son_listas CHECK (
  jsonb_typeof(estudios) = 'array'
  AND jsonb_typeof(experiencia_laboral) = 'array'
  AND jsonb_typeof(referencias_laborales) = 'array'
);

-- La distancia máxima es una distancia: en cero o negativa no describe ninguna zona.
ALTER TABLE public.postulaciones DROP CONSTRAINT IF EXISTS postulaciones_distancia_positiva;
ALTER TABLE public.postulaciones ADD CONSTRAINT postulaciones_distancia_positiva CHECK (
  distancia_maxima_km IS NULL OR distancia_maxima_km > 0
);

COMMENT ON COLUMN public.postulaciones.fecha_nacimiento IS
  'La mayoría de edad se comprueba contra la escala legal vigente de la jurisdicción, nunca contra un 18 escrito en el código.';
COMMENT ON COLUMN public.postulaciones.experiencia_clinica IS
  'Claves de opciones_postulacion cuyo grupo empieza con experiencia_clinica_.';

-- -----------------------------------------------------------------------------------------
-- 2. El catálogo de opciones del formulario
-- -----------------------------------------------------------------------------------------
-- Una sola tabla para todas las listas de opciones del formulario, y no una por lista: son la
-- misma cosa —una opción que se elige, con su nombre y su orden— y separarlas repetiría la
-- misma estructura ocho veces.
CREATE TABLE IF NOT EXISTS public.opciones_postulacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  grupo TEXT NOT NULL,
  clave TEXT NOT NULL,
  etiqueta TEXT NOT NULL,
  orden SMALLINT NOT NULL DEFAULT 100,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opciones_postulacion_grupo_conocido CHECK (grupo IN (
    'genero',
    'nacionalidad',
    'tipo_registro_afip',
    'experiencia_clinica_discapacidades',
    'experiencia_clinica_patologias',
    'experiencia_clinica_cuidado_directo',
    'experiencia_clinica_acompanamiento',
    'experiencia_clinica_tareas_domesticas'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opciones_postulacion_clave
  ON public.opciones_postulacion (prestadora_id, grupo, clave);
CREATE INDEX IF NOT EXISTS idx_opciones_postulacion_activas
  ON public.opciones_postulacion (prestadora_id, grupo, orden) WHERE activo = TRUE;

ALTER TABLE public.opciones_postulacion ENABLE ROW LEVEL SECURITY;

-- Quien las gestiona es la administración de su propia Prestadora, y nadie ve las de otra.
DROP POLICY IF EXISTS gestiona_opciones_postulacion_la_administracion ON public.opciones_postulacion;
CREATE POLICY gestiona_opciones_postulacion_la_administracion ON public.opciones_postulacion
  USING (prestadora_id = interno.current_tenant() AND (interno.es_superadmin() OR interno.es_admin_prestadora()))
  WITH CHECK (prestadora_id = interno.current_tenant() AND (interno.es_superadmin() OR interno.es_admin_prestadora()));

-- Y quien trabaja en el Panel las lee para mirar una postulación cargada.
DROP POLICY IF EXISTS lee_opciones_postulacion_el_panel ON public.opciones_postulacion;
CREATE POLICY lee_opciones_postulacion_el_panel ON public.opciones_postulacion
  FOR SELECT USING (prestadora_id = interno.current_tenant());

-- El formulario público no consulta la base: se las pide al motor, que entra con la llave de
-- servicio y resuelve la Prestadora por el dominio del sitio. Por eso acá no hay política para
-- quien no inició sesión.

-- El permiso de tabla no es la política: sin esto, la política perfecta bloquea en vez de
-- proteger. El motor entra con la llave de servicio y necesita el suyo aparte.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.opciones_postulacion TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.opciones_postulacion TO service_role;

CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR DELETE OR UPDATE ON public.opciones_postulacion
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_soporte_mutacion();

-- -----------------------------------------------------------------------------------------
-- 3. La edad mínima para trabajar es un valor legal
-- -----------------------------------------------------------------------------------------
-- No son 18 en todas partes y no siempre fueron 18 acá. Va a la tabla de escalas, con su
-- vigencia, como el resto de los valores legales.
ALTER TABLE public.escalas_legales DROP CONSTRAINT IF EXISTS escalas_legales_unidad_check;
ALTER TABLE public.escalas_legales ADD CONSTRAINT escalas_legales_unidad_check
  CHECK (unidad = ANY (ARRAY['monto_fijo_mensual', 'porcentaje', 'dias', 'meses', 'horas', 'anios', 'monto_por_hora']));

DO $bloque$
BEGIN
  IF EXISTS (SELECT 1 FROM public.escalas_legales WHERE tipo = 'edad_minima_para_trabajar' AND jurisdiccion = 'AR') THEN
    RAISE NOTICE 'escalas_legales ya tiene la edad mínima de AR: no se toca nada.';
  ELSE
    INSERT INTO public.escalas_legales (jurisdiccion, tipo, categoria, valor, unidad, moneda, vigencia_desde, fuente) VALUES
      ('AR', 'edad_minima_para_trabajar', 'general', 18, 'anios', NULL, '2026-01-01', 'PROVISORIO — validar con abogado laboralista');
  END IF;
END
$bloque$;

NOTIFY pgrst, 'reload schema';

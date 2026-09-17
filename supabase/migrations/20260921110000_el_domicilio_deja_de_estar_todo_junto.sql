-- El domicilio deja de estar todo junto.
-- =====================================
--
-- QUÉ PASA HOY. El domicilio del Paciente, el del Asistente y el domicilio temporal del Paciente
-- son un solo renglón de texto: «Av. Cabildo 2345 4B, Belgrano». Escrito así no se puede buscar a
-- los Pacientes de una localidad, no se puede comparar contra los lugares donde una Asistente
-- acepta trabajar, y quien lo carga decide cada vez qué parte escribe y en qué orden.
--
-- CÓMO QUEDA. Calle, número, piso y unidad por separado, y el lugar elegido de la lista de lugares
-- de la Prestadora. La calle y el número siguen siendo texto porque los escribe una persona; el
-- lugar no, porque existe en otro lado y tecleado crearía uno que no existe.
--
-- POR QUÉ `unidad` Y NO «departamento». El departamento de un edificio y el departamento de una
-- provincia se escriben igual, y el segundo es una de las divisiones que devuelve el organismo
-- oficial. `unidad` es como lo nombra la ley de propiedad horizontal y no choca con nada.
--
-- EL PUNTO EN EL MAPA NO CAMBIA. `lat` y `lng` ya estaban en las tres tablas y siguen ahí: las
-- llena el servicio de direcciones y se usan para la distancia del registro de llegada.
--
-- LO VIEJO NO SE BORRA TODAVÍA. `domicilio` queda donde está mientras alguna pantalla siga
-- escribiéndolo. Se retira al final del paso, junto con las columnas de zonas escritas a mano,
-- cuando ya no quede nadie leyéndolo. Y no hay nada que convertir: lo cargado son datos inventados
-- de las Organizaciones de prueba.

-- ---------------------------------------------------------------------------
-- Dónde vive el Paciente
-- ---------------------------------------------------------------------------

ALTER TABLE public.pacientes
  ADD COLUMN IF NOT EXISTS calle text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS piso text,
  ADD COLUMN IF NOT EXISTS unidad text,
  ADD COLUMN IF NOT EXISTS lugar_id uuid;

ALTER TABLE public.pacientes
  ADD CONSTRAINT pacientes_lugar_fkey
  FOREIGN KEY (lugar_id, prestadora_id)
  REFERENCES public.lugares (id, prestadora_id);

CREATE INDEX IF NOT EXISTS idx_pacientes_por_lugar
  ON public.pacientes (prestadora_id, lugar_id);

COMMENT ON COLUMN public.pacientes.lugar_id IS
  'La localidad o el barrio donde vive, elegido de la lista de lugares de la Prestadora.';

COMMENT ON COLUMN public.pacientes.unidad IS
  'El departamento dentro del piso. Se llama unidad para no confundirlo con el departamento de una provincia.';

-- ---------------------------------------------------------------------------
-- Dónde vive la Asistente
-- ---------------------------------------------------------------------------
--
-- Su domicilio es de dónde sale a trabajar, y por eso importa la distancia. Es distinto de dónde
-- acepta trabajar, que se guarda aparte en la lista de sus lugares.

ALTER TABLE public.asistentes
  ADD COLUMN IF NOT EXISTS calle text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS piso text,
  ADD COLUMN IF NOT EXISTS unidad text,
  ADD COLUMN IF NOT EXISTS lugar_id uuid;

ALTER TABLE public.asistentes
  ADD CONSTRAINT asistentes_lugar_fkey
  FOREIGN KEY (lugar_id, prestadora_id)
  REFERENCES public.lugares (id, prestadora_id);

CREATE INDEX IF NOT EXISTS idx_asistentes_por_lugar
  ON public.asistentes (prestadora_id, lugar_id);

COMMENT ON COLUMN public.asistentes.lugar_id IS
  'La localidad o el barrio donde vive. Donde acepta trabajar se guarda aparte, en asistente_lugares.';

-- ---------------------------------------------------------------------------
-- Dónde está el Paciente mientras dura un domicilio temporal
-- ---------------------------------------------------------------------------

ALTER TABLE public.domicilios_temporales_paciente
  ADD COLUMN IF NOT EXISTS calle text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS piso text,
  ADD COLUMN IF NOT EXISTS unidad text,
  ADD COLUMN IF NOT EXISTS lugar_id uuid;

ALTER TABLE public.domicilios_temporales_paciente
  ADD CONSTRAINT domicilios_temporales_paciente_lugar_fkey
  FOREIGN KEY (lugar_id, prestadora_id)
  REFERENCES public.lugares (id, prestadora_id);

CREATE INDEX IF NOT EXISTS idx_domicilios_temporales_por_lugar
  ON public.domicilios_temporales_paciente (prestadora_id, lugar_id);

COMMENT ON COLUMN public.domicilios_temporales_paciente.lugar_id IS
  'La localidad o el barrio donde esta el Paciente mientras dura el domicilio temporal.';

-- ---------------------------------------------------------------------------
-- La localidad de una solicitud
-- ---------------------------------------------------------------------------
--
-- La escribe quien llama a pedir el servicio, antes de que exista ficha de nadie, así que el texto
-- se queda: es lo que dijo esa persona. Lo que se agrega es el lugar reconocido, cuando quien
-- atiende lo puede señalar en la lista. Uno es lo que se escuchó; el otro, lo que se entendió.

ALTER TABLE public.solicitudes
  ADD COLUMN IF NOT EXISTS lugar_id uuid;

ALTER TABLE public.solicitudes
  ADD CONSTRAINT solicitudes_lugar_fkey
  FOREIGN KEY (lugar_id, prestadora_id)
  REFERENCES public.lugares (id, prestadora_id);

CREATE INDEX IF NOT EXISTS idx_solicitudes_por_lugar
  ON public.solicitudes (prestadora_id, lugar_id);

COMMENT ON COLUMN public.solicitudes.lugar_id IS
  'El lugar reconocido de la lista, cuando quien atiende lo pudo señalar. La columna localidad guarda lo que dijo quien llamo.';

NOTIFY pgrst, 'reload schema';

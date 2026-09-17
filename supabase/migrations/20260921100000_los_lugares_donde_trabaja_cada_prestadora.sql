-- Los lugares donde trabaja cada Prestadora.
-- =========================================
--
-- QUÉ FALTABA. En el producto no había ninguna lista de localidades ni de barrios. La única
-- `localidad` de la base está en `solicitudes` y es la que escribió quien llamó. El domicilio del
-- Paciente, el del Asistente y el domicilio temporal del Paciente son un renglón entero de texto,
-- así que no hay forma de buscar los Pacientes ni las Familias de una localidad. Y la zona del
-- Asistente se teclea separada por comas en tres lugares —su alta, su ficha y la aprobación de su
-- postulación—, aunque la Prestadora ya carga sus zonas en Configuración (`zonas_cobertura`) y
-- ninguna pantalla de Asistentes se las ofrece.
--
-- POR QUÉ IMPORTA MÁS DE LO QUE PARECE. Ese texto tecleado no decide solamente a quién se le
-- ofrece una guardia. Las políticas de esta base comparan el texto de la coordinadora contra el
-- del Asistente (`u.zonas && a.zonas`) para decidir a quién ve cada una, y el perfil público que
-- ve la Familia muestra esas mismas palabras. Una zona escrita distinta no encuentra a nadie, y
-- nadie se entera.
--
-- UNA SOLA LISTA, DE UN SOLO NIVEL. Localidades y barrios conviven en la misma tabla porque son lo
-- mismo para lo que se usan: decir dónde. El organismo oficial de un país los mezcla igual — el
-- servicio de direcciones del Estado argentino no tiene un recurso de barrios, y en la Ciudad de
-- Buenos Aires sus «localidades» son justamente los barrios. Dos listas obligarían a cruzarlas
-- después, y a decidir en cada pantalla cuál de las dos mirar.
--
-- DE DÓNDE SALE CADA RENGLÓN, Y POR QUÉ QUEDA ESCRITO. Un lugar puede venir del organismo oficial
-- del país, y entonces trae su identificador, o puede haberlo agregado la Prestadora porque el
-- organismo no lo tiene —el barrio de una ciudad del interior—. Saber cuál es cuál es lo que
-- permite, el día que el organismo lo incorpore, reconocer el propio y unirlo sin duplicar.
--
-- LA LISTA ES DE CADA PRESTADORA. No hay un padrón de lugares de Careonys del que todas se
-- sirvan: cada una carga los lugares donde trabaja, y ahí decide qué es un barrio para ella. Una
-- lista compartida obligaría a que todas acepten el mismo recorte, y además pondría a Careonys a
-- mantener geografía de cada país, que no es su trabajo.
--
-- LA ZONA DE COBERTURA PASA A SER UN CONJUNTO DE LUGARES. Hasta hoy una zona era un nombre suelto
-- —«Zona Norte»— que no decía qué abarca. Agrupar es decisión de cada Prestadora: el organismo
-- oficial sirve de referencia para sugerir, nunca para imponer.
--
-- Y DE LA ASISTENTE SE GUARDAN LUGARES, NO ZONAS. Su disponibilidad no tiene por qué coincidir con
-- el agrupamiento de la Prestadora: puede cubrir dos localidades del norte y una del oeste, y
-- ninguna otra. Guardar la zona diría de más, y aparecería disponible donde no va. La zona queda
-- como atajo para cargar —marcarla entera y después desmarcar— y como forma de hablar en pantalla:
-- agrupar para mostrar es distinto de guardar. El alcance de la coordinadora se guarda igual, en
-- lugares, para que las dos puntas de la comparación sean la misma cosa.
--
-- QUÉ NO HACE ESTA MIGRACIÓN. No toca `asistentes.zonas` ni `usuarios.zonas`, que siguen siendo el
-- texto de hoy y siguen mandando mientras las pantallas no elijan lugares. Cambiar las políticas y
-- sacar esas columnas es el final del paso, cuando ya no quede nadie leyéndolas.

-- ---------------------------------------------------------------------------
-- 1. La lista de lugares
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lugares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),

  -- Cómo se llama el lugar, tal como lo va a leer una persona: «Villa Urquiza», «Rosario».
  nombre text NOT NULL,

  -- El país al que pertenece, con el mismo código de dos letras que usa `prestadoras.pais`. Está
  -- acá y no se deduce de la Prestadora porque una puede trabajar cerca de una frontera, y porque
  -- de dónde se alimenta la lista es configuración por país.
  pais text NOT NULL,

  -- Lo que hace falta para reconocer el lugar cuando hay dos con el mismo nombre, que es lo
  -- corriente: hay un Belgrano en varias provincias. Son los nombres tal como los devuelve el
  -- organismo, para mostrar; lo que identifica es `id_oficial`.
  provincia text,
  municipio text,

  -- El identificador que le da el organismo oficial del país. En blanco cuando el lugar lo agregó
  -- la Prestadora porque el organismo no lo tiene.
  id_oficial text,

  -- De dónde salió este renglón. Con `oficial` el nombre y el identificador son del organismo y
  -- no se editan a mano; con `propio` los puso la Prestadora.
  fuente text NOT NULL DEFAULT 'propio',

  -- El lugar que lo contiene, cuando lo hay: el barrio propio cuelga de su localidad. Es la única
  -- jerarquía que existe acá, y es opcional: una localidad no cuelga de nada.
  parte_de uuid,

  -- El punto en el mapa, para medir distancias. Del organismo cuando vino de ahí; en blanco
  -- cuando no se sabe, nunca un punto inventado.
  lat double precision,
  lng double precision,

  -- Un lugar donde se dejó de trabajar se apaga y no se borra: hay fichas y zonas que lo nombran.
  activo boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lugares_fuente_conocida
    CHECK (fuente IN ('oficial', 'propio')),

  -- Un lugar oficial sin identificador no se puede reconocer después, que es justamente para lo
  -- que se lo marca como oficial.
  CONSTRAINT lugares_el_oficial_trae_su_identificador
    CHECK (fuente <> 'oficial' OR id_oficial IS NOT NULL),

  -- Un lugar no puede colgar de sí mismo.
  CONSTRAINT lugares_no_se_contiene_a_si_mismo
    CHECK (parte_de IS NULL OR parte_de <> id),

  -- Sirve para que lo que cuelgue de un lugar no pueda ser de otra Organización.
  CONSTRAINT lugares_id_prestadora_unico UNIQUE (id, prestadora_id)
);

ALTER TABLE public.lugares
  ADD CONSTRAINT lugares_parte_de_fkey
  FOREIGN KEY (parte_de, prestadora_id)
  REFERENCES public.lugares (id, prestadora_id);

-- El mismo lugar oficial no entra dos veces en la lista de una Prestadora. Es lo que evita que
-- buscarlo de nuevo en el organismo cree un duplicado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lugares_oficial_una_vez_por_prestadora
  ON public.lugares (prestadora_id, pais, id_oficial)
  WHERE id_oficial IS NOT NULL;

-- Y el que agregó la Prestadora tampoco: dos veces el mismo nombre adentro del mismo lugar que lo
-- contiene es el tipeo que esta tabla viene a terminar. Se compara sin distinguir mayúsculas ni
-- espacios de más.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lugares_propio_una_vez_por_prestadora
  ON public.lugares (prestadora_id, pais, lower(btrim(nombre)), COALESCE(parte_de, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE id_oficial IS NULL;

CREATE INDEX IF NOT EXISTS idx_lugares_por_prestadora
  ON public.lugares (prestadora_id, activo, nombre);

COMMENT ON TABLE public.lugares IS
  'Las localidades y los barrios donde trabaja una Prestadora, en una sola lista de un solo nivel. Cada renglon dice si salio del organismo oficial del pais o lo agrego la Prestadora.';

COMMENT ON COLUMN public.lugares.id_oficial IS
  'El identificador del organismo oficial del pais. En blanco cuando el lugar lo agrego la Prestadora.';

COMMENT ON COLUMN public.lugares.parte_de IS
  'El lugar que lo contiene, cuando lo hay: un barrio cuelga de su localidad. Una localidad no cuelga de nada.';

COMMENT ON COLUMN public.lugares.fuente IS
  'oficial (nombre e identificador del organismo, no se editan a mano) o propio (los puso la Prestadora).';

-- ---------------------------------------------------------------------------
-- 2. Qué lugares abarca cada zona de cobertura
-- ---------------------------------------------------------------------------

-- Para poder apuntar a una zona sin salirse de la Organización hace falta que la zona sea única
-- por las dos cosas a la vez. `asistentes` ya tiene la suya; `zonas_cobertura` no la tenía.
ALTER TABLE public.zonas_cobertura
  ADD CONSTRAINT zonas_cobertura_id_prestadora_unico UNIQUE (id, prestadora_id);

CREATE TABLE IF NOT EXISTS public.zona_lugares (
  zona_id uuid NOT NULL,
  lugar_id uuid NOT NULL,
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (zona_id, lugar_id),

  CONSTRAINT zona_lugares_zona_fkey
    FOREIGN KEY (zona_id, prestadora_id)
    REFERENCES public.zonas_cobertura (id, prestadora_id) ON DELETE CASCADE,

  CONSTRAINT zona_lugares_lugar_fkey
    FOREIGN KEY (lugar_id, prestadora_id)
    REFERENCES public.lugares (id, prestadora_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zona_lugares_por_lugar
  ON public.zona_lugares (lugar_id);

COMMENT ON TABLE public.zona_lugares IS
  'Que lugares abarca cada zona de cobertura. El agrupamiento lo decide cada Prestadora; un mismo lugar puede estar en mas de una zona.';

-- ---------------------------------------------------------------------------
-- 3. Dónde trabaja cada Asistente
-- ---------------------------------------------------------------------------
--
-- Se guardan lugares y no zonas, por lo dicho arriba. La pantalla ofrece marcar una zona entera
-- para no tener que tildar veinte renglones, pero lo que queda escrito son los lugares.

CREATE TABLE IF NOT EXISTS public.asistente_lugares (
  asistente_id uuid NOT NULL,
  lugar_id uuid NOT NULL,
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (asistente_id, lugar_id),

  CONSTRAINT asistente_lugares_asistente_fkey
    FOREIGN KEY (asistente_id, prestadora_id)
    REFERENCES public.asistentes (id, prestadora_id) ON DELETE CASCADE,

  CONSTRAINT asistente_lugares_lugar_fkey
    FOREIGN KEY (lugar_id, prestadora_id)
    REFERENCES public.lugares (id, prestadora_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asistente_lugares_por_lugar
  ON public.asistente_lugares (lugar_id);

COMMENT ON TABLE public.asistente_lugares IS
  'Los lugares donde cada Asistente acepta trabajar. Se guardan lugares y no zonas: su disponibilidad no tiene por que coincidir con el agrupamiento de la Prestadora.';

-- ---------------------------------------------------------------------------
-- 4. Hasta dónde llega cada coordinadora
-- ---------------------------------------------------------------------------

-- Mismo motivo que arriba: sin esto, el alcance de una coordinadora podría apuntar a un usuario de
-- otra Organización.
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_id_prestadora_unico UNIQUE (id, prestadora_id);

CREATE TABLE IF NOT EXISTS public.usuario_lugares (
  usuario_id uuid NOT NULL,
  lugar_id uuid NOT NULL,
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (usuario_id, lugar_id),

  CONSTRAINT usuario_lugares_usuario_fkey
    FOREIGN KEY (usuario_id, prestadora_id)
    REFERENCES public.usuarios (id, prestadora_id) ON DELETE CASCADE,

  CONSTRAINT usuario_lugares_lugar_fkey
    FOREIGN KEY (lugar_id, prestadora_id)
    REFERENCES public.lugares (id, prestadora_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usuario_lugares_por_lugar
  ON public.usuario_lugares (lugar_id);

COMMENT ON TABLE public.usuario_lugares IS
  'Hasta donde llega cada coordinadora, en lugares. Reemplaza al texto de usuarios.zonas cuando las pantallas dejen de escribirlo.';

-- ---------------------------------------------------------------------------
-- 5. Quién ve qué
-- ---------------------------------------------------------------------------
--
-- Escribe el motor con la llave de servicio, así que estas políticas son la segunda red. La lista
-- de lugares la lee cualquiera con sesión adentro de su Organización: es un catálogo de geografía,
-- no dice nada de ninguna persona, y las pantallas que eligen un lugar la necesitan. Quién puede
-- cargarla y modificarla es la administración de la Prestadora, con el mismo molde que ya vale
-- para las zonas de cobertura.

ALTER TABLE public.lugares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zona_lugares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asistente_lugares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_lugares ENABLE ROW LEVEL SECURITY;

CREATE POLICY lugares_los_lee_su_organizacion
  ON public.lugares
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

CREATE POLICY zona_lugares_los_lee_su_organizacion
  ON public.zona_lugares
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

CREATE POLICY asistente_lugares_los_lee_su_organizacion
  ON public.asistente_lugares
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

CREATE POLICY usuario_lugares_los_lee_su_organizacion
  ON public.usuario_lugares
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

-- El permiso de tabla no es la RLS, y en este esquema una tabla nueva nace con todo dado a `anon`
-- y a `authenticated`.
REVOKE ALL ON TABLE public.lugares FROM anon;
REVOKE ALL ON TABLE public.lugares FROM authenticated;
GRANT SELECT ON TABLE public.lugares TO authenticated;

REVOKE ALL ON TABLE public.zona_lugares FROM anon;
REVOKE ALL ON TABLE public.zona_lugares FROM authenticated;
GRANT SELECT ON TABLE public.zona_lugares TO authenticated;

REVOKE ALL ON TABLE public.asistente_lugares FROM anon;
REVOKE ALL ON TABLE public.asistente_lugares FROM authenticated;
GRANT SELECT ON TABLE public.asistente_lugares TO authenticated;

REVOKE ALL ON TABLE public.usuario_lugares FROM anon;
REVOKE ALL ON TABLE public.usuario_lugares FROM authenticated;
GRANT SELECT ON TABLE public.usuario_lugares TO authenticated;

NOTIFY pgrst, 'reload schema';

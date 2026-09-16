-- Cuánto pesa cada cosa al proponer candidatos lo decide la Prestadora.
-- =====================================================================
--
-- QUÉ FALTABA. Cuando hay una guardia sin Asistente, el sistema ordena a quiénes conviene llamar.
-- Ese orden salía de una lista de números escritos adentro del código (`panel/src/lib/candidatos.js`):
-- cuánto suma haber atendido antes a ese Paciente, cuánto resta vivir lejos, desde cuántas horas
-- semanales conviene avisar. Eran iguales para toda Prestadora y no había forma de cambiarlos.
--
-- Son reglas operativas, y una regla operativa la decide y la configura la Prestadora, nunca al
-- revés.
--
-- CÓMO SE ELIGE. Con una de tres formas armadas —que venga quien ya conoce al Paciente, que nadie
-- quede al límite, que el viaje sea corto— y, para quien quiera, el detalle abierto para correr
-- número por número. Las tres formas y los bordes de cada número están en
-- `panel/src/lib/perfilesDeCandidatos.js`, que se copia al motor.
--
-- QUÉ SE GUARDA ACÁ, Y QUÉ NO. Solamente el perfil elegido y lo que esa Prestadora haya corrido
-- respecto de él. Guardar los cuarenta números congelaría los valores de fábrica el día que
-- alguien abriera la pantalla y le diera a guardar sin tocar nada; así, cuando un valor de fábrica
-- cambie, todas las Prestadoras se mueven con él salvo en lo que cada una decidió.
--
-- LO QUE NO ENTRA. Los motivos que bloquean —ya tiene otra guardia, tiene una ausencia, le falta
-- la Matrícula, no trabaja en esa modalidad— no se configuran: ahí el número no decide nada, el
-- bloqueo ya está decidido. Y estirar el horario de alguien tampoco: eso es una decisión de la
-- Coordinadora ante un caso puntual, nunca una norma guardada.

CREATE TABLE IF NOT EXISTS public.configuracion_calculo_candidatos (
  prestadora_id uuid PRIMARY KEY REFERENCES public.prestadoras(id) ON DELETE CASCADE,

  -- Cuál de las tres formas armadas eligió. Los nombres son identificadores guardados: se nombran
  -- por lo que hacen y no se renombran, aunque cambie cómo se llaman en pantalla.
  perfil text NOT NULL DEFAULT 'continuidad',

  -- Lo que corrió a mano respecto de ese perfil. Vacío mientras no toque nada.
  pesos jsonb NOT NULL DEFAULT '{}'::jsonb,
  topes jsonb NOT NULL DEFAULT '{}'::jsonb,

  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT configuracion_calculo_candidatos_perfil_conocido
    CHECK (perfil IN ('continuidad', 'descanso', 'cercania')),

  -- Los bordes de cada número los comprueba el motor, que es el que conoce la lista. Acá se exige
  -- lo único que la base puede sostener sola: que sean objetos y no una lista ni un texto suelto.
  CONSTRAINT configuracion_calculo_candidatos_pesos_es_objeto
    CHECK (jsonb_typeof(pesos) = 'object'),
  CONSTRAINT configuracion_calculo_candidatos_topes_es_objeto
    CHECK (jsonb_typeof(topes) = 'object')
);

COMMENT ON TABLE public.configuracion_calculo_candidatos IS
  'Como ordena cada Prestadora la lista de quienes pueden cubrir un hueco: el perfil elegido y lo que corrio respecto de el. Los valores de fabrica y las tres formas armadas viven en panel/src/lib/perfilesDeCandidatos.js.';

COMMENT ON COLUMN public.configuracion_calculo_candidatos.perfil IS
  'Identificador permanente de la forma armada. Se nombra por su funcion y no se renombra.';

-- ---------------------------------------------------------------------------
-- Quién ve qué
-- ---------------------------------------------------------------------------
--
-- Escribe el motor con la llave de servicio, así que la política es de lectura y es la segunda
-- red. Lee quien arma la cobertura: la administración de la Prestadora, que es quien configura, y
-- la Coordinadora, que es quien mira la lista de candidatos y tiene que poder entender por qué
-- salió en ese orden.

ALTER TABLE public.configuracion_calculo_candidatos ENABLE ROW LEVEL SECURITY;

CREATE POLICY panel_lee_configuracion_calculo_candidatos
  ON public.configuracion_calculo_candidatos
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

-- El permiso de tabla no es la RLS, y en este esquema una tabla nueva nace con todo dado a `anon`
-- y a `authenticated`.
REVOKE ALL ON TABLE public.configuracion_calculo_candidatos FROM anon;
REVOKE ALL ON TABLE public.configuracion_calculo_candidatos FROM authenticated;
GRANT SELECT ON TABLE public.configuracion_calculo_candidatos TO authenticated;

NOTIFY pgrst, 'reload schema';

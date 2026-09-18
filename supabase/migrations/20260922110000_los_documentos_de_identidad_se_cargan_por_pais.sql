-- Los documentos de identidad se cargan por país.
-- ==============================================
--
-- QUÉ RESUELVE. El Legajo guarda con qué se identifica una Persona ante el Estado, y eso es una
-- pareja: qué documento y qué número. Qué documentos existen cambia por país y por clase de
-- Persona, así que la lista no puede estar escrita adentro de ninguna pantalla.
--
-- LO CARGADO ES DE ARGENTINA, y no se deduce ningún otro país por parecido. Cada país nuevo se
-- investiga y entra como renglón, nunca como código.
--
-- Y VAN LOS DOS VIEJOS. La libreta cívica y la libreta de enrolamiento dejaron de emitirse hace
-- décadas y siguen siendo el documento de gente muy mayor, que es justamente a quien cuida este
-- producto. Dejarlas afuera obligaría a cargar el documento de un Paciente de noventa años como si
-- fuera otra cosa.
--
-- POR QUÉ LA SIGLA SE GUARDA Y NO SE TRADUCE. «DNI» y «CUIT» son nombres propios de un documento
-- argentino: en inglés y en portugués se siguen llamando así. Traducirlos inventaría documentos que
-- no existen.
--
-- LA LISTA ES DE TODAS LAS PRESTADORAS. No lleva `prestadora_id` porque no es configuración de
-- ninguna: es qué documentos emite un Estado. Por eso la lee cualquiera con sesión y no la escribe
-- nadie desde el producto.
--
-- POR QUÉ EL LEGAJO NO TIENE UNA CLAVE FORÁNEA HACIA ACÁ. El Legajo no guarda país, y no debería:
-- una Persona puede identificarse con el pasaporte de otro país sin que eso cambie dónde vive. La
-- pantalla ofrece esta lista y no deja tipear, que es donde se evita el ente inventado.

BEGIN;

CREATE TABLE IF NOT EXISTS public.catalogo_documentos_de_identidad (
  -- El código de dos letras del país, el mismo que usa `prestadoras.pais`.
  pais text NOT NULL,

  -- A qué clase de Persona le corresponde este documento.
  clase text NOT NULL,

  -- Con qué se guarda en el Legajo. No cambia nunca.
  codigo text NOT NULL,

  -- Cómo se lee en pantalla, en cualquier idioma.
  sigla text NOT NULL,

  orden integer NOT NULL DEFAULT 100,
  activo boolean NOT NULL DEFAULT true,

  PRIMARY KEY (pais, clase, codigo),

  CONSTRAINT catalogo_documentos_clase_conocida
    CHECK (clase IN ('fisica', 'juridica'))
);

COMMENT ON TABLE public.catalogo_documentos_de_identidad IS
  'Que documentos de identidad emite cada pais, y a que clase de Persona le corresponde cada uno. No es configuracion de ninguna Prestadora: es lo que emite un Estado.';

INSERT INTO public.catalogo_documentos_de_identidad (pais, clase, codigo, sigla, orden) VALUES
  ('AR', 'fisica',   'dni',       'DNI',       10),
  ('AR', 'fisica',   'cuil',      'CUIL',      20),
  ('AR', 'fisica',   'cuit',      'CUIT',      30),
  ('AR', 'fisica',   'pasaporte', 'Pasaporte', 40),
  ('AR', 'fisica',   'lc',        'LC',        50),
  ('AR', 'fisica',   'le',        'LE',        60),
  ('AR', 'juridica', 'cuit',      'CUIT',      10)
ON CONFLICT (pais, clase, codigo) DO NOTHING;

ALTER TABLE public.catalogo_documentos_de_identidad ENABLE ROW LEVEL SECURITY;

-- Lo lee cualquiera con sesión: no dice nada de ninguna persona ni de ninguna Organización, y las
-- pantallas que cargan un Legajo lo necesitan. No lo escribe nadie desde el producto.
CREATE POLICY catalogo_documentos_lo_lee_quien_tiene_sesion
  ON public.catalogo_documentos_de_identidad
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.catalogo_documentos_de_identidad FROM anon;
REVOKE ALL ON TABLE public.catalogo_documentos_de_identidad FROM authenticated;
GRANT SELECT ON TABLE public.catalogo_documentos_de_identidad TO authenticated;

DO $comprobacion$
BEGIN
  IF (SELECT count(*) FROM public.catalogo_documentos_de_identidad WHERE pais = 'AR') <> 7 THEN
    RAISE EXCEPTION 'El catalogo de documentos de Argentina no quedo completo.';
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

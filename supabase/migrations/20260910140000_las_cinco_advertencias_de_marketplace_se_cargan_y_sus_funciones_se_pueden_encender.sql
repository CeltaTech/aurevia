-- ============================================================================
-- Las cinco advertencias de marketplace se cargan, y sus funciones se pueden encender
-- ============================================================================
--
-- QUÉ ESTABA MAL. `docs/legal/argentina.md` tiene, desde hace meses, la tabla de las cinco
-- funciones de riesgo alto de la modalidad marketplace con el texto exacto que hay que
-- mostrar al encender cada una. Ese texto nunca entró a `advertencias_legales`: la tabla
-- tenía solamente las siete filas de prestación directa. Y el motor ya sabía leer la
-- auditoría de esas cinco funciones (`panelMarketplace.js`, ruta `/auditoria-legal`), así
-- que la pantalla de auditoría legal existía, funcionaba y no podía mostrar nunca nada,
-- porque no había ni advertencia que mostrar ni función que encender.
--
-- QUÉ SE HACE ACÁ. Dos cosas, y las dos hacen falta para que la tercera —el aviso— exista:
--
--   1. Las cinco advertencias entran a `advertencias_legales` con jurisdicción `AR`, con el
--      texto copiado tal cual del documento legal. Ni una palabra reescrita: el aviso sale
--      del documento de ese país y no se improvisa (CLAUDE.md §7). Ninguna otra jurisdicción
--      recibe fila, y eso es a propósito: sin documento no hay aviso.
--
--   2. Aparece dónde se enciende cada una. Hasta hoy las cinco funciones no tenían ningún
--      lugar donde decir «esta Prestadora la usa», así que no había momento de activación al
--      que colgarle el aviso. El catálogo de las cinco es una tabla —los catálogos salen de
--      la base (CLAUDE.md §8)— y el encendido de cada Prestadora es otra.
--
-- LO QUE ESTO NO HACE, Y NO SE LE PUEDE PEDIR. No bloquea nada ni deja nada apagado por
-- argumento legal (CLAUDE.md §7). Las cinco nacen apagadas porque una función que nadie
-- encendió está apagada, no porque el sistema haya decidido por la Prestadora: encenderlas
-- es un clic, el aviso informa y quien decide es quien tiene la responsabilidad.
--
-- POR QUÉ EL TEXTO NO ESTÁ EN TRES IDIOMAS. `advertencias_legales` guarda un solo texto por
-- jurisdicción y función, y las siete filas que ya estaban cargadas siguen ese modelo. No es
-- una traducción pendiente: es el texto legal del país, y traducir un texto legal lo cambia.
-- Lo que sí está en los tres idiomas es todo lo que rodea al aviso —el título del modal, los
-- botones, el nombre de cada función—, que vive en las traducciones del Panel.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Las cinco advertencias de marketplace de Argentina
-- ----------------------------------------------------------------------------
--
-- Textos copiados de `docs/legal/argentina.md`, sección «Modalidad marketplace — riesgo
-- invertido». Las claves son las que el motor ya nombraba en `FUNCIONES_CLAVE_MARKETPLACE`.
--
-- `ON CONFLICT DO NOTHING` fila por fila, y no un «si ya hay algo de AR no toco nada»: la
-- jurisdicción AR ya tiene las siete filas de prestación directa, así que mirar la
-- jurisdicción entera dejaría estas cinco afuera para siempre. Y si mañana un abogado
-- corrige uno de estos textos en la base, esta migración no se lo pisa.

INSERT INTO public.advertencias_legales (jurisdiccion, funcion_clave, texto_advertencia) VALUES
  ('AR', 'ranking_plataforma',
   'Un ranking calculado por la plataforma que condiciona si el Asistente sigue visible para cualquier Familia puede interpretarse como la plataforma decidiendo su acceso al trabajo en general, un indicio de subordinación bajo el art. 23 de la LCT — mismo hecho que pesó en contra de Uber en el caso Aslam (Reino Unido, 2021).'),
  ('AR', 'consecuencia_automatica_calificacion',
   'Atar una exclusión automática a la calificación agregada convierte la opinión de las Familias en una decisión algorítmica de la plataforma sobre el Asistente, un indicio de subordinación bajo el art. 23 de la LCT.'),
  ('AR', 'precio_horario_fijado_plataforma',
   'Fijar precio u horario de forma centralizada, en vez de que cada Familia lo acuerde con su Asistente, es un indicio fuerte de subordinación bajo el art. 23 de la LCT.'),
  ('AR', 'exclusividad_marketplace',
   'Exigir exclusividad reduce la libertad real del Asistente de trabajar para otros, elemento central para sostener autonomía y no dependencia (art. 23 LCT).'),
  ('AR', 'mediacion_conflictos_marketplace',
   'Mediar activamente en conflictos entre Familia y Asistente puede interpretarse como dirección del vínculo, un indicio de subordinación bajo el art. 23 de la LCT.')
ON CONFLICT (jurisdiccion, funcion_clave) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 2. El catálogo de las cinco funciones de riesgo de marketplace
-- ----------------------------------------------------------------------------
--
-- Es un catálogo de la plataforma, no de una Prestadora: las cinco funciones existen igual
-- en todas, y por eso esta tabla no lleva columna de Organización — misma forma que
-- `advertencias_legales`, que tampoco la lleva. Lo que sí es de cada Prestadora es si las
-- tiene encendidas, y eso vive en la tabla de abajo.
--
-- La clave es la misma cadena que ya usan `advertencias_legales.funcion_clave` y
-- `auditoria_advertencias_legales.funcion_clave`. Es un nombre guardado y no se renombra.

CREATE TABLE IF NOT EXISTS public.catalogo_funciones_marketplace (
  clave       text PRIMARY KEY,
  orden       smallint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.catalogo_funciones_marketplace IS
  'Las funciones de la modalidad marketplace que tienen riesgo legal conocido. Es el catálogo de la plataforma: qué se puede encender. Si esa función tiene advertencia escrita para la jurisdicción de la Prestadora, encenderla la muestra y la deja auditada.';
COMMENT ON COLUMN public.catalogo_funciones_marketplace.clave IS
  'La misma cadena que nombra a esta función en advertencias_legales y en auditoria_advertencias_legales. Nombre guardado: no se renombra.';
COMMENT ON COLUMN public.catalogo_funciones_marketplace.orden IS
  'En qué orden se listan en pantalla. Es el orden del documento legal, para poder leerlas al lado del documento.';

INSERT INTO public.catalogo_funciones_marketplace (clave, orden) VALUES
  ('ranking_plataforma', 1),
  ('consecuencia_automatica_calificacion', 2),
  ('precio_horario_fijado_plataforma', 3),
  ('exclusividad_marketplace', 4),
  ('mediacion_conflictos_marketplace', 5)
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE public.catalogo_funciones_marketplace ENABLE ROW LEVEL SECURITY;

-- Lo lee cualquiera del Panel con sesión: es un catálogo de la plataforma, no un dato de
-- nadie. Escribirlo es de CeltaTech, igual que `advertencias_legales`.
DROP POLICY IF EXISTS panel_lee_catalogo_funciones_marketplace ON public.catalogo_funciones_marketplace;
CREATE POLICY panel_lee_catalogo_funciones_marketplace
  ON public.catalogo_funciones_marketplace
  FOR SELECT
  TO authenticated
  USING (
    interno.es_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador')
    )
  );

DROP POLICY IF EXISTS superadmin_gestiona_catalogo_funciones_marketplace ON public.catalogo_funciones_marketplace;
CREATE POLICY superadmin_gestiona_catalogo_funciones_marketplace
  ON public.catalogo_funciones_marketplace
  USING (interno.es_superadmin());

GRANT SELECT ON TABLE public.catalogo_funciones_marketplace TO authenticated;
GRANT ALL ON TABLE public.catalogo_funciones_marketplace TO service_role;


-- ----------------------------------------------------------------------------
-- 3. Qué funciones de marketplace tiene encendidas cada Prestadora
-- ----------------------------------------------------------------------------
--
-- Una fila por Prestadora y función. Sin fila, la función está apagada: una Prestadora
-- recién creada no necesita que nadie le siembre nada.
--
-- `advertida_en` / `advertida_por` guardan el último aviso que se mostró al encenderla. No
-- reemplazan a `auditoria_advertencias_legales` —ahí está el historial completo, con el
-- texto exacto que se mostró cada vez—: son el dato de estado, para que la pantalla pueda
-- decir «esta función se encendió sabiendo esto» sin recorrer la auditoría entera.

CREATE TABLE IF NOT EXISTS public.configuracion_funciones_marketplace (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id  uuid NOT NULL REFERENCES public.prestadoras (id) ON DELETE CASCADE,
  funcion_clave  text NOT NULL REFERENCES public.catalogo_funciones_marketplace (clave),
  activa         boolean NOT NULL DEFAULT false,
  advertida_en   timestamptz,
  advertida_por  uuid REFERENCES public.usuarios (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracion_funciones_marketplace_una_por_prestadora
    UNIQUE (prestadora_id, funcion_clave)
);

COMMENT ON TABLE public.configuracion_funciones_marketplace IS
  'Qué funciones de riesgo legal de marketplace tiene encendidas cada Prestadora. Sin fila, apagada. Nada acá bloquea nada: encender muestra el aviso de la jurisdicción, si lo hay, y lo deja auditado.';
COMMENT ON COLUMN public.configuracion_funciones_marketplace.advertida_en IS
  'Cuándo se mostró el último aviso legal al encender esta función. El historial completo, con el texto mostrado, está en auditoria_advertencias_legales.';

CREATE INDEX IF NOT EXISTS idx_configuracion_funciones_marketplace_prestadora
  ON public.configuracion_funciones_marketplace (prestadora_id);

ALTER TABLE public.configuracion_funciones_marketplace ENABLE ROW LEVEL SECURITY;

-- Encender o apagar una de estas funciones es una decisión de negocio de la Prestadora, con
-- consecuencia legal: la toma la administración, no el Coordinador. El Superadmin queda
-- encerrado en la Prestadora donde tenga abierta la sesión de soporte, como en todas las
-- demás tablas.
DROP POLICY IF EXISTS admin_prestadora_gestiona_funciones_marketplace ON public.configuracion_funciones_marketplace;
CREATE POLICY admin_prestadora_gestiona_funciones_marketplace
  ON public.configuracion_funciones_marketplace
  TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND (
      interno.es_superadmin()
      OR EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
      )
    )
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND (
      interno.es_superadmin()
      OR EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
      )
    )
  );

-- El Coordinador las ve y no las toca: es el mismo alcance que ya tiene sobre la auditoría
-- legal de marketplace, donde lee y no escribe.
DROP POLICY IF EXISTS coordinador_lee_funciones_marketplace ON public.configuracion_funciones_marketplace;
CREATE POLICY coordinador_lee_funciones_marketplace
  ON public.configuracion_funciones_marketplace
  FOR SELECT
  TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'coordinador'
    )
  );

GRANT SELECT, INSERT, UPDATE ON TABLE public.configuracion_funciones_marketplace TO authenticated;
GRANT ALL ON TABLE public.configuracion_funciones_marketplace TO service_role;

COMMIT;

-- Sin esto la capa que sirve los datos puede seguir contestando 404 en tablas que sí existen
-- (CLAUDE.md §9).
NOTIFY pgrst, 'reload schema';

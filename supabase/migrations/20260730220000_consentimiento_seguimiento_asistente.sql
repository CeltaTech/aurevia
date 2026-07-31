-- ============================================================================
-- Pendiente #102 (docs/PENDIENTES.md) — registro de consentimiento del Asistente.
--
-- QUÉ HACE
-- Crea las dos tablas que faltaban para poder pedirle a un Asistente su
-- consentimiento expreso antes de registrar su ubicación, y la única función
-- que decide si ese consentimiento está vigente.
--
-- POR QUÉ (esto es lo que no se puede reconstruir leyendo el esquema)
-- Decisión del Desarrollador del 2026-07-30: tiene que existir un
-- consentimiento expreso del Asistente para el seguimiento del trayecto,
-- tomado en el momento de su contratación. La Ley 25.326 exige que sea libre,
-- expreso, informado y por escrito, y la ubicación de una persona es dato
-- personal. Hasta hoy no existía ni una tabla ni una columna de consentimiento
-- en todo el proyecto — se comprobó el 2026-07-30 antes de escribir esto.
--
-- MISMO MOLDE QUE advertencias_legales
-- Catálogo curado por CeltaTech (solo superadmin escribe) + registro con
-- fotografía del texto exacto que se mostró. La fotografía no es capricho: si
-- el texto del catálogo cambia dentro de dos años, lo que esa persona leyó y
-- aceptó no puede cambiar con él.
--
-- LO QUE ESTE ARCHIVO NO TRAE
-- El texto legal de verdad. Los textos que se siembran acá son PROVISORIOS,
-- de relleno, escritos para poder construir y probar la pantalla. Van marcados
-- con es_borrador = TRUE, y la función consentimiento_seguimiento_vigente()
-- devuelve FALSE para cualquier consentimiento firmado sobre un borrador. O
-- sea: con estos textos la pantalla funciona entera, pero el seguimiento no se
-- enciende para nadie. El interruptor real es cargar el texto del abogado con
-- es_borrador = FALSE (tarea #42 antes que la #43).
--
-- CÓMO SE VUELVE ATRÁS
-- No borra ni modifica nada de lo que ya existe. Para revertir alcanza con
-- DROP de las dos tablas y de la función, en una migración nueva hacia
-- adelante (nunca editando esta).
-- ============================================================================


-- ============================================================================
-- 1. Catálogo de textos de consentimiento
--
--    Una fila por jurisdicción + tema + modalidad de vínculo + versión + idioma.
--
--    "modalidad" existe porque el problema legal no es el mismo en los dos
--    casos: a un Asistente en relación de dependencia se le cuestiona el
--    consentimiento tomado al contratarlo (quien está por ser contratado no
--    está en condiciones de negarse), y a uno autónomo de marketplace no del
--    mismo modo. Son dos textos distintos, no uno con un párrafo agregado.
--    Se corresponde con asistentes.tipo_vinculo: 'dependencia' → 'dependencia',
--    'monotributo' → 'autonomo'.
--
--    "version" nunca se pisa: cuando el texto cambia se inserta una versión
--    nueva y se le pone fecha de fin a la anterior. Así se puede mostrar,
--    dentro de dos años, exactamente el texto que firmó cada persona.
--
--    Mismo criterio que advertencias_legales: sin fila para una jurisdicción,
--    no hay texto, y sin texto no hay consentimiento posible ni seguimiento.
--    No se inventa uno por analogía con otro país (CLAUDE.md §3).
-- ============================================================================
CREATE TABLE IF NOT EXISTS textos_consentimiento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiccion TEXT NOT NULL,
  clave TEXT NOT NULL,
  modalidad TEXT NOT NULL,
  version INTEGER NOT NULL,
  idioma TEXT NOT NULL,
  titulo TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  -- Los puntos concretos que la ley pide que la persona sepa antes de decidir:
  -- qué se registra, cuándo empieza, cuándo se corta, quién lo ve, cuánto se
  -- guarda, cómo se retira. Van aparte del cuerpo para que la pantalla pueda
  -- mostrarlos como lista y no queden sepultados en un párrafo largo.
  puntos_clave TEXT[] NOT NULL DEFAULT '{}',
  -- Marca de texto de relleno. Ver la cabecera: con esto en TRUE la pantalla
  -- funciona pero el seguimiento no se habilita para nadie.
  es_borrador BOOLEAN NOT NULL DEFAULT FALSE,
  vigente_desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vigente_hasta TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT textos_consentimiento_modalidad_check
    CHECK (modalidad IN ('dependencia', 'autonomo')),
  CONSTRAINT textos_consentimiento_idioma_check
    CHECK (idioma IN ('es-AR', 'en', 'pt-BR')),
  CONSTRAINT textos_consentimiento_version_check CHECK (version > 0),
  UNIQUE (jurisdiccion, clave, modalidad, version, idioma)
);

CREATE INDEX IF NOT EXISTS idx_textos_consentimiento_busqueda
  ON textos_consentimiento (jurisdiccion, clave, modalidad, idioma)
  WHERE vigente_hasta IS NULL;

ALTER TABLE textos_consentimiento ENABLE ROW LEVEL SECURITY;

-- Lectura abierta a cualquier persona identificada: es el texto que la propia
-- persona tiene que poder leer antes de decidir, y también después. Negarle a
-- alguien el acceso al texto que firmó sería exactamente lo contrario de un
-- consentimiento informado. No hay dato sensible acá — es texto legal público.
CREATE POLICY "identificados_leen_textos_consentimiento" ON textos_consentimiento
  FOR SELECT TO authenticated USING (TRUE);

-- Escritura solo de CeltaTech. Ninguna Prestadora redacta su propio texto de
-- consentimiento: es contenido legal curado, igual que advertencias_legales.
CREATE POLICY "superadmin_gestiona_textos_consentimiento" ON textos_consentimiento
  FOR ALL USING (es_superadmin()) WITH CHECK (es_superadmin());

GRANT SELECT ON textos_consentimiento TO authenticated;
GRANT ALL ON textos_consentimiento TO service_role;


-- ============================================================================
-- 2. Lo que decidió cada Asistente
--
--    Se guarda la decisión, no solo el "sí". Un "no" registrado también es un
--    dato que hace falta: prueba que se le preguntó y que pudo negarse, que es
--    justamente lo que sostiene que el consentimiento fue libre.
--
--    texto_mostrado y version_mostrada son fotografía, no referencia viva
--    (mismo criterio que auditoria_advertencias_legales.texto_mostrado).
--
--    Retirarlo no borra la fila: se le pone fecha de retiro. Hace falta poder
--    demostrar que hubo consentimiento entre tal y tal fecha, y también que se
--    respetó el retiro.
-- ============================================================================
CREATE TABLE IF NOT EXISTS consentimientos_asistente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  asistente_id UUID NOT NULL REFERENCES asistentes(id),
  clave TEXT NOT NULL,
  texto_consentimiento_id UUID NOT NULL REFERENCES textos_consentimiento(id),
  version_mostrada INTEGER NOT NULL,
  idioma_mostrado TEXT NOT NULL,
  texto_mostrado TEXT NOT NULL,
  decision TEXT NOT NULL,
  decidido_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retirado_at TIMESTAMPTZ,
  motivo_retiro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consentimientos_asistente_decision_check
    CHECK (decision IN ('otorgado', 'rechazado')),
  -- Un rechazo no se puede "retirar": no había nada que retirar.
  CONSTRAINT consentimientos_asistente_retiro_coherente
    CHECK (retirado_at IS NULL OR decision = 'otorgado')
);

-- Una sola decisión viva por Asistente y por tema. Cambiar de opinión no pisa
-- la fila anterior: se le pone retirado_at y se inserta una nueva, así el
-- historial queda entero.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consentimientos_asistente_vivo
  ON consentimientos_asistente (asistente_id, clave)
  WHERE retirado_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_consentimientos_asistente_prestadora
  ON consentimientos_asistente (prestadora_id, clave);

ALTER TABLE consentimientos_asistente ENABLE ROW LEVEL SECURITY;

-- El Asistente ve lo suyo y nada más.
CREATE POLICY "asistente_lee_sus_consentimientos" ON consentimientos_asistente
  FOR SELECT USING (asistente_id = auth.uid());

-- El Panel de la Prestadora ve los de su propia Organización. No es dato
-- sensible del Paciente ni remuneración: es la constancia de que se pidió el
-- consentimiento, y el Coordinador la necesita para saber a quién puede
-- asignarle una guardia con seguimiento.
CREATE POLICY "panel_lee_consentimientos_de_su_prestadora" ON consentimientos_asistente
  FOR SELECT USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (
        SELECT 1 FROM usuarios u
        WHERE u.id = auth.uid()
          AND u.rol IN ('admin_prestadora', 'coordinador')
      )
    )
  );

-- Nadie escribe acá por RLS. La decisión entra siempre por el backend, que es
-- el único que puede sacar la fotografía del texto correcto de forma confiable
-- (si el frontend mandara el texto, mandaría el que él quiera). Por eso no hay
-- política de INSERT ni de UPDATE: solo service_role.
GRANT SELECT ON consentimientos_asistente TO authenticated;
GRANT ALL ON consentimientos_asistente TO service_role;


-- ============================================================================
-- 3. La única función que decide si el seguimiento se puede encender
--
--    Punto único de verdad (CLAUDE.md §7.12): toda política, ruta o proceso que
--    necesite saber si puede registrar la ubicación de un Asistente pregunta
--    acá y en ningún otro lado. Que la condición esté escrita una sola vez es
--    lo que evita que dentro de un año haya tres versiones distintas y una se
--    olvide del retiro.
--
--    Devuelve TRUE solo si las cuatro cosas se cumplen a la vez:
--      1. hay una decisión viva (nadie la retiró),
--      2. esa decisión fue 'otorgado',
--      3. la versión que firmó sigue siendo la vigente — si el texto cambió,
--         el consentimiento viejo no cubre el nuevo alcance y hay que volver a
--         preguntar,
--      4. el texto que firmó NO es un borrador de relleno.
-- ============================================================================
CREATE OR REPLACE FUNCTION consentimiento_seguimiento_vigente(
  p_asistente_id UUID,
  p_clave TEXT DEFAULT 'seguimiento_ubicacion'
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM consentimientos_asistente c
    JOIN textos_consentimiento tx ON tx.id = c.texto_consentimiento_id
    WHERE c.asistente_id = p_asistente_id
      AND c.clave = p_clave
      AND c.retirado_at IS NULL
      AND c.decision = 'otorgado'
      AND tx.es_borrador = FALSE
      AND tx.vigente_hasta IS NULL
  );
$$;

COMMENT ON FUNCTION consentimiento_seguimiento_vigente(UUID, TEXT) IS
  'Pendiente #102. Única fuente de verdad para saber si se puede registrar la ubicación de un Asistente. Devuelve FALSE si no consintió, si lo retiró, si el texto que firmó quedó desactualizado, o si firmó sobre un texto de relleno.';

GRANT EXECUTE ON FUNCTION consentimiento_seguimiento_vigente(UUID, TEXT) TO authenticated, service_role;


-- ============================================================================
-- 4. Textos PROVISORIOS de relleno — NO SON VÁLIDOS LEGALMENTE
--
--    Están para poder construir y probar la pantalla mientras se consigue la
--    redacción profesional (tarea #42). Van con es_borrador = TRUE, así que
--    ningún consentimiento firmado sobre ellos habilita nada.
--
--    Se siembra únicamente 'AR' porque es la única jurisdicción con documento
--    legal en docs/legal/, mismo criterio que el seed de advertencias_legales:
--    sin fila, no hay texto, y sin texto no hay seguimiento posible.
--
--    Cuando llegue el texto del abogado: se inserta como version 2 con
--    es_borrador = FALSE y se le pone vigente_hasta = NOW() a la versión 1.
--    No se edita esta migración (MIGRACIONES.md §4.1).
-- ============================================================================
INSERT INTO textos_consentimiento
  (jurisdiccion, clave, modalidad, version, idioma, titulo, cuerpo, puntos_clave, es_borrador)
VALUES
-- --- Relación de dependencia -------------------------------------------------
('AR', 'seguimiento_ubicacion', 'dependencia', 1, 'es-AR',
 'TEXTO PROVISORIO — Registro de tu ubicación cuando vas a una guardia',
 E'ESTE TEXTO ES DE RELLENO Y NO TIENE VALIDEZ LEGAL. Está acá para poder construir y probar la pantalla mientras se consigue la redacción profesional.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Esta sección va a explicar, en palabras simples, qué se registra de tu recorrido cuando salís hacia una guardia y para qué se usa ese dato.\n\nSed do eiusmod tempor incididunt ut labore. Acá va a ir la finalidad concreta: saber con tiempo si una guardia se va a poder cubrir, y nada más que eso.\n\nUt enim ad minim veniam, quis nostrud exercitation. Acá va a ir qué NO se hace con el dato: no se comparte con la Familia, no se usa fuera del horario del trayecto, no se guarda para siempre.\n\nDuis aute irure dolor in reprehenderit in voluptate velit esse. Acá va a ir cómo retirás este consentimiento y qué pasa si lo retirás.',
 ARRAY[
   'PROVISORIO — Qué se registra: solo tu recorrido hacia la guardia.',
   'PROVISORIO — Cuándo empieza: cuando avisás que salís. Cuándo termina: cuando llegás.',
   'PROVISORIO — Quién lo ve: tu Prestadora. La Familia ve solo la hora estimada de llegada, nunca dónde estás.',
   'PROVISORIO — Cuánto se guarda: [pendiente de definir con el abogado].',
   'PROVISORIO — Podés retirarlo cuando quieras, desde Mi Perfil.'
 ],
 TRUE),

('AR', 'seguimiento_ubicacion', 'dependencia', 1, 'en',
 'DRAFT TEXT — Recording your location on your way to a shift',
 E'THIS IS PLACEHOLDER TEXT AND HAS NO LEGAL VALIDITY. It exists so the screen can be built and tested while the professional wording is obtained.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.',
 ARRAY['DRAFT — Placeholder point, pending legal wording.'],
 TRUE),

('AR', 'seguimiento_ubicacion', 'dependencia', 1, 'pt-BR',
 'TEXTO PROVISÓRIO — Registro da sua localização a caminho do plantão',
 E'ESTE TEXTO É DE PREENCHIMENTO E NÃO TEM VALIDADE LEGAL. Está aqui para permitir construir e testar a tela enquanto se obtém a redação profissional.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.',
 ARRAY['PROVISÓRIO — Ponto de preenchimento, aguardando redação legal.'],
 TRUE),

-- --- Autónomo / marketplace --------------------------------------------------
('AR', 'seguimiento_ubicacion', 'autonomo', 1, 'es-AR',
 'TEXTO PROVISORIO — Registro de tu ubicación cuando vas a una guardia',
 E'ESTE TEXTO ES DE RELLENO Y NO TIENE VALIDEZ LEGAL. Está acá para poder construir y probar la pantalla mientras se consigue la redacción profesional.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Esta versión es la de quien trabaja de forma autónoma y acepta guardias por su cuenta.\n\nSed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Acá va a ir la diferencia con la versión de relación de dependencia: aceptás este seguimiento como parte de un servicio que ofrecés, no como condición de un empleo.',
 ARRAY[
   'PROVISORIO — Qué se registra: solo tu recorrido hacia la guardia que aceptaste.',
   'PROVISORIO — Quién lo ve: la Prestadora que publicó la guardia.',
   'PROVISORIO — Cuánto se guarda: [pendiente de definir con el abogado].',
   'PROVISORIO — Podés retirarlo cuando quieras, desde Mi Perfil.'
 ],
 TRUE),

('AR', 'seguimiento_ubicacion', 'autonomo', 1, 'en',
 'DRAFT TEXT — Recording your location on your way to a shift',
 E'THIS IS PLACEHOLDER TEXT AND HAS NO LEGAL VALIDITY.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.',
 ARRAY['DRAFT — Placeholder point, pending legal wording.'],
 TRUE),

('AR', 'seguimiento_ubicacion', 'autonomo', 1, 'pt-BR',
 'TEXTO PROVISÓRIO — Registro da sua localização a caminho do plantão',
 E'ESTE TEXTO É DE PREENCHIMENTO E NÃO TEM VALIDADE LEGAL.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.',
 ARRAY['PROVISÓRIO — Ponto de preenchimento, aguardando redação legal.'],
 TRUE)
ON CONFLICT (jurisdiccion, clave, modalidad, version, idioma) DO NOTHING;


NOTIFY pgrst, 'reload schema';

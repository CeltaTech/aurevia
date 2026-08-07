-- ============================================================================
-- El aviso de "se viene una guardia y todavía no tiene a nadie"
-- (pendiente #106, docs/PENDIENTES.md).
--
-- QUÉ HACE
-- Le da a cada Prestadora dos números propios —cuántas horas antes quiere
-- enterarse de un hueco, y cada cuánto quiere que se lo repitan— y le agrega a
-- la guardia el rastro de cuándo se avisó por última vez y cuántas veces.
--
-- POR QUÉ (esto es lo que no se puede reconstruir leyendo el esquema)
-- El hueco de cobertura es el problema más caro que tiene una Prestadora y era
-- justo el único que el sistema no avisaba. El motivo era sencillo y está a la
-- vista en backend/src/utils/revisarRecordatoriosPush.js: las tres consultas
-- que buscan guardias para avisar filtran `.not('asistente_id', 'is', null)`,
-- porque todas le avisan al Asistente que la tiene asignada. Si no hay nadie
-- asignado, no hay a quién avisarle y el proceso pasa de largo. El aviso que
-- falta no es para el Asistente: es para el Coordinador, que es quien puede
-- tapar el hueco.
--
-- POR QUÉ LOS NÚMEROS VIVEN ACÁ Y NO EN EL CÓDIGO
-- Regla 1 de CLAUDE.md §7: ninguna regla operativa se escribe en el código. Y
-- acá no es formalismo — el plazo razonable depende del negocio de cada
-- Prestadora. Una que trabaja con guardias fijas de lunes a viernes quiere
-- enterarse con tres días de anticipación; una que cubre urgencias de un día
-- para el otro se llenaría de avisos inútiles con ese mismo número y necesita
-- seis horas. Es la misma diferencia que ya reconoce
-- configuracion_aviso_cese_asistente.horas_plazo_aviso_verbal, y esta tabla
-- copia esa forma a propósito.
--
-- SIN FILA NO HAY AVISO
-- El proceso lee esta tabla y recorre solo lo que encuentra: una Prestadora sin
-- fila no recibe ningún aviso. Es deliberado — la alternativa sería que el
-- código tuviera un número "por si acaso", que es exactamente lo que la regla 1
-- prohíbe. Por eso la sección 4 siembra la fila de todas las Prestadoras que
-- existen hoy. Una Prestadora que se dé de alta después necesita la suya; es la
-- misma carencia que ya tienen configuracion_notificaciones y
-- configuracion_aviso_cese_asistente, y queda anotada como pendiente aparte.
--
-- LO QUE ESTE ARCHIVO NO TRAE
-- Ninguna pantalla nueva del Panel para ver los huecos: esa ya existe desde la
-- Etapa 4 (el contador "sin cubrir" del Estado actual). Acá solo se agrega que
-- alguien te golpee la puerta cuando no estás mirando esa pantalla.
--
-- CÓMO SE VUELVE ATRÁS
-- No toca ningún dato existente. Para revertir: borrar la tabla nueva, las dos
-- columnas nuevas y la fila de evento, en una migración nueva hacia adelante —
-- nunca editando esta (MIGRACIONES.md §4).
-- ============================================================================


-- ============================================================================
-- 1. Los dos números de cada Prestadora
--
--    `horas_antes` es la X del pendiente: con cuánta anticipación quiere
--    enterarse de que una guardia sigue sin nadie.
--
--    `horas_entre_avisos` es lo que evita que el aviso se convierta en ruido.
--    Sin este número, el proceso —que corre cada cinco minutos— mandaría el
--    mismo correo doce veces por hora hasta que alguien tape el hueco, y a la
--    tercera vez el Coordinador arma un filtro en su casilla y no lo lee nunca
--    más. Es el mismo criterio de insistencia que ya usa
--    configuracion_escalada_coordinador.umbrales_premura.
--
--    Los valores por omisión no son "el número del sistema": son el punto de
--    partida que cada Prestadora cambia desde el Panel. 48 horas es dos días de
--    anticipación, y 12 horas de insistencia significa dos recordatorios por
--    día mientras el hueco siga abierto.
--
--    El tope de 720 horas (30 días) no es un capricho: sin tope, un cero mal
--    tipeado o un número absurdo convierte el aviso en spam masivo o lo apaga
--    en silencio. La baranda vive en la base y no en el formulario, porque el
--    formulario no es el único que escribe acá.
-- ============================================================================
CREATE TABLE IF NOT EXISTS configuracion_aviso_guardia_sin_cubrir (
  prestadora_id      UUID PRIMARY KEY REFERENCES prestadoras(id) ON DELETE CASCADE,
  activo             BOOLEAN  NOT NULL DEFAULT true,
  horas_antes        SMALLINT NOT NULL DEFAULT 48,
  horas_entre_avisos SMALLINT NOT NULL DEFAULT 12,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT configuracion_aviso_guardia_sin_cubrir_horas_antes_check
    CHECK (horas_antes > 0 AND horas_antes <= 720),
  CONSTRAINT configuracion_aviso_guardia_sin_cubrir_horas_entre_avisos_check
    CHECK (horas_entre_avisos > 0 AND horas_entre_avisos <= 720)
);

COMMENT ON TABLE configuracion_aviso_guardia_sin_cubrir IS
  'Cuándo avisarle al Coordinador que una guardia próxima sigue sin Asistente. Una fila por Prestadora; sin fila no se manda ningún aviso.';
COMMENT ON COLUMN configuracion_aviso_guardia_sin_cubrir.horas_antes IS
  'Con cuánta anticipación avisar. El aviso arranca cuando faltan estas horas para que empiece la guardia.';
COMMENT ON COLUMN configuracion_aviso_guardia_sin_cubrir.horas_entre_avisos IS
  'Cada cuánto repetir el aviso mientras el hueco siga abierto. Evita que el proceso, que corre cada 5 minutos, mande el mismo correo doce veces por hora.';


-- ============================================================================
-- 2. Quién puede ver y cambiar esos números
--
--    Mismas dos políticas que configuracion_notificaciones, y por el mismo
--    motivo: quien administra la Prestadora los cambia, el Coordinador los lee
--    para entender por qué le llegó (o no le llegó) un aviso, y nadie ve los de
--    otra Prestadora. La comparación contra current_tenant() es la misma
--    función de siempre, no una regla nueva escrita al lado (§7.12).
--
--    Al Superadmin también se le exige current_tenant(), no se lo deja pasar
--    por ser Superadmin: fuera de una sesión de soporte solo alcanza Sandbox
--    (CLAUDE.md §5), y esa precedencia la resuelve current_tenant().
-- ============================================================================
ALTER TABLE configuracion_aviso_guardia_sin_cubrir ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_gestiona_configuracion_aviso_guardia_sin_cubrir"
  ON configuracion_aviso_guardia_sin_cubrir
  USING (
    prestadora_id = current_tenant()
    AND (
      es_superadmin()
      OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  )
  WITH CHECK (
    prestadora_id = current_tenant()
    AND (
      es_superadmin()
      OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_lee_configuracion_aviso_guardia_sin_cubrir"
  ON configuracion_aviso_guardia_sin_cubrir
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON configuracion_aviso_guardia_sin_cubrir TO authenticated;
GRANT ALL ON configuracion_aviso_guardia_sin_cubrir TO service_role;


-- ============================================================================
-- 3. El rastro en la guardia: cuándo se avisó y cuántas veces
--
--    Mismo patrón que las columnas push_*_enviado_at que ya tiene la tabla: el
--    proceso no lleva memoria propia, la memoria está escrita al lado del dato.
--    Si el motor se reinicia entre dos corridas, no se pierde nada.
--
--    Va la última fecha y no un simple "sí/no" porque el aviso se repite: para
--    saber si toca repetirlo hace falta saber cuándo fue el anterior. Es la
--    misma pareja de columnas que alertas_tempranas_guardia
--    (ultima_notificacion_at + veces_notificado).
--
--    No se limpian cuando alguien cubre la guardia, y no hace falta: si más
--    tarde el Asistente se cae y la guardia vuelve a quedar sin cubrir, la
--    cuenta de "cuándo fue el último aviso" ya quedó vieja, así que el próximo
--    sale enseguida. El caso raro se arregla solo.
-- ============================================================================
ALTER TABLE guardias ADD COLUMN IF NOT EXISTS aviso_sin_cubrir_at    TIMESTAMPTZ;
ALTER TABLE guardias ADD COLUMN IF NOT EXISTS aviso_sin_cubrir_veces SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN guardias.aviso_sin_cubrir_at IS
  'Última vez que se le avisó al Coordinador que esta guardia sigue sin cubrir. NULL = nunca se avisó.';
COMMENT ON COLUMN guardias.aviso_sin_cubrir_veces IS
  'Cuántas veces se avisó. Sirve para que el aviso repetido diga que ya es la tercera vez, no para decidir si mandarlo.';

-- No hace falta ningún índice nuevo: la consulta del proceso busca por
-- prestadora y por fecha entre las guardias sin cubrir, que es exactamente lo
-- que ya indexa idx_guardias_sin_cubrir (migración 20260731170000, sección 4).


-- ============================================================================
-- 4. Las filas iniciales
--
--    4.a Los dos números, para cada Prestadora que existe hoy. Sin esto el
--        aviso quedaría construido y apagado, que es la peor de las dos cosas:
--        parece que anda y no manda nada.
-- ============================================================================
INSERT INTO configuracion_aviso_guardia_sin_cubrir (prestadora_id)
SELECT id FROM prestadoras
ON CONFLICT (prestadora_id) DO NOTHING;

-- ============================================================================
--    4.b A quién le llega y por dónde. Eso no se inventa acá: ya vive en
--        configuracion_notificaciones, que es la tabla donde cada Prestadora
--        carga los correos de cada evento y decide si además va por WhatsApp.
--        El aviso nuevo se suma como un evento más de esa lista en vez de
--        estrenar su propio mecanismo de destinatarios (§7.12). Si la
--        Prestadora no carga ningún correo, cae en su correo de contacto —
--        destinatariosEvento() en backend/src/utils/email.js ya lo resuelve.
-- ============================================================================
INSERT INTO configuracion_notificaciones (evento, prestadora_id, descripcion, emails)
SELECT 'guardia_sin_cubrir', id,
       'Una guardia próxima sigue sin Asistente asignado',
       '{}'
FROM prestadoras
ON CONFLICT (evento, prestadora_id) DO NOTHING;


NOTIFY pgrst, 'reload schema';

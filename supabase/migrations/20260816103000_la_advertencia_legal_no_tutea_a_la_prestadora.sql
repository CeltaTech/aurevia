-- Pendiente #144 — el texto visible no tutea a quien lo lee (CLAUDE.md §7 regla 1).
--
-- La advertencia legal de "penalizar inasistencias" le hablaba de vos a quien está por
-- activar la función: "Evaluá si esta función es coherente…". Quien lee eso es la persona
-- que dirige una Prestadora, en el momento exacto en que el producto le está avisando de
-- un riesgo laboral serio — es el peor lugar posible para sonar informal.
--
-- El archivo de siembra (backend/src/db/schema_advertencias_legales_01.sql) ya quedó
-- corregido, pero ese archivo solo se ejecuta cuando la base se arma de cero y además
-- termina en ON CONFLICT … DO NOTHING: sobre una base que ya tiene la fila cargada no
-- cambia nada. Por eso hace falta este UPDATE.
--
-- Las otras seis advertencias de Argentina ya estaban escritas en forma impersonal y no
-- se tocan. Se filtra por jurisdicción y función clave para no rozarlas.

UPDATE advertencias_legales
SET texto_advertencia = 'Penalizar inasistencias o inconductas de un Asistente autónomo puede interpretarse como ejercicio de poder disciplinario, un indicio de subordinación bajo el art. 23 de la LCT. Conviene evaluar si esta función es coherente con la modalidad de vínculo de los Asistentes.',
    updated_at = NOW()
WHERE jurisdiccion = 'AR'
  AND funcion_clave = 'penalizacion_inasistencias';

-- La auditoría (auditoria_advertencias_legales) guarda una copia del texto exacto que se
-- le mostró a cada persona en su momento. Esa copia NO se toca: es registro histórico de
-- qué leyó quien activó la función, y reescribirla sería falsear el registro.

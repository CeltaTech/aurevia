-- Pendiente #146 — las siete advertencias legales de Argentina pasan a la cadena de migraciones.
--
-- Hasta hoy el texto de estas advertencias vivía únicamente en un archivo de la carpeta
-- backend/src/db/, que nunca se ejecuta. La tabla sí estaba en la cadena, pero vacía: una base
-- armada desde cero quedaba sin una sola advertencia, y CLAUDE.md §3 dice que sin fila no se
-- muestra advertencia. Es decir, una Prestadora argentina podía activar una función de riesgo
-- laboral sin ver el aviso. Esta migración cierra ese agujero: el contenido queda donde se
-- ejecuta de verdad.
--
-- El texto es el ya corregido: la primera advertencia dice "Conviene evaluar…" y no "Evaluá…"
-- (CLAUDE.md §7 regla 1, migración 20260816103000). Va con ON CONFLICT DO NOTHING, así que
-- sobre una base que ya tenga las filas cargadas no cambia absolutamente nada.
--
-- Argentina es hoy la única jurisdicción con documento legal completo (docs/legal/argentina.md).
-- Los demás países no tienen fila a propósito: sin documento legal no hay advertencia que dar.

INSERT INTO advertencias_legales (jurisdiccion, funcion_clave, texto_advertencia) VALUES
('AR', 'penalizacion_inasistencias', 'Penalizar inasistencias o inconductas de un Asistente autónomo puede interpretarse como ejercicio de poder disciplinario, un indicio de subordinación bajo el art. 23 de la LCT. Conviene evaluar si esta función es coherente con la modalidad de vínculo de los Asistentes.'),
('AR', 'rankings', 'Publicar rankings que condicionan el acceso futuro a Guardias puede interpretarse como una forma de control jerárquico propia de una relación de dependencia (art. 23 LCT).'),
('AR', 'puntuacion_aceptacion_guardia', 'Puntuar la aceptación de Guardias y usarlo para asignar futuras oportunidades puede funcionar como una exigencia de disponibilidad, un indicio de subordinación (art. 23 LCT) más que de autonomía real del Asistente.'),
('AR', 'puntuacion_calificacion_familia', 'Condicionar oportunidades futuras a una calificación de terceros puede interpretarse como una forma de evaluación de desempeño propia de una relación laboral (art. 23 LCT).'),
('AR', 'limite_oportunidades_rechazos', 'Limitar a un Asistente autónomo por rechazar Guardias reduce su libertad real de decidir su participación, un elemento central para sostener que la relación es autónoma y no dependiente (art. 23 LCT).'),
('AR', 'niveles_categorias', 'Establecer niveles o categorías jerárquicas puede interpretarse como una estructura organizativa propia de relación de dependencia (art. 23 LCT).'),
('AR', 'horarios_fijos', 'Imponer horarios fijos (en vez de que el Asistente decida su disponibilidad) es uno de los indicios más fuertes de subordinación bajo el art. 23 de la LCT.')
ON CONFLICT (jurisdiccion, funcion_clave) DO NOTHING;

NOTIFY pgrst, 'reload schema';

INSERT INTO advertencias_legales (jurisdiccion, funcion_clave, texto_advertencia) VALUES
('AR', 'ranking_plataforma', 'Un ranking calculado por la plataforma que condiciona si el Asistente sigue visible para cualquier Familia puede interpretarse como la plataforma decidiendo su acceso al trabajo en general, un indicio de subordinación bajo el art. 23 de la LCT — mismo hecho que pesó en contra de Uber en el caso Aslam (Reino Unido, 2021).'),
('AR', 'consecuencia_automatica_calificacion', 'Atar una exclusión automática a la calificación agregada convierte la opinión de las Familias en una decisión algorítmica de la plataforma sobre el Asistente, un indicio de subordinación bajo el art. 23 de la LCT.'),
('AR', 'precio_horario_fijado_plataforma', 'Fijar precio u horario de forma centralizada, en vez de que cada Familia lo acuerde con su Asistente, es un indicio fuerte de subordinación bajo el art. 23 de la LCT.'),
('AR', 'exclusividad_marketplace', 'Exigir exclusividad reduce la libertad real del Asistente de trabajar para otros, elemento central para sostener autonomía y no dependencia (art. 23 LCT).'),
('AR', 'mediacion_conflictos_marketplace', 'Mediar activamente en conflictos entre Familia y Asistente puede interpretarse como dirección del vínculo, un indicio de subordinación bajo el art. 23 de la LCT.')
ON CONFLICT (jurisdiccion, funcion_clave) DO NOTHING;

NOTIFY pgrst, 'reload schema';
;

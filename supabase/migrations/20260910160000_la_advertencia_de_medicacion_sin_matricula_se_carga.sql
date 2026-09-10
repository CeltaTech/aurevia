-- LA SEXTA ADVERTENCIA ARGENTINA: MEDICACIÓN POR UNA VÍA QUE EXIGE HABILITACIÓN
--
-- QUÉ PASABA. El documento legal argentino tiene escrito, desde hace tiempo, el aviso que
-- corresponde mostrar cuando se acepta una indicación de medicación cuya vía de administración
-- exige una habilitación profesional y ningún Asistente asignado al Paciente la tiene vigente
-- (`docs/legal/argentina.md:96-98`). El texto está redactado, el Panel ya lo pide antes de
-- confirmar (`panel/src/pages/Medicacion.jsx:59`) y el motor ya deja registrado que se avisó
-- (`backend/src/routes/panelMedicacion.js:101`). Lo único que faltaba era la fila.
--
-- Y sin la fila el aviso no aparece nunca. `verificarAntesDeActivar` está escrita para dejar
-- pasar cuando el país no tiene texto —sin documento no hay aviso, y su ausencia jamás traba
-- una función (CLAUDE.md §7)—, así que una advertencia escrita y no cargada se comporta
-- exactamente igual que una que nadie escribió: la pantalla confirma en silencio. El camino
-- entero estaba construido y no podía funcionar.
--
-- QUÉ SE HACE ACÁ. Entra la fila que falta, con el texto copiado palabra por palabra del
-- documento legal argentino. Ni una palabra reescrita: el aviso sale del documento de ese
-- país y no se improvisa. Ninguna otra jurisdicción recibe fila, y eso es a propósito.
--
-- POR QUÉ VA EN UNA MIGRACIÓN NUEVA Y NO ADENTRO DE LA ANTERIOR. La migración de las cinco
-- advertencias de marketplace ya corrió contra la base, y una migración aplicada no se edita
-- jamás: se corrige con otra adelante (CLAUDE.md §9).
--
-- POR QUÉ NO ESTÁ EN TRES IDIOMAS. `advertencias_legales` guarda un solo texto por
-- jurisdicción y función, igual que las otras doce filas. No es una traducción pendiente: es
-- el texto legal de un país, y traducir un texto legal lo cambia. Lo que sí está en los tres
-- idiomas es todo lo que rodea al aviso, que vive en las traducciones del Panel.

BEGIN;

INSERT INTO public.advertencias_legales (jurisdiccion, funcion_clave, texto_advertencia) VALUES
  ('AR', 'medicacion_via_sin_matricula',
   'Ningún Asistente actualmente asignado a este Paciente cuenta con la habilitación profesional requerida para esta vía de administración (ej. aplicación de inyectables exige enfermero/a matriculado/a). Aceptar esta indicación sin asignar un Asistente habilitado puede generar responsabilidad por mala praxis ante un incidente.')
ON CONFLICT (jurisdiccion, funcion_clave) DO NOTHING;

COMMIT;

-- Sin esto la capa que sirve los datos puede seguir contestando 404 en tablas que sí existen
-- (CLAUDE.md §9).
NOTIFY pgrst, 'reload schema';

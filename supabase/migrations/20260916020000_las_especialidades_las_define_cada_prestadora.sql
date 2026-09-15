-- ---------------------------------------------------------------------------------------
-- Las especialidades las define cada Prestadora
--
-- POR QUÉ. La lista de especialidades del formulario de postulación estaba escrita en el
-- archivo de traducciones del Panel: dos etiquetas —enfermería y kinesiología—, iguales para
-- todas las Prestadoras y en tres idiomas. Una lista de opciones no se escribe adentro de una
-- pantalla, y menos ésta: qué especialidades busca cada Prestadora es de ella, cambia entre una
-- y otra, y crece sin que nadie despliegue nada.
--
-- DÓNDE VAN. En `opciones_postulacion`, con las otras ocho listas del mismo formulario. No hay
-- tabla nueva a propósito: una especialidad es exactamente lo que esa tabla guarda —una opción
-- que se elige, con su nombre y su orden— y separarla repetiría por novena vez la misma
-- estructura, con su propia protección por fila y su propia pantalla de carga.
--
-- QUÉ PASA CON LO YA GUARDADO. `postulaciones.especialidades` sigue guardando los códigos que
-- eligió quien se postuló, y no se toca: lo que ya quedó escrito no se reescribe. Un código sin
-- opción cargada se sigue mostrando tal cual, que es lo que la pantalla hace desde siempre con
-- cualquier código que no reconoce.
--
-- NACE VACÍA, COMO EL RESTO. El sistema no inventa las especialidades de nadie. Mientras la
-- Prestadora no cargue ninguna, su formulario no tiene especialidades que ofrecer, igual que
-- hoy no tiene géneros ni nacionalidades.
-- ---------------------------------------------------------------------------------------

-- La restricción se reemplaza entera porque una restricción no se edita: se borra y se escribe
-- la que vale ahora, con los ocho grupos de antes más el nuevo.
ALTER TABLE public.opciones_postulacion
  DROP CONSTRAINT IF EXISTS opciones_postulacion_grupo_conocido;

ALTER TABLE public.opciones_postulacion
  ADD CONSTRAINT opciones_postulacion_grupo_conocido CHECK (grupo IN (
    'genero',
    'nacionalidad',
    'tipo_registro_afip',
    'especialidad',
    'experiencia_clinica_discapacidades',
    'experiencia_clinica_patologias',
    'experiencia_clinica_cuidado_directo',
    'experiencia_clinica_acompanamiento',
    'experiencia_clinica_tareas_domesticas'
  ));

COMMENT ON COLUMN public.postulaciones.especialidades IS
  'Claves de opciones_postulacion del grupo especialidad, separadas por coma. Nunca la etiqueta traducida: una postulación en cualquier idioma guarda siempre el mismo valor.';

NOTIFY pgrst, 'reload schema';

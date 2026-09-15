-- Cada aviso dice con qué plantilla sale por WhatsApp.
-- ====================================================
--
-- QUÉ RESUELVE. Un mensaje que la Prestadora empieza —y un aviso al Coordinador siempre lo
-- empieza la Prestadora— Meta no lo entrega como texto suelto: exige una plantilla aprobada de
-- antemano. Hasta acá el motor armaba siempre texto suelto, así que la casilla de WhatsApp de la
-- pantalla de Avisos prometía un canal que en producción rebota. Falta el dato de qué plantilla
-- usa cada aviso, y ese dato es de cada Prestadora: las plantillas las escribe y las hace aprobar
-- ella.
--
-- POR QUÉ ACÁ Y NO EN LA PLANTILLA. La misma plantilla puede servir para más de un aviso, y un
-- aviso sin plantilla elegida tiene que poder existir. La elección es del aviso, y los avisos ya
-- viven en esta tabla, con su casilla de WhatsApp al lado.
--
-- QUÉ PASA SI SE BORRA LA PLANTILLA. La columna queda en nulo y el aviso sale por correo. Borrar
-- una plantilla no puede borrar la configuración del aviso ni dejarla apuntando a una fila que ya
-- no está.
--
-- NO LLEVA POLÍTICA NUEVA. Es una columna más de configuracion_notificaciones, que ya tiene RLS y
-- sus políticas: quien alcanza la fila alcanza la columna.

ALTER TABLE configuracion_notificaciones
  ADD COLUMN IF NOT EXISTS plantilla_whatsapp_id uuid
    REFERENCES plantillas_whatsapp(id) ON DELETE SET NULL;

COMMENT ON COLUMN configuracion_notificaciones.plantilla_whatsapp_id IS
  'Con qué plantilla aprobada sale este aviso por WhatsApp. Nulo mientras la Prestadora no eligió '
  'ninguna, y entonces el aviso sale por correo.';

NOTIFY pgrst, 'reload schema';

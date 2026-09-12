-- El aviso previo al primer cobro queda anotado.
-- ==============================================
--
-- QUÉ RESUELVE. El §3.2 del docs/PRD_07_Modalidad_Marketplace.md exige un aviso antes de cualquier
-- cobro por vencimiento del período gratuito: nunca un cobro silencioso. Un aviso que se manda y
-- no se anota se vuelve a mandar todos los días hasta que llega la fecha, y una persona a la que
-- se le avisa cinco veces deja de leer el sexto.
--
-- POR QUÉ UNA FECHA Y NO UN CASILLERO. Además de no repetirlo, hace falta poder contestar cuándo
-- se avisó: si alguien reclama un cobro que no esperaba, la respuesta es una fecha, no un «sí».
--
-- NO LLEVA POLÍTICA NUEVA. Es una columna más de accesos_marketplace, que ya tiene RLS y sus
-- políticas: quien alcanza la fila alcanza la columna.

ALTER TABLE accesos_marketplace
  ADD COLUMN IF NOT EXISTS aviso_previo_en timestamptz;

COMMENT ON COLUMN accesos_marketplace.aviso_previo_en IS
  'Cuándo se le avisó a la Familia que el período gratuito estaba por terminar y que venía el '
  'primer cobro. Nulo mientras no se avisó. Lo escribe el motor una sola vez por acceso.';

NOTIFY pgrst, 'reload schema';

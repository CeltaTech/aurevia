--
-- Los documentos de cese quedan guardados
--
-- `ceses.documentos_generados` existe desde que se creó la tabla y nunca se escribió: el PDF de
-- la liquidación final, el del telegrama y el de la notificación de fin de período de prueba se
-- armaban en el navegador, se bajaban a la máquina de quien apretó el botón, y ahí terminaban.
-- Un mes después nadie puede decir qué documento se le entregó a esa persona, ni volver a sacar
-- el mismo: el cálculo se rehace con las escalas de hoy y puede dar otro número.
-- `docs/PRD_02B_Gestion_Personal.md:156-163` los pide guardados, y acá está dónde.
--
-- El depósito es privado y **no lleva políticas, a propósito**, igual que `certificados-medicos`
-- y `autorizaciones-monitoreo`. Nadie lo alcanza con su propio pase: adentro hay documentos de
-- baja con nombre, documento y montos, que son de lo más sensible que guarda el producto. Los
-- sirve el motor con la llave maestra y dirección firmada, después de comprobar que quien pide
-- pertenece a esa Prestadora (`backend/src/routes/panelCeses.js`). Con la protección por fila
-- encendida y ninguna política que lo nombre, la base lo niega sola por cualquier otro camino:
-- falla cerrado, que es como tiene que fallar.
--
-- La ruta empieza por la Prestadora —`<prestadora>/<cese>/<tipo>.pdf`—, igual que la de todos los
-- demás depósitos, y no lleva adentro el nombre de nadie: el nombre de archivo con el que se baja
-- lo arma la pantalla, y lo guardado se nombra por su función (CLAUDE.md §8).
--

INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos-cese', 'documentos-cese', false)
ON CONFLICT (id) DO UPDATE SET public = false;

NOTIFY pgrst, 'reload schema';

--
-- Los dos depósitos del Panel se crean por migración
--
-- `certificados-medicos` y `autorizaciones-monitoreo` existen en la nube desde julio, pero
-- ninguna migración los crea: alguien los dio de alta a mano. La consecuencia es que una base
-- reconstruida desde cero no los tiene, y las dos pantallas del Panel que suben archivos ahí
-- —el certificado que respalda una ausencia, y la autorización firmada para monitorear los
-- signos vitales de un Paciente— fallan sin decir por qué. Es exactamente el mismo defecto que
-- se corrigió para `reportes-fotos` y `prescripciones-medicacion`, y se corrige igual.
--
-- Los dos son privados y **no llevan políticas, a propósito.** No los alcanza nadie con su
-- propio pase: guardan un certificado médico y una autorización firmada, que son de los datos
-- más sensibles que maneja el producto. Los sirve el motor con la llave maestra y dirección
-- firmada, después de comprobar que quien pide pertenece a esa Prestadora
-- (`backend/src/routes/panelAusencias.js` y `backend/src/routes/panelVitalesAutorizacion.js`).
-- Con la protección por fila encendida y ninguna política que los nombre, la base los niega
-- sola a cualquier otro camino: falla cerrado, que es como tiene que fallar.
--
-- `DO UPDATE SET public = false` en vez de `DO NOTHING`: si en la nube alguno hubiera quedado
-- público al crearlo a mano, esta migración lo cierra. Volver privado un depósito nunca expone
-- nada, así que la corrección es segura de correr esté como esté.
--
-- La ruta de los dos empieza por la Prestadora —`<prestadora>/<...>`—, igual que la de todos
-- los demás.
--

INSERT INTO storage.buckets (id, name, public)
VALUES ('certificados-medicos', 'certificados-medicos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

INSERT INTO storage.buckets (id, name, public)
VALUES ('autorizaciones-monitoreo', 'autorizaciones-monitoreo', false)
ON CONFLICT (id) DO UPDATE SET public = false;

NOTIFY pgrst, 'reload schema';

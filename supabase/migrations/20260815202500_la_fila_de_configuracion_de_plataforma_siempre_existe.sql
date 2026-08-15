-- La única fila de `configuracion_plataforma` tiene que existir siempre.
--
-- POR QUÉ EXISTE ESTA MIGRACIÓN. La tabla `configuracion_plataforma` guarda las decisiones
-- que valen para toda la plataforma, y por diseño tiene una sola fila: la columna `id` es un
-- sí/no fijado en verdadero, así que no puede haber dos. Hoy adentro hay una sola decisión, y
-- es de seguridad: si los administradores técnicos están obligados a entrar con segundo factor
-- (`mfa_admin_obligatorio`).
--
-- El problema es que esa fila nunca se creaba en una base armada desde cero. Se creaba en dos
-- archivos sueltos —`backend/src/db/schema_admin_plataforma_04_mfa.sql:22` y
-- `supabase/historial_previo/20260715123313_item_h_mfa_toggle_configurable.sql:22`— y ninguno
-- de los dos forma parte de la cadena de migraciones vigente. La tabla se creaba vacía, y una
-- tabla de una sola fila que no tiene esa fila no es "configuración por defecto": es una
-- pregunta que nadie puede contestar.
--
-- POR QUÉ IMPORTA. Los dos lugares que leen esta configuración pedían la fila única y, si la
-- lectura fallaba, seguían de largo sin fila y sin aviso. Resultado: el segundo factor
-- obligatorio quedaba apagado sin que nadie se enterara. Un agujero silencioso, que es la peor
-- clase (`CLAUDE.md` §6, "un error de configuración nunca debe permitir..."). Junto con esta
-- migración, esos dos lugares pasaron a negar por defecto y a dejar registro cuando no pueden
-- leer la fila (`panel/src/lib/reglaMfaObligatorio.js`, la regla escrita una sola vez).
--
-- SE PUEDE CORRER LAS VECES QUE HAGA FALTA. Si la fila ya está, no se toca nada: se respeta el
-- valor que haya configurado quien administra, no se lo pisa con el de fábrica. Si no está, se
-- crea con los valores por defecto de la tabla.

INSERT INTO public.configuracion_plataforma (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

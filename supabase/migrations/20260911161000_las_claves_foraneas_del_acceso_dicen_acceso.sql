-- Las cuatro claves foráneas de `accesos_marketplace` conservaban el nombre de la tabla anterior:
-- un `\d` mostraba `suscripciones_marketplace_familia_id_fkey` sobre una tabla que ya no se llama
-- así, y el error de la base al violar una de ellas nombraba algo que no existe. La migración de
-- al lado ya estaba aplicada cuando se vio, y una migración aplicada no se edita: se corrige con
-- otra adelante (`celtatech/CLAUDE.md` §9).

ALTER TABLE public.accesos_marketplace RENAME CONSTRAINT
  suscripciones_marketplace_prestadora_id_fkey TO accesos_marketplace_prestadora_id_fkey;
ALTER TABLE public.accesos_marketplace RENAME CONSTRAINT
  suscripciones_marketplace_familia_id_fkey TO accesos_marketplace_familia_id_fkey;
ALTER TABLE public.accesos_marketplace RENAME CONSTRAINT
  suscripciones_marketplace_paciente_id_fkey TO accesos_marketplace_paciente_id_fkey;
ALTER TABLE public.accesos_marketplace RENAME CONSTRAINT
  suscripciones_marketplace_asistente_id_fkey TO accesos_marketplace_asistente_id_fkey;

NOTIFY pgrst, 'reload schema';

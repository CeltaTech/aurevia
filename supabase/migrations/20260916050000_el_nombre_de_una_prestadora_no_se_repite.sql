-- El nombre de una Prestadora no se repite
--
-- Hasta acá una Prestadora entraba a la base sólo por la siembra de datos de
-- demostración y por los guiones de prueba: el Panel las listaba y no las creaba.
-- Con el alta hecha desde el Panel aparece la primera regla que hay que sostener
-- desde la base y no desde la pantalla: dos Prestadoras no pueden llamarse igual,
-- porque de ese nombre sale la dirección desde la que cada una manda sus avisos.
--
-- Se compara sin distinguir mayúsculas y sin los espacios de los extremos, porque
-- «Cuidar del Sur», «cuidar del sur» y «Cuidar del Sur » darían las tres la misma
-- dirección de correo.
--
-- Es un índice y no una restricción de tabla porque compara el resultado de una
-- expresión, que es la única forma que tiene Postgres de exigir unicidad así.

CREATE UNIQUE INDEX IF NOT EXISTS "prestadoras_nombre_fantasia_unico"
  ON "public"."prestadoras" (lower(btrim("nombre_fantasia")));

COMMENT ON INDEX "public"."prestadoras_nombre_fantasia_unico" IS
  'Dos Prestadoras no se llaman igual: de su nombre de fantasía sale la dirección de correo desde la que manda sus avisos. Se compara en minúsculas y sin los espacios de los extremos.';

NOTIFY pgrst, 'reload schema';

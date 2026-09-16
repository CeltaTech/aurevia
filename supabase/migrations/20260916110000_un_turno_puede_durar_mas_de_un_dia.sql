-- Un turno puede durar más de un día.
--
-- Hasta acá un turno se guardaba como una fecha y dos horas de reloj, y la única forma de saber
-- hasta cuándo iba era comparar las dos horas: si la de fin era menor o igual que la de inicio,
-- el turno terminaba al día siguiente. Esa regla cubre la guardia de noche, que es lo más
-- frecuente, y no puede expresar nada más largo: una guardia de 48 o de 72 horas quedaba guardada
-- exactamente igual que una de 24, y todo lo que se calcula desde ahí —cuánto duró, si se pisa
-- con otra, cuánto lleva en la semana, cuánto se le paga— la leía como 24.
--
-- Las guardias de 24, 48 y 72 horas cubiertas por una sola Asistente son parte del rubro, así que
-- la duración pasa a estar escrita y deja de deducirse.
--
-- `dias_hasta_el_fin` dice cuántos días después de `fecha` termina el turno: 0 el mismo día, 1 al
-- siguiente, 2 dos días después. La regla vieja se traduce sin ambigüedad, así que ningún turno ya
-- cargado cambia de duración.

ALTER TABLE public.guardias
  ADD COLUMN IF NOT EXISTS dias_hasta_el_fin smallint NOT NULL DEFAULT 0;

ALTER TABLE public.series_guardias
  ADD COLUMN IF NOT EXISTS dias_hasta_el_fin smallint NOT NULL DEFAULT 0;

-- Los turnos que ya estaban cargados conservan exactamente la duración que tenían.
UPDATE public.guardias
   SET dias_hasta_el_fin = 1
 WHERE hora_fin <= hora_inicio
   AND dias_hasta_el_fin = 0;

UPDATE public.series_guardias
   SET dias_hasta_el_fin = 1
 WHERE hora_fin <= hora_inicio
   AND dias_hasta_el_fin = 0;

-- Un turno no puede terminar antes de empezar, y el tope de tres días es el más largo del rubro.
-- Si alguna vez hace falta uno más largo, se sube acá y no en catorce pantallas.
ALTER TABLE public.guardias
  DROP CONSTRAINT IF EXISTS guardias_dias_hasta_el_fin_valido;
ALTER TABLE public.guardias
  ADD CONSTRAINT guardias_dias_hasta_el_fin_valido
  CHECK (dias_hasta_el_fin BETWEEN 0 AND 3);

ALTER TABLE public.series_guardias
  DROP CONSTRAINT IF EXISTS series_guardias_dias_hasta_el_fin_valido;
ALTER TABLE public.series_guardias
  ADD CONSTRAINT series_guardias_dias_hasta_el_fin_valido
  CHECK (dias_hasta_el_fin BETWEEN 0 AND 3);

-- El día en que termina un turno se calcula en un solo lugar, y ese lugar pasa a mirar la
-- duración escrita. El cuarto parámetro tiene valor por omisión, así que las dos funciones que ya
-- la llaman con tres argumentos siguen andando sin cambios: para ellas la respuesta es la misma
-- que antes.
DROP FUNCTION IF EXISTS public.dia_en_que_termina_guardia(date, time without time zone, time without time zone);

CREATE FUNCTION public.dia_en_que_termina_guardia(
  p_fecha date,
  p_hora_inicio time without time zone,
  p_hora_fin time without time zone,
  p_dias_hasta_el_fin smallint DEFAULT NULL
)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           -- Duración escrita: manda, y es el caso de toda guardia cargada de acá en adelante.
           WHEN p_dias_hasta_el_fin IS NOT NULL THEN p_fecha + p_dias_hasta_el_fin
           WHEN p_hora_fin IS NULL OR p_hora_inicio IS NULL THEN p_fecha
           -- Sin duración escrita se cae en la regla vieja, que sólo sabe de la guardia de noche.
           WHEN p_hora_fin <= p_hora_inicio THEN p_fecha + 1
           ELSE p_fecha
         END;
$$;

REVOKE ALL ON FUNCTION public.dia_en_que_termina_guardia(date, time without time zone, time without time zone, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dia_en_que_termina_guardia(date, time without time zone, time without time zone, smallint) TO authenticated, service_role;

COMMENT ON COLUMN public.guardias.dias_hasta_el_fin IS
  'Cuantos dias despues de fecha termina el turno: 0 el mismo dia, 1 al siguiente, 2 dos dias despues. Permite las guardias de 24, 48 y 72 horas.';
COMMENT ON COLUMN public.series_guardias.dias_hasta_el_fin IS
  'Cuantos dias despues del dia de inicio termina cada turno de la serie.';

NOTIFY pgrst, 'reload schema';

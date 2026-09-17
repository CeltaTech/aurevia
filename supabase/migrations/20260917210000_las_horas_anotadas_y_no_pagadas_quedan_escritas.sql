-- ---------------------------------------------------------------------------
-- Las horas de mas anotadas y no pagadas quedan escritas igual
--
-- QUE PASABA HASTA ACA. La migracion anterior le exigio a la liquidacion que, si tenia horas de
-- mas, tuviera tambien el valor con el que se pagaron. La intencion era buena -un importe que
-- nadie puede rehacer no sirve de nada- pero la regla quedo apuntando a la columna equivocada.
--
-- El caso que rompe: se anotan tres horas de mas en una guardia y la ficha de esa persona no
-- tiene cargado cuanto vale la hora extra. El calculo, como corresponde, no las paga y deja dicho
-- por que. Pero las tres horas se escriben igual, porque pasaron. Con la regla vieja esa fila no
-- entra: la liquidacion del mes entero falla y nadie cobra nada.
--
-- QUE CAMBIA. La exigencia pasa al importe, que es donde tenia que estar desde el principio: no
-- se puede pagar un importe por horas de mas sin decir a que valor se pago. Las horas anotadas y
-- no pagadas se guardan, con el importe en cero y sin valor, que es exactamente lo que pasa.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.liquidaciones_asistente
  DROP CONSTRAINT IF EXISTS liquidaciones_asistente_horas_extra_con_valor;

ALTER TABLE public.liquidaciones_asistente
  ADD CONSTRAINT liquidaciones_asistente_horas_extra_con_valor CHECK (
    (importe_horas_extra = 0 AND valor_hora_extra IS NULL)
    OR (importe_horas_extra > 0 AND valor_hora_extra IS NOT NULL)
  );

COMMENT ON COLUMN public.liquidaciones_asistente.valor_hora_extra IS
  'El valor con el que se pagaron las horas de mas de este periodo. Vacio cuando no se pagaron: '
  'o no hubo horas anotadas, o las hubo y la ficha no tenia cargado el valor.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Un cobro que falla ya no suspende el acceso en el acto.
--
-- El §3.2 del `docs/PRD_07_Modalidad_Marketplace.md` pide período de gracia con reintentos antes de
-- suspender, y hasta acá el aviso de un cobro fallido dejaba el acceso `vencida` el mismo día. Esta
-- columna guarda hasta cuándo dura esa gracia; mientras esté puesta, el acceso sigue funcionando y
-- el cobro se vuelve a intentar.

ALTER TABLE public.accesos_marketplace
  ADD COLUMN IF NOT EXISTS gracia_hasta date;

COMMENT ON COLUMN public.accesos_marketplace.gracia_hasta IS
  'El día en que se suspende el acceso si para entonces el cobro fallido no entró. Se pone cuando '
  'falla un cobro y se borra cuando entra la plata. Es la fecha de la suspensión, no el último día '
  'de gracia, igual que `vigente_hasta` es la fecha del cobro que no se va a hacer.';

-- Los que están esperando que se les acabe la gracia. Son pocos y se consultan una vez por día,
-- así que el índice va sobre esos y no sobre la tabla entera.
CREATE INDEX IF NOT EXISTS idx_accesos_marketplace_en_gracia
  ON public.accesos_marketplace (gracia_hasta)
  WHERE estado = 'vigente' AND gracia_hasta IS NOT NULL;

NOTIFY pgrst, 'reload schema';

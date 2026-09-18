-- ============================================================================
-- Cada Prestadora elige los plazos de su cobro
-- ============================================================================
--
-- Tres plazos estaban escritos en el motor: los días de aviso antes de un cobro, los días
-- de gracia cuando un cobro no entra, y los días que vive el cupón de la red de cobranza.
-- Los tres son decisiones comerciales de cara a la Familia, así que los elige cada
-- Prestadora.
--
-- Los valores de arranque son los que regían hasta hoy, para que a nadie le cambie el
-- comportamiento, y viven acá: son los `DEFAULT` de cada columna, que son la única fuente.
--
-- El único borde es el de abajo, y no lo pone este archivo. El aviso previo y el período de
-- gracia son resguardos que `docs/PRD_07_Modalidad_Marketplace.md` §3.2 declara obligatorios
-- para toda forma que se renueva sola: se pueden estirar todo lo que la Prestadora quiera, no
-- apagar. Cero días es apagarlos. Y un cupón que vence el mismo día que se emite no lo puede
-- pagar nadie. De ahí el mínimo de un día.
--
-- Arriba no hay borde. Una Prestadora que avise con dos meses, o que dé medio año de gracia,
-- está trabajando como decidió trabajar.
--
-- La clave primaria es exactamente `prestadora_id`, así que la siembra automática la alcanza
-- sola: el disparador del alta la cubre para toda Prestadora nueva, y la llamada del final
-- completa las que ya existen.

CREATE TABLE IF NOT EXISTS public.configuracion_cobro_marketplace (
  prestadora_id                       uuid PRIMARY KEY
    REFERENCES public.prestadoras (id) ON DELETE CASCADE,
  dias_de_aviso_antes_del_cobro       integer NOT NULL DEFAULT 3,
  dias_de_gracia_por_cobro_rechazado  integer NOT NULL DEFAULT 7,
  dias_de_vida_del_cupon              integer NOT NULL DEFAULT 10,
  created_at                          timestamptz NOT NULL DEFAULT now(),
  updated_at                          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracion_cobro_marketplace_aviso_al_menos_un_dia
    CHECK (dias_de_aviso_antes_del_cobro >= 1),
  CONSTRAINT configuracion_cobro_marketplace_gracia_al_menos_un_dia
    CHECK (dias_de_gracia_por_cobro_rechazado >= 1),
  CONSTRAINT configuracion_cobro_marketplace_cupon_al_menos_un_dia
    CHECK (dias_de_vida_del_cupon >= 1)
);

COMMENT ON TABLE public.configuracion_cobro_marketplace IS
  'Los plazos comerciales del cobro de marketplace, elegidos por cada Prestadora. Una fila por Prestadora, sembrada al darla de alta.';
COMMENT ON COLUMN public.configuracion_cobro_marketplace.dias_de_aviso_antes_del_cobro IS
  'Con cuántos días de anticipación se avisa el primer cobro que viene.';
COMMENT ON COLUMN public.configuracion_cobro_marketplace.dias_de_gracia_por_cobro_rechazado IS
  'Cuántos días se conserva el acceso, con reintentos, cuando un cobro no entra.';
COMMENT ON COLUMN public.configuracion_cobro_marketplace.dias_de_vida_del_cupon IS
  'Cuántos días vive el cupón de la red de cobranza desde que se emite.';

ALTER TABLE public.configuracion_cobro_marketplace ENABLE ROW LEVEL SECURITY;

-- Es una decisión comercial: la toma la administración de la Prestadora, no el Coordinador.
-- El Superadmin queda encerrado en la Prestadora donde tenga abierta la sesión de soporte,
-- como en todas las demás tablas.
DROP POLICY IF EXISTS admin_prestadora_gestiona_cobro_marketplace ON public.configuracion_cobro_marketplace;
CREATE POLICY admin_prestadora_gestiona_cobro_marketplace
  ON public.configuracion_cobro_marketplace
  TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND (
      interno.es_superadmin()
      OR EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
      )
    )
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND (
      interno.es_superadmin()
      OR EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
      )
    )
  );

-- El Coordinador los ve y no los toca: es el mismo alcance que ya tiene sobre las funciones
-- de marketplace.
DROP POLICY IF EXISTS coordinador_lee_cobro_marketplace ON public.configuracion_cobro_marketplace;
CREATE POLICY coordinador_lee_cobro_marketplace
  ON public.configuracion_cobro_marketplace
  FOR SELECT
  TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'coordinador'
    )
  );

GRANT SELECT, INSERT, UPDATE ON TABLE public.configuracion_cobro_marketplace TO authenticated;
GRANT ALL ON TABLE public.configuracion_cobro_marketplace TO service_role;

-- Las Prestadoras que ya existían. Las nuevas las cubre el disparador del alta.
SELECT sembrar_configuracion_prestadora(id) FROM prestadoras;

NOTIFY pgrst, 'reload schema';

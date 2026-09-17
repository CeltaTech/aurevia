-- El estado de cuenta de la Familia lo ve la administracion de la Prestadora.
-- =====================================================================
--
-- QUE FALTABA. Cuanto debe cada Familia, si esta atrasada y desde cuando se veia con el solo
-- hecho de tener un rol de Panel, o sea tambien desde la coordinacion de turnos. Eso no es
-- informacion de quien arma las guardias: es del trato economico entre la Prestadora y la
-- Familia, y en el catalogo de permisos no habia ninguna accion que lo dijera.
--
-- COMO ENTRA. Como accion nueva del catalogo, con el mismo molde que `ver_pagos_asistente`:
-- nace reservada a la administracion y cada Prestadora la abre o la cierra desde su Panel. El
-- producto no reparte el trabajo de adentro de una Prestadora, le da la perilla.
--
-- DONDE SE APLICA. En las rutas del motor que entregan el estado de cuenta, que es donde manda,
-- y ademas en la politica de lectura de los avisos que llegan de afuera, que es la segunda red
-- para el dia en que esa tabla se lea con el pase de una persona y no con la llave del motor.
-- La resta que calcula este sistema vive en la vista `saldos_familia`, armada sobre las
-- facturas: esa no se toca acá, porque la misma politica alcanza a quien manda a facturar, que
-- si es trabajo de la coordinacion.

BEGIN;

-- Orden 13: el ultimo del catalogo. La accion nace reservada, que es lo que significa el TRUE.
INSERT INTO public.catalogo_acciones_permisos (accion, default_solo_admin, orden)
SELECT 'ver_estado_de_cuenta_familia', true, 13
 WHERE NOT EXISTS (
   SELECT 1 FROM public.catalogo_acciones_permisos WHERE accion = 'ver_estado_de_cuenta_familia'
 );

-- Los avisos que manda el software de cobranzas. La politica anterior pedia solamente ser de la
-- Prestadora; ahora pide ademas tener la accion habilitada. Para la administracion no cambia
-- nada: `tiene_permiso` contesta que si a todo administrador.
DROP POLICY IF EXISTS panel_lee_estados_de_cuenta_externos ON public.estados_de_cuenta_externos;
CREATE POLICY panel_lee_estados_de_cuenta_externos ON public.estados_de_cuenta_externos
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('ver_estado_de_cuenta_familia')
  );

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.catalogo_acciones_permisos
     WHERE accion = 'ver_estado_de_cuenta_familia' AND default_solo_admin
  ) THEN
    v_faltan := v_faltan || ' la accion del catalogo, reservada a la administracion;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'estados_de_cuenta_externos'
       AND policyname = 'panel_lee_estados_de_cuenta_externos'
       AND qual LIKE '%ver_estado_de_cuenta_familia%'
  ) THEN
    v_faltan := v_faltan || ' la politica de lectura con el permiso;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La migracion del estado de cuenta reservado no quedo completa:%', v_faltan;
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';

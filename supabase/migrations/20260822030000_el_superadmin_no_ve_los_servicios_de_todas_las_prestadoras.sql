-- ============================================================================
-- Qué hace: corrige las dos políticas de seguridad de `servicios`, que dejaban
-- pasar filas de una Prestadora a quien no debía verlas.
--
-- Por qué: `CLAUDE.md` §5 pone una restricción dura — fuera de una sesión de
-- soporte técnico, un Superadmin tiene acceso de Panel únicamente a la
-- Organización Sandbox. Y §6 cierra con que un error de configuración nunca
-- debe permitir que una Prestadora acceda a información de otra.
--
-- `servicios` era la única de su familia que no lo cumplía. Comparadas una al
-- lado de la otra, la diferencia era dónde caía el `OR`:
--
--   servicios (mal):    es_superadmin() OR (prestadora_id = current_tenant() AND …)
--   prestaciones (bien): (es_superadmin() AND prestadora_id = current_tenant()) OR …
--
-- En la primera forma, `es_superadmin()` alcanza sola para pasar, y esa función
-- no mira la Prestadora: solo mira el rol y, si la Prestadora exige doble
-- factor, que la sesión lo tenga. O sea que un Superadmin veía y podía escribir
-- los Servicios de todas las Prestadoras a la vez, sin sesión de soporte
-- abierta y sin que quedara registrado como acceso a ninguna.
--
-- Y no era teórico: la pantalla de Servicios existe desde el 2026-08-20, está
-- desplegada, y pide la lista sin filtrar por Prestadora justamente porque
-- confía en que la base la filtre.
--
-- La segunda política, la de la Familia, tenía dos defectos en la misma línea:
-- no comprobaba la Prestadora, y comparaba `familia_id` contra `auth.uid()` en
-- vez de contra `familia_id_de_usuario(auth.uid())`. Lo segundo dejaba afuera a
-- los usuarios del círculo familiar, que no son la fila de la Familia pero
-- pertenecen a ella. Se alinea con la política equivalente de `pacientes`, que
-- es la que está bien escrita.
--
-- Qué se comprobó antes: que ninguna línea de código escribe `servicios`
-- —solamente la leen `panel/src/pages/Servicios.jsx` y
-- `panel/src/pages/servicios/ServicioDetalle.jsx`, las dos de solo lectura—, y
-- que ni el motor ni las dos aplicaciones de celular la tocan. Por eso apretar
-- estas dos políticas no deja sin funcionar ninguna pantalla existente.
--
-- Cómo se vuelve atrás: con una migración nueva hacia adelante que vuelva a
-- crear las políticas con el texto anterior, que queda escrito arriba.
-- ============================================================================

-- 1. El Panel. Se copia exactamente la forma de `panel_gestiona_prestaciones` y
--    `panel_gestiona_paquetes`: el Superadmin también queda encerrado en la
--    Prestadora de su sesión, que es lo que `current_tenant()` resuelve —primero
--    la sesión de soporte abierta, después la Organización propia.
DROP POLICY IF EXISTS panel_gestiona_servicios ON public.servicios;

CREATE POLICY panel_gestiona_servicios ON public.servicios
  FOR ALL
  USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (
      prestadora_id = current_tenant()
      AND EXISTS (
        SELECT 1 FROM usuarios u
        WHERE u.id = auth.uid()
          AND u.rol = ANY (ARRAY['admin_prestadora'::text, 'coordinador'::text])
      )
    )
  );

-- 2. La Familia. Misma forma que `familia_ve_sus_pacientes`.
DROP POLICY IF EXISTS familia_ve_sus_servicios ON public.servicios;

CREATE POLICY familia_ve_sus_servicios ON public.servicios
  FOR SELECT
  USING (
    prestadora_id = current_tenant()
    AND familia_id = familia_id_de_usuario(auth.uid())
  );

NOTIFY pgrst, 'reload schema';

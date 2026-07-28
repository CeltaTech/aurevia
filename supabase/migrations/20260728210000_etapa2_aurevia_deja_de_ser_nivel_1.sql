-- ============================================================================
-- Etapa 2 del plan de separación CeltaTech / Aurevia
-- ============================================================================
--
-- QUÉ HACE
-- Saca de Aurevia todo lo que es del negocio de la empresa y no del producto:
-- las cuatro tablas comerciales, y el rol admin_plataforma entero.
--
-- POR QUÉ
-- Aurevia venía siendo dos cosas a la vez: el software que usan las Prestadoras,
-- y también el lugar donde se administraba cuánto paga cada una. Eso segundo es
-- de CeltaTech (la empresa), y ya existe en su propio panel — que tiene sus
-- propias tablas planes, plan_precios, suscripciones y facturas. Tener las dos
-- mitades era mantener el mismo negocio en dos bases distintas.
--
-- QUÉ SE COMPROBÓ ANTES DE BORRAR (2026-07-28, contra esta misma base)
--   * usuarios con rol admin_plataforma:            0
--   * filas en sesiones_tenant_admin_plataforma:    0
--   * filas en auditoria_admin_plataforma:          0
--   * filas en plan_modulos, prestadora_planes,
--     facturas_licencia y prestadora_modulos:       0
--   * filas en planes:                              3, de ejemplo, ninguna
--     Prestadora las tiene asignadas (prestadora_planes está vacía)
-- El inventario completo, con los archivos de código que tocaban cada cosa,
-- está en el repositorio docs, archivo ETAPA_2_INVENTARIO.md.
--
-- CÓMO SE VUELVE ATRÁS
--   1. revertir el commit de código que acompaña a esta migración;
--   2. restaurar las cuatro tablas comerciales desde
--      F:\proyectos\celtatech\respaldos-historicos\etapa2-tablas-comerciales-20260728.sql
--      (estructura + las 3 filas de planes, sacado justo antes de esta migración);
--   3. volver a poner 'admin_plataforma' en las dos restricciones de usuarios.
-- Como no había ni un usuario con el rol ni una fila de datos reales, la vuelta
-- atrás no le hace perder trabajo a nadie.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Las cuatro tablas comerciales
-- ----------------------------------------------------------------------------
-- CASCADE se lleva puestas sus propias políticas de seguridad y las claves
-- foráneas que las unen entre sí. Ninguna tabla que se queda apunta a estas.
DROP TABLE IF EXISTS public.facturas_licencia CASCADE;
DROP TABLE IF EXISTS public.prestadora_planes CASCADE;
DROP TABLE IF EXISTS public.plan_modulos CASCADE;
DROP TABLE IF EXISTS public.planes CASCADE;


-- ----------------------------------------------------------------------------
-- 2. La maquinaria de "entrar a una Prestadora" cambia de dueño y de nombre
-- ----------------------------------------------------------------------------
-- No se borra: es buena maquinaria (banner, auditoría de cada cambio, corte por
-- inactividad a los 5 minutos y tope absoluto de 60). Lo que estaba mal era
-- quién la usaba. Pasa de admin_plataforma (rol comercial) a superadmin (rol
-- técnico), y pasa a llamarse por lo que realmente es: sesión de soporte técnico.

ALTER TABLE public.sesiones_tenant_admin_plataforma RENAME TO sesiones_soporte_tecnico;
ALTER TABLE public.auditoria_admin_plataforma       RENAME TO auditoria_soporte_tecnico;

ALTER INDEX IF EXISTS idx_sesion_tenant_admin_plataforma_admin
  RENAME TO idx_sesion_soporte_admin;
ALTER INDEX IF EXISTS idx_sesion_tenant_admin_plataforma_vigente_unica
  RENAME TO idx_sesion_soporte_vigente_unica;
ALTER INDEX IF EXISTS idx_auditoria_admin_plataforma_admin
  RENAME TO idx_auditoria_soporte_admin;
ALTER INDEX IF EXISTS idx_auditoria_admin_plataforma_prestadora
  RENAME TO idx_auditoria_soporte_prestadora;

-- Renombrar una tabla no renombra sus restricciones: hay que hacerlo a mano, o
-- quedan ocho nombres hablando de un rol que ya no existe.
ALTER TABLE public.sesiones_soporte_tecnico
  RENAME CONSTRAINT sesiones_tenant_admin_plataforma_pkey TO sesiones_soporte_tecnico_pkey;
ALTER TABLE public.sesiones_soporte_tecnico
  RENAME CONSTRAINT sesiones_tenant_admin_plataforma_admin_id_fkey TO sesiones_soporte_tecnico_admin_id_fkey;
ALTER TABLE public.sesiones_soporte_tecnico
  RENAME CONSTRAINT sesiones_tenant_admin_plataforma_prestadora_id_fkey TO sesiones_soporte_tecnico_prestadora_id_fkey;

ALTER TABLE public.auditoria_soporte_tecnico
  RENAME CONSTRAINT auditoria_admin_plataforma_pkey TO auditoria_soporte_tecnico_pkey;
ALTER TABLE public.auditoria_soporte_tecnico
  RENAME CONSTRAINT auditoria_admin_plataforma_admin_id_fkey TO auditoria_soporte_tecnico_admin_id_fkey;
ALTER TABLE public.auditoria_soporte_tecnico
  RENAME CONSTRAINT auditoria_admin_plataforma_prestadora_id_fkey TO auditoria_soporte_tecnico_prestadora_id_fkey;
ALTER TABLE public.auditoria_soporte_tecnico
  RENAME CONSTRAINT auditoria_admin_plataforma_operacion_check TO auditoria_soporte_tecnico_operacion_check;
ALTER TABLE public.auditoria_soporte_tecnico
  RENAME CONSTRAINT auditoria_admin_plataforma_tipo_evento_check TO auditoria_soporte_tecnico_tipo_evento_check;

-- Los 37 disparadores de auditoría se llaman todos igual, uno por tabla auditada.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tabla
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE t.tgname = 'trg_auditoria_admin_plataforma' AND NOT t.tgisinternal
  LOOP
    EXECUTE format(
      'ALTER TRIGGER trg_auditoria_admin_plataforma ON public.%I RENAME TO trg_auditoria_soporte',
      r.tabla
    );
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 3. Las funciones que sostienen el aislamiento entre Prestadoras
-- ----------------------------------------------------------------------------
-- current_tenant() es la pieza más importante de todo el producto: es la que
-- responde "¿de qué Prestadora es quien está consultando?", y de ella cuelgan
-- las políticas de seguridad de casi todas las tablas. Se reescribe con
-- CREATE OR REPLACE a propósito: así conserva su identidad interna y ninguna
-- política queda colgando.
--
-- La lógica no cambia: primero busca una sesión de soporte viva; si no hay,
-- usa la Prestadora propia del usuario. Lo único que cambia es el nombre de
-- la tabla donde busca.
CREATE OR REPLACE FUNCTION public.current_tenant()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT s.prestadora_id FROM sesiones_soporte_tecnico s
      WHERE s.admin_id = auth.uid()
        AND s.salida_at IS NULL
        AND s.expira_at > NOW()
        AND s.ultima_actividad_at > NOW() - INTERVAL '5 minutes'
      ORDER BY s.entrada_at DESC LIMIT 1),
    (SELECT prestadora_id FROM usuarios WHERE id = auth.uid())
  )
$function$;

-- "¿Hay una sesión de soporte viva ahora mismo?" — la usa el disparador de
-- auditoría para saber si tiene que anotar el cambio.
CREATE OR REPLACE FUNCTION public.es_sesion_soporte_activa()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM sesiones_soporte_tecnico s
      WHERE s.admin_id = auth.uid()
        AND s.salida_at IS NULL
        AND s.expira_at > NOW()
        AND s.ultima_actividad_at > NOW() - INTERVAL '5 minutes'
  )
$function$;

-- El disparador que anota cada cambio hecho durante una sesión de soporte.
-- Se recrea con el nombre nuevo y apuntando a la tabla renombrada.
CREATE OR REPLACE FUNCTION public.fn_auditoria_soporte_mutacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_registro_id UUID;
BEGIN
  IF NOT es_sesion_soporte_activa() THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    BEGIN
      v_registro_id := OLD.id;
    EXCEPTION WHEN undefined_column THEN
      v_registro_id := NULL;
    END;
  ELSE
    BEGIN
      v_registro_id := NEW.id;
    EXCEPTION WHEN undefined_column THEN
      v_registro_id := NULL;
    END;
  END IF;

  INSERT INTO auditoria_soporte_tecnico (admin_id, prestadora_id, tipo_evento, tabla_afectada, operacion, registro_id)
  VALUES (auth.uid(), current_tenant(), 'mutacion', TG_TABLE_NAME, TG_OP, v_registro_id);

  RETURN NULL;
END;
$function$;

-- Los 37 disparadores todavía apuntan a la función vieja: se los repunta a la nueva.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tabla, t.tgname AS disparador,
           pg_get_triggerdef(t.oid) AS definicion
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc  p ON p.oid = t.tgfoid
     WHERE p.proname = 'fn_auditoria_admin_plataforma_mutacion' AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER %I ON public.%I', r.disparador, r.tabla);
    EXECUTE replace(r.definicion, 'fn_auditoria_admin_plataforma_mutacion()', 'fn_auditoria_soporte_mutacion()');
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 4. Las políticas de seguridad que nombraban al rol
-- ----------------------------------------------------------------------------
-- Antes de esta migración había 18 políticas que preguntaban "¿sos
-- admin_plataforma?", y cada una repetía la misma consulta escrita a mano.
-- Eso viola la regla 12 de CLAUDE.md (ningún patrón repetido sin punto único
-- de verdad). Cuatro se fueron solas con las tablas borradas; las catorce que
-- quedan pasan a preguntar por es_superadmin(), que ya existía y es la única
-- fuente de verdad — además chequea el segundo factor cuando está obligatorio.

-- 4.1 Tablas que solo el rol técnico administra
DROP POLICY IF EXISTS admin_plataforma_gestiona_catalogo_modulos ON public.catalogo_modulos;
CREATE POLICY superadmin_gestiona_catalogo_modulos ON public.catalogo_modulos
  USING (public.es_superadmin());

DROP POLICY IF EXISTS admin_plataforma_gestiona_cambios_precio_ia_pendientes ON public.cambios_precio_ia_pendientes;
CREATE POLICY superadmin_gestiona_cambios_precio_ia_pendientes ON public.cambios_precio_ia_pendientes
  USING (public.es_superadmin());

DROP POLICY IF EXISTS admin_plataforma_gestiona_precios_ia_modelo ON public.precios_ia_modelo;
CREATE POLICY superadmin_gestiona_precios_ia_modelo ON public.precios_ia_modelo
  USING (public.es_superadmin());

DROP POLICY IF EXISTS admin_plataforma_lee_uso_ia ON public.uso_ia;
CREATE POLICY superadmin_lee_uso_ia ON public.uso_ia
  USING (public.es_superadmin());

-- 4.2 Tablas que el rol técnico solo mira
DROP POLICY IF EXISTS admin_plataforma_lee_prestadoras ON public.prestadoras;
CREATE POLICY superadmin_lee_prestadoras ON public.prestadoras
  FOR SELECT USING (public.es_superadmin());

DROP POLICY IF EXISTS admin_plataforma_lee_modalidades ON public.prestadora_modalidades;
CREATE POLICY superadmin_lee_modalidades ON public.prestadora_modalidades
  FOR SELECT USING (public.es_superadmin());

DROP POLICY IF EXISTS admin_plataforma_lee_pasarela ON public.prestadora_pasarela_pago;
CREATE POLICY superadmin_lee_pasarela ON public.prestadora_pasarela_pago
  FOR SELECT USING (public.es_superadmin());

-- 4.3 Las tres tablas de referencia legal, que lee todo el Panel
DROP POLICY IF EXISTS panel_lee_advertencias_legales ON public.advertencias_legales;
CREATE POLICY panel_lee_advertencias_legales ON public.advertencias_legales
  FOR SELECT USING (
    public.es_superadmin()
    OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  );

DROP POLICY IF EXISTS panel_lee_escalas_legales ON public.escalas_legales;
CREATE POLICY panel_lee_escalas_legales ON public.escalas_legales
  FOR SELECT USING (
    public.es_superadmin()
    OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  );

DROP POLICY IF EXISTS panel_lee_formulas_cese ON public.formulas_cese;
CREATE POLICY panel_lee_formulas_cese ON public.formulas_cese
  FOR SELECT USING (
    public.es_superadmin()
    OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  );

-- 4.4 La sesión de soporte: cada quien maneja la suya y nadie ve la de otro
DROP POLICY IF EXISTS admin_plataforma_gestiona_su_propia_sesion ON public.sesiones_soporte_tecnico;
CREATE POLICY superadmin_gestiona_su_propia_sesion_de_soporte ON public.sesiones_soporte_tecnico
  USING (admin_id = auth.uid() AND public.es_superadmin())
  WITH CHECK (admin_id = auth.uid() AND public.es_superadmin());

-- 4.5 La auditoría: el técnico ve lo de la Prestadora donde está parado; la
--     Prestadora ve todo lo que se hizo sobre ella (transparencia — es su casa).
DROP POLICY IF EXISTS admin_plataforma_lee_auditoria_de_su_sesion_activa ON public.auditoria_soporte_tecnico;
CREATE POLICY superadmin_lee_auditoria_de_su_sesion_activa ON public.auditoria_soporte_tecnico
  FOR SELECT USING (public.es_superadmin() AND prestadora_id = public.current_tenant());

DROP POLICY IF EXISTS admin_prestadora_lee_auditoria_de_su_prestadora ON public.auditoria_soporte_tecnico;
CREATE POLICY admin_prestadora_lee_auditoria_de_su_prestadora ON public.auditoria_soporte_tecnico
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND u.rol = 'admin_prestadora'
         AND u.prestadora_id = auditoria_soporte_tecnico.prestadora_id
    )
  );

-- Ya no queda ninguna política que la use.
DROP FUNCTION IF EXISTS public.es_admin_plataforma();
DROP FUNCTION IF EXISTS public.es_sesion_tenant_admin_plataforma_activa();
DROP FUNCTION IF EXISTS public.fn_auditoria_admin_plataforma_mutacion();


-- ----------------------------------------------------------------------------
-- 5. prestadora_modulos: de tabla del panel comercial a caché de lo contratado
-- ----------------------------------------------------------------------------
-- Esta tabla no se borra, cambia de dueño. Sigue respondiendo lo mismo —"¿qué
-- funciones tiene habilitadas esta Prestadora?"— pero deja de escribirla el
-- panel de Aurevia y pasa a escribirla CeltaTech. Aurevia solo la lee: es una
-- copia local de lo que la empresa ya decidió, para no tener que preguntárselo
-- por red en cada pantalla.
--
-- Las dos columnas nuevas son lo mínimo que necesita una copia local para saber
-- si está al día. La Etapa 3 completa el mecanismo (quién la actualiza y cada
-- cuánto); acá solo se prepara el lugar.
ALTER TABLE public.prestadora_modulos
  ADD COLUMN IF NOT EXISTS version bigint,
  ADD COLUMN IF NOT EXISTS sincronizado_at timestamptz;

COMMENT ON COLUMN public.prestadora_modulos.version IS
  'Numero de version que trae CeltaTech con cada actualizacion. Sirve para no pisar una copia nueva con una vieja que llego tarde.';
COMMENT ON COLUMN public.prestadora_modulos.sincronizado_at IS
  'Cuando se recibio esta fila de CeltaTech por ultima vez. Si esta muy vieja, la copia local dejo de ser confiable.';

-- El origen 'plan' o 'addon' era vocabulario del panel comercial de Aurevia.
-- Ahora el origen es quién lo decidió.
ALTER TABLE public.prestadora_modulos DROP CONSTRAINT IF EXISTS prestadora_modulos_origen_check;
ALTER TABLE public.prestadora_modulos
  ADD CONSTRAINT prestadora_modulos_origen_check
  CHECK (origen = ANY (ARRAY['celtatech'::text, 'manual'::text]));
ALTER TABLE public.prestadora_modulos ALTER COLUMN origen SET DEFAULT 'celtatech';

COMMENT ON COLUMN public.prestadora_modulos.origen IS
  'celtatech = lo mando la empresa; manual = lo prendio un tecnico a mano, temporalmente.';

-- La política del rol comercial se va. Queda la de la Prestadora leyendo lo
-- suyo, y se agrega la del técnico: puede mirar, no puede escribir. Quien
-- escribe es CeltaTech, que entra con la llave de servicio y no pasa por RLS.
DROP POLICY IF EXISTS admin_plataforma_gestiona_prestadora_modulos ON public.prestadora_modulos;
CREATE POLICY superadmin_lee_prestadora_modulos ON public.prestadora_modulos
  FOR SELECT USING (public.es_superadmin());


-- ----------------------------------------------------------------------------
-- 6. configuracion_plataforma se parte en dos
-- ----------------------------------------------------------------------------
-- Tenía dos cosas de dueños distintos:
--   * mfa_admin_obligatorio      → es una regla técnica del producto. SE QUEDA.
--   * umbral_alerta_prestadoras  → es una alerta comercial de la empresa
--     (a partir de cuántos clientes avisar del riesgo de mandar todos los
--     correos desde una sola casilla de Gmail). SE VA a CeltaTech.
--
-- Se comprobó antes de sacarla: ninguna pantalla de Aurevia la mostraba. Solo
-- existían dos endpoints del backend sin nadie que los llamara. Su valor de
-- hoy es 5, y queda anotado acá para que CeltaTech arranque con el mismo.
ALTER TABLE public.configuracion_plataforma DROP COLUMN IF EXISTS umbral_alerta_prestadoras;


-- ----------------------------------------------------------------------------
-- 7. El rol admin_plataforma deja de existir en Aurevia
-- ----------------------------------------------------------------------------
-- El rol no es un tipo enumerado: es texto con dos reglas de validación encima.
-- Retirarlo es editar esas dos reglas.
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol = ANY (ARRAY['admin_prestadora'::text, 'coordinador'::text, 'asistente'::text, 'familia'::text, 'superadmin'::text]));

-- La segunda regla decía "todo usuario pertenece a una Prestadora, salvo los
-- admin_plataforma". Esa excepción existía porque el rol comercial no vivía
-- adentro de ninguna Prestadora. El superadmin de hoy sí tiene la suya (la
-- Sandbox), pero la excepción se conserva para él: un rol técnico tiene que
-- poder existir antes de que exista una sola Prestadora.
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_prestadora_id_solo_admin_plataforma_null;
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_prestadora_id_solo_superadmin_null
  CHECK (prestadora_id IS NOT NULL OR rol = 'superadmin');


-- ----------------------------------------------------------------------------
-- 8. Avisar a la API que el esquema cambió
-- ----------------------------------------------------------------------------
-- Sin esto, PostgREST puede seguir devolviendo 404 en tablas que sí existen,
-- o seguir ofreciendo las que se borraron (CLAUDE.md §8).
NOTIFY pgrst, 'reload schema';

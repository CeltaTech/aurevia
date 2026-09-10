-- ============================================================================
-- El código de zona y el Servicio no se cruzan entre Prestadoras
-- ============================================================================
--
-- Dos defectos de aislamiento que vivían en la foto original de la base, y que se corrigen
-- juntos porque son el mismo error escrito dos veces: una restricción que mira el sistema
-- entero cuando tendría que mirar una sola Prestadora.
--
-- 1) El código de zona era único en todo el sistema. La primera Prestadora que cargaba
--    «caba» se lo bloqueaba a todas las demás para siempre. Pasa a ser único por Prestadora:
--    adentro de una no se puede repetir, y entre dos distintas no se estorban.
--
-- 2) Las tres claves foráneas que apuntan a un Servicio no llevaban la Prestadora adentro,
--    así que una fila de una Prestadora podía apuntar al Servicio de otra sin que la base
--    dijera nada. Pasan a ser compuestas: Servicio más Prestadora.
--
-- Para lo segundo, `facturas_familia_items` no tenía columna de Prestadora —la heredaba de
-- su factura y nada más—, así que acá se le agrega, se la completa desde la factura y se la
-- ata a esa factura con otra clave compuesta. Sin ese amarre, la columna nueva podría decir
-- una Prestadora y la factura decir otra, y la clave del Servicio estaría validando contra
-- un dato falso. Es el mismo armado que ya usa `cobros_familia`.
--
-- Lo que NO se hace acá: borrar `public.exigir_paciente_y_servicio_de_la_misma_familia`.
-- Se la había dado por código muerto y no lo es — tres disparadores vivos la ejecutan
-- (`validar_servicio_guardias` y `validar_servicio_prestaciones`, por medio de
-- `validar_servicio_misma_familia`, y `validar_familia_guardia_pacientes`, por medio de
-- `validar_paciente_de_guardia_misma_familia`).

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. El código de zona es único adentro de cada Prestadora, no en todo el sistema
-- ----------------------------------------------------------------------------

ALTER TABLE public.zonas_cobertura
  DROP CONSTRAINT IF EXISTS zonas_cobertura_codigo_key;

ALTER TABLE public.zonas_cobertura
  ADD CONSTRAINT zonas_cobertura_codigo_unico_por_prestadora
  UNIQUE (prestadora_id, codigo);

COMMENT ON CONSTRAINT zonas_cobertura_codigo_unico_por_prestadora ON public.zonas_cobertura IS
  'El código de zona identifica a la zona adentro de su Prestadora. Dos Prestadoras pueden llamar «caba» a lo suyo sin pisarse.';

-- ----------------------------------------------------------------------------
-- 2. Guardias: la Guardia y su Servicio son de la misma Prestadora
-- ----------------------------------------------------------------------------

ALTER TABLE public.guardias
  DROP CONSTRAINT IF EXISTS guardias_servicio_id_fkey;

ALTER TABLE public.guardias
  ADD CONSTRAINT guardias_servicio_de_la_misma_prestadora
  FOREIGN KEY (servicio_id, prestadora_id)
  REFERENCES public.servicios (id, prestadora_id);

-- ----------------------------------------------------------------------------
-- 3. Prestaciones: la Prestación y su Servicio son de la misma Prestadora
-- ----------------------------------------------------------------------------

ALTER TABLE public.prestaciones
  DROP CONSTRAINT IF EXISTS prestaciones_servicio_id_fkey;

ALTER TABLE public.prestaciones
  ADD CONSTRAINT prestaciones_servicio_de_la_misma_prestadora
  FOREIGN KEY (servicio_id, prestadora_id)
  REFERENCES public.servicios (id, prestadora_id);

-- ----------------------------------------------------------------------------
-- 4. El renglón de una factura de Familia dice de qué Prestadora es
-- ----------------------------------------------------------------------------
--
-- La columna se completa sola desde la factura, igual que se completa la moneda: el Panel
-- ya inserta renglones sin nombrarla y no tiene por qué empezar a nombrarla ahora.

CREATE OR REPLACE FUNCTION public.fn_completar_prestadora_desde_padre()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  tabla_padre text := TG_ARGV[0];
  columna_fk  text := TG_ARGV[1];
  prestadora_padre uuid;
BEGIN
  IF NEW.prestadora_id IS NULL THEN
    EXECUTE format('SELECT prestadora_id FROM public.%I WHERE id = ($1).%I', tabla_padre, columna_fk)
      INTO prestadora_padre
      USING NEW;
    NEW.prestadora_id := prestadora_padre;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_completar_prestadora_desde_padre() IS
  'Completa la Prestadora de una fila hija tomándola de su fila padre. Recibe el nombre de la tabla padre y el de la columna que la apunta.';

-- Es disparador y no dirección web: nadie de afuera la llama por su nombre.
REVOKE ALL ON FUNCTION public.fn_completar_prestadora_desde_padre() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_completar_prestadora_desde_padre() FROM anon;
REVOKE ALL ON FUNCTION public.fn_completar_prestadora_desde_padre() FROM authenticated;

ALTER TABLE public.facturas_familia_items
  ADD COLUMN IF NOT EXISTS prestadora_id uuid;

COMMENT ON COLUMN public.facturas_familia_items.prestadora_id IS
  'La Prestadora dueña del renglón. Sale de la factura y no puede diferir de ella.';

-- Los renglones que ya existen toman la Prestadora de su factura.
UPDATE public.facturas_familia_items i
   SET prestadora_id = f.prestadora_id
  FROM public.facturas_familia f
 WHERE f.id = i.factura_id
   AND i.prestadora_id IS DISTINCT FROM f.prestadora_id;

ALTER TABLE public.facturas_familia_items
  ALTER COLUMN prestadora_id SET NOT NULL;

ALTER TABLE public.facturas_familia_items
  ADD CONSTRAINT facturas_familia_items_prestadora_id_fkey
  FOREIGN KEY (prestadora_id) REFERENCES public.prestadoras (id);

DROP TRIGGER IF EXISTS trg_completar_prestadora ON public.facturas_familia_items;
CREATE TRIGGER trg_completar_prestadora
  BEFORE INSERT ON public.facturas_familia_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_completar_prestadora_desde_padre('facturas_familia', 'factura_id');

-- El renglón y su factura son de la misma Prestadora. Sin esto la columna de arriba sería
-- una declaración sin respaldo, y la clave del Servicio validaría contra ella.
ALTER TABLE public.facturas_familia_items
  DROP CONSTRAINT IF EXISTS facturas_familia_items_factura_id_fkey;

ALTER TABLE public.facturas_familia_items
  ADD CONSTRAINT facturas_familia_items_factura_de_la_misma_prestadora
  FOREIGN KEY (factura_id, prestadora_id)
  REFERENCES public.facturas_familia (id, prestadora_id)
  ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- 5. El renglón de la factura y su Servicio son de la misma Prestadora
-- ----------------------------------------------------------------------------

ALTER TABLE public.facturas_familia_items
  DROP CONSTRAINT IF EXISTS facturas_familia_items_servicio_id_fkey;

ALTER TABLE public.facturas_familia_items
  ADD CONSTRAINT facturas_familia_items_servicio_de_la_misma_prestadora
  FOREIGN KEY (servicio_id, prestadora_id)
  REFERENCES public.servicios (id, prestadora_id);

CREATE INDEX IF NOT EXISTS idx_facturas_familia_items_prestadora
  ON public.facturas_familia_items (prestadora_id);

COMMIT;

NOTIFY pgrst, 'reload schema';

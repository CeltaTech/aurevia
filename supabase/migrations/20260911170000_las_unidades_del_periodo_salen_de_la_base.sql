-- Las unidades del período salen de la base, no de una lista escrita en una pantalla
-- ==================================================================================
--
-- QUÉ FALTABA. `formas_de_cobro_marketplace.periodo_unidad` guarda cada cuánto se cobra —por día,
-- por semana, por mes, por año— y hasta hoy esa lista vivía adentro de una restricción de la
-- tabla. Para la base alcanzaba; para el Panel no: la pantalla donde la Prestadora arma su forma
-- de cobro tiene que ofrecer esas opciones, y una lista escrita adentro de una pantalla es
-- justamente lo que prohíbe «los catálogos salen de la base» (`celtatech/CLAUDE.md` §8).
--
-- CÓMO QUEDA. La lista pasa a ser una tabla, igual que `catalogo_funciones_marketplace`, y la
-- restricción que la repetía se reemplaza por una clave foránea contra esa tabla. Así hay un solo
-- lugar que dice cuáles son las unidades: agregar una es una fila, no dos cambios que se pueden
-- despegar.
--
-- QUÉ NO ES. No es un catálogo de formas de cobro. La forma la arma cada Prestadora combinando
-- las piezas (`20260911160000_la_prestadora_arma_su_forma_de_cobro.sql`); esto es apenas el
-- nombre de la unidad de tiempo, que no es una decisión comercial de nadie.

-- ---------------------------------------------------------------------------
-- 1. El catálogo
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalogo_periodos_cobro (
  -- La clave es lo que se guarda en la forma de cobro. El texto que se lee en pantalla no vive
  -- acá: sale de las traducciones, en los tres idiomas.
  clave text PRIMARY KEY,
  orden smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.catalogo_periodos_cobro (clave, orden) VALUES
  ('dia', 1),
  ('semana', 2),
  ('mes', 3),
  ('anio', 4)
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE public.catalogo_periodos_cobro ENABLE ROW LEVEL SECURITY;

-- Lo lee cualquiera que haya iniciado sesión: es una lista de unidades de tiempo, igual para
-- todas las Prestadoras, sin un solo dato de ninguna. La Familia también la necesita, porque ve
-- las formas que su Prestadora le ofrece y cada una dice cada cuánto se cobra.
CREATE POLICY lectura_del_catalogo_de_periodos ON public.catalogo_periodos_cobro
  FOR SELECT TO authenticated USING (true);

-- Escribirlo es cambiar el producto, no la configuración de una Prestadora.
CREATE POLICY superadmin_gestiona_catalogo_de_periodos ON public.catalogo_periodos_cobro
  FOR ALL USING (interno.es_superadmin()) WITH CHECK (interno.es_superadmin());

-- ---------------------------------------------------------------------------
-- 2. La forma de cobro apunta al catálogo
-- ---------------------------------------------------------------------------

-- La restricción anterior decía la misma lista con otras palabras. Se va: dos lugares que dicen
-- lo mismo se despegan el día que uno cambia.
ALTER TABLE public.formas_de_cobro_marketplace
  DROP CONSTRAINT IF EXISTS formas_cobro_mkt_unidad_conocida;

ALTER TABLE public.formas_de_cobro_marketplace
  ADD CONSTRAINT formas_cobro_mkt_unidad_del_catalogo
  FOREIGN KEY (periodo_unidad) REFERENCES public.catalogo_periodos_cobro(clave);

NOTIFY pgrst, 'reload schema';

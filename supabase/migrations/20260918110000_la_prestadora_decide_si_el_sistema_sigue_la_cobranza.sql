-- ---------------------------------------------------------------------------
-- La Prestadora decide si el sistema sigue la cobranza, o si la sigue otro software
--
-- QUE PASABA HASTA ACA. El sistema daba por sentado que el seguimiento de la cobranza era suyo:
-- generaba la factura, mostraba el saldo, anotaba los pagos y marcaba la mora. No habia forma de
-- decir que no.
--
-- QUE CAMBIA. Una Prestadora puede tener otro software de creditos y cobranzas y querer que ese
-- se ocupe. Entonces el seguimiento pasa a ser una decision suya, como todo lo demas: ella lo
-- enciende o lo apaga.
--
--   Encendido -> es lo de hoy: se manda la factura a quien tiene que pagarla, se sigue el saldo
--                y se anotan los pagos.
--   Apagado   -> no se muestra saldo, no se reclama nada, y lo unico que entra desde afuera es
--                si a alguien hay que ponerle una restriccion por falta de pago.
--
-- DE FABRICA QUEDA ENCENDIDO, porque es lo que las Prestadoras que ya estan cargadas vienen
-- usando. Apagarlo es una decision que se toma, no algo que pase solo.
--
-- Y LA RESTRICCION NO DECIDE NADA. El otro software avisa; el sistema lo muestra y nada mas. No
-- corta ningun Servicio, no cancela ninguna Guardia y no bloquea ninguna pantalla: quien decide
-- que hacer es una persona.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El interruptor
--
-- Vive en la misma regla donde ya vive el plazo de pago, porque es la misma decision: como
-- factura y como cobra esta Prestadora. Ausente quiere decir encendido.
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.configuracion_facturacion_familias IS
  'Como factura y como cobra esta Prestadora lo que no depende de una Familia sola: el plazo de pago acordado y si el seguimiento de la cobranza es suyo o de otro software. Solo lo que corrio respecto de fabrica; los bordes viven en panel/src/lib/facturacionDeFamilias.js.';

-- ---------------------------------------------------------------------------
-- 2. Quien tiene que pagar
--
-- No siempre es la Familia: puede ser una obra social o un tercero. La factura ya sabe a que
-- Familia corresponde; esto guarda a quien se le reclama, que puede ser otro.
-- ---------------------------------------------------------------------------

ALTER TABLE public.facturas_familia
  ADD COLUMN IF NOT EXISTS financiador_tipo text,
  ADD COLUMN IF NOT EXISTS financiador_nombre text;

ALTER TABLE public.facturas_familia
  DROP CONSTRAINT IF EXISTS facturas_familia_financiador_conocido;

ALTER TABLE public.facturas_familia
  ADD CONSTRAINT facturas_familia_financiador_conocido
  CHECK (financiador_tipo IS NULL
         OR financiador_tipo IN ('familia', 'obra_social', 'otro'));

COMMENT ON COLUMN public.facturas_familia.financiador_tipo IS
  'A quien se le reclama esta factura: familia, obra_social u otro. Vacio quiere decir que se le reclama a la Familia, que es lo corriente.';

COMMENT ON COLUMN public.facturas_familia.financiador_nombre IS
  'Como se llama quien paga, cuando no es la Familia. Texto, porque el padron de obras sociales cambia de pais en pais.';

-- ---------------------------------------------------------------------------
-- 3. La restriccion que informa otro software
--
-- Una fila por aviso, y se conservan todos: lo que hoy esta restringido es el ultimo aviso de esa
-- Familia. Se guarda quien lo mando para poder distinguir un aviso de afuera de uno que cargo una
-- persona, igual que con los cobros.
--
-- NO SE GUARDA NINGUN IMPORTE. El sistema no necesita saber cuanto se debe para mostrar que hay
-- una restriccion, y el importe es dato sensible.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restricciones_de_cobranza (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  familia_id uuid NOT NULL REFERENCES public.familias(id) ON DELETE CASCADE,
  restringida boolean NOT NULL,
  motivo text,
  origen text NOT NULL DEFAULT 'software_externo',
  informada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restricciones_de_cobranza_origen_conocido
    CHECK (origen IN ('software_externo', 'panel'))
);

COMMENT ON TABLE public.restricciones_de_cobranza IS
  'Los avisos de que a una Familia hay que ponerle alguna restriccion por falta de pago. Informacion, no decision: nada se corta ni se bloquea por esto.';

COMMENT ON COLUMN public.restricciones_de_cobranza.restringida IS
  'Verdadero abre la restriccion y falso la levanta. El estado de hoy es el aviso mas nuevo de esa Familia.';

COMMENT ON COLUMN public.restricciones_de_cobranza.motivo IS
  'Lo que dijo quien aviso, tal como lo dijo. Texto que no se interpreta.';

COMMENT ON COLUMN public.restricciones_de_cobranza.origen IS
  'De donde vino el aviso: del software de creditos y cobranzas de la Prestadora, o cargado a mano desde el Panel.';

CREATE INDEX IF NOT EXISTS idx_restricciones_de_cobranza_familia
  ON public.restricciones_de_cobranza (familia_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_restricciones_de_cobranza_prestadora
  ON public.restricciones_de_cobranza (prestadora_id);

ALTER TABLE public.restricciones_de_cobranza ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS panel_lee_restricciones_de_cobranza ON public.restricciones_de_cobranza;
CREATE POLICY panel_lee_restricciones_de_cobranza ON public.restricciones_de_cobranza
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

REVOKE ALL ON TABLE public.restricciones_de_cobranza FROM anon;
REVOKE ALL ON TABLE public.restricciones_de_cobranza FROM authenticated;
GRANT SELECT ON TABLE public.restricciones_de_cobranza TO authenticated;

-- La Prestadora de la fila sale de la Familia, no de quien escribe: asi un aviso no puede caer en
-- otra Prestadora ni por error ni a proposito.
CREATE OR REPLACE FUNCTION interno.prestadora_de_la_restriccion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, interno
AS $$
DECLARE
  v_prestadora uuid;
BEGIN
  SELECT prestadora_id INTO v_prestadora FROM public.familias WHERE id = NEW.familia_id;
  IF v_prestadora IS NULL THEN
    RAISE EXCEPTION 'La Familia del aviso no existe';
  END IF;
  NEW.prestadora_id := v_prestadora;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION interno.prestadora_de_la_restriccion() FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.prestadora_de_la_restriccion() FROM anon;
GRANT EXECUTE ON FUNCTION interno.prestadora_de_la_restriccion() TO authenticated;

DROP TRIGGER IF EXISTS trg_prestadora_de_la_restriccion ON public.restricciones_de_cobranza;
CREATE TRIGGER trg_prestadora_de_la_restriccion
  BEFORE INSERT ON public.restricciones_de_cobranza
  FOR EACH ROW EXECUTE FUNCTION interno.prestadora_de_la_restriccion();

-- Un aviso de restriccion toca el trato con una Familia: toda mano que lo escriba queda
-- registrada, igual que en los cobros.
DROP TRIGGER IF EXISTS trg_auditoria_soporte ON public.restricciones_de_cobranza;
CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.restricciones_de_cobranza
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_soporte_mutacion();

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facturas_familia'
      AND column_name = 'financiador_tipo'
  ) THEN
    RAISE EXCEPTION 'La factura quedo sin poder decir a quien se le reclama';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_prestadora_de_la_restriccion'
      AND tgrelid = 'public.restricciones_de_cobranza'::regclass
  ) THEN
    RAISE EXCEPTION 'Los avisos de restriccion quedaron sin resolver su Prestadora';
  END IF;

  RAISE NOTICE 'El seguimiento de la cobranza pasa a ser una decision de la Prestadora.';
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

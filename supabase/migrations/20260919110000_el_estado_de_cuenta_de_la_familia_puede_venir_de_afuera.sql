-- ---------------------------------------------------------------------------
-- El estado de cuenta de la Familia puede venir de afuera
--
-- QUE PASABA HASTA ACA. Cuando una Prestadora decide que el seguimiento de la cobranza es de otro
-- software, lo unico que entraba desde ese software era si a una Familia hay que ponerle alguna
-- restriccion. Ningun importe, ningun saldo. Eso dejaba ciega justamente a la Prestadora que llevo
-- la cobranza afuera: veia que a alguien le pusieron una restriccion y no podia saber cuanto debe
-- ni desde cuando.
--
-- QUE CAMBIA. El mismo software que avisa la restriccion puede ademas informar el estado de
-- cuenta: cuanto debe esa Familia, en que moneda, si esta atrasada y de cuando es ese dato.
-- Saber cuanto le deben y si estan atrasados es informacion que a la Prestadora le conviene tener
-- a la vista para trabajar.
--
-- LO QUE ESTO NO ES. No es facturacion y no es cobranza. Careonys no emite comprobantes, no
-- calcula impuestos, no reclama y no gestiona la mora: de eso se ocupa el software que la
-- Prestadora eligio. Aca solo se anota lo que ese software informo, tal como lo informo.
--
-- Y NO SE CALCULA NADA SOBRE ESTO. Lo que entra se guarda y se muestra. No se completa con lo que
-- este sistema tenga anotado, no se recalcula y no se compara contra nada: un numero que llega de
-- afuera y otro calculado aca son dos verdades para lo mismo, y eso es peor que no tener ninguna.
--
-- QUIEN LO VE. Por ahora, quien ya ve los saldos. Reservarlo a la administracion de la Prestadora
-- es el paso siguiente del plan y entra por el catalogo de permisos.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El estado de cuenta que informa el otro software
--
-- Una fila por aviso, y se conservan todos: el estado de hoy es el aviso mas nuevo de esa Familia.
-- Mismo criterio que las restricciones, y por el mismo motivo: un aviso que llega no borra el
-- anterior, porque despues hay que poder reconstruir que se supo y cuando.
--
-- EL IMPORTE VIAJA CON SU MONEDA, siempre. Un saldo sin moneda no quiere decir nada en un producto
-- que tiene que servir en mas de un pais.
--
-- Y EL SALDO PUEDE SER NEGATIVO. Una Familia que pago de mas tiene saldo a favor, y eso tambien es
-- estado de cuenta. Trabarlo obligaria al software de afuera a mentir para poder informar.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.estados_de_cuenta_externos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  familia_id uuid NOT NULL REFERENCES public.familias(id) ON DELETE CASCADE,
  saldo numeric(14, 2) NOT NULL,
  moneda text NOT NULL,
  atrasado boolean NOT NULL,
  dias_de_atraso integer,
  vencimiento_mas_antiguo date,
  fecha_del_estado date,
  numero_del_aviso text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estados_de_cuenta_externos_moneda_con_forma
    CHECK (moneda ~ '^[A-Z]{3}$'),
  CONSTRAINT estados_de_cuenta_externos_atraso_no_negativo
    CHECK (dias_de_atraso IS NULL OR dias_de_atraso >= 0)
);

COMMENT ON TABLE public.estados_de_cuenta_externos IS
  'Lo que el software de creditos y cobranzas de la Prestadora informo sobre la cuenta de una Familia. Informacion, no decision: nada se corta ni se bloquea por esto, y este sistema no lo recalcula.';

COMMENT ON COLUMN public.estados_de_cuenta_externos.saldo IS
  'Cuanto debe esa Familia segun quien lleva la cobranza. Negativo es saldo a favor. No se calcula aca: se guarda tal como llego.';

COMMENT ON COLUMN public.estados_de_cuenta_externos.moneda IS
  'En que moneda esta el saldo, en codigo de tres letras. Todo importe viaja con su moneda.';

COMMENT ON COLUMN public.estados_de_cuenta_externos.atrasado IS
  'Si quien lleva la cobranza considera que esa Familia esta atrasada. Lo decide el, no este sistema.';

COMMENT ON COLUMN public.estados_de_cuenta_externos.dias_de_atraso IS
  'Cuantos dias de atraso informo quien avisa. Vacio cuando no lo informa: no se deduce de ninguna fecha.';

COMMENT ON COLUMN public.estados_de_cuenta_externos.vencimiento_mas_antiguo IS
  'La fecha de vencimiento mas vieja que sigue impaga, si quien avisa la informa.';

COMMENT ON COLUMN public.estados_de_cuenta_externos.fecha_del_estado IS
  'A que dia corresponde esta foto de la cuenta. Es de quien avisa, no de cuando entro el aviso.';

COMMENT ON COLUMN public.estados_de_cuenta_externos.numero_del_aviso IS
  'Como numero el aviso quien lo mando. Sirve para no atender dos veces el mismo.';

CREATE INDEX IF NOT EXISTS idx_estados_de_cuenta_externos_familia
  ON public.estados_de_cuenta_externos (familia_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_estados_de_cuenta_externos_prestadora
  ON public.estados_de_cuenta_externos (prestadora_id);

-- Un aviso se atiende una sola vez. Mismo corte que en las restricciones: la firma lleva un
-- instante y se rechaza lo que llego tarde, pero adentro de esos minutos un aviso autentico
-- copiado se puede volver a mandar. Es por Prestadora a proposito: dos software distintos pueden
-- numerar igual y no tienen por que saberlo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_estados_de_cuenta_externos_aviso_unico
  ON public.estados_de_cuenta_externos (prestadora_id, numero_del_aviso)
  WHERE numero_del_aviso IS NOT NULL;

ALTER TABLE public.estados_de_cuenta_externos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS panel_lee_estados_de_cuenta_externos ON public.estados_de_cuenta_externos;
CREATE POLICY panel_lee_estados_de_cuenta_externos ON public.estados_de_cuenta_externos
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

REVOKE ALL ON TABLE public.estados_de_cuenta_externos FROM anon;
REVOKE ALL ON TABLE public.estados_de_cuenta_externos FROM authenticated;
GRANT SELECT ON TABLE public.estados_de_cuenta_externos TO authenticated;

-- La Prestadora de la fila sale de la Familia, no de quien escribe: asi un aviso no puede caer en
-- otra Prestadora ni por error ni a proposito. Calcada de la de las restricciones.
CREATE OR REPLACE FUNCTION interno.prestadora_del_estado_de_cuenta()
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

REVOKE ALL ON FUNCTION interno.prestadora_del_estado_de_cuenta() FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.prestadora_del_estado_de_cuenta() FROM anon;
GRANT EXECUTE ON FUNCTION interno.prestadora_del_estado_de_cuenta() TO authenticated;

DROP TRIGGER IF EXISTS trg_prestadora_del_estado_de_cuenta ON public.estados_de_cuenta_externos;
CREATE TRIGGER trg_prestadora_del_estado_de_cuenta
  BEFORE INSERT ON public.estados_de_cuenta_externos
  FOR EACH ROW EXECUTE FUNCTION interno.prestadora_del_estado_de_cuenta();

-- Un estado de cuenta toca el trato con una Familia y lleva importes: toda mano que lo escriba
-- queda registrada, igual que en los cobros y en las restricciones.
DROP TRIGGER IF EXISTS trg_auditoria_soporte ON public.estados_de_cuenta_externos;
CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.estados_de_cuenta_externos
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_soporte_mutacion();

-- ---------------------------------------------------------------------------
-- 2. El estado que rige hoy
--
-- De cada Familia vale el aviso mas nuevo. La resolucion vive aca y no en cada pantalla que lo
-- necesite, que es la misma razon por la que el saldo calculado vive en `saldos_familia`.
--
-- `security_invoker` para que la vista lea con los permisos de quien consulta y la politica de
-- la tabla siga valiendo: sin eso la vista mostraria las Familias de todas las Prestadoras.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.estado_de_cuenta_externo_vigente
WITH (security_invoker = true) AS
SELECT DISTINCT ON (e.familia_id)
  e.familia_id,
  e.prestadora_id,
  e.saldo,
  e.moneda,
  e.atrasado,
  e.dias_de_atraso,
  e.vencimiento_mas_antiguo,
  e.fecha_del_estado,
  e.numero_del_aviso,
  e.created_at AS informado_at
FROM public.estados_de_cuenta_externos e
ORDER BY e.familia_id, e.created_at DESC;

COMMENT ON VIEW public.estado_de_cuenta_externo_vigente IS
  'El ultimo estado de cuenta informado de cada Familia, que es el que rige. Los anteriores quedan guardados en estados_de_cuenta_externos.';

-- Una vista nace con todos los permisos que esta base le da por costumbre a quien inició sesión,
-- escritura incluida. Acá no se escribe por la vista: lo que entra, entra por la puerta firmada.
REVOKE ALL ON public.estado_de_cuenta_externo_vigente FROM anon;
REVOKE ALL ON public.estado_de_cuenta_externo_vigente FROM authenticated;
GRANT SELECT ON public.estado_de_cuenta_externo_vigente TO authenticated;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_prestadora_del_estado_de_cuenta'
      AND tgrelid = 'public.estados_de_cuenta_externos'::regclass
  ) THEN
    RAISE EXCEPTION 'Los estados de cuenta quedaron sin resolver su Prestadora';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'estados_de_cuenta_externos' AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Los estados de cuenta quedaron sin aislamiento entre Prestadoras';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'estados_de_cuenta_externos'
      AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'Los estados de cuenta quedaron al alcance de quien no inicio sesion';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('estados_de_cuenta_externos', 'estado_de_cuenta_externo_vigente')
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'El estado de cuenta quedo escribible desde el navegador';
  END IF;

  RAISE NOTICE 'El estado de cuenta de la Familia puede venir del software que lleva la cobranza.';
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

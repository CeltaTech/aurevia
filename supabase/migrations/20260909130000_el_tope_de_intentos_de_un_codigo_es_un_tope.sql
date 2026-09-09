-- ---------------------------------------------------------------------------------------
-- El tope de intentos de un código de un solo uso tiene que ser un tope (pendiente #177)
--
-- QUÉ ESTABA MAL. El motor leía cuántos intentos llevaba una fila, le sumaba uno y lo volvía a
-- escribir. Son dos viajes a la base, y entre uno y otro entra cualquier otro pedido: dos
-- intentos que llegan a la vez leen los dos el mismo número, escriben los dos el mismo número, y
-- de dos intentos queda contado uno. Con pedidos en paralelo el tope no se alcanza nunca, y seis
-- dígitos se prueban de a uno hasta acertar.
--
-- QUÉ HACE ESTA MIGRACIÓN. Deja la suma del lado de la base, en una sola sentencia. Un
-- `UPDATE ... SET codigo_intentos = codigo_intentos + 1 ... RETURNING codigo_intentos` es
-- atómico: cada llamada devuelve su propio número y ninguna pisa a la otra. El motor ya no lee
-- para escribir; pide el número y decide con lo que le contestan.
--
-- POR QUÉ UNA SOLA FUNCIÓN PARA LAS DOS TABLAS. La misma decisión está escrita una sola vez
-- («ningún patrón repetido sin punto único de verdad», CLAUDE.md de la empresa §8). La lista de
-- tablas está adentro, cerrada y escrita a mano: la función no arma consulta con lo que le pasan,
-- así que un nombre de tabla que venga de afuera no la lleva a ninguna parte.
--
-- POR QUÉ VIVE EN `public` Y NO EN `interno`. En `interno` van las funciones que usan las
-- políticas de RLS (CLAUDE.md del producto §6). Ésta no es una: la llama el motor por la API, y
-- `supabase/config.toml` publica únicamente `public` y `graphql_public`. Queda en `public` con el
-- permiso mínimo posible.
--
-- POR QUÉ NO ES `SECURITY DEFINER`. No necesita saltearse nada: la ejecuta el motor con la llave
-- de servicio, que ya alcanza las dos tablas. Dejándola con los permisos de quien la llama, la
-- protección por fila la sigue mirando, y no queda una función privilegiada nueva dando vueltas.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sumar_intento_de_codigo(p_tabla text, p_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intentos integer;
BEGIN
  IF p_tabla = 'instrucciones_acceso_circulo' THEN
    UPDATE public.instrucciones_acceso_circulo
       SET codigo_intentos = codigo_intentos + 1
     WHERE id = p_id
    RETURNING codigo_intentos INTO v_intentos;

  ELSIF p_tabla = 'guardia_comprobaciones' THEN
    UPDATE public.guardia_comprobaciones
       SET codigo_intentos = codigo_intentos + 1,
           updated_at = now()
     WHERE id = p_id
    RETURNING codigo_intentos INTO v_intentos;

  ELSE
    RAISE EXCEPTION 'sumar_intento_de_codigo: esa tabla no lleva cuenta de intentos';
  END IF;

  -- Si no se actualizó ninguna fila, `v_intentos` queda nulo. Se devuelve así a propósito: quien
  -- llama trata el nulo como "se agotaron", que es lo que corresponde cuando no se pudo contar.
  RETURN v_intentos;
END;
$$;

-- Supabase le da permiso de ejecución a todo el mundo sobre cualquier función nueva de `public`,
-- y `public` es además una dirección web. Se revoca todo y se devuelve nada más que al motor:
-- nadie sin sesión tiene que poder llamarla, y nadie con sesión tampoco —el único que cuenta
-- intentos es el motor, y un contador que pueda mover quien está probando códigos no sirve.
REVOKE ALL ON FUNCTION public.sumar_intento_de_codigo(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sumar_intento_de_codigo(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sumar_intento_de_codigo(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sumar_intento_de_codigo(text, uuid) TO service_role;

COMMENT ON FUNCTION public.sumar_intento_de_codigo(text, uuid) IS
  'Suma un intento a la fila indicada y devuelve cuántos van, en una sola sentencia. Existe porque leer y escribir por separado deja que dos intentos simultáneos cuenten como uno (pendiente #177).';

-- Las dos columnas cambian de significado con esta corrección, y el significado se escribe donde
-- vive el dato: la cuenta es del acto que se está abriendo, no del código de turno, y emitir un
-- código nuevo ya no la vuelve a cero.
COMMENT ON COLUMN public.instrucciones_acceso_circulo.codigo_intentos IS
  'Cuántas veces se probó un código contra esta instrucción. Es la cuenta del acto, no la del código: pedir un código nuevo no la vuelve a cero. Un código vencido no gasta intento, así que quien pide uno nuevo porque el anterior venció no pierde nada.';
COMMENT ON COLUMN public.guardia_comprobaciones.codigo_intentos IS
  'Cuántas veces se probó un código contra esta llegada o esta salida. Es la cuenta del acto, no la del código: soltar un código nuevo no la vuelve a cero. Agotada, queda el piso de siempre: se entra igual eligiendo un motivo.';

NOTIFY pgrst, 'reload schema';

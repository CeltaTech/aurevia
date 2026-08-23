-- Las funciones internas de la base no se llaman desde afuera
--
-- Las funciones que usan las políticas de RLS corren con los permisos de quien las escribió
-- (SECURITY DEFINER), o sea que no las frena ninguna política: ese es justamente su trabajo.
-- Pero el esquema public está publicado en PostgREST (supabase/config.toml), así que cada una
-- es además una dirección web: POST /rest/v1/rpc/<nombre>. Con permiso de ejecución para anon,
-- cualquiera con la clave pública —la que viaja adentro del Panel y de las dos aplicaciones—
-- las llama sin iniciar sesión y recibe datos de cualquier Prestadora.
--
-- Comprobado antes de escribir esto, contra la base local, con la clave pública y sin sesión:
--   rpc/moneda_de_prestadora                  -> HTTP 200, devolvió la moneda
--   rpc/modalidades_habilitadas_de_prestadora -> HTTP 200, devolvió las modalidades
--   rpc/permisos_efectivos_de                 -> HTTP 200, devolvió los permisos de un usuario
--                                                de otra Prestadora
-- mientras que la misma tabla pedida por la vía normal devolvía cero filas. La puerta estaba
-- cerrada y la ventana de al lado abierta.
--
-- La causa no fue un olvido puntual: 20260819160000_foto_de_la_base.sql declara, cerca del
-- final, que toda función nueva del esquema nazca con permiso para anon y authenticated. Desde
-- ese renglón, cada función creada por una migración posterior nace abierta. Por eso las cuatro
-- funciones de credenciales, escritas *antes* de ese renglón dentro del mismo archivo, quedaron
-- bien cerradas. Y por eso 20260819183000:102 creyó cerrar sembrar_configuracion_prestadora y
-- no la cerró: quitarle el permiso a PUBLIC no se lo quita a anon, que es una concesión aparte.
--
-- Esta migración hace las dos cosas: cierra lo que está abierto hoy, y arregla la regla que lo
-- vuelve a abrir mañana.

-- ---------------------------------------------------------------------------------------------
-- Por qué el permiso se reparte en dos grupos y no se revoca a todos por igual
--
-- Una política de RLS evalúa su expresión con los permisos de quien consulta. Si la expresión
-- llama a una función y ese usuario no tiene permiso de ejecución, la consulta no devuelve cero
-- filas: falla con "permission denied for function ...". O sea que revocarle el permiso a
-- authenticated sobre una función que usan las políticas deja al Panel sin poder leer sus
-- propias tablas. Comprobado: sin el permiso, guardias y pacientes fallan con ese error.
--
-- No pasa lo mismo con los disparadores. El permiso de un disparador se comprueba al crearlo, no
-- cada vez que se dispara: comprobado guardando una guardia con el permiso revocado, y el
-- disparador corrió igual.
--
-- Tampoco pasa con las llamadas anidadas. Cuando una función SECURITY DEFINER está corriendo, el
-- usuario en curso pasa a ser su dueño, así que todo lo que llame adentro se comprueba contra
-- postgres y no contra quien consultó.
--
-- De ahí el reparto:
--   Grupo A — las que aparecen en alguna política. Conservan authenticated, porque el Panel las
--             necesita para leer. Pierden anon: sin sesión no hay nada legítimo que leer.
--   Grupo B — todas las demás: disparadores, funciones que solo llama el motor con la llave de
--             servicio, y las que no llama nadie. Pierden anon y authenticated.
-- El motor conserva su permiso en los dos grupos: entra con la llave de servicio.
--
-- El grupo se calcula al aplicar la migración y no está escrito como lista a mano, para que
-- valga también en la nube, que puede no coincidir renglón por renglón con la base local
-- (CLAUDE.md §12: el estado real por encima del documentado).
--
-- Lo que este reparto NO cierra: un usuario con sesión válida de una Prestadora todavía puede
-- llamar por RPC las diez del grupo A con identificadores de otra. Es mucho menos que "cualquiera
-- desde internet", pero no es cero. El cierre completo es mudar estas funciones a un esquema que
-- PostgREST no publique; eso pide revisar una por una el search_path con que fueron escritas y
-- cuáles llama el motor por RPC, y va aparte.
-- ---------------------------------------------------------------------------------------------

DO $$
DECLARE
  fn record;
  expresiones text;
  -- Las que el navegador sí llama por RPC y por lo tanto conservan authenticated aunque no
  -- aparezcan en ninguna política. Hoy el Panel llama tres funciones y esta es la única de las
  -- tres que es SECURITY DEFINER; las otras dos corren con los permisos de quien consulta y no
  -- entran en esta migración. Queda escrita para que sumar una sea una decisión explícita.
  navegador_puede_llamar text[] := ARRAY['ausencias_que_tapan'];
BEGIN
  -- Todas las expresiones de todas las políticas, en un solo texto, para preguntarle a cada
  -- función si alguna la nombra.
  SELECT string_agg(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
                    coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), ' ')
    INTO expresiones
    FROM pg_policy pol;

  FOR fn IN
    SELECT p.oid::regprocedure AS firma,
           p.proname,
           (p.proname = ANY (navegador_puede_llamar)
            OR coalesce(expresiones, '') ~ ('\y' || p.proname || '\y')) AS necesita_sesion
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    IF fn.necesita_sesion THEN
      -- Grupo A: la usa una política, o la llama el navegador. Pierde anon, conserva la sesión.
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, "anon";', fn.firma);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO "authenticated";', fn.firma);
    ELSE
      -- Grupo B: no la llama nadie desde el navegador. Se cierra del todo.
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, "anon", "authenticated";', fn.firma);
    END IF;
    -- Explícito y no heredado: si en algún entorno el permiso del motor venía por PUBLIC, la
    -- revocación de arriba se lo habría sacado junto con el resto.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO "service_role";', fn.firma);
  END LOOP;
END $$;

-- Que la próxima función no nazca abierta.
--
-- Esto revierte el ALTER DEFAULT PRIVILEGES de la foto de la base, solo para funciones y solo
-- para PUBLIC y anon. Los permisos de tablas no se tocan: ahí el aislamiento lo pone la RLS, que
-- está en las 100.
--
-- authenticated se deja como está a propósito. Quitárselo por defecto obligaría a que cada
-- migración que crea una función de política se acuerde de otorgarlo, y olvidarse no daría un
-- error al aplicar la migración sino al consultar una tabla, meses después. El agujero que se
-- está cerrando acá es el de anon: sin sesión, ninguna función interna contesta.
--
-- Consecuencia para lo que se programe de acá en adelante: una función nueva que tenga que
-- contestarle a alguien sin sesión —hoy no hay ninguna— necesita su GRANT escrito a mano.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON FUNCTIONS FROM "anon";

NOTIFY pgrst, 'reload schema';

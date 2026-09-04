-- Las funciones internas salen del esquema publicado
--
-- Cierra lo que dejó abierto 20260823010000. Aquella migración le sacó el permiso a `anon`, así
-- que sin sesión ya no contesta ninguna; pero trece funciones tuvieron que conservar el permiso
-- de `authenticated`, porque las políticas de RLS evalúan su expresión con los permisos de quien
-- consulta y sin ese permiso el Panel no puede leer sus propias tablas. Y como el esquema
-- `public` está publicado en PostgREST (`supabase/config.toml:13`), conservar ese permiso las
-- deja siendo direcciones web: `POST /rest/v1/rpc/<nombre>` para cualquiera con cuenta.
--
-- Comprobado contra la base local antes de escribir esto, entrando como administradora de
-- Sandbox y pasándole identificadores de Cuidar del Sur: las trece contestaron 200, y tres de
-- ellas devolvieron identificadores de la otra Prestadora:
--   rpc/familia_id_de_usuario   -> la Familia de un usuario ajeno
--   rpc/guardias_del_paciente   -> las Guardias de un Paciente ajeno
--   rpc/pacientes_de_la_guardia -> los Pacientes de una Guardia ajena
-- No son datos de contenido —son identificadores—, pero son el mapa de quién está con quién, y
-- se leen sin pertenecer a esa Prestadora.
--
-- El arreglo es sacarlas del esquema publicado. Las políticas las siguen encontrando porque
-- guardan el identificador interno de la función, no su nombre: mudarla de esquema no las toca.
--
-- ---------------------------------------------------------------------------------------------
-- La revisión función por función, que es lo que pedía el pendiente
--
-- Las trece están escritas con `search_path = public`. Se revisó qué usa cada una sin calificar,
-- para saber si mudarla la deja sin encontrar algo:
--
--   asistente_atiende_a_la_familia  tablas guardia_pacientes, guardias, pacientes    -> se muda
--   coordinador_alcanza_guardia     tabla usuarios + zonas_de_asistente(), que queda -> se muda
--   current_tenant                  tablas sesiones_soporte_tecnico, usuarios        -> se muda
--   es_admin_prestadora             tabla usuarios                                   -> se muda
--   es_asistente                    tabla asistentes                                 -> se muda
--   es_superadmin                   tablas usuarios, configuracion_plataforma        -> se muda
--   familia_id_de_usuario           tablas familias, miembros_familia                -> se muda
--   gestiona_la_facturacion         es_superadmin(), que también se muda             -> se muda
--   guardias_del_paciente           tabla guardia_pacientes                          -> se muda
--   pacientes_de_la_guardia         tabla guardia_pacientes                          -> se muda
--   pacientes_de_la_serie           tabla series_guardias_pacientes                  -> se muda
--   tiene_permiso                   tiene_permiso_de(), que queda en public          -> se muda
--   ausencias_que_tapan             current_tenant(), es_admin_prestadora(),
--                                   es_superadmin(), todas mudadas                   -> QUEDA
--
-- Ninguna llama a nada de `auth` o `vault` sin calificar, y las tablas no se mueven: siguen en
-- `public`. Por eso a las mudadas les alcanza con `search_path = public, interno`, que es el que
-- tenían más el esquema nuevo para poder llamarse entre ellas.
--
-- **`ausencias_que_tapan` se queda a propósito**, y es la única. El Panel la llama por RPC
-- (`panel/src/pages/guardias/PanelCobertura.jsx:131`), así que sacarla del esquema publicado la
-- deja de contestar. Que se quede es seguro porque no recibe ningún identificador: sus dos
-- parámetros son fechas y la Prestadora la resuelve ella adentro con `current_tenant()`. Ésa es
-- la línea, y conviene que quede escrita: **una función se queda en `public` solamente si el
-- navegador la llama a propósito, y entonces no puede recibir un identificador que la apunte a
-- otra Prestadora.**
--
-- El motor no pierde nada: las once funciones que llama por RPC —credenciales, token de
-- WhatsApp, permisos efectivos, domicilios— son todas de las que ya no tenían permiso de
-- `authenticated`, y ninguna se muda.
-- ---------------------------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS "interno";
COMMENT ON SCHEMA "interno" IS
  'Funciones internas de la base: las que usan las políticas de RLS. Está fuera de la lista de '
  'esquemas publicados de supabase/config.toml a propósito, para que no sean direcciones web. '
  'Acá no van tablas ni datos.';

-- Sin USAGE sobre el esquema, una política que llame a una función de acá no devuelve cero filas:
-- falla. Se le da a los mismos roles que hoy lo tienen sobre `public` —incluido el de archivos,
-- porque las políticas de `storage.objects` de los logos llaman a `current_tenant()`—, y se
-- calcula en vez de escribirse a mano para que valga igual en la nube.
DO $$
DECLARE
  rol text;
BEGIN
  FOR rol IN
    SELECT rolname FROM pg_roles
     WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator',
                       'supabase_auth_admin', 'supabase_storage_admin')
       AND has_schema_privilege(rolname, 'public', 'USAGE')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA "interno" TO %I;', rol);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- La mudanza
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  -- Las doce revisadas arriba. Va escrita a mano, y no calculada como en 20260823010000, porque
  -- mudar de esquema es más que cambiar un permiso: lo que se muda tiene que ser exactamente lo
  -- que se leyó. Por eso abajo hay una comprobación que rompe la migración si la base no coincide
  -- con esta lista.
  a_mudar text[] := ARRAY[
    'asistente_atiende_a_la_familia', 'coordinador_alcanza_guardia', 'current_tenant',
    'es_admin_prestadora', 'es_asistente', 'es_superadmin', 'familia_id_de_usuario',
    'gestiona_la_facturacion', 'guardias_del_paciente', 'pacientes_de_la_guardia',
    'pacientes_de_la_serie', 'tiene_permiso'];
  -- La que el navegador llama y por eso se queda publicada.
  se_queda text[] := ARRAY['ausencias_que_tapan'];
  esperadas text[];
  encontradas text[];
  firmas text[];
  firma text;
BEGIN
  SELECT array_agg(x ORDER BY x) INTO esperadas FROM unnest(a_mudar || se_queda) AS x;

  SELECT coalesce(array_agg(DISTINCT p.proname ORDER BY p.proname), ARRAY[]::text[])
    INTO encontradas
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF encontradas IS DISTINCT FROM esperadas THEN
    RAISE EXCEPTION
      'La base no coincide con la revisión de esta migración. Alcanzables con sesión: %. Revisadas: %. '
      'Revisar la que sobra o falta antes de mudar nada.',
      array_to_string(encontradas, ', '), array_to_string(esperadas, ', ');
  END IF;

  -- Las firmas se materializan antes de tocar nada: el recorrido no puede ir leyendo pg_proc
  -- mientras se lo modifica.
  SELECT array_agg(p.oid::regprocedure::text)
    INTO firmas
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = ANY (a_mudar);

  FOREACH firma IN ARRAY firmas LOOP
    -- Los permisos se vuelven a declarar acá, todavía en `public`, porque van pegados a la
    -- función y viajan con ella. Es el mismo reparto que dejó 20260823010000, escrito de nuevo
    -- para no depender de que la nube lo tenga igual.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, "anon";', firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO "authenticated", "service_role";', firma);
    -- El search_path se cambia antes de la mudanza, mientras el nombre todavía dice `public`.
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, interno;', firma);
    EXECUTE format('ALTER FUNCTION %s SET SCHEMA "interno";', firma);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Las que se quedan en `public` y llaman a alguna de las mudadas
--
-- Una política guarda el identificador interno de la función y no se entera de la mudanza, pero
-- el cuerpo de una función guarda texto y se vuelve a resolver cada vez que corre. Así que
-- cualquier función que siga en `public` y llame a una mudada sin calificar necesita `interno` en
-- su search_path. Hoy son tres —`ausencias_que_tapan`, `asistente_asignado_a_familia` y el
-- disparador `fn_auditoria_soporte_mutacion`—, pero se busca en vez de escribirlas para que la
-- nube no dependa de que la lista esté completa.
--
-- Si aparece una sin search_path declarado, la migración se corta: ésa quedaría dependiendo del
-- search_path de quien la llame, y eso hay que mirarlo, no arreglarlo de oficio.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  mudadas text[];
  fn record;
  sin_declarar text[];
BEGIN
  SELECT array_agg(p.proname) INTO mudadas
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'interno';

  SELECT array_agg(p.oid::regprocedure::text) INTO sin_declarar
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proconfig IS NULL
     AND EXISTS (SELECT 1 FROM unnest(mudadas) m WHERE p.prosrc ~ ('\y' || m || '\y'));

  IF sin_declarar IS NOT NULL THEN
    RAISE EXCEPTION
      'Estas funciones de public llaman a una mudada y no declaran search_path: %. Revisarlas a mano.',
      array_to_string(sin_declarar, ', ');
  END IF;

  FOR fn IN
    SELECT p.oid::regprocedure::text AS firma,
           array_to_string(p.proconfig, ' ') AS config
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proconfig IS NOT NULL
       AND NOT (array_to_string(p.proconfig, ' ') ~ '\yinterno\y')
       AND EXISTS (SELECT 1 FROM unnest(mudadas) m WHERE p.prosrc ~ ('\y' || m || '\y'))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, interno;', fn.firma);
    RAISE NOTICE 'search_path ampliado a public, interno en %', fn.firma;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Que la próxima función de `interno` nazca con el permiso justo
--
-- En `public` esto se resolvió al revés: se revocó lo que venía de más y se dejó `authenticated`
-- como estaba, porque quitárselo por defecto haría que olvidar un GRANT rompiera una consulta
-- meses después. Acá se puede ser estricto sin ese riesgo, porque todo lo que vive en `interno`
-- es exactamente una función de política: se le niega a PUBLIC y a `anon`, y se le da a
-- `authenticated` y al motor, que es el reparto que tienen las doce que acaban de mudarse.
-- ---------------------------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "interno"
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "interno"
  REVOKE ALL ON FUNCTIONS FROM "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "interno"
  GRANT EXECUTE ON FUNCTIONS TO "authenticated", "service_role";

NOTIFY pgrst, 'reload schema';

-- La ficha dice quién verificó la matrícula y por qué medio
--
-- Cierra la mitad técnica del pendiente #107. La pregunta legal —si alcanza con mirar el
-- documento o hay que comprobar el número contra el registro del organismo— la contesta el
-- Desarrollador y no se toca acá.
--
-- ---------------------------------------------------------------------------------------------
-- QUÉ FALTABA, Y QUÉ NO
--
-- Guardado ya estaba todo. `matriculas_asistente` tiene desde el principio `verificada_por`,
-- `verificada_at`, `metodo_verificacion` y `nota_verificacion`, con dos restricciones que
-- sostienen la regla: el medio sólo puede ser uno de los valores del catálogo técnico, y las
-- tres cosas —quién, cuándo y cómo— van juntas o no va ninguna. La pantalla de verificación del
-- Panel ya pide el medio al verificar.
--
-- Lo que faltaba era leerlo. La ficha del Asistente mostraba solamente la fecha, porque quién
-- verificó es un identificador y el nombre vive en `usuarios`, y la única política de esa tabla
-- —`usuario_ve_su_propia_fila`— deja que cada persona lea su propia fila y ninguna otra. Con eso,
-- el Panel no podía poner un nombre al lado de la fecha, y una verificación sin nombre no sirve
-- para lo que el pendiente pide: saber quién dio por buena cada matrícula.
--
-- ---------------------------------------------------------------------------------------------
-- POR QUÉ UNA VISTA Y NO UNA POLÍTICA NUEVA SOBRE `usuarios`
--
-- Abrir `usuarios` a quien administra la Prestadora resolvería esto y, de paso, le daría acceso
-- al teléfono, a las zonas y al rol de todo su personal, en todas las pantallas a la vez. La
-- protección por fila es por fila, no por columna: no hay forma de abrir sólo el nombre.
--
-- Entonces se abre exactamente lo que hace falta y nada más: una vista que devuelve las
-- matrículas —con la protección por fila de `matriculas_asistente`, que no cambia— y agrega una
-- sola columna calculada con el nombre de quien verificó. Quien mira esa vista se entera del
-- nombre de la persona que verificó una matrícula que ya podía ver, y de nada más.
--
-- La función que resuelve el nombre se saltea la protección por fila de `usuarios`, así que va a
-- `interno`, que queda afuera de la lista de esquemas publicados
-- (`supabase/config.toml:13`): no es una dirección web, y la única manera de llegar a ella es a
-- través de esta vista. Además se le niega el alcance de `PUBLIC` y de `anon` en esta misma
-- migración, como manda la regla de la casa.
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------
-- El nombre de una persona, a partir de su identificador
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "interno"."nombre_de_usuario"("p_usuario_id" "uuid")
  RETURNS "text"
  LANGUAGE "sql" STABLE SECURITY DEFINER
  SET "search_path" TO 'public', 'interno'
AS $$
  SELECT u.nombre
    FROM public.usuarios u
   WHERE u.id = p_usuario_id;
$$;

ALTER FUNCTION "interno"."nombre_de_usuario"("uuid") OWNER TO "postgres";

-- Revocarle a PUBLIC no alcanza: el permiso de `anon` es una concesión aparte y se saca por
-- separado. `authenticated` lo conserva porque la vista se evalúa con los permisos de quien
-- consulta; sin ese permiso la consulta no devuelve cero filas, falla.
REVOKE ALL ON FUNCTION "interno"."nombre_de_usuario"("uuid") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "interno"."nombre_de_usuario"("uuid") TO "authenticated", "service_role";

COMMENT ON FUNCTION "interno"."nombre_de_usuario"("uuid") IS
  'El nombre visible de una persona, a partir de su identificador. Se saltea la protección por '
  'fila de usuarios, así que vive acá y no en un esquema publicado: sólo se llega a ella desde '
  'una vista, nunca desde afuera.';

-- ---------------------------------------------------------------------------------------------
-- Las matrículas, con la verificación resuelta
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE VIEW "public"."matriculas_asistente_verificacion"
  WITH ("security_invoker" = 'true') AS
SELECT
  m."id",
  m."asistente_id",
  m."tipo",
  m."numero_matricula",
  m."vigente_desde",
  m."vigente_hasta",
  m."archivo_url",
  m."registrado_por",
  m."created_at",
  m."verificada_at",
  m."verificada_por",
  m."metodo_verificacion",
  m."nota_verificacion",
  m."cargada_por_el_asistente",
  "interno"."nombre_de_usuario"(m."verificada_por") AS "verificada_por_nombre"
FROM "public"."matriculas_asistente" m;

ALTER VIEW "public"."matriculas_asistente_verificacion" OWNER TO "postgres";

-- Mínimo privilegio, y hay que pedirlo dos veces. Los privilegios por defecto del esquema
-- `public` le dan a `anon`, `authenticated` y `service_role` todos los permisos sobre cualquier
-- vista nueva, escritura incluida; una vista de una sola tabla con una columna calculada sigue
-- siendo actualizable, así que ese permiso no es decorativo. Se saca todo y se devuelve nada más
-- que la lectura: esta vista existe para leer, y para escribir está la tabla. Sin sesión no se
-- lee, así que `anon` no recibe nada.
REVOKE ALL ON TABLE "public"."matriculas_asistente_verificacion"
  FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT SELECT ON TABLE "public"."matriculas_asistente_verificacion" TO "authenticated", "service_role";

COMMENT ON VIEW "public"."matriculas_asistente_verificacion" IS
  'Las matrículas de los Asistentes con el nombre de quien las verificó ya resuelto. Se evalúa '
  'con los permisos de quien consulta, así que muestra exactamente las mismas filas que '
  'matriculas_asistente: lo único que agrega es el nombre. Para escribir se usa la tabla.';

COMMENT ON COLUMN "public"."matriculas_asistente_verificacion"."verificada_por_nombre" IS
  'Nombre de quien verificó la matrícula. Vacío cuando todavía no se verificó.';

-- ---------------------------------------------------------------------------------------------
-- Lo viejo queda como está, a propósito
--
-- Una matrícula verificada sin medio guardado se muestra con el medio en blanco, y la pantalla
-- dice que no quedó registrado cómo se comprobó. Eso es información válida —«no se sabe»—, y
-- completarla con una suposición sería justo lo contrario de lo que el pendiente #107 pide: la
-- lista de las que hay que volver a mirar el día que llegue la respuesta legal.
-- ---------------------------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

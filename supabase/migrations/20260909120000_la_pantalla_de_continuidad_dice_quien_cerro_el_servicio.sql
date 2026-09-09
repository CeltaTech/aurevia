-- La pantalla de Continuidad dice quién cerró el servicio
--
-- Mismo problema y misma forma de resolverlo que
-- `20260909100000_la_ficha_dice_quien_verifico_la_matricula_y_por_que_medio.sql`, esta vez en el
-- aviso de cierre de servicio.
--
-- ---------------------------------------------------------------------------------------------
-- QUÉ SE VEÍA, Y POR QUÉ
--
-- Cuando un Coordinador cierra el servicio de un Paciente queda un aviso en
-- `notificaciones_cierre_servicio` para que la Prestadora se entere. El aviso guarda quién lo
-- cerró, pero guarda su identificador, y el nombre vive en `usuarios`. La única política de esa
-- tabla —`usuario_ve_su_propia_fila`— deja que cada persona lea su propia fila y ninguna otra,
-- así que la consulta del Panel volvía vacía y la pantalla de Continuidad dibujaba un guión en
-- la columna «cerrado por».
--
-- Un guión ahí no es un dato faltante: el dato está guardado. Es la pantalla que no lo puede
-- leer. Y en una pantalla que existe para decidir a quién se manda a una casa donde faltó
-- alguien, saber quién tomó la decisión de cerrar el servicio es parte del asunto.
--
-- ---------------------------------------------------------------------------------------------
-- POR QUÉ UNA VISTA Y NO UNA POLÍTICA NUEVA SOBRE `usuarios`
--
-- Es la misma razón de la migración de las matrículas, y se repite acá porque es lo que hace que
-- esta forma de resolverlo se elija y no otra: la protección de `usuarios` es por fila y no por
-- columna. Abrirla para que se lea el nombre abriría también el teléfono, las zonas y el rol de
-- todo el personal, en todas las pantallas a la vez y para siempre.
--
-- Entonces se abre exactamente lo que hace falta y nada más: una vista que devuelve los avisos
-- —con la protección por fila de `notificaciones_cierre_servicio`, que no cambia— y agrega una
-- sola columna calculada con el nombre de quien cerró. Quien mira esta vista se entera del
-- nombre de la persona que cerró un servicio que ya podía ver, y de nada más.
--
-- La función que resuelve el nombre ya existe: `interno.nombre_de_usuario`, creada en la
-- migración de las matrículas, con sus permisos ya repartidos. Se reutiliza tal cual. Escribir
-- una segunda función que haga lo mismo sería justo lo que la regla del punto único de verdad
-- viene a evitar.
--
-- ---------------------------------------------------------------------------------------------
-- LA OTRA MITAD DEL MISMO PENDIENTE NO SE ARREGLA ACÁ
--
-- La pantalla de Configuración › Avisos también consultaba `usuarios` por su cuenta, pero no
-- para ponerle nombre a un identificador que ya tenía: para armar la lista de Coordinadores
-- entre los que se elige el de respaldo. Ahí no hay filas que la pantalla ya pudiera ver, así
-- que una vista con una columna de más no resuelve nada. Eso se arregla del lado del motor, que
-- ya devuelve esa misma lista en `/configuracion/permisos`, y no necesita esquema nuevo.
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------
-- Los avisos de cierre de servicio, con el nombre de quien cerró
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE VIEW "public"."notificaciones_cierre_servicio_quien_cerro"
  WITH ("security_invoker" = 'true') AS
SELECT
  n."id",
  n."prestadora_id",
  n."cierre_id",
  n."paciente_id",
  n."asistente_id",
  n."cerrado_por",
  n."motivo",
  n."motivo_detalle",
  n."created_at",
  n."visto_at",
  n."visto_por",
  "interno"."nombre_de_usuario"(n."cerrado_por") AS "cerrado_por_nombre"
FROM "public"."notificaciones_cierre_servicio" n;

ALTER VIEW "public"."notificaciones_cierre_servicio_quien_cerro" OWNER TO "postgres";

-- Mínimo privilegio, y hay que pedirlo dos veces. Los privilegios por defecto del esquema
-- `public` le dan a `anon`, `authenticated` y `service_role` todos los permisos sobre cualquier
-- vista nueva, escritura incluida; una vista de una sola tabla con una columna calculada sigue
-- siendo actualizable, así que ese permiso no es decorativo. Se saca todo y se devuelve nada más
-- que la lectura: esta vista existe para leer, y para marcar un aviso como visto está la tabla.
-- Sin sesión no se lee, así que `anon` no recibe nada.
REVOKE ALL ON TABLE "public"."notificaciones_cierre_servicio_quien_cerro"
  FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT SELECT ON TABLE "public"."notificaciones_cierre_servicio_quien_cerro" TO "authenticated", "service_role";

COMMENT ON VIEW "public"."notificaciones_cierre_servicio_quien_cerro" IS
  'Los avisos de cierre de servicio con el nombre de quien cerró ya resuelto. Se evalúa con los '
  'permisos de quien consulta, así que muestra exactamente las mismas filas que '
  'notificaciones_cierre_servicio: lo único que agrega es el nombre. Para escribir se usa la tabla.';

COMMENT ON COLUMN "public"."notificaciones_cierre_servicio_quien_cerro"."cerrado_por_nombre" IS
  'Nombre de quien cerró el servicio. Vacío si esa persona ya no está en el sistema.';

NOTIFY pgrst, 'reload schema';

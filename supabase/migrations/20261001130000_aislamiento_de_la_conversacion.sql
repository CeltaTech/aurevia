-- El aislamiento de la conversación lo sostiene la base, no la pantalla.
-- ==========================================================================================
--
-- QUÉ FALTABA, Y ES LO QUE ARREGLA ESTA MIGRACIÓN. El hilo entre una Familia y un Asistente
-- (`20260915140000_la_familia_y_el_asistente_se_hablan_por_adentro.sql`) guarda las tres cosas
-- —Prestadora, Familia, Asistente— y hasta hoy cada una se comprobaba por separado: la Familia
-- apuntaba a `familias(id)` y el Asistente a `asistentes(id)`, sin pedirle a ninguno de los dos
-- que fuera de la misma Prestadora que el hilo. Escrito así, un identificador equivocado alcanza
-- para armar un hilo entre una Familia de una Prestadora y un Asistente de otra: la base lo acepta
-- sin decir nada, y lo único que lo evita son los filtros de las rutas.
--
-- LA TÉCNICA NO ES NUEVA ACÁ. Careonys ya la usa en `guardias`, `lugares`, `servicios`,
-- `facturas_familia`, `pacientes`, `asistentes` y varias más: la tabla apuntada lleva
-- `UNIQUE (id, prestadora_id)` y quien la apunta lo hace con las dos columnas a la vez. Así la
-- pertenencia deja de ser un filtro que alguien puede olvidarse de escribir y pasa a ser algo que
-- la base no deja violar. Acá faltaba, no es que no se pudiera.
--
-- Y UNA SOLA FUNCIÓN DECIDE SI EL HILO ES PROPIO. Eran cuatro políticas con la misma condición
-- escrita cuatro veces —dos para la lista de hilos y dos para los mensajes, una por punta—, así
-- que corregir el criterio era corregirlo cuatro veces y equivocarse en una alcanzaba para abrir
-- un agujero. Ahora la pregunta vive una sola vez, en `interno.conversacion_marketplace_es_propia`,
-- y las dos políticas que quedan la consultan. Es el punto único de verdad aplicado a la RLS
-- (`celtatech/CLAUDE.md` §5).
--
-- LA FUNCIÓN VA A `interno` Y CONSERVA `authenticated`. A `interno` porque la llaman las políticas
-- y nadie desde el navegador, y ese esquema queda afuera de los publicados
-- (`productos/careonys/CLAUDE.md` §6). Y conserva `authenticated` porque una política evalúa su
-- expresión con los permisos de quien consulta: quitarle ese permiso no devolvería cero filas,
-- fallaría, y dejaría a las dos aplicaciones sin poder leer sus propios mensajes.
--
-- FALLA CERRADA. Quien no es ni la Familia ni el Asistente del hilo no resuelve ninguna de las dos
-- comparaciones: sin ficha, la comparación da desconocido, nunca verdadero. La Prestadora sale de
-- `interno.current_tenant()`, que la resuelve por la cuenta con la que se entró, nunca por un valor
-- que venga en el pedido.
--
-- LA PRESTADORA SIGUE SIN LEER LO QUE SE HABLAN. No aparece ninguna política para ella, igual que
-- antes: recluta, admite, gerencia y configura, y no ve el contenido. Y tampoco hay política de
-- escritura: escribe el motor, que es el único que sabe de qué lado salió cada mensaje.

-- ---------------------------------------------------------------------------
-- 1. Las dos puntas del hilo tienen que ser de la misma Prestadora
-- ---------------------------------------------------------------------------

-- Las llaves de una sola columna se van: dicen menos que las que las reemplazan y dejarlas sería
-- pedir dos veces lo mismo.
ALTER TABLE public.conversaciones_marketplace
  DROP CONSTRAINT IF EXISTS conversaciones_marketplace_familia_id_fkey,
  DROP CONSTRAINT IF EXISTS conversaciones_marketplace_asistente_id_fkey;

ALTER TABLE public.conversaciones_marketplace
  ADD CONSTRAINT conversaciones_mkt_familia_prestadora_fk
    FOREIGN KEY (familia_id, prestadora_id)
    REFERENCES public.familias (id, prestadora_id),
  ADD CONSTRAINT conversaciones_mkt_asistente_prestadora_fk
    FOREIGN KEY (asistente_id, prestadora_id)
    REFERENCES public.asistentes (id, prestadora_id);

-- Para que los mensajes puedan apuntar al hilo con las dos columnas, el hilo tiene que ofrecer las
-- dos como llave.
ALTER TABLE public.conversaciones_marketplace
  DROP CONSTRAINT IF EXISTS conversaciones_mkt_id_prestadora_unico;
ALTER TABLE public.conversaciones_marketplace
  ADD CONSTRAINT conversaciones_mkt_id_prestadora_unico UNIQUE (id, prestadora_id);

-- Un mensaje con la Prestadora de un hilo y el identificador de otro es un mensaje que aparece en
-- la Prestadora equivocada. Con las dos columnas, no entra.
ALTER TABLE public.mensajes_marketplace
  DROP CONSTRAINT IF EXISTS mensajes_marketplace_conversacion_id_fkey;
ALTER TABLE public.mensajes_marketplace
  ADD CONSTRAINT mensajes_mkt_conversacion_prestadora_fk
    FOREIGN KEY (conversacion_id, prestadora_id)
    REFERENCES public.conversaciones_marketplace (id, prestadora_id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT conversaciones_mkt_familia_prestadora_fk ON public.conversaciones_marketplace IS
  'La Familia del hilo es de la misma Prestadora que el hilo. Con las dos columnas, un hilo entre dos Prestadoras no se puede guardar.';
COMMENT ON CONSTRAINT conversaciones_mkt_asistente_prestadora_fk ON public.conversaciones_marketplace IS
  'El Asistente del hilo es de la misma Prestadora que el hilo.';

-- ---------------------------------------------------------------------------
-- 2. Una sola función decide si el hilo es propio
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION interno.conversacion_marketplace_es_propia(p_conversacion_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'interno'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM conversaciones_marketplace c
     WHERE c.id = p_conversacion_id
       -- Primero la Prestadora, que sale de la cuenta con la que se entró y de ningún otro lado.
       AND c.prestadora_id = interno.current_tenant()
       -- Y después una de las dos puntas. Quien no es ninguna de las dos no resuelve nada:
       -- comparar contra una ficha que no existe da desconocido, y desconocido no deja pasar.
       AND (
            c.familia_id = interno.familia_id_de_usuario(auth.uid())
         OR c.asistente_id = interno.asistente_de_la_sesion()
       )
  )
$$;

COMMENT ON FUNCTION interno.conversacion_marketplace_es_propia(uuid) IS
  'Si el hilo del Marketplace es de quien esta consultando: de su Prestadora, y con el como una de las dos puntas. Lo consultan las politicas de conversaciones_marketplace y de mensajes_marketplace, y es el unico lugar donde esa pregunta esta escrita.';

-- La llaman las políticas, así que conserva `authenticated`. Lo que se saca es lo que sobra: el
-- permiso general y el anónimo.
REVOKE ALL ON FUNCTION interno.conversacion_marketplace_es_propia(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.conversacion_marketplace_es_propia(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION interno.conversacion_marketplace_es_propia(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION interno.conversacion_marketplace_es_propia(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Las cuatro políticas pasan a ser dos, y las dos preguntan lo mismo
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS familia_ve_sus_conversaciones ON public.conversaciones_marketplace;
DROP POLICY IF EXISTS asistente_ve_sus_conversaciones ON public.conversaciones_marketplace;

CREATE POLICY el_hilo_propio_se_lee
  ON public.conversaciones_marketplace
  FOR SELECT TO authenticated
  USING (interno.conversacion_marketplace_es_propia(id));

DROP POLICY IF EXISTS familia_ve_los_mensajes_de_sus_conversaciones ON public.mensajes_marketplace;
DROP POLICY IF EXISTS asistente_ve_los_mensajes_de_sus_conversaciones ON public.mensajes_marketplace;

CREATE POLICY los_mensajes_del_hilo_propio_se_leen
  ON public.mensajes_marketplace
  FOR SELECT TO authenticated
  USING (interno.conversacion_marketplace_es_propia(conversacion_id));

-- El permiso de tabla no es la RLS, y estas dos tablas ya lo tenían acotado a `SELECT` para quien
-- tiene sesión. Se repite para que la migración deje el estado completo aunque cambie el de atrás.
REVOKE ALL ON TABLE public.conversaciones_marketplace FROM anon;
REVOKE ALL ON TABLE public.mensajes_marketplace FROM anon;
REVOKE ALL ON TABLE public.conversaciones_marketplace FROM authenticated;
REVOKE ALL ON TABLE public.mensajes_marketplace FROM authenticated;
GRANT SELECT ON TABLE public.conversaciones_marketplace TO authenticated;
GRANT SELECT ON TABLE public.mensajes_marketplace TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Hasta dónde llega quien coordina se resuelve cruzando lugares, y ya no comparando textos.
--
-- QUÉ ESTABA PASANDO. Dieciséis políticas preguntaban lo mismo: `u.zonas && a.zonas`, dos listas
-- de palabras escritas a mano. Si quien cargó la ficha de la Asistente escribió «Vte. López» y
-- quien cargó la de la coordinadora escribió «Vicente López», las dos puntas nombran el mismo
-- lugar y la base contesta que no se tocan. Nadie se entera mirando la pantalla: la coordinadora
-- simplemente no ve a esa persona, y no hay ningún error que leer.
--
-- QUÉ PASA AHORA. Las dos puntas guardan cuál lugar —el mismo identificador de la lista de la
-- Prestadora— en `usuario_lugares` y `asistente_lugares`. Una coincidencia es una coincidencia de
-- verdad.
--
-- Y LA MISMA DECISIÓN QUEDA EN UN SOLO LUGAR. La condición estaba copiada dieciséis veces, cada
-- copia con su propio `JOIN` hasta llegar al Asistente. Ahora hay una función,
-- `interno.coordinador_alcanza_asistente`, y cada política sólo dice a qué Asistente se refiere
-- su tabla. Corregir el alcance vuelve a ser corregir un renglón.
--
-- LO QUE NO SE CONVIERTE. Las zonas escritas a mano no se pasan a lugares. Casarlas por parecido
-- crearía una coincidencia que nadie decidió, que es exactamente lo que este trabajo viene a
-- terminar. Dónde acepta trabajar cada persona se vuelve a elegir de la lista, en su ficha. Lo
-- cargado hoy son datos inventados de las Organizaciones de prueba.
--
-- QUÉ SE RETIRA. `asistentes.zonas`, `usuarios.zonas` y `public.zonas_de_asistente`. Ninguna
-- pantalla y ninguna política las lee.
-- `postulaciones.zonas` y `postulaciones.domicilio` se quedan: eso lo escribió quien se postuló
-- desde el sitio público, que no tiene ninguna lista de la cual elegir, y es lo que esa persona
-- dijo.

-- ---------------------------------------------------------------------------
-- 1. La pregunta, escrita una sola vez
-- ---------------------------------------------------------------------------
--
-- Falla cerrado: sin lugares cargados de un lado o del otro no hay cruce, y la respuesta es que
-- no alcanza. Una ficha a la que le falta el dato no es una ficha que alcance a todo el mundo.

CREATE OR REPLACE FUNCTION interno.coordinador_alcanza_asistente(p_asistente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, interno
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM usuarios u
    JOIN usuario_lugares ul ON ul.usuario_id = u.id
    JOIN asistente_lugares al ON al.lugar_id = ul.lugar_id
    WHERE u.id = auth.uid()
      AND u.rol = 'coordinador'
      AND al.asistente_id = p_asistente_id
  );
$$;

COMMENT ON FUNCTION interno.coordinador_alcanza_asistente(uuid) IS
  'Si quien esta mirando coordina alguno de los lugares donde ese Asistente acepta trabajar.';

-- La llaman las políticas, así que conserva `authenticated`: quitarle ese permiso no devolvería
-- cero filas, fallaría, y dejaría al Panel sin poder leer sus propias tablas.
REVOKE ALL ON FUNCTION interno.coordinador_alcanza_asistente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.coordinador_alcanza_asistente(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION interno.coordinador_alcanza_asistente(uuid) TO authenticated;

-- La de la guardia pasa a apoyarse en la de arriba. Sigue contestando que sí cuando la guardia no
-- tiene Asistente puesto: ahí no hay a quién alcanzar, y quien coordina tiene que poder verla para
-- ponerle a alguien.
CREATE OR REPLACE FUNCTION interno.coordinador_alcanza_guardia(p_asistente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, interno
AS $$
  SELECT p_asistente_id IS NULL
      OR interno.coordinador_alcanza_asistente(p_asistente_id);
$$;

-- ---------------------------------------------------------------------------
-- 2. Las políticas que comparaban textos
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS coordinador_lee_asistentes_de_su_zona ON public.asistentes;
CREATE POLICY coordinador_lee_asistentes_de_su_zona ON public.asistentes
  FOR SELECT TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.coordinador_alcanza_asistente(id)
  );

DROP POLICY IF EXISTS coordinador_edita_asistentes_de_su_zona ON public.asistentes;
CREATE POLICY coordinador_edita_asistentes_de_su_zona ON public.asistentes
  FOR UPDATE TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.coordinador_alcanza_asistente(id)
    AND interno.tiene_permiso('editar_identidad_asistente')
  );

DROP POLICY IF EXISTS coordinador_gestiona_ausencias_de_su_zona ON public.ausencias;
CREATE POLICY coordinador_gestiona_ausencias_de_su_zona ON public.ausencias
  FOR ALL TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.coordinador_alcanza_asistente(asistente_id)
  );

DROP POLICY IF EXISTS coordinador_gestiona_certificados_de_su_zona ON public.certificados;
CREATE POLICY coordinador_gestiona_certificados_de_su_zona ON public.certificados
  FOR ALL TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.coordinador_alcanza_asistente(asistente_id)
  );

DROP POLICY IF EXISTS coordinador_lee_documentos_asistente_de_su_zona ON public.documentos_asistente;
CREATE POLICY coordinador_lee_documentos_asistente_de_su_zona ON public.documentos_asistente
  FOR SELECT TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.coordinador_alcanza_asistente(asistente_id)
  );

DROP POLICY IF EXISTS coordinador_conversa_mensajes_asistente_de_su_zona ON public.mensajes_asistente;
CREATE POLICY coordinador_conversa_mensajes_asistente_de_su_zona ON public.mensajes_asistente
  FOR ALL TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.coordinador_alcanza_asistente(asistente_id)
  )
  WITH CHECK (
    usuario_id = auth.uid()
    AND prestadora_id = interno.current_tenant()
    AND interno.coordinador_alcanza_asistente(asistente_id)
  );

DROP POLICY IF EXISTS coordinador_ve_notificaciones_cierre_servicio_de_su_zona ON public.notificaciones_cierre_servicio;
CREATE POLICY coordinador_ve_notificaciones_cierre_servicio_de_su_zona ON public.notificaciones_cierre_servicio
  FOR ALL TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.coordinador_alcanza_asistente(asistente_id)
  );

-- La cobertura mira a quien reemplaza, que es de quien se ocupa quien coordina.
DROP POLICY IF EXISTS coordinador_gestiona_guardias_cobertura_de_su_zona ON public.guardias_cobertura;
CREATE POLICY coordinador_gestiona_guardias_cobertura_de_su_zona ON public.guardias_cobertura
  FOR ALL TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.coordinador_alcanza_asistente(asistente_sustituto_id)
  );

-- Esta no filtra por su propia Prestadora sino por la del Asistente, y así estaba: la fila de una
-- verificación pertenece a la Organización de la persona verificada.
DROP POLICY IF EXISTS coordinador_gestiona_verificaciones_de_su_zona ON public.verificaciones_asistente;
CREATE POLICY coordinador_gestiona_verificaciones_de_su_zona ON public.verificaciones_asistente
  FOR ALL TO authenticated
  USING (
    interno.coordinador_alcanza_asistente(asistente_id)
    AND EXISTS (
      SELECT 1 FROM asistentes a
      WHERE a.id = verificaciones_asistente.asistente_id
        AND a.prestadora_id = interno.current_tenant()
    )
  );

-- Las que llegan al Asistente pasando por la guardia.
DROP POLICY IF EXISTS coordinador_gestiona_alertas_tempranas_guardia_de_su_zona ON public.alertas_tempranas_guardia;
CREATE POLICY coordinador_gestiona_alertas_tempranas_guardia_de_su_zona ON public.alertas_tempranas_guardia
  FOR ALL TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM guardias g
      WHERE g.id = alertas_tempranas_guardia.guardia_id
        AND interno.coordinador_alcanza_asistente(g.asistente_id)
    )
  );

DROP POLICY IF EXISTS coordinador_lee_descansos_de_su_zona ON public.descansos_guardia;
CREATE POLICY coordinador_lee_descansos_de_su_zona ON public.descansos_guardia
  FOR SELECT TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM guardias g
      WHERE g.id = descansos_guardia.guardia_id
        AND interno.coordinador_alcanza_asistente(g.asistente_id)
    )
  );

DROP POLICY IF EXISTS coordinador_lee_emergencias_de_su_zona ON public.emergencias_guardia;
CREATE POLICY coordinador_lee_emergencias_de_su_zona ON public.emergencias_guardia
  FOR SELECT TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM guardias g
      WHERE g.id = emergencias_guardia.guardia_id
        AND interno.coordinador_alcanza_asistente(g.asistente_id)
    )
  );

DROP POLICY IF EXISTS coordinador_gestiona_guardias_tracking_gps_de_su_zona ON public.guardias_tracking_gps;
CREATE POLICY coordinador_gestiona_guardias_tracking_gps_de_su_zona ON public.guardias_tracking_gps
  FOR ALL TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM guardias g
      WHERE g.id = guardias_tracking_gps.guardia_id
        AND interno.coordinador_alcanza_asistente(g.asistente_id)
    )
  );

DROP POLICY IF EXISTS coordinador_gestiona_reportes_de_su_zona ON public.reportes;
CREATE POLICY coordinador_gestiona_reportes_de_su_zona ON public.reportes
  FOR ALL TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM guardias g
      WHERE g.id = reportes.guardia_id
        AND interno.coordinador_alcanza_asistente(g.asistente_id)
    )
  );

-- El relevo tiene dos guardias, y alcanza con coordinar a cualquiera de las dos personas: el
-- incidente es de las dos.
DROP POLICY IF EXISTS coordinador_gestiona_incidentes_relevo_de_su_zona ON public.incidentes_relevo;
CREATE POLICY coordinador_gestiona_incidentes_relevo_de_su_zona ON public.incidentes_relevo
  FOR ALL TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND (
      EXISTS (
        SELECT 1 FROM guardias ge
        WHERE ge.id = incidentes_relevo.guardia_entrante_id
          AND interno.coordinador_alcanza_asistente(ge.asistente_id)
      )
      OR EXISTS (
        SELECT 1 FROM guardias gs
        WHERE gs.id = incidentes_relevo.guardia_saliente_id
          AND interno.coordinador_alcanza_asistente(gs.asistente_id)
      )
    )
  );

-- El informe es del Paciente, y se llega al Asistente por las guardias que ese Paciente tuvo.
DROP POLICY IF EXISTS coordinador_gestiona_informes_obra_social_de_su_zona ON public.informes_obra_social;
CREATE POLICY coordinador_gestiona_informes_obra_social_de_su_zona ON public.informes_obra_social
  FOR ALL TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM guardias g
      WHERE g.id IN (SELECT interno.guardias_del_paciente(informes_obra_social.paciente_id))
        AND interno.coordinador_alcanza_asistente(g.asistente_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Lo que ya no lee nadie
-- ---------------------------------------------------------------------------
--
-- La vista que ve quien coordina se vuelve a crear sin el renglón de las zonas. Dónde acepta
-- trabajar esa persona sale de su lista de lugares, que se lee aparte.

DROP VIEW IF EXISTS public.asistentes_coordinador;
CREATE VIEW public.asistentes_coordinador
WITH (security_invoker = true) AS
  SELECT id, nombre, telefono, email, foto_url, especialidades, disponibilidad, estado,
         qr_token, fecha_alta, created_at, updated_at, deleted_at, dni, tipo_asistente_id
  FROM public.asistentes;

-- Vuelve con menos permisos de los que tenía: la versión anterior la alcanzaba también quien no
-- inició sesión. La protección por fila le contestaba vacío, pero un permiso que no hace falta no
-- se conserva porque estaba.
GRANT SELECT ON public.asistentes_coordinador TO authenticated;
GRANT ALL ON public.asistentes_coordinador TO service_role;

COMMENT ON VIEW public.asistentes_coordinador IS
  'Lo que quien coordina ve de una Asistente: sin vinculo laboral y sin remuneraciones.';

DROP FUNCTION IF EXISTS public.zonas_de_asistente(uuid);

ALTER TABLE public.asistentes DROP COLUMN IF EXISTS zonas;
ALTER TABLE public.usuarios DROP COLUMN IF EXISTS zonas;

-- EL RENGLÓN ENTERO DEL DOMICILIO SE QUEDA POR AHORA. Está partido en calle, número, piso, unidad
-- y lugar desde el cambio anterior, pero las dos aplicaciones de teléfono siguen mostrando el
-- renglón armado, y las pantallas que cargan una ficha lo siguen escribiendo al lado de las partes.
-- Se retira cuando esas pantallas dejen de pedirlo, y esas pantallas no se tocan hasta que llegue
-- la maqueta. Sacarlo hoy dejaría sin domicilio a quien va a la casa.

NOTIFY pgrst, 'reload schema';

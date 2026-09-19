-- ---------------------------------------------------------------------------
-- Leer y escribir la configuración son dos cosas distintas, y lo decide la base
-- ---------------------------------------------------------------------------
--
-- QUÉ PASABA. La regla de quién puede tocar la configuración y los catálogos de una Prestadora
-- vivía sólo en la pantalla: el motor entra con la llave de servicio, así que el corte lo ponían
-- `requiereRolPanel` y `exigirAdministracion` en cada ruta. Del lado de la base quedaban tres
-- formas de lo mismo, y ninguna servía:
--
--   · Tablas de configuración con una sola política de lectura y ninguna de escritura. Nadie con
--     sesión puede escribirlas, así que la única defensa real es la pantalla; el día que el Panel
--     escriba una de esas tablas desde el navegador, rebota sin que nada lo hubiera anticipado.
--   · El catálogo de Lugares —`lugares`, `zona_lugares`, `usuario_lugares`, `asistente_lugares`—
--     en la misma situación, y el Panel sí lo consulta desde el navegador.
--   · Y al revés: `referencias_laborales_asistente` tenía una sola política, `ALL`, con la única
--     condición de pertenecer a la Prestadora. Cualquiera con sesión —un Asistente, alguien de una
--     Familia— podía cargar, corregir y borrar las referencias laborales de cualquier Asistente de
--     su Prestadora, que además son datos sensibles del cuidado. La pantalla no lo dejaba; la base
--     sí. Lo mismo, con otro disfraz, en `tipos_documento_pagador` y `textos_consentimiento_pagador`,
--     cuya escritura colgaba de un permiso operativo —registrar el consentimiento de un Pagador—
--     y no de ser personal de la Prestadora: quien podía registrar un consentimiento podía además
--     reescribir el catálogo y el texto con el que se firma.
--
-- QUÉ QUEDA.
--
--   · Los catálogos y la configuración los **lee** cualquiera de esa Prestadora.
--   · Los **escribe** el personal de la Prestadora, y nadie más.
--   · Lo que es de cada Asistente lo escribe además el dueño de esa ficha, y nadie más.
--
-- Y un corte más, que no es del paso pero aparece acá: lo que lleva dato sensible no se lee
-- igual que un catálogo. `configuracion_facturacion_familias` guarda las referencias a los
-- secretos de las dos puertas firmadas, y `restricciones_de_cobranza` dice qué Familia está
-- restringida y por qué. Las dos se leían con sólo pertenecer a la Prestadora, así que un
-- Asistente o una Familia las alcanzaban. Pasan a la administración, que es donde el producto ya
-- puso el estado de cuenta.
--
-- PUNTO ÚNICO DE VERDAD. La misma condición estaba copiada política por política. Quedan cinco
-- funciones en `interno` que todas consumen, y `interno.gestiona_la_facturacion` —que repetía la
-- comprobación del personal con otro nombre— pasa a llamar a la que manda.
--
-- FALLA CERRADO. Si la Prestadora no se resuelve, o la fila no trae la suya, o el rol no es
-- ninguno de los conocidos, la respuesta es negar. Nunca una comparación contra un valor vacío
-- decide un permiso.
--
-- EL PERMISO DE TABLA NO ES LA RLS. Una política perfecta sobre una tabla sin `GRANT` no protege:
-- bloquea, con `42501 permission denied` y sesión válida. Las tablas que estrenan política de
-- escritura reciben acá el permiso que esa política necesita, y nada más. Y al revés: las tablas
-- de configuración y catálogo arrastraban de la instalación el permiso completo para `anon` y
-- para `authenticated`, `TRUNCATE` incluido —y `TRUNCATE` no pasa por la protección por fila—.
-- Se les quita.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Las cinco funciones que todas las políticas consumen
-- ---------------------------------------------------------------------------
-- Viven en `interno`, que queda afuera de la lista `schemas` de `supabase/config.toml`, así que no
-- son direcciones web. Las llaman las políticas, y por eso conservan `authenticated`: quitarles
-- ese permiso no devuelve cero filas, falla, y deja la aplicación sin poder leer sus propias
-- tablas.

-- Quién es personal de la Prestadora en curso: quien entra al Panel. Los tres roles de Panel y
-- ninguno más. El superadmin llega acá únicamente dentro de una sesión de soporte, porque la
-- Prestadora se la da `interno.current_tenant()`.
CREATE OR REPLACE FUNCTION interno.es_personal_de_la_prestadora()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, interno
AS $$
  SELECT interno.es_superadmin() OR EXISTS (
    SELECT 1 FROM usuarios u
     WHERE u.id = auth.uid()
       AND u.rol IN ('admin_prestadora', 'coordinador')
  );
$$;

COMMENT ON FUNCTION interno.es_personal_de_la_prestadora() IS
  'Verdadero cuando la sesión es de alguien del Panel de la Prestadora en curso. Punto único de verdad de «el personal de la Prestadora».';

-- La misma comprobación estaba escrita aparte con nombre de facturación. Queda el nombre, porque
-- lo citan políticas que ya están, y el cuerpo pasa a ser uno solo.
CREATE OR REPLACE FUNCTION interno.gestiona_la_facturacion()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, interno
AS $$
  SELECT interno.es_personal_de_la_prestadora();
$$;

-- La fila es de la Prestadora en la que está parada la sesión. Falla cerrado por los dos lados:
-- una fila sin Prestadora y una sesión sin Prestadora resuelta dan falso.
CREATE OR REPLACE FUNCTION interno.lee_la_configuracion(p_prestadora uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, interno
AS $$
  SELECT p_prestadora IS NOT NULL
     AND interno.current_tenant() IS NOT NULL
     AND p_prestadora = interno.current_tenant();
$$;

COMMENT ON FUNCTION interno.lee_la_configuracion(uuid) IS
  'Lectura de catálogo y configuración: la fila es de la Prestadora en la que está parada la sesión. Niega si falta cualquiera de las dos.';

-- Quien escribe un catálogo: el personal de la Prestadora, sobre lo suyo.
CREATE OR REPLACE FUNCTION interno.escribe_el_catalogo(p_prestadora uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, interno
AS $$
  SELECT interno.lee_la_configuracion(p_prestadora)
     AND interno.es_personal_de_la_prestadora();
$$;

COMMENT ON FUNCTION interno.escribe_el_catalogo(uuid) IS
  'Escritura de catálogo: el personal de la Prestadora, sobre filas de su propia Prestadora.';

-- Y quien escribe la configuración de la empresa: la administración. Es lo que la pantalla de
-- Configuración admite —Coordinador no entra ahí—, y acá deja de depender de la pantalla.
CREATE OR REPLACE FUNCTION interno.es_la_administracion_de_la_prestadora(p_prestadora uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, interno
AS $$
  SELECT interno.lee_la_configuracion(p_prestadora)
     AND (interno.es_superadmin() OR interno.es_admin_prestadora());
$$;

COMMENT ON FUNCTION interno.es_la_administracion_de_la_prestadora(uuid) IS
  'La administración de la Prestadora sobre lo suyo: Admin_prestadora, o Superadmin dentro de una sesión de soporte.';

-- Y el dueño de la ficha. `interno.asistente_de_la_sesion()` ya resuelve la Prestadora adentro,
-- así que acá alcanza con que el identificador exista y coincida.
CREATE OR REPLACE FUNCTION interno.es_su_propia_ficha_de_asistente(p_asistente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, interno
AS $$
  SELECT p_asistente_id IS NOT NULL
     AND p_asistente_id = interno.asistente_de_la_sesion();
$$;

COMMENT ON FUNCTION interno.es_su_propia_ficha_de_asistente(uuid) IS
  'Verdadero cuando esa ficha de Asistente es la de quien tiene la sesión. Punto único de verdad de «el dueño de su propio legajo».';

REVOKE ALL ON FUNCTION interno.es_personal_de_la_prestadora() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION interno.lee_la_configuracion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION interno.escribe_el_catalogo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION interno.es_la_administracion_de_la_prestadora(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION interno.es_su_propia_ficha_de_asistente(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION interno.es_personal_de_la_prestadora() TO authenticated;
GRANT EXECUTE ON FUNCTION interno.lee_la_configuracion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION interno.escribe_el_catalogo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION interno.es_la_administracion_de_la_prestadora(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION interno.es_su_propia_ficha_de_asistente(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. La configuración de la Prestadora: la lee cualquiera, la escribe la administración
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS panel_lee_configuracion_alarmas_tomadas ON public.configuracion_alarmas_tomadas;
CREATE POLICY configuracion_alarmas_tomadas_la_lee_su_prestadora ON public.configuracion_alarmas_tomadas
  FOR SELECT TO authenticated
  USING (interno.lee_la_configuracion(prestadora_id));
CREATE POLICY configuracion_alarmas_tomadas_la_escribe_la_administracion ON public.configuracion_alarmas_tomadas
  FOR ALL TO authenticated
  USING (interno.es_la_administracion_de_la_prestadora(prestadora_id))
  WITH CHECK (interno.es_la_administracion_de_la_prestadora(prestadora_id));

DROP POLICY IF EXISTS panel_lee_configuracion_ausencias ON public.configuracion_ausencias;
CREATE POLICY configuracion_ausencias_la_lee_su_prestadora ON public.configuracion_ausencias
  FOR SELECT TO authenticated
  USING (interno.lee_la_configuracion(prestadora_id));
CREATE POLICY configuracion_ausencias_la_escribe_la_administracion ON public.configuracion_ausencias
  FOR ALL TO authenticated
  USING (interno.es_la_administracion_de_la_prestadora(prestadora_id))
  WITH CHECK (interno.es_la_administracion_de_la_prestadora(prestadora_id));

DROP POLICY IF EXISTS panel_lee_configuracion_calculo_candidatos ON public.configuracion_calculo_candidatos;
CREATE POLICY configuracion_calculo_candidatos_la_lee_su_prestadora ON public.configuracion_calculo_candidatos
  FOR SELECT TO authenticated
  USING (interno.lee_la_configuracion(prestadora_id));
CREATE POLICY configuracion_calculo_candidatos_la_escribe_la_administracion ON public.configuracion_calculo_candidatos
  FOR ALL TO authenticated
  USING (interno.es_la_administracion_de_la_prestadora(prestadora_id))
  WITH CHECK (interno.es_la_administracion_de_la_prestadora(prestadora_id));

DROP POLICY IF EXISTS panel_lee_configuracion_equipo_paciente ON public.configuracion_equipo_paciente;
CREATE POLICY configuracion_equipo_paciente_la_lee_su_prestadora ON public.configuracion_equipo_paciente
  FOR SELECT TO authenticated
  USING (interno.lee_la_configuracion(prestadora_id));
CREATE POLICY configuracion_equipo_paciente_la_escribe_la_administracion ON public.configuracion_equipo_paciente
  FOR ALL TO authenticated
  USING (interno.es_la_administracion_de_la_prestadora(prestadora_id))
  WITH CHECK (interno.es_la_administracion_de_la_prestadora(prestadora_id));

DROP POLICY IF EXISTS panel_lee_configuracion_incidentes_turno_sin_cubrir ON public.configuracion_incidentes_turno_sin_cubrir;
CREATE POLICY configuracion_incidentes_turno_sin_cubrir_la_lee_su_prestadora ON public.configuracion_incidentes_turno_sin_cubrir
  FOR SELECT TO authenticated
  USING (interno.lee_la_configuracion(prestadora_id));
CREATE POLICY configuracion_incidentes_turno_sin_cubrir_la_escribe_la_administracion ON public.configuracion_incidentes_turno_sin_cubrir
  FOR ALL TO authenticated
  USING (interno.es_la_administracion_de_la_prestadora(prestadora_id))
  WITH CHECK (interno.es_la_administracion_de_la_prestadora(prestadora_id));

-- Ésta no es un catálogo: guarda las referencias a los secretos de las dos puertas firmadas de
-- facturación. Se lee y se escribe desde la administración, no desde toda la Prestadora.
DROP POLICY IF EXISTS panel_lee_configuracion_facturacion_familias ON public.configuracion_facturacion_familias;
CREATE POLICY configuracion_facturacion_familias_la_lee_la_administracion ON public.configuracion_facturacion_familias
  FOR SELECT TO authenticated
  USING (interno.es_la_administracion_de_la_prestadora(prestadora_id));
CREATE POLICY configuracion_facturacion_familias_la_escribe_la_administracion ON public.configuracion_facturacion_familias
  FOR ALL TO authenticated
  USING (interno.es_la_administracion_de_la_prestadora(prestadora_id))
  WITH CHECK (interno.es_la_administracion_de_la_prestadora(prestadora_id));

-- Y ésta dice qué Familia quedó restringida y por qué. Es lo mismo que el estado de cuenta, que
-- el producto ya reservó a la administración. La escribe la puerta firmada, con la llave de
-- servicio, así que no lleva política de escritura.
DROP POLICY IF EXISTS panel_lee_restricciones_de_cobranza ON public.restricciones_de_cobranza;
CREATE POLICY restricciones_de_cobranza_las_lee_la_administracion ON public.restricciones_de_cobranza
  FOR SELECT TO authenticated
  USING (interno.es_la_administracion_de_la_prestadora(prestadora_id));

-- ---------------------------------------------------------------------------
-- 3. El catálogo de Lugares: lo lee cualquiera, lo escribe el personal
-- ---------------------------------------------------------------------------
-- Acá el corte de la pantalla es `requiereRolPanel` y nada más —los tres roles de Panel cargan
-- lugares y reparten alcance—, así que la política dice lo mismo.

DROP POLICY IF EXISTS lugares_los_lee_su_organizacion ON public.lugares;
CREATE POLICY lugares_los_lee_su_prestadora ON public.lugares
  FOR SELECT TO authenticated
  USING (interno.lee_la_configuracion(prestadora_id));
CREATE POLICY lugares_los_escribe_el_personal ON public.lugares
  FOR ALL TO authenticated
  USING (interno.escribe_el_catalogo(prestadora_id))
  WITH CHECK (interno.escribe_el_catalogo(prestadora_id));

DROP POLICY IF EXISTS zona_lugares_los_lee_su_organizacion ON public.zona_lugares;
CREATE POLICY zona_lugares_los_lee_su_prestadora ON public.zona_lugares
  FOR SELECT TO authenticated
  USING (interno.lee_la_configuracion(prestadora_id));
CREATE POLICY zona_lugares_los_escribe_el_personal ON public.zona_lugares
  FOR ALL TO authenticated
  USING (interno.escribe_el_catalogo(prestadora_id))
  WITH CHECK (interno.escribe_el_catalogo(prestadora_id));

DROP POLICY IF EXISTS usuario_lugares_los_lee_su_organizacion ON public.usuario_lugares;
CREATE POLICY usuario_lugares_los_lee_su_prestadora ON public.usuario_lugares
  FOR SELECT TO authenticated
  USING (interno.lee_la_configuracion(prestadora_id));
CREATE POLICY usuario_lugares_los_escribe_el_personal ON public.usuario_lugares
  FOR ALL TO authenticated
  USING (interno.escribe_el_catalogo(prestadora_id))
  WITH CHECK (interno.escribe_el_catalogo(prestadora_id));

DROP POLICY IF EXISTS asistente_lugares_los_lee_su_organizacion ON public.asistente_lugares;
CREATE POLICY asistente_lugares_los_lee_su_prestadora ON public.asistente_lugares
  FOR SELECT TO authenticated
  USING (interno.lee_la_configuracion(prestadora_id));
CREATE POLICY asistente_lugares_los_escribe_el_personal ON public.asistente_lugares
  FOR ALL TO authenticated
  USING (interno.escribe_el_catalogo(prestadora_id))
  WITH CHECK (interno.escribe_el_catalogo(prestadora_id));

-- ---------------------------------------------------------------------------
-- 4. Lo que escribía quien no es personal
-- ---------------------------------------------------------------------------

-- Las referencias laborales son antecedentes de una persona, y las carga y las verifica el
-- Panel. La política que había dejaba escribirlas y borrarlas a cualquiera con sesión en la
-- Prestadora, Asistentes y Familias incluidos, y leerlas también.
DROP POLICY IF EXISTS gestiona_referencias_laborales_el_panel ON public.referencias_laborales_asistente;
CREATE POLICY referencias_laborales_las_gestiona_el_personal ON public.referencias_laborales_asistente
  FOR ALL TO authenticated
  USING (interno.escribe_el_catalogo(prestadora_id))
  WITH CHECK (interno.escribe_el_catalogo(prestadora_id));

-- El catálogo de documentos del Pagador y el texto con el que firma colgaban de un permiso
-- operativo —registrar el consentimiento de un Pagador—. Registrar un consentimiento y reescribir
-- el catálogo con el que se registra son dos cosas distintas: la primera es del día a día, la
-- segunda es configuración.
DROP POLICY IF EXISTS tipos_documento_pagador_los_escribe_quien_puede ON public.tipos_documento_pagador;
DROP POLICY IF EXISTS tipos_documento_pagador_los_lee_su_organizacion ON public.tipos_documento_pagador;
CREATE POLICY tipos_documento_pagador_los_lee_su_prestadora ON public.tipos_documento_pagador
  FOR SELECT TO authenticated
  USING (interno.lee_la_configuracion(prestadora_id));
CREATE POLICY tipos_documento_pagador_los_escribe_la_administracion ON public.tipos_documento_pagador
  FOR ALL TO authenticated
  USING (interno.es_la_administracion_de_la_prestadora(prestadora_id))
  WITH CHECK (interno.es_la_administracion_de_la_prestadora(prestadora_id));

DROP POLICY IF EXISTS textos_consentimiento_pagador_los_escribe_quien_puede ON public.textos_consentimiento_pagador;
DROP POLICY IF EXISTS textos_consentimiento_pagador_los_lee_su_organizacion ON public.textos_consentimiento_pagador;
CREATE POLICY textos_consentimiento_pagador_los_lee_su_prestadora ON public.textos_consentimiento_pagador
  FOR SELECT TO authenticated
  USING (interno.lee_la_configuracion(prestadora_id));
CREATE POLICY textos_consentimiento_pagador_los_escribe_la_administracion ON public.textos_consentimiento_pagador
  FOR ALL TO authenticated
  USING (interno.es_la_administracion_de_la_prestadora(prestadora_id))
  WITH CHECK (interno.es_la_administracion_de_la_prestadora(prestadora_id));

-- ---------------------------------------------------------------------------
-- 5. Lo de cada Asistente lo escribe además el dueño de su propia ficha
-- ---------------------------------------------------------------------------
-- Las tres políticas que ya decían esto lo decían cada una por su cuenta, comparando contra
-- `interno.asistente_de_la_sesion()`. Pasan a consumir la función, y la de la Matrícula gana
-- además la comprobación de Prestadora que le faltaba: sin ella, la fila entraba con la
-- Prestadora que viniera en el pedido.

DROP POLICY IF EXISTS asistente_carga_su_matricula ON public.matriculas_asistente;
CREATE POLICY asistente_carga_su_matricula ON public.matriculas_asistente
  FOR INSERT TO authenticated
  WITH CHECK (
    interno.lee_la_configuracion(prestadora_id)
    AND interno.es_su_propia_ficha_de_asistente(asistente_id)
  );

DROP POLICY IF EXISTS asistente_lee_sus_matriculas ON public.matriculas_asistente;
CREATE POLICY asistente_lee_sus_matriculas ON public.matriculas_asistente
  FOR SELECT TO authenticated
  USING (interno.es_su_propia_ficha_de_asistente(asistente_id));

DROP POLICY IF EXISTS asistente_lee_sus_certificados ON public.certificados;
CREATE POLICY asistente_lee_sus_certificados ON public.certificados
  FOR SELECT TO authenticated
  USING (interno.es_su_propia_ficha_de_asistente(asistente_id));

DROP POLICY IF EXISTS asistente_lee_sus_consentimientos ON public.consentimientos_asistente;
CREATE POLICY asistente_lee_sus_consentimientos ON public.consentimientos_asistente
  FOR SELECT TO authenticated
  USING (interno.es_su_propia_ficha_de_asistente(asistente_id));

DROP POLICY IF EXISTS asistente_registra_su_consentimiento ON public.consentimientos_asistente;
CREATE POLICY asistente_registra_su_consentimiento ON public.consentimientos_asistente
  FOR INSERT TO authenticated
  WITH CHECK (
    interno.lee_la_configuracion(prestadora_id)
    AND interno.es_su_propia_ficha_de_asistente(asistente_id)
  );

DROP POLICY IF EXISTS asistente_retira_su_consentimiento ON public.consentimientos_asistente;
CREATE POLICY asistente_retira_su_consentimiento ON public.consentimientos_asistente
  FOR UPDATE TO authenticated
  USING (interno.es_su_propia_ficha_de_asistente(asistente_id))
  WITH CHECK (interno.es_su_propia_ficha_de_asistente(asistente_id));

DROP POLICY IF EXISTS asistente_reemplaza_su_rechazo ON public.consentimientos_asistente;
CREATE POLICY asistente_reemplaza_su_rechazo ON public.consentimientos_asistente
  FOR DELETE TO authenticated
  USING (
    interno.es_su_propia_ficha_de_asistente(asistente_id)
    AND decision = 'rechazado'
  );

-- ---------------------------------------------------------------------------
-- 6. El permiso de tabla, que no es la RLS
-- ---------------------------------------------------------------------------

-- Lo que las políticas nuevas necesitan para no bloquear. Nada más que eso: las filas de
-- configuración son una por Prestadora y se dan de alta y se corrigen, no se borran.
GRANT INSERT, UPDATE ON public.configuracion_alarmas_tomadas TO authenticated;
GRANT INSERT, UPDATE ON public.configuracion_ausencias TO authenticated;
GRANT INSERT, UPDATE ON public.configuracion_calculo_candidatos TO authenticated;
GRANT INSERT, UPDATE ON public.configuracion_equipo_paciente TO authenticated;
GRANT INSERT, UPDATE ON public.configuracion_incidentes_turno_sin_cubrir TO authenticated;
GRANT INSERT, UPDATE ON public.configuracion_facturacion_familias TO authenticated;

-- El catálogo de Lugares sí se corrige y se desarma: un lugar se da de baja, y el reparto de
-- alcance se rehace sacando y poniendo renglones.
GRANT INSERT, UPDATE, DELETE ON public.lugares TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.zona_lugares TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.usuario_lugares TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.asistente_lugares TO authenticated;

-- Y lo que sobraba. Las tablas de configuración y catálogo arrastraban de la instalación el
-- permiso completo para `anon` y para `authenticated`. `anon` no tiene ninguna política en
-- ninguna de ellas, así que el permiso no le sirve para nada y se le saca entero. A
-- `authenticated` se le sacan los tres que ninguna pantalla usa y que no pasan por la protección
-- por fila: `TRUNCATE` la saltea por completo, y `TRIGGER` y `REFERENCES` son de quien construye
-- el esquema, no de quien lo consulta.
DO $$
DECLARE
  v_tabla text;
  v_tablas text[] := ARRAY[
    'advertencias_legales',
    'asistente_lugares',
    'catalogo_acciones_permisos',
    'catalogo_documentos_de_identidad',
    'catalogo_funciones_marketplace',
    'catalogo_periodos_cobro',
    'conceptos_liquidacion',
    'configuracion_alarmas_tomadas',
    'configuracion_alertas_ia',
    'configuracion_ausencia_automatica',
    'configuracion_ausencias',
    'configuracion_aviso_cese_asistente',
    'configuracion_aviso_guardia_sin_cubrir',
    'configuracion_calculo_candidatos',
    'configuracion_cobro_marketplace',
    'configuracion_equipo_paciente',
    'configuracion_escalada_coordinador',
    'configuracion_escalada_relevo',
    'configuracion_facturacion_familias',
    'configuracion_funciones_marketplace',
    'configuracion_incidentes_turno_sin_cubrir',
    'configuracion_matricula_via_medicacion',
    'configuracion_notificaciones',
    'configuracion_pago_asistentes',
    'configuracion_plataforma',
    'configuracion_prestadora',
    'configuracion_referencias_laborales',
    'configuracion_visibilidad_app',
    'configuracion_whatsapp_prestadora',
    'dominios_de_correo_gratuitos',
    'escalas_legales',
    'etapas_incorporacion_asistente',
    'formas_de_cobro_marketplace',
    'formulas_cese',
    'lista_precios',
    'lugares',
    'monedas_por_pais',
    'motivos_aviso_previo_guardia',
    'motivos_cierre_servicio',
    'motivos_sustitucion_guardia',
    'opciones_postulacion',
    'paquete_prestacion_items',
    'paquetes_prestaciones',
    'permisos_prestadora',
    'plantillas_whatsapp',
    'prestadora_modalidades',
    'referencias_laborales_asistente',
    'restricciones_de_cobranza',
    'tareas_tipo_asistente',
    'textos_consentimiento',
    'textos_consentimiento_pagador',
    'tipos_asistente',
    'tipos_documento_asistente',
    'tipos_documento_pagador',
    'usuario_lugares',
    'zona_lugares',
    'zonas_cobertura'
  ];
BEGIN
  FOREACH v_tabla IN ARRAY v_tablas LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon;', v_tabla);
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM authenticated;', v_tabla);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

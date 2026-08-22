-- ============================================================================
-- Qué hace: cierra las 8 políticas de seguridad que quedaron con la misma fuga
-- que corrigió la migración de esta mañana
-- (20260822120000_el_superadmin_queda_encerrado_en_su_prestadora_en_todas_las_tablas),
-- pero escritas de otra forma y por eso fuera de aquella tanda.
--
-- Por qué quedaron afuera: aquella migración buscó la forma
--
--     es_superadmin() OR (prestadora_id = current_tenant() AND …rol…)
--
-- o sea, políticas compartidas entre el Superadmin y algún rol de la Prestadora.
-- Estas ocho no comparten nada con nadie: son políticas del Superadmin y de
-- nadie más, y su condición entera es
--
--     mal:  es_superadmin()
--     bien: es_superadmin() AND prestadora_id = current_tenant()
--
-- El efecto es idéntico y por el mismo motivo: `es_superadmin()` no mira la
-- Prestadora — solo mira el rol y, si la Prestadora exige doble factor, que la
-- sesión lo tenga (ver su definición en la foto de la base). Con esa condición
-- sola, un Superadmin leía las filas de todas las Prestadoras a la vez, sin
-- sesión de soporte abierta y sin que quedara registrado como acceso a ninguna.
-- `CLAUDE.md` §5 lo prohíbe expresamente y §6 cierra con que un error de
-- configuración nunca debe dejar que una Prestadora acceda a información de
-- otra.
--
-- Medido contra la base local antes de tocar nada: 218 políticas revisadas, 26
-- términos con `es_superadmin()` sin comparación de Prestadora al lado. De esos
-- 26, 17 están sobre tablas que no tienen `prestadora_id` (catálogos de
-- CeltaTech: ver "Qué NO se toca") y 1 es la excepción circular de
-- `sesiones_soporte_tecnico`. Quedan los 8 que arregla este archivo.
--
-- ── Los tres casos ──────────────────────────────────────────────────────────
--
-- 1) Cinco lecturas sueltas del Superadmin, sobre tablas con `prestadora_id`
--    propio que sencillamente no se estaba usando:
--
--      prestadora_modalidades   / superadmin_lee_modalidades
--      prestadora_modulos       / superadmin_lee_prestadora_modulos
--      prestadora_pasarela_pago / superadmin_lee_pasarela
--      prestadoras              / superadmin_lee_prestadoras
--      uso_ia                   / superadmin_lee_uso_ia
--
--    En `prestadoras` la columna que aísla es `id`, no `prestadora_id`, porque
--    la fila *es* la Prestadora. Se compara `id = current_tenant()`, igual que
--    ya hacía su política hermana `superadmin_gestiona_prestadoras`.
--
--    `uso_ia` traía además el segundo defecto: estaba declarada `FOR ALL` sin
--    `WITH CHECK` propio. Postgres reutiliza el `USING` como control de
--    inserción, así que la misma condición floja dejaba además *escribir* una
--    fila de consumo de IA adentro de cualquier Prestadora. Se le escribe el
--    `WITH CHECK` explícito.
--
-- 2) Los dos catálogos de dos niveles — `tipos_asistente` y
--    `tareas_tipo_asistente`. Acá la Prestadora se compara, pero admitiendo el
--    nivel general:
--
--      es_superadmin() AND (prestadora_id IS NULL
--                           OR prestadora_id = current_tenant())
--
--    `prestadora_id IS NULL` es el catálogo de fábrica de CeltaTech, el que
--    comparten todas las Prestadoras (hoy son los cuatro tipos de Asistente que
--    trae el producto). Mantenerlo escribible por el Superadmin es su trabajo
--    —configuración global, `CLAUDE.md` §5— y no rompe el aislamiento: esas
--    filas ya las lee todo el mundo por `todos_leen_tipos_asistente_visibles`.
--    Lo que se cierra es lo otro: escribir o leer la fila *propia de otra*
--    Prestadora. Es la misma forma que ya usa la política vecina
--    `todos_leen_tipos_asistente_visibles`, de donde se copia.
--
-- 3) Una política que sobra y que anulaba a la que ya estaba bien:
--
--      auditoria_soporte_tecnico / superadmin_lee_toda_la_auditoria
--
--    Esa tabla tiene dos políticas de Superadmin. Una está bien escrita
--    —`superadmin_lee_auditoria_de_su_sesion_activa`, con
--    `prestadora_id = current_tenant()`— y la otra dice `es_superadmin()` a
--    secas. Las políticas permisivas se suman con OR, así que la floja le ganaba
--    a la buena y la dejaba sin efecto. No se corrige: se borra, porque la
--    versión corregida ya existe con otro nombre y tenerla dos veces sería el
--    mismo texto repetido (regla 12 de `CLAUDE.md` §7).
--
--    La pantalla de Auditoría del Panel no se entera: `panelAuditoria.js` sirve
--    esa lista desde el backend con service role, que no pasa por RLS, y filtra
--    por rol a mano. El comentario de ese archivo nombra la política que acá se
--    borra — queda desactualizado, pero el código no depende de ella.
--
-- ── Qué NO se toca, y por qué ───────────────────────────────────────────────
--
-- `sesiones_soporte_tecnico` / `superadmin_gestiona_su_propia_sesion_de_soporte`
-- dice `admin_id = auth.uid() AND es_superadmin()`, sin comparar Prestadora, y
-- así tiene que quedarse: es la tabla donde se *anota* a qué Prestadora entra el
-- Superadmin, o sea la que le da valor a `current_tenant()`. Exigirle
-- `prestadora_id = current_tenant()` sería pedirle que ya esté adentro de la
-- Prestadora para poder entrar. Igual no hay fuga entre Superadmins: cada uno
-- solo alcanza sus propias filas por `admin_id = auth.uid()`.
--
-- Los catálogos de CeltaTech sin `prestadora_id` siguen con `es_superadmin()` a
-- secas, que ahí es correcto: no son de ninguna Prestadora, no hay de qué
-- aislarlos. Son `advertencias_legales`, `escalas_legales` y `formulas_cese`
-- —los tres que ya excluía la migración anterior, organizados por jurisdicción—
-- más `catalogo_modulos`, `catalogo_acciones_permisos`,
-- `configuracion_plataforma`, `monedas_por_pais`, `precios_ia_modelo`,
-- `cambios_precio_ia_pendientes` y `textos_consentimiento`, que son de la misma
-- familia: filas de la plataforma, iguales para todas las Prestadoras.
--
-- Cómo se vuelve atrás: con una migración nueva hacia adelante que vuelva a
-- crear las ocho políticas con el texto anterior, que queda escrito acá arriba.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 1 — Lecturas sueltas del Superadmin sobre tablas con `prestadora_id`.
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS superadmin_lee_modalidades ON public.prestadora_modalidades;
CREATE POLICY superadmin_lee_modalidades ON public.prestadora_modalidades
  FOR SELECT
  USING (es_superadmin() AND prestadora_id = current_tenant());

DROP POLICY IF EXISTS superadmin_lee_prestadora_modulos ON public.prestadora_modulos;
CREATE POLICY superadmin_lee_prestadora_modulos ON public.prestadora_modulos
  FOR SELECT
  USING (es_superadmin() AND prestadora_id = current_tenant());

DROP POLICY IF EXISTS superadmin_lee_pasarela ON public.prestadora_pasarela_pago;
CREATE POLICY superadmin_lee_pasarela ON public.prestadora_pasarela_pago
  FOR SELECT
  USING (es_superadmin() AND prestadora_id = current_tenant());

-- En esta tabla la fila es la Prestadora: la columna que aísla se llama `id`.
DROP POLICY IF EXISTS superadmin_lee_prestadoras ON public.prestadoras;
CREATE POLICY superadmin_lee_prestadoras ON public.prestadoras
  FOR SELECT
  USING (es_superadmin() AND id = current_tenant());

-- `FOR ALL` sin `WITH CHECK` propio: se le escribe explícito, para que la
-- condición que controla la inserción no quede heredada por descuido.
DROP POLICY IF EXISTS superadmin_lee_uso_ia ON public.uso_ia;
CREATE POLICY superadmin_lee_uso_ia ON public.uso_ia
  FOR ALL
  USING (es_superadmin() AND prestadora_id = current_tenant())
  WITH CHECK (es_superadmin() AND prestadora_id = current_tenant());


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — Los dos catálogos de dos niveles. `prestadora_id IS NULL` es el
--           nivel general de CeltaTech y sigue abierto al Superadmin; lo que
--           se cierra es la fila propia de otra Prestadora.
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS superadmin_gestiona_tipos_asistente ON public.tipos_asistente;
CREATE POLICY superadmin_gestiona_tipos_asistente ON public.tipos_asistente
  FOR ALL
  USING (
    es_superadmin()
    AND (prestadora_id IS NULL OR prestadora_id = current_tenant())
  )
  WITH CHECK (
    es_superadmin()
    AND (prestadora_id IS NULL OR prestadora_id = current_tenant())
  );

DROP POLICY IF EXISTS superadmin_gestiona_tareas_tipo_asistente ON public.tareas_tipo_asistente;
CREATE POLICY superadmin_gestiona_tareas_tipo_asistente ON public.tareas_tipo_asistente
  FOR ALL
  USING (
    es_superadmin()
    AND (prestadora_id IS NULL OR prestadora_id = current_tenant())
  )
  WITH CHECK (
    es_superadmin()
    AND (prestadora_id IS NULL OR prestadora_id = current_tenant())
  );


-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 3 — La política que sobra. Su versión corregida ya existe en la misma
--           tabla con el nombre `superadmin_lee_auditoria_de_su_sesion_activa`.
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS superadmin_lee_toda_la_auditoria ON public.auditoria_soporte_tecnico;


NOTIFY pgrst, 'reload schema';

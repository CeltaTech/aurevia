-- Qué muestran las pantallas de las Familias y de los Asistentes, elegido por cada Prestadora.
--
-- POR QUÉ EXISTE. Hasta hoy las dos aplicaciones de teléfono mostraban exactamente lo mismo
-- para toda Prestadora. Y no todas trabajan igual: una que no hace enfermería no quiere que
-- su gente cargue presión ni glucemia, porque cargarla es hacerse cargo de algo clínico; una
-- que factura por fuera no tiene por qué mostrarle precios a la Familia; y hay funciones
-- —seguir la ubicación de una persona, ponerle estrellas a un trabajador— que en algunas
-- jurisdicciones traen riesgo legal (`CLAUDE.md` §3). Eso es una diferencia de negocio, y una
-- diferencia de negocio se resuelve con configuración, no con versiones distintas del código
-- (`CLAUDE.md` §2, "Configuración sobre programación").
--
-- CÓMO ESTÁ ARMADO. Una fila por cada cosa que la Prestadora decidió cambiar, y nada más.
-- La lista completa de qué se puede prender o apagar no vive acá: vive en el catálogo del
-- motor, `backend/src/utils/catalogoVisibilidad.js`, junto con el valor de fábrica de cada
-- una. Es la misma forma que ya usa el catálogo de avisos, y por el mismo motivo: la lista
-- describe lo que el producto sabe hacer —la escribe CeltaTech y cambia con cada versión—,
-- mientras que esta tabla guarda la decisión de cada Prestadora, que es lo único que le
-- pertenece. Sin fila, rige el valor de fábrica.
--
-- LA CLAVE NO SE RENOMBRA NUNCA. Cada clave nombra lo que la cosa hace, no cómo se llama hoy
-- la pantalla donde aparece (`CLAUDE.md` §7 regla 13). Queda escrita adentro de datos que ya
-- existen: cambiarla después es perder la decisión que la Prestadora ya había tomado.

CREATE TABLE IF NOT EXISTS configuracion_visibilidad_app (
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  clave         TEXT NOT NULL,
  visible       BOOLEAN NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (prestadora_id, clave)
);

COMMENT ON TABLE configuracion_visibilidad_app IS
  'Qué muestran las aplicaciones de la Familia y del Asistente en cada Prestadora. Solo guarda '
  'lo que se cambió respecto del valor de fábrica; la lista de claves posibles vive en '
  'backend/src/utils/catalogoVisibilidad.js.';

COMMENT ON COLUMN configuracion_visibilidad_app.clave IS
  'Identificador permanente de la cosa que se prende o se apaga. Nombrado por su función, '
  'nunca por la pantalla donde aparece hoy, y no se renombra jamás (CLAUDE.md §7 regla 13).';

-- Buscar todo lo de una Prestadora es la consulta que se hace en cada pedido de las dos
-- aplicaciones; la clave primaria ya la resuelve porque empieza por prestadora_id.

ALTER TABLE configuracion_visibilidad_app ENABLE ROW LEVEL SECURITY;

-- Las mismas dos reglas que el resto de la configuración: el Administrador de la Prestadora
-- la maneja, la Coordinadora la lee. Ninguna alcanza filas de otra Prestadora, porque
-- `current_tenant()` es una sola función y la contesta la base, no la aplicación.
DROP POLICY IF EXISTS admin_gestiona_visibilidad_app ON configuracion_visibilidad_app;
CREATE POLICY admin_gestiona_visibilidad_app ON configuracion_visibilidad_app
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'
    )
  );

DROP POLICY IF EXISTS coordinador_lee_visibilidad_app ON configuracion_visibilidad_app;
CREATE POLICY coordinador_lee_visibilidad_app ON configuracion_visibilidad_app
  FOR SELECT
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'coordinador'
    )
  );

-- Toda mano que entre por una sesión de soporte técnico queda registrada, igual que en el
-- resto de las tablas de configuración (`CLAUDE.md` §5).
DROP TRIGGER IF EXISTS trg_auditoria_soporte ON configuracion_visibilidad_app;
CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON configuracion_visibilidad_app
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_soporte_mutacion();

-- A propósito no se siembra ninguna fila: una Prestadora recién creada arranca con todo en
-- su valor de fábrica, y recién se guarda algo cuando alguien decide cambiarlo.

NOTIFY pgrst, 'reload schema';

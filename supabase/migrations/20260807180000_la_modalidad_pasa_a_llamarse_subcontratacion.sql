-- ============================================================================
-- La tercera modalidad de la Prestadora deja de llamarse "cooperativa" y pasa
-- a llamarse "subcontratacion" (pendiente #115, docs/PENDIENTES.md).
--
-- POR QUÉ SE CAMBIA UN VALOR GUARDADO, QUE NORMALMENTE NO SE TOCA
-- ----------------------------------------------------------------
-- La regla 13 de CLAUDE.md §7 dice dos cosas: que un identificador guardado se
-- nombra por su función, y que una vez creado no se renombra. Acá las dos
-- tiran para el mismo lado en vez de chocar:
--
--   * "cooperativa" NO nombra su función. Lo que la modalidad guarda es otra
--     cosa: la Prestadora le pasa a otra empresa, que tiene su propio plantel,
--     un servicio que tomó de un cliente. Eso es subcontratación. En Argentina
--     una cooperativa de trabajo es gente asociada con liquidación propia, y
--     eso ya existe por separado como forma de vínculo de un Asistente
--     (pendiente #53). Dos cosas distintas no pueden compartir palabra.
--
--   * "no se renombra" protege datos que ya existen. Acá no hay ninguno:
--     comprobado contra la base viva el 2026-08-07, prestadora_modalidades solo
--     tiene filas con 'directa' (2 filas), ninguna con 'cooperativa'. El valor
--     estaba admitido en la restricción por adelantado, para no tener que hacer
--     otra migración el día que la modalidad se diseñara — y ese día es hoy.
--
-- O sea: se cambia ahora, que es cuando sale gratis, y no queda nada que
-- reescribir después.
--
-- QUÉ HACE ESTA MIGRACIÓN
-- -----------------------
-- Cambia el valor admitido en las tres restricciones que lo nombran, y por las
-- dudas convierte primero cualquier fila que lo tuviera. La conversión está de
-- más en la base de la nube (no hay ninguna), pero cuesta nada y evita que la
-- migración se caiga en una base de otra máquina donde alguien sí lo hubiera
-- cargado a mano.
--
-- Lo que esta migración NO hace: diseñar la modalidad. Sigue sin pantallas ni
-- menú, igual que antes. Esto es solo el cambio de nombre.
-- ============================================================================

-- ============================================================================
-- 1. Las filas que pudieran existir con el nombre viejo
-- ============================================================================
UPDATE prestadora_modalidades SET modalidad = 'subcontratacion' WHERE modalidad = 'cooperativa';
UPDATE guardias SET canal_modalidad = 'subcontratacion' WHERE canal_modalidad = 'cooperativa';
UPDATE series_guardias SET canal_modalidad = 'subcontratacion' WHERE canal_modalidad = 'cooperativa';

-- ============================================================================
-- 2. Las tres restricciones. Se borran y se vuelven a crear porque en Postgres
--    una restricción de este tipo no se edita: se reemplaza.
-- ============================================================================
ALTER TABLE prestadora_modalidades DROP CONSTRAINT IF EXISTS prestadora_modalidades_modalidad_check;
ALTER TABLE prestadora_modalidades
  ADD CONSTRAINT prestadora_modalidades_modalidad_check
  CHECK (modalidad IN ('directa', 'marketplace', 'subcontratacion'));

ALTER TABLE guardias DROP CONSTRAINT IF EXISTS guardias_canal_modalidad_check;
ALTER TABLE guardias
  ADD CONSTRAINT guardias_canal_modalidad_check
  CHECK (canal_modalidad IN ('directa', 'marketplace', 'subcontratacion'));

ALTER TABLE series_guardias DROP CONSTRAINT IF EXISTS series_guardias_canal_modalidad_check;
ALTER TABLE series_guardias
  ADD CONSTRAINT series_guardias_canal_modalidad_check
  CHECK (canal_modalidad IN ('directa', 'marketplace', 'subcontratacion'));

-- ============================================================================
-- 3. Que PostgREST se entere del cambio (CLAUDE.md §8)
-- ============================================================================
NOTIFY pgrst, 'reload schema';

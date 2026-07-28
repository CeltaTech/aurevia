-- Quita la columna prestadoras.plan_licencia.
--
-- Por qué: era un TEXT libre, sin ningún sistema detrás, que hacía de "plan comercial"
-- dentro del producto. A partir de la separación CeltaTech / Aurevia, quién contrató qué
-- plan es asunto de CeltaTech (Nivel 1), no de Aurevia (Nivel 2). Aurevia no tiene por qué
-- saber qué plan tiene una Prestadora; lo que recibe son capacidades habilitadas.
-- Es el paso 4 de la Etapa 0 de `docs/PLAN_SEPARACION_CELTATECH.md`.
--
-- Comprobado contra la base viva el 2026-07-28, antes de escribir esta migración:
--   * 2 filas en `prestadoras`, las 2 con la columna vacía — no se pierde ningún dato;
--   * ninguna vista, función, política de seguridad, índice ni restricción la menciona;
--   * ninguna referencia en el código de `backend/`, `panel/`, `pwa-asistentes/` ni
--     `pwa-familias/`.
--
-- Cómo se vuelve atrás: se agrega otra migración adelante con
--   ALTER TABLE "public"."prestadoras" ADD COLUMN "plan_licencia" text;
-- Una migración aplicada no se edita nunca (ver `docs/MIGRACIONES.md`).

ALTER TABLE "public"."prestadoras" DROP COLUMN IF EXISTS "plan_licencia";

-- ============================================================================
-- Qué hace: deja preparado el aviso de "guardia sin cerrar" — los minutos de
-- gracia que cada Prestadora decide, y las dos marcas que evitan que el aviso
-- se repita en cada corrida.
--
-- Decisión del Desarrollador del 2026-08-22 (pendiente #117):
--
--   «Nunca puede quedar una guardia sin cerrar, la coordinadora o coordinador
--    debe tomar cartas en el asunto de inmediato (15 minutos máximo de la hora
--    indicada para el cierre). Una guardia sin cerrar suele ser señal de
--    problemas.»
--
-- Lo que había hasta hoy solo alcanzaba al día siguiente: `guardiaSinCerrar.js`
-- da por olvidada una guardia recién cuando su fecha es anterior a hoy, y la
-- pantalla del Panel que las junta hay que ir a mirarla. O sea que una guardia
-- que quedó abierta a las nueve de la mañana no le llegaba a nadie hasta la
-- medianoche, y solo si alguien entraba a esa pantalla. Eso es lo que este
-- aviso corrige: sale solo, y sale a los minutos que la Prestadora haya
-- decidido.
--
-- ── Los 15 minutos no se escriben en el código ──────────────────────────────
--
-- Regla 1 de `CLAUDE.md` §7. Quince es el valor con el que arranca cada
-- Prestadora, no el valor del producto: una que cubre urgencias va a querer
-- enterarse antes, y una de guardias largas en zona sin señal va a querer darle
-- más aire antes de mover a nadie. Por eso el número vive en
-- `configuracion_escalada_coordinador`, que ya es la tabla donde cada
-- Prestadora dice cada cuánto se le insiste al Coordinador y a los cuántos
-- minutos entra el de respaldo. Un aviso más de la misma familia va ahí, no en
-- una tabla nueva.
--
-- ── Por qué dos columnas en `guardias` y no una tabla de avisos ─────────────
--
-- Es exactamente el mismo par que ya usa el aviso de guardia sin cubrir
-- (`aviso_sin_cubrir_at` / `aviso_sin_cubrir_veces`, que lee
-- `utils/revisarGuardiasSinCubrir.js`): la marca de cuándo se avisó por última
-- vez, para no repetir el aviso en cada corrida del proceso, y la cuenta de
-- cuántas veces se avisó, que es lo que deja escribir «es el aviso número 3 de
-- esta misma guardia» y le dice al Coordinador que el asunto viene siendo
-- ignorado. Se copia esa forma a propósito: dos avisos hermanos que se anotan
-- distinto son dos formas de leer lo mismo (regla 12 del §7).
--
-- Cómo se vuelve atrás: con una migración nueva hacia adelante que borre las
-- tres columnas. Ninguna otra cosa las mira todavía.
-- ============================================================================


-- Los minutos que pueden pasar desde la hora de cierre de la guardia antes de
-- que el asunto le salte al Coordinador. Arranca en 15 por la decisión de
-- arriba; cada Prestadora lo cambia desde el Panel.
ALTER TABLE public.configuracion_escalada_coordinador
  ADD COLUMN IF NOT EXISTS minutos_gracia_cierre_guardia integer NOT NULL DEFAULT 15;

-- Cero no sirve: sería avisar en el mismo instante en que termina la guardia,
-- antes de que el Asistente tenga oportunidad de cerrarla. Y un número enorme
-- vacía el aviso de sentido. El tope de un día es el borde del caso: pasado
-- eso ya no es "todavía no la cerró", es la guardia olvidada que junta la
-- pantalla de Guardias sin cerrar.
ALTER TABLE public.configuracion_escalada_coordinador
  DROP CONSTRAINT IF EXISTS minutos_gracia_cierre_guardia_razonable;
ALTER TABLE public.configuracion_escalada_coordinador
  ADD CONSTRAINT minutos_gracia_cierre_guardia_razonable
  CHECK (minutos_gracia_cierre_guardia > 0 AND minutos_gracia_cierre_guardia <= 1440);


-- Cuándo se avisó por última vez que esta guardia seguía sin cerrar, y cuántas
-- veces se avisó en total.
ALTER TABLE public.guardias
  ADD COLUMN IF NOT EXISTS aviso_sin_cerrar_at timestamptz;
ALTER TABLE public.guardias
  ADD COLUMN IF NOT EXISTS aviso_sin_cerrar_veces smallint;

-- Y cuándo se le avisó al Coordinador de respaldo, si la Prestadora tiene uno.
-- Es la misma marca que ya llevan las alertas tempranas y los incidentes de
-- relevo (`backup_notificado_at`), y existe por el mismo motivo: al de respaldo
-- se le avisa una sola vez, no en cada corrida.
ALTER TABLE public.guardias
  ADD COLUMN IF NOT EXISTS aviso_sin_cerrar_backup_at timestamptz;


-- El proceso que emite el aviso recorre todas las Prestadoras buscando guardias
-- en curso cuya hora de cierre ya pasó. Sin este índice esa búsqueda lee la
-- tabla entera de guardias en cada corrida, y la tabla de guardias es la que
-- más crece de todo el producto.
CREATE INDEX IF NOT EXISTS guardias_en_curso_por_fecha
  ON public.guardias (prestadora_id, fecha)
  WHERE estado = 'activa' AND cerrada_at IS NULL;


NOTIFY pgrst, 'reload schema';

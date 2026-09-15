-- El Asistente dice cuándo no está disponible, y lo dice él.
-- ==========================================================================
--
-- QUÉ FALTABA. Hasta acá lo único que existía sobre si alguien podía tomar trabajo era
-- `asistentes.estado` ('activo' | 'inactivo' | 'cesado'), y esa columna la escribe la Prestadora
-- desde el Panel. El Asistente no tenía ninguna forma de decir "esta semana no". La única
-- columna que sonaba a eso, `asistentes.disponibilidad` (jsonb), no la escribe ni la lee ninguna
-- pantalla: es de la época de las postulaciones cargadas a mano.
--
-- POR QUÉ NO SE REUSA `estado`. Son dos decisiones de dos personas distintas y mezclarlas pierde
-- la diferencia: "lo desactivamos nosotros" no es lo mismo que "él se puso no disponible". Si el
-- Asistente escribiera `estado`, la Prestadora dejaría de saber por qué alguien dejó de aparecer,
-- y peor: el Asistente podría sacarse a sí mismo un 'cesado' que puso la Prestadora.
--
-- POR QUÉ ES SUYA LA DECISIÓN. En modalidad marketplace el Asistente elige qué toma
-- (`celtatech/CLAUDE.md` §3, y `docs/PRD_07_Modalidad_Marketplace.md:294`, que además lo pide
-- "sin consecuencia impuesta por la plataforma"). Y hay un motivo legal, ya escrito en esta misma
-- base: imponer horarios fijos en vez de que el Asistente decida su disponibilidad es uno de los
-- indicios más fuertes de subordinación bajo el art. 23 de la LCT.
--
-- QUÉ APAGA Y QUÉ NO. Apaga lo que sale a buscarlo solo: la fase automática de la escalada de
-- relevo deja de escribirle. No apaga a la persona: en el panel de cobertura sigue apareciendo,
-- con el motivo a la vista, porque ahí decide alguien y la lista de candidatos ordena pero no
-- decide. Y no toca ninguna guardia ya asignada: lo que ya se comprometió sigue siendo suyo.
--
-- POR QUÉ NO LLEVA POLICY DE ESCRITURA. `authenticated` tiene UPDATE sobre toda la tabla
-- `asistentes`, así que una policy `FOR UPDATE USING (id = auth.uid())` no habilitaría esta
-- columna: habilitaría la ficha entera —nombre, estado, horas semanales, prestadora—. Quien
-- escribe acá es el motor, con la llave de servicio, en la ruta que ya sabe de quién es la
-- sesión, igual que todo lo demás que las aplicaciones de teléfono escriben
-- (`productos/careonys/CLAUDE.md` §6).

ALTER TABLE public.asistentes
  ADD COLUMN IF NOT EXISTS disponible_para_ofertas boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS disponibilidad_cambiada_en timestamp with time zone;

COMMENT ON COLUMN public.asistentes.disponible_para_ofertas IS
  'Lo decide el Asistente desde su aplicacion, no la Prestadora. En false, la fase automatica de relevo no le escribe y en el panel de cobertura queda al fondo con su motivo. No cambia ninguna guardia ya asignada. Distinto de asistentes.estado, que es la decision administrativa de la Prestadora.';

COMMENT ON COLUMN public.asistentes.disponibilidad_cambiada_en IS
  'Cuando lo cambio por ultima vez. Sirve para que quien coordina sepa si el "no disponible" es de hoy o de hace tres meses.';

NOTIFY pgrst, 'reload schema';

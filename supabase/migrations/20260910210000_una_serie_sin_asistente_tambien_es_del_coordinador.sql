-- ============================================================================
-- Una serie sin Asistente también es del Coordinador
-- ============================================================================
--
-- Qué estaba roto
-- ---------------
-- La pantalla de guardia nueva dice, con todas las letras, que se puede crear el turno sin
-- Asistente y asignarlo después —«va a aparecer como un hueco en la grilla»—. Con una guardia
-- suelta funciona. Con una serie, no: al Coordinador la base le contestaba
-- `new row violates row-level security policy for table "series_guardias"`, que en pantalla se
-- lee «este usuario no tiene permiso para hacer esto». Nadie le decía por qué, porque no era
-- cuestión de permisos: era que la serie no llegaba a estar adentro de su alcance.
--
-- El motivo es que la misma regla estaba escrita dos veces. `guardias` la resuelve llamando a
-- `interno.coordinador_alcanza_guardia()`, cuya primera línea contempla justamente el hueco:
-- «sin Asistente, alcanza». `series_guardias` tenía una copia hecha a mano, con un `JOIN` contra
-- `asistentes`, y un `JOIN` no encuentra nada cuando no hay a quién buscar. La copia perdió el
-- caso que el original sí tenía, que es lo que pasa siempre que una decisión vive en dos lugares.
--
-- Cómo queda
-- ----------
-- La serie usa la misma función que la guardia. No queda ninguna copia: si mañana cambia qué
-- alcanza un Coordinador, cambia en un solo lugar.
--
-- Las otras trece políticas que arman la comparación de zonas a mano se revisaron una por una y
-- se dejan como están: todas cuelgan de trabajo que alguien hizo —un certificado suyo, un mensaje
-- suyo, el rastro de su recorrido, el reporte de su turno, el relevo entre dos personas—, y sin
-- Asistente ninguna de esas filas llega a existir. Acá el hueco es un estado normal del trabajo,
-- no un dato que falta.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS coordinador_gestiona_series_guardias_de_su_zona ON public.series_guardias;

CREATE POLICY coordinador_gestiona_series_guardias_de_su_zona ON public.series_guardias
  FOR ALL
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
       WHERE u.id = auth.uid() AND u.rol = 'coordinador'
    )
    AND interno.coordinador_alcanza_guardia(asistente_id)
  );

-- La función se llama «alcanza_guardia» por la tabla donde nació, y ahora la usan las dos. Lo que
-- decide es sobre el Asistente, así que sirve igual para la serie; se deja el nombre porque
-- cambiarlo obligaría a rehacer las políticas de las dos tablas sin ganar nada.
COMMENT ON FUNCTION interno.coordinador_alcanza_guardia(uuid) IS
  'Si un Coordinador alcanza lo que pasa por ese Asistente: comparte zona con él, o no hay Asistente todavía. La usan las políticas de guardias y de series_guardias, y es el único lugar donde está escrita esa regla.';

COMMIT;

NOTIFY pgrst, 'reload schema';

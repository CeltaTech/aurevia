-- La licencia bloquea a cualquier Asistente al que se lo pueda convocar, no solo al de la zona.
-- ===========================================================================================
--
-- QUÉ ESTABA MAL. El panel de cobertura ya no deja proponer a quien está de licencia el día de
-- la guardia: lee las filas de `ausencias` que se pisan con el rango y `lib/candidatos.js` las
-- usa para bloquear. Pero ese bloqueo **fallaba callado entre zonas**, que es la peor clase de
-- falla: no rompe nada, no avisa nada, y muestra como disponible a alguien que no está.
--
-- El desarmadero, verificado contra la base local y no contra lo que diga un documento:
--
--   1. Lo que una Coordinadora VE de `ausencias` está acotado a su zona. La política
--      `coordinador_gestiona_ausencias_de_su_zona` exige `u.zonas && a.zonas`: si la licencia es
--      de alguien de otra zona, la fila directamente no vuelve.
--
--   2. Lo que una Coordinadora PUEDE HACER no está acotado a su zona. `coordinador_alcanza_guardia`
--      devuelve TRUE con `p_asistente_id IS NULL`, o sea que toda guardia sin cubrir de la
--      Prestadora queda a su alcance; y la política `coordinador_gestiona_ofertas_de_su_zona`,
--      del lado del `WITH CHECK`, **no mira zonas en absoluto** — solo pide ser coordinador de
--      la Prestadora. Comprobado: una Coordinadora de {caba, zona_norte} inserta sin problema
--      una fila de `ofertas_guardia` para un Asistente de {zona_sur}. Invitar a alguien a una
--      guardia es darle trabajo: si acepta, la guardia es suya.
--
-- Los dos conjuntos no coinciden. Sobre esa diferencia —gente a la que se puede convocar y cuya
-- licencia no se ve— el bloqueo no se aplicaba y la pantalla la mostraba como disponible.
--
-- POR QUÉ NO SE AFLOJA LA POLÍTICA DE `ausencias`. Porque RLS decide por fila, no por columna:
-- dejar entrar la fila para poder leer tres fechas traería también `tipo` —que puede decir
-- `enfermedad_inculpable` o `accidente_inculpable`, o sea información de salud—, `certificado_url`
-- —el certificado médico— y `observaciones` —texto libre sobre la salud de alguien. Ampliar el
-- acceso al legajo para contestar una pregunta de agenda viola CLAUDE.md §6, y de paso rompe el
-- mínimo privilegio de §5. El legajo se queda donde está.
--
-- QUÉ SE HACE EN CAMBIO. Una función `SECURITY DEFINER` que contesta **una sola pregunta** —¿quién
-- no está disponible entre estas dos fechas?— y devuelve **el mínimo indispensable para
-- contestarla**: a quién, desde cuándo y hasta cuándo. Tres columnas. El tipo de licencia, el
-- certificado, las observaciones, los días computados y las guardias afectadas no salen de la
-- tabla: no viajan, no llegan al navegador y no hay forma de deducirlos desde acá. Es la
-- diferencia entre ver el legajo y consultar la agenda.
--
-- Que sea `SECURITY DEFINER` es lo que le permite mirar por encima de la política de zona; por eso
-- todo lo que la política hacía por afuera lo tiene que hacer ella misma por adentro, y lo hace:
--
--   * El tenant se resuelve ADENTRO con `current_tenant()`, nunca se recibe por parámetro. Quien
--     llama no puede pedir las licencias de otra Prestadora ni equivocándose ni a propósito, y si
--     no hay sesión, `current_tenant()` es nulo, la comparación da nulo y no vuelve ninguna fila
--     (CLAUDE.md §2). La precedencia sesión de soporte / Organización propia tampoco se reescribe
--     acá: es la que ya define esa función (§5, regla 12).
--
--   * El derecho a preguntar se comprueba con las funciones que ya son el punto único de verdad
--     de los roles: `es_superadmin()` —que además exige MFA cuando la plataforma lo pide— y
--     `es_admin_prestadora()`. Para el coordinador se usa la misma condición literal que ya usan
--     sus políticas, porque no existe todavía un `es_coordinador()` y inventarlo acá crearía un
--     segundo lugar donde se decide quién es coordinador, que es exactamente lo que la regla 12
--     prohíbe. Los tres roles de Panel de §5 y ninguno más: un Asistente o una Familia que llame
--     a esta función no recibe ninguna fila.
--
-- UN SOLO PUNTO DE VERDAD (regla 12). De acá en adelante, la pregunta "¿esta persona está de
-- licencia estos días?" se le hace a esta función y a ningún otro lado. Cualquier pantalla nueva
-- que arme una lista de candidatos la llama; ninguna vuelve a consultar `ausencias` directo para
-- esto. El recorte fino —contra los dos días que puede ocupar una guardia de noche— sigue
-- viviendo en `ausenciaQueTapa` de `lib/candidatos.js`, que es donde se decide quién puede cubrir
-- un hueco: esta función entrega el rango, aquella decide el caso. Son las dos mitades de la
-- misma regla en dos plataformas que no pueden compartir código.

CREATE OR REPLACE FUNCTION public.ausencias_que_tapan(
  p_desde date,
  p_hasta date
)
RETURNS TABLE (
  asistente_id uuid,
  fecha_inicio date,
  fecha_fin date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.asistente_id, a.fecha_inicio, a.fecha_fin
  FROM public.ausencias a
  JOIN public.asistentes s ON s.id = a.asistente_id
  WHERE
    -- El aislamiento, primero y adentro. Las dos tablas se atan al mismo tenant: la licencia y
    -- la persona a la que pertenece tienen que ser las dos de la Prestadora de esta sesión.
    a.prestadora_id = current_tenant()
    AND s.prestadora_id = current_tenant()

    -- Quién tiene derecho a preguntar: los tres roles de Panel de CLAUDE.md §5 y nadie más.
    AND (
      es_superadmin()
      OR es_admin_prestadora()
      OR EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid() AND u.rol = 'coordinador'
      )
    )

    -- La licencia se pisa con el rango preguntado. Una ausencia sin `fecha_fin` sigue abierta:
    -- cuenta desde su inicio y hacia adelante sin límite. Tratarla como cerrada sería dar por
    -- trabajando a quien está de licencia y todavía no tiene fecha de vuelta, que es el caso
    -- más común de todos.
    AND a.fecha_inicio <= p_hasta
    AND (a.fecha_fin IS NULL OR a.fecha_fin >= p_desde);
$$;

COMMENT ON FUNCTION public.ausencias_que_tapan(date, date) IS
  'Quién de la Prestadora de esta sesión tiene una licencia que se pisa con el rango de fechas, y entre qué días. Devuelve solo asistente_id, fecha_inicio y fecha_fin: el tipo de licencia, el certificado y las observaciones son información de salud y no salen del legajo (CLAUDE.md §6). Es el único camino por el que una pantalla pregunta si alguien está de licencia (regla 12). Resuelve el tenant adentro con current_tenant() y solo contesta a los tres roles de Panel.';

-- Puerta cerrada por defecto. La función mira por encima de RLS, así que quién puede invocarla se
-- dice explícitamente en vez de heredarse del permiso que Postgres le da a PUBLIC.
REVOKE ALL ON FUNCTION public.ausencias_que_tapan(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ausencias_que_tapan(date, date) FROM anon;

GRANT EXECUTE ON FUNCTION public.ausencias_que_tapan(date, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

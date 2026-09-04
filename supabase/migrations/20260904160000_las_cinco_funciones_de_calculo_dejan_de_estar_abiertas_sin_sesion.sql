--
-- Las cinco funciones de cálculo dejan de estar abiertas a quien no inició sesión
--
-- Al revisar qué quedó publicado después de la mudanza del 2026-09-04 aparecieron cinco
-- funciones del esquema `public` que puede ejecutar cualquiera con la clave pública y sin
-- sesión: son direcciones web abiertas que no usa nadie desde el navegador. Las llama el motor,
-- y el motor entra con la llave maestra.
--
-- **No es una fuga, y por eso esto no es una corrección de urgencia.** Ninguna de las cinco es
-- `SECURITY DEFINER`: corren con los permisos de quien las llama, y las tres que tocan datos
-- —domicilios y cobros— leen tablas con protección por fila. Quien entra sin sesión no tiene
-- ninguna política que lo alcance, así que no obtiene ninguna fila. Las otras dos ni siquiera
-- consultan la base: reciben valores sueltos y devuelven una cuenta. Ésa es exactamente la
-- diferencia con las trece funciones que se cerraron el 2026-08-22 y el 2026-09-04, que sí se
-- salteaban la protección por fila.
--
-- Se revocan igual, porque el principio es dar sólo el permiso que hace falta, y una puerta
-- abierta que no usa nadie es una puerta abierta. Revocarle a `PUBLIC` no alcanza: el permiso
-- de `anon` es una concesión aparte y sobrevive.
--
-- **Se les deja `authenticated`.** El Panel consulta la base directamente y podría llamarlas; y
-- si algún día las dos aplicaciones de teléfono consultan con el pase de la persona, con ese
-- pase la protección por fila ya devuelve solamente lo que le corresponde a quien pregunta.
--
-- **Lo que esta migración no toca, a propósito: las funciones de disparador.** Hay unas quince
-- en `public` con el mismo permiso amplio, pero un disparador corre adentro de la operación que
-- lo dispara y con los permisos de quien la hizo. Quitarles la ejecución a `PUBLIC` no las
-- cierra hacia afuera —PostgREST no publica una función que devuelve `trigger`, así que no son
-- direcciones web—: lo único que consigue es que falle el alta que las despierta.
--

DO $$
DECLARE
  f text;
  las_cinco text[] := ARRAY[
    'public.dia_en_que_termina_guardia(date, time without time zone, time without time zone)',
    'public.domicilio_del_paciente_en(uuid, date)',
    'public.domicilios_de_pacientes_en(uuid[], date)',
    'public.estado_de_factura(numeric, numeric, date)',
    'public.resumen_cobros_de_factura(uuid)'
  ];
BEGIN
  FOREACH f IN ARRAY las_cinco LOOP
    -- Corta la migración entera si alguna cambió de firma o dejó de existir, en vez de
    -- revocar cuatro y dar la quinta por hecha.
    IF to_regprocedure(f) IS NULL THEN
      RAISE EXCEPTION 'No existe la función %; revisar antes de repartir permisos', f;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, "anon"', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO "authenticated", "service_role"', f);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';

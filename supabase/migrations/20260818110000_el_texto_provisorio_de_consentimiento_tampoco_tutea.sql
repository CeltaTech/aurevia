-- El texto provisorio de consentimiento de ubicación tampoco tutea al Asistente.
--
-- POR QUÉ EXISTE ESTA MIGRACIÓN. La regla del trato del §7 regla 1 de CLAUDE.md dice que
-- ningún texto visible tutea a quien lo lee. Al recorrer la aplicación de los Asistentes en el
-- navegador —que es la condición de cierre del pendiente #144— apareció el último lugar que
-- todavía lo hacía: la pantalla "Mi Perfil", en el consentimiento para registrar la ubicación.
-- Decía "tu ubicación", "cuando salís", "Podés retirarlo", "aceptás este seguimiento".
--
-- POR QUÉ SE ESCAPÓ. Ese texto no vive en el archivo de traducciones: vive en la base, en la
-- tabla `textos_consentimiento`, sembrado por la migración 20260730220000. El control
-- automático `scripts/verificar_texto_visible.mjs` revisa el código de las tres aplicaciones y
-- del motor, no la base de datos. Es la segunda vez que un texto guardado en la base se salta
-- la regla: la primera fue la advertencia legal, corregida el 2026-08-16. El agujero en sí
-- queda anotado como pendiente aparte.
--
-- QUÉ SE CORRIGE Y QUÉ NO. Solo las dos filas en castellano, que son las que tutean. Las de
-- portugués usan "sua localização", que es el posesivo de "você" y la regla lo admite. Las de
-- inglés no distinguen trato.
--
-- EL TEXTO SIGUE SIENDO DE RELLENO. `es_borrador` queda en TRUE, o sea que el seguimiento
-- sigue sin habilitarse para nadie: esto no reemplaza la redacción del abogado (pendiente
-- #102). Se corrige igual porque hoy se muestra en pantalla, y lo que se muestra respeta la
-- regla, sea definitivo o no. Cuando llegue el texto profesional entrará como versión 2, y
-- tendrá que respetar la misma regla.
--
-- NO SE TOCA `consentimientos_asistente.texto_mostrado`. Esa columna es la fotografía de lo
-- que cada persona leyó y aceptó en su momento; corregirla sería falsificar el registro, el
-- mismo criterio que se usó con `auditoria_advertencias_legales`.
--
-- NO SE EDITA LA MIGRACIÓN ORIGINAL. Una migración aplicada es historia (MIGRACIONES.md §4.1).
--
-- SE PUEDE CORRER LAS VECES QUE HAGA FALTA: escribe siempre el mismo texto final.

-- --- Relación de dependencia -------------------------------------------------
UPDATE textos_consentimiento
SET titulo = 'TEXTO PROVISORIO — Registro de la ubicación en el trayecto hacia una guardia',
    cuerpo = E'ESTE TEXTO ES DE RELLENO Y NO TIENE VALIDEZ LEGAL. Está acá para poder construir y probar la pantalla mientras se consigue la redacción profesional.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Esta sección va a explicar, en palabras simples, qué se registra del recorrido hacia una guardia y para qué se usa ese dato.\n\nSed do eiusmod tempor incididunt ut labore. Acá va a ir la finalidad concreta: saber con tiempo si una guardia se va a poder cubrir, y nada más que eso.\n\nUt enim ad minim veniam, quis nostrud exercitation. Acá va a ir qué NO se hace con el dato: no se comparte con la Familia, no se usa fuera del horario del trayecto, no se guarda para siempre.\n\nDuis aute irure dolor in reprehenderit in voluptate velit esse. Acá va a ir cómo se retira este consentimiento y qué pasa cuando se retira.',
    puntos_clave = ARRAY[
      'PROVISORIO — Qué se registra: solo el recorrido hacia la guardia.',
      'PROVISORIO — Cuándo empieza: al avisar la salida. Cuándo termina: al llegar.',
      'PROVISORIO — Quién lo ve: la Prestadora. La Familia ve solo la hora estimada de llegada, nunca el lugar exacto.',
      'PROVISORIO — Cuánto se guarda: [pendiente de definir con el abogado].',
      'PROVISORIO — Se puede retirar en cualquier momento, desde Mi Perfil.'
    ],
    updated_at = NOW()
WHERE jurisdiccion = 'AR'
  AND clave = 'seguimiento_ubicacion'
  AND modalidad = 'dependencia'
  AND idioma = 'es-AR'
  AND version = 1;

-- --- Autónomo / marketplace --------------------------------------------------
UPDATE textos_consentimiento
SET titulo = 'TEXTO PROVISORIO — Registro de la ubicación en el trayecto hacia una guardia',
    cuerpo = E'ESTE TEXTO ES DE RELLENO Y NO TIENE VALIDEZ LEGAL. Está acá para poder construir y probar la pantalla mientras se consigue la redacción profesional.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Esta versión es la de quien trabaja de forma autónoma y acepta guardias por su cuenta.\n\nSed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Acá va a ir la diferencia con la versión de relación de dependencia: este seguimiento se acepta como parte de un servicio que se ofrece, no como condición de un empleo.',
    puntos_clave = ARRAY[
      'PROVISORIO — Qué se registra: solo el recorrido hacia la guardia aceptada.',
      'PROVISORIO — Quién lo ve: la Prestadora que publicó la guardia.',
      'PROVISORIO — Cuánto se guarda: [pendiente de definir con el abogado].',
      'PROVISORIO — Se puede retirar en cualquier momento, desde Mi Perfil.'
    ],
    updated_at = NOW()
WHERE jurisdiccion = 'AR'
  AND clave = 'seguimiento_ubicacion'
  AND modalidad = 'autonomo'
  AND idioma = 'es-AR'
  AND version = 1;

NOTIFY pgrst, 'reload schema';

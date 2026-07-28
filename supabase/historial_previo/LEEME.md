# Historial previo — lo que se aplicó antes de que existieran las migraciones

**Estos archivos no se ejecutan nunca.** No son migraciones. Están acá como registro
histórico y como material de consulta, nada más. Las migraciones de verdad viven en
`supabase/migrations/` y son las únicas que corren.

## Qué son

Son los **75 cambios que se aplicaron a la base de Aurevia entre el 2026-07-11 y el
2026-07-27**, cuando todavía no había sistema de migraciones en el repositorio. Cada cambio
se aplicaba directamente contra la base y quedaba anotado, con su texto completo, en una
tabla interna que Supabase mantiene (`supabase_migrations.schema_migrations`).

O sea: ese SQL existía **en un solo lugar del mundo**, adentro de una base de datos en plan
gratuito, que se pausa sola por inactividad. No estaba en el repositorio, ni en ningún
respaldo de código. El 2026-07-28 se rescató de ahí y se guardó acá, en git.

## Por qué se sacaron de la base

Para poder empezar a usar migraciones de verdad había que dejar el historial de producción
alineado con el repositorio. La herramienta de Supabase no permite subir un cambio nuevo
mientras la base tenga anotaciones que el repositorio desconoce. Así que se limpiaron esas
75 anotaciones — **pero recién después de haber guardado su contenido acá.** El orden
importó: primero el rescate, después la limpieza.

Borrar esas anotaciones **no tocó ni una tabla**: es una libreta de apuntes, no la base.

## Y entonces, ¿qué reconstruye la base hoy?

`supabase/migrations/20260728163000_base_existente.sql`, que es una foto fiel del esquema
real de producción tomada el 2026-07-28. Esa foto reemplaza a todo esto: contiene el
resultado final de estos 75 cambios **y también** de lo que se hizo antes del 2026-07-11,
que nunca quedó anotado en ningún lado.

Se comprobó de verdad, no se supuso: se levantó un Supabase vacío, se corrió la foto, y se
comparó contra producción en nueve dimensiones —tablas, columnas, políticas de seguridad,
funciones, disparadores, restricciones, índices, permisos de tabla y valores de los
enumerados—. Las nueve dieron idénticas.

## Para qué sirve entonces esta carpeta

Para responder preguntas del tipo *"¿cuándo y por qué apareció esta columna?"*. La foto
dice **cómo está** la base; estos archivos dicen **cómo llegó a estar así** entre el 11 y el
27 de julio. Es historia, no instrucciones.

> No confundir con `backend/src/db/*.sql`, que son 75 archivos distintos: aquellos son
> *intención* —lo que alguna vez se quiso aplicar, sin saber qué se aplicó de verdad— y
> estos son *lo que efectivamente corrió* contra la base, según la propia base.

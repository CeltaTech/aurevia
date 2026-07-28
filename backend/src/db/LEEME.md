# Archivo histórico congelado — acá no se agrega nada nuevo

**Los 75 archivos `.sql` de esta carpeta ya no se usan. No se ejecutan, no se editan y no se
suman archivos nuevos.** Quedaron acá como consulta histórica, nada más.

*(`connection.js` sí es código vivo y no tiene nada que ver con esto: es la conexión del backend
a la base. Esta advertencia habla solo de los `.sql`.)*

## Por qué

Estos archivos son **intención**: lo que en algún momento se quiso aplicar. No hay forma de
saber, mirándolos, cuáles se aplicaron de verdad, cuáles quedaron a medias y cuáles fueron
pisados por otro posterior. No están ordenados por fecha ni numerados. Con ellos la base no se
puede reconstruir.

Desde el **2026-07-28** Aurevia tiene sistema de migraciones. Todo cambio de esquema va a:

```
supabase/migrations/AAAAMMDDHHMMSS_descripcion.sql
```

Las reglas completas están en `docs/MIGRACIONES.md`. La regla corta: **la base nunca se toca a
mano.**

## No confundir con `supabase/historial_previo/`

Son dos historiales distintos, de 75 archivos cada uno, y no son lo mismo:

| Carpeta | Qué contiene |
|---|---|
| `backend/src/db/` (esta) | **Intención** — lo que se quiso aplicar, sin saber qué corrió |
| `supabase/historial_previo/` | **Lo que efectivamente corrió** contra la base entre el 2026-07-11 y el 2026-07-27, según la propia base |

Que los dos números den 75 es casualidad.

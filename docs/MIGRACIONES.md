# Migraciones — cómo se cambia la base de datos de Careonys

> Regla corta: **la base nunca se toca a mano.** Todo cambio de esquema es un archivo nuevo en
> `supabase/migrations/`, y la base se puede reconstruir desde cero corriendo esos archivos en
> orden.

Vigente desde el **2026-07-28**. Es el paso 2 de la Etapa 0 de
`../../../docs/PLAN_SEPARACION_CELTATECH.md`.

## 1. Qué pasaba antes, y por qué había que arreglarlo

Hasta el 2026-07-28 la base de Careonys **no se podía reconstruir desde el repositorio**. Había
dos historiales distintos, y ninguno de los dos servía:

- **`backend/src/db/*.sql` — 75 archivos sueltos.** Son *intención*: lo que en algún momento se
  quiso aplicar. Nadie podía decir cuáles se aplicaron, cuáles quedaron a medias y cuáles fueron
  pisados por otro posterior. No están ordenados por fecha ni numerados.
- **La tabla interna de Supabase — otras 75 anotaciones.** Eso sí era *lo que efectivamente
  corrió* entre el 2026-07-11 y el 2026-07-27, con el texto completo de cada cambio. Pero vivía
  **en un solo lugar del mundo**: adentro de la base de producción. No estaba en el repositorio
  ni en ningún respaldo de código.

Y ni siquiera juntando las dos cosas alcanzaba: la base se creó el 2026-07-07 y las anotaciones
empiezan el 2026-07-11. La primera de esas 75 arranca con
`ALTER TABLE ausencias ALTER COLUMN prestadora_id DROP DEFAULT;` — o sea, modifica tablas que ya
existían. Los primeros cuatro días no quedaron registrados en ningún lado.

## 2. Cómo se arregló: una foto, no una reconstrucción

En vez de intentar rearmar la historia (imposible, faltaba el principio), se le sacó una **foto
fiel al esquema real de producción** y esa foto pasó a ser la migración inicial:

```
supabase/migrations/20260728163000_base_existente.sql
```

87 tablas, 182 políticas de seguridad, 19 funciones, 41 disparadores, 851 columnas. No es lo que
alguien quiso hacer: es lo que hay.

**Se comprobó de verdad, no se supuso.** Se levantó un Supabase vacío en la máquina, se corrió
solo esa foto y se comparó contra producción en nueve dimensiones: tablas, columnas, políticas
de seguridad, funciones (firma y cuerpo), disparadores, restricciones, índices, **permisos de
tabla** y valores de los enumerados. Las nueve dieron idénticas. Los permisos de tabla se
verificaron a propósito: es la clase de defecto que rompió el panel de CeltaTech el 2026-07-27.

## 3. Las tres carpetas, y cuál manda

| Carpeta | Qué es | ¿Se ejecuta? |
|---|---|---|
| `supabase/migrations/` | **La verdad.** Lo que construye la base | **Sí**, en orden de nombre |
| `supabase/historial_previo/` | Los 75 cambios aplicados entre el 11 y el 27 de julio, rescatados de la propia base el 2026-07-28 | **Nunca.** Es registro histórico |
| `backend/src/db/` | Archivo histórico congelado. Los 75 `.sql` sueltos de la etapa anterior | **Nunca.** No se agregan archivos nuevos ahí |

**`backend/src/db/` queda cerrado.** No se toca, no se agrega, no se corrige. Sirve para
consultar cómo se pensó algo en su momento, nada más. Todo cambio de esquema nuevo, sin
excepción, va a `supabase/migrations/`.

Ver `supabase/historial_previo/LEEME.md` para el detalle de por qué esas 75 anotaciones se
sacaron de la base (resumen: había que dejar el historial de producción alineado con el
repositorio, y sacarlas **no tocó ni una tabla** — es una libreta de apuntes, no la base).

## 4. Las tres reglas que no se negocian

1. **Una migración ya aplicada no se edita nunca.** Ni para arreglar un error de tipeo. Si algo
   salió mal, se arregla con una migración nueva hacia adelante. Editar una migración aplicada
   hace que la base de quien ya la corrió y la de quien no diverjan en silencio.
2. **Cada migración corre entera o no corre.** Postgres ejecuta cada archivo en una transacción,
   así que un error a la mitad revierte todo el archivo. No escribir nada que rompa eso
   (`CREATE INDEX CONCURRENTLY`, por ejemplo, no puede ir dentro de una transacción — si hace
   falta, va en su propio archivo y se documenta ahí mismo).
3. **El orden de los archivos es el orden de aplicación.** Se ordenan por nombre. No se
   renombra, no se reordena, no se intercala un archivo con fecha anterior entre dos ya
   aplicados.

## 5. Cómo se llama un archivo

```
supabase/migrations/AAAAMMDDHHMMSS_descripcion_en_snake_case.sql
```

Ejemplo: `20260728170000_quitar_plan_licencia.sql`

Los 14 dígitos son fecha y hora en UTC. Es el formato que espera la herramienta de línea de
comandos de Supabase.

## 6. Qué lleva adentro

Toda migración empieza con un comentario de cabecera que diga **qué hace y por qué**, no solo
qué tablas toca. Dentro de seis meses el "por qué" es lo único que no se puede reconstruir
leyendo el esquema. Si el cambio borra algo, la cabecera dice además **qué se comprobó antes**
de borrarlo y **cómo se vuelve atrás**.

Y toda migración que crea una tabla, en el mismo archivo:

- activa RLS (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) — regla 8 de `CLAUDE.md`;
- crea sus políticas;
- otorga los permisos de tabla que hagan falta (ver §7);
- deja `NOTIFY pgrst, 'reload schema';` al final si se aplicó directo contra Supabase, porque
  sin eso la API puede devolver 404 en tablas que sí existen.

Una tabla sin RLS no se sube. No hay caso en el que "después la agrego".

## 7. La puerta y la cerradura: RLS sin `GRANT` no sirve de nada

Postgres decide en **dos pasos** si alguien puede tocar una fila:

1. El **permiso de tabla** (`GRANT`) — ¿este rol puede tocar esta tabla, en general?
2. La **política de RLS** — de las filas de esa tabla, ¿cuáles?

La RLS es la cerradura; el `GRANT` es la puerta. **Una cerradura perfecta en una puerta tapiada
no deja pasar a nadie**, y el error que devuelve no habla de RLS: dice `42501 permission denied
for table X`. Si aparece eso, no se toquen las políticas — falta el paso 1.

## 8. Cómo se aplican

**En la máquina propia**, para desarrollar y probar. Desde
`F:\proyectos\celtatech\productos\careonys`:

```bash
supabase start
```

Levanta Postgres, Auth y PostgREST en contenedores y aplica todas las migraciones en orden. Para
volver a cero y aplicar todo de nuevo:

```bash
supabase db reset
```

Los puertos locales de Careonys son los `544xx` (API en 54421, base en 54422, Studio en 54423),
distintos a propósito de los del panel de CeltaTech, para que los dos puedan estar levantados al
mismo tiempo sin pisarse. Están fijados en `supabase/config.toml`.

**Contra producción.** Desde la misma carpeta:

```bash
supabase db push --linked
```

Aplica únicamente las migraciones que la base todavía no tiene. Para ver antes qué falta:

```bash
supabase migration list --linked
```

Muestra dos columnas, local y remoto. Si las dos coinciden, no hay nada pendiente.

**No se pega SQL en el editor del panel de Supabase.** Es exactamente lo que generó el problema
que esta página describe: deja la base cambiada y el repositorio sin enterarse.

## 9. Reconstruir desde cero

Correr todos los archivos de `supabase/migrations/` en orden sobre una base vacía tiene que dar
exactamente el esquema de producción. Si algún día deja de dar, hay una migración que se editó
después de aplicarse, o un cambio que se hizo a mano. Las dos cosas son defectos, no accidentes.

**Principio de certeza aplicado a esto:** no se declara que una migración funciona porque el
archivo "se ve bien". Se corre contra un Supabase de verdad —el local alcanza— y se compara el
resultado contra lo que se esperaba. Fue así como se validó la foto inicial, y así se validan
las que vengan.

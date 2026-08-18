# PLAN_CONTINUIDAD_PROVEEDORES.md — Resguardos ante caída o salida de un proveedor

> Origen: pendiente #15 de `docs/PENDIENTES.md` (inventario de dependencia de un solo
> proveedor — Supabase/Railway/Cloudflare Pages/Gmail/GitHub). Este documento cubre los puntos 1 a 4
> del roadmap acordado con el Desarrollador el 2026-07-13 (de lo simple/prioritario a lo
> complejo/no prioritario). El punto 5 (mirror en caliente de Supabase Auth) queda fuera de
> este documento — se discute aparte, por separado, y no está recomendado (ver cierre).

## Punto 2 — Prueba real de restauración de backup (hecha y verificada 2026-07-13)

`docs/SECURITY.md` ya documentaba el backup diario a dos buckets independientes de Supabase
(Cloudflare R2 principal + Backblaze B2 espejo, `backend/scripts/backup_a_buckets.mjs`), pero
el pendiente #4 de `docs/PENDIENTES.md` dejaba anotado un hueco honesto (Regla 12.5): nunca se
había restaurado ese backup dentro de una base Postgres viva, solo se había verificado que el
archivo subía y existía en los dos buckets.

**Procedimiento ejecutado:**

1. Se bajó el backup más reciente (`aurevia_backup_2026-07-13T09-23-51-351Z.sql.gz`,
   generado ese mismo día a las 09:23 UTC) directamente del bucket R2 de producción.
2. Se levantó un contenedor Postgres 16 efímero con Docker (`postgres:16-alpine`), sin
   ninguna relación con la infraestructura real — solo para esta prueba.
3. Se restauró el dump completo (`psql -f backup.sql`) dentro de ese contenedor.
4. Se verificó con `\dt public.*` que las 30 tablas de negocio del esquema `public`
   aparecen todas tras la restauración (`prestadoras`, `usuarios`, `asistentes`,
   `familias`, `pacientes`, `guardias`, `escalas_legales`, etc.).
5. Se compararon conteos de filas de 8 tablas clave entre la base restaurada y la base
   real de producción (vía el mismo pooler que usa el backup, `aws-1-sa-east-1.pooler.
   supabase.com`) — **coincidencia exacta en las 8**: `prestadoras` 1, `usuarios` 5,
   `escalas_legales` 16, y 0 en `asistentes`/`familias`/`pacientes`/`guardias`/
   `lista_precios` (no hay datos de prueba cargados en producción en este momento).
6. Se destruyó el contenedor y se borraron todos los archivos temporales (el dump
   descomprimido, el `.gz` descargado, y las credenciales usadas) del directorio de
   trabajo — no queda ningún rastro de datos reales de producción fuera de Supabase/R2/B2.

**Conclusión:** el backup diario no solo se sube correctamente — es un backup real,
restaurable, completo, y consistente con la producción. El hueco que dejaba abierto el
pendiente #4 queda cerrado.

**Repetir esta prueba:** no hace falta repetirla en cada sesión. Se recomienda repetirla
si cambia el esquema de forma significativa (nueva tabla con relaciones complejas, cambio
de motor de base) o, como mínimo, una vez cada varios meses, para detectar si algún cambio
futuro rompió silenciosamente la restaurabilidad del dump.

## Punto 3 — Plan de migración de Supabase Auth (documentado, no ejecutado)

Este plan es para el caso de que Supabase deje de ser viable como proveedor de
autenticación (cierre de cuenta, cambio de precios, discontinuación del servicio). Hoy
**no hay ninguna decisión de migrar** — esto es solo el plan a seguir si algún día hiciera
falta, para no empezar de cero en el peor momento posible.

### Qué hay que exportar de Supabase Auth

- Lista de usuarios: email, `id` (UUID), rol (`usuarios.rol` en la tabla propia del
  proyecto, no en Supabase Auth), fecha de alta, estado (activo/deshabilitado).
- **Los hashes de contraseña NO son exportables ni migrables tal cual** — Supabase Auth
  usa bcrypt con su propia configuración interna, y ningún proveedor externo (Auth0,
  Clerk) ni un esquema JWT propio puede re-verificar esos hashes sin acceso al mismo
  algoritmo exacto. Esto no es una limitación técnica que se pueda evitar con más
  trabajo: es así en cualquier migración de un proveedor de auth a otro.
- **Consecuencia obligatoria de cualquier migración real:** todos los usuarios del Panel
  (hoy: Admin, Superadmin, Admin_prestadora, Coordinador — ver glosario de `CLAUDE.md`)
  tendrían que resetear su contraseña la primera vez que entren al sistema nuevo. Esto se
  comunica por email antes del corte, no es un detalle a resolver en el momento.

### Alternativas de reemplazo (ninguna decidida — para evaluar si el caso se da)

| Opción | A favor | En contra |
|---|---|---|
| **Auth0** | Proveedor maduro, migración de usuarios asistida, soporta multi-tenant nativo (relevante para el modelo PLM/prestadoras) | Costo por usuario activo, otro proveedor externo del cual depender |
| **Clerk** | Más simple de integrar, buena UI de gestión lista para usar | Más joven que Auth0, menos historial en volumen alto |
| **JWT propio (backend Node/Express)** | Cero dependencia externa nueva, control total | Hay que construir y mantener: hashing de contraseñas, rotación de tokens, rate limiting de intentos fallidos, recuperación de contraseña — todo lo que hoy resuelve Supabase Auth gratis (ver `docs/SECURITY.md` líneas 16-21, que ya evaluó y descartó esto por redundante mientras Supabase funcione) |

No se recomienda decidir esto ahora — la decisión correcta depende de por qué se está
migrando (¿solo Auth, o toda la base también?) y de la escala del proyecto en ese momento
(cuántas prestadoras licenciatarias hay para entonces, bajo el modelo PLM). Este documento
existe para que, llegado el caso, no haya que investigar las opciones desde cero bajo
presión.

### Qué NO cambia en una migración de Auth

- La lógica de negocio (Regla de portabilidad ya documentada en `docs/SECURITY.md`
  líneas 33-45): vive en el backend propio, no en Supabase — migrar Auth no toca esa capa.
- Los datos de la base (`prestadoras`, `usuarios`, `asistentes`, etc.) — eso es
  Postgres/Supabase Database, un proveedor distinto de Supabase Auth, y ya tiene su propio
  resguardo (backup R2+B2, punto 2 de este documento).

## Punto 4 — Runbooks de proveedores de bajo riesgo

Los siguientes cuatro proveedores ya estaban evaluados como bajo riesgo / bajo esfuerzo de
migración (pendiente #15). Estos son los pasos concretos a seguir si alguno falla o hay
que reemplazarlo — para no tener que decidir el procedimiento en el momento de la caída.

### Railway (hosting del backend Node/Express)

1. El código del backend es un repo Git estándar (`backend/`), sin nada específico de
   Railway salvo variables de entorno — ver `backend/.env.example` para la lista completa.
2. Alternativas equivalentes: Render, Fly.io, un VPS propio con PM2 o Docker.
3. Pasos para migrar: crear el proyecto nuevo en el proveedor elegido, cargar las mismas
   variables de entorno (`backend/.env.example` como checklist), apuntar el mismo repo de
   GitHub (o hacer deploy manual del código), y actualizar la URL del backend en:
   - `panel/.env` para el desarrollo local, y el secreto `VITE_API_URL` del repositorio de
     GitHub para lo que se publica (`.github/workflows/publicar-pantallas.yml`) — es la
     variable que apunta a la dirección del backend.
   - Cualquier webhook configurado externamente (ej. el webhook de WhatsApp/Meta Cloud
     API, `docs/PRD_06_WhatsApp_IA.md`) — hay que reconfigurar la URL en el panel de Meta.
4. El `RAILWAY_TOKEN` usado en GitHub Actions (`docs/PENDIENTES.md` #1) solo sirve para el
   auto-deploy — no bloquea la migración, se reemplaza por el token/mecanismo equivalente
   del proveedor nuevo.

### Cloudflare Pages (hosting de las tres pantallas: Panel, Familias y Asistentes)

1. Las tres (`panel/`, `pwa-familias/`, `pwa-asistentes/`) son proyectos frontend estándar
   (Vite/React) y se publican **ya compiladas**: no hay nada propietario de Cloudflare
   adentro del código. Lo único específico del proveedor es el archivo `_redirects` de cada
   aplicación — una regla de una línea para que al recargar una pantalla interna no salga
   404.
2. Alternativas equivalentes: Netlify, Vercel, GitHub Pages (mientras el HTML no haya que
   armarlo del lado del servidor, que hoy no hace falta).
3. **Los proyectos de Cloudflare Pages son de subida directa: no están enganchados a
   GitHub.** Quien compila y publica es `.github/workflows/publicar-pantallas.yml`, que
   corre `npm run build` con las variables `VITE_*` guardadas como secretos del repositorio
   y después sube la carpeta ya compilada con `wrangler pages deploy`. Eso es justamente lo
   que hace fácil la mudanza: el proveedor recibe archivos terminados, así que cambiarlo es
   cambiar el último paso de ese archivo, no rehacer la compilación.
4. Pasos para migrar: crear los tres proyectos en el proveedor nuevo, reemplazar en ese
   archivo el paso de `wrangler` por el comando equivalente del proveedor nuevo, cargar allá
   el token que ese comando necesite (hoy son `CLOUDFLARE_API_TOKEN` y
   `CLOUDFLARE_ACCOUNT_ID`), y repuntar por DNS `gestion.careonys.com`,
   `familias.careonys.com` y `asistentes.careonys.com` al lugar nuevo.
5. Dos cosas que no se pueden olvidar en el proveedor nuevo, porque no fallan en la
   compilación sino en vivo: la regla de reescritura equivalente al `_redirects` (sin ella,
   toda dirección interna da 404 al recargar), y que el manifiesto y el `sw.js` de las dos
   aplicaciones se sirvan con el tipo de contenido correcto, o dejan de instalarse en el
   teléfono.
6. Las direcciones que el backend mete adentro de los correos de activación
   (`PWA_FAMILIAS_URL` y `PWA_ASISTENTES_URL`, configuradas en Railway) apuntan a los
   dominios propios, no a los del proveedor: mientras el DNS se repunte, esos correos no
   hay que tocarlos.
7. Recordar la Regla 13.1 en el proveedor nuevo también: confirmar si publica solo desde el
   `git push` o si hace falta un paso explícito, y dejarlo escrito en el automatismo, no en
   la memoria de nadie.

### Gmail SMTP (envío de emails transaccionales)

1. Uso actual: `SMTP_USER`/`SMTP_PASSWORD` (contraseña de aplicación de Gmail) vía
   Nodemailer, ver `backend/.env`.
2. Alternativas equivalentes: cualquier proveedor SMTP (SendGrid, Postmark, Amazon SES,
   Resend) — Nodemailer soporta cualquiera cambiando solo el `transport` de conexión, sin
   tocar la lógica de armado de emails.
3. Pasos para migrar: dar de alta cuenta en el proveedor nuevo, generar credenciales SMTP
   (o API key), reemplazar las 2 variables de entorno, y actualizar el `transport` de
   Nodemailer si el proveedor nuevo requiere una API en vez de SMTP puro (ej. SendGrid vía
   su SDK en lugar de SMTP).
4. Verificar el remitente/dominio (SPF/DKIM) del proveedor nuevo antes del corte, para que
   los emails no terminen en spam.

### GitHub (repositorio de código + Actions)

1. Es el proveedor de más bajo riesgo de los cuatro — el código y su historial completo
   ya están en el propio Git local de cada desarrollador, no solo en GitHub.
2. Alternativas equivalentes: GitLab, Bitbucket, un servidor Git propio.
3. Pasos para migrar: `git remote add nuevo-origen <url>` y `git push nuevo-origen
   --all --tags` desde cualquier clon local actualizado — no se pierde nada del historial.
4. Lo único que hay que reconstruir en el proveedor nuevo son los GitHub Actions
   (`.github/workflows/`) — el YAML de los workflows es portable casi literal a GitLab CI o
   Bitbucket Pipelines con ajustes de sintaxis menores, pero los *secrets* configurados
   (ej. `RAILWAY_TOKEN`) hay que volver a cargarlos a mano en el proveedor nuevo, no se
   exportan.

## Cierre

Puntos 1 (feature de subida de Certificado de Aptitud + mirror de almacenamiento), 2
(prueba de restauración), 3 (plan de migración de Auth) y 4 (runbooks) quedan resueltos con
este documento y el build de la feature de certificados (ver `docs/PENDIENTES.md` para el
detalle de aplicación pendiente de la parte de Supabase Storage). El punto 5 (mirror en
caliente de Supabase Auth) sigue explícitamente fuera de alcance y no recomendado —
se retoma en una conversación aparte si el Desarrollador quiere profundizarlo.

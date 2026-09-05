# CLAUDE.md — Reglas propias de Careonys

> **Acá está sólo lo que es exclusivo de este producto.** Lo demás no se repite, se consulta:
>
> | Qué | Dónde | Cómo llega |
> |---|---|---|
> | Lo común a todos los productos de CeltaTech | `..\..\CLAUDE.md` | **Se lee solo**, porque la línea de comandos junta los `CLAUDE.md` hacia arriba |
> | Lo de Careonys y el Marketplace | `..\..\docs\REGLAS_PRODUCTOS_CAREONYS.md` | **A mano, al empezar** |
> | El glosario de los dos | `..\..\docs\GLOSARIO_PRODUCTOS_CAREONYS.md` | **A mano, al empezar** |
> | Lo de este producto | este archivo | Se lee solo |
>
> Si una regla está escrita arriba, acá no se escribe. Si aparece repetida, se borra de acá.

## 1. Qué es Careonys

Plataforma de gestión para empresas dedicadas al cuidado de personas. **Careonys no presta
servicios de cuidado.** Las Prestadoras la usan con licencia, cada una en su propia Organización.
**Ninguna Prestadora tiene relación especial con CeltaTech ni trato privilegiado en el código.**

## 2. Sandbox

Organización ficticia reservada del sistema, sólo para desarrollo, pruebas, validación y demos
internas. No es una Prestadora comercial ni un cliente. **El nombre «Sandbox» queda reservado:
ninguna Prestadora real puede usarlo.**

## 3. De dónde sale cada advertencia legal

Qué funciones traen riesgo y qué dice cada aviso está en
`..\..\docs\REGLAS_PRODUCTOS_CAREONYS.md` §3, y los textos por país en `docs/legal/<país>.md`.
Acá sólo cómo se implementa:

**La fuente de las advertencias es una tabla configurable** —jurisdicción → función → texto—,
nunca texto escrito en el código.

**Lo mostrado queda en `auditoria_advertencias_legales`:** quién, cuándo, qué función, qué
advertencia se mostró.

## 4. Glosario

**El glosario de los productos Careonys es uno solo y no vive acá:**
`..\..\docs\GLOSARIO_PRODUCTOS_CAREONYS.md`. No se copia a este repositorio.

## 5. Los tres roles

Careonys tiene **tres** roles de Panel: Superadmin, Admin_prestadora y Coordinador. **No hay un
cuarto rol comercial, y no se agrega:** la gestión comercial de las cuentas es de CeltaTech y vive
en su propio panel.

**Superadmin** — rol técnico de CeltaTech. No representa una Prestadora ni la opera
comercialmente.
- Entrada propia; segundo factor por código temporal, activable desde Configuración.
- **Acá la Organización ficticia es Sandbox**, y la sesión de soporte se registra en
  `auditoria_soporte_tecnico`. La forma de esa sesión es la de la empresa y no se toca.
- La precedencia —sesión de soporte primero, Organización propia después— la define la función
  SQL `current_tenant()`, y el middleware `requiereRolPanel.js` la refleja, no la reinventa.

**Admin_prestadora** — administrador operativo, acotado a su propia Organización. Sin acceso a
otras Prestadoras ni a configuración global.

## 6. Lo propio de Careonys en el desarrollo

Lo común a todos los productos —no hardcodear, multiidioma, cuatro estados, apagar el botón,
sistema de diseño, RLS, auditoría, operaciones destructivas, importe con moneda, punto único de
verdad, módulos, commit y push— está en `..\..\CLAUDE.md` y **no se repite acá**. Lo del cuidado
de personas —glosario, riesgo legal, marca de la Prestadora, datos sensibles, financiador— está en
`..\..\docs\REGLAS_PRODUCTOS_CAREONYS.md`. Acá queda **cómo se cumple en este producto**.

**La identidad del producto sale de `src/config/identidadProducto.js`.** Marcador `{{producto}}` /
`{{productoCorto}}` en traducciones y HTML, `IDENTIDAD.nombre` en código. Lo que **persiste** —base
IndexedDB, prefijo de respaldo, clave de entitlement— usa `IDENTIDAD.codigo`. Ese archivo existe
cinco veces, una por unidad desplegable, y `scripts/verificar_identidad.mjs` corta el push si las
cinco no coinciden o si el nombre está escrito a mano.

**El `codigo: 'aurevia'` no se renombra.** Es identificador guardado, no marca. Está adentro de
datos que ya existen y de las claves de entitlement que se arman con él
(`aurevia.pacientes.activos_max`). Ver la excepción del glosario, §4.

**Dónde vive la marca de la Prestadora.** En las dos aplicaciones, `src/context/PerfilContext.jsx`
la pide una vez a `/perfil` y la entrega con `useMarca()` (`nombre`, `logoUrl`,
`mostrarMarcaProducto`); el aviso al celular la lee de `src/lib/marcaGuardada.js`, porque el
trabajador de fondo no tiene sesión; del lado del motor la arma
`backend/src/utils/marcaPrestadora.js` con `prestadoras.nombre_fantasia` y `prestadoras.logo_url`.
La línea al pie —*«con la tecnología de {{producto}}»*— depende del entitlement
`aurevia.marca.personalizada` y es el **único** uso de `IDENTIDAD` en una superficie de Familia o
Asistente. Excepción abierta: la pantalla de ingreso, donde todavía no se sabe de qué Prestadora
se trata (pendiente #141). Detalle en `docs/MARCA.md` §0.

**El trato se le dice al modelo una sola vez**, en `backend/src/utils/tratoIA.js`. Ningún prompt
copia ese párrafo, y los prompts tampoco tutean al modelo, porque eso lo empuja a contestar así.
Detalle en `docs/AI_PROMPTS.md`.

**Los errores los clasifica `lib/errores.js`** en ocho situaciones —sin conexión, sesión vencida,
sin permiso, no encontrado, duplicado, en uso, dato mal cargado, falla del sistema— y muestra la
frase de las traducciones en los tres idiomas. El texto crudo queda en la consola.

**Entre carpetas que se despliegan por separado, el punto único de verdad es un original más
copias idénticas.** El Panel, las dos aplicaciones y el motor no pueden importarse entre sí. La
lista de qué archivo es copia de cuál está en `scripts/copias_entre_apps.mjs`,
`scripts/sincronizar_copias.mjs` las regenera y `scripts/verificar_identidad.mjs` corta el build si
alguna se despegó. Nunca una copia editada a mano.

**La moneda de cada importe se completa sola.** La de la Prestadora está en `prestadoras.moneda`,
nace del país configurado y se cambia desde Configuración; la de cada importe, en la columna
`moneda` de su tabla, que la función `public.moneda_de_prestadora` completa al insertar. Los gastos
propios de CeltaTech, siempre en dólares, llevan la moneda en el nombre (`costo_usd`) y no se
renombran.

**Alcance, para que la regla de la moneda no se estire:** Careonys **no emite comprobantes
fiscales y no está previsto que lo haga.** No hay tipo de comprobante, ni punto de venta, ni
numeración autorizada, ni impuestos discriminados. Pide la moneda y nada más. Si algún día un
importe se convierte, ahí sí se guarda la cotización usada con su fecha.

**Las funciones internas de la base no viven en un esquema publicado.** Las que usan las políticas
de RLS están en el esquema `interno`, que queda afuera de la lista `schemas` de
`supabase/config.toml` a propósito: así no son direcciones web. Las políticas las siguen
encontrando porque guardan el identificador interno de la función, no su nombre. **Una función se
queda en `public` solamente si el navegador la llama a propósito, y entonces no puede recibir un
identificador que la apunte a otra Prestadora** — hoy la única es `ausencias_que_tapan`, que recibe
dos fechas y resuelve la Prestadora adentro con `current_tenant()`. Toda función nueva de política
nace en `interno`, y cualquiera que se quede en `public` y llame a una de ahí lleva `interno` en su
`search_path`. El reparto de permisos —cuáles pierden el alcance anónimo y cuáles conservan
`authenticated`— está en
`supabase/migrations/20260823010000_las_funciones_internas_de_la_base_no_se_llaman_desde_afuera.sql`,
y la mudanza en
`supabase/migrations/20260904090000_las_funciones_internas_salen_del_esquema_publicado.sql`.

**El motor entra a la base con la llave maestra, y eso es una decisión, no un olvido.** Las dos
aplicaciones de teléfono no consultan la base: le piden todo al motor, y el motor entra con la
llave de servicio, que se saltea la protección por fila. Lo que aísla una Prestadora de otra son
los filtros escritos en cada ruta, y `scripts/probar_aislamiento.mjs`, que falla si alguno falta.
Las políticas de las quince tablas que leen esas pantallas existen igual —se escribieron el
2026-09-04— y son la segunda red: hoy alcanzan lo que ya se consulta con el pase de la persona, y
quedan puestas si algún día cambia el resto. **Pasar el motor al pase de la persona se evaluó y se
descartó** (Desarrollador, 2026-09-04). La propuesta salió de una revisión de arquitectura hecha
por Claude Code, por analogía con OctoCMS, y no de un defecto observado. Obligaría a habilitar,
para cualquiera con sesión, dos funciones que hoy sólo alcanza el motor; una de ellas recibe el
identificador de una Prestadora y contestaría sobre cualquiera. Es abrir una puerta nueva para
cerrar un riesgo que ya cubren los filtros y la prueba. **Quien vuelva a proponerlo tiene que
contestar antes esa objeción.**

**Ninguna palabra de Careonys entra en un módulo** —Prestadora, Guardia, Paciente, Servicio— si el
otro producto no la tiene. Todavía no hay ningún módulo; sacar una pieza de acá para convertirla
en uno entra por `..\..\CLAUDE.md` §11, nunca como parte de otra tarea. Anotado en `docs/PENDIENTES.md` #173.

**Nunca datos reales en pruebas: se usa Sandbox y datos inventados.**

**Antes de cerrar una tarea:** ¿se consultaron los tres archivos de reglas? ¿aislamiento entre
Organizaciones mantenido? ¿términos del glosario aprobados? ¿cuatro estados cubiertos?
¿documentación al día? Si alguna respuesta es no, la tarea no está terminada.

## 7. Despliegue

**Un push no es un despliegue por sí solo — lo es porque hay un automatismo que lo convierte en
uno.** Cada `push` a `main` que toca `backend/`, `panel/`, `pwa-familias/` o `pwa-asistentes/`
dispara el despliegue de esa parte (`.github/workflows/deploy-backend.yml` y
`publicar-pantallas.yml`). Los proyectos de Cloudflare Pages son de **subida directa**: no están
enganchados a GitHub, publica el automatismo. Comprobar que salió bien con `gh run list` y la
dirección en vivo respondiendo.

## 8. `Exclusivo <Prestadora>/`

Carpeta reservada: guarda lo que es puramente de una Prestadora —su identidad de marca, su
configuración de negocio, su investigación de competencia—. **No se entra: no se lee, no se lista,
no se cita su contenido**, salvo orden explícita del Desarrollador en esa misma sesión. No alcanza
con que la tarea roce el tema, y el permiso no se hereda de una sesión a la siguiente. Cualquier
carpeta nueva con material de una sola Prestadora se nombra igual y queda bajo esta regla.

## 9. Protocolo de sesión

Lo general está en `..\..\CLAUDE.md` §12. Acá, lo de este producto.

**Al iniciar:** leer este archivo, `..\..\CLAUDE.md`,
`..\..\docs\REGLAS_PRODUCTOS_CAREONYS.md`,
`..\..\docs\GLOSARIO_PRODUCTOS_CAREONYS.md`, `docs/CONTEXT.md`, `docs/BUILD_ORDER.md` —la tabla de
etapas con el estado de cada una— y el PRD de la etapa actual. Confirmar en una línea: *«Leí los
documentos correspondientes. Etapa actual: [X]. Última tarea completada: [Y]. Tarea de esta
sesión: [Z].»*

**Cómo se escribe la ruta de un documento.** Hay dos carpetas `docs/`: la del producto y la de la
empresa. Un documento del producto se cita desde la raíz del producto —`docs/CONTEXT.md`—; uno de
la empresa, con la ruta entera desde `celtatech/` —`celtatech/docs/ARQUITECTURA_NIVELES.md`—.

**El estado real se consulta acá:** la base local con
`docker exec supabase_db_aurevia psql -U postgres -d postgres -c "…"`, y qué migraciones corrieron
en la nube con `supabase migration list --linked`.

**Por qué cambió una regla** va a `docs/claude_history.md`, en una línea: qué decía antes, qué
dice ahora y el motivo. Se revisa antes de proponer algo que suene a tema ya debatido.

**Pendientes:** `docs/PENDIENTES.md`. Un pendiente que se cierra se borra; la fila entera se
elimina.

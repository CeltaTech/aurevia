# CLAUDE.md — Reglas no negociables del proyecto Careonys / CeltaTech

> Se lee primero, en cada sesión, antes de escribir una sola línea de código.
> Este archivo refleja siempre el estado **vigente** de las reglas — se actualiza solo cuando una regla cambia. El historial de cómo se llegó a cada regla vive en `docs/claude_history.md` (ver §10), no acá.

## 1. Qué es esto

**CeltaTech** es la empresa tecnológica propietaria, desarrolladora y licenciante del software. Desarrolla productos SaaS propios, sin estar limitada a una industria específica.

**Careonys** es el primer producto de CeltaTech: una plataforma SaaS de gestión para empresas dedicadas al cuidado de personas. Careonys **no presta servicios de cuidado** — es la tecnología que permite a las Prestadoras administrar sus operaciones, equipos y relaciones operativas.

Modelo de negocio:
- CeltaTech desarrolla, mantiene y evoluciona la plataforma.
- Las Prestadoras la usan mediante licencia SaaS.
- Cada Prestadora opera en un entorno independiente, aislado del resto, desde el diseño inicial.
- Ninguna Prestadora tiene relación especial con CeltaTech ni trato privilegiado en el código.

## 2. Arquitectura multi-tenant (regla fundamental del producto)

Careonys es multi-tenant real desde el origen — no un sistema mono-empresa adaptado después. La entidad técnica que aísla datos es la **Organización** (una Organización = una Prestadora).

Toda funcionalidad nueva debe garantizar:
- aislamiento total de datos entre Organizaciones (aplicación **y** base de datos, nunca solo frontend);
- usuarios, configuración y operaciones separados por Organización;
- permisos evaluados siempre en el contexto de una Organización;
- cero accesos cruzados, ni siquiera accidentales;
- escalabilidad a cientos/miles de Prestadoras sin rediseño estructural.

**Pregunta de diseño obligatoria ante cualquier decisión técnica:** *"¿Esto funciona correctamente cuando existan cientos de Prestadoras usando Careonys simultáneamente?"* — no "¿funciona para una empresa?".

**Configuración sobre programación:** una diferencia entre Prestadoras es una característica de negocio, no una excusa para código duplicado, versiones especiales o excepciones individuales. Se resuelve con configuración (parámetros, permisos, textos, reglas operativas).

### Sandbox
Organización ficticia reservada del sistema, solo para desarrollo, pruebas, validación y demos internas.
- No es una Prestadora comercial ni un cliente.
- Usa exactamente la misma arquitectura de seguridad, permisos y aislamiento que cualquier Prestadora real — **cero excepciones de código** (nunca `si organización = Sandbox entonces permitir excepción`).
- El nombre "Sandbox" queda reservado por el sistema; ninguna Prestadora real puede usarlo.

## 3. El riesgo legal en el módulo de Asistentes

**Alcance:** el marco legal aplicable a cada Prestadora depende de su jurisdicción. Este archivo no desarrolla el contenido legal — vive en documentos dedicados por país (ej. `docs/legal/argentina.md`). CLAUDE.md solo fija el principio de diseño y remite a esos documentos cuando haga falta precisión.

**Principio de diseño:** el software no impone ni bloquea funciones por razones legales — solo advierte cuando una configuración elegida por la Prestadora puede generar un riesgo legal conocido en su jurisdicción, según lo que registre el documento legal correspondiente.

Todas las funciones de gestión de Asistentes (penalización de inasistencias o inconductas, rankings, puntuaciones por aceptación de guardia y por calificación de Familia/Paciente, límite de oportunidades futuras por rechazos, niveles/categorías/jerarquías por servicio, horarios fijos, y cualquier otra que se agregue) están **disponibles sin restricción para toda Prestadora, en cualquier país, desde el día uno.**

Mecánica:
- al activar una función con riesgo legal conocido en la jurisdicción configurada de la Prestadora, se muestra una **advertencia** con el riesgo específico, tomada del documento legal de esa jurisdicción (ej. ver `docs/legal/argentina.md` para el riesgo de indicio de subordinación bajo art. 23 LCT);
- si la jurisdicción no tiene documento legal cargado, no se muestra advertencia — no se inventa una por analogía con otro país;
- la advertencia y su activación quedan auditadas (quién, cuándo, qué función, qué advertencia se mostró);
- ningún toggle arranca en un valor por decisión del sistema basada en lo legal — el default es una elección de configuración de la Prestadora.

**Fuente de las advertencias:** tabla configurable (jurisdicción → función → texto de advertencia), nunca hardcodeada — coherente con la Regla 1 (§7) y con §2.

**Condición antes de lanzar en un país nuevo:** antes de habilitar Careonys para una Prestadora real de un país determinado, debe existir el documento legal de esa jurisdicción en `docs/legal/<país>.md` — aunque sea mínimo. No hace falta tenerlo completo, pero sí que exista como archivo antes de dar de alta la primera Prestadora real de ese país. Es una condición de proceso, no una validación técnica bloqueante del software.

**Autonomía del Asistente (modalidad marketplace):** disponible siempre, independiente de estos toggles — ver condiciones de la guardia ofrecida, decidir participación, gestionar disponibilidad, mantener independencia operativa.

**Cálculos legales/económicos:** todo módulo de costos o compensaciones soporta múltiples modalidades contractuales, nunca asume que el modelo actual es permanente. Cargas, porcentajes, topes y escalas siempre desde fuentes configurables por jurisdicción vigente — ver documento legal correspondiente —, nunca como constantes en código, y siempre a la fecha del hecho (no la fecha actual).

## 4. Glosario obligatorio

Aplica a código, nombres de variables/tablas/componentes, claves de i18n, texto visible, documentación y commits. Antes de usar un término de negocio nuevo: verificarlo contra esta tabla; si no está, proponerlo para aprobación antes de usarlo.

Esta tabla se mantiene siempre en su versión **vigente** — sin notas de fecha, sin términos retirados, sin historial de cambios. Cuando un término cambia o se retira, la entrada de esta tabla se reemplaza sin más, y el cambio (qué decía antes, qué dice ahora, por qué, cuándo) queda registrado en `docs/claude_history.md` (§10), no acá.

| Usar siempre | Nunca decir |
|---|---|
| CeltaTech | nombres anteriores de la empresa; "software de CeltaTech" al referirse al producto |
| Careonys | "Aurevia", el nombre anterior del producto. Única excepción: la clave técnica `codigo: 'aurevia'` de `identidadProducto.js` y las claves de entitlements que se arman con ella (`aurevia.pacientes.activos_max`), que son inmutables por diseño y **no** se renombran |
| Prestadora, o **empresa prestadora** — las dos formas valen indistintamente (sinónimo aceptado además: "licenciataria", cuando el contexto es específicamente la relación de licenciamiento SaaS con CeltaTech). Es el caso específico de un cliente de CeltaTech que contrata Careonys — no todo cliente de CeltaTech es una Prestadora (podría contratar otro producto de CeltaTech sin dedicarse al cuidado de personas; ver `celtatech/docs/ARQUITECTURA_NIVELES.md`) | "empresa" a secas (ambigua: a nivel CeltaTech significa cualquier cliente, no una Prestadora), empresa cliente, organización comercial, empresa usuaria (fuera del sentido técnico del sistema) |
| Cliente (a secas, únicamente cuando se habla desde la perspectiva de CeltaTech/Nivel 1 sobre cualquier empresa que le contrata un producto, sea o no Careonys) | usar dentro del contexto de Careonys para referirse a la Familia o a la Prestadora — dentro de Careonys esos dos roles siempre llevan su propio nombre, nunca "cliente" genérico. Dentro de Careonys la única acepción válida es la forma corta de **Cliente Contratante** (ver la entrada siguiente) |
| Cliente Contratante — quien contrata un Servicio y a quien se le cobra: una Familia, una Obra Social, o cualquier otro que contrate. Es el término **completo**, el que se usa en documentos y donde pueda haber duda. **En pantalla y en la charla se dice "Cliente" a secas** — es la palabra que la gente usa, y no se pelea con ella. En el código y en la base el identificador es `contratante`, que nombra la función y no se confunde con el "Cliente" de CeltaTech | escribir "Cliente Contratante" en un botón, una etiqueta o un título de pantalla (ahí va "Cliente"); usarlo para la Familia cuando lo que se quiere decir es la Familia (ahí va "Familia"); confundirlo con el Paciente (quien recibe el cuidado) ni con quien paga (puede ser otro, si la Obra Social cubre una parte) |
| Organización | entidad técnica multi-tenant — no confundir con "Prestadora" en texto de negocio |
| Sandbox | empresa cliente, Prestadora real, organización comercial |
| Asistente — es el término **genérico**, el único que usan el código y las tablas. Cuidador/a, enfermero/a, kinesiólogo/a, médico/a, etc. no son otros nombres del Asistente: son **tipos** de Asistente (ver la entrada siguiente) | empleado/a, trabajador/a; usar el nombre de un tipo ("cuidador") como si fuera el término general |
| Tipo de Asistente — **qué es** un Asistente: cuidador/a, enfermero/a, kinesiólogo/a, médico/a, y los que cada Prestadora agregue. Vive en un catálogo de dos niveles (general de CeltaTech + propio de cada Prestadora). Cada tipo define sus Tareas y si requiere Matrícula | especialidad (retirada el 2026-08-11), categoría, puesto, rol (rol es del sistema, ver §5) |
| Tareas — **qué hace y qué no hace** un tipo de Asistente. Son siempre dos listas separadas, nunca un párrafo que las mezcle: las que le corresponden y las que no. La segunda existe porque es la que evita la confusión con las Familias, y por eso pesa igual que la primera | funciones, incumbencias, perfil del puesto, "descripción de tareas" como texto único |
| Familia | cliente, usuario |
| Paciente | adulto mayor (salvo contexto clínico específico) |
| Servicio — todo lo que la Prestadora acordó hacer por un Cliente y le cobra por eso: las horas de cuidado, la enfermería, la kinesiología, los traslados, la limpieza de la casa, lo que se haya acordado. Es el acuerdo entero. Cada cosa del acuerdo tiene sus propios días y horarios, y empieza y termina cuando le toca: una puede sumarse en mayo y otra terminarse en junio, y el Servicio sigue abierto igual. Un mismo Servicio puede cuidar a más de un Paciente, por ejemplo a un matrimonio | guardia, prestación, solicitud |
| Prestación — cada cosa del acuerdo, con su precio. El Servicio es el acuerdo entero; la prestación es cada cosa que hay adentro. Unas se cubren con guardias, como el cuidado por horas; otras se hacen y se cobran de una vez, como un traslado o una limpieza. **Siempre lleva su alcance escrito en dos listas separadas: qué incluye y qué no incluye** — la segunda es la que evita los malentendidos con la Familia | servicio, guardia, renglón de la lista de precios; un párrafo único que mezcle lo que incluye con lo que no |
| Cerrar un Servicio — la finalización definitiva de ese Servicio: se deja de prestar y se deja de cobrar, se dan de baja sus prestaciones, se cancelan sus guardias futuras y se avisa a los Asistentes que se quedan sin ese trabajo. Nada se borra. **Sinónimo aceptado, de la jerga del rubro: "levantar el servicio"**, que se usa sobre todo cuando la decisión de terminar la toma la Prestadora | confundirlo con cerrar una Guardia; confundirlo con dar de baja a un Paciente |
| Guardia — las horas seguidas que un Asistente pasa cuidando, desde que llega hasta que se va. En esas horas atiende a uno o a varios Pacientes: un matrimonio en su casa, o un grupo entero en una residencia. Cada Paciente atendido tiene su propio Reporte diario. La guardia es una parte de un Servicio | turno, jornada, servicio, visita |
| Subcontratación — la tercera **modalidad de trabajo** de una Prestadora, junto con prestación directa y marketplace: la Prestadora toma un servicio de un cliente (por ejemplo una Obra Social) y se lo deriva a otra empresa, que lo cubre con su propio plantel. Valor guardado: `subcontratacion` | "cooperativa" (nombre anterior, retirado el 2026-08-07 porque nombraba otra cosa — ver `docs/claude_history.md`); tercerización; derivación |
| Empresa subcontratada — la otra empresa, la que pone su propio plantel y cubre el servicio derivado. No es una Prestadora (no tiene licencia de Careonys) ni un Asistente | proveedor a secas, contratista, "la cooperativa" |
| Coordinador (sinónimo aceptado: "supervisor" — hoy son la misma cosa con otro nombre; si en versiones futuras se separan, se separan acá. El rol en el código sigue llamándose `coordinador`) | jefe, encargado |
| Estado actual — la pantalla de entrada del Panel: arriba lo que no está bien hoy, abajo la semana entera. Se llama así porque eso es lo que contesta: *cómo está todo ahora mismo*. En el código: `pages/EstadoActual.jsx`, clave `estado_actual` | mostrador (retirado: nombraba el mueble, no lo que la pantalla muestra), estatus (es "status" adaptado del inglés, ver la pregunta 3 más abajo), tablero, dashboard, home, inicio |
| Reporte diario | informe, planilla, parte |
| Vínculo / Cese | contrato de trabajo, despido (salvo causal literal de despido) |
| Proceso de Incorporación de Asistentes | selección, filtro, pipeline, reclutamiento |
| Certificado de Aptitud | certificado genérico, diploma, certificado propio de una Prestadora |
| Obra Social | IOMA (salvo que sea literalmente la obra social configurada por esa Familia/Paciente), obra social genérica no configurable |
| Número de afiliado | ioma_afiliado, afiliado IOMA |
| Ausente sin relevo previo | cualquier término en inglés o genérico para el caso de un Asistente que no se presenta a una Guardia cuando no había ningún otro Asistente cubriendo antes de él (ej. primera guardia del día para un Paciente) — distinto de un ausente con relevo, donde sí hay alguien saliente esperando |
| Documentación (vencimientos documentales de Asistentes, por Prestadora) | compliance, cumplimiento normativo |
| Indicación de medicación (medicamento/dosis/frecuencia/vía solicitados por la Familia para un Paciente, sujeta a aceptación del Panel) | medicación habitual (deprecado, ver `pacientes.medicacion_habitual`), orden médica genérica |
| Matrícula — **qué autoriza legalmente** a ejercer a un Asistente, emitida por el colegio o el organismo que corresponda (número, vigencia, archivo). Los tipos de Asistente que la requieren no pueden atender a ningún Paciente sin ella vigente y verificada. Distinta de las Tareas (qué hace) y del Tipo (qué es) | habilitación (retirado: se leía como "habilidades del Asistente", es decir lo contrario de lo que significa), certificación genérica, licencia, permiso |
| Desarrollador (quien dirige el desarrollo y aprueba las decisiones elevadas) | nombre propio de esa persona como estand-in genérico; no es un rol del sistema (ver §5) |
| multi-tenant, SaaS, RLS, MFA, Sandbox | — (términos técnicos permitidos tal cual) |

**Verificación al cerrar cualquier tarea que tocó texto visible:** ¿se incorporó algún término nuevo no aprobado? Si sí, la tarea no está terminada hasta agregarlo al glosario o reemplazarlo.

**Cómo se escribe una definición.** El glosario lo lee cualquiera —una Coordinadora, una Familia, alguien que entró ayer—, no quien programó el producto. Entonces: se dice **qué es** la cosa, no qué no es (para eso está la columna de al lado); sin nombres de tablas, de columnas, de archivos ni de números de pendiente; sin mandar a otro documento a buscar "la definición completa" — si hace falta un documento aparte para definir una palabra, la definición está mal escrita; y con un ejemplo de la vida real cuando ayude a entender. Si hay que explicarla cada vez que aparece, la definición no está funcionando.

**Cinco preguntas antes de proponer una palabra nueva.** La tabla dice qué palabras están aprobadas; esto dice contra qué se aprueba una que todavía no está. Solo si pasa las cinco se propone:

1. ¿Ya existe una palabra aprobada para esto? Si existe, no hace falta otra.
2. ¿La palabra es del negocio o de la tecnología? Ante la duda, la del negocio gana: el producto lo usan Coordinadoras, no programadores.
3. ¿Hay una equivalente clara en castellano? Si la hay, se usa esa.
4. Si es en inglés, ¿está tan aceptada en informática que traducirla confundiría más que aclarar? (`multi-tenant`, `SaaS`, `RLS` pasan esta prueba; casi ninguna otra.)
5. ¿La entiende alguien que no conoce el tema? Si hace falta explicarla cada vez que aparece, la palabra no está funcionando.

**Equivalencias de uso corriente.** No es prohibición de términos técnicos: es que, existiendo la forma en castellano, se escribe en castellano.

| En vez de | Escribir |
|---|---|
| Workflow engine | Motor de flujo de trabajo |
| Business intelligence | Análisis de información del negocio |
| Core engine | Motor principal del sistema |
| Deployment | Publicación de una nueva versión |
| Logging | Registro de actividades |
| CRUD | Alta, baja, modificación y consulta (o "administración de información") |

*Excepción:* los **nombres comerciales** —de un plan, de un módulo que se vende— son una decisión de marca y pueden quedar como estén. Esta tabla rige el texto que describe el producto, no cómo se llama lo que se vende.

## 5. Roles del sistema y control de acceso

Separación estricta entre roles técnicos, administrativos y operativos. Ningún rol obtiene acceso implícito por pertenecer a CeltaTech. Principio de mínimo privilegio siempre: cada rol solo los permisos que su función requiere, nunca por comodidad de desarrollo.

Careonys tiene **tres** roles de Panel: Superadmin, Admin_prestadora y Coordinador. El rol comercial que antes existía acá, `Admin_plataforma`, **ya no existe en Careonys**: la gestión comercial de las cuentas de Prestadoras es asunto de CeltaTech (Nivel 1) y vive en su propio panel. Ver `celtatech/docs/PLAN_SEPARACION_CELTATECH.md`, Etapa 2.

**Superadmin** — rol técnico de CeltaTech. Infraestructura, mantenimiento técnico, configuración global, soporte interno. No representa una Prestadora, no la opera comercialmente.
- **Restricción dura de acceso:** fuera de una sesión de soporte técnico, Superadmin tiene acceso de Panel **únicamente** a la Organización Sandbox. Vedado el acceso a datos de cualquier Prestadora real por la vía ordinaria, sin excepción.
- Si una tarea técnica requiere operar sobre una Prestadora real, se hace **siempre** abriendo una **sesión de soporte técnico** (ver abajo), nunca por fuera de ella.
- Login propio; MFA por TOTP disponible, activable/desactivable desde Configuración. Todo acceso queda auditado.
- **Sesión de soporte técnico** — la única puerta de Superadmin hacia una Prestadora real. Una Prestadora por vez, sin visibilidad de otras mientras está activa.
  - banner visible con la Prestadora activa;
  - advertencia adicional antes de operaciones destructivas;
  - log de auditoría de todo acceso y acción sensible, en `auditoria_soporte_tecnico`;
  - timeout por inactividad: 5 min; tope absoluto de sesión: 60 min; aviso a los 50 min si sigue activa.
  - El orden de precedencia —sesión de soporte abierta primero, Organización propia después— es el mismo en la base y en la aplicación: lo define la función SQL `current_tenant()` y el middleware `requiereRolPanel.js` la refleja, no la reinventa (§7.12).

**Admin_prestadora** — administrador operativo, acotado exclusivamente a su propia Organización: usuarios internos, configuración operativa, roles, procesos y datos propios. Sin acceso a otras Prestadoras ni a configuración global del sistema.

**Regla de aislamiento (aplica a los tres roles y a cualquier consulta):** toda consulta/modificación/eliminación de datos valida explícitamente Organización + rol + permisos antes de ejecutarse. No existen consultas globales desde módulos operativos. Nunca asumir que una operación es válida solo por venir de una interfaz autorizada.

## 6. Seguridad, privacidad y auditoría

- **RLS estricta en toda tabla nueva de Supabase**, sin excepción — el aislamiento nunca depende solo del frontend.
- **Datos sensibles** (remuneraciones, causales de cese, certificados médicos, antecedentes, información clínica, credenciales) nunca en URLs, parámetros GET, logs ni mensajes públicos.
- **Auditoría** de toda acción sensible: login administrativo, cambios de permisos, eliminación de datos, modificaciones críticas, acciones en modo Prestadora. El registro debe permitir reconstruir quién, cuándo, sobre qué Organización, qué operación.
- **Operaciones destructivas**: confirmación explícita siempre (qué se hará, qué consecuencia tiene, opción de cancelar) + registro de auditoría +, cuando corresponda, reservorio/mecanismo de recuperación de lo eliminado.
- **Variables de entorno** para toda credencial/token/clave — nunca en código ni en el repositorio.
- **Ambientes de desarrollo**: nunca datos reales de Prestadoras/Familias/Pacientes/Asistentes en pruebas; usar Sandbox y datos ficticios.

**Regla final de seguridad:** un error de configuración nunca debe permitir que una Prestadora acceda a información de otra. Es una garantía esencial del producto, no un objetivo aspiracional.

## 7. Reglas no negociables de desarrollo

1. **Nunca hardcodear** texto visible, precios, honorarios, valores legales, reglas operativas ni datos de contacto — siempre desde configuración, base de datos o archivos de traducción.
   - **El nombre del producto y su marca entran en esta regla, sin excepción**: ni en texto visible, ni en el manifiesto de una PWA, ni en el `<title>` de un `index.html`, ni en el asunto de un email, ni en un prompt de IA, ni en el nombre de un producto de pasarela. Salen siempre de `src/config/identidadProducto.js`: marcador `{{producto}}` / `{{productoCorto}}` en archivos de traducción y en HTML, `IDENTIDAD.nombre` en código. Todo lo que **persiste** (nombre de una base IndexedDB, prefijo de un archivo de backup, clave de entitlement) usa `IDENTIDAD.codigo`, que no cambia nunca ni siquiera si la marca se renombra. Ese archivo existe cinco veces —una por unidad desplegable, porque cada una se despliega sin acceso al resto del repo— y `scripts/verificar_identidad.mjs` verifica en cada push que las cinco coincidan y que el nombre no esté escrito a mano en ningún lado.
   - **Pero la marca del producto no es la marca de la Prestadora.** Acá hay tres marcas: **CeltaTech** (la empresa, no la ve nadie dentro del producto), **Careonys** (el producto, la ve quien trabaja *en* la Prestadora y sabe qué software usa) y **la Prestadora** (la que contrataron la Familia y el Asistente). En toda pantalla, email o notificación dirigida a una Familia o a un Asistente, **la marca principal es la de su Prestadora** — `prestadoras.nombre_fantasia`, leída del tenant de esa sesión —, nunca `identidadProducto.js`. El modelo es **co-branding** (decidido el 2026-07-27): el producto aparece solo en una línea discreta al pie, *"con la tecnología de {{producto}}"*, condicionada al entitlement `aurevia.marca.personalizada` — ese es el **único** uso admitido de `IDENTIDAD` en una superficie de Familia o Asistente. Se cumple desde el 2026-08-08 (pendiente `#95`, cerrado): el logo o el nombre de la Prestadora encabeza las dos aplicaciones, el correo de activación y el aviso que llega al celular. **La regla sigue rigiendo hacia adelante:** en `pwa-familias/` y en `pwa-asistentes/` no se agrega ningún uso de `IDENTIDAD` fuera de esa línea al pie — la marca sale de `MarcaContext`. Única cosa que todavía muestra el producto: la pantalla de ingreso, porque antes de entrar no hay forma de saber de qué Prestadora se trata (pendiente `#141`). Ver `docs/MARCA.md` §0.
   - **Un mensaje de error también es texto visible.** Ninguna pantalla muestra lo que devuelven el navegador o la base tal cual: `lib/errores.js` clasifica el error en una de ocho situaciones —sin conexión, sesión vencida, sin permiso, no encontrado, duplicado, en uso, dato mal cargado, falla del sistema— y muestra la frase que corresponde de las traducciones, en los tres idiomas. El texto técnico crudo queda en la consola del navegador, que es donde sirve. Una Coordinadora no tiene por qué leer `Failed to fetch` ni el nombre de una tabla.
2. **Multiidioma desde el día uno**: toda clave nueva se agrega simultáneamente en `es-AR`, `en`, `pt-BR`. No se construye una función en un solo idioma "para traducir después".
3. **Todo componente que carga datos maneja 4 estados**: loading / error / vacío / listo.
4. **Toda operación destructiva requiere confirmación explícita** (ver §6).
5. **Todo botón que dispara una operación se deshabilita mientras está en curso** — nunca doble envío.
6. **CSS/diseño visual solo con el sistema de diseño de Careonys** — nunca colores, tipografías o estilos inventados fuera de la paleta.
7. **Nunca exponer información sensible** en logs, URLs o mensajes públicos (ver §6).
8. **RLS estricta** en cada tabla nueva, con Organización asociada cuando corresponda (ver §6).
9. **Git**: commit + push tras cada conjunto de cambios coherente. Mensajes en español, formato `tipo: descripción breve` (`feat:`, `fix:`, `docs:`, etc.). Nunca subir `.env`, credenciales ni datos reales.
10. **Cálculos legales/económicos siempre parametrizados** — nunca números escritos en código; siempre la escala vigente a la fecha del hecho (ver §3).
11. **Compatibilidad multiplataforma obligatoria**: Windows/macOS/Linux/Android/iOS × Chrome/Firefox/Safari/Edge. No asumir un único navegador o dispositivo (traducción automática del navegador, permisos de cámara, geolocalización, notificaciones, PWA).
12. **Ningún patrón de lógica repetido sin punto único de verdad**: si la misma decisión (regla de acceso, validación, cálculo, mapeo de estado/color, criterio de permisos, etc.) aparece en más de un lugar del código, existe una única función/constante/vista que todos consumen — nunca la misma condición copiada archivo por archivo. Cuando la plataforma no permite compartir código directamente entre los puntos (ej. políticas RLS de Postgres, que no llaman funciones de aplicación en JS), el punto único de verdad es una función SQL reutilizada por todas las políticas, nunca la misma condición repetida política por política. Cuando los puntos que comparten la lógica viven en carpetas que se despliegan por separado —el Panel, las dos aplicaciones, el motor—, no pueden importarse entre sí: ahí el punto único de verdad es **un original más copias idénticas**. La lista de qué archivo es copia de cuál vive en `scripts/copias_entre_apps.mjs`, `scripts/sincronizar_copias.mjs` las vuelve a copiar y `scripts/verificar_identidad.mjs` corta el build si alguna se despegó. Nunca una copia editada a mano. Antes de agregar un patrón que ya podría existir en otro lugar del proyecto, buscarlo primero (grep/lectura del código real) — no asumir que no existe.

13. **Lo que se guarda para siempre se nombra por lo que hace, nunca por cómo se llama.** Un identificador permanente —el `codigo` de un producto, una clave de entitlement, el nombre de una tabla o de una columna, el de una base local, el de una carpeta de respaldos, el de un archivo de automatización— se nombra por su **función**, jamás por la marca del producto ni por el proveedor que hoy nos presta el servicio. `publicar-pantallas.yml`, no "publicar-en-cloudflare"; `codigo: 'cuidado'`, no el nombre comercial del momento. **Y una vez creado no se renombra**, aunque la marca o el proveedor cambien: un identificador guardado es un número de serie, está escrito adentro de datos que ya existen, y "limpiarlo" para que haga juego con el nombre nuevo es cómo se rompen las cosas. Por eso el `codigo: 'aurevia'` sigue diciendo `aurevia` y **no es residuo olvidado** (ver la excepción escrita en el glosario, §4). Distinguir tres capas y no confundirlas: lo **visible** sale de configuración y se puede cambiar cuando se quiera (regla 1); lo **guardado** se nombra por función y no se toca nunca (esta regla); lo **histórico** —migraciones ya aplicadas, `docs/claude_history.md`— conserva el nombre viejo a propósito, porque es el registro de lo que pasó (§10). *Excepción acotada:* los nombres que impone un tercero (`SUPABASE_URL`, `CLOUDFLARE_API_TOKEN`) se escriben como los llama ese tercero — traducirlos no reduce el trabajo de mudarse y sí le esconde el nombre real a quien lea el código.

**Checklist antes de cerrar cualquier tarea:** ¿se respetaron las 13 reglas? ¿se mantuvo el aislamiento multi-tenant? ¿términos del glosario aprobados? ¿sin datos hardcodeados? ¿4 estados cubiertos? ¿info sensible protegida? ¿documentación actualizada? Si alguna respuesta es no, la tarea no está terminada.

## 8. Despliegue e infraestructura

- **Un push no es un despliegue por sí solo — lo es porque hay un automatismo que lo convierte en uno.** Desde el 2026-08-02, cada `push` a `main` que toca `backend/`, `panel/`, `pwa-familias/` o `pwa-asistentes/` dispara el despliegue de esa parte (`.github/workflows/deploy-backend.yml` y `publicar-pantallas.yml`). Los proyectos de Cloudflare Pages siguen siendo de **subida directa**, o sea que no están enganchados a GitHub: quien publica es el automatismo, no Cloudflare. **Terminar una tarea que tocó una app desplegada incluye comprobar que la publicación salió bien** (`gh run list`, y la dirección en vivo respondiendo) — no alcanza con ver el push subido. Si el automatismo falla o está deshabilitado, el despliegue explícito por comando sigue siendo parte de terminar la tarea, no un paso opcional posterior.
- **Todo schema aplicado directamente contra Supabase termina con** `NOTIFY pgrst, 'reload schema';` — sin este paso PostgREST puede devolver 404 en tablas que sí existen.
- Toda tabla nueva: propósito documentado, relaciones definidas, restricciones, timestamps donde corresponda, políticas RLS, validación de seguridad — evaluada siempre contra el impacto multi-tenant, nunca aislada de esa pregunta.

## 9. Acceso restringido a documentación

Dentro de `docs/` hay dos clases de carpeta que no se leen como el resto, y son distintas entre sí. No confundirlas.

**`Exclusivo <Prestadora>/` — carpeta reservada.** Guarda lo que es puramente de una Prestadora y de nadie más: su identidad de marca, su configuración de negocio, su investigación de competencia. **No se entra: no se lee, no se lista, no se cita su contenido**, salvo orden explícita del Desarrollador en esa misma sesión. No alcanza con que la tarea "roce" el tema, y el permiso no se hereda de una sesión a la siguiente. Cualquier carpeta nueva que guarde material de una sola Prestadora se nombra igual y queda bajo esta misma regla.

**`Documentos Obsoletos/` — el depósito.** Es donde va todo lo que se saca del medio para que no moleste: planes que ya se ejecutaron, investigaciones que ya se convirtieron en decisiones, el diario de obra, los pendientes ya cerrados. **No es material secreto: es material que dejó de estar vigente.** Por eso:
- no se lee al empezar una sesión, ni entra en ninguna lista de lectura obligatoria — leerlo por costumbre es exactamente lo que se quiso evitar al mudarlo ahí;
- se abre solamente cuando hace falta buscar algo puntual: cómo se resolvió un pendiente cerrado, qué se decidió en una etapa vieja;
- **nada de lo que está adentro manda.** Si un documento del depósito dice una cosa y `CLAUDE.md` o un pendiente abierto dicen otra, gana lo vigente, siempre;
- adentro hay nombres viejos a propósito (el producto se llamaba Aurevia) y no se corrigen: es el registro de lo que pasó;
- **no se crea ningún otro depósito.** Cuando algo deja de servir, va acá, y nada más. Se guarda por si hace falta hasta que termine el proyecto; después se borra entero.

*(No confundir el depósito con `docs/claude_history.md` — ver §10: el depósito guarda documentos enteros de una etapa superada; `claude_history.md` es lectura normal y vigente, y registra por qué cambió cada regla de este mismo CLAUDE.md.)*

## 10. `docs/claude_history.md` — historial de decisiones

CLAUDE.md se actualiza únicamente cuando cambia una regla vigente, y queda siempre limpio: refleja el estado actual, sin narrar cómo se llegó a él.

Todo lo histórico vive aparte, en `docs/claude_history.md`:
- decisiones que cambiaron de rumbo (qué decía antes, qué dice ahora, motivo, fecha);
- términos de glosario retirados o renombrados, con su versión anterior;
- contradicciones detectadas entre reglas y cómo se resolvieron;
- notas tipo "no reintroducir X sin resolver Y primero" que necesitan sobrevivir entre sesiones aunque ya no formen parte de la regla vigente.

**Antes de proponer algo que suene a un tema ya debatido**, revisar `docs/claude_history.md` además de este archivo — leer solo CLAUDE.md no alcanza si el tema ya se resolvió en una dirección distinta en el pasado y la única razón que quedó registrada está en el historial, no en la regla vigente.

## 11. Antes de empezar un cambio grande de arquitectura

Hay cambios que no son una tarea más — tocan la base de todo el sistema. Ejemplos: sumar un país nuevo con reglas distintas, lanzar otro producto de CeltaTech, o cambiar cómo se guardan los datos centrales (la estructura de Organización).

Para este tipo de cambios, el orden es siempre:

1. **Primero, un inventario.** Revisar qué partes del código de hoy asumen "las cosas como están ahora" (un solo país, un solo producto, etc.) y van a verse afectadas.
2. **Después, un plan.** Proponer cómo se va a hacer el cambio, mostrárselo al Desarrollador y esperar su aprobación.
3. **Recién ahí, tocar código de producción.**

No se salta directo al paso 3 aunque el cambio ya esté decidido de palabra — falta siempre el plan aprobado antes de escribir código.

## 12. Protocolo de sesión

**Al iniciar:**
1. Leer `CLAUDE.md` (este archivo).
2. Leer `docs/CONTEXT.md`, `docs/BUILD_ORDER.md` (la tabla de etapas con el estado de cada una), el PRD de la etapa actual y cualquier doc específico si la tarea toca Panel/Asistentes.
3. Confirmar con una línea: *"Leí los documentos correspondientes. Etapa actual: [X]. Última tarea completada: [Y]. Tarea de esta sesión: [Z]."*
4. Presentar plan (objetivo, archivos afectados, cambios previstos, riesgos, validaciones) y esperar aprobación antes de escribir código.

**Control de características** (pedidos con más de una funcionalidad): antes de programar, lista explícita por característica — ✅ incluida tal cual / ⚠️ incluida con cambio (y por qué) / ❌ excluida (y por qué). Nada puede desaparecer dentro de un resumen general. Al terminar, se repite la misma lista contra lo prometido, no una narración.

**Documentación verificable:** toda afirmación sobre una decisión ya tomada cita **archivo y línea exacta** (`archivo.md:línea`), verificable en segundos sin tener que leer todo el archivo ni entender el contexto — nunca "según el proyecto..." o "ya estaba resuelto" sin decir exactamente dónde.

**Cómo se escribe la ruta de un documento:** hay dos carpetas de documentos y las dos se llaman `docs/` — la del producto, en `productos/aurevia/docs/`, y la de la empresa, en `celtatech/docs/`. Un documento del producto se cita como siempre, desde la raíz del producto: `docs/CONTEXT.md`. Uno de la empresa se cita con la ruta entera desde `celtatech/`, para que se sepa dónde buscarlo: `celtatech/docs/ARQUITECTURA_NIVELES.md`, y no `ARQUITECTURA_NIVELES.md` a secas.

**Pendientes:** todo lo que quede abierto va a `docs/PENDIENTES.md` con nombre, fecha de creación y condición de cierre. Antes de cerrar cualquier tarea, se revisa esa lista completa — no de memoria — y se informa el estado de lo relacionado.

**Principio de certeza:** nunca afirmar "está revisado/resuelto/no hay problemas" sin haber hecho la comprobación en el momento. Si no se verificó, decirlo así, no disimularlo con una respuesta que suene completa.

**Estado real por encima del documentado:** los archivos `.sql` de `backend/src/db/` y las entradas de `docs/PENDIENTES.md` son historial de intención, no la fuente de verdad — pueden estar aplicados a medias, superados por un archivo posterior, o simplemente no reflejar lo que hay hoy en producción. Ninguna afirmación de "esto ya está hecho/migrado/resuelto" se escribe en esos documentos, ni se le comunica al Desarrollador como cerrada, sin haber consultado el estado real en ese mismo momento: la base de datos en vivo (`mcp__supabase__execute_sql`, `list_tables`, etc.) para todo lo de esquema/datos, o el código efectivamente desplegado para todo lo demás. Inferir el estado a partir de un `.sql` o de una entrada de doc anterior no alcanza.

**Revisión cruzada:** antes de una propuesta nueva, señalar explícitamente qué decisiones ya documentadas (arquitectura multi-tenant, SaaS, seguridad, glosario, reglas de negocio) son relevantes y si la conclusión nueva es consistente con ellas o entra en conflicto. Incluye revisar `docs/claude_history.md` cuando el tema ya haya sido debatido antes (ver §10).

**Cierre de sesión:** código y documentación actualizados, pendientes registrados, commit + push si hubo cambios de código, compatibilidad con las reglas no negociables verificada — no asumida.

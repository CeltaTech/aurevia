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
| Tipo de Asistente — **qué es** un Asistente: cuidador/a, enfermero/a, kinesiólogo/a, médico/a, y los que cada Prestadora agregue. Vive en un catálogo de dos niveles (general de CeltaTech + propio de cada Prestadora). Cada tipo define sus Tareas y si requiere Matrícula | especialidad, categoría, puesto, rol (rol es del sistema, ver §5) |
| Tareas — **qué hace y qué no hace** un tipo de Asistente. Son siempre dos listas separadas, nunca un párrafo que las mezcle: las que le corresponden y las que no. La segunda existe porque es la que evita la confusión con las Familias, y por eso pesa igual que la primera | funciones, incumbencias, perfil del puesto, "descripción de tareas" como texto único |
| Familia | cliente, usuario |
| Paciente | adulto mayor (salvo contexto clínico específico) |
| Servicio — todo lo que la Prestadora acordó hacer por un Cliente y le cobra por eso: las horas de cuidado, la enfermería, la kinesiología, los traslados, la limpieza de la casa, lo que se haya acordado. Es el acuerdo entero. Cada cosa del acuerdo tiene sus propios días y horarios, y empieza y termina cuando le toca: una puede sumarse en mayo y otra terminarse en junio, y el Servicio sigue abierto igual. Un mismo Servicio puede cuidar a más de un Paciente, por ejemplo a un matrimonio | guardia, prestación, solicitud |
| Prestación — cada cosa del acuerdo, con su precio. El Servicio es el acuerdo entero; la prestación es cada cosa que hay adentro. Unas se cubren con guardias, como el cuidado por horas; otras se hacen y se cobran de una vez, como un traslado o una limpieza. **Siempre lleva su alcance escrito en dos listas separadas: qué incluye y qué no incluye** — la segunda es la que evita los malentendidos con la Familia | servicio, guardia, renglón de la lista de precios; un párrafo único que mezcle lo que incluye con lo que no |
| Cerrar un Servicio — la finalización definitiva de ese Servicio: se deja de prestar y se deja de cobrar, se dan de baja sus prestaciones, se cancelan sus guardias futuras y se avisa a los Asistentes que se quedan sin ese trabajo. Nada se borra. **Sinónimo aceptado, de la jerga del rubro: "levantar el servicio"**, que se usa sobre todo cuando la decisión de terminar la toma la Prestadora | confundirlo con cerrar una Guardia; confundirlo con dar de baja a un Paciente |
| Guardia — las horas seguidas que un Asistente pasa cuidando, desde que llega hasta que se va. En esas horas atiende a uno o a varios Pacientes: un matrimonio en su casa, o un grupo entero en una residencia. Cada Paciente atendido tiene su propio Reporte diario. La guardia es una parte de un Servicio | turno, jornada, servicio, visita |
| Check-in y check-out — el aviso de que el Asistente llegó al domicilio y el aviso de que se fue. El check-in marca el comienzo real de la guardia; el check-out, el final. Las dos palabras están en inglés y se dejan así a propósito: son las que usa todo el mundo, en este rubro y en cualquier aplicación de trabajo por turnos, y traducirlas confundiría más de lo que aclararía. Se escriben igual en los tres idiomas | fichar, marcar tarjeta; "entrada y salida" a secas, que no dice de qué entrada se habla; confundir el check-out con cerrar la guardia — el check-out dice que el Asistente se fue, y el cierre es el paso aparte donde se confirma que quedó todo hecho |
| Modalidad de trabajo — cómo la Prestadora hace llegar el trabajo. Son tres: prestación directa (la Prestadora asigna las guardias), marketplace (el Asistente elige cuáles toma) y subcontratación (el trabajo lo cubre otra empresa con su propio plantel). Cada Asistente está en una de las dos primeras, o en las dos; en la tercera nunca, porque esa gente no es nuestra | "canal" para nombrar esto — en este producto un canal es por dónde sale un aviso: WhatsApp, correo, notificación al celular. Usar la misma palabra para las dos cosas obliga a adivinar cuál se está nombrando |
| Subcontratación — la tercera **modalidad de trabajo** de una Prestadora, junto con prestación directa y marketplace: la Prestadora toma un servicio de un cliente (por ejemplo una Obra Social) y se lo deriva a otra empresa, que lo cubre con su propio plantel. Valor guardado: `subcontratacion` | "cooperativa" (nombra otra cosa: una forma de organizarse entre trabajadores, no una empresa que recibe trabajo derivado); tercerización; derivación |
| Empresa subcontratada — la otra empresa, la que pone su propio plantel y cubre el servicio derivado. No es una Prestadora (no tiene licencia de Careonys) ni un Asistente | proveedor a secas, contratista, "la cooperativa" |
| Coordinador (sinónimo aceptado: "supervisor" — hoy son la misma cosa con otro nombre; si en versiones futuras se separan, se separan acá. El rol en el código sigue llamándose `coordinador`) | jefe, encargado |
| Estado actual — la pantalla de entrada del Panel: arriba lo que no está bien hoy, abajo la semana entera. Se llama así porque eso es lo que contesta: *cómo está todo ahora mismo*. En el código: `pages/EstadoActual.jsx`, clave `estado_actual` | mostrador (nombra el mueble, no lo que la pantalla muestra), estatus (es "status" adaptado del inglés, ver la pregunta 3 más abajo), tablero, dashboard, home, inicio |
| Reporte diario | informe, planilla, parte |
| Vínculo / Cese | contrato de trabajo, despido (salvo causal literal de despido) |
| Proceso de Incorporación de Asistentes | selección, filtro, pipeline, reclutamiento |
| Certificado de Aptitud | certificado genérico, diploma, certificado propio de una Prestadora |
| Obra Social | IOMA (salvo que sea literalmente la obra social configurada por esa Familia/Paciente), obra social genérica no configurable |
| Número de afiliado | ioma_afiliado, afiliado IOMA |
| Ausente sin relevo previo | cualquier término en inglés o genérico para el caso de un Asistente que no se presenta a una Guardia cuando no había ningún otro Asistente cubriendo antes de él (ej. primera guardia del día para un Paciente) — distinto de un ausente con relevo, donde sí hay alguien saliente esperando |
| Documentación (vencimientos documentales de Asistentes, por Prestadora) | compliance, cumplimiento normativo |
| Indicación de medicación (medicamento/dosis/frecuencia/vía solicitados por la Familia para un Paciente, sujeta a aceptación del Panel) | medicación habitual, orden médica genérica |
| Matrícula — **qué autoriza legalmente** a ejercer a un Asistente, emitida por el colegio o el organismo que corresponda (número, vigencia, archivo). Los tipos de Asistente que la requieren no pueden atender a ningún Paciente sin ella vigente y verificada. Distinta de las Tareas (qué hace) y del Tipo (qué es) | habilitación (se lee como "habilidades del Asistente", lo contrario de lo que significa), certificación genérica, licencia, permiso |
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

Careonys tiene **tres** roles de Panel: Superadmin, Admin_prestadora y Coordinador. **No hay un cuarto rol comercial, y no se agrega:** la gestión comercial de las cuentas de Prestadoras es asunto de CeltaTech (Nivel 1) y vive en su propio panel, fuera de este producto.

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
   - **Pero la marca del producto no es la marca de la Prestadora.** Acá hay tres marcas: **CeltaTech** (la empresa, no la ve nadie dentro del producto), **Careonys** (el producto, la ve quien trabaja *en* la Prestadora y sabe qué software usa) y **la Prestadora** (la que contrataron la Familia y el Asistente). En toda pantalla, email o notificación dirigida a una Familia o a un Asistente, **la marca principal es la de su Prestadora** — `prestadoras.nombre_fantasia`, leída del tenant de esa sesión —, nunca `identidadProducto.js`. El modelo es **co-branding**: el producto aparece solo en una línea discreta al pie, *"con la tecnología de {{producto}}"*, condicionada al entitlement `aurevia.marca.personalizada` — ese es el **único** uso admitido de `IDENTIDAD` en una superficie de Familia o Asistente. El logo o el nombre de la Prestadora encabeza las dos aplicaciones, el correo de activación y el aviso que llega al celular; en `pwa-familias/` y en `pwa-asistentes/` no se agrega ningún uso de `IDENTIDAD` fuera de esa línea al pie — la marca sale de `src/context/PerfilContext.jsx`, que la pide una sola vez a `/perfil` y la entrega con `useMarca()` (`nombre`, `logoUrl`, `mostrarMarcaProducto`); el aviso que llega al celular la lee del depósito del navegador donde la aplicación la deja (`src/lib/marcaGuardada.js`), porque el trabajador de fondo no tiene sesión. Del lado del motor la arma `backend/src/utils/marcaPrestadora.js` con `prestadoras.nombre_fantasia` y `prestadoras.logo_url`. Única excepción todavía abierta: la pantalla de ingreso, porque antes de entrar no hay forma de saber de qué Prestadora se trata (pendiente `#141`). Ver `docs/MARCA.md` §0.
   - **El texto visible no tutea a quien lo lee.** Quien está del otro lado es una institución que evalúa o paga un software, o una Familia que confió a alguien suyo a esa institución — no un conocido. En castellano se escribe primero en **forma impersonal** ("No se puede dar de baja la cuenta propia desde acá", "Hace falta revisar la conexión") y, cuando haya que dirigirse a una persona, **usted**. Nunca "vos", "podés", "tenés", "tu cuenta", "revisá". En portugués rige el mismo criterio: forma impersonal, y "você" solo donde no quede otra — no "tu", y tampoco "o senhor / a senhora", que es más formal pero no se usa en software y obliga a adivinar el género de quien lee. Vale para las pantallas, los correos automáticos, los avisos que llegan al celular y los mensajes de error. **Y vale igual para lo que escribe la IA:** el reporte estructurado, la alerta que lee la Familia, la respuesta que sale por WhatsApp, el aviso de una importación. Que la frase la redacte un modelo en el momento y no esté guardada en ningún archivo no cambia nada — la lee la misma persona. El trato se le dice al modelo dentro de la instrucción, escrito una sola vez en `backend/src/utils/tratoIA.js`; ningún prompt copia ese párrafo. Los prompts tampoco se escriben tuteando al modelo ("marcá", "respondé", "podés"), porque eso lo empuja a contestar en ese registro. Detalle en `docs/AI_PROMPTS.md`, sección "Cómo trata la IA a quien la lee".
   - **Un mensaje de error también es texto visible.** Ninguna pantalla muestra lo que devuelven el navegador o la base tal cual: `lib/errores.js` clasifica el error en una de ocho situaciones —sin conexión, sesión vencida, sin permiso, no encontrado, duplicado, en uso, dato mal cargado, falla del sistema— y muestra la frase que corresponde de las traducciones, en los tres idiomas. El texto técnico crudo queda en la consola del navegador, que es donde sirve. Una Coordinadora no tiene por qué leer `Failed to fetch` ni el nombre de una tabla.
2. **Multiidioma desde el día uno**: toda clave nueva se agrega simultáneamente en `es-AR`, `en`, `pt-BR`. No se construye una función en un solo idioma "para traducir después".
3. **Todo componente que carga datos maneja 4 estados**: loading / error / vacío / listo.
4. **Toda operación destructiva requiere confirmación explícita** (ver §6).
5. **Todo botón que dispara una operación se deshabilita mientras está en curso** — nunca doble envío.
6. **CSS/diseño visual solo con el sistema de diseño de Careonys** — nunca colores, tipografías o estilos inventados fuera de la paleta.
7. **Nunca exponer información sensible** en logs, URLs o mensajes públicos (ver §6).
8. **RLS estricta** en cada tabla nueva, con Organización asociada cuando corresponda (ver §6).
   - **Y ninguna función que se saltee la RLS queda al alcance de quien no inició sesión.** Una función `SECURITY DEFINER` del esquema `public` no es solo una función: es además una dirección web, porque PostgREST publica ese esquema. Si tiene permiso de ejecución para `anon`, cualquiera con la clave pública —la que viaja adentro del Panel y de las dos aplicaciones— la llama sin sesión. Por eso **toda función nueva de ese tipo revoca explícitamente el permiso de `PUBLIC` y de `anon` en la misma migración que la crea**; revocarle a `PUBLIC` no alcanza, porque el permiso de `anon` es una concesión aparte.
   - **Las que consumen las políticas de seguridad conservan el permiso de la sesión autenticada** (`authenticated`) y solo pierden el anónimo: una política evalúa su expresión con los permisos de quien consulta, así que quitarle ese permiso a una función que las políticas usan no devuelve cero filas — falla, y deja al Panel sin poder leer sus propias tablas. **Antes de revocar hay que verificar cuál de los dos casos es, y se verifica probando contra una tabla cuya política llame a esa función**, no contra cualquier tabla: una tabla cuya política no la nombra pasa la prueba igual y da un falso positivo. El patrón ya está escrito —el reparto en dos grupos calculado al aplicar la migración, y la corrección del permiso con que nace cada función nueva— en `supabase/migrations/20260823010000_las_funciones_internas_de_la_base_no_se_llaman_desde_afuera.sql`.
9. **Git**: commit + push tras cada conjunto de cambios coherente. Mensajes en español, formato `tipo: descripción breve` (`feat:`, `fix:`, `docs:`, etc.). Nunca subir `.env`, credenciales ni datos reales.
10. **Cálculos legales/económicos siempre parametrizados** — nunca números escritos en código; siempre la escala vigente a la fecha del hecho (ver §3).
11. **Compatibilidad multiplataforma obligatoria**: Windows/macOS/Linux/Android/iOS × Chrome/Firefox/Safari/Edge. No asumir un único navegador o dispositivo (traducción automática del navegador, permisos de cámara, geolocalización, notificaciones, PWA).
12. **Ningún patrón de lógica repetido sin punto único de verdad**: si la misma decisión (regla de acceso, validación, cálculo, mapeo de estado/color, criterio de permisos, etc.) aparece en más de un lugar del código, existe una única función/constante/vista que todos consumen — nunca la misma condición copiada archivo por archivo. Cuando la plataforma no permite compartir código directamente entre los puntos (ej. políticas RLS de Postgres, que no llaman funciones de aplicación en JS), el punto único de verdad es una función SQL reutilizada por todas las políticas, nunca la misma condición repetida política por política. Cuando los puntos que comparten la lógica viven en carpetas que se despliegan por separado —el Panel, las dos aplicaciones, el motor—, no pueden importarse entre sí: ahí el punto único de verdad es **un original más copias idénticas**. La lista de qué archivo es copia de cuál vive en `scripts/copias_entre_apps.mjs`, `scripts/sincronizar_copias.mjs` las vuelve a copiar y `scripts/verificar_identidad.mjs` corta el build si alguna se despegó. Nunca una copia editada a mano. Antes de agregar un patrón que ya podría existir en otro lugar del proyecto, buscarlo primero (grep/lectura del código real) — no asumir que no existe.

13. **Lo que se guarda para siempre se nombra por lo que hace, nunca por cómo se llama.** Un identificador permanente —el `codigo` de un producto, una clave de entitlement, el nombre de una tabla o de una columna, el de una base local, el de una carpeta de respaldos, el de un archivo de automatización— se nombra por su **función**, jamás por la marca del producto ni por el proveedor que hoy nos presta el servicio. `publicar-pantallas.yml`, no "publicar-en-cloudflare"; `codigo: 'cuidado'`, no el nombre comercial del momento. **Y una vez creado no se renombra**, aunque la marca o el proveedor cambien: un identificador guardado es un número de serie, está escrito adentro de datos que ya existen, y "limpiarlo" para que haga juego con el nombre nuevo es cómo se rompen las cosas. Por eso el `codigo: 'aurevia'` sigue diciendo `aurevia` y **no es residuo olvidado** (ver la excepción escrita en el glosario, §4). Distinguir tres capas y no confundirlas: lo **visible** sale de configuración y se puede cambiar cuando se quiera (regla 1); lo **guardado** se nombra por función y no se toca nunca (esta regla); lo **histórico** —migraciones ya aplicadas, `docs/claude_history.md`— conserva el nombre viejo a propósito, porque es el registro de lo que pasó (§10). *Excepción acotada:* los nombres que impone un tercero (`SUPABASE_URL`, `CLOUDFLARE_API_TOKEN`) se escriben como los llama ese tercero — traducirlos no reduce el trabajo de mudarse y sí le esconde el nombre real a quien lea el código.

14. **Todo importe se guarda con su moneda.** Ningún campo de precio, honorario, monto o cobro guarda un número solo: al lado va la moneda en la que está expresado. No se da por supuesto el peso argentino ni ninguna otra — el producto se vende en más de un país desde el día uno, y una Prestadora de Uruguay, de Chile o de Brasil carga sus precios en la suya. Un número guardado sin moneda, leído un año después, no se sabe cuánto vale ni hay forma de reconstruirlo. Vale para la base, para el motor y para la pantalla.
    - **Alcance, para que esta regla no se estire:** Careonys **no emite comprobantes fiscales y no está previsto que lo haga.** Lo que el producto guarda son cuentas internas —qué se le cobra a un Cliente por un período, qué se le paga a un Asistente—, no documentos con validez impositiva. Esta regla no agrega tipo de comprobante, ni punto de venta, ni numeración autorizada, ni impuestos discriminados, ni tipo de cambio de referencia: **pide la moneda y nada más.** La facturación fiscal la hace la Prestadora por fuera, con su propio sistema.
    - Si alguna vez un importe se convierte de una moneda a otra dentro del producto, ahí sí se guarda la cotización usada junto con la fecha, porque el número tiene que poder volver a explicarse. Mientras no haya conversión, no hay nada que guardar.
    - **Dónde está la moneda de cada quien:** la de la Prestadora, en `prestadoras.moneda`, que nace del país configurado y se cambia desde Configuración; la de cada importe, en la columna `moneda` de su propia tabla, que se completa sola al insertar la fila con la de la Prestadora que la creó (función `public.moneda_de_prestadora`, un solo punto de verdad, regla 12). Los importes de la plataforma que son gasto propio de CeltaTech y siempre están en dólares llevan la moneda en el nombre del campo (`costo_usd`, `precio_entrada_usd_por_millon`) y no se renombran (regla 13).

15. **El diseño de roles y permisos deja hecho el lugar del financiador, aunque todavía no se construya.** El financiador es quien paga el Servicio sin recibirlo: una Obra Social, una prepaga. En algún momento va a pedir ver cómo se está cumpliendo lo que paga. Lo que va a poder ver es **cumplimiento agregado** —cuántas guardias se cubrieron, cuántas se cayeron, cuántas empezaron tarde— y **nada del detalle clínico del Paciente**: ni reportes diarios, ni alertas, ni indicaciones de medicación, ni quién lo cuidó.
    - **No es un cuarto rol del Panel:** §5 dice que no se agrega ninguno y eso sigue valiendo. Es un lector de afuera, como lo son hoy la Familia y el Asistente, cada uno con su propia aplicación.
    - **No se construye ahora.** Lo que se pide es que ninguna decisión de permisos se tome de una forma que obligue a rehacerlos después: cada vez que se agregue una vista o una regla de acceso, se comprueba que ese lector externo, que solo suma y no ve nada clínico, entre sin romper nada.

16. **Lo que sirve a más de un producto no se escribe acá: se escribe una vez y vive en `Modulos\`.** Es **política central de CeltaTech**, decidida por el Desarrollador el 25 de agosto de 2026, y alcanza a todos sus productos. La regla completa está en `..\..\docs\POLITICA_DE_MODULOS.md` y se lee antes de crear un módulo. Lo que vale acá:
    - **Los módulos viven en `F:\proyectos\celtatech\Modulos\`**, una carpeta por módulo, afuera de los productos a propósito: un módulo guardado adentro de un producto termina teniendo dueño, y el dueño decide por los demás. El nombre dice **la función**, nunca la marca del producto que lo estrena (regla 13, misma idea).
    - **Y un Octo no es un módulo: es un producto que además se usa como módulo.** Lo aclaró el Desarrollador el 2026-08-25 — los Octo se pensaron como piezas que sirven a otros productos **y a la vez se venden solas**, y OctoCMS ya opera así. Un Octo vive en `..\` junto a este producto, no en `Modulos\`, y se usa siempre por API. Lo que **nunca se vende solo** es un módulo, va en `Modulos\` y no lleva apellido.
    - **La pregunta que decide cada caso:** *¿esto seguiría teniendo sentido en otro producto de CeltaTech?* Si sí, es módulo. Si solo existe porque este producto hace lo que hace, se queda acá.
    - **Ninguna palabra propia de Careonys entra en un módulo** —Prestadora, Guardia, Paciente, Servicio— si el otro producto no la tiene. Si entra una, el módulo dejó de servirle al otro y hay que sacarla después, que cuesta mucho más.
    - **Un módulo puede ser código instalado o un servicio con API**, y el criterio es qué hace: si **guarda algo** que tiene que ser el mismo para todos los productos —cuentas, permisos, clientes— va como servicio; si **sólo hace algo** con lo que el producto ya tiene —formularios, validaciones, formatos, diseño, mensajes de error— va como código. La identificación —la lista de cuentas y los permisos— es servicio, porque es de CeltaTech y no se duplica; si además es un Octo o un módulo depende de si se vende por separado, y eso está sin decidir. **Un servicio no borra el código instalado**: cada producto necesita igual el suyo para llamar a la API y dibujar las pantallas, y ese código tampoco se escribe dos veces — viaja con el Octo si es un Octo, y vive en `Modulos\` si es un módulo. Y toda API de un módulo nace con `/v1/` en la dirección.
    - **Por qué existe la regla, en una línea:** Careonys y Careonys Marketplace quedan separados a propósito, **con la condición de que toda mejora futura se haga en los dos a la vez**. Con el código partido en dos copias eso se hace dos veces o se hace una sola y la otra queda vieja. Es la regla 12 otra vez, pero cruzando de un producto al otro: los chequeos de copias que ya existen —`scripts/copias_entre_apps.mjs`, `scripts/verificar_identidad.mjs`— miran solo adentro de este repositorio y no ven nada de lo que pase en el otro.
    - **Todavía no hay ningún módulo, y sacar una pieza de acá para convertirla en uno es cambio de arquitectura sobre producción**: entra por el §11 —inventario, plan aprobado, y recién ahí código—, nunca como parte de otra tarea. El trabajo está anotado en `docs/PENDIENTES.md` #173.

**Checklist antes de cerrar cualquier tarea:** ¿se respetaron las 16 reglas? ¿se mantuvo el aislamiento multi-tenant? ¿términos del glosario aprobados? ¿sin datos hardcodeados? ¿4 estados cubiertos? ¿info sensible protegida? ¿documentación actualizada? Si alguna respuesta es no, la tarea no está terminada.

## 8. Despliegue e infraestructura

- **Un push no es un despliegue por sí solo — lo es porque hay un automatismo que lo convierte en uno.** Cada `push` a `main` que toca `backend/`, `panel/`, `pwa-familias/` o `pwa-asistentes/` dispara el despliegue de esa parte (`.github/workflows/deploy-backend.yml` y `publicar-pantallas.yml`). Los proyectos de Cloudflare Pages siguen siendo de **subida directa**, o sea que no están enganchados a GitHub: quien publica es el automatismo, no Cloudflare. **Terminar una tarea que tocó una app desplegada incluye comprobar que la publicación salió bien** (`gh run list`, y la dirección en vivo respondiendo) — no alcanza con ver el push subido. Si el automatismo falla o está deshabilitado, el despliegue explícito por comando sigue siendo parte de terminar la tarea, no un paso opcional posterior.
- **Todo schema aplicado directamente contra Supabase termina con** `NOTIFY pgrst, 'reload schema';` — sin este paso PostgREST puede devolver 404 en tablas que sí existen.
- Toda tabla nueva: propósito documentado, relaciones definidas, restricciones, timestamps donde corresponda, políticas RLS, validación de seguridad — evaluada siempre contra el impacto multi-tenant, nunca aislada de esa pregunta.

## 9. Acceso restringido a documentación

**`Exclusivo <Prestadora>/` — carpeta reservada.** Guarda lo que es puramente de una Prestadora y de nadie más: su identidad de marca, su configuración de negocio, su investigación de competencia. **No se entra: no se lee, no se lista, no se cita su contenido**, salvo orden explícita del Desarrollador en esa misma sesión. No alcanza con que la tarea "roce" el tema, y el permiso no se hereda de una sesión a la siguiente. Cualquier carpeta nueva que guarde material de una sola Prestadora se nombra igual y queda bajo esta misma regla.

**No hay depósito de documentos viejos, y no se crea ninguno.** Lo que deja de estar vigente se borra en el momento, junto con las referencias que lo nombran. Decisión del Desarrollador del 2026-08-18: *"de nada sirve conservar un historial de cosas que ya cambiaron para siempre, solo para relentizar y confundir"*. Lo único que sobrevive a un documento borrado es la línea de `docs/claude_history.md` que explica por qué cambió una regla, y el historial de cambios del repositorio, que guarda todo sin ocupar lugar en el escritorio.

## 10. `docs/claude_history.md` — por qué cambió una regla

CLAUDE.md refleja el estado actual y nada más: cuando una regla cambia, la anterior se reemplaza sin dejar rastro acá. Sin notas de fecha, sin "antes decía", sin términos retirados.

Lo único que se guarda aparte, en `docs/claude_history.md`, es **por qué** cambió: qué decía antes, qué dice ahora y el motivo, en una línea. Existe por una sola razón práctica: que un tema ya resuelto no vuelva a plantearse en dirección contraria. **Antes de proponer algo que suene a un tema ya debatido**, revisarlo — leer solo CLAUDE.md no alcanza cuando la razón quedó ahí.

No es un depósito: no guarda documentos viejos, ni versiones anteriores, ni tareas cerradas (§9).

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

**Cómo se escribe la ruta de un documento:** hay dos carpetas de documentos y las dos se llaman `docs/` — la del producto, en `productos/careonys/docs/`, y la de la empresa, en `celtatech/docs/`. Un documento del producto se cita como siempre, desde la raíz del producto: `docs/CONTEXT.md`. Uno de la empresa se cita con la ruta entera desde `celtatech/`, para que se sepa dónde buscarlo: `celtatech/docs/ARQUITECTURA_NIVELES.md`, y no `ARQUITECTURA_NIVELES.md` a secas.

**Pendientes:** todo lo que quede abierto va a `docs/PENDIENTES.md` con nombre, fecha de creación y condición de cierre. Antes de cerrar cualquier tarea, se revisa esa lista completa — no de memoria — y se informa el estado de lo relacionado. **Un pendiente que se cierra se borra**: la fila entera se elimina, no se marca como resuelta ni se archiva en ningún lado (§9).

**Principio de certeza:** nunca afirmar "está revisado/resuelto/no hay problemas" sin haber hecho la comprobación en el momento. Si no se verificó, decirlo así, no disimularlo con una respuesta que suene completa.

**Estado real por encima del documentado:** las entradas de `docs/PENDIENTES.md` son historial de intención, no la fuente de verdad, y un archivo de `supabase/migrations/` describe lo que se quiso aplicar, no necesariamente lo que corre hoy: puede estar aplicado a medias, superado por una migración posterior, o simplemente no reflejar lo que hay en producción. Ninguna afirmación de "esto ya está hecho/migrado/resuelto" se escribe en esos documentos, ni se le comunica al Desarrollador como cerrada, sin haber consultado el estado real en ese mismo momento: la base de datos para todo lo de esquema y datos —la local con `docker exec supabase_db_aurevia psql -U postgres -d postgres -c "…"`, y qué migraciones corrieron en la nube con `supabase migration list --linked`—, o el código efectivamente desplegado para todo lo demás. Inferir el estado a partir de un archivo de migración o de una entrada de doc anterior no alcanza.

**Revisión cruzada:** antes de una propuesta nueva, señalar explícitamente qué decisiones ya documentadas (arquitectura multi-tenant, SaaS, seguridad, glosario, reglas de negocio) son relevantes y si la conclusión nueva es consistente con ellas o entra en conflicto. Incluye revisar `docs/claude_history.md` cuando el tema ya haya sido debatido antes (ver §10).

**Cierre de sesión:** código y documentación actualizados, pendientes registrados, commit + push si hubo cambios de código, compatibilidad con las reglas no negociables verificada — no asumida.

# PRD_03 — Reclutamiento (Sitio de Captación + Postulación + Verificación)

> Fuente: documento original de PRD de Reclutamiento (histórico, fuera del repo, v1.0, Mayo 2026). Condensado para
> ejecución directa, con las siguientes correcciones respecto del original: (1) el original
> menciona un nombre propio ("Alberto Sánchez") como responsable de entrevistas —
> reemplazado por "Inversor" o "Admin_prestadora", igual que en el resto de
> `Workspace/docs/`, ver nota del glosario en `CLAUDE.md`; (2) se documenta explícitamente una discrepancia de stack, ver
> sección "Nota de stack" abajo, en vez de elegir en silencio; (3) el original usa
> "Cuidadora"/"Cuidadoras" en varios lugares (tabla de usuarios del sistema, catálogo de
> especialidades) — reemplazado por "Asistente"/"Asistente Integral" en todo el documento,
> regla del glosario obligatorio; (4) se agregó la sección "Landing page de reclutamiento"
> (contenido de la página pública — perfiles buscados, beneficios, zonas — del original, que
> no estaba condensada acá todavía); (5) queda fuera de alcance la Sección 8 del original
> (comparativa de posicionamiento frente a la competencia) y la mención a explorar aval
> institucional de terceros (Cruz Roja, AAGG) — son decisiones de negocio/marketing, no
> generan código.

## Objetivo

La prestadora necesita mínimo 20 Asistentes Integrales certificados antes del lanzamiento
comercial. El proceso de incorporación completo tarda 4-7 días hábiles por persona — el
reclutamiento arranca en Etapa 0/1, antes que el resto del producto.

## Nota de stack (discrepancia ya resuelta)

La discrepancia que este documento anotaba —Supabase desde el arranque contra un primer paso
por MySQL en Railway— quedó resuelta hace tiempo y a favor de lo primero: **nunca hubo
MySQL**, todo se construyó sobre Supabase (ver `docs/claude_history.md`). Este documento
aporta el detalle funcional del reclutamiento —qué campos se piden, qué etapas de
verificación hay, qué pantallas de Panel—, no decisiones de infraestructura.

**Dónde vive el formulario de postulación (corregido 2026-08-13):** en la empresa que va a
contratar al Asistente, no en la página pública de Careonys, que le vende software a esas
empresas y no toma postulaciones (`PRD_01_Sitio_Web.md` §3).

Twilio (mensajes de texto) no aparece en ningún otro documento — no construir verificación
por mensaje de texto hasta que haya una decisión de negocio explícita.

## Proceso de Incorporación de Asistentes — 6 etapas

**Nota de nomenclatura (corregida 2026-07-10):** esta tabla es la que directamente alimenta
las pantallas de Panel (Módulo 2/4 de `PRD_02_Panel_Admin.md`, tabla `verificaciones_asistente`)
— dentro del Panel, uso interno, se llama "Proceso de Incorporación de Asistentes". El nombre
anterior quedó retirado por completo, de cualquier contexto interno o público
(ver glosario de `CLAUDE.md`) — no reintroducirlo ni siquiera como "concepto general".

| Etapa | Descripción | Responsable | SLA |
|---|---|---|---|
| 0 — Postulación | Formulario público, estado inicial `pendiente` | Sistema | Inmediato |
| 1 — Verificación de identidad | Foto DNI + foto de perfil, comparación por IA | Sistema + Coordinador | < 24hs |
| 2 — Antecedentes penales | Consulta Registro Nacional de Reincidencia, renovación anual | Coordinador | 1-2 días |
| 3 — Entrevista estructurada | Videollamada 30 min, evalúa competencia técnica/emocional/valores | Admin_prestadora | 1 día |
| 4 — Referencias laborales | Mínimo 2 referencias verificadas por teléfono | Coordinador | 1-2 días |
| 5 — Capacitación y certificación | 8hs online, aprobación mínima 80%, emite Certificado de Aptitud con QR | Sistema + aspirante | 1-2 días |

Estas 5 etapas post-postulación son exactamente `etapa_filtro` en `verificaciones_asistente`
(`DATA_MODEL.md`) — mismos nombres, no inventar variantes: `postulacion`,
`verificacion_identidad`, `antecedentes_penales`, `entrevista`, `capacitacion`.

### Verificación de identidad — cómo quedó construido

Las dos fotos se cargan y se ven juntas desde la ficha del Asistente, en la pestaña de
verificación (`panel/src/pages/asistentes/FotosDeIdentidad.jsx`). Quedan guardadas en el depósito
`fotos-identidad` (`DATA_MODEL.md`), que sube y firma el motor
(`backend/src/routes/panelVerificacionIdentidad.js`).

**El bloque de las fotos está afuera de la lista de etapas**, y no es un olvido: cada Prestadora
define las etapas de su proceso y les pone las claves que quiera (Configuración > El cuidado), así
que no hay ninguna clave que el código pueda buscar. Las dos fotos son de la persona, no de una
etapa.

**Las compara una persona, no el producto.** Quien revisa las mira una al lado de la otra y marca
la etapa como venía haciéndolo; lo que cambió es que ahora queda guardado lo que miró. La
comparación automática de las dos caras —la columna «comparación por IA» del cuadro— es
tratamiento de dato biométrico y **no está construida**: falta el documento legal del que salga el
aviso al Asistente, y falta elegir proveedor (`SECURITY.md`, decisiones pendientes).

### Referencias laborales — cómo quedó construido

Las referencias que la persona cargó en su postulación pasan a la ficha del Asistente cuando se le
crea la cuenta, una fila cada una y todas sin llamar. Desde la pestaña de verificación
(`panel/src/pages/asistentes/ReferenciasLaborales.jsx`) se llama a cada una y queda anotado qué
contestó: verificada, no responde o rechazada, con una nota interna. También se pueden cargar a
mano, hasta las mismas cinco que admite el formulario, para quien entró sin postulación.

**Quién llamó y cuándo los escribe el motor** (`backend/src/routes/panelReferenciasLaborales.js`),
no la pantalla: son la firma de esa verificación. Volver el resultado a «sin llamar» los borra.

**El mínimo de dos verificadas es configuración de cada Prestadora**, no un número escrito en el
código (`configuracion_referencias_laborales` en `DATA_MODEL.md`). Se cambia desde Configuración,
puede ser cero, y el tope es cinco porque más de cinco no se pueden cargar.

**Y no bloquea nada.** Si faltan verificadas, la pantalla lo dice y aclara que incorporar igual a
esa persona lo decide la Prestadora: el producto avisa, no prohíbe (`celtatech/CLAUDE.md` §7).

**Están afuera de la lista de etapas**, por lo mismo que las dos fotos: las claves de las etapas las
inventa cada Prestadora y ninguna se puede nombrar desde el código.

### El avance del aspirante — cómo quedó construido

La pantalla de verificación muestra, arriba de todo, cuánto lleva hecho el aspirante: una línea
—«2 de 4 etapas aprobadas — 50%»— y una barra.

- **El total sale del catálogo de etapas de esa Prestadora**, no de las filas guardadas. Una etapa
  que la Prestadora sacó deja de contar aunque su fila siga ahí, y una que agregó cuenta como
  pendiente aunque todavía no tenga fila.
- **Una etapa rechazada no suma avance.** Está resuelta, pero no acerca a nadie a trabajar. Cuántas
  hay se informa aparte, al lado del porcentaje.
- **Sin etapas configuradas no se muestra nada.** Un contador de cero sobre cero no dice nada, y lo
  que hay que resolver ahí es cargar el catálogo, que se hace en Configuración.
- El cálculo vive en `panel/src/lib/avanceDeIncorporacion.js`, y es lo único que decide qué cuenta.

## Roles

| Rol | Quién | Acceso |
|---|---|---|
| Aspirante | Postulante sin verificar | Formulario público + estado de su postulación |
| Asistente | Verificada e incorporada al plantel | App + panel propio |
| Admin_prestadora | Gestión de negocio de la prestadora (rol técnico — distinto del Inversor como persona, ver glosario de `CLAUDE.md`) | Panel de administración completo |
| Familia | Contrata el servicio | Portal de seguimiento |
| Coordinador | Rol operativo | Gestión de su zona |

## Landing page de reclutamiento (sitio público)

Cara pública de la campaña de incorporación — comunica a quién busca la prestadora, qué ofrece y
cómo es el proceso, antes de llevar al aspirante al formulario. Corrección de terminología
respecto del documento fuente: donde el original dice "Cuidadoras" se usa "Asistentes
Integrales" (glosario de `CLAUDE.md`).

**Perfiles buscados** (checklist visual, no un formulario todavía): Asistente Integral /
Auxiliar de Enfermería / Enfermero/a profesional / Kinesiólogo/a / Acompañante Terapéutico/a
/ Fonoaudiólogo/a / Psicólogo/a / Terapista Ocupacional / Nutricionista / otras
especialidades vinculadas al cuidado de personas — mismo catálogo que `especialidades` en
`asistentes` (`DATA_MODEL.md`), no crear una lista paralela.

**Beneficios que comunica el sitio**: trabajo registrado; honorarios acordados según
especialidad y experiencia (sin publicar montos — ver regla abajo); Certificado de Aptitud
con QR verificable; respaldo operativo permanente; aplicación propia de gestión de guardias;
capacitación continua.

**Zonas de cobertura**: mismo catálogo de zona/municipios que la Sección E del formulario
(ver abajo) — no duplicar como una lista independiente en el código, es contenido estático
de la landing que puede leer del mismo catálogo.

## Formulario de postulación (landing pública)

Regla explícita del PRD original: **no publicar honorarios en el sitio** — se relevan en el
formulario sin sesgar la respuesta del aspirante, se acuerdan individualmente en la
entrevista (Etapa 3).

### Sección A — Datos personales

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| Nombre / Apellido | texto | Sí | |
| DNI | numérico | Sí | validar formato |
| Fecha de nacimiento | date | Sí | validar mayoría de edad (18+) |
| Teléfono/WhatsApp | tel | Sí | |
| Email | email | Sí | con confirmación |
| Domicilio | texto + Maps | Sí | confirmar en mapa |
| Localidad/Barrio | texto | Sí | |
| Nacionalidad | select | No | |
| CUIL | numérico | No | |
| Género | select (Femenino/Masculino/No binario/Prefiero no contestar) | Sí | |
| Foto de perfil | file (imagen) | Sí | detectar rostro antes de aceptar |

### Sección B — Situación fiscal

| Campo | Opciones | Obligatorio |
|---|---|---|
| Situación ante AFIP | Monotributista / Me comprometo a inscribirme / Otra | Sí |
| Tipo de registro AFIP | No inscripto / Monotributo social / Monotributista / Responsable inscripto | Sí |
| Obra social | texto libre | No |

Regla de negocio (bloqueante para asignación, no solo informativa): ser monotributista es
obligatorio para recibir guardias. Si el aspirante no está inscripto, el sistema **bloquea
la asignación** hasta que Admin_prestadora confirme el alta de monotributo — este es el mismo campo
`tipo_vinculo`/monotributo de `asistentes` en `DATA_MODEL.md`, no una tabla nueva.

### Sección C — Formación y certificaciones

Profesión/especialidad (checkboxes múltiples — mismo catálogo que `especialidades` en
`asistentes`: Asistente Integral, Acompañante Terapéutico/a, Enfermero/a, Auxiliar de
Enfermería, Asistente Gerontológico/a, Kinesiólogo/a, Fonoaudiólogo/a, Psicólogo/a,
Terapista Ocupacional, Nutricionista, Voluntario/a, Otro — mínimo 1 obligatorio;
corregido respecto del documento fuente, que decía "Cuidadora Domiciliaria" — término
prohibido por el glosario de `CLAUDE.md`). Estudios/cursos y experiencia
laboral: formularios dinámicos (múltiples entradas), opcionales pero mejoran ranking.
Referencias laborales: nombre/apellido/teléfono, 0 a 5. Cuántas verificadas se esperan es
configuración de cada Prestadora, y dos es el valor con el que nace — ver «Referencias laborales —
cómo quedó construido», más arriba.

### Sección D — Experiencia clínica

Checkboxes en 5 subgrupos: discapacidades con experiencia, patologías clínicas atendidas,
tareas de cuidado directo, tareas de acompañamiento, tareas domésticas — catálogo completo
en el documento fuente, usar como opciones fijas de un multi-select, no texto libre.

### Sección E — Zonas de cobertura

Selector múltiple de zona + municipio + distancia máxima desde el domicilio. Catálogo de
zonas (mismas que usa el resto del proyecto — no crear un catálogo paralelo):

| Zona | Municipios |
|---|---|
| CABA | Todos los barrios |
| GBA Norte | San Isidro, Vicente López, San Martín, Tres de Febrero, San Miguel, Malvinas Argentinas, José C. Paz, Tigre, Pilar, Escobar |
| GBA Oeste | Morón, Ituzaingó, Haedo, Castelar, El Palomar, Merlo, Moreno, La Matanza |
| GBA Sur | Lomas de Zamora, Lanús, Avellaneda, Quilmes, Berazategui, Florencio Varela, Almirante Brown |
| La Plata y alrededores | La Plata, Berisso, Ensenada, Brandsen |

### Sección F — Disponibilidad horaria

Grilla días (L-D) x franjas (Mañana 6-14 / Tarde 14-22 / Noche 22-6) — mapea directo a
`asistentes.disponibilidad` (JSONB) en `DATA_MODEL.md`. Más checkboxes: disponible para
urgencias, disponible con retiro (por horas), disponible sin retiro (cama adentro).

### Cómo quedó construido

`postulaciones` guarda todos los campos de las seis secciones. Los que son lista de renglones
—estudios y cursos, experiencia laboral, referencias— van como documento adentro de la
postulación, porque se leen enteros con ella y nunca por separado. Domicilio, latitud y longitud
se llaman igual que en `asistentes`: una postulación aprobada se convierte en Asistente y los dos
nombres tienen que coincidir.

**Las listas de opciones no están escritas en la pantalla.** Género, nacionalidad, tipo de
registro ante AFIP y los cinco subgrupos de experiencia clínica viven en `opciones_postulacion`,
una fila por opción y por Prestadora, y el motor las entrega en `GET
/api/publico/:prestadora/postulacion-asistente/opciones`. Las opciones que este documento enumera
más arriba son lo que se esperaba encontrar, no lo que el sistema impone: **cada Prestadora carga
las suyas, y la tabla nace vacía.** El catálogo completo de experiencia clínica quedó en el
documento fuente, que no está en el repositorio, así que no se sembró ninguno: inventarlo sería
inventar contenido de negocio.

**La mayoría de edad no son dieciocho escritos en el código.** La edad mínima para trabajar es un
valor legal y vive en `escalas_legales` (`tipo = 'edad_minima_para_trabajar'`), resuelta a la
fecha de la postulación y en la jurisdicción de la Prestadora. Si no hay escala vigente, **no se
rechaza a nadie por edad**: la postulación entra con su fecha de nacimiento y quien la revisa
decide.

Lo que comprueba el servidor antes de guardar —edad, forma del CUIL y que corresponda al
documento, que lo elegido esté en el catálogo, que las listas traigan renglones completos, que la
distancia sea una distancia y que el punto del mapa viaje entero— está en
`backend/src/utils/postulacionCompleta.js`, escrito una sola vez y probado aparte. Los motivos de
rechazo salen como claves y ninguno nombra una tabla ni una columna.

**Falta la pantalla.** Dónde vive el formulario público es una decisión abierta — ver
`docs/PLAN_HASTA_PRODUCCION.md`, sección «Reclutamiento».

## Panel de administración — sección Postulantes

### Los totales — cómo quedaron construidos

Arriba de la lista hay cinco números: cuántas postulaciones hay, y cuántas pendientes, en
verificación, aprobadas y rechazadas.

- **Los números son de todas las postulaciones, no de las que quedaron después de los filtros.**
  Contados sobre lo filtrado, elegir una situación dejaría los otros cuatro en cero: dirían lo
  mismo que el filtro que se acaba de tocar, y no habría forma de ver el panorama para volver.
- **Cada número filtra por esa situación, y el primero saca el filtro.** Es la pregunta que se hace
  cualquiera después de mirar el número.
- La cuenta vive en `panel/src/lib/totalesDePostulaciones.js`. Una situación que no está entre las
  cinco se cuenta en el total y en ninguna otra parte: cuántas postulaciones hay no depende de que
  se sepa clasificarlas.

**Falta un sexto número, las aprobadas sin monotributo**, y no se construyó porque todavía no está
decidido si eso avisa o bloquea — ver `docs/PLAN_HASTA_PRODUCCION.md`, sección «Reclutamiento». Un
número que diga «bloqueadas» antes de esa decisión adelanta la respuesta.

### La tabla y los filtros — cómo quedaron construidos

Columnas: nombre, especialidades, zonas, fecha, pretensión de honorario por hora, años de
experiencia, condición fiscal, urgencias, cómo nos conoció y situación. Más reciente primero, que
es el orden con el que la pantalla pide los datos.

- **La pretensión de honorario se muestra con su moneda**, la de la fila y no la de quien mira. La
  columna nació junto con la de moneda, que completa sola el mismo disparador que el resto de los
  importes. Quien no dijo cuánto pretende cobrar aparece con un guión: se pregunta en la
  entrevista.
- **La columna de cómo nos conoció se rotula por el dato que hay guardado.** El PRD original la
  llamaba «canal de llegada», y son dos cosas distintas: acá un canal es por dónde sale un aviso
  —WhatsApp, correo, notificación— y está escrito así en `panel/src/lib/modalidades.js`. Lo que la
  postulación guarda es lo que la persona contestó, y así se rotula.
- **Once condiciones no entran adentro de una pantalla.** El filtrado vive en
  `panel/src/lib/filtrarPostulaciones.js`, con sus pruebas: varias de esas condiciones no son una
  comparación sino una decisión, y una decisión se prueba.
- **Quien no declaró un dato queda afuera sólo cuando ese dato se pide.** Buscando gente que
  pretenda hasta cierto honorario, quien no lo dijo no cumple: meterla adentro la haría pasar por
  alguien que pidió poco. Mientras ese filtro no se toque, aparece como todas.
- **Un número escrito a medias no esconde a nadie.** Mientras se tipea «-» o «1e» el filtro
  todavía no se entiende, y un filtro que no se entiende no puede vaciar la lista y hacer creer
  que no hay postulantes.
- **El honorario y la distancia se escriben, no se eligen de una lista.** Una lista de rangos
  armada de antemano sería un valor operativo escrito en el código, distinto en cada Prestadora y
  en cada zona.

Filtros: texto libre, situación de la postulación, especialidad, zona, franja horaria, condición
fiscal, urgencias, tipo de servicio —por horas o cama adentro—, rango de honorario por hora y
distancia («viaja al menos tantos kilómetros», que es la pregunta que se hace quien busca a
alguien para una casa lejos).

**El filtro por «Suspendida» no existe porque esa situación no existe**: una postulación está
pendiente, en revisión, aprobada o rechazada.

Mapa geolocalizado del plantel activo agrupado por municipio — al llegar una solicitud de
familia, filtra automáticamente las Asistentes disponibles más cercanas (mismo componente
de mapa que `PRD_02_Panel_Admin.md` Módulo 2/3, no duplicar implementación).

### La entrevista al postulante — cómo quedó construida

Desde la ficha de una postulación se agenda la entrevista, se la mueve de horario, se la cancela y
se la cierra diciendo si la persona se presentó o no
(`panel/src/components/EntrevistaDePostulacion.jsx`, `backend/src/routes/panelEntrevistas.js`,
migración `20260916000000_la_entrevista_al_postulante_pasa_adentro_del_producto.sql`). Antes se
acordaba por fuera —un correo escrito a mano, un teléfono— y de vuelta no quedaba constancia de
cuándo fue, de si la persona vino ni de quién había quedado en llamarla.

- **El bloque está siempre, sin depender de la situación de la postulación.** Se entrevista
  justamente para decidir, así que esperar a que la postulación esté aprobada llegaría tarde.
- **Y cerrar una entrevista no cambia la situación de la postulación.** Haber entrevistado a
  alguien no es haberlo aprobado: eso se decide arriba, en el selector de estado, y sigue siendo
  una decisión de una persona.
- **Hay una sola entrevista viva por vez, y las demás son historia.** Que a alguien se le haya
  reprogramado dos veces y no se haya presentado es lo que se quiere ver antes de decidir, así que
  las anteriores se listan con su resultado y su observación en vez de desaparecer.
- **Al postulante le llega su propio enlace, nunca la dirección de la sala**
  (`backend/src/routes/entrevistaPublica.js`). Abre sin cuenta y sin clave: la llave que le llegó
  por correo es toda su credencial, igual que en la activación de cuenta. Por eso reprogramar no
  obliga a mandarle una llave nueva, y el Panel copia ese enlace y no la sala.
- **La sala aparece recién a la hora de la cita.** Llegar temprano no es equivocarse: la pantalla
  del postulante no muestra ningún error, dice en qué momento está —todavía no, entre ahora, ya
  pasó— y qué corresponde hacer. Del lado del motor eso viaja como un dato de la respuesta, no como
  una falla.
- **Sin dirección de videollamada la entrevista se agenda igual.** La dirección base es
  configuración de cada Prestadora (`prestadoras.videollamada_base_url`), y el producto le agrega
  un nombre de sala imposible de adivinar. Vacía esa dirección, la pantalla del Panel avisa que va
  a haber que comunicarse por otro medio y la del postulante también: el producto avisa, no
  prohíbe (`celtatech/CLAUDE.md` §7).
- **El día y la hora se convierten en un solo lugar**
  (`panel/src/lib/momentoDeLaEntrevista.js`), porque el campo del navegador habla en la hora de
  quien mira y el motor guarda un instante universal. Su prueba hace ir y volver sin fijar ningún
  huso: escrita con un huso adentro pasaría acá y fallaría en la máquina que publica.

## Programa de capacitación (Etapa 5 del Proceso de Incorporación de Asistentes)

8 horas online en 4 bloques (2hs c/u): 1) La persona mayor, 2) Cuidados esenciales, 3)
Seguridad y prevención, 4) El rol del Asistente (incluye uso de la app: check-in/out, reporte
diario, registro de medicación, código de conducta). Evaluación: 20 preguntas de opción
múltiple, aprobación mínima 80% (16 correctas). Emite Certificado de Aptitud digital (nombre,
especialidad, fecha, QR verificable) — mismo `qr_token` que ya existe en `asistentes`
(`DATA_MODEL.md`), no crear un segundo mecanismo de certificado.

## Fuera de alcance de este documento

Alianzas institucionales para avalar la capacitación (mencionadas como pendientes en el
original) y comparativas de posicionamiento frente a competidores — son decisiones de
negocio/marketing, no generan código.

# PLAN_DE_ACCION.md — Todo lo que falta, ordenado por quién lo hace y qué va primero

> Escrito el **2026-08-06**. Junta en un solo lugar los 36 pendientes abiertos de Careonys, los 6 de
> CeltaTech, las etapas de planes que quedaron a medio construir, las tareas que se hablaron y nunca
> se anotaron, y lo que se decidió el 2026-08-03 sobre cómo tiene que estar organizado el Panel.
>
> **Este documento no reemplaza a `PENDIENTES.md`.** Ahí vive el detalle de cada cosa —qué es, cuándo
> se creó, cómo se cierra—. Acá vive el **orden**: quién la hace y cuándo. Cuando algo se cierra, se
> cierra en los dos lados.

---

## Cómo se lee

**Los responsables son dos, y no se mezclan:**

- **El Desarrollador** — solo lo que nadie más puede hacer: plata, cuentas de terceros, contraseñas,
  textos legales y decisiones de negocio. Nada que se pueda resolver por línea de comandos aparece
  en su lista.
- **Claude Code** — todo lo demás: construir, migrar, desplegar, documentar, comprobar.

Cuando una cosa necesita a los dos, aparece en **Compartidos** con la parte de cada uno separada.

**Las prioridades son cinco, y significan esto:**

| Marca | Qué quiere decir |
|---|---|
| 🔥 **Ahora** | Tiene fecha, o algo deja de funcionar si no se hace |
| 🔴 **Antes del primer cliente real** | El día que entre una Prestadora de verdad, esto tiene que estar |
| 🟠 **Antes de mostrarlo** | Funcionalidad que falta para que el producto se pueda enseñar completo |
| 🟡 **Cuando se toque ese módulo** | Está decidido, pero no tiene sentido hacerlo suelto |
| ⚪ **Después del lanzamiento** | Diferido a propósito, con motivo escrito |

---

## Lo primero de todo: la única fecha dura, ya cumplida

**🟢 Pagado el 2026-08-06**, el mismo día del corte. El Desarrollador pagó el plan Hobby de Railway
y el backend siguió en el aire: comprobado en el momento, `…/health` responde **200**. Con él siguen
vivos la API que usan el Panel y las dos aplicaciones, los correos de activación, las notificaciones
a los teléfonos y los 8 relojes internos. *(pendiente `#103`, tarea 44 — cerrado)*

**No queda ninguna fecha dura por delante.** Las que vienen son condiciones, no calendario: "antes
del primer cliente real" y "antes de liberarlo a la venta".

---

# PARTE A — Lo del Desarrollador

Nueve cosas, más las decisiones diferidas del final. Ninguna lleva más de unos minutos salvo las que
dependen de un tercero (un abogado, un banco).

## 🔥 Ahora

**Nada.** La única con fecha era Railway y está pagada (`#103`, cerrado el 2026-08-06).

## 🔴 Antes del primer cliente real

| # | Qué | Dónde se hace |
|---|---|---|
| `X-15` | **Cambiar dos contraseñas que quedaron escritas en el registro de una sesión**: la de la base del panel de CeltaTech y la de la cuenta de GitHub `CeltaTech`. La de GitHub es la más grave: es dueña de los tres repositorios privados y no tiene segundo factor. Después hay que borrar ese registro de `C:\Users\Usuario\.claude\projects\` | Los dos sitios web, más la caja fuerte local. Los números de línea del archivo de claves están en `panel/docs/PENDIENTES.md`, fila `X-15` |
| `X-14` | **Activar el segundo factor en la cuenta de Supabase de CeltaTech.** De esa cuenta cuelgan las dos bases de datos de la empresa. Se postergó a propósito porque hace falta una aplicación generadora de códigos en el teléfono | `supabase.com/dashboard/account/security` → *Add new app*. Registrar **dos** generadores, no uno: si se pierden todos, Supabase no devuelve la cuenta |
| `X-13` | **Pasar la organización "Celta Tech" de Supabase a plan pago.** En el plan gratis la base se pausa sola por inactividad — eso no se le puede vender a nadie | `supabase.com`, facturación a `cuentas@celtatech.com` (tarea 15) |
| `#97` | **Decidir, clave por clave, si se cambian las que quedaron escritas en el registro del 2026-07-28**: la de Anthropic, las de Cloudflare y las demás. Es una decisión, no un trabajo: si dice que sí, el cambio lo hace Claude Code | — (tarea 24) |
| `#102` | **Conseguir la respuesta legal sobre seguimiento de ubicación**, por país. Los documentos legales de los 21 países no dicen una palabra del tema y el sistema está diseñado para seguir personas. Hace falta: qué se puede guardar del recorrido y por cuánto, qué consentimiento hace falta, y si retirarlo puede tener consecuencias | Un profesional por jurisdicción. Frena la Etapa 6 del Panel (tarea 42) |
| `#107` | **Qué significa "verificar" una matrícula**: ¿alcanza con mirarla, o hay que comprobarla contra el registro oficial del colegio? La regla dura ya está construida y funcionando; lo que falta es el alcance legal | Consulta legal por país y, si hace falta, por profesión |

## 🟠 Antes de mostrarlo

| # | Qué |
|---|---|
| `#116` | **Aprobar o corregir el mapa nuevo del Panel** — los seis grupos propuestos el 2026-08-03. Es lo único que hoy frena construir pantallas nuevas del Panel, porque mover pantallas después de apilarles cosas encima es lo caro |
| `#115` | **Las dos decisiones de la subcontratación**: (1) ¿quién controla la matrícula y los documentos de la gente de la empresa subcontratada — la Prestadora uno por uno, o se le exige a la empresa? (2) ¿cómo se marca el presente — su gente usa la aplicación de Asistentes, o la empresa manda su parte? |
| `#113` | **Tres preguntas del pase de guardia por QR**: qué pasa si la Familia no tiene el teléfono a mano; si el código de la Familia es fijo o cambia; y si el Asistente que se va tiene que estar presente para el relevo |
| `#109` | **¿Un Paciente de nivel III exige un tipo de Asistente determinado?** Hoy el nivel de complejidad del Paciente y el tipo de Asistente son dos cosas sueltas. Aparte: hoy no está escrito en ningún lado qué significa cada nivel |
| `#112` | **Juntar la lista de lo que no le gusta de la apariencia**, pantalla por pantalla. Quedó para el final a propósito, cuando la funcionalidad esté completa |
| — | **Poner la aplicación en el modo de permisos que no pregunta.** Solo lo puede hacer él, desde el selector de modo de la aplicación |
| — | **Autorizar el borrado del `git_backup_pre_filter_repo_sitio_web_20260718.zip`.** Preguntó el 2026-07-28 si servía o se borraba y nunca se contestó. Claude Code revisa qué tiene adentro y le dice; borrar es irreversible, así que la orden es suya |

## 🟡 Cuando se toque ese módulo

| # | Qué |
|---|---|
| `#37` | **Cómo seguir con el bloqueo del puerto de correo** que impide probar de punta a punta la recuperación de segundo factor. El código está construido; lo que falla es que el mail no sale |
| `#19` | **Cuándo se aborda el módulo de facturación y pagos.** De ahí cuelga el modelo con intermediario para Asistentes monotributistas |
| `#93` | **Los precios reales de los planes.** Hoy hay tres filas de relleno. Está en pausa a propósito: depende de terminar la separación CeltaTech/Careonys, no de que él decida precios hoy |
| `#49` | **Cuándo se hace el sitio público real de Careonys.** Decidió esperar a que el software esté lo bastante completo como para mostrarse |

## ⚪ Después del lanzamiento

| # | Qué |
|---|---|
| `#70` | Alcance del **constructor de páginas** para que cada Prestadora arme la suya (concepto tipo WordPress + Elementor). Es un producto nuevo de CeltaTech, así que necesita plan aprobado antes de una línea de código |
| `#53` | Modalidad de vínculo **"Cooperativa de trabajo"** (asociado con liquidación cooperativa). *Ojo: es una cosa distinta de la modalidad de subcontratación del `#115`, aunque hoy compartan la palabra* |
| `#54` | Documento legal de **protección de datos personales** en Argentina (Ley 25.326) |
| `#55` | Rol **auditor/regulador** de solo lectura, para programas estatales que exigen trazabilidad |
| `#57` | Módulo de **cobranza a obras sociales**: seguimiento de reclamos, rechazos y demoras |
| `#58` | **Tablero de rotación de Asistentes.** La rotación es el problema número uno del rubro |
| `#59` | **Detalle de cargos visible para la Familia**, no solo la reconciliación interna |
| `#77` | **Residencia** como entidad distinta de Servicio |
| `#76` | **Plazo de retención de datos por país** |
| `#108` | Revisar, después del lanzamiento, si algún módulo de Careonys tiene que subir a la Plataforma CeltaTech |

---

# PARTE B — Lo de Claude Code

## 🟠 Grupo 1 · Las funciones que se pidieron y no están

Esto es lo que se habló, se anotó y nunca llegó al código. Es el corazón de lo que falta.

| # / tarea | Qué falta | Estado real, comprobado |
|---|---|---|
| `#113` / 66 | **Pase de guardia por QR.** El Asistente da el presente escaneando el código de la Familia o el del Asistente al que releva, y al terminar vuelve a escanear para cerrar | No existe nada. Peor: hoy el cierre de guardia **no tiene botón propio** — se cierra como efecto secundario de mandar el reporte |
| `#106` / 68 | **Avisar que se viene una guardia y sigue sin cubrir.** Con el tiempo de anticipación configurable por Prestadora | El proceso que recuerda guardias solo le escribe al Asistente asignado: si no hay nadie asignado, no hace nada. La migración que hacía falta ya está aplicada, así que ya no está trabado |
| — / 89 | **Que la Familia vea qué hace y qué no hace su Asistente.** Las dos listas separadas, nunca un párrafo que las mezcle | El catálogo de tipos y tareas ya está construido en el Panel. Falta mostrarlo del lado de la Familia |
| `#94` / 93 | **Domicilio compartido**: dos Pacientes bajo el mismo techo atendidos por una sola Asistente. El riesgo no es la facturación, es que el segundo Paciente se quede sin historia clínica propia | El negocio quedó respondido el 2026-08-01. Falta construirlo |
| `#101` | **Aviso de demora en el trayecto.** Botón de salida, cálculo de llegada estimada, aviso a la Familia con hora estimada y sin mapa en vivo, y constancia de cuándo se apagó el seguimiento y por qué | Diseño conversado y escrito completo. La parte de rastreo continuo está trabada por `#102`; **la parte de actos deliberados no lo está** y se puede construir ya |
| `#95` | **La marca de la Prestadora en las dos aplicaciones de teléfono.** Hoy la Familia y el Asistente ven la marca del software donde debería ir la de su Prestadora | Modelo decidido el 2026-07-27 (co-branding). Implementación sin empezar. **Mientras siga abierto, no se agrega ningún uso nuevo de la identidad del producto en las dos PWA** |
| `#110` / 95 | **Traducir los mensajes de error.** Hoy salen tal como los escupe el navegador, en inglés, con nombres de tablas adentro | 158 lugares muestran errores crudos. Falta la función única que los traduzca |
| — / 87 | **Un solo control de vencimientos, no dos.** Hoy los documentos y las matrículas se vencen por caminos distintos | — |
| — / 88 | **Reemplazar `asistentes.especialidades`** por el vínculo al catálogo de tipos de Asistente | La palabra "especialidad" ya está marcada como retirada en el glosario, pero la columna sigue viva |
| — / 90 | **Definir qué es un Servicio.** Propone Claude Code, corrige el Desarrollador | Es el concepto superior del negocio y hoy la definición fina no existe. Se cruza con `#116` |
| — / 64 | **Que toda alerta se pueda configurar desde el Panel de la Prestadora** | — |
| — / 65 | **Que cada Prestadora defina qué muestran las pantallas de Familias y Asistentes** | — |
| — | **Login sin traba para desarrollo.** El 2026-07-31 el Desarrollador ofreció dejar el login pasando sin usuario ni contraseña durante el desarrollo. Nunca se contestó ni se anotó | Hoy la consecuencia se ve: la base local está vacía y no hay forma de mirar una pantalla sin sembrarla a mano. Se resuelve junto con `#111` |

## 🟠 Grupo 2 · Reorganizar el Panel como el negocio

Todo esto es `#116` y `#115`. **En pausa hasta que el Desarrollador apruebe o corrija el mapa.**

Lo que se hace cuando dé el visto bueno, en este orden:

1. **Renombrar `cooperativa` a subcontratación** (`#115`). Antes: comprobar contra la base viva que
   ninguna Prestadora tiene ese valor guardado —con cero filas el cambio es gratis—. Después: la
   restricción de la tabla, el código, las dos entradas nuevas del glosario y el registro del cambio.
   También hay que revisar `asistentes.canales`, que hoy solo admite `directo` y `marketplace`.
2. **El menú nuevo**, en los seis grupos que son las preguntas del operador en orden.
3. **La pantalla de Servicios**, que hoy no existe: el menú salta de Familias a Guardias.
4. **La pantalla de lo que se le paga al Asistente**, que hoy no existe en ninguna forma. Las tres de
   cobrarle a la Familia sí están (facturación, lista de precios, informes a obra social); la mitad
   de pagar no está en ninguna de las 30 pantallas del Panel.

**El mapa propuesto**, para que se lea sin ir a buscarlo:

| Grupo | Qué contesta | Qué va adentro |
|---|---|---|
| *(sin grupo, arriba)* | Cómo está todo ahora | Estado actual · Resumen del mes · Bandeja |
| **Clientes** | Quién compra y qué compró | Familias · **Servicios** (nueva) · Lista de precios |
| **Cobertura** | ¿Hay alguien? | Guardias · Continuidad · Ofrecimientos |
| **Cumplimiento** | El que está, ¿hace su trabajo? | Reportes · Alertas · Medicación · Verificación |
| **Plantel** | Quién puede cubrir y quién todavía no | Asistentes · Documentación · Postulaciones · Solicitudes · Calificaciones |
| **Dinero** | Dos columnas, no una | Lo que se cobra · **Lo que se paga** (nueva) |
| **Ajustes** | | Configuración · Usuarios · Auditoría · Importación · Prestadoras · Costos de IA |

## 🔴 Grupo 3 · Limpieza y herramientas de trabajo

| # / tarea | Qué |
|---|---|
| `#111` | **Archivo de siembra de la base local**: una Prestadora ficticia, un usuario por cada uno de los tres roles, y unos pocos Pacientes, Asistentes y guardias, que se aplique con un solo comando. Sin esto no se puede mirar ninguna pantalla sin trabajo manual, y **la base de la nube no se toca para probar** porque tiene datos y credenciales reales |
| `#114` | **54 textos escritos en los tres idiomas que ninguna pantalla usa.** Son funciones empezadas y dejadas por la mitad. Tres grupos se borran, uno se resuelve construyendo el pase de guardia (`#113`), y uno se revisa uno por uno. El barrido queda incorporado como paso obligatorio antes de cerrar cualquier etapa |
| `X-10` | **Un borrado bloqueado por la seguridad de la base devuelve el mismo código que uno exitoso.** Hoy no se ve el problema porque el panel recarga la lista después, pero la trampa está armada para el próximo que confíe en el código de estado |
| `X-11` | El mismo aviso aparece dos veces en la ficha de suscripción, en tres idiomas |
| `#104` / 46 | **Reescribir `PRD_01_Sitio_Web.md`.** El único documento que describe la página pública describe la página equivocada: habla de venderle cuidado a familias, cuando el producto le vende software a empresas de cuidado. El encuadre ya está confirmado |
| — / 39 | **Renombrar la carpeta `productos/aurevia`** al nombre del producto |
| `#18` | **Vigilancia permanente**: en toda sesión, buscar cosas que quedaron fijadas de una sola manera pensando en una sola Prestadora. No se cierra nunca |

## 🟡 Grupo 4 · Lo que espera a otro

| # / tarea | Qué | Espera a |
|---|---|---|
| — / 63 | **Etapa 6 del Panel**: el tablero de quién dirige y la ubicación en vivo | `#102`, la respuesta legal |
| — / 34 | **Borrar los 3 despliegues viejos de la cuenta personal de Vercel.** Las tres aplicaciones ya están arriba en Cloudflare desde el 2026-07-30 | Comprobar antes un correo de activación real con las direcciones nuevas (tarea 45) |
| — / 30 | **Partir `configuracion_plataforma` en dos.** Es el último paso que le falta a la Etapa 2 del plan de separación | Nada. Se puede hacer ya |
| `#14` | Medir el costo real de infraestructura por Prestadora y reflejarlo en el precio | Que se aborde facturación |
| `X-9` | Un cambio de estado de suscripción no registra el motivo; un override sí lo exige | Que el Desarrollador diga si el motivo es obligatorio |

## ⚪ Grupo 5 · Al final, a propósito

| # / tarea | Qué |
|---|---|
| `#112` / 50 | **La identidad visual de las tres aplicaciones.** Está frenada por decisión del Desarrollador el 2026-08-02: prefiere retocar el aspecto cuando la funcionalidad esté completa, para no rehacer lo mismo dos veces. **No está olvidada — está esperando** |

---

# PARTE C — Planes empezados y no terminados

Esto es lo que no aparece en ninguna lista de pendientes porque vive adentro de un plan.

## C.1 · Separación CeltaTech / Careonys — 6 etapas de 8 sin hacer

Documento: `F:\proyectos\celtatech\docs\PLAN_SEPARACION_CELTATECH.md`

| Etapa | Qué es | Estado |
|---|---|---|
| 0 | Higiene previa | 🟢 Cerrada 2026-07-28 |
| 0.5 | Identidad del producto configurable | 🟢 Cerrada 2026-07-27 |
| 1 | CeltaTech existe, vacío y aislado | 🟢 Cerrada 2026-07-28 |
| **2** | Careonys deja de ser Nivel 1 | 🟡 **Casi**: falta partir `configuracion_plataforma` (tarea 30) |
| **3** | El contrato: qué tiene habilitado cada Prestadora, consultado y guardado en caché | 🔴 Sin empezar |
| **4** | Que los límites signifiquen algo de verdad | 🔴 Sin empezar. **Esta es la que hay que terminar antes del primer cliente que pague** |
| **5** | CeltaTech avisa: altas, suspensiones, bajas | 🔴 Sin empezar |
| **6** | Careonys reporta cuánto se usó | 🔴 Sin empezar |
| **7** | Cobranza de CeltaTech: facturación, ARCA, pasarela de pago | 🔴 Sin empezar |

> **La ventana barata se está cerrando.** Las etapas 2, 3, 4 y 6 son las que cambian comportamiento.
> Hoy no hay ningún cliente real, así que no pueden afectar a nadie. El día que haya uno, las mismas
> etapas pasan a ser migraciones con datos vivos, ventana de mantenimiento y plan de retroceso.

## C.2 · Rediseño del Panel — 5 etapas de 6

Las etapas 1 a 5 están cerradas (la guardia sin cubrir, las pantallas de reportes/alertas/bandeja, el
sistema de diseño con modo oscuro, el Estado actual con la grilla nueva, y el menú de seis grupos con
Configuración partida en cinco).

Falta la **Etapa 6** (tarea 63) y está trabada por `#102`.

**Y encima de todo eso viene `#116`**, que reorganiza el menú otra vez — esta vez por el negocio y no
por lo que una persona viene a hacer. Es un cambio de criterio, no un arreglo del anterior.

## C.3 · Módulo 6 (Guardias) — falta la Parte 3

Las Partes 1 y 2 están construidas y probadas. La **Parte 3, "piezas de apoyo"**, nunca se hizo y
tampoco tiene documento propio que diga qué es (`BUILD_ORDER.md`). *Primer paso: averiguar qué se
quiso decir con eso, o darlo por absorbido en el resto.*

## C.4 · Las 11 observaciones del estudio comparado

Documento: `docs/REVISION_PANTALLAS.md`, escrito comparando las tres aplicaciones contra software
maduro del rubro. Ninguna se aplicó todavía.

**De ACOMODO — dónde está cada cosa, se encarece con el tiempo:**

1. La aplicación del Asistente **no tiene la lista de tareas del turno**. Sabe a dónde va y a qué
   hora, no qué tiene que hacer. Se cruza con la tarea 89 y con el catálogo de tareas ya construido.
2. El botón que cierra la guardia **se llama "Confirmar"** y en realidad es el cierre. Se cruza con
   el pase de guardia (`#113`).
3. El Asistente **no puede ver ni aceptar las guardias que se le ofrecen** desde su aplicación. La
   base ya guarda los ofrecimientos desde la Etapa 1 del rediseño.
4. La Familia **ve la próxima guardia, no la semana**.
5. **No hay nada de dinero del lado de la Familia** — pero antes que un acomodo es una pregunta de
   negocio: ¿la Familia paga por el sistema o por afuera?

**De ASPECTO — cómo se ve, es barato al final:** la lista plana de "Mis guardias", el domicilio que
es texto y no un enlace al mapa, la medicación escondida detrás de un botón, los estilos escritos a
mano pantalla por pantalla, la aplicación de la Familia que abre en una lista en vez del estado de
hoy, y la lista de reportes que no dice nada de lo que pasó. **Todo esto va junto con `#112`, al
final.**

## C.5 · Diferido de entrada

- **Aplicación de tienda** (Google Play / App Store): la condición ya está escrita y no espera
  decisión de nadie — se dispara sola cuando se cumpla.
- **IA niveles 3 a 5** (emparejamiento, asistente virtual, análisis predictivo): esperan datos
  históricos suficientes.
- **Las 5 ideas de `BACKLOG_OPORTUNIDADES.md`**: comparación de Asistentes visible solo para el
  administrador, videollamada de entrevista sin compartir contactos, cursos para familias, el rol
  humano de "gestor del cuidado", y acompañamiento en línea.

---

# PARTE D — El orden en que conviene hacerlo

No es una lista de deseos: es el orden que evita rehacer trabajo.

**Hoy y mañana, sin esperar a nadie:**

1. ~~Él paga Railway.~~ 🟢 Hecho el 2026-08-06.
2. El pase de guardia por QR (`#113`). **No depende del mapa del Panel**: vive en la aplicación del
   Asistente, que tiene cuatro pantallas y no la toca la reorganización del menú. Arreglando eso se
   arregla también la observación 2 del estudio comparado y parte del grupo 1 de textos huérfanos.
3. El archivo de siembra de la base local (`#111`). Todo lo que venga después se prueba más rápido.
4. El aviso de guardia sin cubrir (`#106`). Ya no está trabado.

**Cuando él conteste el mapa:**

5. Renombrar la modalidad (`#115`) — con la base vacía es gratis, con una fila deja de serlo.
6. El menú nuevo, Servicios y la pantalla de pagos (`#116`).

**Antes del primer cliente real, sin orden entre ellas:**

7. Las tres de seguridad de sus cuentas (`X-15`, `X-14`, `X-13`).
8. La marca de la Prestadora en las dos aplicaciones (`#95`).
9. La Etapa 4 de la separación — que los límites signifiquen algo.

**Al final, todo junto:**

10. La identidad visual y las seis observaciones de aspecto (`#112`).

---

## Cómo se mantiene este documento

Cuando algo se cierra, se cierra en los dos lados: acá y en `PENDIENTES.md`. Cuando aparece algo
nuevo, entra primero en `PENDIENTES.md` —que es la lista obligatoria— y después se ubica acá en su
grupo. Si los dos documentos se contradicen, manda `PENDIENTES.md`.

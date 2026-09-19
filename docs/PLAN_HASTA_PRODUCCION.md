# PLAN HASTA PRODUCCIÓN — Careonys

**Una sola lista, del 1 al 90, en orden.** Se hace el 1, después el 2, y así hasta el final.

- Los pasos que empiezan con **Usted** los contesta o los hace el Desarrollador. Los demás los hago yo.
- **Un paso terminado se borra de este archivo.** No se marca como hecho: se saca.
- **No se abren pendientes nuevos.** Un problema que aparece se arregla en el momento; si no cabe en la tarea que se está haciendo, se agrega como paso en el lugar de la lista que le corresponde.
- **Nada de acá se cita por número desde afuera.** El número se corre solo con borrar un paso terminado, así que un documento que diga «paso 103» miente apenas se avanza. Desde otro documento se cita este archivo y el título de la sección.

---

## La mudanza desde Match

**Va primero, y por eso está acá arriba.** Casi todo lo que sigue se encarece si se construye
antes: cada pantalla de configuración nueva escrita a mano es una que después hay que deshacer, y
la sección de Reclutamiento está esperando justamente esto.

**Cómo se hace, y no se repite en cada paso:**

- **Allá no se borra ni se altera nada.** Match es fuente de lectura. Todo se escribe de
  este lado, contra el esquema de Careonys, que es distinto. Si algo de allá está roto o
  incompleto, se informa dónde está y se sigue: no se arregla allá.
- **Ninguna pieza viaja entera ni se descarta entera.** Antes de escribir nada, cada una se parte
  en modelo de datos, aislamiento en la base, comportamiento en pantalla, textos y chequeos
  automáticos, y cada parte se decide por separado. Lo corriente es que se quede la mitad de acá y
  viaje la otra mitad.
- **De la parte visual no viaja nada.** El aspecto del sitio público de Match está tomado
  casi literal de un competidor. Los archivos y el código son propios y se leen sin problema, pero
  la disposición, los colores, las tipografías, las imágenes y los textos de venta no vuelven a
  aparecer, ni rehechos parecidos. Si Careonys necesita un sitio público, el diseño se hace de cero
  con la identidad propia.
- **La lógica que interesa vive afuera de las pantallas**, salvo cuatro renglones sueltos que están
  señalados en el paso que los necesita.
- **El inventario de allá se usa como lista de control**, leyéndolo y sin escribir en él.

**1.** Los papeles del legajo del Asistente. Hoy `documentos_asistente` guarda tipo y vencimiento
**sin columna de archivo y sin depósito**: el papel en sí no está en ningún lado. Se crea el
depósito privado por migración, con sus políticas en la misma migración, con la primera carpeta
igual a la cuenta y un identificador único en el nombre para que volver a presentar un papel no
pise el anterior. **Y se corrige el hueco que allá quedó anotado y sin resolver:** la ruta empieza
por la cuenta y no por la Prestadora, así que el día que una cuenta tenga legajo en dos, las dos
verían la misma carpeta. Acá la ruta empieza por la Prestadora.

**2.** Recuperar la clave y cambiarla. **No existen en ninguna de las tres aplicaciones.** Hoy
quien pierde la clave depende de que un administrador le reenvíe la invitación, y el administrador
que pierde la suya depende del rol técnico; la clave temporal del alta se le devuelve al
administrador para que la comunique a mano. Entra acá también el mínimo de caracteres, que hoy son
ocho escritos a mano en cuatro archivos y seis en la configuración de la plataforma, que es la que
manda: cualquier camino que no pase por la activación acepta seis. Un solo lugar decide el número.
Y se corrige el canje del enlace de activación, que fija la clave antes de marcar el enlace como
usado y sin que las dos cosas vayan juntas, así que si el segundo paso falla el enlace sigue
sirviendo (`backend/src/utils/activacionCuenta.js:114-117`).

**3.** Una cuenta en varias Prestadoras. Es regla decidida y hoy es imposible: la tabla de cuentas
tiene una sola Prestadora por cuenta. La ficha pasa a ser una por Prestadora colgando de la misma
cuenta, y adentro de una Prestadora el mismo correo no puede aparecer dos veces. Aparte se guarda
en cuál está parada la sesión, una por vez, **escrita por el servidor después de comprobar la ficha
y nunca por el pedido**, y comprobada de nuevo cada vez que se lee. Si la persona está en una sola,
entra derecho; si está en varias, elige. Viaja además el detalle que sostiene todo: **quien resuelve
o verifica algo tiene que ser de la misma Prestadora que aquello sobre lo que actúa**, atado con
claves de dos columnas para que lo impida la base y no la pantalla.

**4.** Las listas de opciones por Prestadora. Es el aporte más grande y lo que destraba
Reclutamiento. Un registro genérico de dos pisos: la lista que trae el producto y la que agrega
cada Prestadora, con los tres idiomas adentro de cada opción y la base rechazando la que venga
incompleta, más la marca de qué listas admiten opciones propias. Una sola pantalla las edita
todas. Hoy acá cada lista nueva cuesta una migración, y hay doce tablas de configuración de una
fila cada una con más de seis mil renglones de pantalla dibujados a mano. **Dos reglas de allá
están escritas adentro de su pantalla y hay que rehacerlas acá:** desde qué número se ordenan las
opciones que agrega una Prestadora, y que lo que ella carga queda en un solo idioma.

**5.** Los formularios declarados. Careonys no tiene la pieza: hoy los campos, las validaciones y
los pasos se escriben pantalla por pantalla. Viene la declaración con tipo, obligatoriedad, largo
máximo, formatos de archivo aceptados, secciones que se repiten y bajo qué condición un formulario
pasa a ser obligatorio, más el motor que la dibuja y la valida. **Se deja afuera el renglón de
ayuda debajo de cada casillero**, que la regla de la empresa no admite.

**6.** Las resoluciones. Hoy acá se pisa el estado sin quién ni cuándo. Pasan a ser una fila nueva
con motivo obligatorio y firma de quién resolvió.

**7.** El registro de lo que hace la gente de una Prestadora. **Hoy acá no existe, y está así a
propósito:** sólo se anotan las sesiones de soporte, las advertencias legales y dos casos sueltos.
La regla de la empresa pide auditar entrada administrativa, cambios de permisos y de membresía,
borrado de datos, modificaciones críticas y toda acción con consecuencia económica.

**8.** Las reglas de qué no se puede mandar en un mensaje. Hoy acá son cuatro expresiones escritas
en el código, y el texto se guarda entero y se tapa recién al mostrarlo, así que quien llame al
motor de otra forma ve todo. Vienen las reglas como dato en una tabla, con su motivo en los tres
idiomas, y reconociendo mucho más: domicilio, teléfono escrito con palabras, correo disfrazado,
nombre de usuario de otra aplicación e invitación a seguir la charla en otro lado. **La decisión de
tapar y no bloquear queda como está**: lo que viaja es el cuerpo de reglas y su forma de guardarlas,
que sirve para tapar mejor de lo que se tapa hoy. **Cuidado al traerla:** allá el único lugar vivo
que la llama es una pantalla de maqueta, así que la pieza parece muerta y no lo está; el control de
verdad corre en la base, antes de guardar.

**9.** Los catálogos. Una sola pieza que trae cualquier lista y devuelve siempre los cuatro
estados, consultando la base primero y cayendo al archivo guardado sólo si la base no contesta.
Hoy acá hay unas veinte piezas repitiendo lo mismo, y pantallas que se olvidan de usarlas: en
Postulaciones se toman las zonas y se descartan el estado y el error, así que mientras cargan, o si
fallan, el filtro se ve igual que si la Prestadora no tuviera ninguna zona.

**10.** Los tres idiomas, tres cosas. Elegir el idioma la primera vez mirando la dirección y
después el navegador, comparando sólo la primera parte para que portugués de Portugal caiga en
portugués de Brasil: hoy quien entra por primera vez con el navegador en inglés ve todo en
castellano. Que una frase que falta avise en vez de dibujarse como un hueco en blanco. Y el
marcador de la Prestadora en el texto visible, que es el mecanismo del pendiente ya abierto de que
la pantalla de ingreso muestre la marca de ella y no la del producto. **Va sin la ruta del
logotipo, que esa pieza arrastra adentro.**

**11.** Los chequeos que corren solos. Que ninguna fecha ni importe lleve el idioma escrito
adentro —**hoy acá está roto en cinco lugares**, así que la pantalla en inglés muestra las fechas al
revés—; que toda pantalla que carga datos tenga los cuatro estados y saque su texto del catálogo;
que ninguna frase esté igual en los tres idiomas; y el corredor que arma la lista mirando la
carpeta, para que un chequeo nuevo no dependa de que alguien lo anote. **De los de allá, ocho miran
apariencia y no vienen**, y otros ocho nombran el sitio público adentro y hay que recortarlos.

**12.** La moneda. La pantalla donde la Prestadora la configura y la regla de que no haya importe
sin moneda. El completado automático al insertar ya está hecho de este lado; falta la pantalla, que
hoy se promete en un comentario y no existe.

**13.** El aislamiento de la conversación. Que la base impida que un hilo junte a una Familia y a
un Asistente de dos Prestadoras distintas, con claves de dos columnas —técnica que Careonys ya usa
en otras tablas, así que acá falta, no es que no se pueda—. Que una sola función decida si el hilo
es propio, en vez de la misma condición copiada en cuatro políticas. Y que el hilo abierto se
refresque solo pidiendo nada más lo posterior al último que ya tiene, sin borrar lo leído cuando el
refresco falla, con botón de volver a intentar, y vaciando lo escrito y sin enviar al cambiar de
hilo para que no salga hacia otra persona.

**14.** Separar leer de escribir la configuración en la base. Hoy ese control vive sólo en la
pantalla. Pasan a ser políticas: los catálogos los lee cualquiera, los escribe sólo el personal de
la Prestadora, y lo de cada Asistente lo escribe además el dueño de su propio legajo.

**15.** Las piezas de las dos aplicaciones de teléfono. **Nada de esto es apariencia ni recorrido,
así que no espera la maqueta**; lo único que la toca es el aviso de la cola, que se deja escrito y
se coloca cuando la maqueta llegue. Son cinco: que la hora del hecho la ponga el teléfono y se
guarde aparte de la hora de llegada a la base, con el identificador puesto de antemano para que un
reenvío no duplique; que la cola sin señal tenga tope de intentos, muestre el motivo del rechazo
—hoy se guarda y no se muestra nunca— y quede atada a quien tiene la sesión abierta, porque hoy se
procesa la de cualquiera; que al fallar la ubicación se distinga «lo negó la persona» de «el
teléfono no pudo», porque hoy se le dice «active el GPS» a alguien que lo tiene activado y está
adentro de un edificio; que la alarma de jornada abierta o salida sin entrada le llegue también a
la Familia y no sólo a quien coordina; y que la pantalla de inicio del Asistente pida sus datos por
zonas separadas, con reintento, porque hoy un error de carga es callejón sin salida.

**Lo que se miró y no viaja, para que no se vuelva a discutir:** las quince pantallas del sitio
público y la maqueta; los consentimientos, donde Careonys está muy por delante —texto versionado
por jurisdicción e idioma, con copia exacta de lo que la persona leyó, y con rechazo y retiro—; el
tope de alarma, que acá tiene topes por Prestadora, cuatro escalones de gravedad y escalada de la
que nadie atiende; las verificaciones; los reportes de turno; y el seguimiento de ubicación, donde
lo de acá es mejor salvo el motivo de la falla, que ya está en el paso 15. **Se retira** la
disponibilidad horaria del Asistente: no la lee ningún programa ni ninguna pantalla, de ninguno de
los dos lados. Y los textos legales de allá no sirven: son de una sola Prestadora, sin versión y
sin dónde queden guardados.

---

## El dinero

**16.** Escribir la conexión de ida con el software de facturación de la primera Prestadora, cuando
haya una y ella lo elija. **No se escribe antes**: se miraron los cinco que más se usan en
Argentina y se conectan todos parecido pero con datos distintos, así que escribir uno a ciegas es
acertar con suerte. Lo investigado está en `docs/FACTURADORES_Y_COMO_SE_CONECTAN.md`. **Cada
software es una pieza aparte** y agregar la segunda no puede obligar a tocar la primera. Las otras
dos maneras ya están hechas y alcanzan para salir a producción: se anota factura por factura a
mano, o se baja un archivo con todo lo que falta facturar y se sube el que el software devuelve.

**17.** Que la Prestadora pueda cargar en Configuración la conexión con su software de facturación
y con el de créditos y cobranzas —cuál es, con qué credencial se entra— sin que ninguna alcance
los datos de otra Prestadora. La credencial se guarda como secreto y no se vuelve a mostrar, igual
que el secreto de la firma.

**18.** Que la pantalla de la Familia tampoco muestre un saldo calculado acá cuando la cobranza la
lleva otro software. En el Panel ya está resuelto; en la aplicación de la Familia sigue mostrando
la resta de lo que el propio sistema registra, que es el segundo número para lo mismo. **Espera la
maqueta**, porque cambia lo que la Familia ve y las dos aplicaciones de teléfono no se tocan hasta
que llegue.

**19. Usted** — ¿Se agrega una tercera vía de pago, con un intermediario que reciba en bloque y redistribuya? Si es sí, antes hay que resolver si eso cambia quién ejerce el control (art. 23 LCT).

---

## Que los avisos lleguen

**20. Usted** — ¿Qué situaciones puede contestar la IA sola? Hoy la única regla es el criterio del modelo.

**21.** Hacerlo configurable por Prestadora, según lo contestado.

**22. Usted** — ¿Se saca el tope de una semana hacia atrás de la ventana de aviso de guardias sin cerrar?

**23.** Sacarlo, si corresponde.

**24. Usted** — Pase de guardia, dos preguntas: cuando la llegada queda sin comprobar, ¿se le avisa igual a la Familia? Y un relevo, ¿cierra una guardia y abre la siguiente en un solo acto, o quedan dos constancias?

**25.** Ajustar el pase de guardia según lo contestado.

---

## La modalidad Match de cara a la Familia

Existe el andamiaje —base, disparadores, cobros, consentimiento—, la Familia ya puede buscar un Asistente, ver su perfil público, escribirle por adentro de la aplicación y, activando el cobro, ver cómo llegar a él por afuera. **Todavía no puede contratarlo.**

**26. Usted** — Prioridad de acceso al plantel ante una baja: el PRD la define en una línea (`docs/PRD_07_Modalidad_Marketplace.md:225`) y de ahí salen dos productos distintos. ¿Es que el contacto del reemplazo no vuelva a costar durante una ventana —ni descuenta saldo ni pide un acceso nuevo—, o es que a esa Familia se le avise primero cuando alguien del plantel vuelve a estar disponible? ¿O las dos? Y antes que eso: hoy la Familia no contrata por Match, así que no hay baja que detectar. ¿Qué cuenta como baja — que el Asistente se saque de los disponibles, que la Familia cierre el Servicio, o hay que construir antes el vínculo?

**27.** Construirla según lo contestado.

---

## Los huecos del Panel

**28. Usted** — Dos preguntas de la Solicitud: ¿cómo se le presenta la Asistente nueva a la Familia — aviso sin respuesta, aceptación explícita, o fuera del sistema? ¿Y se construye la vista mapa del plantel por zona, o se saca?

**29.** Vista mapa del plantel por zona, si va. No hay ninguna librería de mapas en el Panel.

**30. Usted** — Las dos observaciones de apariencia que quedan, porque las dos son decisiones de diseño: ¿con qué pantalla abre la aplicación de Familia cuando hay más de un Paciente — hoy abre en la lista, y con uno solo ya se saltea al detalle? ¿Y cuál es la identidad visual de las dos aplicaciones, que nunca pasaron por su etapa de diseño?

El Desarrollador está preparando una maqueta orientativa de cómo tienen que verse y cómo se recorren. **Hasta que llegue no se toca nada de apariencia ni de recorrido en las dos aplicaciones**, porque cualquier arreglo suelto de hoy es trabajo que la maqueta va a pisar. Lo que sí se corrige mientras tanto es lo que deja a alguien sin poder hacer su trabajo.

**31. Usted** — Rotación y retención de Asistentes: ¿cuál es la fórmula y cuál el umbral?

**32.** Ponerlo en el tablero. Se calcula desde `ceses` y `asistentes`, sin tabla nueva.

---

## Reclutamiento

**Esta sección esperaba la fusión, y ya no.** El reclutamiento es un módulo común a las dos
modalidades y la base de Asistentes de cada Prestadora es una sola para las dos; lo que faltaba
para poder construirlo son las listas de opciones por Prestadora y los formularios declarados, que
están arriba en esta misma lista. Sigue trabada por la pregunta **«¿dónde corre un módulo y contra
qué base?»**, más abajo.

Los tres arreglos, para que estén escritos:

1. **No existe el formulario público de postulación.** Hay una ruta de motor que acepta doce campos y ninguna pantalla que la use.
2. **Las listas de opciones nacen vacías.** Género, nacionalidad, tipo de registro ante AFIP y los cinco subgrupos de experiencia clínica se cargan por Prestadora, y no hay pantalla donde cargarlos: sin eso el formulario no tiene nada que ofrecer. **Lo resuelve el paso de las listas de opciones por Prestadora.**
3. **Al incorporar un aspirante se pierden quince datos.** Lo que cargó en la postulación no llega entero a su ficha de Asistente.

**33. Usted** — ¿Dónde vive el formulario público de postulación? No va en `careonys.com`, que le vende software a las Prestadoras: quien busca trabajo de cuidador se postula en la empresa que lo va a contratar. ¿En el sitio de cada Prestadora, con dirección propia?

**34.** La pantalla del formulario, que es lo único que falta: la base y el motor ya guardan y comprueban los campos de las seis secciones de `docs/PRD_03_Reclutamiento.md`, y el motor entrega las listas de opciones en `GET /api/publico/:prestadora/postulacion-asistente/opciones`. Se dibuja desde la declaración, no a mano. Esperaba el paso anterior.

**35. Usted** — ¿Se le bloquea la asignación de guardias a quien no está inscripto en monotributo, o se avisa y decide la Prestadora? La regla del producto dice avisar, no bloquear, así que el PRD y la regla no coinciden.

**36.** Construirlo según lo contestado.

**37. Usted** — Comparar automáticamente la foto del documento con la foto de la cara es tratamiento de dato biométrico, y hacen falta dos decisiones suyas: ¿cuál es el documento legal del que sale el aviso al Asistente, que hoy no existe y sin el cual no hay aviso? ¿Y qué proveedor compara las dos caras? Guardar las dos fotos y mostrarlas juntas ya está hecho: hoy las compara una persona.

**38.** Construirlo según lo contestado.

**39. Usted** — El programa de capacitación: qué contenido lleva, cuántas preguntas y qué nota se necesita para aprobar. Hoy «capacitación» es sólo el nombre de una etapa.

**40.** Construirlo.

---

## Las dos aplicaciones

**41. Usted** — Compartir el Certificado de Aptitud: ¿hacia dónde y por qué medio? Hoy se puede ver, con su estado y su fecha. Compartirlo hacia afuera exige decidir a quién se le manda, por qué canal y qué ve quien lo recibe, porque no existe ninguna verificación pública del certificado: sin eso, lo compartido sería una imagen que no prueba nada.

**42. Usted** — La alerta por salida del domicilio, tres decisiones que no puedo tomar yo. Hoy la cuenta se hace con una velocidad media única y distancia en línea recta (`backend/src/utils/llegadaEstimada.js:39-45`), se dispara recién cuando alguien marcó la salida, y mide llegada tarde, no que el Asistente siga en su casa.

- **El tiempo de viaje real sale de un servicio de mapas ajeno.** Cuál se contrata, con qué cuenta y qué se le manda en cada consulta —las coordenadas de la casa de una persona salen del producto— es decisión suya, y la credencial la pone usted.
- **Que alguien «siga en su domicilio» exige guardar dónde vive el Asistente.** Hoy su ficha no tiene domicilio ni coordenadas (`asistentes`), y lo único que se guarda del lugar de salida es el punto suelto de esa guardia, que no se muestra en ninguna pantalla. Guardar la casa de quien trabaja es dato personal nuevo.
- **Y exige mirar el teléfono antes de que la guardia empiece.** Hoy el GPS se lee cuando la persona aprieta un botón. Leerlo sola, mientras todavía no empezó a trabajar, es seguir a alguien fuera de su horario: hay que decidir si se hace, con qué aviso y con qué permiso.

**43.** Con eso contestado, construirlo — incluida la lista de medios de transporte, que hoy es texto libre escrito en cada salida y por eso no hay contra qué traducirlo a una velocidad.

**44. Usted** — El botón de contacto de «Asistente Asignado»: ¿a quién llama? El PRD lo dejó abierto —«WhatsApp o chat interno» (`docs/PRD_04_05_App_Servicio.md:224`)— y las dos salidas tienen consecuencias. Darle a la Familia el teléfono del Asistente es entregar el dato personal de quien trabaja, y es exactamente lo que Match cobra por abrir: ahí el contacto va tapado hasta que alguien paga. La otra salida es que el botón lleve a la Prestadora, que es con quien la Familia tiene el trato en prestación directa, usando el contacto que ella misma configura. Hay una tercera: el hilo interno, que hoy existe sólo para Match y con el tapado puesto.

De las especialidades de esta pantalla no queda nada por hacer: `asistentes.especialidades` está retirada por comentario de la migración y no se escribe más. Lo vigente es el tipo de Asistente, que ya se muestra, con sus Tareas de lo que corresponde y lo que no.

**45. Usted** — El PRD promete exportar el reporte a PDF en la aplicación de la Familia, y más adelante dice que la Familia no accede al informe. ¿Cuál de las dos vale?

---

## Configuración que todavía está escrita en el código

**46. Usted** — ¿Cooperativa como tercera modalidad de vínculo?

**47.** Construirla: migración que abra tres CHECK, filas de conceptos y fórmulas de cese.

**48. Usted** — Nivel de complejidad: ¿qué significa cada uno de los tres? ¿Condiciona qué tipo de Asistente se admite? Hoy se carga y se edita, y el cálculo de candidatos no lo mira.

**49.** Que el cálculo de candidatos lo use.

**50. Usted** — Verificar matrícula: ¿alcanza con mirar el archivo, o hay que comprobar contra el registro del colegio profesional? La mitad técnica está construida.

**51.** Construir la verificación según lo contestado.

**52. Usted** — Accesibilidad: el código está hecho, falta la respuesta legal. `docs/legal/argentina.md` no la menciona.

**53. Usted** — El Certificado de Aptitud impreso: ¿qué lleva? Hoy la pantalla genera el código de barras y ahí termina.

**54.** Armarlo. La subida del certificado a un depósito de archivos ya quedó resuelta con el
depósito de los papeles del legajo, más arriba en esta lista; hoy sólo se guardan fechas.

---

## Datos personales

**55. Usted** — Protección de datos personales: el texto lo tiene que dar el Desarrollador. `docs/legal/argentina.md` tiene ocho secciones y ninguna es de esto. Sin documento no hay aviso.

**56.** El aviso, y qué se hace con los datos de un Servicio cerrado hace años, que hoy no se purgan nunca.

**57. Usted** — La ubicación de las personas: cuatro preguntas para el profesional legal. En los 21 archivos de `docs/legal/` no aparece ni una vez «ubicación», «GPS» ni la ley 25.326. El registro del consentimiento está construido; los textos sembrados son de relleno. **Mientras no haya respuesta, el seguimiento no se enciende con nadie real.**

**58.** Sembrar los textos reales y encender el seguimiento y el aviso de demora en el trayecto.

---

## Respaldo, continuidad y secretos

**59. Usted** — El alta del gestor de contraseñas, y completar las cinco filas en blanco de `celtatech/docs/CUENTAS.md`.

**60.** Rotar clave por clave lo que corresponda, decidiéndolo de a una. Si se rota la clave secreta de Supabase, se actualiza en Railway en el mismo acto. Entra acá la clave de servicio de Supabase que estuvo escrita en texto plano en la configuración de permisos de la máquina: los comandos que la llevaban adentro ya se borraron, pero la clave en sí se rota el día de la liberación, no antes. Y entran también las contraseñas de las cuentas de demostración y de prueba creadas en la nube: **cuatro** scripts las tenían escritas adentro, así que quedaron a la vista de cualquiera que abriera el repositorio. Ninguno las lleva ya —las cuatro entran por el entorno—, pero las cuentas que nacieron con ellas siguen teniéndolas: las de la Prestadora de demostración, las de la demostración de continuidad de guardia, las de la prueba de cierre de Servicio y las que quedaron sin borrar de la prueba del escaneo del Asistente.

Entran además **dos que aparecieron después y están señaladas con archivo y renglón**: una clave
compartida escrita adentro de la siembra, que hay que sacar de ahí y hacer entrar por el entorno
—la forma correcta está resuelta del otro lado: las cuentas nacen sin clave, la clave llega por
variable de entorno y el programa se planta si la dirección no es de esta máquina—, y una
contraseña de prueba en texto plano dentro de la configuración de permisos de una copia de trabajo.

**61. Usted** — Cargar en los secretos del repositorio `SUPABASE_SERVICE_ROLE_KEY`, con el mismo valor que ya tiene Railway. Es lo único que le falta al respaldo de archivos para empezar a correr: el volcado entra por la conexión directa a la base, pero los archivos se bajan del almacenamiento y eso pide la llave de servicio. Se carga en GitHub → Settings → Secrets and variables → Actions → New repository secret. **No lo escriba acá.** Hasta que exista, el respaldo diario sube el volcado y falla al llegar a los archivos, que es lo correcto: prefiero que avise a que haga de cuenta que respaldó.

**62. Usted** — Correr `node scripts/probar_restauracion.mjs` desde `backend/`, con Docker encendido y las variables del respaldo diario más las de la base de producción cargadas en el entorno. Baja el último respaldo, lo restaura en una base efímera, compara las tablas, las filas y los archivos del espejo contra lo que hay hoy, y borra todo al terminar. Le toca a usted porque pide las llaves del bucket y de la base, que viven en la caja fuerte. La prueba anterior verificó 30 tablas de un esquema que hoy tiene 105 y no tocó ningún archivo, porque todavía no se respaldaban. **Si contesta `no_probado`, no salió mal: quiere decir que todo coincidió y no había nada cargado que comparar**, y entonces hay que repetirla con datos de prueba.

**63. Usted** — Los dominios se renovaron en julio de 2026 y vencen en julio de 2027, y esa fecha hoy no está en ningún calendario: `celtatech.com` y `careonys.com` en Cloudflare, y `celtatech.com.ar` y `celtatech.net.ar` en NIC Argentina. Poner un recordatorio un mes antes de cada uno y, donde el registrador lo permita, dejar la renovación automática encendida — NIC Argentina no la tiene, así que ésos son los dos que de verdad dependen del recordatorio. Un dominio vencido no se cae despacio: deja de resolver, y con él se van las pantallas, el correo de la empresa y la entrada a las cuentas que se registraron con ese correo.

**64.** Correr `scripts/probar_aislamiento.mjs` y `scripts/probar_altas_con_sesion.mjs` sobre todo
lo que dejó la mudanza, y probar la siembra contra una base reconstruida desde cero. Las tres
piden la base local levantada, o sea Docker encendido.

---

## Marca y dominio por Prestadora

**65. Usted** — El remitente ya está resuelto: cada Prestadora manda desde su propia dirección bajo `careonys.com` (`docs/MARCA.md`, sección 0). Queda la dirección web: ¿cada Prestadora entra por una suya —`cuidardelsur.careonys.com`—, o todas por la misma? ¿Y qué ve una Familia que tiene dos Servicios de modalidades distintas? **Ya no decide cómo se reconoce la Prestadora al entrar**: eso lo resuelve el paso de una cuenta en varias Prestadoras, que pregunta cuando hay más de una.

**66.** Que la pantalla de ingreso muestre la marca de la Prestadora y no la del producto. El
mecanismo llega con el marcador de la Prestadora en el texto visible, más arriba en esta lista.

**67.** Que la conversación quede guardada adentro del producto, según lo que se conteste sobre el botón de contacto de «Asistente Asignado», más arriba en esta misma lista. Hasta que el Panel no tenga un hilo de dos puntas, lo que se hablan la Familia y el Asistente en prestación directa se va a WhatsApp y no queda adentro de ningún lado. El chat interno ya está construido entero —hilos, mensajes, tapado del contacto, pantallas en las dos aplicaciones, aviso al celular y videollamada—, pero **sólo funciona donde la Prestadora pone Asistentes disponibles para que la Familia elija**: exige una Familia y un Asistente que se hayan encontrado ahí. En prestación directa no hay hilo, y hacia la Prestadora tampoco: el único canal con el Panel va en un solo sentido, del Panel al Asistente, y no hay dónde guardar lo que contesta.

**68.** Dominio propio, si va.

---

## Módulos

**69.** Sacar el nombre viejo `aurevia` de adentro del producto. **Se decide y se hace con la
mudanza ya encima**, que es cuando hay que tocar la base de todos modos. Está medido y no se
pierde: nadie usó nunca la aplicación y todos los datos cargados son inventados, así que
reconstruir la base los reescribe sin mudanza. Lo que cuesta igual, se haga cuando se haga, son
cinco nombres de afuera: el nombre del proyecto local, el servicio donde corre el motor con su
dirección, y los dos depósitos de respaldo. El repositorio ya se llama `careonys`.

**70. Usted** — ¿Dónde corre un módulo y contra qué base? Hoy `Modulos\` está vacía. **Facturación y créditos y cobranzas ya están decididas como software aparte del que Careonys se sirve**, así que esto no decide si salen, sino dónde corren el día que existan. También decide si con eso se cierran sin construir los adaptadores de pasarela.

**71.** Sacar la facturación y la cobranza a un módulo, cuando haya dónde correrlo.

---

## Decisiones que no traban nada empezado

**72. Usted** — Subcontratación: no existe ninguna tabla de Empresa subcontratada y el Panel no la ofrece a propósito. La precondición era no abrirla hasta que una Prestadora real lo pida. ¿Sigue valiendo?

**73. Usted** — Un tercero que sólo mira: ¿cómo entra un financiador que sólo consulta? Un cuarto rol, un Coordinador de sólo lectura desde el catálogo de permisos, o no se hace.

**74. Usted** — ¿Careonys va a atender establecimientos donde conviven Pacientes de Familias distintas — una residencia, un geriátrico? Si es más adelante, alcanza con dejarlo dicho.

**75. Usted** — ¿Diez pedidos por minuto y por persona es el número? El contador compartido hace falta el día que el motor se reparta en varios servicios; hoy corre en uno solo.

**76. Usted** — ¿Los idiomas siguen en un archivo o pasan a la base? De esto depende si sumar un idioma es una publicación o una carga de datos. **Para las listas de opciones ya está contestado** por el paso de las listas por Prestadora, donde la traducción viaja adentro de cada opción; esto decide qué pasa con el resto del texto visible.

**77. Usted** — El puntaje interno de calidad del Asistente, que sólo ve el Admin: ¿sigue en pie ahora que existen las estrellas que pone la Familia? Si sigue, faltan dos respuestas: qué lo compone, y la garantía de que ninguna acción automática dependa de él. El lugar donde iría ya está hecho (`datos_reservados_asistente` y su permiso).

**78. Usted** — El alta y la baja de Prestadoras: Match expone una puerta firmada para que CeltaTech dé de alta y de baja clientes; Careonys no tiene nada parecido. ¿Se construye la misma, o se siguen dando de alta a mano?

**79. Usted** — El acompañamiento online: ¿prestación más, o guardia sin domicilio? Si es guardia, hay que decidir qué reemplaza al fichaje por ubicación.

**80. Usted** — El «Gestor del cuidado»: ¿rol nuevo, variante de Coordinador, o entrada en el catálogo de permisos por Prestadora? La tercera no rompe la regla de los tres roles de Panel; las dos primeras sí. Hoy el Coordinador se asigna por guardia, no por Familia.

**81. Usted** — Cursos para familias: ¿va o no va?

**82. Usted** — La regla de los archivos dice «nunca público» y hay un depósito público construido (`marca-prestadoras`); los otros cinco son privados. ¿La regla admite la excepción, o se cierra el depósito?

**83. Usted** — La categoría de convenio del Asistente se teclea a mano, y de ella depende su
remuneración básica. El convenio tiene sus categorías definidas y no las inventa la Prestadora,
así que tecleadas quedan escritas distinto en cada ficha: no se puede saber cuántos Asistentes hay
en cada una, ni aplicarle un cambio de escala a todos los de una categoría de una sola vez, y un
error de tipeo sale impreso en el documento de cese. El campo viene de la aplicación vieja y nunca
se discutió. **Qué hay que analizar:** si pasa a ser una lista que la Prestadora carga —porque las
categorías de otro país son otras y no pueden venir escritas en el código—, y qué se hace con las
liquidaciones que ya salieron. **El mecanismo para que sea una lista ya está**, con el paso de las
listas de opciones por Prestadora; lo que falta decidir es si corresponde y qué pasa con lo ya
liquidado.

---

## El sitio web

**84. Usted** — ¿Se autoriza construir `careonys.com` según `docs/PRD_01_Sitio_Web.md`? El PRD ya está entero. Hoy `sitio-web/` es una página que dice «En construcción». **El diseño se hace de cero**: del sitio público de Match no viaja nada visual.

**85.** Construirlo.

---

## Todo lo del abogado, junto y después del MVP

Las consultas legales se hacen **todas juntas, una vez que el MVP funcione**. No se van a hacer de
a una, porque cada una es una consulta profesional aparte.

Y una cosa que cambia cómo se construye: **ninguna de estas respuestas es una regla fija.** Están
vivas, cambian cuando haga falta y las veces que haga falta. Así que nada de esto entra en el
código: entra como configuración por jurisdicción, con su fecha de vigencia, y un cálculo viejo
tiene que seguir dando el mismo número que dio el día que se hizo. Eso ya es regla de la empresa
—*los cálculos legales y económicos van parametrizados por jurisdicción, y a la escala vigente a la
fecha del hecho*—, y acá se confirma.

Las que ya están identificadas, cada una con su paso propio más adelante en esta lista: el aviso
para el tratamiento de dato biométrico, la accesibilidad, la protección de datos personales, y las
cuatro preguntas sobre la ubicación de las personas. Los pasos que dependen de ellas dicen qué se
construye igual mientras tanto.

**86. Usted** — Las escalas legales: la validación, y los dos valores que el código usa y no
existen (`piso_minimo_indemnizacion` y `fraccion_computable_antiguedad`). En el mismo viaje va el
texto del aviso sobre el abandono de persona: ninguno de los veintiún documentos de `docs/legal/`
lo menciona —lo único parecido es el abandono de *trabajo*, art. 244 LCT, en
`docs/legal/argentina.md:147`, que es otra cosa—, y la regla del producto prohíbe improvisarlo. Sin
documento no hay aviso; la mecánica se construye igual, porque no depende de ninguna ley.

---

## Cómo están escritos los correos

Cada aviso es una función que devuelve el asunto y el texto ya armados, escritos enteros en los
tres idiomas. No hay plantillas con huecos ni ningún editor: la redacción vive en el código, en
`backend/src/i18n/avisos.js`, y cambiarla es cambiar ese archivo y publicar.  Sólo el de activación
de cuenta sale además con formato; los demás son texto pelado.

**87.** Repasar la redacción de los avisos que salen por correo, los tres idiomas de cada uno.
Condición de cierre: que cada uno se entienda leyéndolo una sola vez. Va junto con mover los
mensajes del sistema a una tabla editable desde afuera, que ya está decidido y que ahora se puede
hacer, porque la mudanza deja el mecanismo de catálogos.

---

## Cierre

**88. Usted** — El documento de roles generado desde la base: ¿para quién es, interno de CeltaTech o manual para la Prestadora?

**89.** Generarlo.

**90.** Correr las pruebas y publicar.

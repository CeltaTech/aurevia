# PLAN HASTA PRODUCCIÓN — Careonys

**Una sola lista, del 1 al 78, en orden.** Se hace el 1, después el 2, y así hasta el final.

- Los pasos que empiezan con **Usted** los contesta o los hace el Desarrollador. Los demás los hago yo.
- **Un paso terminado se borra de este archivo.** No se marca como hecho: se saca.
- **No se abren pendientes nuevos.** Un problema que aparece se arregla en el momento; si no cabe en la tarea que se está haciendo, se agrega como paso en el lugar de la lista que le corresponde.
- **Nada de acá se cita por número desde afuera.** El número se corre solo con borrar un paso terminado, así que un documento que diga «paso 103» miente apenas se avanza. Desde otro documento se cita este archivo y el título de la sección.

---

## El correo

*Esto ya está decidido y no se vuelve a discutir.* Railway no deja salir tráfico por los puertos de correo: se probaron los tres (25, 465 y 587) desde el propio servidor y los tres cortaron a los 260 milisegundos, que es la firma de un bloqueo y no de una demora. Por eso el envío sale por un despachante que habla por el puerto 443, Resend, elegido por costo: con `careonys.com` autorizado una sola vez cuelgan todas las direcciones sin pagar por Prestadora (`backend/src/utils/email.js`). **Cada Prestadora manda desde `[prestadora]@careonys.com`, esa dirección sólo manda, y las respuestas se reenvían a la casilla que ella declare** (`docs/MARCA.md`, sección 0), por Cloudflare Email Routing, que no cuesta nada.

**El correo sale y llega.** Está comprobado de punta a punta: `careonys.com` verificado en el despachante, un correo mandado por `enviarEmail()` —el camino real del motor, no una llamada aparte— entregado en la bandeja de entrada, y anotado en `envios_de_correo` sin error. Las ocho variables están cargadas en el servidor y confirmadas: la clave de envío, el remitente, los dos topes, los dos identificadores de Cloudflare, el token del reenvío y la dirección del Panel.

Lo que queda abajo ya no es infraestructura de correo: es qué se manda y cuándo.

**1. Usted** — Autorizar el borrado de lo que quedó vacío en la base. La pantalla que pedía servidor, usuario y contraseña de correo ya no existe, y nada del sistema vuelve a tocar la tabla `configuracion_email_prestadora` ni las dos funciones que guardaban y leían esa contraseña. Quedan ahí ocupando lugar, y una tabla que nadie usa hace creer que alguna pantalla la usa.

*Qué se borra si usted dice que sí.* La tabla y las dos funciones, en una migración nueva, y de paso los datos de ejemplo que todavía las cargan. Adentro de esa tabla hay contraseñas de correo guardadas de cuando el envío salía por el servidor de cada Prestadora; hoy ninguna sirve para nada, porque ese camino está cerrado. **Es una operación que no se deshace**, por eso se pregunta.

*Qué pasa si usted dice que no.* Nada se rompe. Quedan como están y se vuelve a preguntar más adelante.

**2. Usted** — Comprobar que el correo de activación llega y abre la aplicación.

---

## Defectos vivos

**3. Usted** — Las escalas legales: la validación del abogado, y los dos valores que el código usa y no existen (`piso_minimo_indemnizacion` y `fraccion_computable_antiguedad`).

**4. Usted** — **Una guardia cubierta no la ve quien la va a hacer.** Al cubrir una ausencia, el Panel anota al sustituto en `guardias_cobertura` y deja `guardias.asistente_id` con el que faltó (`panel/src/pages/asistentes/AusenciasCoberturaTab.jsx:275`); la aplicación del Asistente lista por esa columna (`backend/src/routes/appAsistentes.js:95`). Resultado: el sustituto no ve la guardia y no la puede fichar, y el ausente la sigue viendo como suya. Las dos salidas no dan lo mismo: reasignar la columna arregla la aplicación pero pisa quién estaba asignado, y sumar las cubiertas a la consulta conserva las dos constancias. ¿Cuál va? ¿Y a quién se le paga esa guardia?

**5.** Arreglarlo según lo contestado, con una prueba de las dos mitades: que el sustituto la vea y la pueda fichar, y que el ausente deje de verla.

**6. Usted** — Los pesos del cálculo de candidatos (`panel/src/lib/candidatos.js:88`) y los umbrales del semáforo de guardias (`panel/src/lib/semaforoGuardia.js:47`) son reglas operativas escritas en el código. Ya están todos juntos y entran por parámetro, así que lo único que falta es decidir qué elige la Prestadora: ¿cada valor por separado, o unos pocos perfiles armados?

**7.** Sacarlos a la configuración de la Prestadora, según lo contestado.

---

## El dinero

**8. Usted** — El ciclo de cobranza a obras sociales: hoy sólo existen validado y anulado. ¿Qué estados hacen falta — presentación, débito, conciliación?

**9.** Construir ese ciclo.

**10. Usted** — ¿Se agrega una tercera vía de pago, con un intermediario que reciba en bloque y redistribuya? Si es sí, antes hay que resolver si eso cambia quién ejerce el control (art. 23 LCT).

---

## Que los avisos lleguen

**11. Usted** — ¿Qué situaciones puede contestar la IA sola? Hoy la única regla es el criterio del modelo.

**12.** Hacerlo configurable por Prestadora, según lo contestado.

**13. Usted** — ¿Se saca el tope de una semana hacia atrás de la ventana de aviso de guardias sin cerrar?

**14.** Sacarlo, si corresponde.

**15. Usted** — Pase de guardia, dos preguntas: cuando la llegada queda sin comprobar, ¿se le avisa igual a la Familia? Y un relevo, ¿cierra una guardia y abre la siguiente en un solo acto, o quedan dos constancias?

**16.** Ajustar el pase de guardia según lo contestado.

---

## La modalidad Marketplace de cara a la Familia

Existe el andamiaje —base, disparadores, cobros, consentimiento—, la Familia ya puede buscar un Asistente, ver su perfil público, escribirle por adentro de la aplicación y, activando el cobro, ver cómo llegar a él por afuera. **Todavía no puede contratarlo.**

**17. Usted** — Prioridad de acceso al plantel ante una baja: el PRD la define en una línea (`docs/PRD_07_Modalidad_Marketplace.md:225`) y de ahí salen dos productos distintos. ¿Es que el contacto del reemplazo no vuelva a costar durante una ventana —ni descuenta saldo ni pide un acceso nuevo—, o es que a esa Familia se le avise primero cuando alguien del plantel vuelve a estar disponible? ¿O las dos? Y antes que eso: hoy la Familia no contrata por marketplace, así que no hay baja que detectar. ¿Qué cuenta como baja — que el Asistente se apague de la vidriera, que la Familia cierre el Servicio, o hay que construir antes el vínculo?

**18.** Construirla según lo contestado.

---

## Los huecos del Panel

**19. Usted** — Dos preguntas de la Solicitud: ¿cómo se le presenta la Asistente nueva a la Familia — aviso sin respuesta, aceptación explícita, o fuera del sistema? ¿Y se construye la vista mapa del plantel por zona, o se saca?

**20.** Vista mapa del plantel por zona, si va. No hay ninguna librería de mapas en el Panel.

**21. Usted** — Las dos observaciones de apariencia que quedan, porque las dos son decisiones de diseño: ¿con qué pantalla abre la aplicación de Familia cuando hay más de un Paciente — hoy abre en la lista, y con uno solo ya se saltea al detalle? ¿Y cuál es la identidad visual de las dos aplicaciones, que nunca pasaron por su etapa de diseño?

**22. Usted** — Rotación y retención de Asistentes: ¿cuál es la fórmula y cuál el umbral?

**23.** Ponerlo en el tablero. Se calcula desde `ceses` y `asistentes`, sin tabla nueva.

---

## Reclutamiento

Hoy hay una ruta de motor que acepta doce campos y **ninguna pantalla que la use**: no existe el formulario de postulación.

**24. Usted** — ¿Dónde vive el formulario público de postulación? No va en `careonys.com`, que le vende software a las Prestadoras: quien busca trabajo de cuidador se postula en la empresa que lo va a contratar. ¿En el sitio de cada Prestadora, con dirección propia?

**25.** La pantalla del formulario, que es lo único que falta: la base y el motor ya guardan y comprueban los campos de las seis secciones de `docs/PRD_03_Reclutamiento.md`, y el motor entrega las listas de opciones en `GET /api/publico/:prestadora/postulacion-asistente/opciones`. Va junto con la pantalla del Panel donde cada Prestadora carga esas opciones —género, nacionalidad, tipo de registro ante AFIP y los cinco subgrupos de experiencia clínica—, porque hoy `opciones_postulacion` nace vacía y sin ella el formulario no tiene nada que ofrecer. Esperaba el paso anterior.

**26. Usted** — ¿Se le bloquea la asignación de guardias a quien no está inscripto en monotributo, o se avisa y decide la Prestadora? La regla del producto dice avisar, no bloquear, así que el PRD y la regla no coinciden.

**27.** Construirlo según lo contestado.

**28. Usted** — Comparar automáticamente la foto del documento con la foto de la cara es tratamiento de dato biométrico, y hacen falta dos decisiones suyas: ¿cuál es el documento legal del que sale el aviso al Asistente, que hoy no existe y sin el cual no hay aviso? ¿Y qué proveedor compara las dos caras? Guardar las dos fotos y mostrarlas juntas ya está hecho: hoy las compara una persona.

**29.** Construirlo según lo contestado.

**30. Usted** — El programa de capacitación: qué contenido lleva, cuántas preguntas y qué nota se necesita para aprobar. Hoy «capacitación» es sólo el nombre de una etapa.

**31.** Construirlo.

---

## Las dos aplicaciones

**32. Usted** — Compartir el Certificado de Aptitud: ¿hacia dónde y por qué medio? Hoy se puede ver, con su estado y su fecha. Compartirlo hacia afuera exige decidir a quién se le manda, por qué canal y qué ve quien lo recibe, porque no existe ninguna verificación pública del certificado: sin eso, lo compartido sería una imagen que no prueba nada.

**33. Usted** — La alerta por salida del domicilio, tres decisiones que no puedo tomar yo. Hoy la cuenta se hace con una velocidad media única y distancia en línea recta (`backend/src/utils/llegadaEstimada.js:39-45`), se dispara recién cuando alguien marcó la salida, y mide llegada tarde, no que el Asistente siga en su casa.

- **El tiempo de viaje real sale de un servicio de mapas ajeno.** Cuál se contrata, con qué cuenta y qué se le manda en cada consulta —las coordenadas de la casa de una persona salen del producto— es decisión suya, y la credencial la pone usted.
- **Que alguien «siga en su domicilio» exige guardar dónde vive el Asistente.** Hoy su ficha no tiene domicilio ni coordenadas (`asistentes`), y lo único que se guarda del lugar de salida es el punto suelto de esa guardia, que no se muestra en ninguna pantalla. Guardar la casa de quien trabaja es dato personal nuevo.
- **Y exige mirar el teléfono antes de que la guardia empiece.** Hoy el GPS se lee cuando la persona aprieta un botón. Leerlo sola, mientras todavía no empezó a trabajar, es seguir a alguien fuera de su horario: hay que decidir si se hace, con qué aviso y con qué permiso.

**34.** Con eso contestado, construirlo — incluida la lista de medios de transporte, que hoy es texto libre escrito en cada salida y por eso no hay contra qué traducirlo a una velocidad.

**35. Usted** — El botón de contacto de «Asistente Asignado»: ¿a quién llama? El PRD lo dejó abierto —«WhatsApp o chat interno» (`docs/PRD_04_05_App_Servicio.md:224`)— y las dos salidas tienen consecuencias. Darle a la Familia el teléfono del Asistente es entregar el dato personal de quien trabaja, y es exactamente lo que el Marketplace cobra por abrir: ahí el contacto va tapado hasta que alguien paga. La otra salida es que el botón lleve a la Prestadora, que es con quien la Familia tiene el trato en prestación directa, usando el contacto que ella misma configura. Hay una tercera: el hilo interno, que hoy existe sólo para el Marketplace y con el tapado puesto.

De las especialidades de esta pantalla no queda nada por hacer: `asistentes.especialidades` está retirada por comentario de la migración y no se escribe más. Lo vigente es el tipo de Asistente, que ya se muestra, con sus Tareas de lo que corresponde y lo que no.

**36. Usted** — El PRD promete exportar el reporte a PDF en la aplicación de la Familia, y más adelante dice que la Familia no accede al informe. ¿Cuál de las dos vale?

---

## Configuración que todavía está escrita en el código

**37. Usted** — Los otros nueve valores fijos que quedan, de a uno: se los muestro con su archivo y su renglón y se contesta cuál va a configuración y cuál se queda.

**38.** Mover los que corresponda.

**39. Usted** — ¿Cooperativa como tercera modalidad de vínculo?

**40.** Construirla: migración que abra tres CHECK, filas de conceptos y fórmulas de cese.

**41. Usted** — Nivel de complejidad: ¿qué significa cada uno de los tres? ¿Condiciona qué tipo de Asistente se admite? Hoy se carga y se edita, y el cálculo de candidatos no lo mira.

**42.** Que el cálculo de candidatos lo use.

**43. Usted** — Verificar matrícula: ¿alcanza con mirar el archivo, o hay que comprobar contra el registro del colegio profesional? La mitad técnica está construida.

**44.** Construir la verificación según lo contestado.

**45. Usted** — Accesibilidad: el código está hecho, falta la respuesta legal. `docs/legal/argentina.md` no la menciona.

**46. Usted** — El Certificado de Aptitud impreso: ¿qué lleva? Hoy la pantalla genera el código de barras y ahí termina.

**47.** Armarlo, y agregar la subida del certificado a un depósito de archivos, creado por migración con sus políticas. Hoy sólo se guardan fechas.

---

## Datos personales

**48. Usted** — Protección de datos personales: el texto lo tiene que dar el Desarrollador. `docs/legal/argentina.md` tiene ocho secciones y ninguna es de esto. Sin documento no hay aviso.

**49.** El aviso, y qué se hace con los datos de un Servicio cerrado hace años, que hoy no se purgan nunca.

**50. Usted** — La ubicación de las personas: cuatro preguntas para el profesional legal. En los 21 archivos de `docs/legal/` no aparece ni una vez «ubicación», «GPS» ni la ley 25.326. El registro del consentimiento está construido; los textos sembrados son de relleno. **Mientras no haya respuesta, el seguimiento no se enciende con nadie real.**

**51.** Sembrar los textos reales y encender el seguimiento y el aviso de demora en el trayecto.

---

## Respaldo, continuidad y secretos

**52. Usted** — El alta del gestor de contraseñas, y completar las cinco filas en blanco de `celtatech/docs/CUENTAS.md`.

**53.** Rotar clave por clave lo que corresponda, decidiéndolo de a una. Si se rota la clave secreta de Supabase, se actualiza en Railway en el mismo acto. Entra acá la clave de servicio de Supabase que estuvo escrita en texto plano en la configuración de permisos de la máquina: los comandos que la llevaban adentro ya se borraron, pero la clave en sí se rota el día de la liberación, no antes.

**54. Usted** — Cargar en los secretos del repositorio `SUPABASE_SERVICE_ROLE_KEY`, con el mismo valor que ya tiene Railway. Es lo único que le falta al respaldo de archivos para empezar a correr: el volcado entra por la conexión directa a la base, pero los archivos se bajan del almacenamiento y eso pide la llave de servicio. Se carga en GitHub → Settings → Secrets and variables → Actions → New repository secret. **No lo escriba acá.** Hasta que exista, el respaldo diario sube el volcado y falla al llegar a los archivos, que es lo correcto: prefiero que avise a que haga de cuenta que respaldó.

**55. Usted** — Correr `node scripts/probar_restauracion.mjs` desde `backend/`, con Docker encendido y las variables del respaldo diario más las de la base de producción cargadas en el entorno. Baja el último respaldo, lo restaura en una base efímera, compara las tablas, las filas y los archivos del espejo contra lo que hay hoy, y borra todo al terminar. Le toca a usted porque pide las llaves del bucket y de la base, que viven en la caja fuerte. La prueba anterior verificó 30 tablas de un esquema que hoy tiene 105 y no tocó ningún archivo, porque todavía no se respaldaban. **Si contesta `no_probado`, no salió mal: quiere decir que todo coincidió y no había nada cargado que comparar**, y entonces hay que repetirla con datos de prueba.

**56. Usted** — Los dominios se renovaron en julio de 2026 y vencen en julio de 2027, y esa fecha hoy no está en ningún calendario: `celtatech.com` y `careonys.com` en Cloudflare, y `celtatech.com.ar` y `celtatech.net.ar` en NIC Argentina. Poner un recordatorio un mes antes de cada uno y, donde el registrador lo permita, dejar la renovación automática encendida — NIC Argentina no la tiene, así que ésos son los dos que de verdad dependen del recordatorio. Un dominio vencido no se cae despacio: deja de resolver, y con él se van las pantallas, el correo de la empresa y la entrada a las cuentas que se registraron con ese correo.

---

## Marca y dominio por Prestadora

**57. Usted** — El remitente ya está resuelto: cada Prestadora manda desde su propia dirección bajo `careonys.com` (`docs/MARCA.md`, sección 0). Queda la dirección web: ¿cada Prestadora entra por una suya —`cuidardelsur.careonys.com`—, o todas por la misma? ¿Y qué ve una Familia que tiene dos Servicios de modalidades distintas?

**58.** Que la pantalla de ingreso muestre la marca de la Prestadora y no la del producto.

**59.** Que la conversación quede guardada adentro del producto.

**60.** Dominio propio, si va.

---

## Módulos

**61. Usted** — ¿Dónde corre un módulo y contra qué base? Hoy `Modulos\` está vacía. De esto depende si la facturación y la cobranza salen a un módulo — la costura ya está sana — y si con eso se cierran sin construir los adaptadores de pasarela.

**62.** Sacar la facturación y la cobranza a un módulo, si corresponde.

---

## Decisiones que no traban nada empezado

**63. Usted** — Subcontratación: no existe ninguna tabla de Empresa subcontratada y el Panel no la ofrece a propósito. La precondición era no abrirla hasta que una Prestadora real lo pida. ¿Sigue valiendo?

**64. Usted** — Un tercero que sólo mira: ¿cómo entra un financiador que sólo consulta? Un cuarto rol, un Coordinador de sólo lectura desde el catálogo de permisos, o no se hace.

**65. Usted** — ¿Careonys va a atender establecimientos donde conviven Pacientes de Familias distintas — una residencia, un geriátrico? Si es más adelante, alcanza con dejarlo dicho.

**66. Usted** — ¿Diez pedidos por minuto y por persona es el número? El contador compartido hace falta el día que el motor se reparta en varios servicios; hoy corre en uno solo.

**67. Usted** — ¿Los idiomas siguen en un archivo o pasan a la base? De esto depende si sumar un idioma es una publicación o una carga de datos.

**68. Usted** — El puntaje interno de calidad del Asistente, que sólo ve el Admin: ¿sigue en pie ahora que existen las estrellas que pone la Familia? Si sigue, faltan dos respuestas: qué lo compone, y la garantía de que ninguna acción automática dependa de él. El lugar donde iría ya está hecho (`datos_reservados_asistente` y su permiso).

**69. Usted** — El alta y la baja de Prestadoras: el Marketplace expone una puerta firmada para que CeltaTech dé de alta y de baja clientes; Careonys no tiene nada parecido. ¿Se construye la misma, o se siguen dando de alta a mano?

**70. Usted** — El acompañamiento online: ¿prestación más, o guardia sin domicilio? Si es guardia, hay que decidir qué reemplaza al fichaje por ubicación.

**71. Usted** — El «Gestor del cuidado»: ¿rol nuevo, variante de Coordinador, o entrada en el catálogo de permisos por Prestadora? La tercera no rompe la regla de los tres roles de Panel; las dos primeras sí. Hoy el Coordinador se asigna por guardia, no por Familia.

**72. Usted** — Cursos para familias: ¿va o no va?

**73. Usted** — La regla de los archivos dice «nunca público» y hay un depósito público construido (`marca-prestadoras`); los otros cinco son privados. ¿La regla admite la excepción, o se cierra el depósito?

---

## El sitio web

**74. Usted** — ¿Se autoriza construir `careonys.com` según `docs/PRD_01_Sitio_Web.md`? El PRD ya está entero. Hoy `sitio-web/` es una página que dice «En construcción».

**75.** Construirlo.

---

## Cierre

**76. Usted** — El documento de roles generado desde la base: ¿para quién es, interno de CeltaTech o manual para la Prestadora?

**77.** Generarlo.

**78.** Correr las pruebas y publicar.

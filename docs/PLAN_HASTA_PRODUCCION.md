# PLAN HASTA PRODUCCIÓN — Careonys

**Una sola lista, del 1 al 76, en orden.** Se hace el 1, después el 2, y así hasta el final.

- Los pasos que empiezan con **Usted** los contesta o los hace el Desarrollador. Los demás los hago yo.
- **Un paso terminado se borra de este archivo.** No se marca como hecho: se saca.
- **No se abren pendientes nuevos.** Un problema que aparece se arregla en el momento; si no cabe en la tarea que se está haciendo, se agrega como paso en el lugar de la lista que le corresponde.
- **Nada de acá se cita por número desde afuera.** El número se corre solo con borrar un paso terminado, así que un documento que diga «paso 103» miente apenas se avanza. Desde otro documento se cita este archivo y el título de la sección.

---

## El dinero

**1.** Que el estado de cuenta de cada Familia pueda venir de afuera. Hoy la puerta por la que
avisa el software de créditos y cobranzas acepta una sola cosa —que a una Familia hay que
restringirle el servicio— y rechaza a propósito todo importe. Tiene que poder informar también
cuánto debe y si está atrasada. La puerta, la firma y el aislamiento por Prestadora ya están
hechos: es ampliar lo que entra, no construir otra.

**2.** Que con un software de afuera conectado, Careonys **deje de calcular** el estado de cuenta y
muestre el que recibe, tal como lo recibe. Hoy lo calcula siempre de lo que él mismo registra, así
que conectar un software de cobranzas dejaría dos números distintos para lo mismo. Sin nada
conectado no cambia nada: sigue mostrando el suyo.

**3.** Que el estado de cuenta lo vea solamente la administración de la Prestadora, y no quien
coordina turnos. Entra como acción nueva del catálogo de permisos, reservada a administración de
fábrica, con el mismo molde que `ver_pagos_asistente`. Alcanza a la pantalla y a la ruta del motor,
no sólo a la pantalla.

**4.** Que cada Familia quede apareada con el cliente que el software de facturación tiene cargado
del otro lado. Es una referencia por Familia y por conexión, no una copia: no entra el número
fiscal ni la condición frente al organismo, que son del otro lado. Es lo único que la conexión
directa necesita y hoy no existe, y hace falta también para el apareo inicial de una Prestadora que
ya tenía sus clientes cargados antes de empezar.

**5.** Escribir la conexión de ida con el software de facturación de la primera Prestadora, cuando
haya una y ella lo elija. **No se escribe antes**: se miraron los cinco que más se usan en
Argentina y se conectan todos parecido pero con datos distintos, así que escribir uno a ciegas es
acertar con suerte. Lo investigado está en `docs/FACTURADORES_Y_COMO_SE_CONECTAN.md`. **Cada
software es una pieza aparte** y agregar la segunda no puede obligar a tocar la primera. Las otras
dos maneras ya están hechas y alcanzan para salir a producción: se anota factura por factura a
mano, o se baja un archivo con todo lo que falta facturar y se sube el que el software devuelve.

**6.** Que la Prestadora pueda cargar en Configuración la conexión con su software de facturación
y con el de créditos y cobranzas —cuál es, con qué credencial se entra— sin que ninguna alcance
los datos de otra Prestadora. La credencial se guarda como secreto y no se vuelve a mostrar, igual
que el secreto de la firma.

**7. Usted** — ¿Se agrega una tercera vía de pago, con un intermediario que reciba en bloque y redistribuya? Si es sí, antes hay que resolver si eso cambia quién ejerce el control (art. 23 LCT).

---

## Que los avisos lleguen

**8. Usted** — ¿Qué situaciones puede contestar la IA sola? Hoy la única regla es el criterio del modelo.

**9.** Hacerlo configurable por Prestadora, según lo contestado.

**10. Usted** — ¿Se saca el tope de una semana hacia atrás de la ventana de aviso de guardias sin cerrar?

**11.** Sacarlo, si corresponde.

**12. Usted** — Pase de guardia, dos preguntas: cuando la llegada queda sin comprobar, ¿se le avisa igual a la Familia? Y un relevo, ¿cierra una guardia y abre la siguiente en un solo acto, o quedan dos constancias?

**13.** Ajustar el pase de guardia según lo contestado.

---

## La modalidad Marketplace de cara a la Familia

Existe el andamiaje —base, disparadores, cobros, consentimiento—, la Familia ya puede buscar un Asistente, ver su perfil público, escribirle por adentro de la aplicación y, activando el cobro, ver cómo llegar a él por afuera. **Todavía no puede contratarlo.**

**14. Usted** — Prioridad de acceso al plantel ante una baja: el PRD la define en una línea (`docs/PRD_07_Modalidad_Marketplace.md:225`) y de ahí salen dos productos distintos. ¿Es que el contacto del reemplazo no vuelva a costar durante una ventana —ni descuenta saldo ni pide un acceso nuevo—, o es que a esa Familia se le avise primero cuando alguien del plantel vuelve a estar disponible? ¿O las dos? Y antes que eso: hoy la Familia no contrata por marketplace, así que no hay baja que detectar. ¿Qué cuenta como baja — que el Asistente se saque de los disponibles, que la Familia cierre el Servicio, o hay que construir antes el vínculo?

**15.** Construirla según lo contestado.

---

## Los huecos del Panel

**16. Usted** — Dos preguntas de la Solicitud: ¿cómo se le presenta la Asistente nueva a la Familia — aviso sin respuesta, aceptación explícita, o fuera del sistema? ¿Y se construye la vista mapa del plantel por zona, o se saca?

**17.** Vista mapa del plantel por zona, si va. No hay ninguna librería de mapas en el Panel.

**18. Usted** — Las dos observaciones de apariencia que quedan, porque las dos son decisiones de diseño: ¿con qué pantalla abre la aplicación de Familia cuando hay más de un Paciente — hoy abre en la lista, y con uno solo ya se saltea al detalle? ¿Y cuál es la identidad visual de las dos aplicaciones, que nunca pasaron por su etapa de diseño?

El Desarrollador está preparando una maqueta orientativa de cómo tienen que verse y cómo se recorren. **Hasta que llegue no se toca nada de apariencia ni de recorrido en las dos aplicaciones**, porque cualquier arreglo suelto de hoy es trabajo que la maqueta va a pisar. Lo que sí se corrige mientras tanto es lo que deja a alguien sin poder hacer su trabajo.

**19. Usted** — Rotación y retención de Asistentes: ¿cuál es la fórmula y cuál el umbral?

**20.** Ponerlo en el tablero. Se calcula desde `ceses` y `asistentes`, sin tabla nueva.

---

## Reclutamiento

**Esta sección entera queda en espera de la fusión con el Marketplace.** El reclutamiento va a ser un módulo común a las dos modalidades, y la base de Asistentes de cada Prestadora va a ser una sola para las dos. Construir ahora el recorrido de acá es construir la mitad que después hay que rehacer. Lo que falta queda listado, y no se toca hasta que la fusión esté resuelta.

Los tres arreglos, para que estén escritos:

1. **No existe el formulario público de postulación.** Hay una ruta de motor que acepta doce campos y ninguna pantalla que la use.
2. **Las listas de opciones nacen vacías.** Género, nacionalidad, tipo de registro ante AFIP y los cinco subgrupos de experiencia clínica se cargan por Prestadora, y no hay pantalla donde cargarlos: sin eso el formulario no tiene nada que ofrecer.
3. **Al incorporar un aspirante se pierden quince datos.** Lo que cargó en la postulación no llega entero a su ficha de Asistente.

Y queda trabado además por la pregunta **«¿dónde corre un módulo y contra qué base?»**, más abajo en esta misma lista.

**21. Usted** — ¿Dónde vive el formulario público de postulación? No va en `careonys.com`, que le vende software a las Prestadoras: quien busca trabajo de cuidador se postula en la empresa que lo va a contratar. ¿En el sitio de cada Prestadora, con dirección propia?

**22.** La pantalla del formulario, que es lo único que falta: la base y el motor ya guardan y comprueban los campos de las seis secciones de `docs/PRD_03_Reclutamiento.md`, y el motor entrega las listas de opciones en `GET /api/publico/:prestadora/postulacion-asistente/opciones`. Va junto con la pantalla del Panel donde cada Prestadora carga esas opciones —género, nacionalidad, tipo de registro ante AFIP y los cinco subgrupos de experiencia clínica—, porque hoy `opciones_postulacion` nace vacía y sin ella el formulario no tiene nada que ofrecer. Esperaba el paso anterior.

**23. Usted** — ¿Se le bloquea la asignación de guardias a quien no está inscripto en monotributo, o se avisa y decide la Prestadora? La regla del producto dice avisar, no bloquear, así que el PRD y la regla no coinciden.

**24.** Construirlo según lo contestado.

**25. Usted** — Comparar automáticamente la foto del documento con la foto de la cara es tratamiento de dato biométrico, y hacen falta dos decisiones suyas: ¿cuál es el documento legal del que sale el aviso al Asistente, que hoy no existe y sin el cual no hay aviso? ¿Y qué proveedor compara las dos caras? Guardar las dos fotos y mostrarlas juntas ya está hecho: hoy las compara una persona.

**26.** Construirlo según lo contestado.

**27. Usted** — El programa de capacitación: qué contenido lleva, cuántas preguntas y qué nota se necesita para aprobar. Hoy «capacitación» es sólo el nombre de una etapa.

**28.** Construirlo.

---

## Las dos aplicaciones

**29. Usted** — Compartir el Certificado de Aptitud: ¿hacia dónde y por qué medio? Hoy se puede ver, con su estado y su fecha. Compartirlo hacia afuera exige decidir a quién se le manda, por qué canal y qué ve quien lo recibe, porque no existe ninguna verificación pública del certificado: sin eso, lo compartido sería una imagen que no prueba nada.

**30. Usted** — La alerta por salida del domicilio, tres decisiones que no puedo tomar yo. Hoy la cuenta se hace con una velocidad media única y distancia en línea recta (`backend/src/utils/llegadaEstimada.js:39-45`), se dispara recién cuando alguien marcó la salida, y mide llegada tarde, no que el Asistente siga en su casa.

- **El tiempo de viaje real sale de un servicio de mapas ajeno.** Cuál se contrata, con qué cuenta y qué se le manda en cada consulta —las coordenadas de la casa de una persona salen del producto— es decisión suya, y la credencial la pone usted.
- **Que alguien «siga en su domicilio» exige guardar dónde vive el Asistente.** Hoy su ficha no tiene domicilio ni coordenadas (`asistentes`), y lo único que se guarda del lugar de salida es el punto suelto de esa guardia, que no se muestra en ninguna pantalla. Guardar la casa de quien trabaja es dato personal nuevo.
- **Y exige mirar el teléfono antes de que la guardia empiece.** Hoy el GPS se lee cuando la persona aprieta un botón. Leerlo sola, mientras todavía no empezó a trabajar, es seguir a alguien fuera de su horario: hay que decidir si se hace, con qué aviso y con qué permiso.

**31.** Con eso contestado, construirlo — incluida la lista de medios de transporte, que hoy es texto libre escrito en cada salida y por eso no hay contra qué traducirlo a una velocidad.

**32. Usted** — El botón de contacto de «Asistente Asignado»: ¿a quién llama? El PRD lo dejó abierto —«WhatsApp o chat interno» (`docs/PRD_04_05_App_Servicio.md:224`)— y las dos salidas tienen consecuencias. Darle a la Familia el teléfono del Asistente es entregar el dato personal de quien trabaja, y es exactamente lo que el Marketplace cobra por abrir: ahí el contacto va tapado hasta que alguien paga. La otra salida es que el botón lleve a la Prestadora, que es con quien la Familia tiene el trato en prestación directa, usando el contacto que ella misma configura. Hay una tercera: el hilo interno, que hoy existe sólo para el Marketplace y con el tapado puesto.

De las especialidades de esta pantalla no queda nada por hacer: `asistentes.especialidades` está retirada por comentario de la migración y no se escribe más. Lo vigente es el tipo de Asistente, que ya se muestra, con sus Tareas de lo que corresponde y lo que no.

**33. Usted** — El PRD promete exportar el reporte a PDF en la aplicación de la Familia, y más adelante dice que la Familia no accede al informe. ¿Cuál de las dos vale?

---

## Configuración que todavía está escrita en el código

**34. Usted** — Los otros nueve valores fijos que quedan, de a uno: se los muestro con su archivo y su renglón y se contesta cuál va a configuración y cuál se queda.

**35.** Mover los que corresponda.

**36. Usted** — ¿Cooperativa como tercera modalidad de vínculo?

**37.** Construirla: migración que abra tres CHECK, filas de conceptos y fórmulas de cese.

**38. Usted** — Nivel de complejidad: ¿qué significa cada uno de los tres? ¿Condiciona qué tipo de Asistente se admite? Hoy se carga y se edita, y el cálculo de candidatos no lo mira.

**39.** Que el cálculo de candidatos lo use.

**40. Usted** — Verificar matrícula: ¿alcanza con mirar el archivo, o hay que comprobar contra el registro del colegio profesional? La mitad técnica está construida.

**41.** Construir la verificación según lo contestado.

**42. Usted** — Accesibilidad: el código está hecho, falta la respuesta legal. `docs/legal/argentina.md` no la menciona.

**43. Usted** — El Certificado de Aptitud impreso: ¿qué lleva? Hoy la pantalla genera el código de barras y ahí termina.

**44.** Armarlo, y agregar la subida del certificado a un depósito de archivos, creado por migración con sus políticas. Hoy sólo se guardan fechas.

---

## Datos personales

**45. Usted** — Protección de datos personales: el texto lo tiene que dar el Desarrollador. `docs/legal/argentina.md` tiene ocho secciones y ninguna es de esto. Sin documento no hay aviso.

**46.** El aviso, y qué se hace con los datos de un Servicio cerrado hace años, que hoy no se purgan nunca.

**47. Usted** — La ubicación de las personas: cuatro preguntas para el profesional legal. En los 21 archivos de `docs/legal/` no aparece ni una vez «ubicación», «GPS» ni la ley 25.326. El registro del consentimiento está construido; los textos sembrados son de relleno. **Mientras no haya respuesta, el seguimiento no se enciende con nadie real.**

**48.** Sembrar los textos reales y encender el seguimiento y el aviso de demora en el trayecto.

---

## Respaldo, continuidad y secretos

**49. Usted** — El alta del gestor de contraseñas, y completar las cinco filas en blanco de `celtatech/docs/CUENTAS.md`.

**50.** Rotar clave por clave lo que corresponda, decidiéndolo de a una. Si se rota la clave secreta de Supabase, se actualiza en Railway en el mismo acto. Entra acá la clave de servicio de Supabase que estuvo escrita en texto plano en la configuración de permisos de la máquina: los comandos que la llevaban adentro ya se borraron, pero la clave en sí se rota el día de la liberación, no antes. Y entran también las contraseñas de las cuentas de demostración y de prueba creadas en la nube: **cuatro** scripts las tenían escritas adentro, así que quedaron a la vista de cualquiera que abriera el repositorio. Ninguno las lleva ya —las cuatro entran por el entorno—, pero las cuentas que nacieron con ellas siguen teniéndolas: las de la Prestadora de demostración, las de la demostración de continuidad de guardia, las de la prueba de cierre de Servicio y las que quedaron sin borrar de la prueba del escaneo del Asistente.

**51. Usted** — Cargar en los secretos del repositorio `SUPABASE_SERVICE_ROLE_KEY`, con el mismo valor que ya tiene Railway. Es lo único que le falta al respaldo de archivos para empezar a correr: el volcado entra por la conexión directa a la base, pero los archivos se bajan del almacenamiento y eso pide la llave de servicio. Se carga en GitHub → Settings → Secrets and variables → Actions → New repository secret. **No lo escriba acá.** Hasta que exista, el respaldo diario sube el volcado y falla al llegar a los archivos, que es lo correcto: prefiero que avise a que haga de cuenta que respaldó.

**52. Usted** — Correr `node scripts/probar_restauracion.mjs` desde `backend/`, con Docker encendido y las variables del respaldo diario más las de la base de producción cargadas en el entorno. Baja el último respaldo, lo restaura en una base efímera, compara las tablas, las filas y los archivos del espejo contra lo que hay hoy, y borra todo al terminar. Le toca a usted porque pide las llaves del bucket y de la base, que viven en la caja fuerte. La prueba anterior verificó 30 tablas de un esquema que hoy tiene 105 y no tocó ningún archivo, porque todavía no se respaldaban. **Si contesta `no_probado`, no salió mal: quiere decir que todo coincidió y no había nada cargado que comparar**, y entonces hay que repetirla con datos de prueba.

**53. Usted** — Los dominios se renovaron en julio de 2026 y vencen en julio de 2027, y esa fecha hoy no está en ningún calendario: `celtatech.com` y `careonys.com` en Cloudflare, y `celtatech.com.ar` y `celtatech.net.ar` en NIC Argentina. Poner un recordatorio un mes antes de cada uno y, donde el registrador lo permita, dejar la renovación automática encendida — NIC Argentina no la tiene, así que ésos son los dos que de verdad dependen del recordatorio. Un dominio vencido no se cae despacio: deja de resolver, y con él se van las pantallas, el correo de la empresa y la entrada a las cuentas que se registraron con ese correo.

---

## Marca y dominio por Prestadora

**54. Usted** — El remitente ya está resuelto: cada Prestadora manda desde su propia dirección bajo `careonys.com` (`docs/MARCA.md`, sección 0). Queda la dirección web: ¿cada Prestadora entra por una suya —`cuidardelsur.careonys.com`—, o todas por la misma? ¿Y qué ve una Familia que tiene dos Servicios de modalidades distintas?

**55.** Que la pantalla de ingreso muestre la marca de la Prestadora y no la del producto.

**56.** Que la conversación quede guardada adentro del producto, según lo que se conteste sobre el botón de contacto de «Asistente Asignado», más arriba en esta misma lista. Hasta que el Panel no tenga un hilo de dos puntas, lo que se hablan la Familia y el Asistente en prestación directa se va a WhatsApp y no queda adentro de ningún lado. El chat interno ya está construido entero —hilos, mensajes, tapado del contacto, pantallas en las dos aplicaciones, aviso al celular y videollamada—, pero **sólo funciona donde la Prestadora pone Asistentes disponibles para que la Familia elija**: exige una Familia y un Asistente que se hayan encontrado ahí. En prestación directa no hay hilo, y hacia la Prestadora tampoco: el único canal con el Panel va en un solo sentido, del Panel al Asistente, y no hay dónde guardar lo que contesta.

**57.** Dominio propio, si va.

---

## Módulos

**Sacar el nombre viejo `aurevia` de adentro del producto se decide en el momento de la fusión con el Marketplace**, según lo que convenga en ese análisis. Está medido y no se pierde: nadie usó nunca la aplicación y todos los datos cargados son inventados, así que reconstruir la base los reescribe sin mudanza. Lo que cuesta igual, se haga cuando se haga, son seis nombres de afuera: el repositorio, el nombre del proyecto local, el servicio donde corre el motor con su dirección, y los dos depósitos de respaldo.

**58. Usted** — ¿Dónde corre un módulo y contra qué base? Hoy `Modulos\` está vacía. **Facturación y créditos y cobranzas ya están decididas como software aparte del que Careonys se sirve**, así que esto no decide si salen, sino dónde corren cuando CeltaTech las desarrolle. También decide si con eso se cierran sin construir los adaptadores de pasarela.

**59.** Sacar la facturación y la cobranza a un módulo, cuando haya dónde correrlo.

---

## Decisiones que no traban nada empezado

**60. Usted** — Subcontratación: no existe ninguna tabla de Empresa subcontratada y el Panel no la ofrece a propósito. La precondición era no abrirla hasta que una Prestadora real lo pida. ¿Sigue valiendo?

**61. Usted** — Un tercero que sólo mira: ¿cómo entra un financiador que sólo consulta? Un cuarto rol, un Coordinador de sólo lectura desde el catálogo de permisos, o no se hace.

**62. Usted** — ¿Careonys va a atender establecimientos donde conviven Pacientes de Familias distintas — una residencia, un geriátrico? Si es más adelante, alcanza con dejarlo dicho.

**63. Usted** — ¿Diez pedidos por minuto y por persona es el número? El contador compartido hace falta el día que el motor se reparta en varios servicios; hoy corre en uno solo.

**64. Usted** — ¿Los idiomas siguen en un archivo o pasan a la base? De esto depende si sumar un idioma es una publicación o una carga de datos.

**65. Usted** — El puntaje interno de calidad del Asistente, que sólo ve el Admin: ¿sigue en pie ahora que existen las estrellas que pone la Familia? Si sigue, faltan dos respuestas: qué lo compone, y la garantía de que ninguna acción automática dependa de él. El lugar donde iría ya está hecho (`datos_reservados_asistente` y su permiso).

**66. Usted** — El alta y la baja de Prestadoras: el Marketplace expone una puerta firmada para que CeltaTech dé de alta y de baja clientes; Careonys no tiene nada parecido. ¿Se construye la misma, o se siguen dando de alta a mano?

**67. Usted** — El acompañamiento online: ¿prestación más, o guardia sin domicilio? Si es guardia, hay que decidir qué reemplaza al fichaje por ubicación.

**68. Usted** — El «Gestor del cuidado»: ¿rol nuevo, variante de Coordinador, o entrada en el catálogo de permisos por Prestadora? La tercera no rompe la regla de los tres roles de Panel; las dos primeras sí. Hoy el Coordinador se asigna por guardia, no por Familia.

**69. Usted** — Cursos para familias: ¿va o no va?

**70. Usted** — La regla de los archivos dice «nunca público» y hay un depósito público construido (`marca-prestadoras`); los otros cinco son privados. ¿La regla admite la excepción, o se cierra el depósito?

---

## El sitio web

**71. Usted** — ¿Se autoriza construir `careonys.com` según `docs/PRD_01_Sitio_Web.md`? El PRD ya está entero. Hoy `sitio-web/` es una página que dice «En construcción».

**72.** Construirlo.

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

**73. Usted** — Las escalas legales: la validación, y los dos valores que el código usa y no
existen (`piso_minimo_indemnizacion` y `fraccion_computable_antiguedad`). En el mismo viaje va el
texto del aviso sobre el abandono de persona: ninguno de los veintiún documentos de `docs/legal/`
lo menciona —lo único parecido es el abandono de *trabajo*, art. 244 LCT, en
`docs/legal/argentina.md:147`, que es otra cosa—, y la regla del producto prohíbe improvisarlo. Sin
documento no hay aviso; la mecánica se construye igual, porque no depende de ninguna ley.

---

## Cierre

**74. Usted** — El documento de roles generado desde la base: ¿para quién es, interno de CeltaTech o manual para la Prestadora?

**75.** Generarlo.

**76.** Correr las pruebas y publicar.

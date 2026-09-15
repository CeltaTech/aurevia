# PLAN HASTA PRODUCCIÓN — Careonys

**Una sola lista, del 1 al 92, en orden.** Se hace el 1, después el 2, y así hasta el final.

- Los pasos que empiezan con **Usted** los contesta o los hace el Desarrollador. Los demás los hago yo.
- **Un paso terminado se borra de este archivo.** No se marca como hecho: se saca.
- **No se abren pendientes nuevos.** Un problema que aparece se arregla en el momento; si no cabe en la tarea que se está haciendo, se agrega como paso en el lugar de la lista que le corresponde.
- **Nada de acá se cita por número desde afuera.** El número se corre solo con borrar un paso terminado, así que un documento que diga «paso 103» miente apenas se avanza. Desde otro documento se cita este archivo y el título de la sección.

---

## El correo (hoy no llega ninguno)

*Esto ya está decidido y no se vuelve a discutir.* Railway no deja salir tráfico por los puertos de correo: se probaron los tres (25, 465 y 587) desde el propio servidor y los tres cortaron a los 260 milisegundos, que es la firma de un bloqueo y no de una demora. Hoy el motor manda por SMTP de Gmail puerto 465 (`backend/src/utils/email.js:5,25`), así que **no se entrega ningún correo** — ni ausencias, ni vencimientos, ni invitaciones de cuenta, ni recuperación de doble factor. Ya se probó Resend y la cuenta rechazó todo destinatario por no tener un dominio propio verificado; SendGrid quedó descartado porque su plan gratuito es una prueba de sesenta días. **El camino elegido es la API de Gmail con OAuth2**, que sale por el puerto 443 y no depende de ningún dominio. Falta únicamente hacerlo.

**1. Usted** — En Google Cloud Console, con la misma cuenta desde la que hoy manda el sistema: crear un proyecto; habilitar la API de Gmail; completar la pantalla de consentimiento; generar credenciales de tipo OAuth para aplicación de escritorio; y autorizar una vez para obtener el permiso permanente. Quedan tres valores. **No los pegue acá:** cárguelos en Railway y en `backend/.env` con los nombres `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` y `GMAIL_REFRESH_TOKEN`.

**2.** Cambiar el envío a la API de Gmail en `backend/src/utils/email.js`, que es el único archivo que manda correo. La dirección del remitente sigue siendo la del producto y lo que cambia por Prestadora es el **nombre visible**, tal como quedó decidido en `docs/MARCA.md:36-40`. La casilla propia por Prestadora que hoy admite el código (`configuracion_email_prestadora`) también sale por SMTP, así que hoy está igual de bloqueada: queda apagada hasta que exista el módulo de avisos de CeltaTech.

**3. Usted** — Comprobar que el correo de activación llega y abre la aplicación.

---

## Defectos vivos

**4. Usted** — Las escalas legales: la validación del abogado, y los dos valores que el código usa y no existen (`piso_minimo_indemnizacion` y `fraccion_computable_antiguedad`).

---

## El dinero

**5. Usted** — El ciclo de cobranza a obras sociales: hoy sólo existen validado y anulado. ¿Qué estados hacen falta — presentación, débito, conciliación?

**6.** Construir ese ciclo.

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

**14. Usted** — Prioridad de acceso al plantel ante una baja: el PRD la define en una línea (`docs/PRD_07_Modalidad_Marketplace.md:225`) y de ahí salen dos productos distintos. ¿Es que el contacto del reemplazo no vuelva a costar durante una ventana —ni descuenta saldo ni pide un acceso nuevo—, o es que a esa Familia se le avise primero cuando alguien del plantel vuelve a estar disponible? ¿O las dos? Y antes que eso: hoy la Familia no contrata por marketplace, así que no hay baja que detectar. ¿Qué cuenta como baja — que el Asistente se apague de la vidriera, que la Familia cierre el Servicio, o hay que construir antes el vínculo?

**15.** Construirla según lo contestado.

---

## Los huecos del Panel

**16. Usted** — Dos preguntas de la Solicitud: ¿cómo se le presenta la Asistente nueva a la Familia — aviso sin respuesta, aceptación explícita, o fuera del sistema? ¿Y se construye la vista mapa del plantel por zona, o se saca?

**17.** Vista mapa del plantel por zona, si va. No hay ninguna librería de mapas en el Panel.

**18. Usted** — Las dos observaciones de apariencia que quedan, porque las dos son decisiones de diseño: ¿con qué pantalla abre la aplicación de Familia cuando hay más de un Paciente — hoy abre en la lista, y con uno solo ya se saltea al detalle? ¿Y cuál es la identidad visual de las dos aplicaciones, que nunca pasaron por su etapa de diseño?

**19. Usted** — Rotación y retención de Asistentes: ¿cuál es la fórmula y cuál el umbral?

**20.** Ponerlo en el tablero. Se calcula desde `ceses` y `asistentes`, sin tabla nueva.

---

## Ausencias, coberturas y cese

**21.** El Simulador incluye el costo de la cobertura en sus proyecciones.

**22.** Que el indicador de riesgo de dependencia se recalcule solo cuando cambian los datos del Asistente. Hoy los siete indicadores se tildan a mano.

---

## Reclutamiento

Hoy hay una ruta de motor que acepta doce campos y **ninguna pantalla que la use**: no existe el formulario de postulación.

**23. Usted** — ¿Dónde vive el formulario público de postulación? No va en `careonys.com`, que le vende software a las Prestadoras: quien busca trabajo de cuidador se postula en la empresa que lo va a contratar. ¿En el sitio de cada Prestadora, con dirección propia?

**24.** Construir el formulario con todos los campos que faltan: fecha de nacimiento y control de mayoría de edad, domicilio con mapa, localidad, nacionalidad, CUIL, género, foto de perfil, situación ante AFIP, obra social, estudios y cursos, experiencia laboral, referencias, experiencia clínica, distancia máxima desde el domicilio y disponibilidad para urgencias, con retiro y sin retiro.

**25. Usted** — ¿Se le bloquea la asignación de guardias a quien no está inscripto en monotributo, o se avisa y decide la Prestadora? La regla del producto dice avisar, no bloquear, así que el PRD y la regla no coinciden.

**26.** Construirlo según lo contestado.

**27.** Verificación de identidad comparando la foto del documento con la foto de perfil. Hoy cada etapa se marca a mano.

**28.** Etapa de referencias laborales, con un mínimo verificado. El catálogo tiene cinco etapas y ninguna es ésta.

**29.** Porcentaje de avance del aspirante, en vez de una lista de etapas sin contador.

**30. Usted** — El programa de capacitación: qué contenido lleva, cuántas preguntas y qué nota se necesita para aprobar. Hoy «capacitación» es sólo el nombre de una etapa.

**31.** Construirlo.

**32.** Totales en la pantalla de Postulantes: cuántos hay, cuántos pendientes, en verificación, aprobados, rechazados.

**33.** Las columnas y los filtros que faltan: honorario pretendido y canal de llegada; y filtrar por franja horaria, urgencias, distancia máxima, condición fiscal, rango de honorario y tipo de servicio.

**34.** Videollamada de entrevista adentro de la aplicación, para que la Prestadora entreviste a un postulante sin pasarse teléfono ni correo. Hoy «entrevista» es una casilla que alguien marca a mano.

---

## Las dos aplicaciones

**35.** Botón de reporte de emergencia en la Guardia Activa, con aviso inmediato al Coordinador. La palabra no aparece en ninguna línea de la aplicación del Asistente.

**36.** Dictado por micrófono para el reporte diario. Hoy hay una caja de texto y nada más.

**37.** Mi Perfil del Asistente completo: foto, especialidades, situación de monotributo, seguro con su vencimiento, Certificado de Aptitud para ver y compartir, e historial de evaluaciones recibidas. Hoy no muestra ninguno de los seis.

**38.** La alerta por salida del domicilio: medio de transporte habitual y tiempo de viaje real. Hoy se usa una única velocidad media y distancia en línea recta, y la cuenta mide llegada tarde, no que el Asistente siga en su casa.

**39.** Especialidades y botón de contacto en «Asistente Asignado». Hoy muestra foto, nombre y tipo.

**40.** Botón para contactar al Coordinador en la pantalla de Alertas de la Familia.

**41. Usted** — El PRD promete exportar el reporte a PDF en la aplicación de la Familia, y más adelante dice que la Familia no accede al informe. ¿Cuál de las dos vale?

---

## Configuración que todavía está escrita en el código

**42.** Los umbrales del semáforo de guardia salen de la configuración de la Prestadora, que ya los tiene guardados (`panel/src/lib/semaforoGuardia.js:45-52`).

**43.** Que `cuentasPanel.js` y `panelImportacion.js` lean `etapas_incorporacion_asistente`, como ya hace `panelCuentas.js`.

**44. Usted** — Los otros nueve valores fijos que quedan, de a uno: se los muestro con su archivo y su renglón y se contesta cuál va a configuración y cuál se queda.

**45.** Mover los que corresponda.

**46.** Especialidades a un catálogo por Prestadora, igual que ya están las zonas. Hoy viven en el archivo de traducciones.

**47.** Leer un aviso de ausencia en texto libre y sugerir la categoría. El catálogo por Prestadora ya está construido; falta la mitad de IA.

**48. Usted** — ¿Cooperativa como tercera modalidad de vínculo?

**49.** Construirla: migración que abra tres CHECK, filas de conceptos y fórmulas de cese.

**50. Usted** — Nivel de complejidad: ¿qué significa cada uno de los tres? ¿Condiciona qué tipo de Asistente se admite? Hoy se carga y se edita, y el cálculo de candidatos no lo mira.

**51.** Que el cálculo de candidatos lo use.

**52. Usted** — Verificar matrícula: ¿alcanza con mirar el archivo, o hay que comprobar contra el registro del colegio profesional? La mitad técnica está construida.

**53.** Construir la verificación según lo contestado.

**54. Usted** — Accesibilidad: el código está hecho, falta la respuesta legal. `docs/legal/argentina.md` no la menciona.

**55. Usted** — El Certificado de Aptitud impreso: ¿qué lleva? Hoy la pantalla genera el código de barras y ahí termina.

**56.** Armarlo, y agregar la subida del certificado a un depósito de archivos, creado por migración con sus políticas. Hoy sólo se guardan fechas.

---

## Datos personales

**57. Usted** — Protección de datos personales: el texto lo tiene que dar el Desarrollador. `docs/legal/argentina.md` tiene ocho secciones y ninguna es de esto. Sin documento no hay aviso.

**58.** El aviso, y qué se hace con los datos de un Servicio cerrado hace años, que hoy no se purgan nunca.

**59. Usted** — La ubicación de las personas: cuatro preguntas para el profesional legal. En los 21 archivos de `docs/legal/` no aparece ni una vez «ubicación», «GPS» ni la ley 25.326. El registro del consentimiento está construido; los textos sembrados son de relleno. **Mientras no haya respuesta, el seguimiento no se enciende con nadie real.**

**60.** Sembrar los textos reales y encender el seguimiento y el aviso de demora en el trayecto.

---

## Respaldo, continuidad y secretos

**61.** Mapa de secretos en `docs/`: qué secreto existe, para qué sirve, dónde vive y cuándo se rotó, **sin un solo valor adentro**.

**62. Usted** — El alta del gestor de contraseñas, y completar las cinco filas en blanco de `celtatech/docs/CUENTAS.md`.

**63.** Rotar clave por clave lo que corresponda, decidiéndolo de a una. Si se rota la clave secreta de Supabase, se actualiza en Railway en el mismo acto. Entra acá la clave de servicio de Supabase que estuvo escrita en texto plano en la configuración de permisos de la máquina: los comandos que la llevaban adentro ya se borraron, pero la clave en sí se rota el día de la liberación, no antes.

**64.** Copiar a R2 y a B2 los seis depósitos de archivos. Hoy el respaldo sube sólo el volcado de la base: **la base se restaura y las fotos y las prescripciones no.**

**65.** Repetir la prueba de restauración. La que existe verificó 30 tablas y hoy el esquema tiene 105.

**66.** Actualizar el runbook de correo: describe una sola casilla compartida y el producto ya manda con remitente por Prestadora.

**67.** Dirección técnica de la empresa que reemplace a `soporte@careonys.com`, y pasar los vencimientos de julio de 2027 a un calendario.

---

## Marca y dominio por Prestadora

**68. Usted** — ¿Cada Prestadora tiene dominio o subdominio propio? ¿Alcanza con nombre y logo, o también remitente y dominio? ¿Y qué ve una Familia que tiene dos Servicios de modalidades distintas?

**69.** Que la pantalla de ingreso muestre la marca de la Prestadora y no la del producto.

**70.** Que la conversación quede guardada adentro del producto.

**71.** Dominio propio, si va.

---

## Módulos

**72. Usted** — ¿Dónde corre un módulo y contra qué base? Hoy `Modulos\` está vacía. De esto depende si la facturación y la cobranza salen a un módulo — la costura ya está sana — y si con eso se cierran sin construir los adaptadores de pasarela.

**73.** Sacar la facturación y la cobranza a un módulo, si corresponde.

---

## Decisiones que no traban nada empezado

**74. Usted** — Subcontratación: no existe ninguna tabla de Empresa subcontratada y el Panel no la ofrece a propósito. La precondición era no abrirla hasta que una Prestadora real lo pida. ¿Sigue valiendo?

**75. Usted** — Un tercero que sólo mira: ¿cómo entra un financiador que sólo consulta? Un cuarto rol, un Coordinador de sólo lectura desde el catálogo de permisos, o no se hace.

**76. Usted** — ¿Careonys va a atender establecimientos donde conviven Pacientes de Familias distintas — una residencia, un geriátrico? Si es más adelante, alcanza con dejarlo dicho.

**77. Usted** — ¿Diez pedidos por minuto y por persona es el número? El contador compartido hace falta el día que el motor se reparta en varios servicios; hoy corre en uno solo.

**78. Usted** — ¿Los idiomas siguen en un archivo o pasan a la base? De esto depende si sumar un idioma es una publicación o una carga de datos.

**79. Usted** — El puntaje interno de calidad del Asistente, que sólo ve el Admin: ¿sigue en pie ahora que existen las estrellas que pone la Familia? Si sigue, faltan dos respuestas: qué lo compone, y la garantía de que ninguna acción automática dependa de él. El lugar donde iría ya está hecho (`datos_reservados_asistente` y su permiso).

**80. Usted** — El alta y la baja de Prestadoras: el Marketplace expone una puerta firmada para que CeltaTech dé de alta y de baja clientes; Careonys no tiene nada parecido. ¿Se construye la misma, o se siguen dando de alta a mano?

**81. Usted** — El acompañamiento online: ¿prestación más, o guardia sin domicilio? Si es guardia, hay que decidir qué reemplaza al fichaje por ubicación.

**82. Usted** — El «Gestor del cuidado»: ¿rol nuevo, variante de Coordinador, o entrada en el catálogo de permisos por Prestadora? La tercera no rompe la regla de los tres roles de Panel; las dos primeras sí. Hoy el Coordinador se asigna por guardia, no por Familia.

**83. Usted** — Cursos para familias: ¿va o no va?

**84. Usted** — La regla de los archivos dice «nunca público» y hay un depósito público construido (`marca-prestadoras`); los otros cinco son privados. ¿La regla admite la excepción, o se cierra el depósito?

---

## El sitio web

**85. Usted** — ¿Se autoriza construir `careonys.com` según `docs/PRD_01_Sitio_Web.md`? El PRD ya está entero. Hoy `sitio-web/` es una página que dice «En construcción».

**86.** Construirlo.

---

## Cierre

**87.** Entrar con huella o cara en las dos aplicaciones. Hoy no hay una sola línea de eso en ninguna carpeta.

**88. Usted** — El documento de roles generado desde la base: ¿para quién es, interno de CeltaTech o manual para la Prestadora?

**89.** Generarlo.

**90.** Actualizar `docs/CONTEXT.md`. Hoy dice cuatro cosas que ya no son ciertas: que el Módulo 6 no tiene rutas ni pantallas, que el correo sale de una sola cuenta compartida, que no hay forma de que la Prestadora le cobre a las Familias, y su mapa de módulos describe un producto mucho más chico que el real.

**91.** Borrar la sección 9 de `celtatech/docs/SUGERENCIAS_DESDE_EL_MARKETPLACE.md`: describe un riesgo que ya no existe.

**92.** Correr las pruebas y publicar.

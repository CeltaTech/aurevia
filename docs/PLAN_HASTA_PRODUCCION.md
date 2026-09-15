# PLAN HASTA PRODUCCIÓN — Careonys

**Una sola lista, del 1 al 119, en orden.** Se hace el 1, después el 2, y así hasta el final.

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

**8.** Redacción y corrección de plantillas por IA. La columna `motivo_rechazo` existe y no la lee nadie.

**9.** El vencimiento de documentos avisa por el catálogo, con su casilla de WhatsApp habilitada.

**10. Usted** — ¿Qué situaciones puede contestar la IA sola? Hoy la única regla es el criterio del modelo.

**11.** Hacerlo configurable por Prestadora, según lo contestado.

**12.** Que la fase automática recorra `configuracion_escalada_relevo`. Hoy sólo avisa que se llegó al umbral.

**13.** Poder ordenar los tres pasos de la escalada — insistir, Coordinador de respaldo, fase automática. Hoy el orden está fijo en el código.

**14. Usted** — ¿Se saca el tope de una semana hacia atrás de la ventana de aviso de guardias sin cerrar?

**15.** Sacarlo, si corresponde.

**16. Usted** — Pase de guardia, dos preguntas: cuando la llegada queda sin comprobar, ¿se le avisa igual a la Familia? Y un relevo, ¿cierra una guardia y abre la siguiente en un solo acto, o quedan dos constancias?

**17.** Ajustar el pase de guardia según lo contestado.

---

## Derechos escritos que la persona no puede ejercer

**18.** Pantalla del descargo del Asistente ante una calificación negativa. Existe en el motor y en la base; la aplicación no llama a esas rutas.

**19.** Que el Asistente vea sus propias calificaciones.

**20.** El interruptor de disponibilidad en manos del Asistente. Hoy lo maneja el Panel.

**21.** Que la Familia vea el estado documental del Asistente que contrató.

---

## La modalidad Marketplace de cara a la Familia

Existe el andamiaje —base, disparadores, cobros, consentimiento— y no existe la modalidad. **Hoy la Familia no puede buscar un Asistente, ni verlo, ni hablarle, ni contratarlo.**

**22.** Búsqueda y perfiles públicos de Asistentes en la aplicación de la Familia, con insignias de verificación y calificación.

**23.** Chat interno y videollamada entre Familia y Asistente, con el contacto tapado hasta que el cobro esté activo.

**24.** La activación al intentar ver el contacto, con confirmación antes de cobrar y con un botón propio, nunca como efecto colateral de otro.

**25.** Prioridad de acceso al pool ante una baja.

**26.** Contenido para cuidadores familiares.

---

## Los huecos del Panel

**27.** Guardias en curso en el resumen del mes.

**28.** Alertas de IA sin resolver en el resumen. El cálculo ya existe en otra pantalla.

**29.** Guardias y vínculos activos en el desglose por modalidad. Hoy sólo desglosa ausentes sin relevo previo.

**30. Usted** — Dos preguntas de la Solicitud: ¿cómo se le presenta la Asistente nueva a la Familia — aviso sin respuesta, aceptación explícita, o fuera del sistema? ¿Y se construye la vista mapa del plantel por zona, o se saca?

**31.** Sugerir y asignar Asistente parado en la Solicitud. Hoy sólo se asigna desde Guardias; la geocodificación que hacía falta ya está construida.

**32.** Vista mapa del plantel por zona, si va. No hay ninguna librería de mapas en el Panel.

**33.** Columnas de especialidades, documentación y guardias activas en la lista de Asistentes.

**34.** Filtros por zona y por especialidad en esa misma lista.

**35.** Guardias históricas en el perfil del Asistente.

**36.** Evaluaciones recibidas en el perfil. Ya existen en la pantalla de Calificaciones.

**37.** Pantalla para administrar `excepciones_familiar_relevo`. La tabla existe y no tiene interfaz.

**38.** Las cinco observaciones de apariencia: el domicilio no abre el mapa del teléfono; la medicación sigue detrás de un botón; la aplicación de Familia abre en la lista de Pacientes; la lista de reportes no muestra ánimo, ni incidentes, ni signos; y las dos aplicaciones nunca pasaron por su etapa de diseño.

**39. Usted** — Rotación y retención de Asistentes: ¿cuál es la fórmula y cuál el umbral?

**40.** Ponerlo en el tablero. Se calcula desde `ceses` y `asistentes`, sin tabla nueva.

---

## Ausencias, coberturas y cese

Acá hay tres columnas que existen en la base y **nadie escribe nunca**, así que la cobertura de una ausencia hoy queda desconectada de las guardias que esa ausencia dejó sin Asistente.

**41.** Al cargar una ausencia, escribir qué guardias quedan afectadas por ese rango de fechas. La columna `guardias_afectadas` existe (`supabase/migrations/20260819160000_foto_de_la_base.sql:1222`) y no la escribe ningún archivo.

**42.** Un sustituto por cada guardia afectada, no uno por ausencia. Hoy se inserta una sola fila y `guardia_original_id` queda vacía (`panel/src/pages/asistentes/AusenciasCoberturaTab.jsx:126-131`).

**43.** Al cerrar la ausencia, recalcular los días computados. `dias_computados` sólo se lee al armar el documento de cese; nadie la escribe.

**44.** Avisar al Coordinador y a la Familia el cambio de Asistente asignado. Hoy se inserta la cobertura y no se avisa a nadie.

**45.** Que ninguna guardia de cobertura pase a activa sin sustituto asignado.

**46.** Guardar los documentos de cese generados. Hoy el PDF se descarga y se pierde: `ceses.documentos_generados` nunca se escribe (`panel/src/lib/generarDocumentoCese.js:208-210`).

**47.** El Simulador compara el costo mensual de monotributo contra el de dependencia. Hoy sólo proyecta el costo de un despido a 3, 6, 12 y 24 meses.

**48.** El Simulador incluye el costo de la cobertura en sus proyecciones.

**49.** Que el indicador de riesgo de dependencia se recalcule solo cuando cambian los datos del Asistente. Hoy los siete indicadores se tildan a mano.

---

## Reclutamiento

Hoy hay una ruta de motor que acepta doce campos y **ninguna pantalla que la use**: no existe el formulario de postulación.

**50. Usted** — ¿Dónde vive el formulario público de postulación? No va en `careonys.com`, que le vende software a las Prestadoras: quien busca trabajo de cuidador se postula en la empresa que lo va a contratar. ¿En el sitio de cada Prestadora, con dirección propia?

**51.** Construir el formulario con todos los campos que faltan: fecha de nacimiento y control de mayoría de edad, domicilio con mapa, localidad, nacionalidad, CUIL, género, foto de perfil, situación ante AFIP, obra social, estudios y cursos, experiencia laboral, referencias, experiencia clínica, distancia máxima desde el domicilio y disponibilidad para urgencias, con retiro y sin retiro.

**52. Usted** — ¿Se le bloquea la asignación de guardias a quien no está inscripto en monotributo, o se avisa y decide la Prestadora? La regla del producto dice avisar, no bloquear, así que el PRD y la regla no coinciden.

**53.** Construirlo según lo contestado.

**54.** Verificación de identidad comparando la foto del documento con la foto de perfil. Hoy cada etapa se marca a mano.

**55.** Etapa de referencias laborales, con un mínimo verificado. El catálogo tiene cinco etapas y ninguna es ésta.

**56.** Porcentaje de avance del aspirante, en vez de una lista de etapas sin contador.

**57. Usted** — El programa de capacitación: qué contenido lleva, cuántas preguntas y qué nota se necesita para aprobar. Hoy «capacitación» es sólo el nombre de una etapa.

**58.** Construirlo.

**59.** Totales en la pantalla de Postulantes: cuántos hay, cuántos pendientes, en verificación, aprobados, rechazados.

**60.** Las columnas y los filtros que faltan: honorario pretendido y canal de llegada; y filtrar por franja horaria, urgencias, distancia máxima, condición fiscal, rango de honorario y tipo de servicio.

**61.** Videollamada de entrevista adentro de la aplicación, para que la Prestadora entreviste a un postulante sin pasarse teléfono ni correo. Hoy «entrevista» es una casilla que alguien marca a mano.

---

## Las dos aplicaciones

**62.** Botón de reporte de emergencia en la Guardia Activa, con aviso inmediato al Coordinador. La palabra no aparece en ninguna línea de la aplicación del Asistente.

**63.** Dictado por micrófono para el reporte diario. Hoy hay una caja de texto y nada más.

**64.** Mi Perfil del Asistente completo: foto, especialidades, situación de monotributo, seguro con su vencimiento, Certificado de Aptitud para ver y compartir, e historial de evaluaciones recibidas. Hoy no muestra ninguno de los seis.

**65.** La alerta por salida del domicilio: medio de transporte habitual y tiempo de viaje real. Hoy se usa una única velocidad media y distancia en línea recta, y la cuenta mide llegada tarde, no que el Asistente siga en su casa.

**66.** Especialidades y botón de contacto en «Asistente Asignado». Hoy muestra foto, nombre y tipo.

**67.** Botón para contactar al Coordinador en la pantalla de Alertas de la Familia.

**68. Usted** — El PRD promete exportar el reporte a PDF en la aplicación de la Familia, y más adelante dice que la Familia no accede al informe. ¿Cuál de las dos vale?

---

## Configuración que todavía está escrita en el código

**69.** Los umbrales del semáforo de guardia salen de la configuración de la Prestadora, que ya los tiene guardados (`panel/src/lib/semaforoGuardia.js:45-52`).

**70.** Que `cuentasPanel.js` y `panelImportacion.js` lean `etapas_incorporacion_asistente`, como ya hace `panelCuentas.js`.

**71. Usted** — Los otros nueve valores fijos que quedan, de a uno: se los muestro con su archivo y su renglón y se contesta cuál va a configuración y cuál se queda.

**72.** Mover los que corresponda.

**73.** Especialidades a un catálogo por Prestadora, igual que ya están las zonas. Hoy viven en el archivo de traducciones.

**74.** Leer un aviso de ausencia en texto libre y sugerir la categoría. El catálogo por Prestadora ya está construido; falta la mitad de IA.

**75. Usted** — ¿Cooperativa como tercera modalidad de vínculo?

**76.** Construirla: migración que abra tres CHECK, filas de conceptos y fórmulas de cese.

**77. Usted** — Nivel de complejidad: ¿qué significa cada uno de los tres? ¿Condiciona qué tipo de Asistente se admite? Hoy se carga y se edita, y el cálculo de candidatos no lo mira.

**78.** Que el cálculo de candidatos lo use.

**79. Usted** — Verificar matrícula: ¿alcanza con mirar el archivo, o hay que comprobar contra el registro del colegio profesional? La mitad técnica está construida.

**80.** Construir la verificación según lo contestado.

**81. Usted** — Accesibilidad: el código está hecho, falta la respuesta legal. `docs/legal/argentina.md` no la menciona.

**82. Usted** — El Certificado de Aptitud impreso: ¿qué lleva? Hoy la pantalla genera el código de barras y ahí termina.

**83.** Armarlo, y agregar la subida del certificado a un depósito de archivos, creado por migración con sus políticas. Hoy sólo se guardan fechas.

---

## Datos personales

**84. Usted** — Protección de datos personales: el texto lo tiene que dar el Desarrollador. `docs/legal/argentina.md` tiene ocho secciones y ninguna es de esto. Sin documento no hay aviso.

**85.** El aviso, y qué se hace con los datos de un Servicio cerrado hace años, que hoy no se purgan nunca.

**86. Usted** — La ubicación de las personas: cuatro preguntas para el profesional legal. En los 21 archivos de `docs/legal/` no aparece ni una vez «ubicación», «GPS» ni la ley 25.326. El registro del consentimiento está construido; los textos sembrados son de relleno. **Mientras no haya respuesta, el seguimiento no se enciende con nadie real.**

**87.** Sembrar los textos reales y encender el seguimiento y el aviso de demora en el trayecto.

---

## Respaldo, continuidad y secretos

**88.** Mapa de secretos en `docs/`: qué secreto existe, para qué sirve, dónde vive y cuándo se rotó, **sin un solo valor adentro**.

**89. Usted** — El alta del gestor de contraseñas, y completar las cinco filas en blanco de `celtatech/docs/CUENTAS.md`.

**90.** Rotar clave por clave lo que corresponda, decidiéndolo de a una. Si se rota la clave secreta de Supabase, se actualiza en Railway en el mismo acto. Entra acá la clave de servicio de Supabase que estuvo escrita en texto plano en la configuración de permisos de la máquina: los comandos que la llevaban adentro ya se borraron, pero la clave en sí se rota el día de la liberación, no antes.

**91.** Copiar a R2 y a B2 los seis depósitos de archivos. Hoy el respaldo sube sólo el volcado de la base: **la base se restaura y las fotos y las prescripciones no.**

**92.** Repetir la prueba de restauración. La que existe verificó 30 tablas y hoy el esquema tiene 105.

**93.** Actualizar el runbook de correo: describe una sola casilla compartida y el producto ya manda con remitente por Prestadora.

**94.** Dirección técnica de la empresa que reemplace a `soporte@careonys.com`, y pasar los vencimientos de julio de 2027 a un calendario.

---

## Marca y dominio por Prestadora

**95. Usted** — ¿Cada Prestadora tiene dominio o subdominio propio? ¿Alcanza con nombre y logo, o también remitente y dominio? ¿Y qué ve una Familia que tiene dos Servicios de modalidades distintas?

**96.** Que la pantalla de ingreso muestre la marca de la Prestadora y no la del producto.

**97.** Que la conversación quede guardada adentro del producto.

**98.** Dominio propio, si va.

---

## Módulos

**99. Usted** — ¿Dónde corre un módulo y contra qué base? Hoy `Modulos\` está vacía. De esto depende si la facturación y la cobranza salen a un módulo — la costura ya está sana — y si con eso se cierran sin construir los adaptadores de pasarela.

**100.** Sacar la facturación y la cobranza a un módulo, si corresponde.

---

## Decisiones que no traban nada empezado

**101. Usted** — Subcontratación: no existe ninguna tabla de Empresa subcontratada y el Panel no la ofrece a propósito. La precondición era no abrirla hasta que una Prestadora real lo pida. ¿Sigue valiendo?

**102. Usted** — Un tercero que sólo mira: ¿cómo entra un financiador que sólo consulta? Un cuarto rol, un Coordinador de sólo lectura desde el catálogo de permisos, o no se hace.

**103. Usted** — ¿Careonys va a atender establecimientos donde conviven Pacientes de Familias distintas — una residencia, un geriátrico? Si es más adelante, alcanza con dejarlo dicho.

**104. Usted** — ¿Diez pedidos por minuto y por persona es el número? El contador compartido hace falta el día que el motor se reparta en varios servicios; hoy corre en uno solo.

**105. Usted** — ¿Los idiomas siguen en un archivo o pasan a la base? De esto depende si sumar un idioma es una publicación o una carga de datos.

**106. Usted** — El puntaje interno de calidad del Asistente, que sólo ve el Admin: ¿sigue en pie ahora que existen las estrellas que pone la Familia? Si sigue, faltan dos respuestas: qué lo compone, y la garantía de que ninguna acción automática dependa de él. El lugar donde iría ya está hecho (`datos_reservados_asistente` y su permiso).

**107. Usted** — El alta y la baja de Prestadoras: el Marketplace expone una puerta firmada para que CeltaTech dé de alta y de baja clientes; Careonys no tiene nada parecido. ¿Se construye la misma, o se siguen dando de alta a mano?

**108. Usted** — El acompañamiento online: ¿prestación más, o guardia sin domicilio? Si es guardia, hay que decidir qué reemplaza al fichaje por ubicación.

**109. Usted** — El «Gestor del cuidado»: ¿rol nuevo, variante de Coordinador, o entrada en el catálogo de permisos por Prestadora? La tercera no rompe la regla de los tres roles de Panel; las dos primeras sí. Hoy el Coordinador se asigna por guardia, no por Familia.

**110. Usted** — Cursos para familias: ¿va o no va?

**111. Usted** — La regla de los archivos dice «nunca público» y hay un depósito público construido (`marca-prestadoras`); los otros cinco son privados. ¿La regla admite la excepción, o se cierra el depósito?

---

## El sitio web

**112. Usted** — ¿Se autoriza construir `careonys.com` según `docs/PRD_01_Sitio_Web.md`? El PRD ya está entero. Hoy `sitio-web/` es una página que dice «En construcción».

**113.** Construirlo.

---

## Cierre

**114.** Entrar con huella o cara en las dos aplicaciones. Hoy no hay una sola línea de eso en ninguna carpeta.

**115. Usted** — El documento de roles generado desde la base: ¿para quién es, interno de CeltaTech o manual para la Prestadora?

**116.** Generarlo.

**117.** Actualizar `docs/CONTEXT.md`. Hoy dice cuatro cosas que ya no son ciertas: que el Módulo 6 no tiene rutas ni pantallas, que el correo sale de una sola cuenta compartida, que no hay forma de que la Prestadora le cobre a las Familias, y su mapa de módulos describe un producto mucho más chico que el real.

**118.** Borrar la sección 9 de `celtatech/docs/SUGERENCIAS_DESDE_EL_MARKETPLACE.md`: describe un riesgo que ya no existe.

**119.** Correr las pruebas y publicar.

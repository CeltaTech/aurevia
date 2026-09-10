# PLAN HASTA PRODUCCIÓN — Careonys

**Una sola lista, del 1 al 140, en orden.** Se hace el 1, después el 2, y así hasta el final.

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

**4.** El motor le cuenta al navegador el texto crudo de los errores de la base: **208 lugares en 28 archivos** contestan `res.status(500).json({ error: error.message })`, y ese texto nombra tablas, columnas y restricciones. Está prohibido (`celtatech/CLAUDE.md` §6) y además no sirve para nada: la pantalla clasifica por motivo, no por frase (`panel/src/lib/errores.js`), así que quien mira lee «Algo falló de nuestro lado» igual. Se arregla en el punto único que ya existe, `responderError`, que hoy se contradice solo —`backend/src/utils/errorConMotivo.js:20` dice que el detalle «nunca se muestra tal cual» y el renglón 70 lo manda—: pasa a mandar únicamente el motivo, el detalle queda en el registro del servidor, y los 208 lugares pasan a llamarlo. Las dos aplicaciones de teléfono no tienen ninguno.

**5. Usted** — Las escalas legales: la validación del abogado, y los dos valores que el código usa y no existen (`piso_minimo_indemnizacion` y `fraccion_computable_antiguedad`).

---

## El cimiento: el Servicio

*Cómo se hacen los pasos 6 a 10, que mueven datos que ya están cargados:* primero se agregan las columnas nuevas **sin sacar las viejas**; después se rellenan con lo que ya hay; después se comprueba fila por fila contra la base, y **si no cuadra se para ahí**; recién entonces el código pasa a leer las nuevas; y las viejas se borran en una migración posterior, aparte. *Y tres cosas que el diseño da por sentadas:* el calendario es de cada prestación, no del Servicio; no toda prestación se convierte en una Guardia —un traslado o una limpieza se facturan sin ninguna—; y un mismo Cliente puede tener varios Servicios abiertos a la vez, sin que el producto le imponga cuántos.

*Las tres preguntas que trababan estos pasos ya están contestadas.* **El precio, el calendario y el cierre pasan a colgar del Servicio**, no del Paciente. **El Cliente puede no ser una Familia**: el glosario ya lo define como Cliente Contratante —una Familia, una Obra Social o cualquier otro que contrate—, en pantalla se dice «Cliente» a secas y en la base el identificador es `contratante`; y un mismo Servicio puede cuidar a más de un Paciente. **Los motivos de cierre son un catálogo de cada Prestadora**, que puede agregar y también quitar los que vienen de fábrica; salen de fábrica siete: fin de demanda, fallecimiento, internación del Paciente, la Familia da de baja, se cortó el pago o la cobertura, se mudó fuera de la zona, y otro.

**6.** Tipo de Cliente e identificador en `servicios`, en lugar del `familia_id` obligatorio de hoy, y reescribir `interno.validar_servicio_misma_familia()` con sus dos disparadores.

**7.** `vigente_desde` y `vigente_hasta` en `prestaciones`, con el relleno de las filas que ya existen.

**8.** `servicio_id` en `series_guardias`, y que el motor nocturno lo copie a cada guardia. Es el eslabón que falta: hoy se lee en todas partes y no se escribe en ninguna, así que las guardias nacen sin Servicio.

**9.** Mudar el precio, el calendario y el cierre del Paciente al Servicio. En la misma migración se reescriben las dos políticas de cierre del Coordinador, que hoy dependen de que exista una fila de cierre de ese Paciente.

**10.** Motivos de cierre configurables por Prestadora: quitar el CHECK con los tres valores fijos.

---

## El dinero

**11.** Dar de alta la suscripción en la pasarela y armar el cobro de cada período. Hoy `crearSuscripcion`, `generarCobroQr` y `generarCupon` no los llama nadie, y todo cobro se carga a mano.

**12.** Baja en un clic: la columna `cancelada_en` sólo se lee, nadie la escribe desde una pantalla.

**13.** Corte diferido al fin del período pagado.

**14.** Aviso previo antes del primer cobro: `trial_fin` nunca se lee.

**15.** Período de gracia y reintentos. Hoy un cobro que falla suspende en el acto (`backend/src/routes/webhooksPasarelas.js:141-143`).

**16.** Que la factura mire las fechas de vigencia y el precio pactado del paquete. Hoy arma el total sin ningún filtro de fecha y nunca consulta `paquetes_prestaciones` (`panel/src/pages/Facturacion.jsx:120-175`).

**17.** Sacar `precio_addon` y `moneda_addon` de `catalogo_modulos`: es concepto comercial adentro del producto.

**18. Usted** — El ciclo de cobranza a obras sociales: hoy sólo existen validado y anulado. ¿Qué estados hacen falta — presentación, débito, conciliación?

**19.** Construir ese ciclo.

**20.** Que la Familia vea su factura desglosada en la aplicación. La base está entera; falta la ventanilla.

**21. Usted** — ¿Se agrega una tercera vía de pago, con un intermediario que reciba en bloque y redistribuya? Si es sí, antes hay que resolver si eso cambia quién ejerce el control (art. 23 LCT).

---

## Que los avisos lleguen

**22.** Los avisos del motor en los tres idiomas. Hoy el castellano está escrito adentro del código en seis archivos.

**23.** Canal único de avisos empujados al Panel. Hoy una pantalla pregunta cada 12 segundos y no hay ningún canal en vivo.

**24.** Enviar la plantilla a Meta y guardar el identificador que devuelve. Hoy sólo cambia un estado guardado.

**25.** Traer de Meta el resultado de la aprobación. Hoy «aprobada» y «rechazada» sólo cambian si alguien los escribe a mano.

**26.** Enviar por plantilla de verdad. Hoy `backend/src/utils/whatsapp.js:44-49` arma siempre texto suelto.

**27.** Redacción y corrección de plantillas por IA. La columna `motivo_rechazo` existe y no la lee nadie.

**28.** El vencimiento de documentos avisa por el catálogo, con su casilla de WhatsApp habilitada.

**29. Usted** — ¿Qué situaciones puede contestar la IA sola? Hoy la única regla es el criterio del modelo.

**30.** Hacerlo configurable por Prestadora, según lo contestado.

**31.** Que la fase automática recorra `configuracion_escalada_relevo`. Hoy sólo avisa que se llegó al umbral.

**32.** Poder ordenar los tres pasos de la escalada — insistir, Coordinador de respaldo, fase automática. Hoy el orden está fijo en el código.

**33. Usted** — ¿Se saca el tope de una semana hacia atrás de la ventana de aviso de guardias sin cerrar?

**34.** Sacarlo, si corresponde.

**35. Usted** — Pase de guardia, dos preguntas: cuando la llegada queda sin comprobar, ¿se le avisa igual a la Familia? Y un relevo, ¿cierra una guardia y abre la siguiente en un solo acto, o quedan dos constancias?

**36.** Ajustar el pase de guardia según lo contestado.

---

## Derechos escritos que la persona no puede ejercer

**37.** Pantalla del descargo del Asistente ante una calificación negativa. Existe en el motor y en la base; la aplicación no llama a esas rutas.

**38.** Que el Asistente vea sus propias calificaciones.

**39.** El interruptor de disponibilidad en manos del Asistente. Hoy lo maneja el Panel.

**40.** Que la Familia vea el estado documental del Asistente que contrató.

---

## La modalidad Marketplace de cara a la Familia

Existe el andamiaje —base, disparadores, cobros, consentimiento— y no existe la modalidad. **Hoy la Familia no puede buscar un Asistente, ni verlo, ni hablarle, ni contratarlo.**

**41.** Búsqueda y perfiles públicos de Asistentes en la aplicación de la Familia, con insignias de verificación y calificación.

**42.** Chat interno y videollamada entre Familia y Asistente, con el contacto tapado hasta que se activa la suscripción.

**43.** La activación al intentar ver el contacto, con confirmación antes de cobrar.

**44.** Prioridad de acceso al pool ante una baja.

**45.** Contenido para cuidadores familiares.

---

## Los huecos del Panel

**46.** Guardias en curso en el resumen del mes.

**47.** Alertas de IA sin resolver en el resumen. El cálculo ya existe en otra pantalla.

**48.** Guardias y vínculos activos en el desglose por modalidad. Hoy sólo desglosa ausentes sin relevo previo.

**49. Usted** — Dos preguntas de la Solicitud: ¿cómo se le presenta la Asistente nueva a la Familia — aviso sin respuesta, aceptación explícita, o fuera del sistema? ¿Y se construye la vista mapa del plantel por zona, o se saca?

**50.** Sugerir y asignar Asistente parado en la Solicitud. Hoy sólo se asigna desde Guardias; la geocodificación que hacía falta ya está construida.

**51.** Vista mapa del plantel por zona, si va. No hay ninguna librería de mapas en el Panel.

**52.** Columnas de especialidades, documentación y guardias activas en la lista de Asistentes.

**53.** Filtros por zona y por especialidad en esa misma lista.

**54.** Guardias históricas en el perfil del Asistente.

**55.** Evaluaciones recibidas en el perfil. Ya existen en la pantalla de Calificaciones.

**56.** Pantalla para administrar `excepciones_familiar_relevo`. La tabla existe y no tiene interfaz.

**57.** Las cinco observaciones de apariencia: el domicilio no abre el mapa del teléfono; la medicación sigue detrás de un botón; la aplicación de Familia abre en la lista de Pacientes; la lista de reportes no muestra ánimo, ni incidentes, ni signos; y las dos aplicaciones nunca pasaron por su etapa de diseño.

**58. Usted** — Rotación y retención de Asistentes: ¿cuál es la fórmula y cuál el umbral?

**59.** Ponerlo en el tablero. Se calcula desde `ceses` y `asistentes`, sin tabla nueva.

---

## Ausencias, coberturas y cese

Acá hay tres columnas que existen en la base y **nadie escribe nunca**, así que la cobertura de una ausencia hoy queda desconectada de las guardias que esa ausencia dejó sin Asistente.

**60.** Al cargar una ausencia, escribir qué guardias quedan afectadas por ese rango de fechas. La columna `guardias_afectadas` existe (`supabase/migrations/20260819160000_foto_de_la_base.sql:1222`) y no la escribe ningún archivo.

**61.** Un sustituto por cada guardia afectada, no uno por ausencia. Hoy se inserta una sola fila y `guardia_original_id` queda vacía (`panel/src/pages/asistentes/AusenciasCoberturaTab.jsx:126-131`).

**62.** Al cerrar la ausencia, recalcular los días computados. `dias_computados` sólo se lee al armar el documento de cese; nadie la escribe.

**63.** Avisar al Coordinador y a la Familia el cambio de Asistente asignado. Hoy se inserta la cobertura y no se avisa a nadie.

**64.** Que ninguna guardia de cobertura pase a activa sin sustituto asignado.

**65.** Guardar los documentos de cese generados. Hoy el PDF se descarga y se pierde: `ceses.documentos_generados` nunca se escribe (`panel/src/lib/generarDocumentoCese.js:208-210`).

**66.** El Simulador compara el costo mensual de monotributo contra el de dependencia. Hoy sólo proyecta el costo de un despido a 3, 6, 12 y 24 meses.

**67.** El Simulador incluye el costo de la cobertura en sus proyecciones.

**68.** Que el indicador de riesgo de dependencia se recalcule solo cuando cambian los datos del Asistente. Hoy los siete indicadores se tildan a mano.

---

## Reclutamiento

Hoy hay una ruta de motor que acepta doce campos y **ninguna pantalla que la use**: no existe el formulario de postulación.

**69. Usted** — ¿Dónde vive el formulario público de postulación? No va en `careonys.com`, que le vende software a las Prestadoras: quien busca trabajo de cuidador se postula en la empresa que lo va a contratar. ¿En el sitio de cada Prestadora, con dirección propia?

**70.** Construir el formulario con todos los campos que faltan: fecha de nacimiento y control de mayoría de edad, domicilio con mapa, localidad, nacionalidad, CUIL, género, foto de perfil, situación ante AFIP, obra social, estudios y cursos, experiencia laboral, referencias, experiencia clínica, distancia máxima desde el domicilio y disponibilidad para urgencias, con retiro y sin retiro.

**71. Usted** — ¿Se le bloquea la asignación de guardias a quien no está inscripto en monotributo, o se avisa y decide la Prestadora? La regla del producto dice avisar, no bloquear, así que el PRD y la regla no coinciden.

**72.** Construirlo según lo contestado.

**73.** Verificación de identidad comparando la foto del documento con la foto de perfil. Hoy cada etapa se marca a mano.

**74.** Etapa de referencias laborales, con un mínimo verificado. El catálogo tiene cinco etapas y ninguna es ésta.

**75.** Porcentaje de avance del aspirante, en vez de una lista de etapas sin contador.

**76. Usted** — El programa de capacitación: qué contenido lleva, cuántas preguntas y qué nota se necesita para aprobar. Hoy «capacitación» es sólo el nombre de una etapa.

**77.** Construirlo.

**78.** Totales en la pantalla de Postulantes: cuántos hay, cuántos pendientes, en verificación, aprobados, rechazados.

**79.** Las columnas y los filtros que faltan: honorario pretendido y canal de llegada; y filtrar por franja horaria, urgencias, distancia máxima, condición fiscal, rango de honorario y tipo de servicio.

**80.** Videollamada de entrevista adentro de la aplicación, para que la Prestadora entreviste a un postulante sin pasarse teléfono ni correo. Hoy «entrevista» es una casilla que alguien marca a mano.

---

## Las dos aplicaciones

**81.** Botón de reporte de emergencia en la Guardia Activa, con aviso inmediato al Coordinador. La palabra no aparece en ninguna línea de la aplicación del Asistente.

**82.** Dictado por micrófono para el reporte diario. Hoy hay una caja de texto y nada más.

**83.** Mi Perfil del Asistente completo: foto, especialidades, situación de monotributo, seguro con su vencimiento, Certificado de Aptitud para ver y compartir, e historial de evaluaciones recibidas. Hoy no muestra ninguno de los seis.

**84.** La alerta por salida del domicilio: medio de transporte habitual y tiempo de viaje real. Hoy se usa una única velocidad media y distancia en línea recta, y la cuenta mide llegada tarde, no que el Asistente siga en su casa.

**85.** Especialidades y botón de contacto en «Asistente Asignado». Hoy muestra foto, nombre y tipo.

**86.** Botón para contactar al Coordinador en la pantalla de Alertas de la Familia.

**87. Usted** — El PRD promete exportar el reporte a PDF en la aplicación de la Familia, y más adelante dice que la Familia no accede al informe. ¿Cuál de las dos vale?

---

## Configuración que todavía está escrita en el código

**88.** Los umbrales del semáforo de guardia salen de la configuración de la Prestadora, que ya los tiene guardados (`panel/src/lib/semaforoGuardia.js:45-52`).

**89.** Que `cuentasPanel.js` y `panelImportacion.js` lean `etapas_incorporacion_asistente`, como ya hace `panelCuentas.js`.

**90. Usted** — Los otros nueve valores fijos que quedan, de a uno: se los muestro con su archivo y su renglón y se contesta cuál va a configuración y cuál se queda.

**91.** Mover los que corresponda.

**92.** Especialidades a un catálogo por Prestadora, igual que ya están las zonas. Hoy viven en el archivo de traducciones.

**93.** Leer un aviso de ausencia en texto libre y sugerir la categoría. El catálogo por Prestadora ya está construido; falta la mitad de IA.

**94. Usted** — ¿Cooperativa como tercera modalidad de vínculo?

**95.** Construirla: migración que abra tres CHECK, filas de conceptos y fórmulas de cese.

**96. Usted** — Nivel de complejidad: ¿qué significa cada uno de los tres? ¿Condiciona qué tipo de Asistente se admite? Hoy se carga y se edita, y el cálculo de candidatos no lo mira.

**97.** Que el cálculo de candidatos lo use.

**98. Usted** — Verificar matrícula: ¿alcanza con mirar el archivo, o hay que comprobar contra el registro del colegio profesional? La mitad técnica está construida.

**99.** Construir la verificación según lo contestado.

**100. Usted** — Accesibilidad: el código está hecho, falta la respuesta legal. `docs/legal/argentina.md` no la menciona.

**101. Usted** — El Certificado de Aptitud impreso: ¿qué lleva? Hoy la pantalla genera el código de barras y ahí termina.

**102.** Armarlo, y agregar la subida del certificado a un depósito de archivos, creado por migración con sus políticas. Hoy sólo se guardan fechas.

---

## Datos personales

**103. Usted** — Protección de datos personales: el texto lo tiene que dar el Desarrollador. `docs/legal/argentina.md` tiene ocho secciones y ninguna es de esto. Sin documento no hay aviso.

**104.** El aviso, y qué se hace con los datos de un Servicio cerrado hace años, que hoy no se purgan nunca.

**105. Usted** — La ubicación de las personas: cuatro preguntas para el profesional legal. En los 21 archivos de `docs/legal/` no aparece ni una vez «ubicación», «GPS» ni la ley 25.326. El registro del consentimiento está construido; los textos sembrados son de relleno. **Mientras no haya respuesta, el seguimiento no se enciende con nadie real.**

**106.** Sembrar los textos reales y encender el seguimiento y el aviso de demora en el trayecto.

---

## Respaldo, continuidad y secretos

**107.** Mapa de secretos en `docs/`: qué secreto existe, para qué sirve, dónde vive y cuándo se rotó, **sin un solo valor adentro**.

**108. Usted** — El alta del gestor de contraseñas, y completar las cinco filas en blanco de `celtatech/docs/CUENTAS.md`.

**109.** Rotar clave por clave lo que corresponda, decidiéndolo de a una. Si se rota la clave secreta de Supabase, se actualiza en Railway en el mismo acto.

**110.** Copiar a R2 y a B2 los seis depósitos de archivos. Hoy el respaldo sube sólo el volcado de la base: **la base se restaura y las fotos y las prescripciones no.**

**111.** Repetir la prueba de restauración. La que existe verificó 30 tablas y hoy el esquema tiene 105.

**112.** Actualizar el runbook de correo: describe una sola casilla compartida y el producto ya manda con remitente por Prestadora.

**113.** Dirección técnica de la empresa que reemplace a `soporte@careonys.com`, y pasar los vencimientos de julio de 2027 a un calendario.

---

## Marca y dominio por Prestadora

**114. Usted** — ¿Cada Prestadora tiene dominio o subdominio propio? ¿Alcanza con nombre y logo, o también remitente y dominio? ¿Y qué ve una Familia que tiene dos Servicios de modalidades distintas?

**115.** Que la pantalla de ingreso muestre la marca de la Prestadora y no la del producto.

**116.** Que la conversación quede guardada adentro del producto.

**117.** Dominio propio, si va.

---

## Módulos

**118. Usted** — ¿Dónde corre un módulo y contra qué base? Hoy `Modulos\` está vacía. De esto depende si la facturación y la cobranza salen a un módulo — la costura ya está sana — y si con eso se cierran sin construir los adaptadores de pasarela.

**119.** Sacar la facturación y la cobranza a un módulo, si corresponde.

---

## Decisiones que no traban nada empezado

**120. Usted** — Subcontratación: no existe ninguna tabla de Empresa subcontratada y el Panel no la ofrece a propósito. La precondición era no abrirla hasta que una Prestadora real lo pida. ¿Sigue valiendo?

**121. Usted** — Un tercero que sólo mira: ¿cómo entra un financiador que sólo consulta? Un cuarto rol, un Coordinador de sólo lectura desde el catálogo de permisos, o no se hace.

**122. Usted** — ¿Careonys va a atender establecimientos donde conviven Pacientes de Familias distintas — una residencia, un geriátrico? Si es más adelante, alcanza con dejarlo dicho.

**123. Usted** — ¿Diez pedidos por minuto y por persona es el número? El contador compartido hace falta el día que el motor se reparta en varios servicios; hoy corre en uno solo.

**124. Usted** — El tope de uso de IA por plan **no se puede construir como está escrito**: pide un tope por plan comercial adentro de Careonys, y eso choca con la regla de que el producto no restringe por razones comerciales. La medición sí existe. O se reescribe como tope técnico sin nombre de plan, o el tope vive en CeltaTech.

**125. Usted** — ¿Qué se corta cuando un cliente deja de pagar, siendo que lo que presta es cuidado de personas? Tres respuestas: cuánto sigue funcionando, por cuánto tiempo, y qué se corta primero para que lo sufra quien no paga y no la persona cuidada. Hoy no hay ningún interruptor de suspensión, y hasta que esto no esté contestado no se construye.

**126. Usted** — ¿Los idiomas siguen en un archivo o pasan a la base? De esto depende si sumar un idioma es una publicación o una carga de datos.

**127. Usted** — El puntaje interno de calidad del Asistente, que sólo ve el Admin: ¿sigue en pie ahora que existen las estrellas que pone la Familia? Si sigue, faltan dos respuestas: qué lo compone, y la garantía de que ninguna acción automática dependa de él. El lugar donde iría ya está hecho (`datos_reservados_asistente` y su permiso).

**128. Usted** — El alta y la baja de Prestadoras: el Marketplace expone una puerta firmada para que CeltaTech dé de alta y de baja clientes; Careonys no tiene nada parecido. ¿Se construye la misma, o se siguen dando de alta a mano?

**129. Usted** — El acompañamiento online: ¿prestación más, o guardia sin domicilio? Si es guardia, hay que decidir qué reemplaza al fichaje por ubicación.

**130. Usted** — El «Gestor del cuidado»: ¿rol nuevo, variante de Coordinador, o entrada en el catálogo de permisos por Prestadora? La tercera no rompe la regla de los tres roles de Panel; las dos primeras sí. Hoy el Coordinador se asigna por guardia, no por Familia.

**131. Usted** — Cursos para familias: ¿va o no va? Si es contenido pago, el precio y el paquete son de CeltaTech y no entran acá.

**132. Usted** — La regla de los archivos dice «nunca público» y hay un depósito público construido (`marca-prestadoras`); los otros cinco son privados. ¿La regla admite la excepción, o se cierra el depósito?

---

## El sitio web

**133. Usted** — ¿Se autoriza construir `careonys.com` según `docs/PRD_01_Sitio_Web.md`? El PRD ya está entero. Hoy `sitio-web/` es una página que dice «En construcción».

**134.** Construirlo.

---

## Cierre

**135.** Entrar con huella o cara en las dos aplicaciones. Hoy no hay una sola línea de eso en ninguna carpeta.

**136. Usted** — El documento de roles generado desde la base: ¿para quién es, interno de CeltaTech o manual para la Prestadora?

**137.** Generarlo.

**138.** Actualizar `docs/CONTEXT.md`. Hoy dice cuatro cosas que ya no son ciertas: que el Módulo 6 no tiene rutas ni pantallas, que el correo sale de una sola cuenta compartida, que no hay forma de que la Prestadora le cobre a las Familias, y su mapa de módulos describe un producto mucho más chico que el real.

**139.** Borrar la sección 9 de `celtatech/docs/SUGERENCIAS_DESDE_EL_MARKETPLACE.md`: describe un riesgo que ya no existe.

**140.** Correr las pruebas y publicar.

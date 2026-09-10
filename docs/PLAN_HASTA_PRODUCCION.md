# PLAN HASTA PRODUCCIÓN — Careonys

**Una sola lista, del 1 al 154, en orden.** Se hace el 1, después el 2, y así hasta el final.

- Los pasos que empiezan con **Usted** los contesta o los hace el Desarrollador. Los demás los hago yo.
- **Un paso terminado se borra de este archivo.** No se marca como hecho: se saca.
- **No se abren pendientes nuevos.** Un problema que aparece se arregla en el momento; si no cabe en la tarea que se está haciendo, se agrega como paso en el lugar de la lista que le corresponde.

---

## El correo (hoy no llega ninguno)

**1. Usted** — Decidir si se hacen los pasos en Google Cloud para mandar correo por la API de Gmail con OAuth2. Hoy el motor manda por SMTP de Gmail puerto 465 (`backend/src/utils/email.js:5,25`), que es el camino que Railway bloquea: **no se entrega ningún correo** — ni ausencias, ni vencimientos, ni invitaciones de cuenta, ni recuperación de doble factor.

**2.** Cambiar el envío a la API de Gmail.

**3. Usted** — Comprobar que el correo de activación llega y abre la aplicación.

---

## Aislamiento entre Prestadoras (defectos vivos)

**4.** El código de zona es único en todo el sistema: la primera Prestadora que cargue `caba` se lo bloquea a todas. Migración con índice único por Prestadora (`supabase/migrations/20260819160000_foto_de_la_base.sql:3705`).

**5.** Las tres claves que apuntan a un Servicio no llevan la Prestadora adentro. Migración con claves compuestas (`guardias_servicio_id_fkey`, `prestaciones_servicio_id_fkey`, `facturas_familia_items_servicio_id_fkey`).

**6.** Borrar `public.exigir_paciente_y_servicio_de_la_misma_familia`: no la ejecuta ningún disparador, es código muerto.

**7.** Las pantallas y rutas de marketplace se abren por rol, no por modalidad: una Prestadora sin marketplace entra escribiendo la dirección. La función que hace falta ya existe y no la llama nadie: `prestadora_tiene_modalidad_activa`.

**8.** No dejar apagar una modalidad que todavía tiene vínculos o suscripciones activas (`backend/src/routes/panelConfiguracion.js:982-1005`).

**9.** Modo y DEBIN dan por válido cualquier aviso de pago que traiga un identificador, sin comprobar firma. Stripe y Mercado Pago sí la comprueban.

**10.** Las credenciales de WhatsApp las alcanza el superadmin: tienen que ser sólo de `admin_prestadora`.

---

## Lo que se ve en pantalla

**11.** La lista de precios muestra el importe sin la moneda (`panel/src/pages/ListaPrecios.jsx:70`).

**12.** Los tres carteles «módulo no disponible» de la ficha de la Familia — guardias activas, historial de reportes y alertas. Los tres datos ya existen en otras pantallas.

**13.** Sembrar las cinco advertencias legales de marketplace. Los textos ya están escritos en `docs/legal/argentina.md:66-72` y nunca se cargaron, así que la pantalla de auditoría legal no puede mostrar nada. Y llamar a `verificarAntesDeActivar` desde las pantallas que activan esas funciones.

**14.** «Elegir modalidad» al primer lugar de la guía de primeros pasos: hoy es el segundo de ocho.

**15.** Enganchar la guía de primeros pasos con la lectura de planilla que ya existe, para que proponga la configuración inicial.

**16.** Avisar en pantalla que las escalas legales son provisorias. Las 15 filas lo dicen adentro de la base y la pantalla no lo muestra.

**17.** «Score de riesgo» pasa a llamarse «Indicador de riesgo de dependencia» en las tres traducciones.

**18. Usted** — Las escalas legales: la validación del abogado, y los dos valores que el código usa y no existen (`piso_minimo_indemnizacion` y `fraccion_computable_antiguedad`).

---

## El cimiento: el Servicio

*Cómo se hacen los pasos 20 a 24, que mueven datos que ya están cargados:* primero se agregan las columnas nuevas **sin sacar las viejas**; después se rellenan con lo que ya hay; después se comprueba fila por fila contra la base, y **si no cuadra se para ahí**; recién entonces el código pasa a leer las nuevas; y las viejas se borran en una migración posterior, aparte. *Y tres cosas que el diseño da por sentadas:* el calendario es de cada prestación, no del Servicio; no toda prestación se convierte en una Guardia —un traslado o una limpieza se facturan sin ninguna—; y un mismo Cliente puede tener varios Servicios abiertos a la vez, sin que el producto le imponga cuántos.

**19. Usted** — Tres preguntas, ninguna técnica: ¿el precio, el calendario y el cierre pasan a colgar del acuerdo en vez del Paciente? ¿se hace lugar para que el Cliente pueda no ser una Familia? ¿qué motivos de cierre existen además de fin de demanda, fallecimiento y otro? **Sin esto no se hace ninguno de los cinco pasos que siguen.**

**20.** Tipo de Cliente e identificador en `servicios`, en lugar del `familia_id` obligatorio de hoy, y reescribir `interno.validar_servicio_misma_familia()` con sus dos disparadores.

**21.** `vigente_desde` y `vigente_hasta` en `prestaciones`, con el relleno de las filas que ya existen.

**22.** `servicio_id` en `series_guardias`, y que el motor nocturno lo copie a cada guardia. Es el eslabón que falta: hoy se lee en todas partes y no se escribe en ninguna, así que las guardias nacen sin Servicio.

**23.** Mudar el precio, el calendario y el cierre del Paciente al Servicio. En la misma migración se reescriben las dos políticas de cierre del Coordinador, que hoy dependen de que exista una fila de cierre de ese Paciente.

**24.** Motivos de cierre configurables por Prestadora: quitar el CHECK con los tres valores fijos.

---

## El dinero

**25.** Dar de alta la suscripción en la pasarela y armar el cobro de cada período. Hoy `crearSuscripcion`, `generarCobroQr` y `generarCupon` no los llama nadie, y todo cobro se carga a mano.

**26.** Baja en un clic: la columna `cancelada_en` sólo se lee, nadie la escribe desde una pantalla.

**27.** Corte diferido al fin del período pagado.

**28.** Aviso previo antes del primer cobro: `trial_fin` nunca se lee.

**29.** Período de gracia y reintentos. Hoy un cobro que falla suspende en el acto (`backend/src/routes/webhooksPasarelas.js:141-143`).

**30.** Que la factura mire las fechas de vigencia y el precio pactado del paquete. Hoy arma el total sin ningún filtro de fecha y nunca consulta `paquetes_prestaciones` (`panel/src/pages/Facturacion.jsx:120-175`).

**31.** Sacar `precio_addon` y `moneda_addon` de `catalogo_modulos`: es concepto comercial adentro del producto.

**32. Usted** — El ciclo de cobranza a obras sociales: hoy sólo existen validado y anulado. ¿Qué estados hacen falta — presentación, débito, conciliación?

**33.** Construir ese ciclo.

**34.** Que la Familia vea su factura desglosada en la aplicación. La base está entera; falta la ventanilla.

**35. Usted** — ¿Se agrega una tercera vía de pago, con un intermediario que reciba en bloque y redistribuya? Si es sí, antes hay que resolver si eso cambia quién ejerce el control (art. 23 LCT).

---

## Que los avisos lleguen

**36.** Los avisos del motor en los tres idiomas. Hoy el castellano está escrito adentro del código en seis archivos.

**37.** Canal único de avisos empujados al Panel. Hoy una pantalla pregunta cada 12 segundos y no hay ningún canal en vivo.

**38.** Enviar la plantilla a Meta y guardar el identificador que devuelve. Hoy sólo cambia un estado guardado.

**39.** Traer de Meta el resultado de la aprobación. Hoy «aprobada» y «rechazada» sólo cambian si alguien los escribe a mano.

**40.** Enviar por plantilla de verdad. Hoy `backend/src/utils/whatsapp.js:44-49` arma siempre texto suelto.

**41.** Redacción y corrección de plantillas por IA. La columna `motivo_rechazo` existe y no la lee nadie.

**42.** El vencimiento de documentos avisa por el catálogo, con su casilla de WhatsApp habilitada.

**43. Usted** — ¿Qué situaciones puede contestar la IA sola? Hoy la única regla es el criterio del modelo.

**44.** Hacerlo configurable por Prestadora, según lo contestado.

**45.** Que la fase automática recorra `configuracion_escalada_relevo`. Hoy sólo avisa que se llegó al umbral.

**46.** Poder ordenar los tres pasos de la escalada — insistir, Coordinador de respaldo, fase automática. Hoy el orden está fijo en el código.

**47. Usted** — ¿Se saca el tope de una semana hacia atrás de la ventana de aviso de guardias sin cerrar?

**48.** Sacarlo, si corresponde.

**49. Usted** — Pase de guardia, dos preguntas: cuando la llegada queda sin comprobar, ¿se le avisa igual a la Familia? Y un relevo, ¿cierra una guardia y abre la siguiente en un solo acto, o quedan dos constancias?

**50.** Ajustar el pase de guardia según lo contestado.

---

## Derechos escritos que la persona no puede ejercer

**51.** Pantalla del descargo del Asistente ante una calificación negativa. Existe en el motor y en la base; la aplicación no llama a esas rutas.

**52.** Que el Asistente vea sus propias calificaciones.

**53.** El interruptor de disponibilidad en manos del Asistente. Hoy lo maneja el Panel.

**54.** Que la Familia vea el estado documental del Asistente que contrató.

---

## La modalidad Marketplace de cara a la Familia

Existe el andamiaje —base, disparadores, cobros, consentimiento— y no existe la modalidad. **Hoy la Familia no puede buscar un Asistente, ni verlo, ni hablarle, ni contratarlo.**

**55.** Búsqueda y perfiles públicos de Asistentes en la aplicación de la Familia, con insignias de verificación y calificación.

**56.** Chat interno y videollamada entre Familia y Asistente, con el contacto tapado hasta que se activa la suscripción.

**57.** La activación al intentar ver el contacto, con confirmación antes de cobrar.

**58.** Prioridad de acceso al pool ante una baja.

**59.** Contenido para cuidadores familiares.

---

## Los huecos del Panel

**60.** Guardias en curso en el resumen del mes.

**61.** Alertas de IA sin resolver en el resumen. El cálculo ya existe en otra pantalla.

**62.** Guardias y vínculos activos en el desglose por modalidad. Hoy sólo desglosa ausentes sin relevo previo.

**63. Usted** — Dos preguntas de la Solicitud: ¿cómo se le presenta la Asistente nueva a la Familia — aviso sin respuesta, aceptación explícita, o fuera del sistema? ¿Y se construye la vista mapa del plantel por zona, o se saca?

**64.** Sugerir y asignar Asistente parado en la Solicitud. Hoy sólo se asigna desde Guardias; la geocodificación que hacía falta ya está construida.

**65.** Vista mapa del plantel por zona, si va. No hay ninguna librería de mapas en el Panel.

**66.** Columnas de especialidades, documentación y guardias activas en la lista de Asistentes.

**67.** Filtros por zona y por especialidad en esa misma lista.

**68.** Guardias históricas en el perfil del Asistente.

**69.** Evaluaciones recibidas en el perfil. Ya existen en la pantalla de Calificaciones.

**70.** Pantalla para administrar `excepciones_familiar_relevo`. La tabla existe y no tiene interfaz.

**71.** Las cinco observaciones de apariencia: el domicilio no abre el mapa del teléfono; la medicación sigue detrás de un botón; la aplicación de Familia abre en la lista de Pacientes; la lista de reportes no muestra ánimo, ni incidentes, ni signos; y las dos aplicaciones nunca pasaron por su etapa de diseño.

**72. Usted** — Rotación y retención de Asistentes: ¿cuál es la fórmula y cuál el umbral?

**73.** Ponerlo en el tablero. Se calcula desde `ceses` y `asistentes`, sin tabla nueva.

---

## Ausencias, coberturas y cese

Acá hay tres columnas que existen en la base y **nadie escribe nunca**, así que la cobertura de una ausencia hoy queda desconectada de las guardias que esa ausencia dejó sin Asistente.

**74.** Al cargar una ausencia, escribir qué guardias quedan afectadas por ese rango de fechas. La columna `guardias_afectadas` existe (`supabase/migrations/20260819160000_foto_de_la_base.sql:1222`) y no la escribe ningún archivo.

**75.** Un sustituto por cada guardia afectada, no uno por ausencia. Hoy se inserta una sola fila y `guardia_original_id` queda vacía (`panel/src/pages/asistentes/AusenciasCoberturaTab.jsx:126-131`).

**76.** Al cerrar la ausencia, recalcular los días computados. `dias_computados` sólo se lee al armar el documento de cese; nadie la escribe.

**77.** Avisar al Coordinador y a la Familia el cambio de Asistente asignado. Hoy se inserta la cobertura y no se avisa a nadie.

**78.** Que ninguna guardia de cobertura pase a activa sin sustituto asignado.

**79.** Guardar los documentos de cese generados. Hoy el PDF se descarga y se pierde: `ceses.documentos_generados` nunca se escribe (`panel/src/lib/generarDocumentoCese.js:208-210`).

**80.** El Simulador compara el costo mensual de monotributo contra el de dependencia. Hoy sólo proyecta el costo de un despido a 3, 6, 12 y 24 meses.

**81.** El Simulador incluye el costo de la cobertura en sus proyecciones.

**82.** Que el indicador de riesgo de dependencia se recalcule solo cuando cambian los datos del Asistente. Hoy los siete indicadores se tildan a mano.

---

## Reclutamiento

Hoy hay una ruta de motor que acepta doce campos y **ninguna pantalla que la use**: no existe el formulario de postulación.

**83. Usted** — ¿Dónde vive el formulario público de postulación? No va en `careonys.com`, que le vende software a las Prestadoras: quien busca trabajo de cuidador se postula en la empresa que lo va a contratar. ¿En el sitio de cada Prestadora, con dirección propia?

**84.** Construir el formulario con todos los campos que faltan: fecha de nacimiento y control de mayoría de edad, domicilio con mapa, localidad, nacionalidad, CUIL, género, foto de perfil, situación ante AFIP, obra social, estudios y cursos, experiencia laboral, referencias, experiencia clínica, distancia máxima desde el domicilio y disponibilidad para urgencias, con retiro y sin retiro.

**85. Usted** — ¿Se le bloquea la asignación de guardias a quien no está inscripto en monotributo, o se avisa y decide la Prestadora? La regla del producto dice avisar, no bloquear, así que el PRD y la regla no coinciden.

**86.** Construirlo según lo contestado.

**87.** Verificación de identidad comparando la foto del documento con la foto de perfil. Hoy cada etapa se marca a mano.

**88.** Etapa de referencias laborales, con un mínimo verificado. El catálogo tiene cinco etapas y ninguna es ésta.

**89.** Porcentaje de avance del aspirante, en vez de una lista de etapas sin contador.

**90. Usted** — El programa de capacitación: qué contenido lleva, cuántas preguntas y qué nota se necesita para aprobar. Hoy «capacitación» es sólo el nombre de una etapa.

**91.** Construirlo.

**92.** Totales en la pantalla de Postulantes: cuántos hay, cuántos pendientes, en verificación, aprobados, rechazados.

**93.** Las columnas y los filtros que faltan: honorario pretendido y canal de llegada; y filtrar por franja horaria, urgencias, distancia máxima, condición fiscal, rango de honorario y tipo de servicio.

**94.** Videollamada de entrevista adentro de la aplicación, para que la Prestadora entreviste a un postulante sin pasarse teléfono ni correo. Hoy «entrevista» es una casilla que alguien marca a mano.

---

## Las dos aplicaciones

**95.** Botón de reporte de emergencia en la Guardia Activa, con aviso inmediato al Coordinador. La palabra no aparece en ninguna línea de la aplicación del Asistente.

**96.** Dictado por micrófono para el reporte diario. Hoy hay una caja de texto y nada más.

**97.** Mi Perfil del Asistente completo: foto, especialidades, situación de monotributo, seguro con su vencimiento, Certificado de Aptitud para ver y compartir, e historial de evaluaciones recibidas. Hoy no muestra ninguno de los seis.

**98.** La alerta por salida del domicilio: medio de transporte habitual y tiempo de viaje real. Hoy se usa una única velocidad media y distancia en línea recta, y la cuenta mide llegada tarde, no que el Asistente siga en su casa.

**99.** Especialidades y botón de contacto en «Asistente Asignado». Hoy muestra foto, nombre y tipo.

**100.** Botón para contactar al Coordinador en la pantalla de Alertas de la Familia.

**101. Usted** — El PRD promete exportar el reporte a PDF en la aplicación de la Familia, y más adelante dice que la Familia no accede al informe. ¿Cuál de las dos vale?

---

## Configuración que todavía está escrita en el código

**102.** Los umbrales del semáforo de guardia salen de la configuración de la Prestadora, que ya los tiene guardados (`panel/src/lib/semaforoGuardia.js:45-52`).

**103.** Que `cuentasPanel.js` y `panelImportacion.js` lean `etapas_incorporacion_asistente`, como ya hace `panelCuentas.js`.

**104. Usted** — Los otros nueve valores fijos que quedan, de a uno: se los muestro con su archivo y su renglón y se contesta cuál va a configuración y cuál se queda.

**105.** Mover los que corresponda.

**106.** Especialidades a un catálogo por Prestadora, igual que ya están las zonas. Hoy viven en el archivo de traducciones.

**107.** Leer un aviso de ausencia en texto libre y sugerir la categoría. El catálogo por Prestadora ya está construido; falta la mitad de IA.

**108. Usted** — ¿Cooperativa como tercera modalidad de vínculo?

**109.** Construirla: migración que abra tres CHECK, filas de conceptos y fórmulas de cese.

**110. Usted** — Nivel de complejidad: ¿qué significa cada uno de los tres? ¿Condiciona qué tipo de Asistente se admite? Hoy se carga y se edita, y el cálculo de candidatos no lo mira.

**111.** Que el cálculo de candidatos lo use.

**112. Usted** — Verificar matrícula: ¿alcanza con mirar el archivo, o hay que comprobar contra el registro del colegio profesional? La mitad técnica está construida.

**113.** Construir la verificación según lo contestado.

**114. Usted** — Accesibilidad: el código está hecho, falta la respuesta legal. `docs/legal/argentina.md` no la menciona.

**115. Usted** — El Certificado de Aptitud impreso: ¿qué lleva? Hoy la pantalla genera el código de barras y ahí termina.

**116.** Armarlo, y agregar la subida del certificado a un depósito de archivos, creado por migración con sus políticas. Hoy sólo se guardan fechas.

---

## Datos personales

**117. Usted** — Protección de datos personales: el texto lo tiene que dar el Desarrollador. `docs/legal/argentina.md` tiene ocho secciones y ninguna es de esto. Sin documento no hay aviso.

**118.** El aviso, y qué se hace con los datos de un Servicio cerrado hace años, que hoy no se purgan nunca.

**119. Usted** — La ubicación de las personas: cuatro preguntas para el profesional legal. En los 21 archivos de `docs/legal/` no aparece ni una vez «ubicación», «GPS» ni la ley 25.326. El registro del consentimiento está construido; los textos sembrados son de relleno. **Mientras no haya respuesta, el seguimiento no se enciende con nadie real.**

**120.** Sembrar los textos reales y encender el seguimiento y el aviso de demora en el trayecto.

---

## Respaldo, continuidad y secretos

**121.** Mapa de secretos en `docs/`: qué secreto existe, para qué sirve, dónde vive y cuándo se rotó, **sin un solo valor adentro**.

**122. Usted** — El alta del gestor de contraseñas, y completar las cinco filas en blanco de `celtatech/docs/CUENTAS.md`.

**123.** Rotar clave por clave lo que corresponda, decidiéndolo de a una. Si se rota la clave secreta de Supabase, se actualiza en Railway en el mismo acto.

**124.** Copiar a R2 y a B2 los seis depósitos de archivos. Hoy el respaldo sube sólo el volcado de la base: **la base se restaura y las fotos y las prescripciones no.**

**125.** Repetir la prueba de restauración. La que existe verificó 30 tablas y hoy el esquema tiene 105.

**126.** Actualizar el runbook de correo: describe una sola casilla compartida y el producto ya manda con remitente por Prestadora.

**127.** Dirección técnica de la empresa que reemplace a `soporte@careonys.com`, y pasar los vencimientos de julio de 2027 a un calendario.

---

## Marca y dominio por Prestadora

**128. Usted** — ¿Cada Prestadora tiene dominio o subdominio propio? ¿Alcanza con nombre y logo, o también remitente y dominio? ¿Y qué ve una Familia que tiene dos Servicios de modalidades distintas?

**129.** Que la pantalla de ingreso muestre la marca de la Prestadora y no la del producto.

**130.** Que la conversación quede guardada adentro del producto.

**131.** Dominio propio, si va.

---

## Módulos

**132. Usted** — ¿Dónde corre un módulo y contra qué base? Hoy `Modulos\` está vacía. De esto depende si la facturación y la cobranza salen a un módulo — la costura ya está sana — y si con eso se cierran sin construir los adaptadores de pasarela.

**133.** Sacar la facturación y la cobranza a un módulo, si corresponde.

---

## Decisiones que no traban nada empezado

**134. Usted** — Subcontratación: no existe ninguna tabla de Empresa subcontratada y el Panel no la ofrece a propósito. La precondición era no abrirla hasta que una Prestadora real lo pida. ¿Sigue valiendo?

**135. Usted** — Un tercero que sólo mira: ¿cómo entra un financiador que sólo consulta? Un cuarto rol, un Coordinador de sólo lectura desde el catálogo de permisos, o no se hace.

**136. Usted** — ¿Careonys va a atender establecimientos donde conviven Pacientes de Familias distintas — una residencia, un geriátrico? Si es más adelante, alcanza con dejarlo dicho.

**137. Usted** — ¿Diez pedidos por minuto y por persona es el número? El contador compartido hace falta el día que el motor se reparta en varios servicios; hoy corre en uno solo.

**138. Usted** — El tope de uso de IA por plan **no se puede construir como está escrito**: pide un tope por plan comercial adentro de Careonys, y eso choca con la regla de que el producto no restringe por razones comerciales. La medición sí existe. O se reescribe como tope técnico sin nombre de plan, o el tope vive en CeltaTech.

**139. Usted** — ¿Qué se corta cuando un cliente deja de pagar, siendo que lo que presta es cuidado de personas? Tres respuestas: cuánto sigue funcionando, por cuánto tiempo, y qué se corta primero para que lo sufra quien no paga y no la persona cuidada. Hoy no hay ningún interruptor de suspensión, y hasta que esto no esté contestado no se construye.

**140. Usted** — ¿Los idiomas siguen en un archivo o pasan a la base? De esto depende si sumar un idioma es una publicación o una carga de datos.

**141. Usted** — El puntaje interno de calidad del Asistente, que sólo ve el Admin: ¿sigue en pie ahora que existen las estrellas que pone la Familia? Si sigue, faltan dos respuestas: qué lo compone, y la garantía de que ninguna acción automática dependa de él. El lugar donde iría ya está hecho (`datos_reservados_asistente` y su permiso).

**142. Usted** — El alta y la baja de Prestadoras: el Marketplace expone una puerta firmada para que CeltaTech dé de alta y de baja clientes; Careonys no tiene nada parecido. ¿Se construye la misma, o se siguen dando de alta a mano?

**143. Usted** — El acompañamiento online: ¿prestación más, o guardia sin domicilio? Si es guardia, hay que decidir qué reemplaza al fichaje por ubicación.

**144. Usted** — El «Gestor del cuidado»: ¿rol nuevo, variante de Coordinador, o entrada en el catálogo de permisos por Prestadora? La tercera no rompe la regla de los tres roles de Panel; las dos primeras sí. Hoy el Coordinador se asigna por guardia, no por Familia.

**145. Usted** — Cursos para familias: ¿va o no va? Si es contenido pago, el precio y el paquete son de CeltaTech y no entran acá.

**146. Usted** — La regla de los archivos dice «nunca público» y hay un depósito público construido (`marca-prestadoras`); los otros cinco son privados. ¿La regla admite la excepción, o se cierra el depósito?

---

## El sitio web

**147. Usted** — ¿Se autoriza construir `careonys.com` según `docs/PRD_01_Sitio_Web.md`? El PRD ya está entero. Hoy `sitio-web/` es una página que dice «En construcción».

**148.** Construirlo.

---

## Cierre

**149.** Entrar con huella o cara en las dos aplicaciones. Hoy no hay una sola línea de eso en ninguna carpeta.

**150. Usted** — El documento de roles generado desde la base: ¿para quién es, interno de CeltaTech o manual para la Prestadora?

**151.** Generarlo.

**152.** Actualizar `docs/CONTEXT.md`. Hoy dice cuatro cosas que ya no son ciertas: que el Módulo 6 no tiene rutas ni pantallas, que el correo sale de una sola cuenta compartida, que no hay forma de que la Prestadora le cobre a las Familias, y su mapa de módulos describe un producto mucho más chico que el real.

**153.** Borrar la sección 9 de `celtatech/docs/SUGERENCIAS_DESDE_EL_MARKETPLACE.md`: describe un riesgo que ya no existe.

**154.** Correr las pruebas y publicar.

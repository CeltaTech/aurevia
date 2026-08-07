# Qué es un Servicio

> **Estado:** propuesta escrita por Claude Code el 2026-08-07, a pedido del Desarrollador
> (tarea 90: *"lo defino yo, el Desarrollador corrige si está mal"*).
> Mientras no haya corrección, esta es la definición vigente y sobre ella se construye
> la pantalla de Servicios (pendiente #116).

## La definición, en una línea

**Un Servicio es el arreglo entre la Prestadora y una Familia: a quién se cuida, qué se
le hace, cuándo, por cuánto y desde cuándo hasta cuándo.**

Es lo que la Prestadora **vende**. Todo lo demás cuelga de acá: las Guardias son las
partes en que se corta ese arreglo para poder cubrirlo, y la factura es ese mismo arreglo
mirado desde el dinero.

Sale de cómo lo describió el Desarrollador el 2026-08-03 (`docs/PENDIENTES.md:17`,
pendiente #116): *"la Prestadora le vende a la Familia un Servicio, el Servicio se parte
en Guardias, cada Guardia la cubre un Asistente, se le cobra a la Familia y se le paga al
Asistente"*.

## Las seis partes de un Servicio

| Parte | Qué contesta | Ejemplo |
|---|---|---|
| **A quién** | uno o más Pacientes de esa Familia | Doña Rosa; o Doña Rosa **y** Don Aníbal, que viven juntos |
| **Qué** | el tipo tomado de la Lista de Precios, más los detalles del arreglo | "Acompañamiento — 12 horas", con feriados incluidos y traslados no |
| **Cuándo** | los días y las horas, que es lo que después genera las Guardias | lunes a viernes, de 8 a 20 |
| **Por cuánto** | el precio acordado, con su descuento, congelado el día que se acordó | $X por guardia, 10 % menos, y el precio de lista de ese día guardado aparte |
| **Desde y hasta** | vigente o dado de baja, y el motivo de la baja | vigente desde el 1 de marzo; cerrado el 20 de julio por internación |
| **Por qué canal** | prestación directa, marketplace o subcontratación | directa |

## Qué **no** es un Servicio

Esto importa tanto como lo de arriba, porque son las cuatro confusiones que ya aparecieron
en el código:

- **No es una Guardia.** Una Guardia es *un turno* de un Servicio. El Servicio dura meses;
  la Guardia dura ocho horas.
- **No es un renglón de la Lista de Precios.** La Lista de Precios es el catálogo, lo que
  la Prestadora *ofrece*. El Servicio es lo que efectivamente le *vendió* a una Familia
  concreta, con su precio ya acordado.
- **No es la historia clínica del Paciente.** El Paciente puede tener varios Servicios a lo
  largo del tiempo; su historia es una sola y no se cierra cuando se cierra un Servicio.
- **No es una Solicitud.** La Solicitud es el pedido de alguien que todavía no contrató. Si
  prospera se convierte en un Servicio; si no, se queda en Solicitud.

## Cinco decisiones que tomo yo (y que se corrigen si están mal)

Son los puntos donde la descripción del negocio no alcanzaba para escribir código y hubo
que elegir. Están separados a propósito, para que se puedan discutir de a uno.

**D1 · Un Servicio es de una Familia y puede cubrir a más de un Paciente.**
Es la única forma de que entre el caso del matrimonio bajo el mismo techo, donde se cobra
menos del doble. Si el precio colgara del Paciente, ese "menos del doble" no tendría dónde
vivir. Respaldo: respuesta del Desarrollador del 2026-08-01 en el pendiente #94
(`docs/PENDIENTES.md:39`) — *"pueden manejarse como servicios individuales o como un
servicio unificado"*.

**D2 · Una Familia puede tener varios Servicios al mismo tiempo.**
Consecuencia directa de D1: si la madre y el padre están en arreglos distintos, son dos
Servicios; si están en el mismo arreglo, es uno solo con dos Pacientes. Quien carga elige,
el producto no impone.

**D3 · El precio cuelga del Servicio, no del Paciente.**
Hoy cuelga del Paciente (tabla `prestaciones`). Es el origen del problema de D1.

**D4 · El calendario cuelga del Servicio, y las Guardias se generan desde ahí.**
Hoy el calendario cuelga del Paciente (tabla `series_guardias`) y las Guardias también
(`guardias.paciente_id`). Al mudarlo al Servicio, una sola carga genera las Guardias de
todos sus Pacientes, que es lo que resuelve el hueco clínico del pendiente #94.

**D5 · Cerrar un Servicio no es cerrar a un Paciente.**
Hoy el cierre cuelga del Paciente (tabla `cierres_servicio_paciente`). Un Paciente que
termina un Servicio y arranca otro tres meses después no tiene que quedar "cerrado" en el
medio.

## Cómo se compara con lo que hay hoy en la base

Lo importante: **el Servicio ya existe en el producto, solo que repartido en cuatro tablas
y colgado del Paciente en vez del arreglo.** Comprobado contra la base el 2026-08-07.

| Parte del Servicio | Dónde vive hoy | Colgado de |
|---|---|---|
| A quién | `guardias.paciente_id` | el Paciente |
| Qué + Por cuánto | `prestaciones` (tipo, configuración, precio final, descuento) | el Paciente |
| Cuándo | `series_guardias` (días de la semana, horario, vigencia) | el Paciente |
| Hasta cuándo | `cierres_servicio_paciente` (motivo del cierre) | el Paciente |
| Agrupamiento suelto | `paquetes_prestaciones` (junta varias prestaciones bajo un nombre y un precio) | el Paciente |

Y la tabla `servicios` —la que debería ser el centro— **está vacía de significado**: tiene
`prestadora_id`, `familia_id`, una `etiqueta` de texto libre y un estado. **Ninguna línea
de código la lee ni la escribe** (comprobado el 2026-08-07: cero resultados de `servicio_id`
y de `from('servicios')` en `backend/src`, `panel/src`, `pwa-familias/src` y
`pwa-asistentes/src`). Las tres tablas que la referencian —`guardias`, `prestaciones` y
`facturas_familia_items`— tienen su `servicio_id` opcional y siempre vacío.

O sea que no hay que inventar el Servicio: hay que **darle contenido a una tabla que ya está
puesta y conectada**, y mudarle las cuatro piezas de arriba.

## Qué queda abierto

- **La mudanza en sí no es esta tarea.** Mover el precio y el calendario del Paciente al
  Servicio toca facturación y generación de Guardias; se hace con su propio plan, no de
  costado. Lo que sí se construye ahora es la pantalla que muestra el Servicio como el
  centro del negocio (pendiente #116).
- **`paquetes_prestaciones` se superpone con el Servicio.** Junta varias prestaciones de un
  Paciente bajo un nombre y un precio único, que es casi lo mismo que hace un Servicio.
  Cuando el Servicio tenga el precio (D3), hay que decidir si el paquete sigue teniendo
  sentido o se absorbe.
- **El pendiente #94 se resuelve solo si D1 y D4 se construyen.** Mientras el calendario
  cuelgue del Paciente, el domicilio compartido sigue dependiendo de que la Coordinadora se
  acuerde de cargar una Guardia por cada uno.

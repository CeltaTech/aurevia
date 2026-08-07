# Qué es un Servicio

> **Estado:** escrito por Claude Code el 2026-08-07 y corregido por el Desarrollador ese
> mismo día, en cinco pasadas. Sobre esta versión se construye la pantalla de Servicios
> (pendiente #116). Lo que sigue abierto está al final, en su propia sección.

## La definición

**Un Servicio es el paquete de prestaciones que la Prestadora le brinda a quien lo
contrata — una Familia, o un contratante de otro tipo como una Obra Social.**

Es lo que la Prestadora **vende**. Todo lo demás cuelga de acá: las Guardias son la forma
de cubrir *algunas* de esas prestaciones, y la factura es el mismo paquete mirado desde el
dinero.

Palabras del Desarrollador, 2026-08-07: *"un servicio es el paquete de prestaciones que se
le brinda a una familia u otro tipo de cliente como puede ser una obra social"*.

## Un Servicio es una canasta, no una sola cosa

Esta es la parte que más fácil se malentiende. Un mismo Servicio puede llevar adentro, a la
vez:

- guardias de Asistentes cuidadoras, para **uno o varios Pacientes**;
- prestaciones de enfermería;
- prestaciones de kinesiología;
- traslados;
- limpieza del hogar;
- lo que se acuerde.

Palabras del Desarrollador, 2026-08-07: *"puede incluir otros items como por ejemplo
traslados, etc. ... pueden ser guardias de asistentes cuidadoras, combinado con
prestaciones de enfermería, kinesiología, etc. puede incluir prestaciones de limpieza del
hogar, lo que se acuerde"*.

De ahí salen dos consecuencias que hay que tener presentes al construir:

1. **No toda prestación se convierte en una Guardia.** Las de cuidado por turnos sí, y son
   las que aparecen en la grilla de Cobertura. Un traslado o una limpieza no son una
   Guardia: son una prestación que se hace y se cobra.
2. **El calendario no es del Servicio: es de cada prestación.** El cuidado puede ser lunes
   a viernes de 8 a 20, la kinesiología martes y jueves, y el traslado un día puntual. Son
   tres calendarios distintos dentro del mismo Servicio.

## Un Servicio cambia mientras está vivo

El paquete no queda congelado el día que se acuerda. Palabras del Desarrollador, 2026-08-07:
*"puede darse de baja, puede cambiar de modalidad, las guardias se pueden alterar, etc.
puede finalizar alguna prestación o puede comenzar otra en cualquier momento cronológico del
servicio"*.

O sea que **cada prestación tiene su propia vida adentro de la vida del Servicio**: arranca
cuando arranca, termina cuando termina, y en el medio puede cambiar. El Servicio sigue
abierto igual.

Ejemplo de un mismo Servicio a lo largo de cinco meses:

| | Marzo | Abril | Mayo | Junio | Julio |
|---|---|---|---|---|---|
| Cuidado 12 h | ▓▓▓ | ▓▓▓ | | | |
| Cuidado 24 h | | | ▓▓▓ | ▓▓▓ | ▓▓▓ |
| Kinesiología | | ▓▓▓ | ▓▓▓ | | |
| Limpieza del hogar | ▓▓▓ | ▓▓▓ | ▓▓▓ | ▓▓▓ | ▓▓▓ |

Un solo Servicio, abierto de marzo a julio, con cuatro prestaciones que empiezan y terminan
en momentos distintos. **Eso tiene una consecuencia dura para la facturación:** el Servicio
no tiene "un precio". Tiene el precio de lo que estaba vigente en cada período. Para
facturar mayo hay que saber qué había vigente en mayo — y por eso la baja de una prestación
no puede ser solo un cambio de estado (ver D6).

## Cada prestación lleva cinco cosas

| | Qué dice | Ejemplo |
|---|---|---|
| **Qué es** | el tipo, tomado de la Lista de Precios | kinesiología |
| **Para quién** | uno o varios Pacientes del Servicio | Don Aníbal |
| **Su alcance** | **dos listas separadas: qué incluye y qué no incluye** | incluye la sesión y el informe; **no** incluye el traslado del Paciente |
| **Cómo se entrega** | por guardia, o por vez | dos veces por semana |
| **Cuánto sale** | el precio acordado, con su descuento, congelado el día del acuerdo | $X la sesión |

**Por qué el alcance va en dos listas y no en un párrafo.** Es un pedido expreso del
Desarrollador: *"cada prestación ha de estar bien detallada en sus alcances para que no
haya confusiones"*. Y no es una forma nueva: es exactamente la misma que el producto ya usa
para las Tareas de cada tipo de Asistente (`CLAUDE.md` §4). Ahí la segunda lista existe
justamente porque es la que evita la confusión con las Familias — la que dice *"esto no lo
hace"*. Acá cumple la misma función.

## Qué **no** es un Servicio

Son las cuatro confusiones que ya aparecieron en el código:

- **No es una Guardia.** Una Guardia es la forma de cubrir *un turno* de *una* de las
  prestaciones del Servicio. El Servicio dura meses; la Guardia dura ocho horas.
- **No es un renglón de la Lista de Precios.** La Lista de Precios es el catálogo, lo que
  la Prestadora *ofrece*. El Servicio es lo que efectivamente le *vendió* a alguien
  concreto, con su precio ya acordado.
- **No es la historia clínica del Paciente.** Un Paciente puede pasar por varios Servicios
  a lo largo del tiempo; su historia es una sola y no se cierra cuando se cierra un
  Servicio.
- **No es una Solicitud.** La Solicitud es el pedido de alguien que todavía no contrató. Si
  prospera se convierte en un Servicio; si no, se queda en Solicitud.

## Cerrar un Servicio

**Cerrar un Servicio es la finalización definitiva del mismo.** Se deja de prestar y se
deja de cobrar. No se borra nada: lo que pasó queda en la historia.

**En la jerga del rubro se dice "levantar el servicio"**, y se usa sobre todo cuando la
decisión de terminar la toma **la Prestadora** — porque dejó de poder atender a esa Familia
o a ese contratante, por el motivo que sea.

Al cerrarse, pasan cinco cosas (el producto ya hace las cinco hoy, en
`panel/src/pages/familias/PrestacionesPaciente.jsx:200`):

1. queda registrado **quién cerró, cuándo y por qué**;
2. se dan de baja **todas las prestaciones vigentes** y sus paquetes;
3. se cancelan **las series de guardias activas**;
4. se cancelan **las guardias ya programadas**, marcando que canceló la Prestadora;
5. se anota **qué Asistentes se quedaron sin ese trabajo**, para avisarles — de ahí sale
   después el aviso automático de cese (`backend/src/utils/avisoAutomaticoCese.js`).

El paso 5 es la razón de fondo por la que el cierre existe como acto registrado y no como
un simple cambio de estado: **cerrar un Servicio le saca trabajo a alguien**, y eso tiene
consecuencias laborales que hay que poder reconstruir después.

## Seis decisiones de diseño

Son los puntos donde la descripción del negocio no alcanzaba para escribir código y hubo
que elegir. Están separados a propósito, para poder discutirlos de a uno.

**D1 · Un Servicio es de quien lo contrata, y puede cubrir a más de un Paciente.**
Quien contrata puede ser una Familia o un contratante de otro tipo, como una Obra Social. Y
un mismo Servicio puede cubrir a varios Pacientes — es la única forma de que entre el caso
del matrimonio bajo el mismo techo, donde se cobra menos del doble. Si el precio colgara del
Paciente, ese "menos del doble" no tendría dónde vivir. Respaldo: respuesta del Desarrollador
del 2026-08-01 en el pendiente #94 (`docs/PENDIENTES.md:39`) — *"pueden manejarse como
servicios individuales o como un servicio unificado"*.

**D2 · Quien contrata y a quién se cuida son dos preguntas distintas.**
Cuando contrata una Familia suelen coincidir. Cuando contrata una Obra Social no: los
Pacientes son los afiliados que ella deriva, no "su familia". Hoy están pegadas.

**D3 · Un mismo contratante puede tener varios Servicios a la vez.**
Si la madre y el padre están en arreglos distintos, son dos Servicios; si están en el mismo
arreglo, es uno solo con dos Pacientes. Quien carga elige, el producto no impone.

**D4 · El precio cuelga de la prestación, y la prestación del Servicio — nunca del Paciente.**
Hoy cuelga del Paciente (tabla `prestaciones`). Es el origen del problema de D1.

**D5 · Cerrar un Servicio no es cerrar a un Paciente.**
Hoy sí lo es, y trae tres problemas comprobados el 2026-08-07:
- el cierre se guarda con `paciente_id`, así que no hay forma de cerrar un arreglo y dejar
  otro abierto para la misma persona;
- **una vez cerrado, queda cerrado para siempre**: la pantalla pregunta si *existe alguna*
  fila de cierre para ese Paciente (`PrestacionesPaciente.jsx:83`), de modo que si alguien
  suspende en marzo y vuelve a contratar en julio, la ficha lo sigue mostrando como cerrado
  y no hay "reabrir";
- los motivos permitidos son motivos de Paciente (`fin_demanda`, `fallecimiento`, `otro`).
  "La Obra Social no renovó el convenio" o "la Familia se pasó a otra Prestadora" no entran
  en ninguno, y son de las formas más comunes de que termine un arreglo.

**D6 · Una prestación no se edita ni se apaga: se cierra un período y se abre otro.**
Consecuencia directa de que el Servicio cambie mientras está vivo. Si el cuidado pasa de 12
a 24 horas en mayo, no se puede pisar el renglón viejo: marzo y abril ya se facturaron al
precio de 12 horas, y esa cuenta tiene que seguir siendo reconstruible. Entonces cada
prestación necesita **desde cuándo y hasta cuándo estuvo vigente**, y cambiarla es cerrar la
que estaba y abrir la nueva.

Hoy no se puede: `prestaciones` tiene `estado` (vigente / de_baja) y nada más — ni
`vigente_desde` ni `vigente_hasta` (comprobado el 2026-08-07). Cuando se da de baja, se
pierde **cuándo** dejó de estar vigente, y `updated_at` no sirve porque lo pisa cualquier
edición posterior. Con eso, una prestación que terminó el 3 y otra que terminó el 28 se ven
exactamente igual, y el mes se factura mal.

## Cómo se compara con lo que hay hoy en la base

Lo importante: **el Servicio ya existe en el producto, solo que repartido en cinco tablas y
colgado del Paciente en vez del arreglo.** Comprobado contra la base el 2026-08-07.

| Parte del Servicio | Dónde vive hoy | Colgado de |
|---|---|---|
| A quién se cuida | `guardias.paciente_id` | el Paciente |
| Qué se presta + cuánto sale | `prestaciones` (tipo, configuración, precio final, descuento) | el Paciente |
| Cuándo | `series_guardias` (días de la semana, horario, vigencia) | el Paciente |
| Hasta cuándo | `cierres_servicio_paciente` (motivo del cierre) | el Paciente |
| El paquete | `paquetes_prestaciones` (junta varias prestaciones bajo un nombre y un precio) | el Paciente |

Esa última fila es la más llamativa: **"paquete de prestaciones" es literalmente la
definición del Servicio, y ya existe como tabla** — solo que colgada del Paciente en vez de
ser el arreglo entero. Es un Servicio a medio construir. Cuando el Servicio tenga el precio
(D4), hay que decidir si el paquete se absorbe.

Y la tabla `servicios` —la que debería ser el centro— **está vacía de significado**: tiene
`prestadora_id`, `familia_id` (obligatorio, o sea que hoy **no admite** una Obra Social como
contratante), una `etiqueta` de texto libre y un estado. **Ninguna línea de código la lee ni
la escribe** (comprobado el 2026-08-07: cero resultados de `servicio_id` y de
`from('servicios')` en `backend/src`, `panel/src`, `pwa-familias/src` y
`pwa-asistentes/src`). Las tres tablas que la referencian —`guardias`, `prestaciones` y
`facturas_familia_items`— tienen su `servicio_id` opcional y siempre vacío.

O sea que no hay que inventar el Servicio: hay que **darle contenido a una tabla que ya está
puesta y conectada**, y mudarle las cinco piezas de arriba.

Tampoco existe hoy la Obra Social como entidad: es un campo de texto suelto en el Paciente
(`pacientes.obra_social`) y una pantalla de informes. Nada que pueda ser la contraparte de
un Servicio.

## Qué queda abierto

**Dos preguntas para el Desarrollador**, ninguna bloqueante para la pantalla de Servicios:

1. **La palabra para quien contrata.** Hace falta una que cubra a la Familia y a la Obra
   Social por igual. "Cliente" no se puede usar: `CLAUDE.md` §4 la reserva para la mirada de
   CeltaTech sobre las empresas que le contratan un producto, y la prohíbe adentro de
   Careonys. La propuesta es **Contratante**, que pasa las cinco preguntas de §4. Sin
   confirmar.
2. **Si la Obra Social como contratante entra en el MVP** o queda para después, junto con la
   modalidad de Subcontratación (pendiente #123), donde el contratante es justamente una
   Obra Social. Cambia el tamaño del trabajo: si entra, hay que construir la Obra Social
   como entidad de verdad.
**Y una cosa que no es esta tarea:** la mudanza en sí. Mover el precio y el calendario del
Paciente al Servicio toca facturación y generación de Guardias; se hace con su propio plan,
no de costado. Lo que se construye ahora es la pantalla que muestra el Servicio como el
centro del negocio (pendiente #116).

**El pendiente #94 se resuelve solo si D1 y D4 se construyen.** Mientras el calendario
cuelgue del Paciente, el domicilio compartido sigue dependiendo de que la Coordinadora se
acuerde de cargar una Guardia por cada uno.

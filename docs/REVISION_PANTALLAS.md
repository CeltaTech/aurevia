# REVISION_PANTALLAS.md — Nuestras pantallas comparadas con el software maduro del rubro

> Creado el 2026-08-02. Nace del pendiente #112: el Desarrollador avisó que hay cosas de la
> apariencia que no le gustan pero que todavía no sabe nombrar, y que eso hay que pensarlo
> mirando cómo presentan sus pantallas los competidores importantes. Esto es esa mirada.
>
> **No es una lista de funciones que falten.** Es una comparación de **cómo se muestra** lo que
> ya hacemos, contra cómo lo muestran los que llevan años en esto.

## Cómo se lee

Cada observación dice tres cosas: qué hace el software maduro, qué tenemos nosotros, y cuál es
la diferencia. Y va marcada con una de dos etiquetas:

- **ASPECTO** — es cómo se ve. Sale barato al final, porque todo pasa por el sistema de diseño
  (regla 6 de `CLAUDE.md`). Se deja para el final sin costo.
- **ACOMODO** — es dónde vive cada cosa y en qué orden aparece. Se encarece con cada pantalla
  nueva que se apoya encima. Conviene decidirlo antes.

Se contesta con un sí o un no por número. No hace falta explicar.

## Con qué se comparó

Software de gestión de cuidado domiciliario con años de mercado: AlayaCare, WellSky Personal
Care (antes ClearCare), CareSmartz360, AxisCare y ShiftCare. Las fuentes están al final.

## La observación de fondo, antes de la lista

El Panel pasó por cinco etapas de rediseño (`docs/PROGRESS.md`) y por una etapa dedicada
exclusivamente al sistema de diseño. **Las dos aplicaciones de celular no pasaron por ninguna.**

Se nota al abrir los archivos: en el Panel los estilos salen del sistema de diseño, y en las dos
aplicaciones están escritos a mano dentro de cada pantalla —`style={{ marginBottom: '1rem' }}`,
`style={{ fontSize: '0.8rem' }}`— repetidos pantalla por pantalla
(`pwa-asistentes/src/pages/GuardiaActiva.jsx:146`, `pwa-asistentes/src/pages/ReporteDiario.jsx:197`,
`pwa-familias/src/pages/Reportes.jsx:32`).

Buena parte de "no me gusta cómo se ve" probablemente sea esto y nada más: dos aplicaciones que
nunca tuvieron su etapa de diseño. Es **aspecto**, y es exactamente el trabajo que corresponde
dejar para el final.

Hay un segundo dato de tamaño que conviene tener a la vista: la aplicación del Asistente tiene
**cuatro pantallas** y la de la Familia **diez**, contra treinta y pico del Panel. No es
necesariamente un defecto —la aplicación del cuidador tiene que ser corta—, pero explica por qué
al mirarlas se sienten flacas.

---

## Aplicación del Asistente

### 1. No existe la lista de tareas del turno · **ACOMODO**

**Ellos:** el centro de la pantalla del turno es la lista de tareas del plan de cuidados. En
AlayaCare, el cuidador **no puede cerrar el turno hasta completar todas las tareas**. En AxisCare
y CareSmartz360, lo primero que ve al abrir es "las citas del día y su lista de tareas".

**Nosotros:** la pantalla del turno (`pwa-asistentes/src/pages/GuardiaActiva.jsx:144`) muestra el
nombre del Paciente, el domicilio, las patologías y una pila de botones. No hay ninguna tarea. Lo
que se lleva puesto el lugar central es el reporte: el Asistente escribe un texto libre al final y
la IA lo ordena.

**La diferencia:** ellos guían durante el turno; nosotros preguntamos al final. Son dos filosofías
distintas, y la nuestra tiene una ventaja real (escribir suelto es más rápido que tildar treinta
casillas). Pero hay un detalle que la vuelve rara: **ya tenemos las Tareas cargadas** — el catálogo
de tipos de Asistente define qué hace y qué no hace cada tipo (tarea #85, ya terminada). Están en
la base y no se le muestran nunca a quien las tiene que hacer.

### 2. El botón que cierra la guardia se llama "Confirmar" · **ACOMODO**

**Ellos:** marcar la salida es un botón grande y con nombre propio. Es el acto que la Prestadora
factura y que la ley pide registrar.

**Nosotros:** no hay botón de salida. La salida ocurre de costado, cuando el Asistente confirma el
reporte al final de un formulario largo (`backend/src/routes/appAsistentes.js:277` marca
`checkout_at` dentro de confirmar el reporte). Hay textos de "Marcar check-out" escritos en los
tres idiomas (`pwa-asistentes/src/i18n/translations.js:54`) que **ninguna pantalla usa**: se
escribieron y quedaron colgados.

**La diferencia:** la decisión de fondo (no te vas sin dejar el reporte) es buena y es la misma
que toma AlayaCare. Lo que está mal es el nombre: el botón hace dos cosas y dice una sola. Quien
lo aprieta no sabe que está cerrando su turno.

### 3. "Mis guardias" es una lista plana · **ASPECTO**

**Ellos:** el día de hoy arriba, separado; después mañana; después el resto. Lo próximo, destacado.

**Nosotros:** todas las guardias en una sola lista corrida, sin cortes por día y sin destacar la
que viene (`pwa-asistentes/src/pages/MisGuardias.jsx:52`). Cada tarjeta dice nombre, fecha, horario
y estado.

**La diferencia:** el Asistente tiene que leer fechas para ubicarse en vez de ver de un vistazo qué
le toca ahora.

### 4. El domicilio es texto, no es un enlace al mapa · **ASPECTO**

**Ellos:** el domicilio se toca y abre el navegador del teléfono.

**Nosotros:** es texto suelto (`pwa-asistentes/src/pages/GuardiaActiva.jsx:150`), aunque **ya
guardamos las coordenadas** del Paciente y el backend se las manda a la pantalla
(`backend/src/routes/appAsistentes.js:89`).

**La diferencia:** el dato está, la posibilidad de tocarlo no. Es de las cosas más baratas de esta
lista.

### 5. El Asistente no puede ver ni aceptar las guardias que se le ofrecen · **ACOMODO**

**Ellos:** "turnos disponibles" es una pantalla propia de la aplicación del cuidador. Le llega el
aviso, entra, y acepta o rechaza.

**Nosotros:** el Panel ya sabe ofrecer una guardia a varios Asistentes con fecha límite (tarea #69,
terminada). Pero **del otro lado no hay nada**: la aplicación del Asistente no tiene ninguna
pantalla de ofertas, y el backend no tiene ningún camino para consultarlas ni para aceptarlas (las
únicas direcciones que existen son perfil, guardias, check-in, reporte, ubicación y
calificaciones — `backend/src/routes/appAsistentes.js`).

**La diferencia:** construimos la mitad que ofrece y no la mitad que recibe. Hoy la oferta se le
tiene que avisar por fuera del sistema.

### 6. La medicación está escondida detrás de un botón · **ASPECTO**

**Ellos:** el plan de cuidados se ve en el momento de cuidar, sin buscarlo.

**Nosotros:** hay que apretar "Ver órdenes de medicación" para que aparezca
(`pwa-asistentes/src/pages/GuardiaActiva.jsx:204`). Lo mismo con los reportes anteriores.

**La diferencia:** lo que hay que hacer sí o sí está a un toque de distancia de no hacerse.

### 7. Los estilos escritos a mano, pantalla por pantalla · **ASPECTO**

Ver la observación de fondo, más arriba. Es la causa más probable de la incomodidad general.

---

## Aplicación de la Familia

### 8. La Familia ve la próxima guardia, no la semana · **ACOMODO**

**Ellos:** el calendario **es** el portal de la familia. WellSky lo llama Family Room y lo describe
como el calendario de cuidados más las notas de cada visita. CareSmartz360 muestra fecha y hora de
cada visita, quién viene, y **el estado de cada una**: cumplida, cancelada, o el cuidador no se
presentó.

**Nosotros:** la pantalla del Paciente muestra la guardia activa o, si no hay ninguna, **la próxima
y nada más** (`backend/src/routes/appFamilias.js:96`). No hay agenda, ni semana, ni historial de
guardias.

**La diferencia:** la familia no puede contestar sola "¿quién viene el jueves?". Esa es, en el
rubro, la pregunta número uno por la que una familia levanta el teléfono y llama a la Prestadora.
Cada llamada de esas es tiempo de la Coordinadora.

### 9. La aplicación abre en una lista, no en el estado de hoy · **ASPECTO**

**Ellos:** abre mostrando cómo está la persona hoy.

**Nosotros:** abre en "Mis pacientes", una lista (`pwa-familias/src/App.jsx:44`). Con un solo
Paciente —que es el caso normal— eso es una lista de un elemento: un paso de más antes de ver algo
útil.

### 10. La lista de reportes no dice nada de lo que pasó · **ASPECTO**

**Ellos:** las notas de cada visita se leen de un vistazo.

**Nosotros:** cada reporte se muestra como fecha y nombre del Asistente
(`pwa-familias/src/pages/Reportes.jsx:38`). Nada de si el día estuvo bien o mal, si hubo un
incidente, ni el ánimo — datos que **el reporte ya tiene guardados**
(`pwa-asistentes/src/pages/ReporteDiario.jsx`: ánimo, incidentes, signos vitales).

**La diferencia:** para saber si hubo un problema hay que abrir los reportes de a uno.

### 11. No hay nada de dinero del lado de la Familia · **ACOMODO, pero primero es una pregunta**

**Ellos:** las facturas con su estado (pagada, impaga, pagada a medias) y un botón para pagar.
WellSky incluso deja repartir la factura entre varios hijos.

**Nosotros:** del lado de la Familia solo existe la suscripción del marketplace
(`pwa-familias/src/pages/SuscripcionMarketplace.jsx`). La facturación vive entera en el Panel.

**Esto no es necesariamente un defecto:** si en nuestro modelo el que cobra es la Obra Social y no
la Familia, entonces está bien que no esté. Es una pregunta de negocio, no de diseño, y la contesta
el Desarrollador.

---

## Panel

### 12. Acá estamos parejos con el software maduro

El Estado actual —la franja de excepciones arriba y la grilla debajo, con la misma semana vista
por Asistente o vista por Paciente (`panel/src/pages/EstadoActual.jsx:334`)— es exactamente el
patrón que usa el rubro: ver los huecos de cobertura antes de que lastimen, y poder mirar lo mismo
desde el lado del equipo o desde el lado del cliente. Los avisos al asignar (doble reserva,
disponibilidad) también los tenemos (tarea #75).

**No hay nada que cambiar acá.** Se deja escrito para que ninguna sesión futura lo "mejore" sin
motivo.

### 13. Falta el mapa de quién está adentro ahora mismo · **ya está previsto**

Es la Etapa 6, frenada esperando la respuesta legal sobre seguimiento de ubicación (pendiente
#102). No se cuenta como observación nueva.

---

## Resumen para contestar rápido

| # | Qué | Marca |
|---|---|---|
| 1 | Mostrarle al Asistente las tareas del turno | ACOMODO |
| 2 | Que el botón de salida diga que cierra el turno | ACOMODO |
| 3 | Cortar "Mis guardias" por día y destacar la próxima | ASPECTO |
| 4 | Que el domicilio abra el mapa | ASPECTO |
| 5 | Pantalla de guardias ofrecidas, para aceptar o rechazar | ACOMODO |
| 6 | Medicación a la vista, sin apretar un botón | ASPECTO |
| 7 | Sistema de diseño en las dos aplicaciones | ASPECTO |
| 8 | Agenda de la semana para la Familia | ACOMODO |
| 9 | Que la aplicación de la Familia abra en el estado de hoy | ASPECTO |
| 10 | Que la lista de reportes anticipe si el día estuvo bien | ASPECTO |
| 11 | ¿La Familia tiene que ver plata? | Pregunta de negocio |
| 12 | Panel: nada que cambiar | — |

**Cinco de acomodo** (1, 2, 5, 8, y según la respuesta, 11) y **seis de aspecto** (3, 4, 6, 7, 9,
10). Los de aspecto esperan al final sin costo. Los de acomodo conviene decidirlos antes de seguir
apilando pantallas encima.

## Fuentes

- [AlayaCare — resumen de la aplicación del cuidador](https://alayacare.com/platform/overview/mobile-app-for-real-time-access/)
- [AlayaCare — marcar entrada y salida de una visita](https://support.helpathome.com/hc/en-us/articles/8718663391639-AlayaCare-Clocking-In-and-Out-of-a-Visit)
- [AxisCare — aplicación del cuidador](https://axiscare.com/features/caregiver-mobile-app/)
- [CareSmartz360 — aplicación del cuidador](https://www.caresmartz360.com/features/caregiver-mobile-app/)
- [CareSmartz360 — portal del cliente y la familia](https://www.caresmartz360.com/features/client-family-portal/)
- [WellSky Personal Care](https://wellsky.com/personal-care-software/)
- [ShiftCare — software de gestión](https://shiftcare.com/us/solutions/home-care-software)

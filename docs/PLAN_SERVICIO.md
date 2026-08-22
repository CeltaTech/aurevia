# Plan del Servicio (`#125`) — para aprobar antes de tocar nada

> **Estado: esperando aprobación del Desarrollador.** Mientras diga esto, no se escribe ni una
> línea de código de producción ni se crea ninguna migración. Es lo que pide `CLAUDE.md` §11.
>
> Cuando el cambio esté hecho y verificado, este archivo se borra: no se archiva ni se guarda
> como historial (`CLAUDE.md` §9).

---

## 1. Qué pasa hoy, en una frase

**El Servicio ya existe adentro del producto, pero está colgado del Paciente en vez del acuerdo.**

Un Servicio es todo lo que la Prestadora acordó hacer por un Cliente: las horas de cuidado, la
enfermería, los traslados, la limpieza. Es el acuerdo entero. Hoy el producto no guarda ese
acuerdo en ningún lado: guarda los pedazos sueltos, y cada pedazo cuelga del Paciente.

- El precio cuelga del Paciente.
- El calendario cuelga del Paciente.
- El cierre cuelga del Paciente.
- Las Guardias cuelgan del Paciente.
- El paquete de horas cuelga del Paciente.

Hay una tabla que se llama `servicios` y que debería ser el centro de todo esto. Hasta el
2026-08-20 no la tocaba ninguna línea de código. Desde entonces existe la pantalla de Servicios de
solo lectura, que la muestra —y solamente la muestra: **nada la escribe.** El acuerdo se sigue
cargando desde la ficha de cada Paciente, y la pantalla lo dice con todas las letras arriba de
todo.

Mientras un Servicio tenga un solo Paciente y un solo Cliente, colgar todo del Paciente y colgarlo
del acuerdo dan el mismo resultado. Deja de darlo en cuanto hay un matrimonio en la misma casa,
en cuanto quien paga es una Obra Social, o en cuanto alguien suspende en marzo y vuelve en julio.
Esos tres casos son normales en el rubro, no rarezas.

---

## 2. Qué hay realmente en la base (comprobado, no leído de documentos)

Todo lo de esta sección se consultó contra la base local el 2026-08-22, tabla por tabla, como
pide `CLAUDE.md` §12. No sale de las migraciones ni de documentos anteriores.

### `servicios` — la tabla que solo se mira

| Columna | Tipo | Nulo |
|---|---|---|
| `id` | uuid | no |
| `prestadora_id` | uuid | no |
| `familia_id` | uuid | **no** |
| `etiqueta` | text | no |
| `estado` | text | no, por defecto `vigente` |
| `created_at` | timestamptz | no |

**No tiene moneda, no tiene fechas, no tiene tipo de contratante.** Y `familia_id` es
obligatorio: por la estructura misma de la tabla, una Obra Social no puede ser Cliente.

Filas en la base local: **3**.

### Dónde está hoy cada pedazo del acuerdo

| Pedazo | Tabla | De quién cuelga | Lo que falta |
|---|---|---|---|
| El precio | `prestaciones` | `paciente_id` obligatorio | no tiene `vigente_desde` ni `vigente_hasta` |
| El calendario | `series_guardias` | `paciente_id` obligatorio | sí tiene desde/hasta |
| El cierre | `cierres_servicio_paciente` | `paciente_id` obligatorio | no tiene `servicio_id` |
| Las Guardias | `guardias` | `paciente_id` | `servicio_id` existe, opcional |
| El paquete | `paquetes_prestaciones` | `paciente_id` obligatorio | — |

`servicio_id` aparece hoy en tres tablas, siempre opcional: `guardias`, `prestaciones` y
**`facturas_familia_items`**. Esta última no figuraba en el pendiente y aparece ahora: es la que
convierte esto en un cambio que toca la facturación, no solo el modelo de datos.

### Los cinco huecos del pendiente, uno por uno

Los cinco se volvieron a comprobar contra la base. **Los cinco siguen abiertos.**

**(a) Una Obra Social no puede ser Cliente.** `servicios.familia_id` es obligatorio. Confirmado.

**(b) Al dar de baja una prestación se pierde cuándo dejó de estar vigente.** `prestaciones` tiene
`estado` y nada más: no hay `vigente_desde` ni `vigente_hasta`. Confirmado sobre las 17 columnas
reales de la tabla. `updated_at` no sirve como reemplazo porque lo pisa cualquier edición
posterior, aunque sea un cambio de texto.

**(c) El precio y el calendario cuelgan del Paciente.** Confirmado: `prestaciones.paciente_id` y
`series_guardias.paciente_id`, los dos obligatorios. No hay dónde guardar el acuerdo del domicilio
compartido.

**(d) Una vez cerrado, cerrado para siempre.** `cierres_servicio_paciente` cuelga de
`paciente_id` y no tiene `servicio_id`. La ficha pregunta si existe *alguna* fila de cierre
(`panel/src/pages/familias/PrestacionesPaciente.jsx:83`), así que no hay forma de reabrir.

**(e) Los motivos de cierre son motivos de Paciente.** La restricción real de la base es:

```
CHECK (motivo = ANY (ARRAY['fin_demanda', 'fallecimiento', 'otro']))
```

No entra "la Obra Social no renovó" ni "se pasó a otra Prestadora". Confirmado.

### Una corrección al pendiente

El pendiente dice que `servicio_id` está *"siempre vacío"*. En la base local **las 5 prestaciones
tienen `servicio_id` cargado**, porque lo carga a mano el archivo de datos de prueba. En cualquier
base construida por la aplicación está vacío, porque **ninguna línea de código lo escribe nunca**:
ni el alta de prestaciones, ni el alta de guardias, ni el motor que las genera de noche, ni la
facturación. Conviene saber las dos cosas: que en esta computadora se ve lleno, y que en la nube
no.

---

## 2 bis. Seis cosas que el inventario encontró y que no estaban anotadas

**1. Falta el eslabón del medio.** `series_guardias` —la que dice qué días y a qué hora va alguien
a la casa— **no tiene columna de Servicio**. El motor que genera las guardias de noche copia de la
serie a la guardia; si la serie no lo tiene, la guardia no lo puede heredar. Por eso `servicio_id`
está vacío aunque la columna exista.

**2. Hacer que el Cliente pueda no ser una Familia es más caro de lo que decía el pendiente.** Hoy
hay una función de la base, más dos disparadores que la ejecutan en cada alta, que exigen que la
Familia del Paciente y la del Servicio existan y coincidan. Con `familia_id` vacío, esa función
corta con error. O sea que no alcanza con permitir el vacío en la columna: hay que reescribir esa
función y sus dos disparadores en la misma migración.

**3. Cerrar un Servicio es hoy lo que habilita a cancelar las guardias.** Dos reglas de acceso
—las que dejan al Coordinador cancelar guardias y series— conceden el permiso *porque existe una
fila de cierre de ese Paciente*. Si el cierre se muda al Servicio, esas dos reglas se reescriben
con él, en la misma migración, o el Coordinador se queda sin poder cancelar.

**4. Las tres columnas `servicio_id` apuntan al Servicio por su identificador solo.** En el resto
de la base el vínculo entre tablas lleva siempre la Prestadora adentro, justamente para que no se
pueda apuntar a una fila de otra. Estas tres no. La tabla `servicios` ya tiene lo que hace falta
para arreglarlo; es una línea por tabla, y entra en la migración.

**5. La factura no mira fechas.** Arma el total con las prestaciones que están vigentes hoy y nada
más — no hay filtro de fecha en ningún lado. Una prestación de marzo se cobra en agosto igual.
Esto es la consecuencia concreta y comprobable del hueco (b), no una hipótesis.

**6. El precio del paquete no se usa nunca.** Se puede armar un paquete de prestaciones con su
propio precio, pero la facturación no lo consulta: suma prestación por prestación. Es un defecto
aparte de este plan y no se arregla acá, pero conviene que quede anotado.

---

## 3. Un problema de seguridad que apareció al revisar esto

**Aparte del pendiente, y hay que arreglarlo igual.** Se encontró mirando las reglas de acceso de
la base, no buscándolo.

Las reglas que dicen quién puede ver qué se llaman políticas. La de `servicios` dice:

```
es_superadmin() OR (prestadora_id = current_tenant() AND …)
```

La de todas sus tablas hermanas —`prestaciones`, `series_guardias`, `paquetes_prestaciones`,
`cierres_servicio_paciente`— dice otra cosa:

```
(es_superadmin() AND prestadora_id = current_tenant()) OR …
```

La diferencia es dónde va el `OR`. En las hermanas, el Superadmin también queda encerrado en la
Prestadora de su sesión. En `servicios`, no: **el Superadmin ve y escribe los Servicios de todas
las Prestadoras a la vez.**

Se comprobó que `es_superadmin()` no mira la Prestadora: solo mira el rol y, si la Prestadora
exige doble factor, que la sesión lo tenga. Nada más.

Eso contradice la restricción dura de `CLAUDE.md` §5: *fuera de una sesión de soporte técnico,
Superadmin tiene acceso de Panel únicamente a la Organización Sandbox*. Y contradice la regla
final de §6: un error de configuración nunca debe permitir que una Prestadora acceda a
información de otra.

**Y no es teórico: está pasando hoy.** La pantalla de Servicios se construyó el 2026-08-20, está
desplegada, y pide la lista sin filtrar por Prestadora porque confía en que la base la filtre. La
dirección `/servicios` no tiene candado de rol. Entonces, hoy, un Superadmin que abre esa pantalla
**ve los Servicios de todas las Prestadoras juntos**, sin sesión de soporte técnico abierta y sin
que quede registrado como acceso a una Prestadora.

Se leen y nada más —la pantalla no escribe—, pero es un acceso cruzado real entre Prestadoras, que
es exactamente lo que §6 no deja abierto.

### Ya está arreglado

**Se arregló el 2026-08-22**, sin esperar al resto del plan, porque un agujero de aislamiento no
espera a que se apruebe un rediseño. Migración
`20260822030000_el_superadmin_no_ve_los_servicios_de_todas_las_prestadoras.sql`, aplicada en esta
computadora y en la nube.

Se comprobó midiendo, no suponiendo. Se armó en la base local una segunda Prestadora con un
Servicio propio, y se miró la lista con los ojos de cada rol, todo adentro de una transacción que
después se revirtió:

| Quién mira | Con la política vieja | Con la nueva |
|---|---|---|
| Superadmin de Sandbox | ve los 4, incluido el de la otra Prestadora, por su nombre | ve 3, ninguno ajeno |
| Admin de Sandbox | 3, ninguno ajeno | 3, ninguno ajeno |
| Familia Gómez | 1, el suyo | 1, el suyo |

De paso se corrigió el segundo defecto: la política de la Familia ahora comprueba la Prestadora y
usa la función que resuelve a qué Familia pertenece un usuario. Antes comparaba contra el usuario
mismo, así que los demás integrantes del círculo familiar no veían nada.

Hay una segunda, del mismo estilo: la política que deja a una Familia ver sus Servicios pregunta
solamente `familia_id = auth.uid()`, sin mirar la Prestadora. Mientras el Cliente sea siempre una
Familia funciona; se rompe el día que el Cliente pueda ser de otro tipo, que es justamente lo que
propone este plan.

---

## 4. Qué se propone construir

Cinco cambios en la base, más el arreglo de seguridad. En este orden.

### 4.1 El lugar del Cliente Contratante

`servicios.familia_id` obligatorio se reemplaza por dos columnas: **qué tipo de Cliente es** y
**cuál**. La Familia pasa a ser un tipo entre otros, no el único posible.

- Se hace **el lugar**, nada más. La Obra Social como entidad de verdad —con su tabla, sus
  convenios, sus padrones— **queda para después del MVP**, junto con la Subcontratación (`#123`).
  Es la decisión del 2026-08-07 y este plan no la mueve.
- Hoy la Obra Social es un campo de texto en `pacientes.obra_social`. Sigue siendo eso.
- Se hace ahora porque cambiar una columna obligatoria cuando hay tres filas cuesta nada, y
  cuando hay tres mil Prestadoras cuesta una migración con riesgo.

### 4.2 Desde cuándo y hasta cuándo vale cada prestación

Se agregan `vigente_desde` y `vigente_hasta` a `prestaciones`. Sin eso, el mes en que alguien da
de baja una prestación se cobra mal, y no hay manera de reconstruirlo después.

### 4.3 El precio, el calendario y el cierre pasan a colgar del Servicio

Es el corazón del cambio. Las cinco tablas dejan de colgar solo del Paciente y pasan a colgar del
Servicio. **El Paciente no desaparece de ninguna:** un Servicio puede cuidar a dos personas y cada
una sigue teniendo su reporte, su alerta y su ficha. Lo que cambia es de qué cuelga el dinero y el
calendario.

Tres reglas de diseño que ya estaban decididas y que la estructura tiene que permitir:

1. **El horario es de cada prestación, no del Servicio.** El cuidado puede ser de lunes a viernes,
   la kinesiología martes y jueves, y el traslado un día suelto — todo dentro del mismo acuerdo.
   El calendario no se puede guardar una sola vez para todo el Servicio.
2. **No toda prestación se convierte en Guardia.** El cuidado por horas sí y aparece en la grilla;
   un traslado o una limpieza se hacen y se cobran sin generar guardia. La pantalla tiene que
   mostrar las dos clases.
3. **Un mismo Cliente puede tener varios Servicios abiertos a la vez.** Si la madre y el padre
   están en arreglos separados, son dos Servicios. Si están en el mismo, es uno con dos Pacientes.
   Lo elige quien carga; el producto no lo impone.

Y el eslabón que falta: **la serie de guardias recibe su columna de Servicio.** Sin eso el motor
nocturno no tiene de dónde copiarlo, y las guardias siguen naciendo sin Servicio como nacen hoy.
Es la razón concreta por la que la columna existe hace meses y está siempre vacía.

### 4.4 Reabrir después de un cierre

El cierre pasa a colgar del Servicio. Quien suspende en marzo y vuelve en julio no queda marcado
como cerrado para siempre: vuelve en un Servicio nuevo, y el cerrado queda como lo que fue.

### 4.5 Motivos de cierre que cubran el fin del acuerdo

Se amplía la lista para que entren los motivos que son del acuerdo y no del Paciente: que el
financiador no renovó, que el Cliente se pasó a otra Prestadora. **La lista sale de una tabla
configurable, no de una restricción escrita en la base** — la restricción de hoy es exactamente el
tipo de valor hardcodeado que prohíbe la Regla 1.

### 4.6 El arreglo de seguridad

La política de `servicios` se reescribe con la misma forma que sus hermanas, y la de la Familia
suma la comprobación de Prestadora. Como pide la Regla 12, la condición no se copia política por
política: sale de la función SQL que ya existe.

### 4.7 La moneda (Regla 14)

Todo importe que quede colgando del Servicio lleva su moneda al lado, completada sola al insertar
con `public.moneda_de_prestadora`. Es la regla que ya rige y no se le agrega nada: **no entran tipo
de comprobante, ni punto de venta, ni impuestos, ni cotización.** Careonys no emite comprobantes
fiscales y no está previsto que lo haga.

### 4.8 El lugar del financiador (Regla 15)

No se construye. Solo se comprueba, en cada regla de acceso nueva, que un lector externo que ve
cumplimiento agregado y nada clínico pueda entrar después sin rehacer nada.

---

## 5. En qué orden, para que nada se caiga en el medio

El producto está desplegado y funcionando. No se puede parar.

### Antes que nada: cuántas filas hay que mudar

Si las tablas están casi vacías, alcanza con cambiar la estructura. Si hay prestaciones vivas
cobrándose, hay que además inventarle un Servicio a cada arreglo existente y colgarle lo que hoy
cuelga del Paciente — que es la parte que puede salir mal.

Se miró el tamaño que ocupan en la nube, sin leer ni una fila de datos de nadie:

| Tabla | Lo que ocupa |
|---|---|
| `guardias` | 88 kB — tiene volumen de verdad |
| `pacientes` | 56 kB |
| `familias` | 48 kB |
| `series_guardias` | 16 kB |
| `cierres_servicio_paciente` | 16 kB |
| `servicios` | una sola página |
| `prestaciones` | una sola página |
| `paquetes_prestaciones` | una sola página |

O sea: hay Pacientes, Familias y Guardias reales, pero **lo que hay que mudar —Servicios,
prestaciones y paquetes— entra en una página de disco cada uno**, que es a lo sumo un puñado de
filas. El traslado de datos es chico. La cuenta exacta se saca en el momento de migrar, no ahora.

1. **Se agrega lo nuevo sin sacar lo viejo.** Las columnas nuevas se agregan; las de Paciente
   quedan donde están.
2. **Se rellena.** Cada fila existente recibe su Servicio, deducido de lo que hoy la vincula al
   Paciente y a la Familia.
3. **Se verifica el relleno contra la base**, fila por fila, antes de seguir. Si no cierra, se
   frena acá.
4. **El código pasa a leer el Servicio.** Recién ahora se toca el Panel y el motor.
5. **Se saca lo viejo**, en una migración aparte y posterior, cuando ya no lo lee nadie.

Ninguna migración ya aplicada se edita (`docs/MIGRACIONES.md` §4.1). Todo va en migraciones
nuevas. Nada se pega a mano en el panel de Supabase. Todo se prueba primero contra la base local:
**la base de la nube tiene datos reales y no se usa para probar.**

---

## 6. La pantalla de solo lectura ya está hecha

El pendiente autorizaba a construir, sin esperar nada, la pantalla de Servicios de solo lectura.
**Ya está construida y desplegada, desde el 2026-08-20.** Muestra cada Servicio con su Cliente, a
cuántos Pacientes cubre, cuántas prestaciones y cuántas guardias tiene, y se entra al detalle. No
escribe nada.

O sea que de este pendiente no queda nada que se pueda hacer sin la aprobación: lo que sigue es la
migración, y la migración necesita el visto bueno.

---

## 7. Lo que este cambio NO incluye

Para que el alcance no se estire mientras se construye:

- **No** se construye la Obra Social como entidad. Solo el lugar.
- **No** se construye la Subcontratación (`#123`).
- **No** se construye el acceso del financiador (Regla 15). Solo se deja el lugar libre.
- **No** hay facturación fiscal de ninguna clase.
- **No** se renombra `aurevia` a `careonys` en ningún identificador. Esa decisión está postergada
  a propósito hasta antes de salir a vender.

---

## 8. Lo que hace falta que apruebe

Tres cosas, y ninguna necesita saber de programación:

1. **Que el precio, el calendario y el cierre pasen a colgar del acuerdo y no del Paciente.** Es
   la decisión de fondo. Todo lo demás sale de ahí.
2. **Que se haga el lugar para que el Cliente pueda no ser una Familia**, sabiendo que la Obra
   Social de verdad queda para después.
3. **Qué motivos de cierre quiere que existan**, además de los tres de hoy. Lo que se propone es:
   que el financiador no renovó, que el Cliente se pasó a otra Prestadora, y dejar la lista
   configurable para que pueda agregar los que quiera sin pedir un cambio de programa.

El arreglo de seguridad de la sección 3 se hace igual, esté o no aprobado el resto: es un agujero
de aislamiento entre Prestadoras y `CLAUDE.md` §6 no lo deja abierto.

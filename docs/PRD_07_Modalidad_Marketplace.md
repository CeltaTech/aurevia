# Modalidad Marketplace — diseño de negocio (Familia ↔ Asistente)

> Decisiones tomadas con el Desarrollador el 2026-07-24, antes de tocar código
> (`CLAUDE.md` §11: inventario/decisión → plan → aprobación → código). Este documento fija
> **qué se decidió y por qué**; la implementación (schema, UI, PWA) es un paso posterior,
> todavía no iniciado, y debe volver a pasar por el control de características de
> `CLAUDE.md` §12 antes de programarse.

## 1. Qué ya existe en el código (punto de partida)

- `asistentes.canales TEXT[]` (default `['directo','marketplace']`) — un Asistente puede
  estar en uno, otro o ambos canales a la vez (`docs/DATA_MODEL.md:222-230`, y el esquema
  vigente en `supabase/migrations/`). Pendiente de aplicar contra Supabase real (ver
  `docs/PLAN_HASTA_PRODUCCION.md`).
- `calificaciones_asistente` — estrellas de la Familia, puramente informativas; la
  Prestadora solo decide `visible_publica`, nunca edita el contenido ni dispara acción
  automática sobre el Asistente (`docs/DATA_MODEL.md:589-612`, y el esquema vigente en
  `supabase/migrations/`). Este diseño ya anticipaba correctamente el principio del §4 de
  este documento, antes de que se discutiera en detalle.

Las 3 modalidades de trabajo de una Prestadora (directa / marketplace / subcontratación) son
**combinables entre sí**, no mutuamente excluyentes — una Prestadora puede operar varias a
la vez.

> La tercera se llamó **"cooperativa"** hasta el 2026-08-07, y con ese nombre aparece más
> abajo en la propuesta cruda del §8, que se conserva textual porque es lo que el
> Desarrollador escribió ese día. El nombre cambió porque nombraba otra cosa: ver
> `docs/claude_history.md`.

## 2. Principio central: quién ejerce el control

Toda la lógica de riesgo legal de este documento se resuelve con una sola pregunta: **¿la
decisión la toma la plataforma sobre todo el sistema, o la toma la Familia sobre su propio
vínculo?**

- Si la Familia decide horario, penaliza inasistencias, o califica **a su propio
  Asistente**, está ejerciendo el rol de empleadora doméstica que ya le reconoce la Ley de
  Personal de Casas Particulares (26.844) — con o sin plataforma de por medio. La
  plataforma solo le da la herramienta, no decide por ella.
- Si la **plataforma** agrega esas decisiones entre todas las Familias y las usa para
  decidir el futuro laboral del Asistente en general (ej. excluirlo de aparecer para
  cualquier Familia, fijarle precio u horario de forma uniforme), ahí sí se parece a un
  empleador — es el mismo patrón que llevó a fallar en contra de Uber en el Reino Unido
  (Uber BV vs Aslam, 2021) y a la "Ley Rider" española.

Este principio decide, función por función, si algo es "herramienta de la Familia" (bajo
riesgo) o "decisión de la plataforma" (riesgo, ver §5).

## 3. Cómo la Prestadora le cobra a la Familia el acceso a los datos de contacto

La Familia le paga a la Prestadora. **Cada Prestadora elige de qué forma cobra** —una suscripción
que se renueva sola, un paquete con una cantidad de contactos, o una forma que arme ella— y fija
sus propios valores. El producto le da las piezas y el mecanismo; no elige por ella ni le fija
precio ni duración.

De ahí se sigue que **la política de comercialización es un dato de la Prestadora y no código**
(`celtatech/CLAUDE.md`, «nunca hardcodear»). Lo que el producto guarda son las piezas sueltas —qué
se cobra, cada cuánto, con qué período gratuito, con qué saldo de contactos, si se renueva sola— y
la forma sale de cómo se combinen: una suscripción mensual es importe + cada 1 mes + renueva sola,
y un paquete de cinco contactos es importe + una sola vez + saldo 5. Cada Prestadora arma las suyas
en `formas_de_cobro_marketplace`, y cualquier combinación que ella elija entra sin migración.

Lo que cada Familia tiene habilitado se guarda en `accesos_marketplace`: a qué forma se adhirió, con
qué importe —congelado el día del alta, para que un cambio de precio no le mueva lo pactado—, hasta
qué fecha y con cuántos contactos.

### 3.1 Lo que vale para cualquier forma

- La búsqueda, los perfiles, el chat interno y la videollamada son libres. Lo que se cobra es el
  acceso a los datos de contacto directo: teléfono, dirección, correo.
- Confirmación explícita en pantalla antes de cualquier cobro. Nunca un cobro como efecto
  colateral de otro botón.
- Medio de pago cargado desde el alta, para poder cobrar en el momento en que corresponda.
- El acceso termina por una fecha o un saldo guardados, nunca por una cuenta hecha al vuelo.

### 3.2 Lo que vale para toda forma que se renueve sola

Resguardos obligatorios, no opcionales:

- Aviso previo antes de cualquier cobro por vencimiento del período gratuito. Nunca un cobro
  silencioso.
- Baja autoservicio en un clic, sin tener que escribirle a nadie. El patrón contrario fue parte de
  la sanción de la FTC a Care.com en 2024, por USD 8,5 millones.
- Quien cancela conserva el acceso hasta el fin del período ya pagado. No hay corte inmediato.
- Si el cobro falla, período de gracia con reintentos antes de suspender el acceso. Ni corte en el
  acto ni reintentos indefinidos sin avisar.

### 3.3 Las formas que salen de esas piezas

- **Suscripción** — importe, un período, y se renueva sola. Período gratuito e importe los pone la
  Prestadora. Sin permanencia mínima: un mínimo obligatorio es contraproducente bajo defensa del
  consumidor y además debilita el argumento de canal de contacto neutral. Si la Familia intenta ver
  un dato de contacto antes de que termine el período gratuito, el cobro se activa ahí, con
  confirmación. Si no lo intenta, al terminar ese período se le pregunta si sigue o se da de baja.
  Lleva los resguardos del §3.2.
- **Paquete de contactos** — importe, sin período, y un saldo de contactos que se descuenta de a
  uno. No se renueva sola y no vence por calendario, así que no lleva los resguardos del §3.2.
- **Cualquier otra combinación** es la forma propia de esa Prestadora. Los resguardos del §3.2 le
  corresponden por la pieza que los dispara —renovarse sola—, no por cómo la haya llamado.

### 3.4 Dónde las carga

En **Panel > Formas de cobro de marketplace**, que es para esta modalidad lo que la lista de
precios es para la prestación directa. La pantalla pregunta por las piezas, no por un tipo de
forma: nombre, importe, cada cuántos y de qué, días gratis, contactos incluidos, si se renueva
sola y si se ofrece. La moneda no se pregunta —es la de la Prestadora y la completa la base—, y
las unidades de tiempo salen de `catalogo_periodos_cobro`, así que agregar una es una fila y no
un cambio de pantalla.

Verlas es de la administración; armarlas y cambiarlas, sólo del Admin de la Prestadora: cómo
cobra una Prestadora no es asunto de un rol técnico de CeltaTech. **Y no hay baja:** una forma
que ya se contrató se apaga con `ofrecida`, de modo que los accesos que la tienen siguen
apuntando a algo que existe.

### 3.5 Cómo se mueve el saldo de un paquete

**Se carga cuando entra la plata.** El paquete se paga una vez, y ése es el momento en que el
saldo existe: `registrarCobroExitoso` —el único lugar por el que pasan los tres caminos del cobro,
el aviso del proveedor, el efectivo en mano y el canje del QR— le suma al acceso los contactos que
traiga la forma.

**Suma, no pisa.** Un paquete no vence por calendario, así que lo que quedó sin abrir de una
compra anterior sigue estando; escribir el total nuevo encima sería vencerlo.

**Se gasta de a un Asistente, no de a una mirada.** Abierto el contacto de alguien, volver a
mirarlo no descuenta otro: queda anotado a quién se le abrió, y eso es lo que hace que cinco
contactos alcancen para cinco personas y no para tres miradas dos veces. La anotación vale para la
Familia entera, así que tampoco se paga dos veces por haber comprado dos paquetes.

**No abre nada un acceso que no está vigente**, aunque le haya quedado saldo, y un acceso que se
sostiene por fecha y no por saldo lo dice con sus propias palabras: comprar un paquete no es lo
que le falta.

**Y el descuento y la anotación pasan juntos, adentro de la base.** No es un detalle de
implementación: hacerlo desde afuera —leer el saldo, restarle uno, volver a escribirlo— deja que
dos ventanas abiertas a la vez descuenten una sola vez. El reparto de permisos de esas dos
funciones está en `docs/SECURITY.md`.

## 4. Qué sostiene el pago después del contacto

Conseguido el Asistente, el contacto ya no hace falta. Lo que la Familia sigue usando es la
**herramienta de control sobre su propio vínculo** —check-in y check-out, reportes diarios,
historial—, la misma que en prestación directa, pero acá la administra y la decide la Familia
sobre su propio Asistente (§2). Alrededor de eso, todo información o herramienta, nada de
intervención en el vínculo:

1. **Prioridad de acceso al plantel disponible** ante una baja — no es garantía de reemplazo;
   conseguirlo y acordar con él sigue siendo de la Familia.
2. **Historial documental acumulado** (reportes, check-in/check-out, incidentes).
3. **Vigilancia de vencimiento de documentación** del Asistente contratado (antecedentes,
   certificados).
4. ~~Canal de mediación de conflictos~~ — **descartado explícitamente**: mediar en conflictos
   horarios o de convivencia se parece a dirigir el vínculo y rompe el argumento de canal de
   contacto neutral (§2). Es una decisión de riesgo legal, no comercial.
5. **Alertas críticas** (ausencia sin aviso, caída del check-in) por notificación o WhatsApp —
   reutiliza el mecanismo ya construido para prestación directa.
6. **Contenido y recursos para cuidadores familiares.**

## 5. Riesgo legal invertido (modalidad marketplace)

En prestación directa, el riesgo es que la Prestadora controle tanto al Asistente que
parezca su empleadora (art. 23 LCT, ver `docs/legal/argentina.md`). En marketplace el
riesgo es el mismo principio aplicado al revés: que la **plataforma** (no la Familia)
ejerza ese control de forma agregada entre todas las Familias.

| Función | Riesgo | Motivo |
|---|---|---|
| Calificación por estrellas visible, como opinión de la Familia, **sin consecuencia automática decidida por la plataforma** | Bajo | Es información al consumidor, equivalente a una reseña de Google/MercadoLibre. La "autoexclusión" (nadie la elige por su nota baja) es la Familia decidiendo, no la plataforma. |
| Verificación de identidad / antecedentes penales | Bajo | Función de seguridad, no de dirección del trabajo — describir con exactitud literal qué se verificó y qué no (caso California vs. Care.com: sancionados por afirmar una verificación que no hacían). |
| Toggle de disponibilidad del Asistente (activar/desactivar) | Bajo | El Asistente decide sobre sí misma; ya reconocido en `CLAUDE.md` §3 como autonomía del Asistente en modalidad marketplace. |
| Herramientas de horario/penalización/calificación **operadas por la Familia sobre su propio Asistente** | Bajo | Es la Familia ejerciendo su rol de empleadora doméstica (Ley 26.844), no la plataforma. |
| Ranking o puntaje que la **plataforma** calcula y usa para decidir si el Asistente sigue apareciendo ante *cualquier* Familia | Alto | La plataforma decide el futuro laboral del Asistente en general — mismo hecho citado en Uber BV vs Aslam (Reino Unido, 2021). |
| Consecuencia automática atada a la nota agregada (ej. "por debajo de X estrellas dejás de aparecer") | Alto | Convierte la opinión del consumidor en una decisión algorítmica de la plataforma sobre el Asistente. |
| Precio u horario fijado por la plataforma para todas las Familias por igual | Alto | Control económico/temporal centralizado, indicio clásico de subordinación. |
| Exclusividad exigida por la plataforma | Alto | Restringe la libertad de trabajar para otros, elemento central de la autonomía real. |
| Mediación de conflictos por la plataforma | Alto (por eso se descartó, §4) | Se parece a dirigir el vínculo. |

**Mitigante de diseño a incorporar, no opcional**: derecho de **descargo** del Asistente
ante una queja/calificación negativa — los casos que fallaron en contra de plataformas no
tenían ese resguardo.

**Mecánica de la advertencia**: igual que en prestación directa (`CLAUDE.md` §3) — nunca
bloquea, solo advierte al activar una función de riesgo alto, con texto propio de
marketplace (no reutilizar el texto de prestación directa, el riesgo apunta al revés). Ver
`docs/legal/argentina.md` §"Modalidad marketplace" para la tabla de advertencias.

## 6. Geolocalización del Asistente (check-in/checkout)

Requiere **consentimiento explícito y revocable** del Asistente (no solo buena práctica:
exigido por la Ley de Protección de Datos Personales 25.326 para geolocalizar a una
persona):

- Apagado por default.
- La Familia puede ofrecerlo/pedirlo, pero el Asistente lo acepta o rechaza — no se le
  puede imponer.
- Consentimiento auditado (quién, cuándo, qué aceptó — `CLAUDE.md` §6) y revocable en
  cualquier momento, no es una aceptación permanente.
- Cualquier costo asociado se acuerda entre Familia y Asistente directamente — la
  plataforma no cobra ni intermedia ese dinero.

## 7. Alcance de las PWA en modalidad marketplace

**PWA Familia:**
- Buscar/filtrar perfiles con insignias de verificación y calificación (opinión).
- Chat interno + videollamada, sin exponer contacto directo hasta que el cobro esté activo.
- Acceso a datos de contacto sólo con el cobro activo (§3).
- Herramienta de control sobre su propio Asistente contratado (reportes, check-in/checkout
  — sujeto al consentimiento del §6).
- Incentivos de retención del §4 (prioridad de reemplazo, historial, vencimientos,
  alertas críticas, contenido educativo).
- Gestión de su propio cobro con la Prestadora: ver el estado y darse de baja en un clic (§3).
- **No incluye**: mediación de conflictos, ni campos donde la plataforma fije precio u horario.

**PWA Asistente:**
- Perfil (experiencia, certificaciones, estado de verificación).
- Toggle de disponibilidad, sin consecuencia impuesta por la plataforma.
- Aceptar/rechazar contactos libremente, sin penalización que la excluya del sistema en
  general.
- Chat interno, mismo resguardo de contacto protegido.
- Ver sus propias calificaciones, con derecho a descargo.
- Gestión de su propia documentación (identidad, antecedentes, certificados).
- Consentimiento de geolocalización (§6), activable/revocable en cualquier momento.
- **No incluye**: horario fijado por la plataforma, precio fijado por la plataforma,
  ranking global que condicione su acceso a futuras oportunidades.

## 8. Propuesta original del Desarrollador para el dashboard (sin rearmar todavía)

Antes de entrar en el detalle de marketplace (§2-7), el Desarrollador ya había dejado esta
propuesta cruda de agrupación para el dashboard de Admin_prestadora, pidiendo explícitamente
"rearma tu esquema en función de esto y dime si estoy dejando algo afuera de
consideración" — pedido que quedó sin responder porque la conversación pasó primero a la
corrección de arquitectura de 3 niveles (`ARQUITECTURA_NIVELES.md`) y luego a resolver las
4 preguntas abiertas de marketplace (§2-7 de este documento). Se deja registrada tal cual,
textual, para no perderla:

**a) Prestación directa** (la modalidad más común hoy en Argentina):
- **Familias/pacientes/clientes** (nombre comercial todavía por definir) — todo lo
  referente a captación y configuración de la Familia, más los planes que contrató y los
  acuerdos de aceptación de esos planes. Distinguir si el servicio es contratado en forma
  directa o es derivación de obra social u otro sistema todavía no considerado.
- **Asistentes** — todo lo referente a la gestión de los Asistentes.
- **Facturación, pagos y cobranzas**.
- **Administración de servicios** (Guardias, etc.).

**b) Marketplace** (similar a cuidarlos.com):
- Las Familias tratan a través del sistema la contratación de Asistentes, con todo el
  soporte y coberturas adicionales que se ofrezcan.
- Los Asistentes comparten con la modalidad directa todo lo referente a reclutamiento,
  calificación y capacitación — un solo plantel, un solo proceso de verificación (ya
  confirmado como infraestructura común a ambos modelos en `docs/PLAN_HASTA_PRODUCCION.md`) —
  pudiendo ofrecerse a ambas partes el uso de PWA adaptadas a ese uso limitado, excluyendo
  toda implicancia de la Prestadora en el vínculo contractual entre ambas partes.

**c) Cooperativas**: mostrar las herramientas necesarias para administrarlas dentro de lo
ya hablado (sin mayor detalle todavía — ver también, en `docs/PLAN_HASTA_PRODUCCION.md`, la
Cooperativa como tercera modalidad de vínculo, dentro de «Configuración que todavía está escrita
en el código»; post-MVP).

**Todavía pendiente**: el "rearme del esquema" en sí (cómo quedan agrupados estos bloques
en la UI del dashboard, qué falta considerar) — es el próximo paso de diseño antes de tocar
código, ahora que las 4 preguntas de marketplace (§2-7) y la separación de niveles ya están
resueltas y no van a hacer cambiar la respuesta.

## 9. Qué falta antes de escribir código

> Revisado contra la base y el código el 2026-08-19. De los cuatro puntos que este apartado
> listaba, tres ya estaban construidos y solo seguían escritos acá.

- **La columna `asistentes.canales` existe pero no la lee nadie.** Está creada en la base,
  con su regla (`directo`, `marketplace`, al menos uno) y su valor de arranque, y ninguna
  pantalla ni ruta del motor la consulta: hoy nada impide ofrecerle una guardia de
  marketplace a un Asistente que solo trabaja en prestación directa. Tiene fila propia,
  la `#154`, en `docs/PLAN_HASTA_PRODUCCION.md`.
- **Rediseño del dashboard de Admin_prestadora** en "grupos fundamentales" por modalidad —
  este documento alimenta ese rediseño, todavía no iniciado.

Ya no está pendiente lo demás que este apartado daba por hacer: la columna `canales` está
aplicada contra la base real, y las advertencias de marketplace están escritas en
`docs/legal/argentina.md`, que lleva su propia nota de revisión pendiente por un abogado
laboralista — no hace falta repetirla acá.

El cobro de la Familia tiene su modelo de datos y su motor construidos —período de prueba y
próxima fecha, historial de cobros, credenciales de pasarela por Prestadora y avisos entrantes de
seis proveedores de pago—. Lo que falta son los resguardos del §3: la baja en un clic, el corte
diferido, el aviso previo al primer cobro y el período de gracia con reintentos. Están en
`docs/PLAN_HASTA_PRODUCCION.md`, sección «El dinero».

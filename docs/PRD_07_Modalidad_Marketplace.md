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
  `docs/PENDIENTES.md` #13).
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
> `docs/PENDIENTES.md` pendiente #115 y `docs/claude_history.md`.

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

## 3. Modelo de suscripción — Familia

- **Período gratuito**: 30 días, con acceso a búsqueda, perfiles, chat interno y
  videollamada — sin acceso a datos de contacto directo (teléfono, dirección, email).
- **Activación de la suscripción**: si la Familia intenta acceder a datos de contacto
  **antes** de cumplirse los 30 días, la suscripción se activa de inmediato (con
  confirmación explícita en pantalla antes de cobrar — nunca un cobro como efecto
  colateral oculto de otro botón). Si no lo hizo, al día 30 se le pregunta si quiere
  suscribirse o darse de baja.
- **Medio de pago**: tarjeta cargada desde el alta, para poder activar el cobro en el
  momento en que corresponda (dentro del trial o al día 30).
- **Renovación**: automática, mes a mes, hasta que la Familia cancela — sin plazo mínimo de
  permanencia forzoso (un mínimo obligatorio es contraproducente bajo defensa del
  consumidor en suscripciones de renovación automática, y además debilita el argumento de
  "canal de contacto neutral").
- **Resguardos obligatorios de este esquema** (estándar de la industria, no opcionales):
  - Aviso previo (ej. día 25) antes de cualquier cobro por vencimiento del trial — nunca
    cobro silencioso.
  - Baja autoservicio en un clic, sin necesidad de contactar soporte (el patrón contrario
    fue parte de la sanción de la FTC a Care.com en 2024, USD 8,5M).
  - Si cancela, mantiene acceso hasta el fin del período ya pagado — no corte inmediato.
  - Si el cobro falla, período de gracia con reintentos antes de suspender el acceso —
    nunca corte inmediato ni cobro/reintento indefinido sin aviso.
- **Cuándo termina la suscripción**: se resuelve con una fecha guardada (próximo cobro),
  igual patrón que `planes.vigente_desde`/`vigente_hasta` — nunca calculada al vuelo.

## 4. Qué vende la suscripción (más allá del contacto)

El acceso a datos de contacto por sí solo no sostiene el pago mes a mes (una vez conseguido
el Asistente, no hay motivo para seguir pagando). El valor recurrente es el **uso de la PWA
de control sobre su propio Asistente ya contratado** (check-in/checkout, reportes diarios,
historial) — la misma herramienta que en prestación directa, pero acá la administra y
decide la Familia sobre su propio vínculo (§2).

Incentivos adicionales de retención, todos de información/herramienta, ninguno de
intervención en el vínculo:

1. **Prioridad de acceso al pool de Asistentes disponibles** ante una baja — no es garantía
   de conseguir reemplazo; conseguirlo y acordar con él sigue siendo responsabilidad de la
   Familia.
2. **Historial documental acumulado** (reportes, check-in/checkout, incidentes) — se pierde
   si cancela.
3. **Vigilancia de vencimiento de documentación** del Asistente contratado (antecedentes,
   certificados).
4. ~~Canal de mediación de conflictos~~ — **descartado explícitamente**: mediar en
   conflictos horarios/de convivencia se parece a dirigir el vínculo, rompe el argumento de
   "canal de contacto neutral" (§2).
5. **Alertas críticas** (ausencia sin aviso, caída del check-in) por push/WhatsApp —
   reutiliza el mecanismo ya construido para prestación directa (`docs/PENDIENTES.md` #82).
6. **Contenido/recursos para cuidadores familiares** — menor esfuerzo de construir primero.

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
- Chat interno + videollamada, sin exponer contacto directo hasta activarse la suscripción.
- Acceso a datos de contacto solo tras activarse la suscripción (§3).
- Herramienta de control sobre su propio Asistente contratado (reportes, check-in/checkout
  — sujeto al consentimiento del §6).
- Incentivos de retención del §4 (prioridad de reemplazo, historial, vencimientos,
  alertas críticas, contenido educativo).
- Gestión de su propia suscripción (ver estado, cancelar en un clic).
- **No incluye**: mediación de conflictos, ni campos donde la plataforma fije precio u
  horario.

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
- **Facturación, pagos y cobranzas.**
- **Administración de servicios** (Guardias, etc.).

**b) Marketplace** (similar a cuidarlos.com):
- Las Familias tratan a través del sistema la contratación de Asistentes, con todo el
  soporte y coberturas adicionales que se ofrezcan.
- Los Asistentes comparten con la modalidad directa todo lo referente a reclutamiento,
  calificación y capacitación — un solo plantel, un solo proceso de verificación (ya
  confirmado como infraestructura común a ambos modelos en `docs/PENDIENTES.md` #13) —
  pudiendo ofrecerse a ambas partes el uso de PWA adaptadas a ese uso limitado, excluyendo
  toda implicancia de la Prestadora en el vínculo contractual entre ambas partes.

**c) Cooperativas**: mostrar las herramientas necesarias para administrarlas dentro de lo
ya hablado (sin mayor detalle todavía — ver también `docs/PENDIENTES.md` #53, post-MVP).

**Todavía pendiente**: el "rearme del esquema" en sí (cómo quedan agrupados estos bloques
en la UI del dashboard, qué falta considerar) — es el próximo paso de diseño antes de tocar
código, ahora que las 4 preguntas de marketplace (§2-7) y la separación de niveles ya están
resueltas y no van a hacer cambiar la respuesta.

## 9. Pendiente antes de escribir código

- Aplicar contra Supabase real el agregado de `asistentes.canales` (`docs/PENDIENTES.md`
  #13, sigue pendiente).
- Diseñar el modelo de datos de suscripción de Familia (tabla de suscripciones, estado,
  próxima fecha de cobro, historial de cobros) — no existe todavía.
- Redactar la sección de advertencias de marketplace en `docs/legal/argentina.md` con
  texto revisado por un abogado laboralista antes de una Prestadora real en esa modalidad
  (mismo criterio que ya aplica el documento para prestación directa).
- Rediseño del dashboard de Admin_prestadora en "grupos fundamentales" por modalidad — este
  documento alimenta ese rediseño, todavía no iniciado.

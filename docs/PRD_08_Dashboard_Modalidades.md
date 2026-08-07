# Rediseño del dashboard de Admin_prestadora en grupos por modalidad — PROPUESTA

> **Aviso de nombre (2026-08-07).** Este documento fue aprobado el 2026-07-24 y se conserva
> tal como se aprobó, así que adentro la tercera modalidad todavía se llama **"cooperativa"**.
> Desde el 2026-08-07 esa modalidad se llama **Subcontratación**, y el valor guardado en la
> base es `subcontratacion`. El cambio de nombre y el porqué están en `docs/PENDIENTES.md`
> (pendiente #115) y en `docs/claude_history.md`. Donde este documento dice "cooperativa" o
> "Grupo 4 — Cooperativas", léase "Subcontratación". No se reescribe el texto aprobado porque
> es el registro de lo que se decidió ese día (`CLAUDE.md` §10).

> Estado: **PROPUESTA sin aprobar**, pendiente de revisión del Desarrollador. No se tocó
> ningún archivo de `panel/src` ni ninguna otra parte del código para escribir este
> documento (`CLAUDE.md` §11: inventario → plan → aprobación → código; este documento es el
> paso "plan").
>
> Responde al pedido abierto del Desarrollador en `docs/PRD_07_Modalidad_Marketplace.md:164-198`
> (§8 de ese documento): "rearma tu esquema en función de esto y dime si estoy dejando algo
> afuera de consideración". Ese pedido quedó registrado también en `docs/PENDIENTES.md`
> (pendiente #85) y es el origen de este documento.

## 1. Punto de partida (qué ya está decidido, no se vuelve a discutir acá)

- Las 3 modalidades de trabajo de una Prestadora — **prestación directa**, **marketplace**
  y **cooperativa** — son combinables entre sí, no mutuamente excluyentes
  (`docs/PRD_07_Modalidad_Marketplace.md:22-24`, `docs/PENDIENTES.md` pendiente #85).
- El plantel de Asistentes, el Proceso de Incorporación de Asistentes y el control de
  personal (vínculo/cese/score de riesgo/ausencias) son **infraestructura común** a
  prestación directa y marketplace — "un solo plantel, un solo proceso de verificación,
  una sola base de Asistentes certificados, sea cual sea el canal por el que después
  trabajen" (`docs/PENDIENTES.md` pendiente #13, texto literal).
- El campo técnico que ya soporta esto es `asistentes.canales TEXT[]` (default
  `['directo','marketplace']`, `docs/DATA_MODEL.md:219-227`) — un Asistente puede estar en
  uno, otro o ambos canales, y `motivo_exclusion_directo`/`motivo_exclusion_marketplace`
  registran por qué no está en uno de ellos. Pendiente de aplicar contra Supabase real
  (`docs/PENDIENTES.md` pendiente #13).
- `calificaciones_asistente` (`docs/DATA_MODEL.md:589-612`) es la calificación de la
  Familia sobre el Asistente, puramente informativa — la Prestadora solo decide
  `visible_publica`, nunca edita el contenido ni dispara acción automática.
- Cooperativas está confirmada como **post-MVP**, todavía sin motor de liquidación propio
  — `calcularCese` y el vínculo dual actual (monotributo/dependencia) no la contemplan
  (`docs/PENDIENTES.md` pendiente #53). Este documento la incluye en el esquema de
  navegación (para que el hueco no se olvide) pero no diseña su funcionalidad interna.
- Glosario obligatorio de `CLAUDE.md` §4: usar siempre "Familia", "Asistente", "Guardia",
  "Prestadora", "Vínculo/Cese" — nunca "cliente", "empleado", "turno". Este documento y la
  nomenclatura de menú que propone respetan ese glosario en todos los casos, con una
  excepción señalada explícitamente en §4 más abajo.
- Menú actual del Panel, plano, sin agrupar (`panel/src/components/layout/Layout.jsx:81-103`):
  Dashboard, Postulaciones, Solicitudes, Asistentes, Familias, Guardias, Comunicación,
  Verificación de Guardias, Facturación, Documentación, Continuidad, Lista de precios,
  Importación, Informes de obra social, Usuarios del Panel, Prestadoras (solo
  admin_plataforma/superadmin), Admin_plataforma (solo admin_plataforma), Configuración,
  Auditoría. Es el inventario real sobre el que se reorganiza — no una lista teórica.
- Ya existe un mecanismo de activación de funciones por Prestadora que resuelve el mismo
  problema de fondo ("¿qué le muestro a esta Prestadora?"): `catalogo_modulos` /
  `plan_modulos` / `prestadora_modulos`, construido para planes y add-ons
  (`docs/PENDIENTES.md` pendiente #79). CLAUDE.md §7 regla 12 exige no duplicar un patrón de
  decisión que ya tiene un punto único de verdad — ver §5 más abajo, donde se propone
  reusar ese mismo mecanismo para las modalidades en vez de construir un toggle paralelo.

## 2. Esquema rearmado — 4 grupos de navegación

La propuesta cruda original del Desarrollador (`docs/PRD_07_Modalidad_Marketplace.md:164-193`)
tenía 3 bloques (directa / marketplace / cooperativa) más una infraestructura común
mencionada al pasar dentro del bloque marketplace. El rearme más importante es **sacar esa
infraestructura común de adentro de un bloque y ponerla primera, arriba de los 3**, porque
hoy son Asistentes en un mismo plantel — meterla dentro de "marketplace" en el menú
insinuaría que es exclusiva de esa modalidad, cuando el pendiente #13 dice lo contrario.

Resultado: **4 grupos**, no 3.

### Grupo 0 — Panel de control (siempre visible, sin importar qué modalidades tenga activas)

- **Dashboard** — hoy agregado por métrica suelta (`docs/PENDIENTES.md` pendiente #83); se
  propone que la sección "Alertas y continuidad" ya existente muestre también, cuando haya
  2+ modalidades activas, un resumen mínimo por modalidad (cuántas Guardias/vínculos activos
  bajo cada una) — sin tabla nueva, derivado en vivo del mismo patrón que ya usa el
  checklist de onboarding (pendiente #80, "derivado en vivo sin tabla nueva").

### Grupo 1 — Plantel de Asistentes (infraestructura compartida, pendiente #13)

Visible siempre que **alguna** modalidad basada en Asistentes esté activa (directa o
marketplace — cooperativa también los necesita en algún momento, ver §3 pregunta 4):

- Proceso de Incorporación de Asistentes (hoy "Postulaciones" + "Solicitudes")
- Asistentes (ficha, plantel, `canales` para saber en qué modalidad participa cada uno)
- Documentación (vencimientos documentales, común a cualquier canal)
- Verificación de Guardias

**Verificado (2026-07-24), ya no es hipótesis**: se leyó el código real de ambas pantallas.
`Evv.jsx` (ruta `/verificacion-guardias`) consulta directamente `guardias` (`checkin_at`/
`checkin_lat`/`checkin_lng`/`checkout_at`/`checkout_lat`/`checkout_lng`) sin filtrar por
canal. `Continuidad.jsx` consulta `incidentes_relevo`, `alertas_tempranas_guardia` y
`notificaciones_cierre_servicio`, todas ligadas a `guardias` por `guardia_entrante_id`/
`guardia_saliente_id`/`guardia_id`, tampoco filtra por canal. El PRD_07 de marketplace
(`docs/PRD_07_Modalidad_Marketplace.md:75-92,124-160`) confirma explícitamente que
marketplace también usa check-in/checkout y geolocalización sobre el mismo concepto de
Guardia. Conclusión: ambas pantallas son infraestructura compartida real entre directa y
marketplace, no una suposición — quedan confirmadas en el Grupo 1.

### Grupo 2 — Prestación directa

Visible solo si la Prestadora tiene esta modalidad activa:

- Familias (captación, configuración, planes contratados, acuerdos de aceptación — incluida
  la distinción pendiente de si el servicio es contratado en forma directa o derivado de
  obra social, `docs/PRD_07_Modalidad_Marketplace.md:177-178`, todavía sin resolver)
- Guardias (administración de servicios — asignación por la Prestadora)
- Facturación, pagos y cobranzas
- Lista de precios
- Informes de obra social

### Grupo 3 — Marketplace

Visible solo si la Prestadora tiene esta modalidad activa. Todo lo que ya está cerrado en
`docs/PRD_07_Modalidad_Marketplace.md` necesita una pantalla en algún lado — hoy ninguna
existe en el menú actual, es la parte que más código nuevo va a requerir:

- Familias marketplace — estado de suscripción (trial/activa/vencida/cancelada, fecha
  próximo cobro — `docs/PRD_07_Modalidad_Marketplace.md:45-69`), no existe tabla todavía
  (`docs/PRD_07_Modalidad_Marketplace.md:204-205`, pendiente antes de escribir código)
- Calificaciones y descargos — vista de `calificaciones_asistente` con el derecho de
  descargo del Asistente (`docs/PRD_07_Modalidad_Marketplace.md:115-117`, mitigante "no
  opcional")
- Advertencias legales de marketplace — panel de auditoría de qué función de riesgo alto
  (`docs/legal/argentina.md:66-72`) se activó, cuándo y qué advertencia se mostró (mismo
  patrón de auditoría que ya exige `CLAUDE.md` §3 y §6)

### Grupo 4 — Cooperativas

Visible solo si la Prestadora tiene esta modalidad activa. Post-MVP
(`docs/PENDIENTES.md` pendiente #53) — se deja el espacio de menú reservado (placeholder,
sin funcionalidad interna todavía) para que el "grupo fundamental" exista en la navegación
desde el día en que se prenda el toggle, aunque hoy no tenga pantallas propias más allá de
un aviso de "en construcción".

### Transversal — no pertenece a ninguna modalidad, queda fuera de los 4 grupos

- Comunicación (canal genérico, aplica a cualquier modalidad)
- Importación (alta masiva de datos, aplica a cualquier modalidad)
- Usuarios del Panel, Configuración, Auditoría (administración de la Prestadora en sí,
  `CLAUDE.md` §5 Admin_prestadora)
- Prestadoras / Admin_plataforma (exclusivo de CeltaTech, ya separado por rol — sin cambios,
  fuera del alcance de este rediseño que es sobre la vista de **Admin_prestadora**)

## 3. Vacíos y preguntas — respuesta directa a "¿estoy dejando algo afuera?"

El Desarrollador pidió señalar explícitamente qué falta considerar. Estos son los vacíos
reales encontrados, ninguno resuelto por este documento — todos requieren una decisión
antes de programar:

1. **Resuelto (2026-07-24) — tabla propia de modalidades.** Se evaluaron dos opciones: (a)
   reusar `catalogo_modulos`/`prestadora_modulos` tratando cada modalidad como un módulo más,
   o (b) una tabla nueva dedicada solo a modalidades. Se descartó (a): la regla 12 de
   `CLAUDE.md` §7 exige que una misma **decisión** no quede resuelta en más de un lugar sin un
   punto único de verdad — no exige que conceptos distintos compartan tabla. "Modalidad de
   negocio activa" y "función/módulo activado por plan o add-on" son decisiones distintas
   (una modalidad puede requerir reglas propias, ej. no poder desactivarse si tiene
   vínculos/suscripciones activas, que un módulo normal no tiene); forzarlas en la misma
   tabla solo por parecido superficial sería mezclar dos conceptos, no evitar duplicación.
   **Decisión**: tabla nueva (ej. `prestadora_modalidades`, `modalidad
   directa|marketplace|cooperativa`, activa/inactiva), que actúa como único punto de verdad
   de esa decisión específica — consultada igual desde el menú del Panel, el backend y RLS
   donde corresponda. Diseño de columnas y migración quedan para cuando se abra el control de
   características de `CLAUDE.md` §12, no resueltos en este documento.
2. **Resuelto (2026-07-24)**: ninguna modalidad viene activada por defecto. El onboarding
   (pendiente #80) suma un paso explícito previo — "elegí con qué modalidad(es) empezás" —
   antes de mostrar el resto del checklist actual (cargar Asistente/Familia), que hoy asume
   implícitamente prestación directa y deja de ser el primer paso.
3. **El nombre comercial "Familias/pacientes/clientes"** que el Desarrollador dejó abierto
   en la propuesta cruda (`docs/PRD_07_Modalidad_Marketplace.md:176`, "nombre comercial
   todavía por definir") **entra en conflicto directo con el glosario obligatorio de
   `CLAUDE.md` §4**, que ya fija "Familia" como término único aprobado y prohíbe
   explícitamente "cliente" y "usuario" fuera de sentido técnico. Cualquier nombre
   comercial nuevo que se elija para este menú tiene que pasar primero por la verificación
   del glosario (`CLAUDE.md` §4, "antes de usar un término de negocio nuevo: verificarlo...
   si no está, proponerlo para aprobación") — este documento no propone un nombre nuevo, deja
   señalado el conflicto para que se resuelva antes de nombrar cualquier pantalla.
4. **¿Un Asistente puede participar de cooperativa además de directo/marketplace?** El
   campo `canales` hoy solo admite `'directo'`/`'marketplace'`
   (`docs/DATA_MODEL.md:226-227`, `CHECK (canales <@ ARRAY['directo','marketplace']::TEXT[])`)
   — no contempla un tercer valor `'cooperativa'`. Si cooperativa también comparte el mismo
   plantel de Asistentes (Grupo 1), ese `CHECK` constraint necesita revisión el día que se
   diseñe cooperativa en profundidad, no alcanza con agregarla a la UI del menú.
5. **Resuelto (2026-07-24)**: pantalla propia en el Grupo 3 para la Facturación de
   marketplace (suscripción mensual a la Familia), separada de "Facturación, pagos y
   cobranzas" de prestación directa (que factura servicios de cuidado) — son dos naturalezas
   de cobro distintas y no comparten pantalla.
6. **Resuelto (2026-07-24)**: Informes de obra social y Lista de precios son exclusivos de
   prestación directa — confirman ubicación en el Grupo 2. En marketplace la Familia
   contrata directo al Asistente, sin derivación de obra social ni lista de precios de la
   Prestadora de por medio.
7. ~~**Verificación de Guardias / Continuidad**~~ — **Resuelto (2026-07-24)**: se leyó el
   código real, ambas operan sobre `guardias` sin distinguir canal, y el PRD_07 confirma que
   marketplace usa el mismo mecanismo de check-in/checkout — quedan confirmadas como
   infraestructura compartida en el Grupo 1 (ver §2).
8. **Resuelto (2026-07-24)**: el Grupo 4 (Cooperativas) **no se muestra** en el menú hasta
   tener el diseño completo de esa modalidad (post-MVP, pendiente #53) — se descarta el
   placeholder reservado. Cuando se diseñe cooperativa en detalle, se suma el grupo al menú
   en ese momento.

## 4. Fuera de alcance de este documento (explícito, para no generar expectativa)

- No se diseñó el modelo de datos de "modalidad activa" (tabla nueva vs. reuso de
  `prestadora_modulos`) — es la pregunta 1 de §3, todavía abierta.
- No se diseñaron las pantallas nuevas de marketplace (suscripción, calificaciones,
  auditoría de advertencias) más allá de nombrarlas como necesarias en el Grupo 3.
- No se tocó ningún archivo de `panel/src`, `backend/src` ni ninguna migración de Supabase.
- No se definió el nombre comercial de "Familias" en contexto de marketplace (pregunta 3 de
  §3) — se mantiene "Familia" por ser el término ya aprobado del glosario, salvo que el
  Desarrollador decida abrir una excepción explícita.

## 5. Estado de este documento

**Aprobado por el Desarrollador el 2026-07-24.** Los 8 puntos de §3 quedaron todos resueltos:
tabla propia `prestadora_modalidades` como punto único de verdad de la modalidad activa (no
se reusa `catalogo_modulos`, por no ser la misma decisión — regla 12 de `CLAUDE.md` §7);
ninguna modalidad activada por defecto al alta, el onboarding suma un paso explícito de
elección; Facturación de marketplace en pantalla propia (Grupo 3), separada de la de
prestación directa; Informes de obra social y Lista de precios confirmados exclusivos de
prestación directa (Grupo 2); Verificación de Guardias/Continuidad confirmadas como
infraestructura compartida real (Grupo 1, verificado leyendo el código); Cooperativa
(Grupo 4) no se muestra en el menú hasta tener diseño completo, sin placeholder; nombre
"Familia" se mantiene sin excepción (glosario `CLAUDE.md` §4). Queda pendiente, para cuando
se diseñe cooperativa en profundidad, revisar el `CHECK` de `asistentes.canales` (punto 4).

**Próximo paso**: abrir el control de características de `CLAUDE.md` §12 (✅/⚠️/❌ por
funcionalidad) antes de escribir código de `panel/src`, `backend/src` o cualquier migración
de Supabase. Corresponde actualizar `docs/PENDIENTES.md` pendiente #85 con este resultado.

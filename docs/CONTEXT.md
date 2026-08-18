# CONTEXT.md — Contexto técnico de Careonys

> Versión de trabajo para generación de código. Condensa los documentos originales de contexto
> y prompt maestro (históricos), quitando el contenido que no afecta decisiones de código
> (mercado, competidores, marketing). Para el análisis de negocio completo, ver los
> documentos originales en la raíz del proyecto — no hace falta releerlos para programar.

## Modelo de negocio (lo mínimo que el código necesita saber)

- Familias solicitan un servicio → la prestadora asigna un Asistente Integral (empresa directa,
  fase actual) → evoluciona a marketplace (familia elige directamente) y B2B (obras
  sociales / prepagas, y coordinación de prestadoras terceras).
- Precio de referencia de lanzamiento: **nunca hardcodear** — se carga desde configuración
  (Módulo 8 del Panel Admin), no desde una constante en el código. Mientras no haya
  benchmark validado, la interfaz pública muestra "A consultar".
- Zona de cobertura inicial: CABA y GBA (norte, oeste, sur) y La Plata y alrededores —
  también configurable, no hardcodear la lista de zonas en componentes.
- **Principio de negocio (acordado en sesión, 2026-07-07): el modelo está pensado para
  operar con muy poca gente administrando.** Por lo tanto, toda tarea operativa que se
  pueda automatizar con IA sin comprometer el riesgo legal (ver `CLAUDE.md`) es deseable,
  no un extra opcional. Esto pesa a favor de priorizar antes de lo previsto algunos de los
  niveles de IA que `BUILD_ORDER.md` marca hoy como "Diferida" — a revisar caso por caso
  cuando se llegue a esa etapa, no se re-prioriza automáticamente sin evaluar cada nivel.
- **Cambio societario (2026-07-09): el software pasa a ser propiedad de CeltaTech**, que
  lo licencia como SaaS a cualquier prestadora de cuidado domiciliario. Cada prestadora
  licenciataria sigue con su propio negocio de cuidado domiciliario, y puede sumar un
  servicio B2B de auditoría/certificación a otras prestadoras. La arquitectura multi-prestadora
  exige entidad `prestadoras`, aislamiento multi-tenant, roles nuevos, facturación dual
  CeltaTech/prestadora, i18n y multi-moneda desde el arranque y residencia de datos a futuro:
  todo eso ya está implementado y verificado.
  **Estado real (verificado contra el código el 2026-07-24, no solo contra este documento):
  ya NO es mono-tenant, y los 4 Bloques del plan están cerrados.** Bloque 1 (aislamiento
  aditivo de datos: tabla `prestadoras` + `prestadora_id NOT NULL` en 15 tablas), Bloque 2
  (RLS centralizada vía `current_tenant()`/`es_superadmin()`, ~28 policies reescritas, rol
  `admin` renombrado a `admin_prestadora` en dato y código sin transición pendiente), Bloque 3
  (filtrado de tenant en rutas backend con Service Role Key) y Bloque 4 (`configuracion_prestadora`
  reemplazando la configuración singleton — confirmado en `backend/src/routes/panelConfiguracion.js:34-41`
  — y hardcodeos de marca sacados de `generarDocumentoCese.js`/`calcularCese.js`) ya están
  aplicados y verificados contra Supabase real. Desde entonces se sumó el modo "dentro de una
  Prestadora" (ver `TenantSessionContext.jsx`), que va más allá de lo que pedía el Bloque 4;
  nació con el rol comercial `admin_plataforma` y el 2026-07-28, en la Etapa 2 de la separación
  CeltaTech/Careonys, pasó a ser la **sesión de soporte técnico** de `superadmin` — el rol
  comercial se fue entero a CeltaTech y ya no existe en Careonys. **Único
  hardcodeo estructural que sigue abierto, a propósito**: el envío de emails sigue saliendo
  de una sola cuenta Gmail compartida entre todas las Prestadoras (`backend/src/utils/email.js`,
  `SMTP_USER`) — pendiente #44 en `docs/PENDIENTES.md`, con fecha de cierre exigida "antes
  de dar de alta la primera Prestadora real", no antes.

## Roles de usuario

| Rol | Dónde opera | Ve |
|---|---|---|
| Superadmin | Panel de administración (login propio, capa separada de Admin_prestadora) | Su propia Organización (Sandbox) y, abriendo una **sesión de soporte técnico**, una Prestadora real por vez con banner y auditoría. Además, acceso técnico: cambios profundos de configuración, alta/baja de cosas que no es prudente que un Admin_prestadora sin ese nivel opere, interacción con IA para diagnóstico/corrección de errores |
| Admin_prestadora | Panel de administración | Todo el negocio de su propia prestadora (sin el acceso técnico de Superadmin, cero visibilidad de otras prestadoras) |
| Coordinador | Panel de administración | Su zona asignada |
| Asistente | PWA de Asistentes | Sus propias guardias, su perfil, su certificado |
| Familia | PWA de Familias | Sus pacientes, reportes y alertas de sus pacientes |

Acordado en sesión (2026-07-07): Superadmin es un quinto rol real, con login propio,
distinto de Admin_prestadora — no un simple flag sobre el mismo usuario. Antes no estaba en
ningún PRD original; se agrega por decisión explícita de negocio (necesidad de que alguien
con más permiso técnico pueda operar sin exponer ese poder a un Admin_prestadora de negocio
"neófito").

Ningún rol de Asistente/Familia debe tener acceso, ni siquiera de solo lectura, a
`escalas_legales`, `ceses`, `ausencias` ni a datos laborales internos de otros Asistentes.

**Actualizado 2026-07-10:** el rol antes descripto acá como "Administrador de prestadora"
(futuro) ya está implementado — es el mismo rol de la tabla de arriba, renombrado de
`admin` a `admin_prestadora` (Bloque 2 del pasaje a multi-prestadora), con acceso
acotado a los datos de su propia prestadora y cero visibilidad de otras, verificado contra
Supabase real. Lo único que sigue siendo futuro, no implementado, es un rol de solo lectura
agregada para financiadores (obras sociales/prepagas) — no diseñar código para ese rol sin
que se apruebe explícitamente.

## Stack por etapa

```
Etapa 1 — La página pública de Careonys (le vende el software a empresas de cuidado)
  Estado:    no construida. Lo único que hay hoy en careonys.com es una sola página
             estática que dice "En construcción" (sitio-web/index.html + construir.mjs),
             publicada a mano a Cloudflare Pages, proyecto careonys-sitio.
  Requisito: el texto tiene que llegar ya escrito desde el servidor, para que los
             buscadores lo lean, y cada idioma con su propia dirección (/es-AR, /en,
             /pt-BR). Motivo del Desarrollador, 2026-07-08: "el seo es fundamental, si no
             nos ven no nos contactan, si no nos contactan no facturamos".
  Con qué:   sin decidir. La recomendación es estirar lo que ya hay —páginas estáticas sin
             framework— y traer una herramienta solo si el sitio crece. La decisión de
             2026-07-08 de usar Next.js quedó sin efecto junto con el documento que la
             contenía (pendiente #104). Ver docs/PRD_01_Sitio_Web.md §8.
  Datos:     ninguno. Un interesado en comprar el software es un dato de CeltaTech, no del
             producto, y esa base todavía no existe: por ahora la página ofrece correo y
             WhatsApp y no guarda nada (PRD_01_Sitio_Web.md §5).

  Lo que esta parte decía antes —Next.js, formularios de pedido de servicio y de
  postulación, MySQL, Vercel, Nodemailer— describía el sitio de una empresa de cuidados, que
  no es este producto. Se reencuadró el 2026-08-13. Nada de eso llegó a construirse. La
  decisión de que las PWA de Asistentes/Familias (Etapas 3-4) sigan en Vite no cambia: no
  necesitan que el servidor arme el texto, viven detrás de un ingreso con contraseña.

Etapa 2 — Panel de administración
  Frontend:  React 18 + Vite, proyecto separado (`panel/`) — SPA detrás de auth, nunca
             indexable (<meta name="robots" content="noindex, nofollow">), mismo motivo por
             el que Etapa 1 sí necesitaba Next.js y esto no
  Auth:      Supabase Auth (email + password, sin magic link) — rol resuelto desde tabla
             `usuarios` (extiende `auth.users`), no desde metadata de Auth
  DB:        Supabase (PostgreSQL + RLS) — mismo proyecto ya creado en Etapa 1, sin migración.
             El panel lee/escribe directo con la anon key; RLS (no el backend) es el único
             límite de autorización sobre los datos
  Backend:   el Express de Etapa 1 gana un uso nuevo, acotado: acciones puntuales que el
             panel no puede hacer solo con RLS (ej. envío de email al cambiar estado de una
             postulación) van por `POST /api/panel/*`, protegidas con un middleware que
             valida el JWT de Supabase Auth contra `usuarios.rol`
  Nota: el sitio público sigue en Express como capa de validación/envío de email, pero
  ambos (sitio y panel) leen/escriben la misma base Supabase.

  Estado (2026-07-08): Módulo 1 (Dashboard), Módulo 2 (Postulaciones), Módulo 3 (Solicitudes
  de Servicio) y Módulo 4 (Plantel de Asistentes) + `PRD_02B_Gestion_Personal.md` completo
  (vínculo dual monotributo/dependencia, motor `calcularCese` con las 13 causales, Simulador
  de Vínculo, Score de Riesgo de reclasificación, Ausencias y Cobertura) construidos en
  código y con su esquema ya aplicado y verificado (RLS activa y probada) contra la base
  Supabase real. El esquema vigente vive en `supabase/migrations/`.

  Módulo 5 (Familias y Pacientes) completo: se resolvió un gap arquitectónico compartido
  con Asistentes (ninguna de las dos tablas puede poblarse sin una cuenta real de Supabase
  Auth previa) construyendo un mecanismo de creación de cuentas reutilizable
  (`backend/src/utils/cuentasPanel.js`, `POST /api/panel/cuentas/familia`), sin envío de
  invitación por email todavía (las PWA de Etapa 3/4 no existen). El esquema de las tablas
  `familias`/`pacientes` ya está aplicado y verificado contra Supabase real (ver
  `supabase/migrations/`). La pantalla propia (`panel/src/pages/Familias.jsx` +
  `familias/FamiliaDetalle.jsx`) muestra contacto y
  Pacientes; guardias activas/historial de reportes/alertas activas quedan marcadas como "no
  disponible todavía" porque dependen de datos que solo genera la PWA de Asistentes (Etapa
  3, no construida). El lado Asistente del mecanismo de cuentas (depende de una UI del Proceso
  de Incorporación de Asistentes que no existe) sigue afuera.

  Módulo 6 (Guardias), estado 2026-07-10: solo el schema de datos está construido y
  verificado contra Supabase real (8 tablas con RLS multi-tenant vía FKs compuestas —
  series_guardias, guardias, domicilios_temporales_paciente, personal_emergencia,
  incidentes_relevo, configuracion_escalada_relevo, excepciones_familiar_relevo,
  guardias_tracking_gps; el esquema vigente vive en `supabase/migrations/`).
  Todavía **no existen** rutas backend (CRUD) ni pantallas de Panel para este módulo.
  Módulo 7 queda para sesiones siguientes.

  Módulo 8 (Precios/Prestaciones), primer corte: las tablas `lista_precios`, `prestaciones`,
  `paquetes_prestaciones` y `paquete_prestacion_items` ya están aplicadas y verificadas
  contra Supabase real (ver `supabase/migrations/`). Regla de negocio central (confirmada
  con el usuario): ningún medio público habla de precios — la lista de precios es solo referencia
  interna, y cada Paciente tiene su propia Prestación con precio final ajustado a su caso.
  La Prestación guarda una foto del precio de lista al momento de armarse (no una
  referencia viva); si el precio de lista cambia después, un trigger marca las Prestaciones
  vigentes como "a revisar" para que el Coordinador decida — nunca se ajustan solas. Varias
  Prestaciones de un mismo Paciente pueden agruparse en un paquete con precio propio.
  Pantallas: `panel/src/pages/ListaPrecios.jsx` (Admin edita, Coordinador solo ve) y
  `panel/src/pages/familias/PrestacionesPaciente.jsx` (modal desde la ficha de Familia).
  Explícitamente marcado como esquema provisional, a evolucionar con el uso real — la
  política de cuánto trasladar de un aumento de precio a cada cliente queda diferida.

Etapas 3 y 4 — PWA Asistentes / PWA Familias
  Framework: React 18 + Vite + Vite PWA Plugin
  Auth:      Supabase Auth (magic link o email/password)
  DB:        Supabase (PostgreSQL + RLS + Realtime)
  Storage:   Supabase Storage (fotos de reportes, documentos)
  GPS:       navigator.geolocation API (nativo del browser)
  Cámara:    MediaDevices API (nativo del browser)
  IA Nivel 1 (reporte inteligente) y Nivel 2 (alertas): Anthropic API — Claude Sonnet
  Push:      Web Push API + Service Worker (Android) / Apple Push (iOS 16.4+)
  PDF:       jsPDF o react-pdf (Planilla 3 IOMA y Resumen Mensual)

Etapa 5 — Planillas IOMA
  Generación de PDF desde datos ya existentes en `reportes` y `guardias` — no requiere
  stack nuevo.
```

## i18n — el objeto `T`

Todo texto visible vive en un objeto centralizado `T` con tres idiomas simultáneos.
Nunca un string literal en un componente. Estructura mínima:

```js
// src/i18n/translations.js
export const T = {
  'es-AR': { guardar: 'Guardar', /* ... */ },
  'en':    { guardar: 'Save', /* ... */ },
  'pt-BR': { guardar: 'Salvar', /* ... */ },
};
```

**El lema "Cuida tus afectos" no es del producto y no va en ninguna pantalla de Careonys.**
Es el lema de la empresa de cuidados original, de cuando el proyecto era el sitio de una sola
empresa del rubro. Careonys no cuida a nadie: le vende el software a las empresas que cuidan
(`CLAUDE.md` §1), así que un lema que le habla a una familia está fuera de lugar tanto en el
producto como en `careonys.com` (ver `docs/PRD_01_Sitio_Web.md` §0). La regla de las dos
formas —"Cuida" para hablarle a quien mira, "Cuidamos" para hablar de sí misma— era de esa
empresa y se fue con ella; los archivos que citaba (`sitio-web/src/i18n/translations.js`,
`sitio-web/src/components/Footer.jsx`) nunca existieron en este repositorio.

Careonys todavía no tiene lema propio, y no hace falta inventarle uno para poder trabajar.

## Identidad visual

Ver `DESIGN_SYSTEM.md` para la paleta de colores, tipografía y convenciones de CSS.
La identidad completa es **provisional** — no invertir tiempo puliendo detalles de logo o
color de divisiones que no están activas (Junior, Pets, Bienestar, Hogar, Legal). Solo
la Prestadora Demo tiene logo y paleta relevantes hoy.

## Modelo de datos

Ver `DATA_MODEL.md` para el schema completo consolidado de todas las etapas.

## IA — prompts de sistema

Ver `AI_PROMPTS.md` para los prompts exactos de Nivel 1 (reporte inteligente) y Nivel 2
(alertas por patrones), y los contratos JSON que ambos devuelven.

## Seguridad

Ver `SECURITY.md` para autenticación, RLS y manejo de datos sensibles.

## Riesgo legal que condiciona el producto

Ver `CLAUDE.md` (raíz de `Workspace/`) — sección "El riesgo legal que condiciona el diseño". No se repite acá.

## Gap identificado, no resuelto por ningún PRD original: cobro a las familias

Ningún documento original especificó **cómo la prestadora cobra a las familias** (medio de pago,
facturación, retención de fondos). El "Modelo UPE" cubre la facturación a IOMA (obra
social) vía Planillas 3, pero no el cobro directo a familias particulares. Antes de
construir cualquier flujo de cobro, esto necesita una decisión de negocio explícita
(Mercado Pago, transferencia, ambos) — no asumir nada del documento no vinculante
"Prompt de Money Suite.md" sin validarlo con el equipo de negocio primero. Ver nota en
`SECURITY.md` y `BUILD_ORDER.md`.

## Changelog de este documento

- v1 (2026-07-07): primera versión, generada para poblar `Workspace/docs/` a partir de
  la lectura completa de la documentación del proyecto y separando lo vinculante de lo
  que no lo es.
- v2 (2026-07-09): se documenta el cambio societario CeltaTech / prestadora licenciataria y la dirección
  de multi-tenancy futura, sin implementar nada todavía.
- v3 (2026-07-10): barrido completo contra la realidad del código — Bloques 1-3 de
  multi-tenancy ya aplicados y verificados (rol `admin` renombrado a `admin_prestadora` en
  dato y código, RLS vía `current_tenant()`/`es_superadmin()`, filtrado de tenant en
  backend), solo el Bloque 4 sigue pendiente; se documenta el estado real de Módulo 6
  (Guardias): schema aplicado, sin rutas backend ni UI de Panel todavía.

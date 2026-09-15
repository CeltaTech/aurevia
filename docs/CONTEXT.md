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
  (la lista de precios del Panel), no desde una constante en el código. Mientras no haya
  benchmark validado, la interfaz pública muestra "A consultar".
- Zona de cobertura inicial: CABA y GBA (norte, oeste, sur) y La Plata y alrededores —
  también configurable, no hardcodear la lista de zonas en componentes.
- **Principio de negocio (acordado en sesión, 2026-07-07): el modelo está pensado para
  operar con muy poca gente administrando.** Por lo tanto, toda tarea operativa que se
  pueda automatizar con IA sin comprometer el riesgo legal (ver `CLAUDE.md`) es deseable,
  no un extra opcional. Esto pesa a favor de priorizar antes de lo previsto algunos de los
  niveles de IA que `PLAN_HASTA_PRODUCCION.md` marca hoy como "Diferida" — a revisar caso por caso
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
  nació con el rol comercial `admin_plataforma` y después pasó a ser la **sesión de soporte
  técnico** de `superadmin` — el rol comercial se fue entero a CeltaTech y ya no existe en
  Careonys.
  **El correo, que es lo único estructural que sigue abierto.** Railway bloquea los puertos de
  correo, así que el motor no puede entrar a ninguna casilla —ni propia ni de una Prestadora— y
  **hoy no se entrega ningún correo**. El envío ya pasa por un despachante que habla por el puerto
  443 (`backend/src/utils/email.js`); falta dar de alta la cuenta, crear la dirección de envío
  propia de cada Prestadora bajo `careonys.com` y el reenvío de las respuestas a la casilla que
  ella declare (`docs/MARCA.md`, sección 0). Se cierra con la sección «El correo» de
  `docs/PLAN_HASTA_PRODUCCION.md`, y hay que hacerlo antes de dar de alta la primera Prestadora
  real.

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
             contenía (pendiente #104). Ver docs/PRD_01_Sitio_Web.md §7.
  Datos:     ninguno. La página ofrece correo y WhatsApp y no guarda nada
             (PRD_01_Sitio_Web.md §5).

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

  Qué hay construido hoy, por área. Cada una tiene su esquema aplicado, sus rutas en
  `backend/src/routes/` y su pantalla en `panel/src/pages/`; lo que falta está en
  `docs/PLAN_HASTA_PRODUCCION.md` y no se repite acá. **El mapa de módulos numerados de los PRD
  originales ya no describe el producto**: quedó chico, y lo que manda es esta lista.

  - **Reclutamiento e incorporación** — postulaciones, entrevistas, verificación de identidad
    con las dos fotos, referencias laborales, documentación y Matrícula.
    Falta únicamente la pantalla pública del formulario de postulación.
  - **Plantel y gestión del personal** — vínculo dual monotributo/dependencia, ceses con las
    trece causales, simulador de vínculo, score de riesgo de reclasificación, ausencias y
    cobertura, liquidaciones y pagos a Asistentes.
  - **Familias, Pacientes y Servicios** — ficha, círculo familiar con qué ve cada persona,
    instrucciones que firma el titular, y el Servicio contratado con su continuidad.
  - **Guardias** — series y guardias, ofertas, cobertura, grilla, acciones masivas, guardias sin
    cerrar, pase de guardia con código de presencia, emergencias en guardia, domicilios
    temporales y seguimiento de ubicación. Tiene rutas (`panelGuardias.js`, `panelComprobaciones.js`,
    `panelEmergencias.js`) y pantallas (`panel/src/pages/Guardias.jsx`, `PaseDeGuardia.jsx`,
    `EmergenciasEnGuardia.jsx`, `panel/src/pages/guardias/`).
  - **Reportes, alertas y medicación** — el reporte diario que arma la IA, las alertas por
    patrones, los signos vitales con su autorización, y las indicaciones de medicación.
  - **El dinero** — lista de precios y prestaciones, facturación a las Familias, cobros,
    informes a obras sociales y los rieles de cobro del Marketplace.
  - **Marketplace** — vidriera, perfiles públicos, conversaciones con videollamada, formas de
    cobro que arma cada Prestadora, accesos, calificaciones y auditoría legal.
  - **Configuración y gobierno** — configuración por Prestadora y de plataforma, usuarios y
    permisos, segundo factor con su recuperación, auditoría, importación, contenidos, avisos en
    vivo y los canales de aviso (correo, WhatsApp, push).

  Sobre los precios, la regla de negocio central sigue vigente: ningún medio público habla de
  precios — la lista es referencia interna, y cada Paciente tiene su Prestación con precio final
  ajustado a su caso. La Prestación guarda una foto del precio de lista al armarse, no una
  referencia viva; si la lista cambia después, un disparador marca las Prestaciones vigentes como
  «a revisar» para que decida el Coordinador. Nunca se ajustan solas.

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

Ver `celtatech/CLAUDE.md` §7 y `celtatech/docs/REGLAS_PRODUCTOS_CAREONYS.md` §3. No se repite acá.

## Cómo la Prestadora le cobra a las Familias

Ningún documento original lo especificó: el «Modelo UPE» cubre la facturación al financiador vía
Planillas 3, pero no el cobro directo a familias particulares. Se construyó después, y hoy los dos
caminos están hechos.

**En prestación directa**, la factura del círculo familiar vive en `facturas_familia`, la maneja
`backend/src/routes/panelCobros.js`, se emite y se sigue desde `panel/src/pages/Facturacion.jsx`, y
la Familia la ve en su aplicación (`facturas()` / `factura(id)` en `pwa-familias/src/lib/api.js`).
Una factura no cuelga de ningún Paciente: se le factura al círculo entero, y un mismo comprobante
puede llevar renglones de más de una persona cuidada. Qué se cobra y cada cuánto lo decide la
Prestadora; el producto no fija precio ni período.

**En la modalidad Marketplace** (`docs/PRD_07_Modalidad_Marketplace.md`), la Familia le paga a la Prestadora por una pasarela,
y **cada Prestadora arma su propia forma de cobrar** con las piezas que el producto le da
—importe, cada cuánto, período gratuito, saldo de contactos, si se renueva sola— en
`formas_de_cobro_marketplace`. Lo que cada Familia tiene habilitado vive en
`accesos_marketplace`. El producto no elige por ella ni le fija precio ni duración: la política
de comercialización es un dato de la Prestadora, no código. El saldo de contactos de un paquete
se carga cuando entra la plata y se gasta de a un Asistente, con la cuenta hecha adentro de la
base; el detalle está en `docs/PRD_07_Modalidad_Marketplace.md` §3.5. Y una forma que se renueva
sola se da de baja en un clic desde la aplicación de la Familia: apaga la renovación y conserva
el período ya pagado hasta el final (§3.6); el acceso se apaga solo al llegar esa fecha, con un
trabajo diario del motor (§3.7). El período gratuito que cargó la Prestadora se convierte en una
fecha el día del alta —la del primer cobro—, se le informa a los rieles que cobran solos, y ese
mismo trabajo diario avisa al teléfono de quien paga unos días antes de que llegue: nunca un cobro
silencioso (§3.8). Y un cobro que no entra no apaga nada en el acto: abre un período de gracia de
siete días, se avisa una vez, cada riel reintenta mientras dura, y recién al llegar esa fecha sin
que la plata haya entrado el acceso se suspende (§3.9).

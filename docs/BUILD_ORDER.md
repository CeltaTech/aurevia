# BUILD_ORDER.md — Orden de construcción del código

> Fuente: documento único original de especificación (histórico, tabla de etapas, Parte D) + prompt maestro original (histórico).
> Cada etapa requiere la anterior funcionando en producción — no paralelizar etapas de
> código salvo que se indique lo contrario.
> **El estado de cada etapa se mantiene acá, en la columna "Estado" de la tabla de abajo.**

| Etapa | Qué se construye | Estado | Condición de entrada | Estimación | PRD de referencia |
|---|---|---|---|---|---|
| 0 | Setup: repo, estructura, variables de entorno | 🟢 Completo | — | — | `CLAUDE.md` |
| 1 | La página pública de Careonys — le vende software de gestión a empresas de cuidado, no cuidado a familias | 🔴 No iniciado — reencuadrada el 2026-08-13 (pendiente `#104`). Lo que esta fila decía antes ("6-8 páginas + formularios + backend Express/MySQL") era el sitio de una empresa de cuidados, que no es este producto; nunca se construyó. Lo único que existe hoy es una página que dice "En construcción" en `careonys.com` | Ninguna | 2-3 semanas | `PRD_01_Sitio_Web.md` |
| 2 | Panel de administración (web desktop, migra a Supabase) | 🟢 Desplegado a producción (2026-07-08). Incluye Módulos 1-5, primer corte de precios/Prestaciones, gestión de usuarios del Panel, Proceso de Incorporación, Certificado de Aptitud, rol Superadmin real y Módulo 8 (Configuración). Falta la Parte 3 del Módulo 6 y el Módulo 7 — ver la fila "Módulo 6 — Guardias" más abajo | Sitio web activo | 1-2 semanas | `PRD_02_Panel_Admin.md` |
| 2B | Gestión de Personal (vínculo, cese, riesgo, cobertura) | 🟢 Completo — código listo y SQL aplicado y verificado contra Supabase real | Panel de admin funcionando, Módulo 4 del panel construido | Integrada a Etapa 2 | `PRD_02B_Gestion_Personal.md` |
| 3 | PWA Asistentes (login, guardias, GPS check-in/out, reporte diario + IA Nivel 1) | 🟡 En progreso — primer corte construido, verificado en navegador real y desplegado a producción. Quedaron afuera de este corte, a pedido del Desarrollador: notificaciones push, alertas tempranas de ausencia y WebAuthn | Panel de admin funcionando | 2-3 semanas | `PRD_04_05_App_Servicio.md` |
| 4 | PWA Familias (login, pacientes, reportes, alertas IA Nivel 2) | 🟢 Desplegado a producción (2026-07-21) contra el backend real, y verificado en navegador contra producción, no solo en local | PWA Asistentes funcionando | 1-2 semanas | `PRD_04_05_App_Servicio.md` |
| 5 | Informe para Obra Social (informe virtual con validación y snapshot inmutable, sin PDF — ver `docs/claude_history.md` 2026-07-21) | 🟢 Completo — construido y verificado en navegador contra datos de Prestadora Demo (2026-07-21), con el schema aplicado contra Supabase real. Queda confirmar el despliegue explícito posterior a ese commit | Reportes funcionando | 1 semana | `PRD_04_05_App_Servicio.md` |
| 6 | Escaneo de Asistente con QR desde la PWA Familias — verifica identidad y asignación a la guardia de hoy (rediseñada 2026-07-22, ver `docs/claude_history.md`; antes era una página pública sin login) | 🟢 Completo — construido y verificado de punta a punta el 2026-07-22 (script de regresión contra Supabase real + navegador real). Pendiente #73 de `docs/PENDIENTES.md`, 🟢 Resuelto | Asistentes certificados, PWA Familias funcionando | 1 semana | `PRD_04_05_App_Servicio.md` |
| Diferida | App nativa (Capacitor o React Native) | 🔴 No iniciado | 50+ familias activas, negocio validado | 1-5 semanas | — |
| Diferida | IA Niveles 3-5 (matching, asistente virtual, análisis predictivo) | 🔴 No iniciado | Datos históricos suficientes | Variable | — |
| En paralelo | Multi-tenancy real (entidad `prestadoras`, aislamiento por organización, roles y facturación CeltaTech/Prestadora) | 🟡 En progreso — Bloques 1 a 4 aplicados y verificados contra Supabase real (2026-07-09 al 13): aislamiento de datos, RLS centralizada (`current_tenant()`/`es_superadmin()`), rol `admin`→`admin_prestadora`, filtrado de tenant en el backend, `configuracion_empresa`→`configuracion_prestadora` y resolución de tenant por dominio. Pendientes #26 y #30 de `docs/PENDIENTES.md`, 🟢 Resueltos. Sigue abierta la facturación CeltaTech/Prestadora, sin construir todavía | Plan y diseño de multi-tenancy aprobados | Variable | `CLAUDE.md` §2 |
| En paralelo | Módulo 6 — Guardias (series, GPS check-in/out, incidentes de relevo, escalada) | 🟡 En progreso — schema aplicado. Parte 1 (Guardias core) construida el 2026-07-10, desplegada y probada en navegador real el 2026-07-11. Parte 2 (Continuidad de guardia) construida, commiteada y probada en navegador real el 2026-07-12. Detección automática de ausencia + alertas tempranas (pendiente #20) construida, schema aplicado y probada en navegador real el 2026-07-13, desplegada. Falta la Parte 3 (piezas de apoyo), que no tiene PRD dedicado. El envío de mensajes de escalada por WhatsApp está resuelto (ver `docs/PRD_06_WhatsApp_IA.md` y pendiente #9 de `docs/PENDIENTES.md`) | Módulo 4/5 del Panel funcionando | Variable | `PRD_02_Panel_Admin.md` (Módulo 6) |

Convención de la columna Estado: 🔴 No iniciado · 🟡 En progreso · 🟢 Completo y en producción.

Lo que sigue abierto está en `docs/PENDIENTES.md`, y el porqué de cada decisión, en
`docs/claude_history.md`.

El reclutamiento (`PRD_03_Reclutamiento.md`) no es una etapa de código separada — vive entero
en la Etapa 2: el panel de postulantes, la verificación y la capacitación. **El formulario
público de postulación ya no es de la Etapa 1**: quien busca trabajo de cuidador se postula en
la empresa que lo va a contratar, no en la página de Careonys, que le vende software a esas
empresas (ver `PRD_01_Sitio_Web.md` §3).

## Regla de secuencia

No empezar una etapa de código sin que la anterior esté funcionando en producción (no solo
"código escrito" — desplegado y probado). Esto es una regla de gestión de riesgo del
proyecto, no una preferencia arbitraria: cada etapa valida supuestos de negocio (familias
reales, Asistentes reales) que las etapas siguientes dan por sentado.

**La Etapa 1 quedó fuera de esta regla, y no es un descuido.** Las etapas 2 a 6 están
construidas y en producción mientras la Etapa 1 sigue sin empezar. Es correcto: cuando se
escribió la regla, la Etapa 1 era el sitio de una empresa de cuidados y las siguientes
dependían de verdad de ella. Reencuadrada como la página que le vende el software a esas
empresas (2026-08-13, pendiente `#104`), pasó a ser una pieza comercial que no valida ningún
supuesto del que dependa el código de las otras etapas. Puede construirse cuando convenga
venderlo, sin bloquear ni ser bloqueada.

## Fuera del alcance de código (para contexto, no bloquean desarrollo)

Fase 0 (meses 1-3) también incluye trámites legales/societarios (constitución SAS, alta
AFIP, contrato con abogado laboralista, póliza de RC, registro de marca) que corren en
paralelo al desarrollo pero no son tareas de código — no se listan acá en detalle porque no
son accionables desde este repositorio.

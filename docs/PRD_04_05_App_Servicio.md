# PRD_04_05 — PWA de Servicio (Asistentes y Familias)

> Fuente: documento único original de especificación (histórico) Parte O. Etapas 3 (PWA Asistentes) y 4 (PWA
> Familias) del build order. Se construye **después** de que el sitio (Etapa 1) y el panel
> de admin (Etapa 2) estén en producción con familias reales — no antes.

## Objetivo

La PWA de servicio es donde se hace real la propuesta de valor: reporte diario con IA, GPS
en tiempo real, certificado QR, alertas inteligentes. La usan Asistentes durante la guardia y
Familias para seguir el servicio.

## Stack (Etapas 3 y 4)

```
Framework:  React 18 + Vite + Vite PWA Plugin
Auth:       Supabase Auth (magic link o email/password)
DB:         Supabase (PostgreSQL + RLS + Realtime)
Storage:    Supabase Storage (fotos de reportes, documentos)
GPS:        navigator.geolocation API (browser nativo)
Cámara:     MediaDevices API (browser nativo)
IA Nivel 1 y 2: Anthropic API — Claude Sonnet (ver AI_PROMPTS.md)
Push:       Web Push API + Service Worker (Android) / Apple Push (iOS 16.4+)
Informe Obra Social: sin librería de PDF — informe virtual dentro del Panel, impresión vía window.print() + @media print (Etapa 5, ver docs/claude_history.md 2026-07-21)
```

Limitación conocida: notificaciones push en Safari/iOS son limitadas incluso desde iOS 16.4.
No es un bug a resolver en el MVP — está documentado como limitación de la estrategia
PWA-first, monitorear en producción antes de considerar migrar a app nativa con Capacitor.

## PWA del Asistente (Etapa 3)

### Login
**Decisión revisada 2026-07-15** (pendiente #30 ítem H, extendida acá por el Desarrollador):
clave alfanumérica (Supabase Auth email/password), no magic link — con opción de
identificación biométrica (Face ID/Touch ID/Windows Hello vía WebAuthn, si el dispositivo lo
permite) como método alternativo una vez que el usuario ya inició sesión con contraseña al
menos una vez. El biométrico es opcional y corre para cualquier rol/login del sistema, no
solo para esta PWA — se documenta acá porque esta es la primera vez que un login de este
tipo entra en el build order (Etapa 3, todavía sin empezar). Diseño únicamente, sin código
todavía. Primer login: completar perfil si faltan datos. Sesión persistente — no pedir login
en cada visita.

### Mis Guardias (pantalla principal)
Lista de guardias asignadas (próximas + historial). Cada card: paciente, dirección, fecha,
hora, modalidad, estado. Botón prominente "CHECK-IN" en la guardia activa o próxima.

### Flujo de Check-in

1. El Asistente toca "CHECK-IN" al llegar al domicilio.
2. La app pide permiso de geolocalización si no lo tiene.
3. Registra `checkin_lat`/`checkin_lng`/`checkin_at` en `guardias` (ver `DATA_MODEL.md`).
4. Valida distancia contra el domicilio del paciente:
   - Dentro del rango → check-in exitoso, guardia pasa a `activa`.
   - Fuera del rango → aviso + opción de confirmar igual, con nota automática al coordinador
     (no bloquear el check-in — el Asistente puede tener razones legítimas, ver regla de
     "nunca penalizar" en `CLAUDE.md`).
5. Notificación push a la Familia: "Tu Asistente [nombre] llegó al domicilio".

### Guardia Activa
Timer desde el check-in. Datos del paciente (nombre, patologías, medicación habitual, notas
del coordinador). Botón "Ver reportes anteriores". Botón "Reporte de emergencia" (formulario
simplificado + alerta inmediata al coordinador, separado del flujo normal de check-out).
Botón "Check-out" habilitado recién después de las horas mínimas de la modalidad.

### Flujo de Reporte Diario (dispara IA Nivel 1 al hacer check-out)

1. **Dictado o escritura libre** — textarea grande + botón de micrófono, placeholder
   invitando a hablar en lenguaje natural.
2. **Revisión del reporte estructurado** — la IA devuelve el JSON de `AI_PROMPTS.md`
   (Nivel 1) en campos editables: alimentación, medicación, signos vitales, estado de ánimo,
   incidentes, observaciones. El Asistente corrige antes de confirmar — **nunca guardar sin
   este paso** (regla ya fijada en `AI_PROMPTS.md`).
3. **Foto opcional** — cámara → sube a Supabase Storage, referencia en `reportes.foto_url`.
4. **Confirmar y enviar** — persiste el reporte, hace el check-out (lat/lng/timestamp),
   notifica push a la Familia, guardia pasa a `completada`.

### Mi Perfil
Foto, datos personales, especialidades y zonas, estado de monotributo y seguro (con fecha de
vencimiento), Certificado de Aptitud (ver QR, compartir), historial de evaluaciones recibidas.

## Alertas tempranas de ausencia (diseño, no implementado — ver pendiente #20 de `docs/PENDIENTES.md`)

Requerimiento definido por el Desarrollador el 2026-07-12, corrigiendo el diseño original de
Módulo 6 (Continuidad de guardia), que trataba "marcar ausente" como una acción manual de un
Coordinador. Dos reglas de fondo, todavía sin implementar:

1. **Detección automática de ausencia** — la ausencia se marca sola cuando no se registra el
   check-in dentro de un margen de tiempo esperado después del inicio de la guardia. El botón
   manual ("marcar ausente") queda como excepción/override para casos que el sistema no
   detectó solo, no como el mecanismo principal.
2. **Cadena de alertas tempranas, previa a que la ausencia se concrete** — para gestionar un
   relevo con tiempo y minimizar el impacto en el Paciente, en vez de reaccionar recién cuando
   la ausencia ya es un hecho. Arquitectura pensada como **fuentes de alerta enchufables**, no
   una lista cerrada de casos — el Desarrollador fue explícito en que deben poder incorporarse
   fuentes nuevas en el futuro sin rediseñar el mecanismo. Dos fuentes ya identificadas:
   - **GPS de salida del domicilio**: cada Asistente tiene un medio de transporte habitual (a
     pie, colectivo, auto, etc.) hacia cada Paciente; con eso se calcula un tiempo de viaje
     estimado (vía API de mapas) y una "hora de salida esperada" (hora de inicio de guardia
     menos tiempo de viaje). Si pasado un margen configurable por prestadora el GPS del
     Asistente muestra que sigue en su domicilio, se dispara la alerta.
   - **Aviso telefónico previo**: el Asistente llama avisando que, por algún motivo, no va a
     concurrir — con un checklist de motivos (para estadísticas), no texto libre.

   Ante cualquier alerta temprana (de cualquier fuente), se dispara una escalada automatizada
   configurable por prestadora (mensajes automáticos, llamada telefónica, etc.) — el mismo
   concepto de niveles de escalada que ya existe para incidentes de relevo
   (`configuracion_escalada_relevo`), pero debe poder arrancar **antes** del incidente de
   ausencia, no solo después de que ya se concretó. Intervención humana minimizada al máximo,
   no eliminada: el Coordinador siempre recibe la notificación de la anomalía y puede
   intervenir en la resolución. Buena oportunidad de uso de IA — cruzar con
   `docs/BACKLOG_OPORTUNIDADES.md` si corresponde.

### Notificaciones
Nueva guardia asignada, mensajes del coordinador, recordatorios.

## PWA de la Familia (Etapa 4)

### Login
**Decisión revisada 2026-07-15** (pendiente #30 ítem H, extendida acá por el Desarrollador):
clave alfanumérica (Supabase Auth email/password), no magic link — con opción de
identificación biométrica (Face ID/Touch ID/Windows Hello vía WebAuthn, si el dispositivo lo
permite), igual que en la PWA de Asistentes de arriba. Diseño únicamente, sin código todavía
(Etapa 4, depende de que la Etapa 3 esté funcionando primero). Sesión persistente.

### Mis Pacientes
Un solo paciente → va directo a su pantalla. Varios → lista con estado actual de cada uno.

### Pantalla del Paciente
Guardia actual: si hay una activa, muestra Asistente + mapa con ubicación en tiempo real
(Supabase Realtime); si no, próxima guardia programada. Botón "Ver al Asistente en el mapa".
Alertas activas (ROJA/AMARILLA) con descripción.

### Reportes
Lista por fecha (más reciente primero) — fecha, Asistente, resumen breve. Al abrir: campos
estructurados completos + foto si la hay. Botón "Exportar PDF" → Planilla 3 IOMA (Etapa 5).

### Asistente Asignado
Foto, nombre, especialidades. Botón "Escanear Asistente" → pantalla de verificación (ver
abajo). Evaluaciones anteriores con esta familia. Botón de contacto (WhatsApp o chat
interno).

### Escanear Asistente — verificación de identidad y asignación (Etapa 6, rediseñada
2026-07-22, ver `docs/claude_history.md`)

**Reemplaza el diseño original de "Perfil Público del Asistente con QR"** (página pública
sin login en `[dominio-de-la-prestadora]/asistente/[qr_token]`) — decisión del Desarrollador
2026-07-22: no tiene sentido exponer una página pública separada cuando la Familia ya usa la
PWA con sesión iniciada, y una verificación dentro de la app puede confirmar algo más útil
que "está genéricamente certificado": que la persona que tiene enfrente **es efectivamente
el Asistente asignado a la guardia de hoy de ese Paciente**, no solo que pasó el Proceso de
Incorporación alguna vez.

**Flujo:** dentro de la PWA (con sesión), la Familia abre "Escanear Asistente" y usa la
cámara del dispositivo para leer el QR de la credencial física del Asistente
(`asistentes.qr_token`, ya existente). La app llama a un endpoint autenticado que:
1. Resuelve el Asistente por `qr_token`.
2. Busca la guardia de **hoy** de ese Paciente.
3. Compara si el `asistente_id` de esa guardia coincide con el del QR escaneado.

**Resultado mostrado:** si coincide, confirmación con foto, nombre, especialidades y
horario de la guardia de hoy. Si no coincide (o el certificado no está activo), alerta
explícita de que esa persona no es quien corresponde. **Nunca muestra** DNI, teléfono,
email ni dirección — dato sensible, ver `SECURITY.md`. El caso de terceros sin la app
(portero, otro familiar sin cuenta, el propio Paciente sin celular) queda deliberadamente
fuera de este primer corte — ver `docs/PENDIENTES.md` pendiente #73.

### Alertas
Lista de alertas del paciente (activas + historial resuelto), descripción generada por IA,
reportes que la originaron (con links), botón "Contactar coordinador".

## Lógica de alertas IA Nivel 2

Ver `AI_PROMPTS.md` para el prompt de sistema exacto y las reglas de persistencia/
notificación — no repetir acá para que no diverjan las dos fuentes.

## Informe para Obra Social (Etapa 5 — rediseñada, ver `docs/claude_history.md` 2026-07-21)

Se construye exclusivamente en el Panel de Administración (no en esta PWA, la Familia no
participa del proceso ni accede al informe). Reemplaza el diseño original de "Planillas
IOMA" en PDF por un informe virtual dentro del Panel, con impresión vía `window.print()` +
`@media print` — sin librería de PDF y sin asumir una única obra social: cada Paciente
registra su propia `obra_social` (texto libre) y `numero_afiliado` (esquema vigente en
`supabase/migrations/`).

**Planilla de asistencia**: nombre del Paciente, obra social y número de afiliado, mes de
prestación, nombre del Asistente por guardia, campo de firma del Asistente, campo de firma
del afiliado/familiar (manual — firma digital queda para una etapa futura, no implementada).

**Resumen mensual**: consolidado de guardias del período, totales agrupados por el valor
real de `guardias.modalidad` que la Prestadora haya usado — sin catálogo cerrado de códigos
(S4/F6/etc.), decisión explícita para no hardcodear una convención de una obra social en
particular (CLAUDE.md §2/§7).

El informe solo puede guardarse/imprimirse después de que un usuario de la Prestadora con el
permiso `validar_informe_obra_social` (motor de `permisos_prestadora`) lo valide. Al validar,
queda congelado como snapshot inmutable en `informes_obra_social.contenido` (JSONB) — nunca
se edita después; solo se anula (con motivo y auditoría) y se genera uno nuevo. Ver
`backend/src/routes/panelInformesObraSocial.js` y `panel/src/pages/InformesObraSocial.jsx`.

## Datos y RLS

Esquema completo en `DATA_MODEL.md` (tablas `usuarios`, `asistentes`, `familias`,
`pacientes`, `guardias`, `reportes`, `alertas`, `certificados`) y políticas RLS exactas en
`SECURITY.md` — no reproducir el SQL acá, esta PWA solo lee/escribe esas tablas ya definidas.

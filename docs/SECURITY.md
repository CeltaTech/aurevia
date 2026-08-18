# SECURITY.md — Autenticación, autorización y datos sensibles

> Fuente principal: documento único original de especificación (histórico) Parte L (Arquitectura Web) y Parte O
> (RLS policies). Donde se indica, se adoptan patrones de `Prompt de Money Suite.md`
> (no vinculante) porque son buenas prácticas concretas que no contradicen ninguna
> decisión de negocio ya tomada — la plataforma usa Supabase Auth, no un esquema JWT propio,
> así que solo se toman las partes de Money Suite que son configuración de Supabase o
> política independiente del proveedor.

## Autenticación por etapa

- **Etapa 2 (Panel Admin):** Supabase Auth, email + password, **sin** magic link (decisión
  oficial — el panel es de uso interno, no beneficia la fricción-cero del magic link).
- **Etapas 3-4 (PWA Asistentes / Familias):** Supabase Auth, magic link o email/password.

Supabase Auth ya maneja la emisión, rotación y revocación de tokens JWT — **no construir
un esquema propio de access/refresh tokens**. El detalle de "Access Token 15 min + Refresh
Token 30 días con rotación" que aparece en `Prompt de Money Suite.md` sección 13.1 describe
cómo se construiría un auth desde cero; no aplica acá porque Supabase ya lo resuelve. Se
menciona para dejar constancia de que fue evaluado y descartado por redundante, no por
error.

## Política de contraseñas (patrón adoptado de Money Suite, configurable en Supabase Auth)

- Longitud mínima: 10 caracteres.
- Al menos 1 mayúscula, 1 número, 1 carácter especial.
- Rate limit: 5 intentos fallidos → bloqueo temporal (usar la config nativa de rate
  limiting de Supabase Auth, no reimplementar).

Esto es una recomendación de configuración para cuando se dé de alta el proyecto de
Supabase — no requiere código propio.

## Portabilidad de datos — no depender de un solo proveedor (decisión 2026-07-07)

Supabase es la base de datos elegida para todo el roadmap (ver `CONTEXT.md`), pero el
proyecto **no debe construirse de forma que dejarlo sea riesgoso o traumático**. Reglas
para mantener esa salida siempre abierta:

- **Toda la lógica de negocio vive en el backend Node/Express propio**, nunca en Supabase
  Edge Functions ni en triggers/funciones de Postgres con lógica de negocio compleja. Si
  cambia el proveedor de base de datos, el backend cambia una connection string, no su
  código.
- **RLS se escribe en SQL estándar de Postgres**, sin depender de helpers propietarios de
  Supabase más allá de `auth.uid()` (que tiene equivalente directo en cualquier Postgres
  con su propio esquema de usuarios).
- **Backup propio, independiente del backup nativo de Supabase**: un `pg_dump` periódico
  de la base (automatizable con un cron simple en el propio backend o una GitHub Action)
  guardado fuera de Supabase, en almacenamiento de objetos (bucket — Google Cloud Storage,
  AWS S3, Backblaze B2 o similar). Esto protege contra el peor caso (cuenta bloqueada, error
  de facturación, borrado accidental del proyecto) sin depender de que el proveedor mismo
  resuelva su propia falla. **Git/GitHub queda descartado como destino, no en evaluación**
  (decisión 2026-07-10): guarda historial permanente que no se puede purgar sin reescribir
  todo el repo, es una segunda copia de datos sensibles sin ninguna protección de RLS/tenant,
  y tiene límite de tamaño de archivo (100MB) que un dump de base va a superar con el tiempo.
- Storage: si se sube a Supabase Storage, evitar features no estándar que no tengan
  equivalente en cualquier storage S3-compatible.

Ninguna de estas reglas frena el desarrollo actual — son restricciones de diseño, no
trabajo extra significativo. El backup propio es la única tarea pendiente concreta, a
implementar antes de que haya datos reales de pacientes/Asistentes/familias en producción
(no es urgente mientras solo haya datos de prueba).

## RBAC — roles del sistema

Los 6 roles reales del proyecto (nota histórica: Money Suite usaba genéricos
`super_admin`/`operations_manager` sin correspondencia en ningún PRD de este proyecto en ese
momento — desde el 2026-07-07 sí existe un `superadmin` real, pero es una decisión propia
de este proyecto, con alcance distinto, no el que traía Money Suite):

| Rol | Alcance |
|---|---|
| `superadmin` | Técnico (código/infra/base de datos), sin carácter administrativo de negocio. Su acceso ordinario de Panel es únicamente la prestadora de prueba fija (Sandbox). Para entrar a una prestadora real abre una **sesión de soporte técnico**: una por vez, acotada en el tiempo y auditada — ver abajo. Login propio, MFA obligatorio |
| `admin_prestadora` | Todo el negocio de su propia prestadora (cero visibilidad de otras prestadoras) |
| `coordinador` | Su zona asignada (familias, pacientes, guardias, Asistentes de esa zona), dentro de su propia prestadora |
| `asistente` | Sus propias guardias, su perfil, su certificado |
| `familia` | Sus pacientes, reportes y alertas de sus pacientes |

**Nota (2026-07-10):** el rol se llamaba `admin` hasta el Bloque 2 del pasaje a
multi-tenant — se renombró a `admin_prestadora` en dato y código (sin
transición pendiente, no queda ningún registro ni ruta con el valor `admin`) al pasar a
multi-tenant real, para reflejar que su alcance quedó acotado a una sola prestadora. Ver
glosario de `CLAUDE.md`.

**Nota (2026-07-13, reemplaza la descripción anterior de `superadmin` en esta tabla):**
hasta esta fecha `superadmin` se describía como "todo lo de `admin_prestadora`, en todas las
prestadoras" — un bypass cross-tenant total sin límite de sesión. Se descarta: conflacionaba
acceso técnico (infra/código, sin necesidad real de tocar datos de negocio de una
prestadora real) con acceso administrativo de negocio (comercial, todas las prestadoras).
El diseño de reemplazo (roles `superadmin` acotado a sandbox + `admin_plataforma` nuevo,
con el "modo dentro de una prestadora" — banner notorio, advertencia en acciones
destructivas vía Regla 4 de `CLAUDE.md`, log de auditoría de todo login/acción sensible,
timeout de 5 min de inactividad + tope de 60 min con aviso a los 50) es el que se
implementó.

**Nota (2026-07-15, cierra la anterior):** el mecanismo se implementó — `current_tenant()`
dinámico por sesión incluido. La nota de arriba decía "todavía no está implementado"; eso
dejó de ser cierto en el pendiente #30.

**Nota (2026-07-28, Etapa 2 de la separación CeltaTech/Careonys — reemplaza a `admin_plataforma`
en todo lo anterior):** el rol `admin_plataforma` **ya no existe en Careonys**. Era el rol
comercial, y lo comercial se fue entero a CeltaTech (Nivel 1). La maquinaria del "modo dentro
de una prestadora" no se borró: se re-apuntó a `superadmin` y pasó a llamarse **sesión de
soporte técnico** (tablas `sesiones_soporte_tecnico` y `auditoria_soporte_tecnico`, guardia
`requiereSoporteTecnico` en `backend/src/routes/panelSesionTenant.js`). Todo lo que dice el
párrafo anterior sobre banner, auditoría y límites de tiempo sigue vigente palabra por
palabra; lo único que cambió es quién tiene la llave. Probado de punta a punta contra la base
local con `backend/scripts/test_etapa2_sesion_soporte.mjs` (13 chequeos). Ver
`celtatech/docs/PLAN_SEPARACION_CELTATECH.md`, Etapa 2, paso 7.

`superadmin` es el único rol, además de `admin_prestadora`, con acceso de escritura a
configuración de sistema (planes/módulos activables, si se construye esa idea de
`PRD_02_Panel_Admin.md` Módulo 8) y a cualquier herramienta de diagnóstico asistido por IA
que se construya sobre logs/errores de la aplicación — no exponer esas herramientas a
`admin_prestadora` ni a `coordinador`.

## Multi-tenancy — `current_tenant()` y `es_superadmin()` (Bloque 2, aplicado y verificado)

**Nota (2026-07-28, corrige y reemplaza la nota anterior de esta sección):** la nota que
estaba acá decía que `es_superadmin()` "sigue siendo hoy un bypass total sin acotar" y que la
sesión de tenant dinámica "todavía no está implementada en código". Las dos cosas dejaron de
ser ciertas en el pendiente #30 (2026-07-15) y quedaron escritas casi un mes de más. Estado
real, verificado contra la base el 2026-07-28:

- `current_tenant()` resuelve la sesión de soporte técnico primero y el `prestadora_id` propio
  después (definición completa abajo, copiada de la base, no del diseño).
- `es_superadmin()` no es un bypass: devuelve `TRUE` solo si el usuario es `superadmin` **y**,
  cuando `configuracion_plataforma.mfa_admin_obligatorio` está en ON, además viene con segundo
  factor verificado (`aal2`). Las policies la usan siempre junto al tenant
  (`es_superadmin() AND prestadora_id = current_tenant()`), nunca sola.

Desde la Etapa 2 (2026-07-28) la tabla que consulta `current_tenant()` se llama
`sesiones_soporte_tecnico` y el rol habilitado es `superadmin` — antes eran
`sesiones_tenant_admin_plataforma` y `admin_plataforma`.

Toda policy de RLS escrita desde el Bloque 2 en adelante usa estas dos funciones SQL en vez
de repetir el `EXISTS (SELECT ... FROM usuarios WHERE id = auth.uid() ...)` a mano:

```sql
-- Copiado de la base el 2026-07-28 (pg_get_functiondef), no del diseño.
CREATE OR REPLACE FUNCTION current_tenant() RETURNS UUID
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    -- 1º: ¿hay una sesión de soporte técnico abierta y vigente? Entonces manda esa.
    (SELECT s.prestadora_id FROM sesiones_soporte_tecnico s
      WHERE s.admin_id = auth.uid()
        AND s.salida_at IS NULL
        AND s.expira_at > NOW()
        AND s.ultima_actividad_at > NOW() - INTERVAL '5 minutes'
      ORDER BY s.entrada_at DESC LIMIT 1),
    -- 2º: si no, la Organización propia del usuario.
    (SELECT prestadora_id FROM usuarios WHERE id = auth.uid())
  )
$$;

CREATE OR REPLACE FUNCTION es_superadmin() RETURNS BOOLEAN
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mfa_obligatorio BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol = 'superadmin') THEN
    RETURN FALSE;
  END IF;
  SELECT mfa_admin_obligatorio INTO v_mfa_obligatorio FROM configuracion_plataforma LIMIT 1;
  -- Con el segundo factor exigido, no alcanza con ser superadmin: hay que haberlo usado.
  IF COALESCE(v_mfa_obligatorio, FALSE) THEN
    RETURN (auth.jwt() ->> 'aal') = 'aal2';
  END IF;
  RETURN TRUE;
END;
$$;
```

Toda tabla con `prestadora_id` debe filtrar por `prestadora_id = current_tenant()` en sus
policies — nunca solo por rol, sin el filtro de tenant, salvo que la tabla sea
intencionalmente global (ej. `escalas_legales`, que no tiene `prestadora_id`).

**Regla: en toda tabla que tenga `prestadora_id`, `es_superadmin()` va con `AND`, nunca sola.**
El patrón correcto es `(es_superadmin() AND prestadora_id = current_tenant()) OR (...)`: ser
superadmin da un permiso *dentro* del tenant en el que uno está parado, no permiso para
salirse de él. Una policy que diga solamente `USING (es_superadmin())` sobre una tabla con
`prestadora_id` es un bypass cross-tenant.

**Excepciones vigentes, contadas contra la base el 2026-07-28** (83 policies usan
`es_superadmin()`; estas 5 la usan sola sobre una tabla que sí tiene `prestadora_id`):

| Tabla | Policy | Por qué se acepta |
|---|---|---|
| `uso_ia` | `superadmin_lee_uso_ia` | Medición de consumo de IA (tokens y costo en USD por Prestadora). Es la contabilidad de CeltaTech sobre su propia factura de IA, no datos de la operación. Sin datos personales. |
| `prestadora_modulos` | `superadmin_lee_prestadora_modulos` | Caché de qué módulos tiene licenciados cada Prestadora. Metadato de licenciamiento. |
| `prestadora_modalidades` | `superadmin_lee_modalidades` | Ídem: qué modalidades tiene activadas cada Prestadora. |
| `prestadora_pasarela_pago` | `superadmin_lee_pasarela` | Estado de conexión de la pasarela por Prestadora (proveedor y estado, sin credenciales). |
| `auditoria_soporte_tecnico` | `superadmin_lee_toda_la_auditoria` | A propósito: el registro de auditoría se lee entero o no sirve como auditoría. |

Ninguna de las cinco toca datos de Familias, Pacientes ni Asistentes — ver las columnas de
esas tablas en `docs/DATA_MODEL.md`. **Si una tabla nueva necesita entrar en esta lista, no se
agrega en silencio: se agrega acá con su motivo escrito.** Toda tabla con datos de la
operación queda fuera, sin excepción.

## RLS — políticas obligatorias

Cada tabla nueva necesita RLS antes de mergear el PR que la crea. Ejemplos oficiales
(actualizados 2026-07-10 al patrón multi-tenant — toda policy nueva debe filtrar por
`current_tenant()`, no solo por rol):

```sql
-- Asistentes solo ven sus propias guardias (dentro de su tenant)
CREATE POLICY "asistente_ve_sus_guardias" ON guardias
  FOR SELECT USING (asistente_id = auth.uid() AND prestadora_id = current_tenant());

-- Familias solo ven los reportes de sus pacientes
CREATE POLICY "familia_ve_sus_reportes" ON reportes
  FOR SELECT USING (
    guardia_id IN (
      SELECT id FROM guardias WHERE paciente_id IN (
        SELECT id FROM pacientes WHERE familia_id = auth.uid()
      )
    )
  );

-- Admin_prestadora y coordinadores ven todo en su ámbito, acotado a su propia prestadora
CREATE POLICY "admin_prestadora_ve_todo" ON guardias
  FOR ALL USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol IN ('admin_prestadora','coordinador'))
    OR es_superadmin()
  );
```

**Patrón OR-de-dos-EXISTS para FK nullable (ejemplo oficial, `incidentes_relevo`, Módulo 6):**
cuando una tabla tiene una FK opcional que cambia de qué fila derivar el tenant/zona según
esté NULL o no (acá, `guardia_saliente_id` NULL = "Ausente sin relevo previo", ver glosario
de `CLAUDE.md`), la policy resuelve ambos casos con dos `EXISTS` unidos por `OR`, en vez de
intentar una sola condición que cubra los dos:

```sql
CREATE POLICY "coordinador_ve_incidentes_de_su_zona" ON incidentes_relevo
  FOR SELECT USING (
    prestadora_id = current_tenant() AND (
      -- Caso con relevo previo: derivar la zona desde la guardia saliente
      EXISTS (
        SELECT 1 FROM guardias g
        JOIN asistentes a ON a.id = g.asistente_id
        WHERE g.id = incidentes_relevo.guardia_saliente_id
          AND a.zonas && (SELECT zonas FROM usuarios WHERE id = auth.uid())
      )
      OR
      -- Caso "ausente sin relevo previo" (guardia_saliente_id IS NULL): derivar la zona
      -- desde la guardia entrante en su lugar
      EXISTS (
        SELECT 1 FROM guardias g
        JOIN asistentes a ON a.id = g.asistente_id
        WHERE g.id = incidentes_relevo.guardia_entrante_id
          AND incidentes_relevo.guardia_saliente_id IS NULL
          AND a.zonas && (SELECT zonas FROM usuarios WHERE id = auth.uid())
      )
    )
  );
```

Tablas que **nunca** deben tener policy de lectura para `asistente` ni `familia`:
`escalas_legales`, `ceses`, `ausencias`, `guardias_cobertura` (regla 8 de `CLAUDE.md`).

Para `coordinador`, la policy de "su zona" debe filtrar por el campo `zonas` del
Coordinador contra la zona de la `familia`/`asistente` — no dar acceso total a
`coordinador` salvo en las tablas donde el PRD lo indica explícitamente.

**Estado real (actualizado 2026-07-09):** implementado y aplicado contra Supabase real
(esquema vigente en `supabase/migrations/`) para las tablas donde existe una columna `zonas`
real o un join directo a `asistentes.zonas`: `asistentes` (lectura y edición),
`verificaciones_asistente`, `ausencias`, `guardias_cobertura`, `certificados` — vía
`usuarios.zonas && tabla.zonas` (operador de overlap de arrays) en policies separadas de
`admin_*` (sin filtro) y `coordinador_*_de_su_zona` (filtradas), que Postgres combina con OR
al ser ambas permisivas. **Pendiente, no resuelto**: `solicitudes`/`familias`/`pacientes`/
`prestaciones` no tienen zona modelada como código real (`solicitudes.localidad` es texto
libre sin FK a `zonas_cobertura`) — Coordinador sigue viendo todas las filas de estas 4
tablas, igual que Admin, hasta que exista una decisión de producto sobre cómo derivar la
zona de una Familia/Solicitud (agregar un `select` de zona al formulario público, inferir
por `localidad`, u otra opción). No adivinar esa semántica sin confirmarla primero.

**Módulo 6 (Guardias), estado 2026-07-10:** las 8 tablas del Módulo 6, definidas en
`supabase/migrations/`, tienen RLS multi-tenant aplicada y verificada contra Supabase
real (15 policies, incluyendo el patrón OR-de-dos-EXISTS de
`incidentes_relevo` documentado arriba, verificado con datos reales para el caso
`guardia_saliente_id IS NULL`). Sigue sin existir ninguna ruta backend ni pantalla de Panel
que consuma estas tablas.

**Pendiente de decisión, no bloquea desarrollo:** `guardias_tracking_gps` guarda histórico de
posiciones GPS del Asistente durante una guardia activa — esto es un dato personal sensible
bajo Ley 25.326 (geolocalización de una persona física). Falta definir política de retención
(cuánto tiempo se conserva el histórico) y si se necesita un aviso/consentimiento explícito
al Asistente más allá del que ya cubre el vínculo contractual — no se ha tomado ninguna
decisión de producto sobre esto todavía.

## Datos sensibles — qué nunca se loguea ni va en URL/GET

- Sueldos, honorarios, montos de `ceses`.
- Causales de cese.
- Certificados médicos, antecedentes penales.
- Datos de salud del paciente (`patologias`, `medicacion_habitual`, contenido de `reportes`).
- Texto libre de reportes y salida de los prompts de IA (ver `AI_PROMPTS.md`).

Estos datos viajan solo en el body de requests autenticadas, nunca en query params, nunca
en logs de aplicación accesibles a todo el equipo.

## Cumplimiento normativo

- Ley 25.326 (Protección de Datos Personales, Argentina) aplica a todos los datos de
  salud y datos personales de pacientes, Asistentes y familias.
- No aplica GDPR salvo expansión internacional futura (no está en el roadmap actual).

## Verificación de antecedentes penales (etapa 3 del Proceso de Incorporación de Asistentes)

Hoy es un proceso manual/semi-manual (consulta al Registro Nacional de Reincidencia,
renovación anual) — no hay integración de API elegida. Si se automatiza, evaluar
proveedores regionales (Money Suite menciona Truora/Veriff/Idfy como referencia de mercado
para verificación de antecedentes + validación facial en LATAM) — decisión pendiente de
negocio y de presupuesto, no bloquea el desarrollo de las etapas 1-2.

## Decisiones de seguridad pendientes (no bloquean desarrollo, hay que saberlas)

- Proveedor de reconocimiento facial para la etapa de verificación de identidad del Proceso
  de Incorporación de Asistentes: no elegido.
- Si se automatiza la consulta de antecedentes penales: proveedor no elegido.
- Modelo de pagos (ver `CONTEXT.md` y `DATA_MODEL.md`): no hay decisión de negocio, por lo
  tanto tampoco hay decisión de seguridad de datos de pago (tokenización, PCI DSS scope).
  No construir nada de esto hasta que exista un PRD de pagos aprobado.

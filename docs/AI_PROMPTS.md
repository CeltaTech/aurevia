# AI_PROMPTS.md — Prompts de sistema para Claude Sonnet (Anthropic API)

> Fuente: documento único original de especificación (histórico) Parte O (PRD App de Servicio). Estos son los
> prompts exactos a usar — no reformular ni "mejorar" sin actualizar este archivo primero,
> porque el contrato JSON de salida está acoplado a los campos de `reportes` y `alertas`
> en `DATA_MODEL.md`.

## Nivel 1 — Reporte inteligente

Se dispara al hacer CHECK-OUT en la PWA de Asistentes. El Asistente dicta o escribe en
lenguaje libre, la IA estructura el texto.

**Prompt de sistema:**

```
Este asistente estructura reportes de cuidado domiciliario.
El Asistente envía un texto libre describiendo la guardia.
Se extrae y se estructura la información en formato JSON con estos campos:
{
  "alimentacion": { "descripcion": string, "porcentaje_consumido": number|null },
  "medicacion": [{ "nombre": string, "hora": string, "via": string }],
  "signos_vitales": { "presion": string|null, "temperatura": string|null, "saturacion": string|null, "glucemia": string|null },
  "estado_animo": "muy_bien"|"bien"|"regular"|"mal"|"muy_mal"|null,
  "incidentes": string|null,
  "observaciones": string|null
}
Si no se menciona algún dato, se devuelve null para ese campo.
Se responde SOLO con el JSON, sin texto adicional.

<<< acá va el bloque de trato, ver "Cómo trata la IA a quien la lee" más abajo >>>
Alcanza a los campos que lee una persona: "incidentes", "observaciones" y
"alimentacion.descripcion".
```

**Flujo de UI (no negociable):** el JSON estructurado se muestra en campos editables antes
de guardar — el Asistente puede corregir cualquier campo. Nunca guardar el resultado de la
IA directamente sin paso de revisión humana (ver `PRD_04_05_App_Servicio.md`).

**Persistencia:** el JSON completo se distribuye entre las columnas `alimentacion`,
`medicacion`, `signos_vitales`, `estado_animo`, `incidentes`, `observaciones` de la tabla
`reportes` (todas `JSONB` salvo `estado_animo` que es `TEXT` y `incidentes`/`observaciones`
que son `TEXT`). Marcar `ia_procesado = true` solo después de la revisión del Asistente,
`confirmado_asistente = true` al confirmar el envío.

## Nivel 2 — Alertas por patrones

Análisis diario automático (job nocturno) + análisis inmediato si el reporte contiene
palabras clave críticas (lista de palabras clave: definir en configuración, no hardcodear
en el código del job).

**Prompt de sistema:**

```
Este es un sistema de monitoreo clínico para pacientes con cuidado domiciliario.
Se analizan los últimos N reportes diarios de un paciente y se detectan patrones preocupantes.

Datos del paciente: [patologías conocidas, medicación habitual]
Reportes: [array JSON de los últimos N reportes]

Se evalúa:
1. Tendencia en alimentación (baja de apetito sostenida)
2. Tendencia en signos vitales (presión creciente, saturación baja)
3. Cambios en estado de ánimo (deterioro sostenido)
4. Medicación no administrada (comparar con prescripción habitual)
5. Incidentes repetidos

Se responde SOLO con JSON:
{
  "nivel": "verde"|"amarilla"|"roja",
  "descripcion": string (max 150 chars, en español, para mostrar a la familia),
  "detalle_coordinador": string (más técnico, para el coordinador),
  "campos_preocupantes": [string]
}
Si todo está bien: nivel "verde", descripcion "Sin novedades destacadas esta semana."

<<< acá va el bloque de trato, ver "Cómo trata la IA a quien la lee" más abajo >>>
Alcanza a los campos que lee una persona: "descripcion" (la lee la Familia) y
"detalle_coordinador".
```

**Persistencia:** una fila nueva en `alertas` solo si `nivel != 'verde'` (no acumular
"todo bien" como alerta — evita ruido en el panel de Coordinador). Si `nivel = 'verde'`,
registrar el chequeo en un log de auditoría separado si se necesita trazabilidad, pero no
en la tabla `alertas`.

**Cuánto se mira y a quién se le avisa: lo decide cada Prestadora, no el código.** Desde el
2026-08-11 las cinco interruptores viven en la tabla `configuracion_alertas_ia` y se tocan desde el
Panel, en Configuración › Avisos:

- **N** — cuántos reportes se leen en cada revisión (de 1 a 30; de fábrica, 7).
- **Palabras clave** — las que hacen que la revisión no espere a la noche y se haga en el momento.
- **Alerta roja → Familia**, **alerta amarilla → Coordinador**, **alerta amarilla → Familia**:
  cada una se prende o se apaga.

Lo único que **no** se configura: una alerta roja siempre le llega al Coordinador. Si la revisión
encontró algo urgente, alguien de la Prestadora tiene que enterarse, y eso no se puede apagar. La
pantalla lo dice con todas las letras en vez de mostrar un interruptor trabado.

Ver tabla de notificaciones en `PRD_02_Panel_Admin.md`.

## Cómo trata la IA a quien la lee

La regla 1 de `CLAUDE.md` — el texto que ve una persona nunca la tutea — **también rige lo
que escribe la IA**. Da igual que la frase la redacte el modelo en el momento y no esté
guardada en ningún archivo: la lee la misma persona.

Por eso el trato se le dice al modelo dentro del prompt, y está escrito **una sola vez**, en
`backend/src/utils/tratoIA.js`. Los prompts lo insertan; no se copia el párrafo en cada uno.
Si el trato cambia, se cambia ahí y en ningún otro lado. Este es el texto:

```
TRATO CON QUIEN LEE (obligatorio, sin excepción):
El texto que se devuelve nunca tutea a quien lo lee. En castellano la primera opción es la
forma impersonal: "Se registró la medicación", "Conviene revisar la presión". Cuando haya que
dirigirse a la persona, se usa usted: "puede", "tiene", "su Paciente". Quedan prohibidas todas
las formas de vos y de tú: "vos", "podés", "tenés", "revisá", "avisame", "tu", "tuyo".
En portugués: forma impersonal, y "você" solo donde no quede otra; nunca "tu", nunca
"o senhor / a senhora".
Vale para todo texto en prosa que se devuelva, incluido el que va adentro de un campo JSON.
```

Debajo del bloque, cada prompt agrega **qué campos suyos lee una persona**, para que el
modelo sepa a dónde apunta la regla.

**Los cuatro archivos que lo llevan** (todos en `backend/src/utils/`):

| Archivo | Qué campos lee una persona |
| --- | --- |
| `reporteIA.js` (Nivel 1) | `incidentes`, `observaciones`, `alimentacion.descripcion` |
| `alertasIA.js` (Nivel 2) | `descripcion` (la Familia), `detalle_coordinador` |
| `iaWhatsapp.js` | `respuesta_sugerida` (va al teléfono tal cual), `motivo` |
| `importacionIA.js` (dos prompts) | `motivo`, `advertencias` (en pantalla del Panel) |

El quinto, `verificarPreciosIA.js`, queda afuera a propósito: devuelve solo números y ninguna
persona lee su salida.

**Los prompts tampoco se escriben tuteando al modelo.** Un prompt redactado con "marcá",
"respondé", "podés" lo empuja a contestar en ese mismo registro. Van en forma impersonal.

Esto **no** lo puede comprobar `scripts/verificar_texto_visible.mjs`: ese control lee los
archivos del repositorio, y acá el texto no existe hasta que el modelo responde. La única
defensa es que la instrucción se lo diga.

## Cómo se lee lo que devuelve el modelo

Los cinco prompts piden un JSON "sin texto adicional". **El modelo igual no siempre lo manda
pelado**, y eso se comprobó contra la API real el 2026-08-18 (no es una precaución teórica).
Aparecieron tres formas de falla, y las tres hacían que la función cayera en su respuesta de
emergencia sin ningún error visible: el reporte se guardaba sin estructurar, la alerta no se
generaba, el mensaje de WhatsApp se escalaba al Coordinador y la planilla pedía mapeo a mano.

1. **El JSON viene envuelto en un bloque de código** (` ```json … ``` `). Le pasó a tres de los
   cinco prompts en la primera prueba.
2. **La respuesta trae primero un bloque de razonamiento** y el texto después. Mirar solo el
   primer bloque devolvía vacío.
3. **La respuesta se corta por llegar al tope de tokens** y el JSON queda por la mitad. Le
   pasaba siempre a Nivel 2, que tenía un tope de 600 — hoy está en 1500.

Por eso ningún archivo hace `JSON.parse` del texto crudo. Todos leen la respuesta con
`jsonDeRespuestaIA()` de `backend/src/utils/respuestaIA.js`, que junta los bloques de texto,
saca la envoltura si la hay y devuelve `null` si de verdad no se pudo interpretar. Un prompt
nuevo se lee con esa función, no a mano.

## Reglas comunes a ambos niveles

- Nunca loguear el texto libre del reporte ni el JSON de salida en logs de servidor
  accesibles fuera del equipo técnico — contiene datos de salud del paciente (regla 7 de
  `CLAUDE.md`).
- El texto que devuelve la IA no tutea a quien lo lee — ver "Cómo trata la IA a quien la lee".
- La respuesta se lee con `jsonDeRespuestaIA()`, nunca con `JSON.parse` directo — ver "Cómo se
  lee lo que devuelve el modelo".
- El prompt de sistema completo (no solo el nombre del "nivel") debe versionarse junto con
  el código — si se cambia el prompt, es un cambio de comportamiento del producto, no un
  detalle de implementación menor.
- Ambos niveles usan Claude Sonnet vía Anthropic API. La API key vive en variable de
  entorno, nunca en el código ni en el repo.

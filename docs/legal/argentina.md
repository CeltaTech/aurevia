# Riesgo legal — Argentina

> Documento mínimo requerido por `CLAUDE.md` §3 antes de dar de alta la primera Prestadora
> real de esta jurisdicción. No es un dictamen legal cerrado — es la base para las
> advertencias que el software muestra al activar funciones de gestión de Asistentes. Antes
> de operar con Prestadoras reales en Argentina, conviene que un abogado laboralista lo
> revise y lo amplíe; hasta entonces, cubre el riesgo principal ya identificado.

## Marco de referencia

Ley de Contrato de Trabajo (LCT), art. 23: quien preste servicios se presume que lo hace
bajo relación de dependencia laboral, salvo que las circunstancias, relaciones o causas que
lo motiven demuestren lo contrario. Es una presunción que admite prueba en contra, pero el
riesgo aumenta cuanto más se parezca la relación real a la de un empleado en relación de
dependencia (horarios fijos impuestos, exclusividad de facto, subordinación técnica y
disciplinaria, penalización de incumplimientos al estilo de un régimen disciplinario
laboral).

Este riesgo aplica a la relación entre la Prestadora y sus Asistentes cuando estos operan
bajo la modalidad de autonomía/marketplace (ver `CLAUDE.md` §3) — no aplica cuando el
Vínculo ya es un contrato de trabajo en relación de dependencia reconocido como tal.

## Tabla de advertencias (jurisdicción → función → texto)

| Función | Texto de advertencia mostrado al activar |
|---|---|
| Penalización de inasistencias o inconductas | Penalizar inasistencias o inconductas de un Asistente autónomo puede interpretarse como ejercicio de poder disciplinario, un indicio de subordinación bajo el art. 23 de la LCT. Evaluá si esta función es coherente con la modalidad de vínculo de tus Asistentes. |
| Rankings | Publicar rankings que condicionan el acceso futuro a Guardias puede interpretarse como una forma de control jerárquico propia de una relación de dependencia (art. 23 LCT). |
| Puntuaciones por aceptación de Guardia | Puntuar la aceptación de Guardias y usarlo para asignar futuras oportunidades puede funcionar como una exigencia de disponibilidad, un indicio de subordinación (art. 23 LCT) más que de autonomía real del Asistente. |
| Puntuaciones por calificación de Familia/Paciente | Condicionar oportunidades futuras a una calificación de terceros puede interpretarse como una forma de evaluación de desempeño propia de una relación laboral (art. 23 LCT). |
| Límite de oportunidades futuras por rechazos | Limitar a un Asistente autónomo por rechazar Guardias reduce su libertad real de decidir su participación, un elemento central para sostener que la relación es autónoma y no dependiente (art. 23 LCT). |
| Niveles/categorías/jerarquías por servicio | Establecer niveles o categorías jerárquicas puede interpretarse como una estructura organizativa propia de relación de dependencia (art. 23 LCT). |
| Horarios fijos | Imponer horarios fijos (en vez de que el Asistente decida su disponibilidad) es uno de los indicios más fuertes de subordinación bajo el art. 23 de la LCT. |

## Notas de aplicación

- Estas advertencias se muestran una vez, al activar la función, y quedan auditadas (quién,
  cuándo, qué función, qué advertencia se mostró) — ver `CLAUDE.md` §3.
- Ninguna de estas funciones está bloqueada ni restringida por este documento: están
  disponibles sin restricción desde el día uno, coherente con el principio de diseño de
  `CLAUDE.md` §3 ("el software no impone ni bloquea funciones por razones legales — solo
  advierte").
- Si se agrega una función nueva de gestión de Asistentes no listada acá, corresponde
  evaluar si aplica el mismo riesgo del art. 23 LCT y sumar su fila a esta tabla antes de
  activarla para una Prestadora real de Argentina.

## Modalidad marketplace — riesgo invertido

> Diseño completo en `docs/PRD_07_Modalidad_Marketplace.md` (2026-07-24). Acá solo la
> tabla de advertencias que corresponde a esta jurisdicción — pendiente de revisión por un
> abogado laboralista antes de una Prestadora real en esta modalidad, igual que el resto de
> este documento (ver nota al inicio).

En prestación directa el riesgo es que la Prestadora controle tanto al Asistente que
parezca su empleadora. En marketplace el riesgo es el mismo principio del art. 23 LCT
aplicado al revés: que sea **la plataforma**, no la Familia, quien ejerza ese control de
forma agregada entre todas las Familias — mismo patrón que llevó a fallar en contra de
Uber en el Reino Unido (Uber BV vs Aslam, 2021).

Herramientas que la Familia opera sobre **su propio** Asistente contratado (horario,
penalización, calificación) no generan este riesgo — es la Familia ejerciendo su rol de
empleadora doméstica ya reconocido por la Ley de Personal de Casas Particulares (26.844),
no la plataforma. El riesgo aparece solo cuando la decisión es de la plataforma, agregada
entre todas las Familias:

| Función | Texto de advertencia mostrado al activar |
|---|---|
| Ranking o puntaje calculado por la plataforma que decide si un Asistente sigue apareciendo ante cualquier Familia | Un ranking calculado por la plataforma que condiciona si el Asistente sigue visible para cualquier Familia puede interpretarse como la plataforma decidiendo su acceso al trabajo en general, un indicio de subordinación bajo el art. 23 de la LCT — mismo hecho que pesó en contra de Uber en el caso Aslam (Reino Unido, 2021). |
| Consecuencia automática atada a la calificación agregada (ej. exclusión por debajo de un puntaje) | Atar una exclusión automática a la calificación agregada convierte la opinión de las Familias en una decisión algorítmica de la plataforma sobre el Asistente, un indicio de subordinación bajo el art. 23 de la LCT. |
| Precio u horario fijado por la plataforma para todas las Familias por igual | Fijar precio u horario de forma centralizada, en vez de que cada Familia lo acuerde con su Asistente, es un indicio fuerte de subordinación bajo el art. 23 de la LCT. |
| Exclusividad exigida por la plataforma | Exigir exclusividad reduce la libertad real del Asistente de trabajar para otros, elemento central para sostener autonomía y no dependencia (art. 23 LCT). |
| Mediación de conflictos por la plataforma | Mediar activamente en conflictos entre Familia y Asistente puede interpretarse como dirección del vínculo, un indicio de subordinación bajo el art. 23 de la LCT. |

No generan advertencia en marketplace (bajo riesgo): calificación por estrellas visible
como opinión sin consecuencia automática, verificación de identidad/antecedentes, toggle de
disponibilidad del Asistente, y las herramientas de horario/penalización/calificación
cuando las opera la Familia sobre su propio vínculo.

## Indicaciones de medicación — riesgo de mala praxis por falta de habilitación

> Diseño completo en el pendiente #62 (`docs/PENDIENTES.md`). Acá solo la advertencia que
> corresponde a esta jurisdicción — pendiente de revisión por un abogado antes de una
> Prestadora real que active esta función, igual que el resto de este documento (ver nota
> al inicio).

El riesgo acá no es laboral (art. 23 LCT) sino de **ejercicio ilegal de una profesión de la
salud / mala praxis**: ciertas vías de administración de medicación (por ejemplo,
inyectables) requieren una habilitación profesional específica según la ley de ejercicio de
la enfermería vigente (Ley 24.004 y su decreto reglamentario) — un/a Asistente sin matrícula
de enfermero/a no puede aplicar una inyección aunque la Familia y la Prestadora estén de
acuerdo. Si una Prestadora acepta una indicación de medicación y asigna la Guardia a un
Asistente sin la habilitación requerida para esa vía, y ocurre un incidente, la Prestadora
puede quedar expuesta a responsabilidad civil (mala praxis) y el propio Asistente a
responsabilidad por ejercicio ilegal de la profesión.

| Función | Texto de advertencia mostrado al activar |
|---|---|
| Aceptar una indicación de medicación cuya vía de administración requiere una habilitación (según `configuracion_habilitacion_via_medicacion` de la Prestadora) sin que ningún Asistente asignado al Paciente la tenga vigente | Ningún Asistente actualmente asignado a este Paciente cuenta con la habilitación profesional requerida para esta vía de administración (ej. aplicación de inyectables exige enfermero/a matriculado/a). Aceptar esta indicación sin asignar un Asistente habilitado puede generar responsabilidad por mala praxis ante un incidente. |

Notas de aplicación (mismo principio que el resto del documento, `CLAUDE.md` §3):

- La función nunca se bloquea: el Panel puede aceptar la indicación igual, la advertencia
  solo informa el riesgo y queda auditada (`auditoria_advertencias_legales`).
- El mapeo vía→habilitación requerida es configuración libre de cada Prestadora
  (`configuracion_habilitacion_via_medicacion`, tab "Habilitación de medicación" en
  Configuración del Panel) — este documento no fija qué vías requieren qué habilitación,
  solo documenta el riesgo detrás de la advertencia que el sistema ya trae seedeada
  (`inyectable → enfermero_matriculado`) como punto de partida, editable sin límite.
- Si en el futuro se agrega una vía de administración nueva con riesgo legal propio no
  cubierto por esta única advertencia, corresponde evaluarlo y, de aplicar, documentarlo acá
  antes de activarlo para una Prestadora real de Argentina.

## Fórmula de cálculo de cese

> Diseño completo en el pendiente #72 (`docs/PENDIENTES.md`). La estructura descrita acá
> vive como dato en `formulas_cese` (jurisdicción `AR`), interpretada genéricamente por
> `panel/src/lib/calcularCese.js` — este documento describe en lenguaje humano lo que esas
> filas codifican, no fija ningún valor nuevo. Pendiente de revisión por un abogado
> laboralista, igual que el resto de este documento (ver nota al inicio).

El cálculo de indemnización por cese de un Asistente en relación de dependencia depende de
la causal del cese (art. 231/232/241/242/244/245/248/249 LCT, art. 92 bis para el período de
prueba, arts. 178/182 para el agravamiento por embarazo o matrimonio). Cada causal compone
uno o más de estos componentes:

| Componente | Qué representa | Escala de la que depende (`escalas_legales`) |
|---|---|---|
| Preaviso sustitutivo | Días de preaviso adeudados, según antigüedad menor o mayor a 1 año | `preaviso_dias` (`menos_1_anio` / `mas_1_anio`) |
| Indemnización por antigüedad | Meses de mejor remuneración por año de antigüedad, con tope y piso mínimo | `indemnizacion_antiguedad`, `tope_indemnizatorio`, `piso_minimo_indemnizacion`, `fraccion_computable_antiguedad` |
| Integración del mes de despido | Días restantes hasta fin de mes calendario desde la fecha de cese | (aritmética de calendario, no depende de una escala) |
| Agravamiento por embarazo/matrimonio | Meses adicionales de remuneración que se suman sobre la indemnización de un despido sin causa | `multiplicador_agravado` (`embarazo_matrimonio`) |
| Verificación de período de prueba | Si la antigüedad está dentro de los días de período de prueba vigentes | `periodo_prueba_dias` |

Composición por causal (Argentina):

- **Renuncia**: sin monto a pagar por la Prestadora; solo informa el preaviso que el
  Asistente le adeudaría a su empleador si correspondiera.
- **Mutuo acuerdo** (art. 241 LCT): sin cálculo automático — el monto se define por acuerdo
  entre las partes, el sistema solo lo registra.
- **Período de prueba** (art. 92 bis LCT): sin indemnización si la antigüedad está dentro
  del período de prueba vigente; si lo excede, exige revisión de abogado (probablemente
  corresponda otra causal).
- **Despido sin causa** (arts. 232/233/245 LCT): indemnización por antigüedad + preaviso
  sustitutivo + integración del mes de despido.
- **Despido por embarazo o matrimonio** (arts. 178/182 LCT): el resultado íntegro de despido
  sin causa, más el agravamiento.
- **Despido con justa causa** (art. 242 LCT) / **abandono de trabajo** (art. 244 LCT): sin
  indemnización, pero exige revisión de abogado obligatoria antes de cerrar el registro.
- **Muerte del trabajador** (art. 248 LCT) / **muerte del empleador** (art. 249 LCT): la
  mitad de la indemnización por antigüedad; exige revisión de abogado en ambos casos. Muerte
  del empleador solo aplica cuando el vínculo es de dependencia directa con la familia, no
  con la Prestadora — el sistema lo advierte si no es así.

Quedan fuera de este cálculo automático, en cualquier jurisdicción (no dependen de la ley de
un país en particular): incapacidad absoluta, jubilación, fin de contrato comercial, muerte
de la persona cuidada.

### Sin fórmula cargada para una jurisdicción

Si una Prestadora opera en un país sin fila en `formulas_cese` para la causal elegida, el
sistema nunca aproxima con la fórmula de otro país (mismo principio que las advertencias de
este documento, `CLAUDE.md` §3): devuelve `requiereRevisionAbogado: true`, sin monto
calculado, y una advertencia indicando que la legislación de esa jurisdicción todavía no fue
investigada.

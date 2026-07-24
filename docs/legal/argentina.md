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

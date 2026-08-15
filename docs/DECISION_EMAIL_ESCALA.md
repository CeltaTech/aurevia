# Decisión pendiente: escalar el envío de emails más allá de la cuenta Gmail compartida

> Este documento es el destino de la alarma de `docs/PENDIENTES.md` #44, y hay que decirlo de
> entrada: **hoy esa alarma no existe.** Antes el Panel mostraba un aviso cuando la cantidad de
> Prestadoras certificadas llegaba a un umbral configurado. Ese umbral se fue a CeltaTech con la
> Etapa 2 de la separación CeltaTech/Careonys (2026-07-28), porque contar cuántas Prestadoras hay
> contratadas es un dato del negocio de CeltaTech, no del producto: se borró la columna que lo
> guardaba (`supabase/migrations/20260728210000_etapa2_aurevia_deja_de_ser_nivel_1.sql:353`) y se
> fueron con ella las rutas que la leían y la escribían
> (`backend/src/routes/panelConfiguracionPlataforma.js:43-49`). El rol que veía ese aviso,
> `Admin_plataforma`, tampoco existe más en Careonys (`CLAUDE.md` §5).
>
> **Mientras tanto no hay nada que avise solo: hay que mirarlo a mano.** Dónde lo aloja CeltaTech
> todavía no está decidido, y queda anotado como pendiente en `docs/PENDIENTES.md` #140. Hasta que
> se decida, la única forma de enterarse es contar cada tanto las Prestadoras certificadas y volver
> a leer este documento. Existe justamente para eso: que ese día el Desarrollador tenga todo lo ya
> investigado a mano sin tener que redescubrirlo.

## El problema

Todo el envío de emails de la plataforma —para **todas** las Prestadoras— sale hoy de una
única cuenta Gmail compartida (`notificaciones.aurevia@gmail.com`, configurada en
`SMTP_USER`/`SMTP_PASSWORD`, usada por `backend/src/utils/email.js`). Gmail (cuenta
normal, no Workspace) tiene un tope de **500 emails/día**, compartido entre todas las
Prestadoras a la vez, no por Prestadora.

Esto contradice la pregunta de diseño obligatoria de `CLAUDE.md` §2 ("¿esto funciona
correctamente cuando existan cientos de Prestadoras usando Careonys simultáneamente?") a
partir de cierto volumen. El aislamiento de **destinatarios** ya es correcto por
Prestadora (`destinatariosEvento()` nunca cruza el email de contacto de una Prestadora
con otra) — el cuello de botella es el **remitente/relay compartido**, no los destinatarios.

## Qué dispara emails hoy (inventario de código, no medición real — todavía no hay
Prestadoras reales en producción)

| Origen | Archivo | Patrón de envío |
|---|---|---|
| Activación de cuenta (Familia, Asistente, usuario Panel) | `activacionCuenta.js` | Ráfagas durante importaciones masivas |
| Cambio de estado de postulante | `panelNotificaciones.js` | 1 email por cambio de estado |
| Nueva postulación / nueva solicitud pública de servicio | `postulacionAsistente.js`, `solicitudServicio.js` | 1 email por evento |
| Vencimientos de documentación | `vencimientos.js` (cron diario) | 0-5 emails/día por Prestadora, agrupado por tipo de documento |
| Fallback de WhatsApp fallido | `whatsapp.js` | Solo cuando falla el envío de WhatsApp |

## Estimación de volumen (a partir del código, no de datos medidos)

- Régimen estable: **~10-30 emails/día por Prestadora**, con picos puntuales a cientos en
  el mismo día para una Prestadora que hace una importación masiva.
- Con 5 Prestadoras: ~50-150/día en promedio — cómodo, bien debajo del tope de 500/día.
- Con 10 Prestadoras: ~100-300/día en promedio — todavía debajo del tope, pero con mucho
  menos margen.
- El riesgo real no es el promedio, es la combinación de: (a) un día de importación
  masiva de una sola Prestadora que por sí sola sume varios cientos, superpuesto con (b)
  el tráfico normal del resto de las Prestadoras ese mismo día. Además, Gmail puede
  marcar/restringir la cuenta por "patrón de envío automatizado inusual" incluso sin
  llegar al tope numérico, porque no es una cuenta pensada para este uso.
- Proyectado a cientos de Prestadoras (la pregunta obligatoria de `CLAUDE.md` §2):
  ~4.000 emails/día a 200 Prestadoras × 20/día promedio — muy por encima del tope de
  Gmail. El pendiente es real a escala, no teórico.

## Opciones investigadas (precios reales, julio 2026 — reverificar vigencia antes de decidir)

| Proveedor | Costo aproximado | Notas |
|---|---|---|
| **Amazon SES** | ~US$0,10 por 1.000 emails (~US$0,0001/email) | El más barato por lejos a este volumen. Requiere verificar dominio propio y que AWS levante el modo "sandbox" inicial — más fricción de setup, no de complejidad técnica. |
| **Resend** | Gratis hasta 3.000/mes (tope 100/día); Pro US$20/mes hasta 50.000 | Integración simple (API key). |
| **Postmark** | Gratis (Developer) 100/mes permanente; Basic US$15/mes hasta 10.000; excedente US$1,80/1.000 | Integración simple (API key). |
| **SendGrid** | Sin plan gratis permanente (solo trial de 60 días); Essentials US$19,95/mes hasta 100.000 | — |

**A este volumen, el costo no es el factor decisivo** — cualquiera de las 4 opciones es
barata en términos absolutos. Lo que cambia es la fricción de setup: SES es el más
barato pero pide verificación de dominio + salida de sandbox en AWS; Resend/Postmark son
"pegar una API key y listo" a un costo levemente mayor.

## Caminos de solución (ya registrados en `docs/PENDIENTES.md` #44 antes de este documento)

1. **Migrar a un servicio transaccional dedicado** (SendGrid/Postmark/SES/Resend) con
   cuota propia — resuelve el problema de raíz, cuota deja de ser compartida entre
   Prestadoras.
2. **Cuota/limitador por Prestadora** sobre el mecanismo actual (Gmail) — más barato de
   implementar ya mismo, pero no resuelve que el tope total (500/día) siga siendo
   compartido; solo reparte el riesgo, no lo elimina. Tiene sentido como parche temporal,
   no como solución definitiva si el crecimiento de Prestadoras sigue.

## Qué decidir en el momento en que se dispare esta alarma

1. Reconfirmar el volumen real medido (ya no estimado) de las Prestadoras certificadas
   existentes — cuántos emails/día se están enviando de verdad, tomado de logs o de un
   contador a agregar en `email.js` si todavía no existe.
2. Revisar si los precios de esta tabla siguen vigentes (2026-07-26) o cambiaron.
3. Elegir entre migrar de proveedor ahora (opción 1) o subir el umbral con un
   limitador temporal (opción 2) mientras se planifica la migración.
4. Si se migra: `backend/src/utils/email.js` es el único punto de integración a tocar
   (nunca duplicar la lógica de envío en otro archivo — `CLAUDE.md` §7 Regla 12).
5. Una vez resuelto, cerrar `docs/PENDIENTES.md` #44 de verdad (proveedor nuevo en
   producción, o limitador funcionando) y subir el umbral de esta alarma si corresponde
   seguir usando Gmail un tiempo más con el nuevo margen.

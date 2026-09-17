# Cómo se conecta un software externo con Careonys

**Para quién es este documento.** Para quien programa el software de facturación o el de créditos
y cobranzas de una Prestadora, y tiene que avisarle a Careonys lo que pasó de su lado. No hace
falta saber nada de Careonys por dentro.

**Qué se necesita antes de empezar.** Dos datos que entrega la Prestadora, y que ella misma saca
de la pantalla de Configuración → Facturación de Familias:

1. **La dirección**, que ya viene armada con el identificador de esa Prestadora adentro.
2. **El secreto**, que ella escribe en esa misma pantalla. Es el único que lo conoce: Careonys lo
   guarda y no lo vuelve a mostrar nunca, ni a ella. Si se pierde, se carga uno nuevo.

**Mientras la Prestadora no haya cargado el secreto, no entra ningún aviso.** La puerta contesta
que no está autenticado, y eso es lo correcto: sin secreto no hay forma de probar que el aviso es
suyo.

---

## 1. Las dos puertas

Son dos, con secretos distintos, porque el software que factura y el que sigue la cobranza pueden
ser de dos proveedores que no se conocen. Compartir un solo secreto haría que cambiarlo en uno le
rompiera la conexión al otro.

| Qué se avisa | Dirección |
|---|---|
| Lo que se facturó | `POST /api/avisos-de-facturacion/<identificador de la Prestadora>` |
| Que a una Familia se le restringe el servicio por falta de pago | `POST /api/avisos-de-cobranza/<identificador de la Prestadora>` |

En las dos, **el identificador de la Prestadora va en la dirección y nunca en el cuerpo**. Lo que
venga adentro del aviso no elige sobre quién se escribe.

---

## 2. La firma

Ningún software de facturación publica cómo firma, porque no hay uno solo: cada Prestadora tiene
el suyo. Así que Careonys declara la suya, y es la misma para las dos puertas.

**El encabezado se llama `x-signature` y se escribe así:**

```
x-signature: ts=<instante>,v1=<firma>
```

- **`<instante>`** son los segundos transcurridos desde el 1 de enero de 1970 en horario universal
  (lo que devuelve `time()` en casi todos los lenguajes). Sin decimales.
- **`<firma>`** es el HMAC-SHA256, escrito en hexadecimal en minúsculas, calculado **con el secreto
  de la Prestadora** sobre este texto:

```
<instante> . <el cuerpo del pedido, exactamente los bytes que se envían>
```

Es decir: el instante, **un punto**, y el cuerpo tal cual sale. Nada más, sin espacios ni saltos de
línea agregados.

**Tres cosas que hacen fallar la firma aunque el cálculo esté bien:**

- **Rearmar el cuerpo.** La firma se calcula sobre los bytes exactos. Si se firma un texto y después
  se envía otro que sólo cambia en un espacio o en el orden de dos campos, no coincide. Se firma lo
  mismo que se manda.
- **El reloj corrido.** El instante tiene que caer dentro de **cinco minutos** de la hora real, para
  adelante o para atrás. Sirve para que un aviso auténtico copiado hace meses no se pueda volver a
  mandar hoy.
- **El tipo de contenido.** Tiene que ser `application/json`.

**Se puede mandar más de una firma**, separadas por coma (`ts=…,v1=…,v1=…`), y alcanza con que una
coincida. Sirve el día que se cambia el secreto: durante el cambio se mandan las dos y no se pierde
ningún aviso.

### Ejemplo del cálculo

```js
import { createHmac } from 'node:crypto';

const cuerpo = JSON.stringify({ /* … */ });          // esto es lo que se envía, tal cual
const instante = Math.floor(Date.now() / 1000);

const firma = createHmac('sha256', SECRETO)
  .update(`${instante}.`)
  .update(cuerpo)
  .digest('hex');

await fetch(DIRECCION, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-signature': `ts=${instante},v1=${firma}`,
  },
  body: cuerpo,
});
```

---

## 3. Avisar lo que se facturó

Careonys no emite comprobantes y no revisa ningún importe: guarda lo que informa quien emitió, tal
como llegó. El nombre del comprobante es texto y no se interpreta, así que sirve para cualquier país
sin cambiar nada.

**Una sola factura, en el cuerpo directamente:**

```json
{
  "factura_id": "…",
  "monto_facturado": 187543.21,
  "comprobante_tipo": "Factura B",
  "comprobante_numero": "0003-00001234"
}
```

**Varias, adentro de `facturas`:**

```json
{
  "facturas": [
    { "factura_id": "…", "monto_facturado": 187543.21, "comprobante_tipo": "Factura B", "comprobante_numero": "0003-00001234" },
    { "factura_id": "…", "monto_facturado": 94000.00,  "comprobante_tipo": "Factura C", "comprobante_numero": "0003-00001235" }
  ]
}
```

| Dato | Obligatorio | Qué es |
|---|---|---|
| `factura_id` | sí | Cuál de las facturas que Careonys mandó a facturar. Viene en el archivo de ida y en la pantalla de saldos |
| `monto_facturado` | sí | Cuánto quedó adeudando la Familia, **con los impuestos incluidos**. Es el importe que Careonys reclama |
| `comprobante_tipo` | sí | Cómo se llama el comprobante que se emitió, como lo llame el país. Texto libre |
| `comprobante_numero` | no | El número que le puso el software de facturación |
| `fecha_vencimiento` | no | `AAAA-MM-DD`. **Sólo si vence en otra fecha que la acordada.** Si no viene, la acordada no se toca |

**Hasta 500 facturas por aviso.**

**Respuesta**, renglón por renglón, para que se sepa qué pasó con cada una:

```json
{
  "anotadas": 1,
  "ya_facturadas": 0,
  "rechazadas": 0,
  "resultados": [
    { "indice": 0, "factura_id": "…", "resultado": "anotado" }
  ]
}
```

**Repetir un aviso no hace daño.** Una factura que ya tiene comprobante anotado no se pisa: se
contesta `ya_facturada` y se sigue. Así, un software que reintenta porque no le llegó la respuesta
no termina cambiando lo que ya se había guardado.

**Un renglón malo no arruina el aviso.** Los demás se anotan igual, y el que falló dice por qué.

---

## 4. Avisar cómo va la cobranza de una Familia

Es el otro sentido: la Prestadora eligió que la cobranza la siga otro software, y ese software
cuenta por acá cómo viene cada Familia. Dos cosas puede decir, **juntas o por separado, y por lo
menos una**:

- **Que se le restringe el servicio**, o que deja de estarlo.
- **Cómo está su cuenta**: cuánto debe, en qué moneda y si está atrasada.

```json
{
  "familia_id": "…",
  "restringida": true,
  "motivo": "Factura vencida hace más de 60 días",
  "numero_del_aviso": "AV-2026-000412",
  "estado_de_cuenta": {
    "saldo": 48500.50,
    "moneda": "ARS",
    "atrasado": true,
    "dias_de_atraso": 12,
    "vencimiento_mas_antiguo": "2026-08-10",
    "fecha_del_estado": "2026-09-17"
  }
}
```

| Dato | Obligatorio | Qué es |
|---|---|---|
| `familia_id` | sí | De qué Familia se trata |
| `restringida` | si no va `estado_de_cuenta` | `true` cuando empieza la restricción, `false` cuando se levanta |
| `motivo` | no | Hasta 500 caracteres |
| `numero_del_aviso` | no | El número del aviso del lado de quien lo manda. **Repetir el mismo número no anota dos veces** |
| `estado_de_cuenta` | si no va `restringida` | Cómo está la cuenta de esa Familia |

Y adentro de `estado_de_cuenta`:

| Dato | Obligatorio | Qué es |
|---|---|---|
| `saldo` | sí | Cuánto debe. **Negativo es saldo a favor** |
| `moneda` | sí | Código de tres letras, en mayúsculas: `ARS`, `USD`, `BRL` |
| `atrasado` | sí | Si quien lleva la cobranza la considera atrasada |
| `dias_de_atraso` | no | Días enteros, nunca negativo |
| `vencimiento_mas_antiguo` | no | La fecha impaga más vieja, `AAAA-MM-DD` |
| `fecha_del_estado` | no | De qué día es esta foto de la cuenta, `AAAA-MM-DD` |

**Lo que no se informa queda vacío, y Careonys no lo completa.** No se deducen los días de atraso
de ninguna fecha, no se suma nada y no se compara contra lo que este sistema tenga anotado: lo que
entra se guarda y se muestra tal como llegó. Careonys **no decide nada sobre estos datos ni los
discute**. Qué se hace con una Familia restringida o atrasada lo decide la Prestadora.

**Careonys no pide ningún dato fiscal de quien paga, y no lo va a guardar.** Con qué número está
inscripta esa persona y bajo qué condición es asunto de quien factura.

---

## 5. Qué contesta cada puerta

| Código | Qué quiere decir | Qué hacer |
|---|---|---|
| `200` | El aviso entró. Mirar los renglones de la respuesta | Nada |
| `400` | El aviso estaba firmado bien, pero algún dato está mal. La respuesta dice cuál | Corregir el dato y reenviar |
| `401` | No se pudo probar que el aviso sea auténtico | Ver más abajo |
| `404` | Sólo en el aviso de cobranza: esa Familia no es de esta Prestadora | Revisar el identificador |

En el aviso de facturación no hay `404`: una factura que no es de esta Prestadora se contesta
adentro de la respuesta, en su renglón, igual que si no existiera. Decir cuál identificador cae
adentro y cuál no sería enseñar a encontrarlos.

**El `401` contesta siempre lo mismo, sin decir qué falló**, y es a propósito: detallar cuál de las
comprobaciones no pasó es enseñar a pasarla. Las causas posibles son cinco, y conviene revisarlas en
este orden:

1. La Prestadora todavía no cargó el secreto.
2. Falta el encabezado `x-signature`, o está escrito con otra forma.
3. El reloj está corrido más de cinco minutos.
4. La firma se calculó con otro secreto.
5. Se firmó un texto y se envió otro.

---

## 6. Lo que esta puerta no hace

- **No reemplaza al software de facturación.** Careonys no emite comprobantes, no tiene numeración
  autorizada, no discrimina impuestos y no calcula ningún importe fiscal.
- **No revisa el monto.** No conoce los impuestos de ningún país, así que no compara lo que llega
  contra nada.
- **No anula una factura.** Una factura emitida se corrige emitiendo otro comprobante del lado de
  quien la emitió, y avisando la nueva por esta misma puerta.
- **No es la única forma de trabajar.** Se puede seguir anotando factura por factura a mano, o
  bajando y subiendo un archivo. Las tres escriben lo mismo y se pueden combinar.

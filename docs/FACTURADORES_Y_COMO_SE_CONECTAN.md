# Con qué software de facturación se conecta Careonys, y cómo

**Por qué existe este documento.** No hay una primera Prestadora todavía, así que no hay un nombre.
El primer software de facturación que se conecte será el que ella elija, si es que no prefiere
cargar a mano o intercambiar una planilla. Entonces, en vez de esperar ese nombre, se miró qué
software se usa en Argentina y cómo se conecta cada uno, para saber **cuánto cuesta agregar el
primero y cuánto cuesta agregar el segundo**.

---

## 1. La conclusión

**Todos se conectan de la misma forma general y con datos distintos.** Ninguno obliga a rehacer
nada de lo construido. Lo que cambia de uno a otro son tres cosas: con qué credencial se entra,
cómo se llaman los campos, y si el software puede avisar por su cuenta lo que emitió. Eso es
exactamente lo que ya está previsto que sea una pieza por software.

**Y hay un límite que vale para los cinco:** Careonys no guarda con qué número se identifica
fiscalmente quien paga, y no lo va a guardar. Eso es dato de facturación puro, y lo tiene quien
factura, en su propio padrón de clientes. Careonys le dice a quién cobrarle y cuánto; con qué
número figura esa persona ante el organismo fiscal es asunto del software de facturación.

---

## 2. Los que se usan en Argentina y cómo se entra a cada uno

| Software | Cómo se entra | Puede avisar solo lo que emitió |
|---|---|---|
| **TusFacturasAPP** | Clave y testigo propios de la cuenta | Sí, avisa a la dirección que se le configure |
| **Xubio** | Credencial de dos partes que se cambia por un pase con vencimiento | No está documentado |
| **Colppy** | Usuario y contraseña, y todo entra por una sola dirección | No está documentado |
| **Contabilium** | Credencial de dos partes, igual que Xubio | No está documentado |
| **Sistemas 360** | Clave propia de la cuenta | No está documentado |

**Lo que tienen en común, y es lo que importa:** los cinco reciben los pedidos por el mismo
mecanismo de siempre —el que usa cualquier página de internet para hablar con otra—, los datos
viajan en el mismo formato, y los cinco devuelven lo mismo que Careonys necesita anotar: cómo se
llama el comprobante, qué número le tocó y el código de autorización del organismo fiscal.

**Lo que cambia:** el nombre de cada campo y la forma de la credencial. Eso es traducción, y es
poco trabajo por software. **Ninguno obliga a tocar a los demás**, que es la condición que el plan
ya tenía escrita.

---

## 3. Los dos sentidos, y en cuál estamos

**De Careonys hacia el software de facturación** —«cobrale tanto a esta Familia»—. Es la mitad que
falta, y es la que hay que escribir una vez por software. Hoy ese mismo pedido sale en un archivo
que alguien baja y entrega.

**Del software de facturación hacia Careonys** —«emití este comprobante, con este número, por este
importe»—. Esta mitad **ya está construida, probada y publicada**, y es una sola para todos.

Pero hay un detalle que conviene tener claro, porque cambia las cuentas:

> **Un software de facturación comprado no va a avisar con la firma que Careonys pide.** Careonys
> tiene su propia forma de comprobar que un aviso es auténtico, y quien programe a medida la puede
> seguir sin problema —para eso está `docs/CONEXION_CON_SOFTWARE_EXTERNO.md`—. Pero un producto ya
> hecho avisa a su manera, no a la nuestra. TusFacturasAPP, por ejemplo, avisa a la dirección que
> se le configure y no firma nada.

De ahí sale que la pieza por software tiene **dos mitades chicas** en vez de una: traducir el
pedido de ida, y recibir el aviso de vuelta como ese software lo mande. Las dos terminan
escribiendo en el mismo lugar de siempre (`backend/src/utils/anotarLoFacturado.js`), así que el
resto del producto no se entera de por cuál entró.

---

## 4. Lo que falta, y no depende de cuál se elija

**Falta que los dos lados sepan que están hablando de la misma persona.** Hoy, lo que sale hacia el
software de facturación es: de quién es la factura, a quién se le reclama por nombre, de qué
período, en qué moneda, por cuánto y para cuándo
(`panel/src/lib/intercambioDeFacturacion.js`, `COLUMNAS_QUE_SALEN`).

Con el archivo a mano eso alcanza, porque quien lo carga reconoce a sus clientes por el nombre.
**Con conexión directa no alcanza**, porque no hay nadie del otro lado que reconozca nada: el
software recibe un nombre y tiene que saber a cuál de sus clientes corresponde.

Lo que falta entonces **no es el dato fiscal, es la correspondencia**: que cada Familia de Careonys
se corresponda con el cliente que el software de facturación ya tiene cargado. Una referencia, y
nada más. El número de identificación fiscal, la condición frente al organismo y qué clase de
comprobante corresponde viven del otro lado, que es donde se factura.

---

## 5. Qué se hace, entonces

1. **Resolver cómo se corresponde cada Familia con el cliente del otro lado.** Es lo único que la
   conexión directa necesita y hoy no existe.
2. **Esperar a la primera Prestadora** para escribir la pieza de su software. Antes de eso, escribir
   una es elegir a ciegas entre cinco y acertar con suerte.
3. **Si esa Prestadora usa un software que avisa solo lo que emitió** —como TusFacturasAPP—, la
   mitad de vuelta es todavía menos trabajo, porque la parte que anota ya está hecha.

**Y una posibilidad que no hay que perder de vista:** CeltaTech tiene en carpeta desarrollar su
propio software de facturación. Si eso ocurre, esa conexión es una pieza más de esta misma lista, y
la única diferencia es que las dos puntas serían de la misma casa. **No incide en este desarrollo**,
y esta estructura lo admite sin obra mayor.

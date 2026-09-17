// La puerta por la que el software de facturación avisa lo que emitió.
//
// POR QUÉ EXISTE. Careonys no emite comprobantes: manda a facturar y guarda lo que informa el
// software de facturación de la Prestadora. Eso ya se podía hacer de dos maneras —cargado a mano
// factura por factura, o por un archivo que se baja y se sube—. Falta la conexión directa, que
// tiene dos mitades que no se parecen en nada:
//
//   1. Careonys llamando a ese software. Cada uno se llama distinto, así que esa mitad es una
//      pieza por software y no se escribe sin el manual de uno concreto.
//   2. Ese software llamando a Careonys. Ésta. Es **una sola para todos**, porque lo que llega son
//      siempre los mismos datos, y por eso se puede construir sin saber todavía cuál será el
//      primero que se conecte.
//
// QUÉ ENTRA. Lo mismo que trae el archivo de vuelta: de qué factura se trata, cómo se llama el
// comprobante, qué número tiene, por cuánto quedó y —si quien emitió informa uno distinto del
// acordado— para cuándo vence. Se puede mandar una factura o varias en el mismo aviso. Qué datos
// son y qué se hace con cada renglón está escrito una sola vez en
// `utils/intercambioDeFacturacion.js`, que es el mismo archivo que usan la carga a mano y el
// archivo: los tres caminos entran por la misma puerta.
//
// NINGÚN PAÍS ENTRA EN EL CÓDIGO. El nombre del comprobante es texto que se guarda y no se
// interpreta, y el monto es el que informa quien emitió: el producto no conoce los impuestos de
// ningún país y no compara ese número contra nada.
//
// CÓMO SE SABE QUE EL AVISO ES DE VERDAD. Es una dirección pública: la llama un software de
// afuera, no alguien con sesión. Se hace lo mismo que con el aviso del otro software de cobranzas:
//
//   1. **La Prestadora viaja en la dirección, no en el cuerpo.** Lo que venga adentro no elige
//      sobre quién se escribe.
//   2. **El cuerpo se recibe crudo**, porque la firma se calcula sobre los bytes exactos que
//      llegaron. Por eso este router trae su propio lector (`express.raw`) y en `server.js` se
//      monta antes del `express.json()` general.
//   3. **Ante cualquier duda se corta con 401, antes de tocar una sola fila.**
//   4. **La factura tiene que ser de esa Prestadora.** Si no lo es, se contesta lo mismo que si no
//      existiera, porque decir cuál identificador cae adentro y cuál no es enseñar a encontrarlos.
//
// Y EL MISMO AVISO REPETIDO NO HACE DAÑO. Una factura que ya tiene comprobante anotado no se pisa:
// se contesta que ya estaba. Así el software que reintenta porque no le llegó la respuesta no
// termina cambiando lo que ya se había guardado.
//
// NINGÚN SOFTWARE DE FACTURACIÓN PUBLICA CÓMO FIRMA, porque no hay uno solo: cada Prestadora tiene
// el suyo. Entonces se usa la convención que este producto ya declara para ese caso, la de
// `pasarelas/firmaWebhook.js`: cabecera `x-signature`, con la forma
// `ts=<instante>,v1=<hmac-sha256 en hexadecimal>` calculado sobre `<instante>.<cuerpo crudo>`.
import express, { Router } from 'express';
import { comprobarFirmaSinEsquemaPublicado } from '../pasarelas/firmaWebhook.js';
import { supabase } from '../db/connection.js';
import { anotarLoFacturado, facturaParaAnotar } from '../utils/anotarLoFacturado.js';
import {
  TOPE_DE_FILAS,
  esIdentificador,
  loFacturadoDeLaFila,
  queHacerConLaFilaFacturada,
} from '../utils/intercambioDeFacturacion.js';

export const avisoDeFacturacionExternaRouter = Router();

/** La Prestadora llega en la dirección, así que lo primero que se mira es que tenga forma de
 *  identificador. Sin esto, cualquier texto suelto se le pasa a la base y el error que vuelve
 *  habla de tipos de columna: ruido en el registro por algo que se contesta acá mismo. */
const FORMA_DE_IDENTIFICADOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

avisoDeFacturacionExternaRouter.use(express.raw({ type: 'application/json', limit: '512kb' }));

avisoDeFacturacionExternaRouter.post('/:prestadoraId', async (req, res) => {
  const { prestadoraId } = req.params;

  function rechazar(motivo) {
    // El motivo queda del lado del servidor. Al que golpeó la puerta se le contesta siempre lo
    // mismo: decirle cuál de las comprobaciones falló es enseñarle a pasarla.
    console.warn('Aviso de facturacion rechazado:', prestadoraId, motivo);
    return res.status(401).json({ error: 'Aviso no autenticado' });
  }

  if (!FORMA_DE_IDENTIFICADOR.test(prestadoraId)) return rechazar('prestadora_de_la_direccion_ilegible');

  // Si esto no es un Buffer, el lector de cuerpo crudo no corrió: o el router quedó montado
  // después del `express.json()` general, o el que llama mandó un tipo de contenido que no es
  // JSON. En los dos casos no hay con qué comprobar la firma, y sin eso no se sigue.
  const cuerpoCrudo = Buffer.isBuffer(req.body) ? req.body : null;
  if (!cuerpoCrudo) return rechazar('cuerpo_crudo_ausente');

  const { data: secreto } = await supabase.rpc('leer_secreto_del_aviso_de_facturacion', {
    p_prestadora_id: prestadoraId,
  });

  // Sin secreto cargado esa Prestadora no conectó ningún software de facturación, y no hay con qué
  // probar que el aviso es suyo. Se rechaza; nunca «se sigue igual».
  const comprobacion = comprobarFirmaSinEsquemaPublicado({
    secretoFirma: secreto,
    // Acá no hay secreto de ambiente que valga: un secreto compartido probaría quién firmó, no de
    // qué Prestadora es el aviso, y de esto hay uno por Prestadora o no hay ninguno.
    secretoDeAmbiente: null,
    headers: req.headers,
    cuerpoCrudo,
  });
  if (!comprobacion.valido) return rechazar(comprobacion.motivo);

  let cuerpo;
  try {
    cuerpo = JSON.parse(cuerpoCrudo.toString('utf8'));
  } catch {
    console.warn('Aviso de facturacion rechazado:', prestadoraId, 'cuerpo_ilegible');
    return res.status(400).json({ error: 'Cuerpo ilegible' });
  }

  // De acá para abajo el aviso ya está probado auténtico, así que lo que falle sí se contesta con
  // detalle: del otro lado hay un software que tiene que poder corregir lo que mandó mal.
  //
  // Una factura sola y varias se escriben igual: el que manda una no tiene por qué armar una
  // lista de uno, y el que manda muchas no tiene por qué hacer un pedido por cada una.
  const filas = Array.isArray(cuerpo?.facturas) ? cuerpo.facturas : [cuerpo];
  if (filas.length === 0) return res.status(400).json({ error: 'El aviso no trae ninguna factura' });
  if (filas.length > TOPE_DE_FILAS) {
    return res.status(400).json({ error: `Se atienden hasta ${TOPE_DE_FILAS} facturas por aviso` });
  }

  const resultados = [];
  const yaVistas = new Set();

  for (let i = 0; i < filas.length; i += 1) {
    const facturado = loFacturadoDeLaFila(filas[i] || {});
    const renglon = { indice: i, factura_id: facturado.factura_id || null };

    const yaVista = yaVistas.has(facturado.factura_id);
    let factura = null;
    if (!yaVista && esIdentificador(facturado.factura_id)) {
      const { data, error } = await facturaParaAnotar(prestadoraId, facturado.factura_id);
      if (error) {
        console.error('No se pudo leer la factura del aviso:', prestadoraId, error.message);
        return res.status(500).json({ error: 'No se pudo atender el aviso' });
      }
      factura = data;
    }

    const decision = queHacerConLaFilaFacturada(facturado, { yaVista, factura });
    if (decision.resultado !== 'anotado') {
      resultados.push({ ...renglon, ...decision });
      continue;
    }

    const { error } = await anotarLoFacturado(prestadoraId, factura.id, facturado);
    if (error) {
      console.error('No se pudo anotar lo facturado:', prestadoraId, error.message);
      return res.status(500).json({ error: 'No se pudo atender el aviso' });
    }

    yaVistas.add(facturado.factura_id);
    resultados.push({ ...renglon, resultado: 'anotado' });
  }

  return res.status(200).json({
    anotadas: resultados.filter((r) => r.resultado === 'anotado').length,
    ya_facturadas: resultados.filter((r) => r.resultado === 'ya_facturada').length,
    rechazadas: resultados.filter((r) => r.resultado === 'rechazado').length,
    resultados,
  });
});

// La puerta por la que el otro software de créditos y cobranzas avisa cómo va la cobranza.
//
// POR QUÉ EXISTE. Una Prestadora puede decidir que el seguimiento de la cobranza no es de este
// sistema sino de otro software suyo. Con esa decisión tomada, ese software es el que sabe cómo
// viene cada Familia, y por acá lo cuenta. Dos cosas puede decir, juntas o por separado: **si a
// una Familia hay que ponerle alguna restricción**, y **cómo está su cuenta** —cuánto debe, en qué
// moneda y si está atrasada—. Un aviso trae por lo menos una de las dos.
//
// Y NADA DE ESO SE CALCULA ACÁ. Lo que entra se anota y se muestra tal como llegó. No se completa
// con lo que este sistema tenga anotado y no se compara contra nada: un saldo que llega de afuera
// y otro calculado acá serían dos verdades para lo mismo.
//
// LO QUE ESTE AVISO NO HACE. No corta ningún Servicio, no cancela ninguna Guardia y no bloquea
// ninguna pantalla. Se anota y se muestra. Quien decide qué hacer con una Familia que no paga es
// una persona de la Prestadora.
//
// CÓMO SE SABE QUE EL AVISO ES DE VERDAD. Es una dirección pública: la llama un software de
// afuera, no alguien con sesión. Se hace lo mismo que con los avisos de cobro de las pasarelas:
//
//   1. **La Prestadora viaja en la dirección, no en el cuerpo.** Una dirección distinta por
//      Prestadora. Lo que venga adentro del cuerpo no elige sobre quién se escribe.
//   2. **El cuerpo se recibe crudo**, porque la firma se calcula sobre los bytes exactos que
//      llegaron. Por eso este router trae su propio lector (`express.raw`) y en `server.js` se
//      monta antes del `express.json()` general.
//   3. **Ante cualquier duda se corta con 401, antes de tocar una sola fila.** No hay secreto
//      cargado, falta la cabecera, el instante venció, la firma no da: se rechaza.
//   4. **La Familia tiene que ser de esa Prestadora.** Si no lo es, no se contesta que no existe:
//      se contesta lo mismo que si no se encontrara nada, porque decir cuál identificador cae
//      adentro y cuál no es enseñar a encontrarlos.
//
// NINGÚN SOFTWARE DE CRÉDITOS Y COBRANZAS PUBLICA CÓMO FIRMA, porque no hay uno solo: cada
// Prestadora tiene el suyo. Entonces se usa la convención que este producto ya declara para ese
// caso, la de `pasarelas/firmaWebhook.js`: cabecera `x-signature`, con la forma
// `ts=<instante>,v1=<hmac-sha256 en hexadecimal>` calculado sobre `<instante>.<cuerpo crudo>`.
import express, { Router } from 'express';
import { supabase } from '../db/connection.js';
import { comprobarFirmaSinEsquemaPublicado } from '../pasarelas/firmaWebhook.js';
import { aDosDecimales, loQueEstaMalEnElAviso } from '../utils/facturacionDeFamilias.js';

export const avisoDeCobranzaExternaRouter = Router();

/** La Prestadora llega en la dirección, así que lo primero que se mira es que tenga forma de
 *  identificador. Sin esto, cualquier texto suelto se le pasa a la base y el error que vuelve
 *  habla de tipos de columna: ruido en el registro por algo que se contesta acá mismo. */
const FORMA_DE_IDENTIFICADOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo más largo que puede medir el motivo que manda el otro software. No hay por qué guardar un
 *  texto sin fin, y el borde vive acá y no en la base para poder contestar por qué se rechazó. */
const LARGO_MAXIMO_DEL_MOTIVO = 500;

/** Motivos propios de esta entrada. Se anotan del lado del servidor; al que llama se le contesta
 *  siempre lo mismo. */
const MOTIVO_AVISO = {
  PRESTADORA_ILEGIBLE: 'prestadora_de_la_direccion_ilegible',
  CUERPO_ILEGIBLE: 'cuerpo_ilegible',
};

avisoDeCobranzaExternaRouter.use(express.raw({ type: 'application/json', limit: '256kb' }));

avisoDeCobranzaExternaRouter.post('/:prestadoraId', async (req, res) => {
  const { prestadoraId } = req.params;

  function rechazar(motivo) {
    // El motivo queda del lado del servidor. Al que golpeó la puerta se le contesta siempre lo
    // mismo: decirle cuál de las comprobaciones falló es enseñarle a pasarla.
    console.warn('Aviso de restriccion rechazado:', prestadoraId, motivo);
    return res.status(401).json({ error: 'Aviso no autenticado' });
  }

  if (!FORMA_DE_IDENTIFICADOR.test(prestadoraId)) return rechazar(MOTIVO_AVISO.PRESTADORA_ILEGIBLE);

  // Si esto no es un Buffer, el lector de cuerpo crudo no corrió: o el router quedó montado
  // después del `express.json()` general, o el que llama mandó un tipo de contenido que no es
  // JSON. En los dos casos no hay con qué comprobar la firma, y sin eso no se sigue.
  const cuerpoCrudo = Buffer.isBuffer(req.body) ? req.body : null;
  if (!cuerpoCrudo) return rechazar('cuerpo_crudo_ausente');

  const { data: secreto } = await supabase.rpc('leer_secreto_del_aviso_de_cobranza', {
    p_prestadora_id: prestadoraId,
  });

  // Sin secreto cargado esa Prestadora no conectó ningún software de cobranzas, y no hay con qué
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
    console.warn('Aviso de restriccion rechazado:', prestadoraId, MOTIVO_AVISO.CUERPO_ILEGIBLE);
    return res.status(400).json({ error: 'Cuerpo ilegible' });
  }

  // De acá para abajo el aviso ya está probado auténtico, así que lo que falle sí se contesta con
  // detalle: del otro lado hay un software que tiene que poder corregir lo que mandó mal.
  const malo = loQueEstaMalEnElAviso(cuerpo);
  if (malo) return res.status(400).json({ error: 'Aviso incompleto', dato: malo });

  if (!FORMA_DE_IDENTIFICADOR.test(String(cuerpo.familia_id))) {
    return res.status(400).json({ error: 'Aviso incompleto', dato: 'familia_id' });
  }

  const motivo = String(cuerpo.motivo ?? '').trim();
  if (motivo.length > LARGO_MAXIMO_DEL_MOTIVO) {
    return res.status(400).json({ error: 'Aviso incompleto', dato: 'motivo' });
  }

  // Qué trae este aviso. La comprobación de que trae por lo menos una de las dos cosas ya la hizo
  // `loQueEstaMalEnElAviso`; acá sólo se mira cuál de las dos para saber qué anotar.
  const traeRestriccion = cuerpo.restringida !== undefined && cuerpo.restringida !== null;
  const traeEstado = cuerpo.estado_de_cuenta !== undefined && cuerpo.estado_de_cuenta !== null;

  // La Familia tiene que ser de esta Prestadora. El disparador de la base resuelve la Prestadora a
  // partir de la Familia, así que un aviso de una Familia ajena caería en la Prestadora de ella:
  // sin este control, quien tiene el secreto de una podría escribir sobre cualquier otra.
  const { data: familia } = await supabase
    .from('familias')
    .select('id')
    .eq('id', cuerpo.familia_id)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (!familia) return res.status(404).json({ error: 'Familia inexistente' });

  const numeroDelAviso = String(cuerpo.numero_del_aviso ?? '').trim() || null;

  // El mismo aviso mandado dos veces no es un problema: el software de afuera reintenta cuando no
  // le llegó la respuesta. Lo que ya estaba anotado se deja como está y se sigue con lo demás —no
  // se corta acá—, porque un aviso que trae las dos cosas puede haber anotado una sola la vez
  // anterior. `23505` es la clave repetida.
  let todoEstabaAnotado = true;
  async function anotar(tabla, fila, queEs) {
    const { error } = await supabase.from(tabla).insert(fila);
    if (!error) {
      todoEstabaAnotado = false;
      return true;
    }
    if (error.code === '23505') return true;
    console.error('No se pudo anotar el aviso:', prestadoraId, queEs, error.message);
    return false;
  }

  if (traeRestriccion) {
    const anotada = await anotar('restricciones_de_cobranza', {
      familia_id: familia.id,
      restringida: cuerpo.restringida,
      motivo: motivo || null,
      origen: 'software_externo',
      numero_del_aviso: numeroDelAviso,
    }, 'restriccion');
    if (!anotada) return res.status(500).json({ error: 'No se pudo anotar el aviso' });
  }

  if (traeEstado) {
    const estado = cuerpo.estado_de_cuenta;
    const anotado = await anotar('estados_de_cuenta_externos', {
      familia_id: familia.id,
      saldo: aDosDecimales(estado.saldo),
      moneda: estado.moneda,
      atrasado: estado.atrasado,
      dias_de_atraso: estado.dias_de_atraso ?? null,
      vencimiento_mas_antiguo: estado.vencimiento_mas_antiguo ?? null,
      fecha_del_estado: estado.fecha_del_estado ?? null,
      numero_del_aviso: numeroDelAviso,
    }, 'estado_de_cuenta');
    if (!anotado) return res.status(500).json({ error: 'No se pudo anotar el aviso' });
  }

  if (todoEstabaAnotado) return res.status(200).json({ ok: true, repetido: true });
  return res.status(200).json({ ok: true });
});

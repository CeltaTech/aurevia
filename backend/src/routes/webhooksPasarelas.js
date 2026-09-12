// Pendiente #85 — webhooks entrantes de las pasarelas de pago. Sin `requiereRolPanel`: el
// que llama es el proveedor, no un usuario logueado del Panel. La Prestadora viaja en la
// propia URL del webhook (una URL distinta por Prestadora, configurada al conectar la
// pasarela) — así no hace falta adivinar a qué tenant pertenece el evento antes de leer la
// credencial correspondiente.
//
// Pendiente #159 — que la dirección sea pública quiere decir que cualquiera puede golpearla.
// Lo único que separa un aviso de cobro de verdad de uno inventado es la firma que trae, y
// esa firma se comprueba acá antes de tocar una sola fila. Dos consecuencias de eso, que son
// las que hacen que esto funcione:
//
//   1. **El cuerpo se recibe crudo.** La firma se calcula sobre los bytes exactos que mandó
//      la pasarela. Si express los convierte a objeto y el adaptador los vuelve a convertir a
//      texto, el resultado se parece pero no es igual —un espacio, el orden de dos campos, un
//      acento escapado— y la firma no coincide nunca. Por eso este router trae su propio
//      lector de cuerpo (`express.raw`) y en `server.js` se monta **antes** del
//      `express.json()` general, que si no se lleva el pedido primero.
//   2. **Ante la duda se corta con 401.** No hay fila de credenciales, no hay secreto de
//      firma guardado, falta la cabecera, la firma no da: se rechaza. Nunca "se sigue igual".

import express, { Router } from 'express';
import { supabase } from '../db/connection.js';
import { obtenerAdaptador, confirmaConsultando } from '../pasarelas/index.js';
import { esRechazoDeAutenticidad, MOTIVO } from '../pasarelas/firmaWebhook.js';
import { registrarCobroExitoso } from '../utils/cobrosMarketplace.js';
import { abrirElPeriodoDeGracia } from '../utils/periodoDeGracia.js';

export const webhooksPasarelasRouter = Router();

// El lector del cuerpo crudo viaja con el router y no suelto en `server.js`: quien monte este
// router se lleva el lector puesto, y lo único que hay que recordar afuera es montarlo antes
// del `express.json()` general. Un megabyte es holgado para el aviso más grande que manda
// cualquiera de las dos pasarelas.
webhooksPasarelasRouter.use(express.raw({ type: 'application/json', limit: '1mb' }));

webhooksPasarelasRouter.post('/:proveedor/:prestadoraId', async (req, res) => {
  const { proveedor, prestadoraId } = req.params;

  function rechazar(motivo) {
    // El motivo queda del lado del servidor. Al que golpeó la puerta se le contesta siempre
    // lo mismo: decirle cuál de las comprobaciones falló es enseñarle a pasarla.
    console.warn('Aviso de pasarela rechazado:', proveedor, prestadoraId, motivo);
    return res.status(401).json({ error: 'Aviso no autenticado' });
  }

  let adaptador;
  try {
    adaptador = obtenerAdaptador(proveedor);
  } catch {
    return res.status(404).json({ error: 'Proveedor desconocido' });
  }

  // Si esto no es un Buffer, el lector de cuerpo crudo no corrió: o el router quedó montado
  // después del `express.json()` general, o el que llama mandó un tipo de contenido que no
  // es JSON. En los dos casos no hay con qué comprobar la firma, y sin eso no se sigue.
  const cuerpoCrudo = Buffer.isBuffer(req.body) ? req.body : null;
  if (!cuerpoCrudo) return rechazar(MOTIVO.CUERPO_AUSENTE);

  let body;
  try {
    body = JSON.parse(cuerpoCrudo.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Cuerpo ilegible' });
  }

  const { data: credencialFila } = await supabase
    .from('credenciales_pasarela_pago')
    .select('credencial_secret_id, secreto_firma_secret_id')
    .eq('prestadora_id', prestadoraId)
    .eq('proveedor', proveedor)
    .maybeSingle();

  // Sin fila de credenciales no hay nada guardado para esta Prestadora en este proveedor: ni
  // credencial ni secreto de firma. Antes el proceso seguía igual y terminaba dando por bueno
  // un aviso que nadie firmó; ahora corta acá.
  if (!credencialFila) return rechazar(MOTIVO.SECRETO_AUSENTE);

  const [{ data: credencial }, { data: secretoFirma }] = await Promise.all([
    supabase.rpc('leer_credencial_pasarela_pago', {
      p_prestadora_id: prestadoraId,
      p_proveedor: proveedor,
    }),
    supabase.rpc('leer_secreto_firma_pasarela_pago', {
      p_prestadora_id: prestadoraId,
      p_proveedor: proveedor,
    }),
  ]);

  const { valido, motivo, referenciaExterna, estado } = adaptador.verificarWebhook({
    credencial,
    secretoFirma,
    headers: req.headers,
    consulta: req.query,
    cuerpoCrudo,
    body,
  });

  if (!valido) {
    // Un aviso que no se pudo probar auténtico se rechaza con 401. Los demás casos —viene
    // firmado de verdad pero adentro no trae ninguna referencia de cobro— siguen contestando
    // 200: reintentarlo no cambia nada, y devolver un error hace que el proveedor lo repita
    // indefinidamente.
    if (esRechazoDeAutenticidad(motivo)) return rechazar(motivo);
    return res.status(200).json({ ok: true });
  }

  // La referencia que trae el aviso puede ser una de dos cosas, y las dos son legítimas:
  //
  //   * **la del cobro**, en los rieles a los que este producto les arma el cobro mes a mes
  //     (`modo`, `cobranza_efectivo`): la referencia se guardó al armarlo y la fila ya existe;
  //   * **la del acceso**, en los rieles que cobran solos (`mercadopago`, `stripe`,
  //     `debin`): ahí no hay ninguna fila de ese mes, porque el que decidió cobrar fue el
  //     proveedor y de este lado nadie armó nada.
  //
  // Hasta acá se buscaba únicamente entre los cobros. Para el segundo grupo eso no encontraba
  // nunca nada: se contestaba 200 y se seguía de largo, así que el acceso cobraba todos los
  // períodos del lado del proveedor y en esta base no figuraba ninguno.
  const { data: cobro } = await supabase
    .from('cobros_marketplace')
    .select('id, acceso_id, periodo')
    .eq('prestadora_id', prestadoraId)
    .eq('referencia_externa', referenciaExterna)
    .maybeSingle();

  const { data: accesoDelAviso } = cobro
    ? { data: null }
    : await supabase
        .from('accesos_marketplace')
        .select('id, importe, proximo_cobro')
        .eq('prestadora_id', prestadoraId)
        .eq('referencia_externa', referenciaExterna)
        .maybeSingle();

  // Ni un cobro ni un acceso de esta Prestadora: el aviso vino firmado pero habla de algo
  // que acá no existe. Se contesta 200 para que el proveedor no lo repita para siempre.
  if (!cobro && !accesoDelAviso) {
    return res.status(200).json({ ok: true });
  }

  // Hay proveedores cuyo aviso no dice si la plata entró: dice que pasó algo con un cobro y
  // nada más. Para esos se vuelve a preguntar, de sistema a sistema, usando el mismo
  // identificador que acabó de matchear la fila — el mismo que venía firmado, no uno parecido.
  // Si la consulta se cae, el cobro queda como estaba: quedarse corto es recuperable, dar por
  // cobrada una plata que no entró no lo es.
  let estadoFinal = estado;
  if (confirmaConsultando(proveedor)) {
    try {
      const confirmado = await adaptador.consultarEstado({ credencial, referenciaExterna });
      estadoFinal = confirmado.estado;
    } catch (fallo) {
      console.warn('No se pudo confirmar el cobro con el proveedor:', proveedor, prestadoraId, fallo.message);
      return res.status(200).json({ ok: true });
    }
  }

  const accesoId = cobro ? cobro.acceso_id : accesoDelAviso.id;
  let periodo = cobro ? cobro.periodo : null;

  if (cobro) {
    await supabase.from('cobros_marketplace').update({ estado_cobro: estadoFinal }).eq('id', cobro.id);
  } else if (estadoFinal !== 'pendiente') {
    // El cobro del período nace acá, con el estado que trajo el aviso. Un aviso `pendiente` no
    // deja fila: no dice nada que se pueda anotar, y el mismo período puede traer varios antes de
    // que la plata entre.
    periodo = accesoDelAviso.proximo_cobro || new Date().toISOString().slice(0, 10);
    // Sin `referencia_externa`, a propósito: la que trajo el aviso es la del acceso, no la de este
    // período. Guardarla acá haría que el aviso del período siguiente encontrara esta misma fila y
    // pisara el cobro anterior en vez de anotar uno nuevo.
    const { error: errorInsertar } = await supabase.from('cobros_marketplace').insert({
      acceso_id: accesoId,
      prestadora_id: prestadoraId,
      medio: proveedor,
      monto: accesoDelAviso.importe,
      periodo,
      estado_cobro: estadoFinal,
    });
    if (errorInsertar) {
      console.error('No se pudo anotar el cobro que avisó la pasarela:', proveedor, prestadoraId, errorInsertar.message);
      return res.status(200).json({ ok: true });
    }
  }

  if (estadoFinal === 'exitoso') {
    // Quién mueve el acceso cuando entra la plata es uno solo, y es el mismo que usan las
    // dos cargas a mano del Panel (`utils/cobrosMarketplace.js`). Acá se contaba el mes siguiente
    // desde la fecha de hoy: con eso, un cobro que entraba tarde corría la fecha de cobro un poco
    // más cada mes, y el 31 de enero más un mes daba 3 de marzo.
    await registrarCobroExitoso({ accesoId, periodo });
  } else if (estadoFinal === 'fallido') {
    // Un cobro que no entra no suspende nada hoy: abre el período de gracia, se le avisa a la
    // Familia y se sigue reintentando hasta que se termine (`utils/periodoDeGracia.js`). Es el
    // resguardo del §3.2 del PRD del Marketplace, y acá se suspendía el mismo día.
    await abrirElPeriodoDeGracia({ accesoId });
  }

  res.status(200).json({ ok: true });
});

// Pendiente #85 — webhooks entrantes de las pasarelas de pago. Sin `requiereRolPanel`: el
// que llama es el proveedor, no un usuario logueado del Panel. La Prestadora viaja en la
// propia URL del webhook (una URL distinta por Prestadora, configurada al conectar la
// pasarela) — así no hace falta adivinar a qué tenant pertenece el evento antes de leer la
// credencial correspondiente.

import { Router } from 'express';
import { supabase } from '../db/connection.js';
import { obtenerAdaptador } from '../pasarelas/index.js';

export const webhooksPasarelasRouter = Router();

webhooksPasarelasRouter.post('/:proveedor/:prestadoraId', async (req, res) => {
  const { proveedor, prestadoraId } = req.params;

  let adaptador;
  try {
    adaptador = obtenerAdaptador(proveedor);
  } catch {
    return res.status(404).json({ error: 'Proveedor desconocido' });
  }

  const { data: credencialFila } = await supabase
    .from('credenciales_pasarela_pago')
    .select('credencial_secret_id')
    .eq('prestadora_id', prestadoraId)
    .eq('proveedor', proveedor)
    .maybeSingle();

  let credencial = null;
  if (credencialFila) {
    const { data } = await supabase.rpc('leer_credencial_pasarela_pago', {
      p_prestadora_id: prestadoraId,
      p_proveedor: proveedor,
    });
    credencial = data;
  }

  const { valido, referenciaExterna, estado } = adaptador.verificarWebhook({
    credencial,
    headers: req.headers,
    body: req.body,
  });

  // Siempre 200: reintentar un webhook inválido no cambia nada (no hay estado que
  // reconciliar), y devolver un error hace que el proveedor siga reintentando indefinidamente.
  if (!valido) {
    return res.status(200).json({ ok: true });
  }

  const { data: cobro } = await supabase
    .from('cobros_marketplace')
    .select('id, suscripcion_id')
    .eq('prestadora_id', prestadoraId)
    .eq('referencia_externa', referenciaExterna)
    .maybeSingle();

  if (!cobro) {
    return res.status(200).json({ ok: true });
  }

  await supabase.from('cobros_marketplace').update({ estado_cobro: estado }).eq('id', cobro.id);

  if (estado === 'exitoso') {
    const proximoCobro = new Date();
    proximoCobro.setMonth(proximoCobro.getMonth() + 1);
    await supabase
      .from('suscripciones_marketplace')
      .update({ estado: 'activa', proximo_cobro: proximoCobro.toISOString().slice(0, 10) })
      .eq('id', cobro.suscripcion_id);
  } else if (estado === 'fallido') {
    await supabase.from('suscripciones_marketplace').update({ estado: 'vencida' }).eq('id', cobro.suscripcion_id);
  }

  res.status(200).json({ ok: true });
});

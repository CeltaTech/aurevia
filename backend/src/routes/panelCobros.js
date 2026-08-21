import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import {
  ORIGENES_DE_AFUERA,
  TOPE_DEL_LOTE,
  aDosDecimales,
  loQueEstaMalEnElCobro,
  primerDiaDelPeriodo,
} from '../utils/cobrosDeFamilia.js';

/* Lo que la Familia pagó, anotado; y el saldo, que es una resta.
   ==========================================================================

   POR QUÉ EXISTE ESTE ARCHIVO (pendiente #155). El saldo de cada Familia no tenía de dónde
   mantenerse al día: la base guardaba cuánto se le facturó y un estado de dos valores que
   alguien marcaba a mano. Faltaba el otro término de la resta —cuánta plata entró—, y por eso
   una Familia que pagaba la mitad quedaba idéntica a una que no pagaba nada.

   LA IDEA DE FONDO: el saldo no se guarda en ninguna parte, se calcula. Lo facturado menos lo
   cobrado, en la vista `saldos_familia`, que es el único lugar donde vive esa resta (regla 12
   de CLAUDE.md §7). Este archivo no rehace esa cuenta ni una sola vez: la lee.

   LA PUERTA DE ENTRADA ABIERTA. La plata puede entrar por donde sea: cargada acá, importada de
   un archivo, empujada por el sistema contable de la Prestadora, avisada por una pasarela. La
   ruta `/entrada` acepta un lote de cobros de cualquiera de esos orígenes y contesta uno por
   uno qué pasó con cada uno. Es idempotente: quien reintenta el mismo envío con la misma
   `referencia_externa` recibe "duplicado" y no se suma plata de más. Nada acá está atado a un
   proveedor: el proveedor, si existe, es un texto en `referencia_externa`.

   LO QUE NO HACE, Y NO VA A HACER: decidir. Que una Familia deba plata no corta ningún
   Servicio. La pantalla avisa; si se le sigue prestando o no, lo decide una persona.

   LO QUE TAMPOCO ES: un comprobante fiscal. El producto no emite facturas ni recibos (regla
   14). Acá se anota lo que se acordó cobrar y lo que entró, nada más.

   QUIÉN PUEDE. En el catálogo `catalogo_acciones_permisos` no hay ninguna acción que hable de
   facturación ni de cobranzas, así que no se inventa una: se usa exactamente el mismo criterio
   con el que hoy se entra a la pantalla de facturación, que es el de la política
   `panel_gestiona_facturas_familia` de la base —ser de la Prestadora y tener rol de Panel—, y
   ese criterio vive en la función SQL `gestiona_la_facturacion()`. `requiereRolPanel` ya deja
   afuera a cualquiera que no sea admin_prestadora, coordinador o superadmin, que es la misma
   lista. Un criterio distinto acá que en la base sería la misma decisión escrita dos veces y
   con dos respuestas posibles.

   NADA DE PLATA EN LOS REGISTROS NI EN LA DIRECCIÓN. Los importes y los datos de las Familias
   son dato sensible (CLAUDE.md §6): no se loguean y no viajan por la URL. Por la URL viaja el
   identificador de una factura o un período, que no dicen cuánto debe nadie.

   Y EL AISLAMIENTO. El motor entra con la clave de servicio, o sea sin las reglas de acceso de
   la base: acá el aislamiento entre Prestadoras lo garantiza cada consulta con su filtro de
   `prestadora_id`, o no lo garantiza nadie. */

export const panelCobrosRouter = Router();

// Qué medios hay, qué monto vale, cómo se lee un período: escrito una sola vez en
// `utils/cobrosDeFamilia.js`, que es copia del archivo del Panel. La pantalla arma el
// desplegable con la misma lista con la que el motor controla, así no puede ofrecer algo que
// después se rechaza (regla 12 de CLAUDE.md §7). Se vuelven a exportar desde acá porque es de
// donde las venían tomando quienes las usan.
export {
  MEDIOS,
  ORIGENES_DE_AFUERA,
  TOPE_DEL_LOTE,
  loQueEstaMalEnElCobro,
  primerDiaDelPeriodo,
  aDosDecimales,
} from '../utils/cobrosDeFamilia.js';

/**
 * Los nombres de estas Familias, para las listas que se muestran en pantalla.
 *
 * Se buscan aparte y filtrando por Prestadora en vez de traerlos colgados de la factura,
 * porque el motor no pasa por las reglas de acceso de la base.
 */
async function nombresDeFamilias(prestadoraId, ids) {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const { data, error } = await supabase
    .from('familias')
    .select('id, solicitudes!familias_solicitud_id_fkey(nombre)')
    .eq('prestadora_id', prestadoraId)
    .in('id', unicos);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((f) => [f.id, f.solicitudes?.nombre ?? null]));
}

/** La factura de esta Prestadora, o null. Nunca se busca una factura sin decir de quién es. */
async function facturaDeLaPrestadora(prestadoraId, facturaId) {
  const { data, error } = await supabase
    .from('facturas_familia')
    .select('id, familia_id, periodo, monto_total, moneda, estado, fecha_emision, fecha_vencimiento')
    .eq('id', facturaId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** El saldo calculado de una factura, leído del único lugar donde vive esa resta. */
async function saldoDeLaFactura(prestadoraId, facturaId) {
  const { data, error } = await supabase
    .from('saldos_familia')
    .select('*')
    .eq('factura_id', facturaId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

// ---------------------------------------------------------------------------------------
// Los saldos
// ---------------------------------------------------------------------------------------

/**
 * Los saldos de un período: lo facturado, lo cobrado, lo que falta, de dónde salió el dato y
 * de cuándo es.
 */
panelCobrosRouter.get('/saldos', requiereRolPanel, async (req, res) => {
  const periodo = primerDiaDelPeriodo(req.query.periodo);
  if (!periodo) return res.status(400).json({ error: 'Falta el período, en formato AAAA-MM' });

  const { data, error } = await supabase
    .from('saldos_familia')
    .select('*')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .eq('periodo', periodo)
    .order('fecha_emision', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  let nombres;
  try {
    nombres = await nombresDeFamilias(req.usuarioPanel.prestadoraId, (data || []).map((s) => s.familia_id));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  res.json((data || []).map((s) => ({ ...s, familia_nombre: nombres.get(s.familia_id) ?? null })));
});

/** El detalle de una factura: su saldo y todos los cobros que la fueron bajando. */
panelCobrosRouter.get('/facturas/:facturaId', requiereRolPanel, async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;

  let saldo;
  try {
    saldo = await saldoDeLaFactura(prestadoraId, req.params.facturaId);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!saldo) return res.status(404).json({ error: 'Factura no encontrada' });

  // Los anulados vienen también: anular no es borrar, y el rastro de una plata que se dio de
  // baja es justamente lo que hay que poder mirar después.
  const { data: cobros, error } = await supabase
    .from('cobros_familia')
    .select('*')
    .eq('factura_id', saldo.factura_id)
    .eq('prestadora_id', prestadoraId)
    .order('fecha_cobro', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  let nombres;
  try {
    nombres = await nombresDeFamilias(prestadoraId, [saldo.familia_id]);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  res.json({ ...saldo, familia_nombre: nombres.get(saldo.familia_id) ?? null, cobros: cobros || [] });
});

// ---------------------------------------------------------------------------------------
// Los cobros
// ---------------------------------------------------------------------------------------

/**
 * Anotar un cobro cargado en el Panel. Puede ser parcial: nada obliga a que cubra el total, y
 * varios cobros contra la misma factura es exactamente cómo se representa el pago en partes.
 */
panelCobrosRouter.post('/facturas/:facturaId/cobros', requiereRolPanel, async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const cuerpo = req.body || {};

  const problema = loQueEstaMalEnElCobro(cuerpo);
  if (problema) return res.status(400).json({ error: problema });

  let factura;
  try {
    factura = await facturaDeLaPrestadora(prestadoraId, req.params.facturaId);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });

  const { data, error } = await supabase
    .from('cobros_familia')
    .insert({
      prestadora_id: prestadoraId,
      factura_id: factura.id,
      monto: aDosDecimales(cuerpo.monto),
      fecha_cobro: cuerpo.fecha_cobro ?? new Date().toISOString().slice(0, 10),
      medio: cuerpo.medio,
      origen: 'panel',
      referencia_externa: cuerpo.referencia_externa || null,
      observaciones: cuerpo.observaciones || null,
      registrado_por: req.usuarioPanel.id,
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  let saldo;
  try {
    saldo = await saldoDeLaFactura(prestadoraId, factura.id);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  res.json({ cobro: data, saldo });
});

/**
 * Anular un cobro. No se borra: la fila queda con quién lo anuló, cuándo y por qué, y deja de
 * contar para el saldo. Una plata que desaparece sin rastro es indistinguible de una que nunca
 * existió, y con plata de un tercero eso es justo lo que no puede pasar.
 */
panelCobrosRouter.post('/cobros/:id/anular', requiereRolPanel, async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const motivo = String(req.body?.motivo ?? '').trim();
  if (!motivo) return res.status(400).json({ error: 'Hace falta decir por qué se anula el cobro' });

  const { data: cobro, error } = await supabase
    .from('cobros_familia')
    .select('id, factura_id, estado')
    .eq('id', req.params.id)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!cobro) return res.status(404).json({ error: 'Cobro no encontrado' });
  if (cobro.estado === 'anulado') return res.status(400).json({ error: 'Este cobro ya figura anulado' });

  const { data, error: errorAnulacion } = await supabase
    .from('cobros_familia')
    .update({
      estado: 'anulado',
      motivo_anulacion: motivo,
      anulado_por: req.usuarioPanel.id,
      anulado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', cobro.id)
    .eq('prestadora_id', prestadoraId)
    .select()
    .single();
  if (errorAnulacion) return res.status(500).json({ error: errorAnulacion.message });

  let saldo;
  try {
    saldo = await saldoDeLaFactura(prestadoraId, cobro.factura_id);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  res.json({ cobro: data, saldo });
});

// ---------------------------------------------------------------------------------------
// La puerta de entrada para lo que viene de afuera
// ---------------------------------------------------------------------------------------

/**
 * Ubicar la factura que un cobro de afuera dice estar pagando.
 *
 * Se admiten dos formas de nombrarla, porque un sistema de afuera no siempre conoce el
 * identificador nuestro: o `factura_id` directo, o la Familia más el período. Nunca se busca
 * sin el filtro de Prestadora.
 */
async function ubicarFactura(prestadoraId, cobro) {
  if (cobro.factura_id) {
    const factura = await facturaDeLaPrestadora(prestadoraId, cobro.factura_id);
    return { factura, motivo: factura ? null : 'No hay ninguna factura con ese identificador' };
  }

  const periodo = primerDiaDelPeriodo(cobro.periodo);
  if (!cobro.familia_id || !periodo) {
    return { factura: null, motivo: 'Falta decir qué factura se está pagando: o el identificador, o la Familia y el período' };
  }

  const { data, error } = await supabase
    .from('facturas_familia')
    .select('id, familia_id, periodo, monto_total, moneda, estado, fecha_emision, fecha_vencimiento')
    .eq('prestadora_id', prestadoraId)
    .eq('familia_id', cobro.familia_id)
    .eq('periodo', periodo)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { factura: data ?? null, motivo: data ? null : 'Esa Familia no tiene factura en ese período' };
}

/**
 * Un lote de cobros que viene de afuera.
 *
 * Contesta siempre uno por uno: qué se registró, qué ya estaba (duplicado) y qué se rechazó y
 * por qué. Un renglón malo no tira abajo el lote entero, porque quien envía necesita saber
 * exactamente cuál no entró para corregir ese y no volver a mandar todo.
 *
 * La idempotencia la garantiza la base con un índice único sobre Prestadora + origen +
 * referencia externa. Acá se consulta antes para poder contestar "duplicado" en vez de un
 * error, pero la garantía de que no se sume plata dos veces no depende de esa consulta: si dos
 * envíos llegan a la vez, uno de los dos choca contra el índice y también se contesta
 * "duplicado".
 */
panelCobrosRouter.post('/entrada', requiereRolPanel, async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { origen, cobros } = req.body || {};

  if (!ORIGENES_DE_AFUERA.includes(origen)) {
    return res.status(400).json({ error: 'Falta decir de dónde viene el lote' });
  }
  if (!Array.isArray(cobros) || cobros.length === 0) {
    return res.status(400).json({ error: 'El lote no trae ningún cobro' });
  }
  if (cobros.length > TOPE_DEL_LOTE) {
    return res.status(400).json({ error: `Un lote admite hasta ${TOPE_DEL_LOTE} cobros por vez` });
  }

  // Lo que ya entró antes con estas mismas referencias. Se pregunta una vez por el lote entero
  // y no una vez por renglón: un lote de quinientos serían quinientas consultas.
  const referencias = cobros.map((c) => c?.referencia_externa).filter((r) => typeof r === 'string' && r.length > 0);
  const yaEstaban = new Map();
  if (referencias.length > 0) {
    const { data, error } = await supabase
      .from('cobros_familia')
      .select('id, referencia_externa, factura_id')
      .eq('prestadora_id', prestadoraId)
      .eq('origen', origen)
      .in('referencia_externa', [...new Set(referencias)]);
    if (error) return res.status(500).json({ error: error.message });
    for (const c of data || []) yaEstaban.set(c.referencia_externa, c);
  }

  const resultados = [];
  const facturasTocadas = new Set();
  // Dentro del mismo lote también puede venir la misma referencia dos veces.
  const vistasEnEsteLote = new Set();

  for (let i = 0; i < cobros.length; i += 1) {
    const cobro = cobros[i] || {};
    const referencia = typeof cobro.referencia_externa === 'string' && cobro.referencia_externa.length > 0
      ? cobro.referencia_externa
      : null;
    const renglon = { indice: i, referencia_externa: referencia };

    if (referencia && (yaEstaban.has(referencia) || vistasEnEsteLote.has(referencia))) {
      resultados.push({ ...renglon, resultado: 'duplicado', cobro_id: yaEstaban.get(referencia)?.id ?? null });
      continue;
    }

    const problema = loQueEstaMalEnElCobro(cobro);
    if (problema) {
      resultados.push({ ...renglon, resultado: 'rechazado', motivo: problema });
      continue;
    }

    let ubicacion;
    try {
      ubicacion = await ubicarFactura(prestadoraId, cobro);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    if (!ubicacion.factura) {
      resultados.push({ ...renglon, resultado: 'rechazado', motivo: ubicacion.motivo });
      continue;
    }

    const { data, error } = await supabase
      .from('cobros_familia')
      .insert({
        prestadora_id: prestadoraId,
        factura_id: ubicacion.factura.id,
        monto: aDosDecimales(cobro.monto),
        fecha_cobro: cobro.fecha_cobro ?? new Date().toISOString().slice(0, 10),
        medio: cobro.medio,
        origen,
        referencia_externa: referencia,
        observaciones: cobro.observaciones || null,
        // Sin persona detrás: esto no lo cargó nadie, lo mandó un sistema. Poner un usuario
        // sería inventar un responsable.
        registrado_por: null,
      })
      .select('id, factura_id')
      .single();

    if (error) {
      // El choque contra el índice único es la otra mitad de la idempotencia, la que sirve
      // cuando dos envíos llegan al mismo tiempo. No es un error del que envía.
      const esDuplicado = error.code === '23505';
      resultados.push({
        ...renglon,
        resultado: esDuplicado ? 'duplicado' : 'rechazado',
        motivo: esDuplicado ? undefined : error.message,
      });
      continue;
    }

    if (referencia) vistasEnEsteLote.add(referencia);
    facturasTocadas.add(data.factura_id);
    resultados.push({ ...renglon, resultado: 'registrado', cobro_id: data.id });
  }

  // Los saldos que quedaron después del lote, para que quien envía pueda comprobar contra su
  // propio sistema sin tener que volver a preguntar.
  let saldos = [];
  if (facturasTocadas.size > 0) {
    const { data, error } = await supabase
      .from('saldos_familia')
      .select('factura_id, monto_total, cobrado, saldo, estado, moneda, actualizado_en, origenes')
      .eq('prestadora_id', prestadoraId)
      .in('factura_id', [...facturasTocadas]);
    if (error) return res.status(500).json({ error: error.message });
    saldos = data || [];
  }

  res.json({
    registrados: resultados.filter((r) => r.resultado === 'registrado').length,
    duplicados: resultados.filter((r) => r.resultado === 'duplicado').length,
    rechazados: resultados.filter((r) => r.resultado === 'rechazado').length,
    resultados,
    saldos,
  });
});

import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { requierePermiso } from '../utils/permisos.js';
import { horasEntre } from '../utils/horasDeGuardia.js';
import { resolverEscalasVigentes } from '../utils/escalasLegales.js';

/* Lo que se le liquida a cada Asistente en un mes, guardado.
   ==========================================================================

   POR QUÉ EXISTE ESTE ARCHIVO (pendiente #126). La pantalla de pagos hacía la cuenta en el
   momento, cada vez que se abría, con el valor hora que la ficha tuviera ESE día. O sea que
   corregir hoy el valor hora de alguien reescribía lo que se le pagó en marzo, y no había
   dónde anotar "este mes ya se pagó". Acá la cuenta se hace UNA vez y queda escrita.

   LA IDEA DE FONDO: una liquidación es una foto. Se saca con los valores del día y no se
   vuelve a calcular. Por eso cada renglón guarda el nombre del concepto y el valor con el
   que se hizo la cuenta, copiados — leer un mes viejo nunca vuelve al catálogo, que pudo
   haber cambiado desde entonces.

   LO QUE NO ES: un comprobante fiscal. El producto no emite facturas ni notas y no está
   previsto que lo haga (CLAUDE.md §7 regla 14). Esto es la cuenta interna de qué se le pagó
   a quién; el papel con validez impositiva lo hace la Prestadora por fuera. Por eso no hay
   tipo de comprobante, ni punto de venta, ni numeración, ni impuestos discriminados.

   LO QUE TAMPOCO HACE: inventar un número. Ningún porcentaje ni monto legal está escrito
   acá adentro (regla 10). Los conceptos los arma cada Prestadora, y el que responde a una
   escala legal se resuelve contra `escalas_legales` a la fecha del período; si esa escala no
   está cargada, el concepto no entra y se avisa. Nunca se estima.

   NADA DE PLATA EN LOS REGISTROS NI EN LA DIRECCIÓN. Las remuneraciones son dato sensible
   (CLAUDE.md §6): no se loguean, no viajan por la URL. El período sí va en la URL porque es
   un mes, no un importe. */

export const panelLiquidacionesRouter = Router();

// Las guardias cerradas son las únicas que se pagan: una programada todavía no pasó y una
// cancelada no se hizo. Es el mismo criterio que usa la pantalla de pagos.
const ESTADO_HECHA = 'completada';

// Leer remuneraciones exige el mismo permiso con el que ya se leen los importes de la ficha
// del Asistente; escribir, además, ser de la administración. Es la misma pareja de
// condiciones que las reglas de acceso de la base aplican a estas tres tablas.
const PERMISO_LECTURA = 'ver_pagos_asistente';
const ROLES_ADMINISTRACION = ['admin_prestadora', 'superadmin'];

const SIGNOS = ['suma', 'resta'];
const UNIDADES_CONCEPTO = ['monto_fijo_mensual', 'porcentaje', 'monto_por_hora'];
const ORIGENES_VALOR = ['propio', 'escala_legal'];
const DESTINATARIOS = ['todos', 'dependencia', 'monotributo'];

// PostgREST corta cualquier respuesta a mil filas. Un mes de guardias de una Prestadora
// mediana pasa ese número sin esfuerzo, y la liquidación que saliera de una lista cortada
// pagaría de menos sin que nadie se entere. Se pide de a mil hasta que no venga más nada.
const TAMANO_PAGINA = 1000;

async function traerPaginado(armarConsulta) {
  const todas = [];
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data, error } = await armarConsulta().range(desde, desde + TAMANO_PAGINA - 1);
    if (error) throw new Error(error.message);
    todas.push(...(data || []));
    if (!data || data.length < TAMANO_PAGINA) return todas;
  }
}

// Tocar la plata de una persona es de la administración de la Prestadora, no de cualquiera
// que pueda mirarla. Se contesta con el mismo texto que el permiso, porque desde afuera es
// la misma respuesta: esta acción no está habilitada.
function soloAdministracion(req, res, next) {
  if (!ROLES_ADMINISTRACION.includes(req.usuarioPanel?.rol)) {
    return res.status(403).json({ error: 'La Prestadora no habilitó esta acción' });
  }
  next();
}

// ---------------------------------------------------------------------------------------
// Las cuentas, aparte de las rutas
//
// Todo lo que sigue son funciones sin base de datos adentro: entran datos, sale el
// resultado. Están así para que se puedan probar sin levantar nada y, sobre todo, para que
// la cuenta se pueda leer de corrido sin tener que seguir consultas por el medio.
// ---------------------------------------------------------------------------------------

export function esPeriodoValido(periodo) {
  if (typeof periodo !== 'string' || !/^\d{4}-\d{2}$/.test(periodo)) return false;
  const mes = Number(periodo.slice(5, 7));
  return mes >= 1 && mes <= 12;
}

export function primerDia(periodo) {
  return `${periodo}-01`;
}

export function ultimoDia(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  // El día 0 del mes siguiente es el último del mes pedido, sin tener que saber cuáles
  // tienen 30, 31 o 28 días.
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
}

/**
 * Si el vínculo de esa persona estaba en pie en algún momento del mes que se liquida.
 *
 * Hace falta porque quien está en relación de dependencia cobra su sueldo aunque no haya
 * hecho ninguna guardia: sin este control, al generar un mes anterior a su ingreso le
 * saldría una liquidación de un sueldo que nunca se le pagó. Las fechas son de tipo `date`,
 * o sea texto `AAAA-MM-DD`, que se compara igual que un número.
 */
export function vinculoVigenteEnElPeriodo(asistente, periodo) {
  if (asistente.fecha_alta && asistente.fecha_alta > ultimoDia(periodo)) return false;
  if (asistente.fecha_baja && asistente.fecha_baja < primerDia(periodo)) return false;
  return true;
}

/**
 * Cuántas guardias y cuántas horas hizo cada Asistente en el mes.
 *
 * ATENCIÓN antes de tocar esto: se cuenta UNA FILA POR GUARDIA, a propósito, y no se cruza
 * con la lista de Pacientes de cada guardia. Desde que una misma guardia puede cubrir a
 * varias personas (una sola guardia en una casa donde viven dos), la tentación es
 * "completar" la cuenta uniéndola con `guardia_pacientes`. No se hace: si se hiciera, una
 * guardia de ocho horas para dos Pacientes aparecería dos veces y el Asistente cobraría
 * dieciséis horas por ocho trabajadas.
 *
 * Al Asistente se le pagan las horas enteras, una sola vez, atienda a uno o a cinco. El
 * reparto entre Pacientes es la otra cuenta, la de los informes de obra social, y vive en
 * `utils/horasDeGuardia.js` junto con esta.
 */
export function acumularGuardias(guardias) {
  const porAsistente = new Map();
  for (const g of guardias) {
    if (g.estado !== ESTADO_HECHA) continue;
    const acumulado = porAsistente.get(g.asistente_id) || { guardias: 0, horas: 0 };
    acumulado.guardias += 1;
    acumulado.horas += horasEntre(g.hora_inicio, g.hora_fin);
    porAsistente.set(g.asistente_id, acumulado);
  }
  return porAsistente;
}

/**
 * Qué escala legal rige cada tipo durante todo el mes que se liquida.
 *
 * La vigencia no se decide acá: la decide `resolverEscalasVigentes`, que es el punto único
 * de verdad y vive en el Panel (copiado a `utils/escalasLegales.js`, ver
 * `scripts/copias_entre_apps.mjs`). Acá solo se le pregunta dos veces, por el primer día y
 * por el último, porque una liquidación no es un hecho de un día: es un mes entero. Si las
 * dos respuestas no son la misma fila, la escala cambió en la mitad del período y no hay
 * forma de saber cuál corresponde sin inventar un prorrateo — así que ese concepto queda
 * afuera y se avisa (regla 10). Lo mismo si la única fila vigente es de una categoría de
 * convenio: un concepto apunta a un tipo de escala, no a una categoría, y elegirle una
 * sería adivinar.
 */
export function escalasEstablesDelPeriodo(filasEscalas, periodo, jurisdiccion) {
  const alEmpezar = resolverEscalasVigentes(filasEscalas, primerDia(periodo), jurisdiccion);
  const alTerminar = resolverEscalasVigentes(filasEscalas, ultimoDia(periodo), jurisdiccion);

  const sinCategoria = (resueltas, tipo) =>
    [...resueltas.values()].find((f) => f.tipo === tipo && !f.categoria) || null;

  const porTipo = new Map();
  for (const fila of alTerminar.values()) {
    if (fila.categoria) continue;
    const alPrincipio = sinCategoria(alEmpezar, fila.tipo);
    if (!alPrincipio || alPrincipio.vigencia_desde !== fila.vigencia_desde) continue;
    porTipo.set(fila.tipo, fila);
  }
  return porTipo;
}

// Los importes se guardan con dos decimales. Se redondea al escribir cada renglón y no al
// final, para que la suma de los renglones dé exactamente el total y nadie tenga que
// explicar un centavo de diferencia.
function redondear(numero) {
  return Math.round((numero + Number.EPSILON) * 100) / 100;
}

/**
 * La liquidación de un Asistente en un período, con sus renglones.
 *
 * Devuelve `{ faltaBase: true }` cuando la ficha no tiene el valor con el que se paga. No se
 * estima, no se completa con el de otro, no se pone cero: un cero se lee como "no se le paga
 * nada", que es una afirmación distinta de "no sabemos cuánto".
 *
 * `sinEscala` sale con los conceptos que quedaron afuera por no tener escala utilizable.
 */
export function calcularLiquidacion({ asistente, acumulado, conceptos, escalasPorTipo, moneda, jurisdiccion, periodo }) {
  const esDependencia = asistente.tipo_vinculo === 'dependencia';
  const baseUnidad = esDependencia ? 'sueldo_basico' : 'valor_hora';
  const baseCruda = esDependencia ? asistente.sueldo_basico : asistente.valor_hora;
  if (baseCruda === null || baseCruda === undefined) return { faltaBase: true };

  const baseValor = Number(baseCruda);
  const horas = redondear(acumulado.horas);
  // Quien está en relación de dependencia cobra su sueldo, que no se mueve con las guardias
  // que haya hecho; para esa persona las horas son un control, no la cuenta.
  const bruto = redondear(esDependencia ? baseValor : acumulado.horas * baseValor);

  // El renglón de la base va primero y no viene de ningún concepto. La descripción se escribe
  // con datos y no con una frase: la etiqueta que lee la Coordinadora sale de `base_unidad`,
  // que la pantalla traduce a los tres idiomas, mientras que esto es el detalle que permite
  // volver a explicar el importe años después sin depender del idioma en que se generó.
  const descripcionBase = esDependencia
    ? `sueldo_basico = ${baseValor.toFixed(2)}`
    : `valor_hora ${baseValor.toFixed(2)} × ${horas.toFixed(2)} h`;

  const items = [
    {
      concepto_id: null,
      descripcion: descripcionBase,
      signo: 'suma',
      unidad: 'base',
      valor_aplicado: baseValor,
      monto: bruto,
      orden: 0,
    },
  ];

  const sinEscala = [];
  let totalSumas = 0;
  let totalRestas = 0;

  for (const concepto of conceptos) {
    if (concepto.aplica_a !== 'todos' && concepto.aplica_a !== asistente.tipo_vinculo) continue;

    let valorAplicado;
    if (concepto.origen_valor === 'escala_legal') {
      const escala = escalasPorTipo.get(concepto.escala_tipo);
      if (!escala) {
        sinEscala.push(`${concepto.nombre}: no hay una escala «${concepto.escala_tipo}» vigente en ${jurisdiccion} durante todo ${periodo}`);
        continue;
      }
      // La escala dice el número y también en qué unidad está. Si no habla de lo mismo que el
      // concepto —un valor en días aplicado como porcentaje, por ejemplo— el importe que
      // saldría no significaría nada, así que no se calcula.
      if (escala.unidad !== concepto.unidad) {
        sinEscala.push(`${concepto.nombre}: la escala «${concepto.escala_tipo}» está en ${escala.unidad} y el concepto en ${concepto.unidad}`);
        continue;
      }
      // Un importe en otra moneda no se convierte: convertirlo obligaría a guardar una
      // cotización y una fecha, y eso es una decisión de la Prestadora, no del sistema
      // (regla 14). Un porcentaje no es plata y no trae moneda: ahí no hay nada que comparar.
      if (escala.moneda && escala.moneda !== moneda) {
        sinEscala.push(`${concepto.nombre}: la escala «${concepto.escala_tipo}» está en ${escala.moneda} y la liquidación en ${moneda}`);
        continue;
      }
      valorAplicado = Number(escala.valor);
    } else {
      valorAplicado = Number(concepto.valor);
    }

    let monto;
    if (concepto.unidad === 'porcentaje') monto = (bruto * valorAplicado) / 100;
    else if (concepto.unidad === 'monto_por_hora') monto = acumulado.horas * valorAplicado;
    else monto = valorAplicado;
    monto = redondear(monto);

    if (concepto.signo === 'resta') totalRestas += monto;
    else totalSumas += monto;

    items.push({
      concepto_id: concepto.id,
      // El nombre se copia, no se busca: si mañana la Prestadora le cambia el nombre al
      // concepto, el mes de marzo tiene que seguir diciendo lo que decía en marzo.
      descripcion: concepto.nombre,
      signo: concepto.signo,
      unidad: concepto.unidad,
      valor_aplicado: valorAplicado,
      monto,
      // El orden es la posición en el renglón, no el `orden` del catálogo: dos conceptos
      // pueden tener el mismo número ahí y los renglones quedarían empatados.
      orden: items.length,
    });
  }

  totalSumas = redondear(totalSumas);
  totalRestas = redondear(totalRestas);

  return {
    liquidacion: {
      asistente_id: asistente.id,
      periodo: primerDia(periodo),
      tipo_vinculo: asistente.tipo_vinculo,
      base_unidad: baseUnidad,
      base_valor: baseValor,
      horas,
      guardias_contadas: acumulado.guardias,
      bruto,
      total_sumas: totalSumas,
      total_restas: totalRestas,
      neto: redondear(bruto + totalSumas - totalRestas),
    },
    items,
    sinEscala,
  };
}

// ---------------------------------------------------------------------------------------
// El catálogo de conceptos
// ---------------------------------------------------------------------------------------

/**
 * Qué le falta o qué está mal en un concepto que llega de afuera.
 *
 * La base tiene las mismas reglas escritas como restricciones y no dependemos de esto para
 * que se cumplan; esto existe para contestar con una frase entendible en vez de con el
 * mensaje crudo de Postgres.
 */
function loQueEstaMalEnElConcepto(cuerpo) {
  if (!cuerpo.nombre || !String(cuerpo.nombre).trim()) return 'El concepto necesita un nombre';
  if (!SIGNOS.includes(cuerpo.signo)) return 'El concepto tiene que sumar o restar';
  if (!UNIDADES_CONCEPTO.includes(cuerpo.unidad)) return 'La unidad del concepto no es una de las previstas';
  if (!ORIGENES_VALOR.includes(cuerpo.origen_valor)) return 'El valor del concepto sale de la Prestadora o de una escala legal';
  if (cuerpo.aplica_a !== undefined && !DESTINATARIOS.includes(cuerpo.aplica_a)) {
    return 'El concepto se aplica a todos, a dependencia o a monotributo';
  }
  if (cuerpo.origen_valor === 'propio' && (cuerpo.valor === null || cuerpo.valor === undefined || Number.isNaN(Number(cuerpo.valor)))) {
    return 'Un concepto propio de la Prestadora necesita su valor';
  }
  if (cuerpo.origen_valor === 'escala_legal' && (!cuerpo.escala_tipo || !String(cuerpo.escala_tipo).trim())) {
    return 'Un concepto que sale de una escala legal necesita decir de qué escala';
  }
  return null;
}

/**
 * Los campos de un concepto, tal como se guardan.
 *
 * La moneda no se recibe nunca de afuera: la completa la base con la de la Prestadora
 * (`fn_completar_moneda`, punto único de verdad de la regla 14), y solo cuando el concepto
 * es plata propia. Un porcentaje no lleva moneda y uno que sale de una escala la trae de la
 * escala, así que en esos dos casos tiene que quedar en nulo o la fila no entra.
 */
function camposDelConcepto(cuerpo) {
  const esPropio = cuerpo.origen_valor === 'propio';
  return {
    nombre: String(cuerpo.nombre).trim(),
    signo: cuerpo.signo,
    unidad: cuerpo.unidad,
    origen_valor: cuerpo.origen_valor,
    valor: esPropio ? Number(cuerpo.valor) : null,
    escala_tipo: esPropio ? null : String(cuerpo.escala_tipo).trim(),
    aplica_a: cuerpo.aplica_a ?? 'todos',
    activo: cuerpo.activo ?? true,
    orden: cuerpo.orden ?? 100,
  };
}

panelLiquidacionesRouter.get('/conceptos', requiereRolPanel, requierePermiso(PERMISO_LECTURA), async (req, res) => {
  const { data, error } = await supabase
    .from('conceptos_liquidacion')
    .select('*')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

panelLiquidacionesRouter.post('/conceptos', requiereRolPanel, requierePermiso(PERMISO_LECTURA), soloAdministracion, async (req, res) => {
  const problema = loQueEstaMalEnElConcepto(req.body || {});
  if (problema) return res.status(400).json({ error: problema });

  const { data, error } = await supabase
    .from('conceptos_liquidacion')
    .insert({ prestadora_id: req.usuarioPanel.prestadoraId, ...camposDelConcepto(req.body) })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

panelLiquidacionesRouter.patch('/conceptos/:id', requiereRolPanel, requierePermiso(PERMISO_LECTURA), soloAdministracion, async (req, res) => {
  const { data: actual, error: errorLectura } = await supabase
    .from('conceptos_liquidacion')
    .select('*')
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (errorLectura) return res.status(500).json({ error: errorLectura.message });
  if (!actual) return res.status(404).json({ error: 'Concepto no encontrado' });

  // Un concepto no se borra nunca: dar de baja es `activo: false`. Borrarlo dejaría a los
  // renglones ya liquidados apuntando al vacío, y esos renglones son la explicación de un
  // pago que ya se hizo.
  const cuerpo = { ...actual, ...req.body };
  const problema = loQueEstaMalEnElConcepto(cuerpo);
  if (problema) return res.status(400).json({ error: problema });

  const campos = camposDelConcepto(cuerpo);

  // La moneda la completa un disparador que solo corre al insertar. Si la edición convierte
  // un porcentaje en un monto propio (o al revés), hay que recalcularla acá o la fila choca
  // contra su propia restricción.
  let moneda = actual.moneda;
  const deberiaTenerMoneda = campos.unidad !== 'porcentaje' && campos.origen_valor === 'propio';
  if (deberiaTenerMoneda && !moneda) {
    const { data: prestadora } = await supabase
      .from('prestadoras')
      .select('moneda')
      .eq('id', req.usuarioPanel.prestadoraId)
      .maybeSingle();
    moneda = prestadora?.moneda ?? null;
  } else if (!deberiaTenerMoneda) {
    moneda = null;
  }

  const { data, error } = await supabase
    .from('conceptos_liquidacion')
    .update({ ...campos, moneda, updated_at: new Date().toISOString() })
    .eq('id', actual.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ---------------------------------------------------------------------------------------
// Las liquidaciones
// ---------------------------------------------------------------------------------------

/** Los nombres de estos Asistentes, para las listas que se muestran en pantalla. */
async function nombresDeAsistentes(prestadoraId, ids) {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('asistentes')
    .select('id, nombre')
    .eq('prestadora_id', prestadoraId)
    .in('id', ids);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((a) => [a.id, a.nombre]));
}

panelLiquidacionesRouter.get('/', requiereRolPanel, requierePermiso(PERMISO_LECTURA), async (req, res) => {
  const { periodo } = req.query;
  if (!esPeriodoValido(periodo)) {
    return res.status(400).json({ error: 'Falta el período a liquidar, en formato AAAA-MM' });
  }

  const { data, error } = await supabase
    .from('liquidaciones_asistente')
    .select('*')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .eq('periodo', primerDia(periodo))
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  // El nombre se busca aparte y filtrando por Prestadora, en vez de traerlo colgado de la
  // liquidación: el motor entra con la clave de servicio, o sea sin las reglas de acceso de
  // la base, y acá el aislamiento entre Prestadoras lo garantiza cada consulta o no lo
  // garantiza nadie (CLAUDE.md §5).
  const nombres = await nombresDeAsistentes(req.usuarioPanel.prestadoraId, (data || []).map((l) => l.asistente_id));
  res.json((data || []).map((l) => ({ ...l, asistente_nombre: nombres.get(l.asistente_id) ?? null })));
});

panelLiquidacionesRouter.post('/generar', requiereRolPanel, requierePermiso(PERMISO_LECTURA), soloAdministracion, async (req, res) => {
  const { periodo } = req.body || {};
  if (!esPeriodoValido(periodo)) {
    return res.status(400).json({ error: 'Falta el período a liquidar, en formato AAAA-MM' });
  }

  const prestadoraId = req.usuarioPanel.prestadoraId;
  const desde = primerDia(periodo);
  const hasta = ultimoDia(periodo);

  const { data: prestadora, error: errorPrestadora } = await supabase
    .from('prestadoras')
    .select('pais, moneda')
    .eq('id', prestadoraId)
    .maybeSingle();
  if (errorPrestadora) return res.status(500).json({ error: errorPrestadora.message });
  if (!prestadora) return res.status(404).json({ error: 'Prestadora no encontrada' });

  const guardias = await traerPaginado(() =>
    supabase
      .from('guardias')
      .select('id, estado, hora_inicio, hora_fin, asistente_id')
      .eq('prestadora_id', prestadoraId)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .not('asistente_id', 'is', null)
      .order('id', { ascending: true })
  );
  const acumuladoPorAsistente = acumularGuardias(guardias);

  const asistentes = await traerPaginado(() =>
    supabase
      .from('asistentes')
      .select('id, nombre, estado, tipo_vinculo, fecha_alta, fecha_baja')
      .eq('prestadora_id', prestadoraId)
      .is('deleted_at', null)
      .order('nombre', { ascending: true })
  );

  // Lo que cobra cada uno vive en su propia tabla, separada de la ficha justamente porque las
  // reglas de acceso de la base filtran filas y no columnas. Se pide aparte y filtrando por
  // Prestadora, en vez de colgada de la ficha, por lo mismo que los nombres de más arriba.
  const { data: remuneraciones, error: errorRemuneraciones } = await supabase
    .from('remuneraciones_asistente')
    .select('asistente_id, valor_hora, sueldo_basico')
    .eq('prestadora_id', prestadoraId);
  if (errorRemuneraciones) return res.status(500).json({ error: errorRemuneraciones.message });
  const pagoPorAsistente = new Map((remuneraciones || []).map((r) => [r.asistente_id, r]));

  const { data: conceptos, error: errorConceptos } = await supabase
    .from('conceptos_liquidacion')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true });
  if (errorConceptos) return res.status(500).json({ error: errorConceptos.message });

  // Las escalas legales son contenido curado por CeltaTech por país, nunca una decisión de
  // una Prestadora: por eso el filtro es por jurisdicción y no por `prestadora_id`.
  const { data: filasEscalas, error: errorEscalas } = await supabase
    .from('escalas_legales')
    .select('*')
    .eq('jurisdiccion', prestadora.pais);
  if (errorEscalas) return res.status(500).json({ error: errorEscalas.message });
  const escalasPorTipo = escalasEstablesDelPeriodo(filasEscalas || [], periodo, prestadora.pais);

  // Entra quien trabajó en el mes —aunque después se haya dado de baja, porque el trabajo que
  // hizo se le paga igual— y también quien está activo sin haber hecho ninguna guardia,
  // siempre que su vínculo estuviera en pie: el de dependencia cobra su sueldo lo mismo.
  const aLiquidar = asistentes.filter(
    (a) => acumuladoPorAsistente.has(a.id) || (a.estado === 'activo' && vinculoVigenteEnElPeriodo(a, periodo))
  );

  const { data: yaExistentes, error: errorExistentes } = await supabase
    .from('liquidaciones_asistente')
    .select('id, asistente_id, estado')
    .eq('prestadora_id', prestadoraId)
    .eq('periodo', desde);
  if (errorExistentes) return res.status(500).json({ error: errorExistentes.message });
  const existentePorAsistente = new Map((yaExistentes || []).map((l) => [l.asistente_id, l]));

  const resultado = {
    generadas: 0,
    rehechas: 0,
    omitidas_ya_pagadas: [],
    sin_dato_base: [],
    // El mismo concepto se saltea para todos los que le corresponden, así que el aviso es del
    // catálogo y no de cada persona: se dice una vez.
    sin_escala: new Set(),
  };

  for (const asistente of aLiquidar) {
    const existente = existentePorAsistente.get(asistente.id);
    // Una liquidación pagada no se toca: es el registro de una plata que ya salió.
    if (existente?.estado === 'pagada') {
      resultado.omitidas_ya_pagadas.push(asistente.nombre);
      continue;
    }

    const pago = pagoPorAsistente.get(asistente.id) || {};
    const calculada = calcularLiquidacion({
      asistente: { ...asistente, valor_hora: pago.valor_hora ?? null, sueldo_basico: pago.sueldo_basico ?? null },
      acumulado: acumuladoPorAsistente.get(asistente.id) || { guardias: 0, horas: 0 },
      conceptos: conceptos || [],
      escalasPorTipo,
      moneda: prestadora.moneda,
      jurisdiccion: prestadora.pais,
      periodo,
    });

    if (calculada.faltaBase) {
      resultado.sin_dato_base.push(asistente.nombre);
      continue;
    }
    for (const aviso of calculada.sinEscala) resultado.sin_escala.add(aviso);

    // Rehacer un mes es borrar la liquidación anterior y generar otra. Se borra recién acá,
    // con la cuenta nueva ya hecha, para no dejar el mes sin nada si algo salía mal antes.
    if (existente) {
      const { error: errorBorrado } = await supabase
        .from('liquidaciones_asistente')
        .delete()
        .eq('id', existente.id)
        .eq('prestadora_id', prestadoraId);
      if (errorBorrado) return res.status(500).json({ error: errorBorrado.message });
    }

    // La moneda no se manda: la completa la base con la de la Prestadora, igual que en todas
    // las tablas de importes (regla 14).
    const { data: guardada, error: errorGuardar } = await supabase
      .from('liquidaciones_asistente')
      .insert({ prestadora_id: prestadoraId, ...calculada.liquidacion, generada_por: req.usuarioPanel.id })
      .select()
      .single();
    if (errorGuardar) return res.status(500).json({ error: errorGuardar.message });

    const { error: errorItems } = await supabase
      .from('liquidaciones_asistente_items')
      .insert(calculada.items.map((item) => ({ liquidacion_id: guardada.id, ...item })));
    if (errorItems) {
      // Una liquidación sin sus renglones no explica nada: si los renglones no entraron, la
      // cabecera tampoco se queda.
      await supabase.from('liquidaciones_asistente').delete().eq('id', guardada.id).eq('prestadora_id', prestadoraId);
      return res.status(500).json({ error: errorItems.message });
    }

    if (existente) resultado.rehechas += 1;
    else resultado.generadas += 1;
  }

  res.json({ ...resultado, sin_escala: [...resultado.sin_escala] });
});

panelLiquidacionesRouter.get('/:id', requiereRolPanel, requierePermiso(PERMISO_LECTURA), async (req, res) => {
  const { data: liquidacion, error } = await supabase
    .from('liquidaciones_asistente')
    .select('*')
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!liquidacion) return res.status(404).json({ error: 'Liquidación no encontrada' });

  const { data: items, error: errorItems } = await supabase
    .from('liquidaciones_asistente_items')
    .select('*')
    .eq('liquidacion_id', liquidacion.id)
    .order('orden', { ascending: true });
  if (errorItems) return res.status(500).json({ error: errorItems.message });

  const { data: asistente, error: errorAsistente } = await supabase
    .from('asistentes')
    .select('id, nombre, tipo_vinculo')
    .eq('id', liquidacion.asistente_id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (errorAsistente) return res.status(500).json({ error: errorAsistente.message });

  res.json({ ...liquidacion, items: items || [], asistente: asistente ?? null });
});

panelLiquidacionesRouter.post('/:id/pagar', requiereRolPanel, requierePermiso(PERMISO_LECTURA), soloAdministracion, async (req, res) => {
  const { fecha_pago: fechaPago, forma_pago: formaPago, referencia_pago: referenciaPago } = req.body || {};
  // "Pagada" sin fecha no dice nada: la fecha es la mitad del dato.
  if (!fechaPago || !/^\d{4}-\d{2}-\d{2}$/.test(fechaPago)) {
    return res.status(400).json({ error: 'Hace falta la fecha del pago, en formato AAAA-MM-DD' });
  }

  const { data: liquidacion, error } = await supabase
    .from('liquidaciones_asistente')
    .select('id, estado')
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!liquidacion) return res.status(404).json({ error: 'Liquidación no encontrada' });
  if (liquidacion.estado === 'pagada') return res.status(400).json({ error: 'Esta liquidación ya figura pagada' });

  const { data, error: errorPago } = await supabase
    .from('liquidaciones_asistente')
    .update({
      estado: 'pagada',
      fecha_pago: fechaPago,
      forma_pago: formaPago ?? null,
      referencia_pago: referenciaPago ?? null,
      pagada_por: req.usuarioPanel.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', liquidacion.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .select()
    .single();
  if (errorPago) return res.status(500).json({ error: errorPago.message });
  res.json(data);
});

panelLiquidacionesRouter.delete('/:id', requiereRolPanel, requierePermiso(PERMISO_LECTURA), soloAdministracion, async (req, res) => {
  const { data: liquidacion, error } = await supabase
    .from('liquidaciones_asistente')
    .select('id, estado')
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!liquidacion) return res.status(404).json({ error: 'Liquidación no encontrada' });
  // Una liquidación pagada es el registro de una plata que ya salió: borrarla sería borrar la
  // única explicación de ese pago.
  if (liquidacion.estado === 'pagada') {
    return res.status(400).json({ error: 'Una liquidación ya pagada no se puede borrar' });
  }

  // La condición de más arriba se repite acá adentro. La lectura pasó hace un instante, y en ese
  // instante otra persona puede haber marcado la liquidación como pagada: comprobarlo solo antes
  // deja abierto justo el caso que el control existe para impedir. Y se comprueba que haya
  // borrado algo, porque "borré" sin haber borrado nada es la peor respuesta posible acá.
  const { data: borrada, error: errorBorrado } = await supabase
    .from('liquidaciones_asistente')
    .delete()
    .eq('id', liquidacion.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .neq('estado', 'pagada')
    .select('id');
  if (errorBorrado) return res.status(500).json({ error: errorBorrado.message });
  if (!borrada?.length) {
    return res.status(409).json({ error: 'La liquidación ya no está, o quedó pagada mientras tanto' });
  }
  res.json({ ok: true });
});

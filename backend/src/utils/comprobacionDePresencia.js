import { supabase } from '../db/connection.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import {
  codigoCoincide,
  codigoNuevo,
  codigoNuevoParaGuardar,
  estaVencido,
  huellaDelCodigo,
  seAgotaronLosIntentos,
  sumarIntento,
  vencimientoEnMinutos,
  vencimientoEnSegundos,
} from './codigoDeUnSoloUso.js';
import { MOTIVOS_SIN_COMPROBAR } from './motivosSinComprobar.js';

// Cómo se comprueba que el Asistente está realmente en el domicilio cuando marca la llegada y
// cuando cierra (pendiente #113). El GPS sigue diciendo dónde está el teléfono; esto dice que
// además hubo alguien, o alguien de la Prestadora, del otro lado.
//
// HAY DOS CAMINOS Y UN PISO
//
//   Plan A — el código lo muestra una persona en la pantalla de su teléfono: la Familia, o el
//   Asistente que se va cuando hay relevo. Se renueva solo cada pocos segundos, así que una foto
//   de esa pantalla no sirve un minuto después. Reemplaza al cartel impreso, que era un secreto
//   permanente a la vista de cualquiera que pasara por la puerta.
//
//   Plan B — cuando no hay nadie que pueda mostrarlo, el Asistente avisa con sus palabras, eso
//   aparece en la pantalla de la Prestadora, y quien está de turno —después de resolverlo como
//   esa Prestadora decida— suelta un código de un solo uso que vale para esa guardia, ese momento
//   y unos pocos minutos.
//
//   El piso — si en la Prestadora no atiende nadie, se entra igual eligiendo un motivo, y la
//   llegada queda SIN COMPROBAR en la lista del Coordinador. La guardia nunca se traba.
//
// EL PACIENTE NO ESTÁ EN ESTA LISTA, Y NO ES UN OLVIDO. El diseño aprobado dice que el código lo
// puede mostrar «la Familia, el Paciente, o el Asistente saliente». En este producto el Paciente
// no tiene cuenta —los roles posibles son admin_prestadora, coordinador, asistente, familia y
// superadmin— ni aplicación propia, así que no tiene ninguna pantalla en la que mostrar un
// código. Cuando la tenga, se agrega acá un tercer sujeto_tipo y nada más.

// Los mismos números que la base pone por omisión en las columnas. Se repiten acá para el único
// caso en que la base no llega a aplicarlos, que es cuando esa Prestadora no tiene fila de
// configuración (mismo criterio que `toleranciaCheckin.js`).
export const SEGUNDOS_EN_PANTALLA_POR_OMISION = 30;
export const MINUTOS_CODIGO_DE_LA_PRESTADORA_POR_OMISION = 10;

// Los mismos topes que las restricciones `..._razonable` de la migración. Se repiten acá para que
// la pantalla de Configuración pueda explicar por qué no acepta un valor, en vez de dejar que lo
// rechace la base con el texto crudo de una restricción.
export const SEGUNDOS_EN_PANTALLA_MINIMO = 10;
export const SEGUNDOS_EN_PANTALLA_MAXIMO = 300;
export const MINUTOS_CODIGO_DE_LA_PRESTADORA_MINIMO = 1;
export const MINUTOS_CODIGO_DE_LA_PRESTADORA_MAXIMO = 120;

// La lista corta que el Asistente elige cuando entra sin comprobar. Se re-exporta desde acá para
// que el resto del motor la siga pidiendo en un solo lugar, pero la lista en sí vive en
// `motivosSinComprobar.js`, que es copia del archivo que usa la pantalla: el teléfono ofrece los
// motivos y el motor los valida, y las dos listas tienen que ser la misma.
export { MOTIVOS_SIN_COMPROBAR };

const LARGO_MAXIMO_DEL_PEDIDO = 500;
const LARGO_MAXIMO_DE_LA_NOTA = 1000;

export async function configuracionDeComprobacion(prestadoraId) {
  const { data } = await supabase
    .from('configuracion_ausencia_automatica')
    .select('segundos_codigo_en_pantalla, minutos_codigo_de_la_prestadora')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  const segundos = data?.segundos_codigo_en_pantalla;
  const minutos = data?.minutos_codigo_de_la_prestadora;
  return {
    segundosEnPantalla: Number.isFinite(segundos) && segundos > 0 ? segundos : SEGUNDOS_EN_PANTALLA_POR_OMISION,
    minutosCodigoDeLaPrestadora:
      Number.isFinite(minutos) && minutos > 0 ? minutos : MINUTOS_CODIGO_DE_LA_PRESTADORA_POR_OMISION,
  };
}

// ---------------------------------------------------------------------------------------
// Plan A — el código que se muestra en pantalla
// ---------------------------------------------------------------------------------------

/**
 * Devuelve el código que esta persona tiene que mostrar ahora. Cada vez que se pide, se genera
 * uno nuevo y el anterior deja de valer: eso es lo que quiere decir que se renueva solo. La
 * pantalla lo vuelve a pedir cada `segundos`.
 *
 * `sujetoTipo` es 'familia' (el círculo familiar entero) o 'asistente' (el que se va).
 */
export async function codigoParaMostrar({ prestadoraId, sujetoTipo, sujetoId }) {
  if (!prestadoraId || !sujetoId || !['familia', 'asistente'].includes(sujetoTipo)) {
    throw new ErrorConMotivo('faltan_datos', 'No se puede armar un código sin saber quién lo muestra');
  }

  const { segundosEnPantalla } = await configuracionDeComprobacion(prestadoraId);
  const codigo = codigoNuevo();
  const expiraEn = vencimientoEnSegundos(segundosEnPantalla);

  const { error } = await supabase
    .from('codigos_de_presencia')
    .upsert(
      {
        prestadora_id: prestadoraId,
        sujeto_tipo: sujetoTipo,
        sujeto_id: sujetoId,
        codigo_huella: huellaDelCodigo(codigo),
        expira_en: expiraEn,
      },
      { onConflict: 'sujeto_tipo,sujeto_id' },
    );
  if (error) throw new Error(error.message);

  return { codigo, segundos: segundosEnPantalla, expiraEn };
}

/**
 * Quiénes podrían estar mostrando un código válido para esta guardia. Se resuelve del lado del
 * motor y nunca con un dato que venga en el pedido: si el teléfono pudiera decir a quién
 * comparar, podría decir cualquiera.
 *
 * Son dos: los círculos familiares de los Pacientes de esta guardia, y el Asistente que todavía
 * está adentro —el que tiene una guardia abierta sobre alguno de esos mismos Pacientes—, que es
 * la definición operativa de «hay relevo».
 */
export async function sujetosQuePuedenMostrar(guardia) {
  const { data: filas } = await supabase
    .from('guardia_pacientes')
    .select('paciente_id')
    .eq('guardia_id', guardia.id)
    .eq('prestadora_id', guardia.prestadora_id);

  const pacienteIds = (filas ?? []).map((f) => f.paciente_id);
  if (pacienteIds.length === 0 && guardia.paciente_id) pacienteIds.push(guardia.paciente_id);
  if (pacienteIds.length === 0) return [];

  const sujetos = [];

  const { data: pacientes } = await supabase
    .from('pacientes')
    .select('id, familia_id')
    .in('id', pacienteIds)
    .eq('prestadora_id', guardia.prestadora_id);

  for (const paciente of pacientes ?? []) {
    if (paciente.familia_id && !sujetos.some((s) => s.tipo === 'familia' && s.id === paciente.familia_id)) {
      sujetos.push({ tipo: 'familia', id: paciente.familia_id });
    }
  }

  // El Asistente saliente. Se lo busca por las guardias abiertas sobre los mismos Pacientes, no
  // por horario: quien todavía no cerró es quien todavía está.
  const { data: otrasGuardias } = await supabase
    .from('guardia_pacientes')
    .select('guardia_id, guardias!inner(id, asistente_id, estado, checkout_at)')
    .in('paciente_id', pacienteIds)
    .eq('prestadora_id', guardia.prestadora_id)
    .eq('guardias.estado', 'activa')
    .is('guardias.checkout_at', null);

  for (const fila of otrasGuardias ?? []) {
    const otra = fila.guardias;
    if (!otra || otra.id === guardia.id || !otra.asistente_id) continue;
    if (!sujetos.some((s) => s.tipo === 'asistente' && s.id === otra.asistente_id)) {
      sujetos.push({ tipo: 'asistente', id: otra.asistente_id });
    }
  }

  return sujetos;
}

// ---------------------------------------------------------------------------------------
// La comprobación de una llegada o de una salida
// ---------------------------------------------------------------------------------------

export async function comprobacionDe(guardiaId, momento) {
  const { data } = await supabase
    .from('guardia_comprobaciones')
    .select('*')
    .eq('guardia_id', guardiaId)
    .eq('momento', momento)
    .maybeSingle();
  return data ?? null;
}

function ahora() {
  return new Date().toISOString();
}

async function guardarComprobacion(fila) {
  const { data, error } = await supabase
    .from('guardia_comprobaciones')
    .upsert({ ...fila, updated_at: ahora() }, { onConflict: 'guardia_id,momento' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * ¿El código que tipeó o escaneó el Asistente es de alguien que está en esa casa, o lo soltó la
 * Prestadora para esta guardia?
 *
 * Devuelve `{ medio, sujetoTipo, sujetoId }`. Si no coincide con ninguno, lanza el motivo, y la
 * pantalla ofrece volver a intentar o pedirle un código a la Prestadora. Que un código
 * equivocado no marque la llegada no traba nada: el camino de «no hay quién me lo muestre» y el
 * de «entro igual con un motivo» están siempre a un botón de distancia.
 */
async function resolverCodigo({ guardia, momento, codigo }) {
  const texto = String(codigo ?? '').trim();
  if (!texto) throw new ErrorConMotivo('faltan_datos', 'Falta el código');

  // Primero el de la Prestadora, si esta comprobación estaba esperando uno.
  const fila = await comprobacionDe(guardia.id, momento);
  if (fila?.codigo_huella) {
    // El vencimiento va primero, y es lo que deja andar el caso legítimo: un código vencido no
    // gasta intento, así que quien pide otro porque se le venció no pierde nada (pendiente #177).
    if (estaVencido(fila.codigo_expira_en)) {
      throw new ErrorConMotivo('codigo_vencido', 'El código de la Prestadora venció');
    }

    // Se cuenta el intento antes de comparar, y la suma la hace la base en un solo paso. Antes se
    // leía y se escribía por separado, y dos intentos a la vez contaban como uno.
    const intentos = await sumarIntento({ tabla: 'guardia_comprobaciones', id: fila.id });
    if (seAgotaronLosIntentos(intentos)) {
      throw new ErrorConMotivo('demasiados_intentos', 'Se agotaron los intentos con este código');
    }

    if (codigoCoincide(texto, fila.codigo_huella)) {
      return { medio: 'codigo_prestadora', sujetoTipo: null, sujetoId: null };
    }
  }

  // Después, los de las personas que podrían estar en la casa.
  const sujetos = await sujetosQuePuedenMostrar(guardia);
  if (sujetos.length > 0) {
    const { data: vigentes } = await supabase
      .from('codigos_de_presencia')
      .select('sujeto_tipo, sujeto_id, codigo_huella, expira_en')
      .eq('prestadora_id', guardia.prestadora_id)
      .in('sujeto_id', sujetos.map((s) => s.id))
      .gt('expira_en', ahora());

    for (const vigente of vigentes ?? []) {
      const esCandidato = sujetos.some((s) => s.tipo === vigente.sujeto_tipo && s.id === vigente.sujeto_id);
      if (!esCandidato) continue;
      if (!codigoCoincide(texto, vigente.codigo_huella)) continue;
      return {
        medio: vigente.sujeto_tipo === 'familia' ? 'codigo_familia' : 'codigo_asistente_saliente',
        sujetoTipo: vigente.sujeto_tipo,
        sujetoId: vigente.sujeto_id,
      };
    }
  }

  throw new ErrorConMotivo('codigo_incorrecto', 'El código no corresponde a nadie de este domicilio');
}

/**
 * Deja anotado cómo se comprobó esta llegada o esta salida. Se llama desde /checkin y /checkout,
 * después de haber validado el código y antes de contestar.
 *
 * `comprobacion` viene del teléfono y tiene una de estas dos formas:
 *   { codigo: '123456' }                                  — alguien lo mostró, o lo soltó la Prestadora
 *   { motivoSinComprobar: 'nadie_para_mostrar', detalle }  — se entra igual, y queda en la lista
 *
 * Devuelve `{ estado, medio, avisarFamilia }`.
 */
export async function registrarComprobacion({ guardia, momento, lat, lng, comprobacion }) {
  const base = {
    prestadora_id: guardia.prestadora_id,
    guardia_id: guardia.id,
    asistente_id: guardia.asistente_id,
    momento,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };

  if (comprobacion?.codigo) {
    const { medio, sujetoTipo, sujetoId } = await resolverCodigo({ guardia, momento, codigo: comprobacion.codigo });
    await guardarComprobacion({
      ...base,
      estado: 'comprobada',
      medio,
      sujeto_tipo: sujetoTipo,
      sujeto_id: sujetoId,
      comprobada_en: ahora(),
      motivo_sin_comprobar: null,
      motivo_detalle: null,
      // El código ya cumplió: se borra la huella para que no quede viva la de algo de un solo uso.
      codigo_huella: null,
      codigo_expira_en: null,
    });
    // A la Familia se le avisa cuando ella no participó de la comprobación. Si el código lo
    // mostró ella misma, ya se enteró mostrándolo.
    return { estado: 'comprobada', medio, avisarFamilia: medio !== 'codigo_familia' };
  }

  const motivo = comprobacion?.motivoSinComprobar;
  if (!MOTIVOS_SIN_COMPROBAR.includes(motivo)) {
    throw new ErrorConMotivo('faltan_datos', 'Falta el código o el motivo por el que no se pudo comprobar');
  }

  await guardarComprobacion({
    ...base,
    estado: 'sin_comprobar',
    medio: null,
    sujeto_tipo: null,
    sujeto_id: null,
    comprobada_en: null,
    motivo_sin_comprobar: motivo,
    motivo_detalle: String(comprobacion.detalle ?? '').trim().slice(0, LARGO_MAXIMO_DEL_PEDIDO) || null,
    codigo_huella: null,
    codigo_expira_en: null,
  });

  return { estado: 'sin_comprobar', medio: null, avisarFamilia: false };
}

// ---------------------------------------------------------------------------------------
// Plan B — el Asistente pide, la Prestadora suelta
// ---------------------------------------------------------------------------------------

/**
 * El Asistente avisa, con sus palabras, que no tiene a quién pedirle el código. Queda esperando
 * en la pantalla de la Prestadora. No marca ni la llegada ni la salida: sólo abre el pedido.
 */
export async function pedirCodigoALaPrestadora({ guardia, momento, texto }) {
  const yaHay = await comprobacionDe(guardia.id, momento);
  if (yaHay?.estado === 'comprobada') {
    throw new ErrorConMotivo('ya_comprobada', 'Esta llegada ya quedó comprobada');
  }

  const fila = await guardarComprobacion({
    prestadora_id: guardia.prestadora_id,
    guardia_id: guardia.id,
    asistente_id: guardia.asistente_id,
    momento,
    estado: 'pendiente_de_codigo',
    medio: null,
    sujeto_tipo: null,
    sujeto_id: null,
    comprobada_en: null,
    motivo_sin_comprobar: null,
    motivo_detalle: null,
    pedido_texto: String(texto ?? '').trim().slice(0, LARGO_MAXIMO_DEL_PEDIDO) || null,
    pedido_en: ahora(),
    codigo_huella: null,
    codigo_expira_en: null,
    // `codigo_intentos` NO se vuelve a cero acá, y no es un olvido: este pedido lo abre el mismo
    // Asistente que después prueba los códigos, así que devolver la cuenta desde acá era darle el
    // botón de reiniciar su propio tope (pendiente #177). Al dar de alta la fila la base pone 0
    // por omisión; al pisar una que ya existe, la cuenta queda como estaba.
    codigo_emitido_por: null,
    codigo_emitido_en: null,
  });

  return { id: fila.id, estado: fila.estado, pedidoEn: fila.pedido_en };
}

/** Los pedidos que están esperando que alguien de la Prestadora los resuelva. */
export async function pedidosEsperandoCodigo(prestadoraId) {
  const { data, error } = await supabase
    .from('guardia_comprobaciones')
    .select(`
      id, momento, pedido_texto, pedido_en, codigo_expira_en, codigo_emitido_en,
      guardia_id, guardias!guardia_comprobaciones_guardia_tenant_fk(fecha, hora_inicio, hora_fin),
      asistente_id, asistentes!guardia_comprobaciones_asistente_tenant_fk(nombre)
    `)
    .eq('prestadora_id', prestadoraId)
    .eq('estado', 'pendiente_de_codigo')
    .order('pedido_en', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((fila) => ({
    id: fila.id,
    guardiaId: fila.guardia_id,
    momento: fila.momento,
    texto: fila.pedido_texto,
    pedidoEn: fila.pedido_en,
    asistente: fila.asistentes?.nombre ?? null,
    fecha: fila.guardias?.fecha ?? null,
    horaInicio: fila.guardias?.hora_inicio ?? null,
    horaFin: fila.guardias?.hora_fin ?? null,
    // Si ya se soltó un código y todavía está vigente, la pantalla lo dice en vez de ofrecer
    // soltar otro sin querer.
    codigoVigente: Boolean(fila.codigo_expira_en) && !estaVencido(fila.codigo_expira_en),
    codigoEmitidoEn: fila.codigo_emitido_en,
  }));
}

/**
 * Quien está de turno en la Prestadora resolvió el pedido como esa Prestadora decida —llamada,
 * videollamada, lo que sea— y suelta el código. Vale para esa guardia, ese momento y los minutos
 * que la Prestadora configuró. El código se devuelve una sola vez, acá; después queda la huella.
 */
export async function emitirCodigoDeLaPrestadora({ comprobacionId, prestadoraId, emitidoPor }) {
  const { data: fila } = await supabase
    .from('guardia_comprobaciones')
    .select('id, estado')
    .eq('id', comprobacionId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (!fila) throw new ErrorConMotivo('no_encontrado', 'No se encontró ese pedido');
  if (fila.estado !== 'pendiente_de_codigo') {
    throw new ErrorConMotivo('ya_resuelta', 'Ese pedido ya no está esperando un código');
  }

  const { minutosCodigoDeLaPrestadora } = await configuracionDeComprobacion(prestadoraId);

  // El código nuevo no devuelve intentos: la cuenta es de esta llegada y no del código de turno
  // (pendiente #177). El porqué está escrito una sola vez en `codigoDeUnSoloUso.js`.
  const { codigo, campos } = codigoNuevoParaGuardar(vencimientoEnMinutos(minutosCodigoDeLaPrestadora));

  const { error } = await supabase
    .from('guardia_comprobaciones')
    .update({
      ...campos,
      codigo_emitido_por: emitidoPor,
      codigo_emitido_en: ahora(),
      updated_at: ahora(),
    })
    .eq('id', comprobacionId)
    .eq('estado', 'pendiente_de_codigo');
  if (error) throw new Error(error.message);

  return { codigo, minutos: minutosCodigoDeLaPrestadora };
}

// ---------------------------------------------------------------------------------------
// El piso — la lista que el Coordinador cierra
// ---------------------------------------------------------------------------------------

export async function llegadasSinComprobar(prestadoraId) {
  const { data, error } = await supabase
    .from('guardia_comprobaciones')
    .select(`
      id, momento, motivo_sin_comprobar, motivo_detalle, created_at,
      guardia_id, guardias!guardia_comprobaciones_guardia_tenant_fk(fecha, hora_inicio, hora_fin),
      asistente_id, asistentes!guardia_comprobaciones_asistente_tenant_fk(nombre)
    `)
    .eq('prestadora_id', prestadoraId)
    .eq('estado', 'sin_comprobar')
    .is('cerrada_en', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((fila) => ({
    id: fila.id,
    guardiaId: fila.guardia_id,
    momento: fila.momento,
    motivo: fila.motivo_sin_comprobar,
    detalle: fila.motivo_detalle,
    ocurridaEn: fila.created_at,
    asistente: fila.asistentes?.nombre ?? null,
    fecha: fila.guardias?.fecha ?? null,
    horaInicio: fila.guardias?.hora_inicio ?? null,
    horaFin: fila.guardias?.hora_fin ?? null,
  }));
}

export async function cerrarSinComprobar({ comprobacionId, prestadoraId, cerradaPor, nota }) {
  const { data: fila } = await supabase
    .from('guardia_comprobaciones')
    .select('id, estado, cerrada_en')
    .eq('id', comprobacionId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (!fila) throw new ErrorConMotivo('no_encontrado', 'No se encontró esa llegada');
  if (fila.estado !== 'sin_comprobar') throw new ErrorConMotivo('no_corresponde', 'Esa llegada no quedó sin comprobar');
  if (fila.cerrada_en) throw new ErrorConMotivo('ya_cerrada', 'Esa llegada ya está cerrada');

  const { error } = await supabase
    .from('guardia_comprobaciones')
    .update({
      cerrada_en: ahora(),
      cerrada_por: cerradaPor,
      cerrada_nota: String(nota ?? '').trim().slice(0, LARGO_MAXIMO_DE_LA_NOTA) || null,
      updated_at: ahora(),
    })
    .eq('id', comprobacionId)
    .is('cerrada_en', null);
  if (error) throw new Error(error.message);
}

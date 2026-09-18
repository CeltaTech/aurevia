import { supabase } from '../db/connection.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import {
  IDIOMA_DEL_DOCUMENTO,
  MODELO_DE_FABRICA,
  huellaDelDocumento,
  textoDelConsentimiento,
} from './documentoConsentimientoPagador.js';

// Todo lo que le pasa al consentimiento del Pagador: se carga, se cierra con la hoja firmada, o se
// anula porque se cargó otro.
//
// SIN ESA FIRMA NO HAY PAGADOR DEFINIDO, Y AUN ASÍ NO SE BLOQUEA NADA. La contratación sigue, el
// Servicio se presta y la Familia se da de alta igual. Lo único que cambia es que la pantalla lo
// dice, ahí donde se elige el Pagador, para que nadie se entere el día que hay que cobrar. Decidir
// es de quien tiene la responsabilidad, no del sistema.
//
// UNO PENDIENTE POR FAMILIA. Si se carga otro antes de que se firme el anterior, el anterior se
// anula: lo último que se le hizo firmar es lo que vale. La base lo exige además con un índice
// único, así que esto no es la única defensa.
//
// LOS PAPELES SON APARTE DE LA FIRMA. El consentimiento lo firma quien paga; los papeles los exige
// el financiador, y qué papeles son lo sabe cada Prestadora. Que falte uno no invalida la firma, y
// que esté la firma no completa los papeles: son dos cosas y la pantalla muestra las dos.

const DEPOSITO = 'documentos-pagador';

// El texto que rige para esta Prestadora: el suyo si lo cargó, el modelo del producto si no.
export async function cuerpoVigente({ prestadoraId, idioma = IDIOMA_DEL_DOCUMENTO }) {
  const { data } = await supabase
    .from('textos_consentimiento_pagador')
    .select('cuerpo, updated_at')
    .eq('prestadora_id', prestadoraId)
    .eq('idioma', idioma)
    .maybeSingle();

  return {
    cuerpo: data?.cuerpo ?? MODELO_DE_FABRICA,
    esDelProducto: !data,
    actualizadoEn: data?.updated_at ?? null,
    idioma,
  };
}

async function familiaConSuPagador({ familiaId, prestadoraId }) {
  const { data: familia } = await supabase
    .from('familias')
    .select('id, prestadora_id, pagador_legajo_id, financiador_tipo')
    .eq('id', familiaId)
    .maybeSingle();

  if (!familia || familia.prestadora_id !== prestadoraId) {
    throw new ErrorConMotivo('no_encontrado', 'Familia no encontrada');
  }
  return familia;
}

async function legajo(legajoId) {
  if (!legajoId) return null;
  const { data } = await supabase
    .from('legajos')
    .select('id, nombre_visible, clase, documento_tipo, documento_numero, apoderado_legajo_id')
    .eq('id', legajoId)
    .maybeSingle();
  if (!data) return null;

  return {
    id: data.id,
    nombre: data.nombre_visible,
    clase: data.clase,
    apoderadoLegajoId: data.apoderado_legajo_id,
    documento: data.documento_numero
      ? `${data.documento_tipo} ${data.documento_numero}`
      : null,
  };
}

// Quién firma de puño y letra. Una persona física firma ella misma; una entidad no tiene mano, y
// por ella firma su Apoderado, que es quien tiene poder legal para obligarla y está anotado en su
// Legajo.
//
// Devuelve nulo cuando paga una persona física, y también cuando paga una entidad que todavía no
// tiene Apoderado configurado. Ese segundo caso no rompe nada: el documento se arma igual y la
// pantalla avisa que falta. No bloquear es la regla, acá como en todo lo demás.
async function apoderadoDe(pagador) {
  if (pagador?.clase !== 'juridica' || !pagador.apoderadoLegajoId) return null;
  return legajo(pagador.apoderadoLegajoId);
}

// Arma el documento con lo de esta contratación, lo guarda tal cual y lo deja esperando firma.
//
// El nombre de quien firma se guarda escrito además de apuntado al Legajo: el Legajo dice con quién
// quedó atado, y el nombre, cómo se llamaba el día que leyó la hoja.
export async function crearConsentimiento({ familiaId, prestadoraId, cargadoPor }) {
  const familia = await familiaConSuPagador({ familiaId, prestadoraId });
  if (!familia.pagador_legajo_id) {
    throw new ErrorConMotivo('sin_pagador', 'Esta contratación todavía no tiene Pagador elegido');
  }

  const pagador = await legajo(familia.pagador_legajo_id);
  if (!pagador) {
    throw new ErrorConMotivo('no_encontrado', 'El Legajo del Pagador no existe');
  }

  const [{ cuerpo, idioma }, { data: prestadora }, cliente, apoderado] = await Promise.all([
    cuerpoVigente({ prestadoraId }),
    supabase.from('prestadoras').select('nombre_fantasia').eq('id', prestadoraId).maybeSingle(),
    nombreDeLaContratacion(familiaId),
    apoderadoDe(pagador),
  ]);

  const texto = textoDelConsentimiento({
    cuerpo,
    prestadora: { nombre: prestadora?.nombre_fantasia },
    pagador,
    cliente: { nombre: cliente },
    apoderado,
  });

  // El anterior se anula antes de insertar el nuevo, o el índice único de la base rechaza la
  // inserción. No se borra: el historial de lo que se fue firmando es lo que esta tabla guarda.
  const { error: errorAnular } = await supabase
    .from('consentimientos_pagador')
    .update({ estado: 'anulado' })
    .eq('familia_id', familiaId)
    .eq('estado', 'pendiente_firma');
  if (errorAnular) throw new Error(errorAnular.message);

  const { data: consentimiento, error } = await supabase
    .from('consentimientos_pagador')
    .insert({
      prestadora_id: prestadoraId,
      familia_id: familiaId,
      pagador_legajo_id: pagador.id,
      pagador_nombre: pagador.nombre,
      // Quién firmó por la entidad se copia acá el día que se arma, igual que el nombre de quien
      // paga: si mañana la entidad cambia de apoderado, el papel sigue diciendo quién lo firmó.
      firmante_legajo_id: apoderado?.id ?? null,
      firmante_nombre: apoderado?.nombre ?? null,
      documento_texto: texto,
      documento_huella: huellaDelDocumento(texto),
      documento_idioma: idioma,
      cargado_por: cargadoPor,
    })
    .select('id, estado, documento_texto, documento_huella, documento_idioma, pagador_nombre, firmante_nombre, created_at')
    .single();
  if (error) throw new Error(error.message);

  return consentimiento;
}

// Cómo nombrar la contratación adentro del documento. Es el apellido y los nombres del Paciente,
// que es lo mismo que la pantalla muestra: quien firma tiene que reconocer por quién se obliga.
// El nombre visible se calcula al mostrarlo y no se guarda (CLAUDE.md del producto §6); acá se
// escribe adentro del documento porque un documento firmado no se recalcula nunca más.
async function nombreDeLaContratacion(familiaId) {
  const { data } = await supabase
    .from('pacientes')
    .select('nombre, created_at')
    .eq('familia_id', familiaId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.nombre ?? null;
}

// El camino de siempre: quien paga firmó la hoja y la Prestadora la guarda. La ruta que sube el
// archivo se encarga del depósito; acá sólo se cierra.
export async function cerrarConPapelFirmado({ consentimientoId, prestadoraId, archivoUrl }) {
  const { data: consentimiento } = await supabase
    .from('consentimientos_pagador')
    .select('id, estado')
    .eq('id', consentimientoId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (!consentimiento) throw new ErrorConMotivo('no_encontrado', 'Consentimiento no encontrado');
  if (consentimiento.estado !== 'pendiente_firma') {
    throw new ErrorConMotivo('ya_cerrado', 'Este consentimiento ya no está pendiente de firma');
  }

  const { error } = await supabase
    .from('consentimientos_pagador')
    .update({
      estado: 'cerrado',
      cerrado_como: 'papel_firmado',
      cerrado_en: new Date().toISOString(),
      archivo_firmado_url: archivoUrl,
    })
    .eq('id', consentimientoId)
    .eq('estado', 'pendiente_firma');
  if (error) throw new Error(error.message);
}

// Se anula el pendiente sin reemplazarlo: se cargó por error, o cambió el Pagador y todavía no se
// sabe cuál es el nuevo. Lo cerrado no se anula nunca: ya lo firmó alguien.
export async function anularPendiente({ consentimientoId, prestadoraId }) {
  const { data, error } = await supabase
    .from('consentimientos_pagador')
    .update({ estado: 'anulado' })
    .eq('id', consentimientoId)
    .eq('prestadora_id', prestadoraId)
    .eq('estado', 'pendiente_firma')
    .select('id');
  if (error) throw new Error(error.message);

  if (!data?.length) {
    throw new ErrorConMotivo('ya_cerrado', 'Este consentimiento ya no está pendiente de firma');
  }
}

// ---------------------------------------------------------------------------------------
// El punto único de verdad del estado
// ---------------------------------------------------------------------------------------
//
// Contesta lo mismo a todo el que pregunte: si el Pagador está definido, y qué le falta. Lo
// consume la pantalla donde se elige el Pagador, y cualquier otra que mañana necesite saberlo. La
// decisión de qué cuenta como «definido» vive acá y en ningún otro lado: repartida entre pantallas
// terminaría diciendo cosas distintas según dónde se mire.
export async function estadoDelPagador({ familiaId, prestadoraId }) {
  const familia = await familiaConSuPagador({ familiaId, prestadoraId });

  const [pagador, { data: consentimientos }, papeles] = await Promise.all([
    legajo(familia.pagador_legajo_id),
    supabase
      .from('consentimientos_pagador')
      // El texto viene entero: la pantalla lo muestra tal como se guardó, y armarlo de nuevo para
      // mostrarlo daría otro documento el día que la Prestadora cambie su modelo.
      .select('id, estado, pagador_legajo_id, pagador_nombre, firmante_nombre, documento_texto, documento_idioma, archivo_firmado_url, cerrado_como, cerrado_en, created_at')
      .eq('familia_id', familiaId)
      .in('estado', ['pendiente_firma', 'cerrado'])
      .order('created_at', { ascending: false }),
    papelesDelPagador({ familiaId, prestadoraId, financiadorTipo: familia.financiador_tipo }),
  ]);

  const pendiente = (consentimientos ?? []).find((fila) => fila.estado === 'pendiente_firma') ?? null;
  const cerrado = (consentimientos ?? []).find((fila) => fila.estado === 'cerrado') ?? null;

  // Si el consentimiento firmado quedó atado a otro Legajo que el que hoy figura como Pagador, la
  // firma no vale para éste: firmó otra persona. Se avisa en vez de ocultarlo, porque el papel
  // existe y alguien lo tiene que mirar.
  const firmadoPorOtro = Boolean(
    cerrado && familia.pagador_legajo_id && cerrado.pagador_legajo_id !== familia.pagador_legajo_id,
  );

  // Si paga una entidad, quien firma es su Apoderado. Que no lo tenga configurado no impide nada
  // —el documento se arma igual—, pero saldría sin decir qué persona lo firma, y eso se avisa
  // antes y no después.
  const apoderado = await apoderadoDe(pagador);
  const faltaApoderado = Boolean(pagador && pagador.clase === 'juridica' && !apoderado);

  return {
    pagador,
    apoderado,
    faltaApoderado,
    // Definido quiere decir las tres cosas: hay Legajo elegido, hay consentimiento cerrado, y lo
    // firmó justamente quien hoy figura como Pagador.
    definido: Boolean(familia.pagador_legajo_id && cerrado && !firmadoPorOtro),
    firmadoPorOtro,
    consentimientoPendiente: pendiente,
    consentimientoCerrado: cerrado,
    papeles,
    papelesFaltantes: papeles.filter((papel) => !papel.cargado).length,
    papelesVencidos: papeles.filter((papel) => papel.vencido).length,
  };
}

// Qué papeles exige este financiador y cuáles están. Se devuelve el catálogo entero, tenga o no
// archivo cargado cada uno: lo que falta sólo se ve si el renglón aparece igual.
export async function papelesDelPagador({ familiaId, prestadoraId, financiadorTipo }) {
  let query = supabase
    .from('tipos_documento_pagador')
    .select('id, nombre, financiador_tipo, requiere_vencimiento')
    .eq('prestadora_id', prestadoraId)
    .eq('activo', true)
    .order('nombre', { ascending: true });

  // Nulo en el catálogo quiere decir «a todos». Cuando la contratación todavía no dice quién
  // financia, se muestran nada más que esos: exigir los de una obra social sin saber si la hay
  // sería inventar un requisito.
  query = financiadorTipo
    ? query.or(`financiador_tipo.is.null,financiador_tipo.eq.${financiadorTipo}`)
    : query.is('financiador_tipo', null);

  const { data: tipos, error } = await query;
  if (error) throw new Error(error.message);

  const { data: cargados } = await supabase
    .from('documentos_pagador')
    .select('id, tipo_documento_id, archivo_url, fecha_vencimiento, created_at')
    .eq('familia_id', familiaId);

  const porTipo = new Map((cargados ?? []).map((fila) => [fila.tipo_documento_id, fila]));
  const hoy = new Date().toISOString().slice(0, 10);

  return (tipos ?? []).map((tipo) => {
    const cargado = porTipo.get(tipo.id) ?? null;
    return {
      tipoId: tipo.id,
      nombre: tipo.nombre,
      financiadorTipo: tipo.financiador_tipo,
      requiereVencimiento: tipo.requiere_vencimiento,
      cargado: Boolean(cargado?.archivo_url),
      documentoId: cargado?.id ?? null,
      fechaVencimiento: cargado?.fecha_vencimiento ?? null,
      vencido: Boolean(cargado?.fecha_vencimiento && cargado.fecha_vencimiento < hoy),
    };
  });
}

// Guarda un papel que ya se subió al depósito. La ruta del archivo la arma quien sube; acá se anota
// cuál es y hasta cuándo vale.
export async function guardarPapel({
  familiaId, prestadoraId, tipoDocumentoId, archivoUrl, fechaVencimiento, cargadoPor,
}) {
  const { data: tipo } = await supabase
    .from('tipos_documento_pagador')
    .select('id')
    .eq('id', tipoDocumentoId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (!tipo) throw new ErrorConMotivo('no_encontrado', 'Ese tipo de documento no existe');

  await familiaConSuPagador({ familiaId, prestadoraId });

  const { error } = await supabase
    .from('documentos_pagador')
    .upsert({
      prestadora_id: prestadoraId,
      familia_id: familiaId,
      tipo_documento_id: tipoDocumentoId,
      archivo_url: archivoUrl,
      fecha_vencimiento: fechaVencimiento || null,
      cargado_por: cargadoPor,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'familia_id,tipo_documento_id' });
  if (error) throw new Error(error.message);
}

// Dónde va cada archivo adentro del depósito. La ruta empieza siempre por la Prestadora, que es lo
// que exige su política: nadie alcanza el archivo de otra ni adivinando el nombre.
export function rutaDelArchivo({ prestadoraId, familiaId, nombre, extension }) {
  return `${prestadoraId}/${familiaId}/${nombre}.${extension}`;
}

export const DEPOSITO_PAGADOR = DEPOSITO;

import { supabase } from '../db/connection.js';
import { accesosParaGuardar, mezclarAccesosConCatalogo } from './catalogoCirculoFamiliar.js';
import { visibilidadDeLaPrestadora } from './visibilidadPrestadora.js';
import { textoDeLaInstruccion, huellaDelDocumento, IDIOMA_DEL_DOCUMENTO } from './documentoInstruccionCirculo.js';
import { enviarWhatsApp } from './whatsapp.js';
import { enviarEmail } from './email.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import {
  INTENTOS_MAXIMOS,
  codigoCoincide,
  codigoNuevo,
  estaVencido,
  huellaDelCodigo,
  vencimientoEnMinutos,
} from './codigoDeUnSoloUso.js';

// Todo lo que le pasa a una instrucción sobre los accesos del círculo familiar: se carga, se firma
// —desde la aplicación con un código, o en papel—, o se anula porque llegó otra.
//
// LOS PERMISOS RIGEN DESDE QUE SE CARGA, NO DESDE QUE SE FIRMA. Es a propósito y es lo que se
// aprobó: si hay una urgencia —una separación, una pelea— la Prestadora corta el acceso en el
// momento y el papel se regulariza después. Mientras tanto la instrucción queda en
// `pendiente_firma`, que es un estado normal y no un error, y la pantalla del Panel lo muestra
// para que nadie se olvide de cerrarlo.
//
// UNA SOLA PENDIENTE POR FAMILIA. Si llega una instrucción nueva antes de que se firme la
// anterior, la anterior se anula: lo último que pidió el titular es lo que vale, y dos pendientes
// a la vez dejarían al titular firmando algo que ya no rige. La base lo exige además con un índice
// único, así que esto no es la única defensa.
//
// EL CÓDIGO ES DE UN SOLO USO Y SE GUARDA SU HUELLA, NUNCA EL CÓDIGO. Cómo se arma, cómo se
// compara y cuántos intentos se toleran está una sola vez, en `codigoDeUnSoloUso.js`: es el mismo
// mecanismo que usan la recuperación de acceso y el pase de guardia.
const VIGENCIA_DEL_CODIGO_MINUTOS = 10;

// Quiénes son las personas del círculo de esta Familia, sin el titular. El titular también tiene
// fila —apuntando a sí mismo, que es lo que deja resolver de una consulta a qué Familia pertenece
// alguien—, pero él no entra en esta cuenta: ve todo siempre, y ninguna instrucción le puede
// quitar nada, ni siquiera una suya.
async function personasDelCirculo(familiaId) {
  const { data, error } = await supabase
    .from('miembros_familia')
    .select('usuario_id, email, created_at, usuarios!miembros_familia_usuario_id_fkey(nombre)')
    .eq('familia_id', familiaId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((fila) => fila.usuario_id !== familiaId)
    .map((fila) => ({
      usuarioId: fila.usuario_id,
      email: fila.email,
      nombre: fila.usuarios?.nombre ?? null,
    }));
}

async function nombreDe(usuarioId) {
  if (!usuarioId) return null;
  const { data } = await supabase.from('usuarios').select('nombre').eq('id', usuarioId).maybeSingle();
  return data?.nombre ?? null;
}

// Carga la instrucción que el titular pidió: arma el documento, lo guarda tal cual, deja los
// accesos rigiendo y devuelve la instrucción pendiente de firma.
//
// `accesosPedidos` viene del Panel con la forma `{ <usuarioId>: { <clave>: true/false } }`. Lo que
// llegue de una persona que no está en el círculo se ignora, y lo que falte de una que sí está se
// completa con el valor de fábrica: guardar sólo lo que vino dejaría filas ausentes, y una fila
// ausente para la base significa «no».
export async function crearInstruccion({ familiaId, prestadoraId, cargadaPor, accesosPedidos }) {
  const { data: familia } = await supabase
    .from('familias')
    .select('id, prestadora_id')
    .eq('id', familiaId)
    .maybeSingle();
  if (!familia || familia.prestadora_id !== prestadoraId) {
    throw new ErrorConMotivo('no_encontrado', 'Familia no encontrada');
  }

  const personas = await personasDelCirculo(familiaId);
  if (personas.length === 0) {
    throw new ErrorConMotivo('circulo_vacio', 'Esta Familia no tiene a nadie anotado en su círculo');
  }

  const visibilidad = await visibilidadDeLaPrestadora(prestadoraId);

  const { data: prestadora } = await supabase
    .from('prestadoras')
    .select('nombre_fantasia')
    .eq('id', prestadoraId)
    .maybeSingle();

  const decidido = personas.map((persona) => ({
    ...persona,
    filas: accesosParaGuardar({ pedido: accesosPedidos?.[persona.usuarioId], visibilidad }),
  }));

  const texto = textoDeLaInstruccion({
    prestadora: { nombre: prestadora?.nombre_fantasia },
    titular: { nombre: await nombreDe(familiaId) },
    cargadaPor: { nombre: await nombreDe(cargadaPor) },
    personas: decidido.map((persona) => ({
      nombre: persona.nombre,
      email: persona.email,
      accesos: Object.fromEntries(persona.filas.map((fila) => [fila.clave, fila.permitido])),
    })),
  });

  // La anterior se anula antes de insertar la nueva, o el índice único de la base rechaza la
  // inserción. No se borra: el historial de lo que el titular fue pidiendo es justamente lo que
  // esta tabla existe para guardar.
  const { error: errorAnular } = await supabase
    .from('instrucciones_acceso_circulo')
    .update({ estado: 'anulada' })
    .eq('familia_id', familiaId)
    .eq('estado', 'pendiente_firma');
  if (errorAnular) throw new Error(errorAnular.message);

  const { data: instruccion, error: errorInstruccion } = await supabase
    .from('instrucciones_acceso_circulo')
    .insert({
      prestadora_id: prestadoraId,
      familia_id: familiaId,
      dada_por: familiaId,
      cargada_por: cargadaPor,
      documento_texto: texto,
      documento_huella: huellaDelDocumento(texto),
      documento_idioma: IDIOMA_DEL_DOCUMENTO,
    })
    .select('id, estado, documento_texto, documento_huella, created_at')
    .single();
  if (errorInstruccion) throw new Error(errorInstruccion.message);

  const filas = decidido.flatMap((persona) => persona.filas.map((fila) => ({
    familia_id: familiaId,
    usuario_id: persona.usuarioId,
    clave: fila.clave,
    permitido: fila.permitido,
    instruccion_id: instruccion.id,
    updated_at: new Date().toISOString(),
  })));

  const { error: errorPermisos } = await supabase
    .from('permisos_circulo_familiar')
    .upsert(filas, { onConflict: 'familia_id,usuario_id,clave' });
  if (errorPermisos) throw new Error(errorPermisos.message);

  return instruccion;
}

// Lo que está esperando firma, si hay algo. Lo miran las dos puntas: el Panel para mostrar que
// quedó pendiente, y la aplicación del titular para ofrecerle firmarla.
export async function instruccionPendiente(familiaId) {
  const { data } = await supabase
    .from('instrucciones_acceso_circulo')
    .select('id, documento_texto, documento_idioma, created_at')
    .eq('familia_id', familiaId)
    .eq('estado', 'pendiente_firma')
    .maybeSingle();

  return data ?? null;
}

// La última que quedó firmada, para que la pantalla del Panel diga desde cuándo rige lo que rige y
// cómo se cerró. Las anuladas no cuentan: son las que quedaron a mitad de camino cuando llegó una
// instrucción nueva, y nadie las firmó nunca.
export async function ultimaInstruccionCerrada(familiaId) {
  const { data } = await supabase
    .from('instrucciones_acceso_circulo')
    .select('id, documento_texto, documento_idioma, created_at, cerrada_en, cerrada_como')
    .eq('familia_id', familiaId)
    .eq('estado', 'cerrada')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

// El código que el titular necesita para confirmar desde la aplicación. Va al teléfono cuando la
// Prestadora tiene WhatsApp configurado, y si no —o si el envío falla— al correo, que es el único
// canal que siempre existe. Nunca se pierde la confirmación por un problema de un canal; mismo
// criterio que los avisos al Coordinador.
export async function pedirCodigo({ instruccionId, familiaId }) {
  const { data: instruccion } = await supabase
    .from('instrucciones_acceso_circulo')
    .select('id, prestadora_id, estado')
    .eq('id', instruccionId)
    .eq('familia_id', familiaId)
    .maybeSingle();

  if (!instruccion) throw new ErrorConMotivo('no_encontrado', 'Instrucción no encontrada');
  if (instruccion.estado !== 'pendiente_firma') {
    throw new ErrorConMotivo('ya_cerrada', 'Esta instrucción ya no está pendiente de firma');
  }

  const codigo = codigoNuevo();
  const { error } = await supabase
    .from('instrucciones_acceso_circulo')
    .update({
      codigo_huella: huellaDelCodigo(codigo),
      codigo_expira_en: vencimientoEnMinutos(VIGENCIA_DEL_CODIGO_MINUTOS),
      codigo_intentos: 0,
    })
    .eq('id', instruccionId);
  if (error) throw new Error(error.message);

  const { data: prestadora } = await supabase
    .from('prestadoras')
    .select('nombre_fantasia')
    .eq('id', instruccion.prestadora_id)
    .maybeSingle();

  const { data: titular } = await supabase
    .from('usuarios')
    .select('telefono')
    .eq('id', familiaId)
    .maybeSingle();

  const remite = prestadora?.nombre_fantasia ?? '';
  const cuerpo = `Su código para confirmar la instrucción sobre los accesos de su círculo familiar es ${codigo}. Vence en ${VIGENCIA_DEL_CODIGO_MINUTOS} minutos. Si no lo pidió usted, no lo use y avise a ${remite}.`;

  if (titular?.telefono) {
    try {
      await enviarWhatsApp({ prestadoraId: instruccion.prestadora_id, telefono: titular.telefono, texto: cuerpo });
      return { enviadoA: 'telefono' };
    } catch (error) {
      // Se anota que falló el canal, nunca el número ni el código (CLAUDE.md §6).
      console.error('pedirCodigo: falló el envío por WhatsApp, cae a correo:', error.message);
    }
  }

  const { data: cuenta } = await supabase.auth.admin.getUserById(familiaId);
  if (!cuenta?.user?.email) {
    throw new ErrorConMotivo('sin_canal', 'No hay a dónde mandar el código');
  }

  await enviarEmail({
    to: cuenta.user.email,
    asunto: `Código para confirmar los accesos de su círculo familiar — ${remite}`,
    texto: cuerpo,
    prestadoraId: instruccion.prestadora_id,
  });

  return { enviadoA: 'correo' };
}

// Cierra la instrucción con el código. Devuelve el motivo del rechazo en vez de lanzarlo, porque
// la pantalla tiene que poder decir cosas distintas: no es lo mismo «el código no es» que «se
// venció» o «probó demasiadas veces, pida uno nuevo».
export async function confirmarConCodigo({ instruccionId, familiaId, codigo, desde }) {
  const { data: instruccion } = await supabase
    .from('instrucciones_acceso_circulo')
    .select('id, estado, codigo_huella, codigo_expira_en, codigo_intentos')
    .eq('id', instruccionId)
    .eq('familia_id', familiaId)
    .maybeSingle();

  if (!instruccion) return { ok: false, motivo: 'no_encontrado' };
  if (instruccion.estado !== 'pendiente_firma') return { ok: false, motivo: 'ya_cerrada' };
  if (!instruccion.codigo_huella) return { ok: false, motivo: 'sin_codigo' };
  if (instruccion.codigo_intentos >= INTENTOS_MAXIMOS) return { ok: false, motivo: 'demasiados_intentos' };
  if (estaVencido(instruccion.codigo_expira_en)) return { ok: false, motivo: 'vencido' };

  if (!codigoCoincide(codigo, instruccion.codigo_huella)) {
    await supabase
      .from('instrucciones_acceso_circulo')
      .update({ codigo_intentos: instruccion.codigo_intentos + 1 })
      .eq('id', instruccionId);
    return { ok: false, motivo: 'codigo_incorrecto' };
  }

  const { error } = await supabase
    .from('instrucciones_acceso_circulo')
    .update({
      estado: 'cerrada',
      cerrada_como: 'confirmada_en_la_app',
      cerrada_en: new Date().toISOString(),
      cerrada_desde: desde ?? null,
      // El código ya cumplió: se borra para que no quede una huella viva de algo de un solo uso.
      codigo_huella: null,
      codigo_expira_en: null,
    })
    .eq('id', instruccionId)
    .eq('estado', 'pendiente_firma');
  if (error) throw new Error(error.message);

  return { ok: true };
}

// El otro camino, el de siempre: el titular firma la hoja en papel, la Prestadora la guarda y
// carga el archivo. La ruta que sube el archivo se encarga del depósito; acá sólo se cierra.
export async function cerrarConPapelFirmado({ instruccionId, prestadoraId, archivoUrl }) {
  const { data: instruccion } = await supabase
    .from('instrucciones_acceso_circulo')
    .select('id, estado')
    .eq('id', instruccionId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (!instruccion) throw new ErrorConMotivo('no_encontrado', 'Instrucción no encontrada');
  if (instruccion.estado !== 'pendiente_firma') {
    throw new ErrorConMotivo('ya_cerrada', 'Esta instrucción ya no está pendiente de firma');
  }

  const { error } = await supabase
    .from('instrucciones_acceso_circulo')
    .update({
      estado: 'cerrada',
      cerrada_como: 'papel_firmado',
      cerrada_en: new Date().toISOString(),
      archivo_firmado_url: archivoUrl,
    })
    .eq('id', instruccionId)
    .eq('estado', 'pendiente_firma');
  if (error) throw new Error(error.message);
}

// Las once claves con lo decidido para cada persona del círculo, que es lo que dibuja la pantalla
// del Panel. Se devuelve siempre el catálogo entero, tenga o no fila guardada cada clave.
export async function circuloConSusAccesos({ familiaId, prestadoraId }) {
  const personas = await personasDelCirculo(familiaId);
  if (personas.length === 0) return [];

  const { data: filas } = await supabase
    .from('permisos_circulo_familiar')
    .select('usuario_id, clave, permitido')
    .eq('familia_id', familiaId);

  const visibilidad = await visibilidadDeLaPrestadora(prestadoraId);
  const porPersona = new Map(personas.map((persona) => [persona.usuarioId, []]));
  for (const fila of filas ?? []) {
    porPersona.get(fila.usuario_id)?.push(fila);
  }

  return personas.map((persona) => ({
    ...persona,
    accesos: mezclarAccesosConCatalogo({
      filasGuardadas: porPersona.get(persona.usuarioId),
      visibilidad,
    }),
  }));
}

import crypto from 'crypto';
import { supabase } from '../db/connection.js';
import { invitarActivacionCuenta } from './activacionCuenta.js';

const ETAPAS_INCORPORACION = [
  'postulacion',
  'verificacion_identidad',
  'antecedentes_penales',
  'entrevista',
  'capacitacion',
];

// Comprueba que un tipo de Asistente exista y sea de los que esta Prestadora puede usar:
// los generales de CeltaTech (`prestadora_id` vacío) o los que creó ella misma. Devuelve el
// mismo id si está bien, y `null` si no vino ninguno.
//
// Hace falta escribirlo: el motor entra a la base con la llave maestra, así que las reglas
// de aislamiento de la base no lo frenan. El filtro por Prestadora se escribe acá a mano o
// no existe (CLAUDE.md §5, regla de aislamiento).
export async function validarTipoAsistente(tipoAsistenteId, prestadoraId) {
  if (!tipoAsistenteId) return null;

  const { data, error } = await supabase
    .from('tipos_asistente')
    .select('id')
    .eq('id', tipoAsistenteId)
    .or(`prestadora_id.is.null,prestadora_id.eq.${prestadoraId}`)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('El tipo de Asistente indicado no existe o no es de esta Prestadora');
  return data.id;
}

// Deja un texto comparable: sin mayúsculas, sin tildes, sin nada que no sea letra.
function comparable(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

// Busca a qué tipo del catálogo corresponde un nombre escrito en una planilla.
//
// Es a propósito MÁS ESTRICTO que la sugerencia que hace el Panel: acá tiene que decir lo
// mismo —ignorando mayúsculas, tildes y puntuación— y nada más. "Enfermería" encuentra a
// "Enfermero/a" solo si así se llama el tipo; "Enf." no encuentra nada.
//
// Cuando no encuentra, devuelve `null` y el Asistente entra sin tipo. Eso es deliberado: el
// tipo decide si a esa persona se le va a exigir Matrícula para poder atender, y adivinarlo
// mal deja trabajando a alguien que no debería. El que entra sin tipo aparece después en la
// lista de Asistentes, marcado, para que una persona lo complete — se ve, no se esconde.
export async function resolverTipoAsistentePorNombre(texto, prestadoraId) {
  const buscado = comparable(texto);
  if (!buscado) return null;

  const { data, error } = await supabase
    .from('tipos_asistente')
    .select('id, clave, nombre, prestadora_id')
    .or(`prestadora_id.is.null,prestadora_id.eq.${prestadoraId}`)
    .eq('activo', true);

  if (error) throw new Error(error.message);

  const encontrados = (data || []).filter((tipo) =>
    comparable(tipo.nombre) === buscado || (!tipo.prestadora_id && comparable(tipo.clave) === buscado),
  );

  return encontrados.length === 1 ? encontrados[0].id : null;
}

// Mecanismo compartido: crea una cuenta real de Supabase Auth + su fila en `usuarios`.
// Para Coordinador/Admin/Superadmin (panelUsuarios.js) el Panel SÍ existe hoy y quien la crea
// está también en el Panel, así que `passwordTemporal` se devuelve al caller para que la
// comunique manualmente — ese flujo no cambia (fuera del alcance del pendiente #75). Para
// Familia/Asistente/Círculo (panelCuentas.js), la persona nunca ve `passwordTemporal`: con
// `enviarActivacion: true` se dispara automáticamente el email de "primera contraseña"
// (activacionCuenta.js) con un link de token propio, en vez de depender de un canal manual.
export async function crearCuentaConPerfil({ email, nombre, telefono, rol, zonas, prestadoraId, enviarActivacion = false }) {
  const passwordTemporal = crypto.randomBytes(24).toString('base64url');

  const { data: authData, error: errorAuth } = await supabase.auth.admin.createUser({
    email,
    password: passwordTemporal,
    email_confirm: true,
  });

  if (errorAuth) {
    throw new Error(errorAuth.message);
  }

  const userId = authData.user.id;

  const { error: errorPerfil } = await supabase
    .from('usuarios')
    .insert({ id: userId, rol, nombre, telefono, zonas, prestadora_id: prestadoraId });

  if (errorPerfil) {
    await supabase.auth.admin.deleteUser(userId);
    throw new Error(errorPerfil.message);
  }

  if (enviarActivacion) {
    try {
      await invitarActivacionCuenta({ usuarioId: userId, email, nombre, rol, prestadoraId });
    } catch (errorActivacion) {
      // La cuenta ya quedó creada correctamente — un fallo al mandar el email (ej. SMTP
      // caído en ese momento) no debe deshacer el alta, se recupera con "Reenviar invitación".
      console.error('Error al enviar el email de activación:', errorActivacion.message);
    }
  }

  return { userId, passwordTemporal };
}

// `prestadoraId`/`esSuperadmin` son la misma verificación de tenant que ya hacen los
// callers antes de invocar esta función (panelUsuarios.js valida con un SELECT previo;
// panelCuentas.js borra un id recién creado en el mismo request) — se repite acá adentro
// para que la función no dependa por completo de la disciplina de cada llamador presente
// y futuro (mismo tipo de hueco que tenía panelUsuarios.js antes de este bloque).
export async function borrarCuenta(userId, { prestadoraId, esSuperadmin = false } = {}) {
  if (!esSuperadmin) {
    const { data: objetivo, error: errorObjetivo } = await supabase
      .from('usuarios')
      .select('prestadora_id')
      .eq('id', userId)
      .single();
    if (errorObjetivo || !objetivo || objetivo.prestadora_id !== prestadoraId) {
      throw new Error('No tenés permiso para dar de baja esa cuenta');
    }
  }

  const { error: errorPerfil } = await supabase.from('usuarios').delete().eq('id', userId);
  if (errorPerfil) throw new Error(errorPerfil.message);

  const { error: errorAuth } = await supabase.auth.admin.deleteUser(userId);
  if (errorAuth) throw new Error(errorAuth.message);
}

// Lógica de alta manual de un Asistente, extraída de panelCuentas.js (ruta /asistente-directo)
// en la Fase 3 (importación masiva) del plan "Terminar la Etapa 2 (Panel)" para que la
// importación fila-por-fila reutilice exactamente el mismo camino de creación que el alta
// manual de la Fase 1, en vez de duplicar la lógica (ver alcance de la Fase 3 en el plan
// aprobado: "no se construye un camino de creación de datos paralelo y distinto").
export async function crearAsistenteDirecto({
  nombre, telefono, email, dni, tipo_asistente_id, tipo_asistente, zonas, estado,
  tipo_vinculo, categoria_cct, valor_hora, sueldo_basico, horas_semanales,
  prestadoraId, usuarioPanelId, importacionId,
}) {
  if (!nombre || !email) {
    throw new Error('Faltan datos obligatorios (nombre, email)');
  }

  const zonasArray = Array.isArray(zonas) ? zonas : [];

  // Dos maneras de decir el tipo, según de dónde venga: el Panel manda el identificador
  // porque lo eligió de una lista; una planilla importada manda el nombre escrito, que hay
  // que buscar en el catálogo. Si viene el identificador, manda ese.
  const tipoAsistenteId = tipo_asistente_id
    ? await validarTipoAsistente(tipo_asistente_id, prestadoraId)
    : await resolverTipoAsistentePorNombre(tipo_asistente, prestadoraId);

  let asistenteId;
  try {
    ({ userId: asistenteId } = await crearCuentaConPerfil({
      email, nombre, telefono, rol: 'asistente', zonas: zonasArray, prestadoraId, enviarActivacion: true,
    }));

    const { error: errorAsistente } = await supabase.from('asistentes').insert({
      id: asistenteId,
      nombre,
      dni: dni || null,
      telefono: telefono || null,
      email,
      tipo_asistente_id: tipoAsistenteId,
      zonas: zonasArray,
      estado: estado || 'activo',
      tipo_vinculo: tipo_vinculo || 'monotributo',
      categoria_cct: categoria_cct || null,
      valor_hora: valor_hora || null,
      sueldo_basico: sueldo_basico || null,
      horas_semanales: horas_semanales || null,
      prestadora_id: prestadoraId,
      importacion_id: importacionId || null,
      pendiente_conformidad: Boolean(importacionId),
    });
    if (errorAsistente) throw new Error(errorAsistente.message);

    // Filas importadas quedan ocultas por RLS (pendiente_conformidad=true) hasta que la
    // Prestadora las conforme — no tiene sentido correr acá la política de verificación de
    // alta manual sobre una fila que todavía no es operable; ese paso corre recién al
    // conformar el lote (panelImportacion.js /conformar, vía activarVerificacionAltaAsistente).
    if (importacionId) {
      return { asistenteId };
    }

    await activarVerificacionAltaAsistente(asistenteId, prestadoraId, usuarioPanelId);

    return { asistenteId };
  } catch (error) {
    if (asistenteId) {
      await supabase.from('asistentes').delete().eq('id', asistenteId);
      await borrarCuenta(asistenteId, { prestadoraId });
    }
    throw error;
  }
}

// Extraída de crearAsistenteDirecto para que el alta manual (arriba) y la conformidad
// post-importación (panelImportacion.js /conformar) apliquen exactamente la misma política
// de verificación en vez de duplicarla (Regla 12, CLAUDE.md §7).
export async function activarVerificacionAltaAsistente(asistenteId, prestadoraId, usuarioPanelId) {
  const { data: prestadora, error: errorPrestadora } = await supabase
    .from('prestadoras')
    .select('politica_verificacion_alta_manual')
    .eq('id', prestadoraId)
    .single();
  if (errorPrestadora) throw new Error(errorPrestadora.message);

  const politica = prestadora.politica_verificacion_alta_manual;
  if (politica === 'pendiente' || politica === 'aprobado') {
    const filasVerificacion = ETAPAS_INCORPORACION.map((etapa) => ({
      asistente_id: asistenteId,
      etapa,
      estado: politica === 'aprobado' ? 'aprobada' : 'pendiente',
      revisado_por: politica === 'aprobado' ? usuarioPanelId : null,
      completado_en: politica === 'aprobado' ? new Date().toISOString() : null,
    }));
    const { error: errorVerificaciones } = await supabase.from('verificaciones_asistente').insert(filasVerificacion);
    if (errorVerificaciones) throw new Error(errorVerificaciones.message);
  }
}

// Revierte un lote importado y rechazado por la Prestadora (panelImportacion.js /rechazar):
// mismo desarmado que el catch de crearAsistenteDirecto/crearFamiliaDirecta, aplicado a
// todas las filas que compartan `importacionId` en vez de a una sola fila recién creada.
export async function revertirAsistenteImportado(asistenteId, prestadoraId) {
  await supabase.from('verificaciones_asistente').delete().eq('asistente_id', asistenteId);
  await supabase.from('asistentes').delete().eq('id', asistenteId);
  await borrarCuenta(asistenteId, { prestadoraId });
}

export async function revertirFamiliaImportada(familiaId, prestadoraId) {
  await supabase.from('pacientes').delete().eq('familia_id', familiaId);
  await supabase.from('familias').delete().eq('id', familiaId);
  await borrarCuenta(familiaId, { prestadoraId });
}

// Invita a una persona al círculo de cuidado de una Familia ya existente (Fase 5): crea su
// cuenta con `crearCuentaConPerfil` igual que cualquier otro rol de login propio, y en vez
// de una fila en `familias` (eso es solo para el titular) crea la fila en `miembros_familia`
// que la vincula. Rol fijo `solo_lectura` — es el único que existe hoy (ver
// schema_circulo_cuidado.sql).
export async function invitarMiembroCirculo({ email, nombre, telefono, familiaId, prestadoraId, invitadoPor }) {
  if (!nombre || !email || !familiaId) {
    throw new Error('Faltan datos obligatorios (nombre, email, familiaId)');
  }

  let miembroId;
  try {
    ({ userId: miembroId } = await crearCuentaConPerfil({
      email, nombre, telefono, rol: 'familia', prestadoraId, enviarActivacion: true,
    }));

    const { error: errorMiembro } = await supabase
      .from('miembros_familia')
      .insert({ usuario_id: miembroId, familia_id: familiaId, email, rol: 'solo_lectura', creado_por: invitadoPor });
    if (errorMiembro) throw new Error(errorMiembro.message);

    return { miembroId };
  } catch (error) {
    if (miembroId) {
      await supabase.from('miembros_familia').delete().eq('usuario_id', miembroId);
      await borrarCuenta(miembroId, { prestadoraId });
    }
    throw error;
  }
}

// Revoca el acceso de un miembro invitado del círculo de cuidado — borra su fila en
// `miembros_familia` (RLS/`ON DELETE CASCADE` no alcanza porque el borrado real es la
// cuenta completa, no la fila) y su cuenta, reutilizando `borrarCuenta` para no duplicar la
// validación de tenant que ya hace esa función.
export async function revocarMiembroCirculo(usuarioId, { prestadoraId, familiaId }) {
  const { data: miembro, error: errorMiembro } = await supabase
    .from('miembros_familia')
    .select('familia_id')
    .eq('usuario_id', usuarioId)
    .single();
  if (errorMiembro || !miembro || miembro.familia_id !== familiaId) {
    throw new Error('Esta persona no pertenece al círculo de cuidado de esta Familia');
  }

  await supabase.from('miembros_familia').delete().eq('usuario_id', usuarioId);
  await borrarCuenta(usuarioId, { prestadoraId });
}

// Lógica de alta manual de Familia+Paciente, extraída de panelCuentas.js (ruta
// /familia-directa) por el mismo motivo que crearAsistenteDirecto de arriba.
export async function crearFamiliaDirecta({
  nombreContacto, telefono, email, localidad, plan,
  nombrePaciente, domicilioPaciente, fechaNacimientoPaciente, nivelComplejidadPaciente, patologiasPaciente,
  prestadoraId, importacionId,
}) {
  if (!nombreContacto || !email || !nombrePaciente) {
    throw new Error('Faltan datos obligatorios (nombreContacto, email, nombrePaciente)');
  }

  let familiaId;
  let solicitudId;
  try {
    const { data: solicitud, error: errorSolicitud } = await supabase
      .from('solicitudes')
      .insert({
        prestadora_id: prestadoraId,
        nombre: nombreContacto,
        telefono: telefono || '',
        email,
        nombre_paciente: nombrePaciente,
        localidad: localidad || '',
        canal: 'alta_manual',
        estado: 'asignada',
        tipo_servicio: 'Cuidado domiciliario',
        modalidad: 'presencial',
        dias_horario: 'A definir',
      })
      .select()
      .single();
    if (errorSolicitud) throw new Error(errorSolicitud.message);
    solicitudId = solicitud.id;

    ({ userId: familiaId } = await crearCuentaConPerfil({
      email, nombre: nombreContacto, telefono, rol: 'familia', prestadoraId, enviarActivacion: true,
    }));

    const { error: errorFamilia } = await supabase
      .from('familias')
      .insert({
        id: familiaId,
        solicitud_id: solicitudId,
        prestadora_id: prestadoraId,
        plan: plan || null,
        importacion_id: importacionId || null,
        pendiente_conformidad: Boolean(importacionId),
      });
    if (errorFamilia) throw new Error(errorFamilia.message);

    const { data: paciente, error: errorPaciente } = await supabase
      .from('pacientes')
      .insert({
        familia_id: familiaId,
        nombre: nombrePaciente,
        domicilio: domicilioPaciente || localidad || null,
        fecha_nacimiento: fechaNacimientoPaciente || null,
        nivel_complejidad: nivelComplejidadPaciente || null,
        patologias: patologiasPaciente || [],
        prestadora_id: prestadoraId,
        importacion_id: importacionId || null,
        pendiente_conformidad: Boolean(importacionId),
      })
      .select()
      .single();
    if (errorPaciente) throw new Error(errorPaciente.message);

    const { error: errorUpdate } = await supabase
      .from('solicitudes')
      .update({ familia_id: familiaId })
      .eq('id', solicitudId);
    if (errorUpdate) throw new Error(errorUpdate.message);

    return { familiaId, pacienteId: paciente.id };
  } catch (error) {
    if (familiaId) {
      await supabase.from('pacientes').delete().eq('familia_id', familiaId);
      await supabase.from('familias').delete().eq('id', familiaId);
      await borrarCuenta(familiaId, { prestadoraId });
    }
    if (solicitudId) {
      await supabase.from('solicitudes').delete().eq('id', solicitudId);
    }
    throw error;
  }
}

import crypto from 'crypto';
import { supabase } from '../db/connection.js';
import { invitarActivacionCuenta } from './activacionCuenta.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import { coordenadasDeDomicilio } from '../geocodificacion/index.js';

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

// ¿El servicio de acceso está diciendo que ese correo ya está tomado? El texto viene en
// inglés y sin código propio, así que hay que reconocerlo por lo que dice. Se mira acá, en
// un solo lugar, para no repartir la frase en inglés por todo el motor.
function correoYaTomado(errorAuth) {
  return /already (been )?registered|already exists|email.*taken/i.test(errorAuth?.message || '');
}

// Busca la cuenta de acceso de un correo, sin recorrer la lista entera.
//
// El filtro del servicio de acceso busca por parecido, no por igualdad: preguntando por
// "beto@ejemplo.com" también devuelve "beto@ejemplo.com.ar". Por eso la igualdad se
// comprueba acá. Recorrer todas las cuentas no es alternativa: con cientos de Prestadoras
// son decenas de miles de filas (CLAUDE.md §2).
async function buscarCuentaDeAcceso(email) {
  const url = `${process.env.SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`;
  const respuesta = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!respuesta.ok) return null;

  const cuerpo = await respuesta.json().catch(() => null);
  const buscado = String(email).trim().toLowerCase();
  return (cuerpo?.users || []).find((u) => String(u.email || '').toLowerCase() === buscado) || null;
}

// Lo que evita que un alta cortada por la mitad deje trabada la segunda vuelta.
//
// Un alta hace dos cosas en orden: primero crea la cuenta de acceso, después la persona
// (Asistente, Familia, miembro del círculo). Si el segundo paso falla, el primero se
// deshace — pero ese deshacer puede no llegar a correr nunca: si el servidor se cae en el
// medio, si se corta la red, si el deshacer mismo falla. Y entonces queda una cuenta de
// acceso sola, sin nadie detrás.
//
// Esa cuenta sola es basura reconocible: existe en el acceso pero no tiene fila en
// `usuarios`, y sin esa fila ninguna pantalla del producto la reconoce — no se puede entrar
// a ningún lado con ella. Tampoco puede tener un link de activación vivo: el link se emite
// después de la fila de `usuarios` y se borra junto con ella. O sea que borrarla no le quita
// nada a nadie.
//
// Entonces: si es basura, se borra y el alta sigue. Si detrás hay una persona de verdad, no
// se toca nada y se explica qué pasa, con un motivo que la pantalla sabe traducir.
async function limpiarCuentaSobrante(email, prestadoraId) {
  const cuenta = await buscarCuentaDeAcceso(email);
  if (!cuenta) return; // no se pudo mirar; el alta va a fallar igual, con el error de siempre

  const { data: perfil } = await supabase
    .from('usuarios')
    .select('prestadora_id')
    .eq('id', cuenta.id)
    .maybeSingle();

  if (!perfil) {
    await supabase.auth.admin.deleteUser(cuenta.id);
    // Queda constancia porque significa que un alta anterior se cortó por la mitad. Nunca el
    // correo: es un dato personal y esto va al registro del servidor (CLAUDE.md §6).
    console.warn('cuentasPanel: se borró una cuenta de acceso sobrante de un alta anterior', cuenta.id);
    return;
  }

  // Hay alguien detrás. Qué se cuenta depende de si esa persona es de esta Prestadora: de
  // otra no se dice nada, ni siquiera que existe (CLAUDE.md §2 y §6, aislamiento entre
  // Prestadoras). Las dos frases viven en las traducciones, en los tres idiomas.
  throw new ErrorConMotivo(
    perfil.prestadora_id === prestadoraId ? 'correo_de_esta_prestadora' : 'correo_de_otra_cuenta',
    `El correo ya tiene una cuenta de acceso (${cuenta.id})`,
  );
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

  let { data: authData, error: errorAuth } = await supabase.auth.admin.createUser({
    email,
    password: passwordTemporal,
    email_confirm: true,
  });

  // El correo ya estaba tomado. Antes de rendirse hay que mirar qué hay detrás: puede ser
  // basura de un alta anterior que se cortó, y en ese caso el alta tiene que seguir.
  if (errorAuth && correoYaTomado(errorAuth)) {
    await limpiarCuentaSobrante(email, prestadoraId);
    ({ data: authData, error: errorAuth } = await supabase.auth.admin.createUser({
      email,
      password: passwordTemporal,
      email_confirm: true,
    }));
  }

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
      throw new Error('No hay permiso para dar de baja esa cuenta');
    }
  }

  const { error: errorPerfil } = await supabase.from('usuarios').delete().eq('id', userId);
  if (errorPerfil) throw new Error(errorPerfil.message);

  const { error: errorAuth } = await supabase.auth.admin.deleteUser(userId);
  if (errorAuth) throw new Error(errorAuth.message);
}

// Deshace un alta que se cortó por la mitad. **Nunca falla**: pase lo que pase, termina.
//
// Por qué importa que no falle. Un alta que se corta tiene siempre dos partes: el problema
// real (falta una configuración, la base no contestó) y la limpieza de lo que alcanzó a
// crearse. Cuando la limpieza se escribe suelta, un tropiezo suyo pisa el problema real: la
// persona ve el error de la limpieza, o directamente no ve nada porque la respuesta al Panel
// nunca llega a mandarse y la pantalla se queda esperando para siempre. Acá la limpieza se
// traga sus propios tropiezos, los deja anotados en el registro del servidor, y devuelve si
// pudo o no — para que el problema de verdad sea el que llegue a la pantalla.
//
// `filas` son las tablas a limpiar, en orden de hija a madre. `columna` es por dónde se
// busca (por omisión `id`), `valor` con qué se compara (por omisión el id de la cuenta).
export async function deshacerAlta(userId, { prestadoraId, filas = [] } = {}) {
  let limpioTodo = true;

  // La red propia de esta función, por la misma razón que la de `borrarCuenta`: el borrado de
  // abajo recibe el nombre de la tabla y la columna desde afuera y no puede defenderse solo, así
  // que la pertenencia se comprueba una vez acá, antes de tocar nada. Se comprueba sobre la
  // cuenta y no tabla por tabla porque dos de las tablas de la lista no tienen columna de
  // Prestadora (`verificaciones_asistente`, `miembros_familia`) y cuelgan de esta misma
  // cuenta — filtrar solo las que sí la tienen dejaría a las otras sin red y, encima, se
  // borran primero. Si la cuenta no es de esta Prestadora, no se limpia nada.
  if (userId && prestadoraId) {
    const { data: duena, error: errorDuena } = await supabase
      .from('usuarios')
      .select('prestadora_id')
      .eq('id', userId)
      .maybeSingle();
    if (errorDuena || !duena) {
      // Sin fila de la que colgar no hay nada que limpiar y tampoco forma de comprobar de quién
      // es. Puede quedar una cuenta de acceso sin nadie detrás; el próximo intento con ese mismo
      // correo la va a reconocer como sobrante y la va a borrar sola (`limpiarCuentaSobrante`).
      // Se anota el id, nunca el correo (CLAUDE.md §6).
      console.error('deshacerAlta: no existe la cuenta a limpiar', userId);
      return false;
    }
    if (duena.prestadora_id !== prestadoraId) {
      console.error('deshacerAlta: la cuenta no es de esta Prestadora, no se limpió nada', userId);
      return false;
    }
  }

  for (const fila of filas) {
    const valor = fila.valor ?? userId;
    if (!valor) continue;
    try {
      const { error } = await supabase.from(fila.tabla).delete().eq(fila.columna || 'id', valor);
      if (error) throw new Error(error.message);
    } catch (error) {
      limpioTodo = false;
      console.error(`deshacerAlta: quedó sin limpiar ${fila.tabla}`, error.message);
    }
  }

  if (userId) {
    try {
      await borrarCuenta(userId, { prestadoraId });
    } catch (error) {
      limpioTodo = false;
      // Se anota el id, nunca el correo (CLAUDE.md §6). Si esto aparece en el registro, quedó
      // una cuenta de acceso sin nadie detrás — y el próximo intento con ese mismo correo la
      // va a reconocer como sobrante y la va a borrar sola (ver `limpiarCuentaSobrante`).
      console.error('deshacerAlta: quedó una cuenta de acceso sin borrar', userId, error.message);
    }
  }

  return limpioTodo;
}

// Qué deja atrás cada tipo de alta, de la fila hija a la madre. Escrito una sola vez porque
// lo usan tanto el deshacer de un alta cortada como la reversión de un lote importado que la
// Prestadora rechazó — es la misma lista, y tenerla dos veces es cómo se olvida una tabla en
// una de las dos (regla 12 de CLAUDE.md §7).
export const FILAS_DE_UN_ASISTENTE = [
  { tabla: 'verificaciones_asistente', columna: 'asistente_id' },
  { tabla: 'asistentes' },
];

export const FILAS_DE_UNA_FAMILIA = [
  { tabla: 'pacientes', columna: 'familia_id' },
  { tabla: 'familias' },
];

const FILAS_DE_UN_MIEMBRO_CIRCULO = [
  { tabla: 'miembros_familia', columna: 'usuario_id' },
];

// Lógica de alta manual de un Asistente, extraída de panelCuentas.js (ruta /asistente-directo)
// en la Fase 3 (importación masiva) del plan "Terminar la Etapa 2 (Panel)" para que la
// importación fila-por-fila reutilice exactamente el mismo camino de creación que el alta
// manual de la Fase 1, en vez de duplicar la lógica (ver alcance de la Fase 3 en el plan
// aprobado: "no se construye un camino de creación de datos paralelo y distinto").
export async function crearAsistenteDirecto({
  nombre, telefono, email, dni, domicilio, tipo_asistente_id, tipo_asistente, zonas, estado,
  tipo_vinculo, categoria_cct, valor_hora, sueldo_basico, horas_semanales, modalidades,
  prestadoraId, usuarioPanelId, importacionId,
}) {
  if (!nombre || !email) {
    throw new ErrorConMotivo('faltan_datos', 'Faltan datos obligatorios (nombre, email)');
  }

  const zonasArray = Array.isArray(zonas) ? zonas : [];

  // En qué modalidad de trabajo va a estar esta persona. Si el alta no lo dice —una planilla
  // importada, por ejemplo—, no se manda nada y la base lo completa con las modalidades que la
  // Prestadora tenga activas. Elegirlo acá por las dudas sería adivinar en el único lugar donde
  // no hace falta, y además duplicaría esa cuenta (Regla 12).
  const modalidadesElegidas =
    Array.isArray(modalidades) && modalidades.length > 0 ? modalidades : null;

  // Dos maneras de decir el tipo, según de dónde venga: el Panel manda el identificador
  // porque lo eligió de una lista; una planilla importada manda el nombre escrito, que hay
  // que buscar en el catálogo. Si viene el identificador, manda ese.
  const tipoAsistenteId = tipo_asistente_id
    ? await validarTipoAsistente(tipo_asistente_id, prestadoraId)
    : await resolverTipoAsistentePorNombre(tipo_asistente, prestadoraId);

  // Dónde vive, escrito para que lo lea una persona, y ese mismo lugar en coordenadas para
  // poder medir distancias — la cercanía al elegir a quién llamar, y de dónde salió el viaje.
  // Las coordenadas las saca de la dirección el servicio del país de la Prestadora
  // (`geocodificacion/`); si no hay servicio para ese país, si se cae o si no la encuentra,
  // quedan en nulo y el alta sigue igual: el texto es el dato. Dato sensible: no sale en
  // registros ni en URLs (CLAUDE.md §6).
  const ubicacion = await coordenadasDeDomicilio({ prestadoraId, direccion: domicilio });

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
      domicilio: domicilio || null,
      ...ubicacion,
      tipo_asistente_id: tipoAsistenteId,
      zonas: zonasArray,
      estado: estado || 'activo',
      tipo_vinculo: tipo_vinculo || 'monotributo',
      horas_semanales: horas_semanales || null,
      // La columna se llama `canales` de antes y no se renombra (regla 13 de CLAUDE.md §7).
      ...(modalidadesElegidas && { canales: modalidadesElegidas }),
      prestadora_id: prestadoraId,
      importacion_id: importacionId || null,
      pendiente_conformidad: Boolean(importacionId),
    });
    if (errorAsistente) throw new Error(errorAsistente.message);

    // Lo que cobra el Asistente va a su propia tabla, no a la ficha: ahí la base exige el
    // permiso `ver_pagos_asistente` antes de mostrarlo. Si el alta no trae ningún importe no
    // se crea la fila — una fila vacía no dice nada distinto de que no haya fila.
    if (categoria_cct || valor_hora || sueldo_basico) {
      const { error: errorRemuneracion } = await supabase.from('remuneraciones_asistente').insert({
        asistente_id: asistenteId,
        prestadora_id: prestadoraId,
        categoria_cct: categoria_cct || null,
        valor_hora: valor_hora || null,
        sueldo_basico: sueldo_basico || null,
      });
      if (errorRemuneracion) throw new Error(errorRemuneracion.message);
    }

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
    await deshacerAlta(asistenteId, { prestadoraId, filas: FILAS_DE_UN_ASISTENTE });
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
// Devuelven `false` si algo quedó sin limpiar, para que la pantalla pueda contar bien
// cuántas filas se revirtieron de verdad.
export function revertirAsistenteImportado(asistenteId, prestadoraId) {
  return deshacerAlta(asistenteId, { prestadoraId, filas: FILAS_DE_UN_ASISTENTE });
}

export function revertirFamiliaImportada(familiaId, prestadoraId) {
  return deshacerAlta(familiaId, { prestadoraId, filas: FILAS_DE_UNA_FAMILIA });
}

// Invita a una persona al círculo de cuidado de una Familia ya existente (Fase 5): crea su
// cuenta con `crearCuentaConPerfil` igual que cualquier otro rol de login propio, y en vez
// de una fila en `familias` (eso es solo para el titular) crea la fila en `miembros_familia`
// que la vincula. Rol fijo `solo_lectura` — es el único que existe hoy (ver
// schema_circulo_cuidado.sql).
export async function invitarMiembroCirculo({ email, nombre, telefono, familiaId, prestadoraId, invitadoPor }) {
  if (!nombre || !email || !familiaId) {
    throw new ErrorConMotivo('faltan_datos', 'Faltan datos obligatorios (nombre, email, familiaId)');
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
    await deshacerAlta(miembroId, { prestadoraId, filas: FILAS_DE_UN_MIEMBRO_CIRCULO });
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
    throw new ErrorConMotivo('faltan_datos', 'Faltan datos obligatorios (nombreContacto, email, nombrePaciente)');
  }

  // Lo que va a quedar escrito en `pacientes.domicilio`, y su punto en el mapa si se lo puede
  // ubicar. La localidad viaja aparte porque desempata: la misma calle con el mismo número
  // existe en decenas de partidos. Si no se puede ubicar, el Paciente se da de alta igual con
  // las coordenadas en nulo (ver `geocodificacion/index.js`).
  const domicilioDelPaciente = domicilioPaciente || localidad || null;
  const ubicacion = await coordenadasDeDomicilio({
    prestadoraId,
    direccion: domicilioDelPaciente,
    localidad,
  });

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
        domicilio: domicilioDelPaciente,
        ...ubicacion,
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
    await deshacerAlta(familiaId, {
      prestadoraId,
      // La solicitud se creó antes que la cuenta y no cuelga de ella, así que se limpia por
      // su propio identificador. Va última porque las familias la apuntan.
      filas: [...FILAS_DE_UNA_FAMILIA, { tabla: 'solicitudes', valor: solicitudId }],
    });
    throw error;
  }
}

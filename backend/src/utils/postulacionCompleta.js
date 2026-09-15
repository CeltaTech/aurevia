// Lo que se comprueba de una postulación antes de guardarla, escrito una sola vez y sin tocar
// la base ni la red, para que se pueda probar con datos inventados.
//
// POR QUÉ ACÁ Y NO EN LA PANTALLA. El formulario de postulación es público: lo abre cualquiera,
// desde el sitio de la Prestadora o desde cualquier otro programa. Lo que valida el navegador es
// una comodidad para quien escribe; lo que decide si el dato entra se comprueba del lado del
// servidor.
//
// LAS OPCIONES NO ESTÁN ESCRITAS ACÁ. Género, nacionalidad, tipo de registro ante AFIP y la
// experiencia clínica salen de `opciones_postulacion`, una fila por opción y por Prestadora. Esta
// función recibe las que estén activas y comprueba que lo elegido sea una de ellas; no sabe
// cuáles son ni cuántas.
//
// LA EDAD MÍNIMA ES UN VALOR LEGAL. Viene de `escalas_legales`
// (`tipo = 'edad_minima_para_trabajar'`), a la escala vigente el día de la postulación. **Si no
// hay escala vigente para esa jurisdicción, no se rechaza a nadie por edad**: inventar dieciocho
// sería escribir un valor legal en el código, que es justamente lo que la tabla viene a evitar.
// La postulación entra con su fecha de nacimiento y quien la revisa decide.
//
// LOS MOTIVOS DE RECHAZO SON CLAVES, NO FRASES. Salen hacia afuera y se traducen del otro lado;
// ninguno describe una tabla, una columna ni una restricción de la base.

import { esFechaISO } from './fechas.js';

const TOPE_REFERENCIAS = 5;
const TOPE_RENGLONES_DE_LISTA = 20;
const LARGO_DE_TEXTO_LIBRE = 500;

// Cuántos años cumplidos tiene alguien nacido ese día, contados al día del hecho.
//
// Se cuenta sobre el texto `AAAA-MM-DD` y no con `new Date()`: una fecha de nacimiento es un día
// del calendario, y `new Date('2008-09-15').getFullYear()` contesta según el huso horario de la
// máquina donde corra el motor, así que en un servidor al oeste el mismo cumpleaños cae un día
// antes y alguien queda menor de edad por estar encendido en otro país.
export function aniosCumplidos(fechaNacimiento, fechaDelHecho) {
  const [anioN, mesN, diaN] = fechaNacimiento.split('-').map(Number);
  const [anioH, mesH, diaH] = fechaDelHecho.split('-').map(Number);
  let anios = anioH - anioN;
  if (mesH < mesN || (mesH === mesN && diaH < diaN)) anios -= 1;
  return anios;
}

// El dígito verificador del CUIL, que es una cuenta cerrada y siempre la misma: se comprueba,
// no se inventa. Sirve para que un número tipeado de más o de menos no entre como válido.
function digitoVerificadorCorrecto(once) {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acumulado, peso, i) => acumulado + peso * Number(once[i]), 0);
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return esperado === Number(once[10]);
}

/** Deja el CUIL en sus once dígitos, venga escrito con guiones o sin ellos. */
export function normalizarCuil(cuil) {
  return String(cuil).replace(/\D/g, '');
}

export function cuilValido(cuil, dni) {
  const once = normalizarCuil(cuil);
  if (once.length !== 11) return false;
  if (!digitoVerificadorCorrecto(once)) return false;
  // Los ocho dígitos del medio son el documento de la persona: si no coinciden, uno de los dos
  // está mal escrito y no hay forma de saber cuál.
  return once.slice(2, 10) === String(dni).padStart(8, '0');
}

function esTextoUsable(valor) {
  return typeof valor === 'string' && valor.trim().length > 0 && valor.length <= LARGO_DE_TEXTO_LIBRE;
}

// Una lista del formulario —estudios, experiencia, referencias— llega como lista de renglones, y
// cada renglón tiene que traer sus campos escritos. Un renglón vacío no es un dato incompleto:
// es basura que después nadie sabe si borrar.
function listaBienFormada(valor, camposObligatorios, tope) {
  if (!Array.isArray(valor)) return false;
  if (valor.length > tope) return false;
  return valor.every((renglon) => (
    renglon !== null
    && typeof renglon === 'object'
    && !Array.isArray(renglon)
    && camposObligatorios.every((campo) => esTextoUsable(renglon[campo]))
  ));
}

function clavesActivas(opciones, grupo) {
  return new Set(opciones.filter((o) => o.grupo === grupo && o.activo !== false).map((o) => o.clave));
}

/**
 * ¿Se puede guardar esta postulación?
 *
 * Devuelve `{ error }` con la clave del primer motivo que la frena, o `{ error: null }` y los
 * `datos` ya listos para guardar. Nunca devuelve las dos cosas.
 *
 * @param cuerpo          lo que llegó en el pedido
 * @param opciones        filas de `opciones_postulacion` de esa Prestadora
 * @param edadMinima      años que exige la jurisdicción, o `null` si no hay escala vigente
 * @param hoy             el día del hecho, `AAAA-MM-DD`
 */
export function revisarPostulacion(cuerpo, { opciones = [], edadMinima = null, hoy }) {
  const falla = (error) => ({ error, datos: null });

  if (!esTextoUsable(cuerpo.nombre) || !esTextoUsable(cuerpo.telefono) || !esTextoUsable(cuerpo.email)
    || !esTextoUsable(cuerpo.especialidades) || !esTextoUsable(cuerpo.zonas)
    || !esTextoUsable(cuerpo.disponibilidad) || !esTextoUsable(cuerpo.situacion_fiscal)
    || !cuerpo.dni || !cuerpo.fecha_nacimiento) {
    return falla('campos_obligatorios_faltantes');
  }

  if (!/^\d{7,8}$/.test(String(cuerpo.dni))) return falla('dni_invalido');

  // `esFechaISO` comprueba además que el día exista: `1990-02-31` tiene la forma correcta y no es
  // ninguna fecha.
  if (!esFechaISO(cuerpo.fecha_nacimiento)) return falla('fecha_nacimiento_invalida');
  const edad = aniosCumplidos(cuerpo.fecha_nacimiento, hoy);
  if (edad < 0) return falla('fecha_nacimiento_invalida');
  if (edadMinima !== null && edad < edadMinima) return falla('menor_de_edad');

  if (cuerpo.cuil != null && cuerpo.cuil !== '' && !cuilValido(cuerpo.cuil, cuerpo.dni)) {
    return falla('cuil_invalido');
  }

  for (const [campo, grupo] of [['genero', 'genero'], ['nacionalidad', 'nacionalidad'], ['tipo_registro_afip', 'tipo_registro_afip']]) {
    const elegido = cuerpo[campo];
    if (elegido == null || elegido === '') continue;
    if (!clavesActivas(opciones, grupo).has(elegido)) return falla(`${campo}_no_es_una_opcion`);
  }

  const experienciaClinica = cuerpo.experiencia_clinica ?? [];
  if (!Array.isArray(experienciaClinica)) return falla('experiencia_clinica_mal_formada');
  const clinicasValidas = new Set(
    opciones.filter((o) => o.grupo.startsWith('experiencia_clinica_') && o.activo !== false).map((o) => o.clave),
  );
  if (!experienciaClinica.every((clave) => clinicasValidas.has(clave))) {
    return falla('experiencia_clinica_no_es_una_opcion');
  }

  const estudios = cuerpo.estudios ?? [];
  if (!listaBienFormada(estudios, ['institucion', 'titulo'], TOPE_RENGLONES_DE_LISTA)) {
    return falla('estudios_mal_formados');
  }

  const experienciaLaboral = cuerpo.experiencia_laboral ?? [];
  if (!listaBienFormada(experienciaLaboral, ['empleador', 'tarea'], TOPE_RENGLONES_DE_LISTA)) {
    return falla('experiencia_laboral_mal_formada');
  }

  const referencias = cuerpo.referencias_laborales ?? [];
  if (!listaBienFormada(referencias, ['nombre', 'telefono'], TOPE_REFERENCIAS)) {
    return falla('referencias_mal_formadas');
  }

  let distancia = null;
  if (cuerpo.distancia_maxima_km != null && cuerpo.distancia_maxima_km !== '') {
    distancia = Number(cuerpo.distancia_maxima_km);
    if (!Number.isFinite(distancia) || distancia <= 0) return falla('distancia_maxima_invalida');
  }

  // Lo que pretende cobrar por hora. No decirlo no traba la postulación —el PRD lo releva sin
  // publicar montos y lo acuerda en la entrevista—, pero un cero o un número negativo sí, porque
  // no es una pretensión sino un dato mal cargado, y la base lo rechazaría igual.
  let honorario = null;
  if (cuerpo.honorario_pretendido != null && cuerpo.honorario_pretendido !== '') {
    honorario = Number(cuerpo.honorario_pretendido);
    if (!Number.isFinite(honorario) || honorario <= 0) return falla('honorario_pretendido_invalido');
  }

  const ubicacion = ubicacionDelDomicilio(cuerpo);
  if (ubicacion === 'invalida') return falla('ubicacion_invalida');

  return {
    error: null,
    datos: {
      nombre: cuerpo.nombre,
      dni: String(cuerpo.dni),
      telefono: cuerpo.telefono,
      email: cuerpo.email,
      especialidades: cuerpo.especialidades,
      zonas: cuerpo.zonas,
      disponibilidad: cuerpo.disponibilidad,
      anios_experiencia: cuerpo.anios_experiencia ?? null,
      situacion_fiscal: cuerpo.situacion_fiscal,
      como_conocio: cuerpo.como_conocio ?? null,
      mensaje: cuerpo.mensaje ?? null,
      fecha_nacimiento: cuerpo.fecha_nacimiento,
      domicilio: cuerpo.domicilio ?? null,
      lat: ubicacion ? ubicacion.lat : null,
      lng: ubicacion ? ubicacion.lng : null,
      localidad: cuerpo.localidad ?? null,
      nacionalidad: cuerpo.nacionalidad ?? null,
      cuil: cuerpo.cuil ? normalizarCuil(cuerpo.cuil) : null,
      genero: cuerpo.genero ?? null,
      foto_perfil_url: cuerpo.foto_perfil_url ?? null,
      tipo_registro_afip: cuerpo.tipo_registro_afip ?? null,
      obra_social: cuerpo.obra_social ?? null,
      estudios,
      experiencia_laboral: experienciaLaboral,
      referencias_laborales: referencias,
      experiencia_clinica: experienciaClinica,
      distancia_maxima_km: distancia,
      // La moneda no viaja en el pedido: la completa la base con la de la Prestadora. Un
      // formulario público no puede decir en qué moneda cobra la empresa que recibe la
      // postulación.
      honorario_pretendido: honorario,
      disponible_urgencias: cuerpo.disponible_urgencias === true,
      disponible_con_retiro: cuerpo.disponible_con_retiro === true,
      disponible_sin_retiro: cuerpo.disponible_sin_retiro === true,
    },
  };
}

// El punto del mapa viaja entero o no viaja: media coordenada no ubica nada, y guardada así
// después parece un dato cargado.
function ubicacionDelDomicilio(cuerpo) {
  const hayLat = cuerpo.lat != null && cuerpo.lat !== '';
  const hayLng = cuerpo.lng != null && cuerpo.lng !== '';
  if (!hayLat && !hayLng) return null;
  if (!hayLat || !hayLng) return 'invalida';

  const lat = Number(cuerpo.lat);
  const lng = Number(cuerpo.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'invalida';
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return 'invalida';
  return { lat, lng };
}

// Cómo le pregunta el Panel al servidor por un formulario declarado.
//
// Va por el servidor y no derecho a la base porque el mismo lado que entrega la declaración es el
// que después controla la respuesta: si la pantalla leyera de un lado y el control corriera del
// otro, los dos podrían dejar de mirar la misma declaración sin que nadie se entere.

import { llamarApiPanel } from './apiPanel';

/** Qué formularios declarados hay para un ámbito. */
export async function formulariosDelAmbito(ambito) {
  const { formularios } = await llamarApiPanel(`/formularios/ambito/${encodeURIComponent(ambito)}`);
  return formularios ?? [];
}

/** La declaración de un formulario: sus secciones y los casilleros de cada una. */
export async function traerDeclaracion(clave) {
  const { declaracion } = await llamarApiPanel(`/formularios/${encodeURIComponent(clave)}`);
  return declaracion;
}

/**
 * El control del lado del servidor, que es el que decide.
 *
 * Devuelve `{ ok: true, respuesta }` con la respuesta ya limpia, o `{ ok: false, faltantes }` con
 * todo lo que falta. Un formulario incompleto no es una falla: es lo que pasa cuando quien carga
 * todavía no terminó, y por eso vuelve como respuesta y no como error.
 */
export async function controlarRespuesta(clave, respuesta, contexto = {}) {
  const resultado = await llamarApiPanel(`/formularios/${encodeURIComponent(clave)}/controlar`, {
    method: 'POST',
    body: JSON.stringify({ respuesta, contexto }),
  });
  return {
    ok: Boolean(resultado.ok),
    respuesta: resultado.respuesta ?? null,
    faltantes: resultado.faltantes ?? [],
  };
}

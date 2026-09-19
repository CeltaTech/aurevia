// De dónde sale la declaración de un formulario, y el control que corre del lado del servidor.
//
// **La declaración sale de la base, nunca del código.** Acá se la arma: el formulario, sus
// secciones y los casilleros de cada una, en un solo objeto que la pantalla dibuja tal cual.
//
// **Dos niveles, como el resto de los catálogos.** Con `prestadora_id` vacío el formulario lo trae
// el producto y lo ven todas; con dato, lo agregó esa Prestadora y sólo lo ve ella. Y cuando la
// Prestadora declaró uno con la misma clave que trae el producto, manda el de ella: ésa es la
// forma de trabajo que eligió.
//
// **Y el control se repite acá aunque la pantalla ya lo haya hecho.** A la pantalla se la saltea
// cualquiera con una llamada armada a mano. La regla la escribe una sola vez
// `utils/motorDeFormularios.js`, que es copia exacta del archivo del Panel, así que los dos lados
// deciden igual.

import { supabase } from '../db/connection.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import { validarFormulario, limpiarRespuesta, MOTIVOS } from './motorDeFormularios.js';

/** Los casilleros y la sección, sin lo que no le sirve a quien dibuja. */
function armarSeccion(seccion, campos) {
  return {
    clave: seccion.clave,
    titulo: seccion.titulo,
    repetible: seccion.repetible,
    maximo_repeticiones: seccion.maximo_repeticiones,
    obligatoria_cuando: seccion.obligatoria_cuando,
    campos: campos
      .filter((campo) => campo.seccion_id === seccion.id && campo.activo)
      .sort((uno, otro) => uno.orden - otro.orden || uno.clave.localeCompare(otro.clave))
      .map((campo) => ({
        clave: campo.clave,
        tipo: campo.tipo,
        // La etiqueta y nada más. No hay línea de ayuda, y no la hay porque no existe la columna:
        // si un casillero necesita explicación, lo que está mal es el casillero.
        etiqueta: campo.etiqueta,
        obligatorio: campo.obligatorio,
        obligatorio_si: campo.obligatorio_si,
        no_obligatorio_si: campo.no_obligatorio_si,
        maximo: campo.maximo,
        formatos: campo.formatos,
        lista_de_opciones: campo.lista_de_opciones,
        vigencia: campo.vigencia,
      })),
  };
}

/**
 * La declaración de un formulario, para esa Organización.
 *
 * Va acotada a mano porque del lado del servidor se usa la llave de servicio, que pasa por encima
 * de las reglas de acceso de la base: el aislamiento lo tiene que poner la consulta.
 *
 * @param clave         el nombre guardado del formulario.
 * @param prestadoraId  la Organización de quien pregunta.
 */
export async function declaracionDeFormulario(clave, prestadoraId) {
  if (!prestadoraId) throw new ErrorConMotivo('faltan_datos', 'Sin Organización activa no se lee ninguna declaración');

  const { data: formularios, error } = await supabase
    .from('formularios_declarados')
    .select('*')
    .eq('clave', clave)
    .eq('activo', true)
    .or(`prestadora_id.is.null,prestadora_id.eq.${prestadoraId}`);
  if (error) throw error;

  // La de la Prestadora le gana a la del producto: una diferencia entre Prestadoras se resuelve
  // con configuración.
  const formulario = (formularios ?? []).find((f) => f.prestadora_id === prestadoraId)
    ?? (formularios ?? []).find((f) => f.prestadora_id === null);
  if (!formulario) throw new ErrorConMotivo(MOTIVOS.formulario_no_declarado, `No hay formulario declarado con clave ${clave}`);

  const [{ data: secciones, error: errorSecciones }, { data: campos, error: errorCampos }] = await Promise.all([
    supabase.from('formulario_secciones').select('*').eq('formulario_id', formulario.id).eq('activo', true).order('orden'),
    supabase.from('formulario_campos').select('*').eq('activo', true),
  ]);
  if (errorSecciones) throw errorSecciones;
  if (errorCampos) throw errorCampos;

  const propias = secciones ?? [];
  const idsDeSeccion = new Set(propias.map((s) => s.id));
  const camposPropios = (campos ?? []).filter((campo) => idsDeSeccion.has(campo.seccion_id));

  return {
    clave: formulario.clave,
    ambito: formulario.ambito,
    titulo: formulario.titulo,
    // Quién la declaró: el producto o esta Prestadora. Sirve para saber si se puede editar.
    del_producto: formulario.prestadora_id === null,
    secciones: propias.map((seccion) => armarSeccion(seccion, camposPropios)),
  };
}

/** Todos los formularios declarados de un ámbito, para esa Organización. */
export async function formulariosDelAmbito(ambito, prestadoraId) {
  if (!prestadoraId) throw new ErrorConMotivo('faltan_datos', 'Sin Organización activa no se lee ninguna declaración');

  const { data, error } = await supabase
    .from('formularios_declarados')
    .select('clave, ambito, titulo, orden, prestadora_id')
    .eq('ambito', ambito)
    .eq('activo', true)
    .or(`prestadora_id.is.null,prestadora_id.eq.${prestadoraId}`)
    .order('orden');
  if (error) throw error;

  const porClave = new Map();
  for (const fila of data ?? []) {
    const anterior = porClave.get(fila.clave);
    if (!anterior || fila.prestadora_id === prestadoraId) porClave.set(fila.clave, fila);
  }
  return [...porClave.values()].map(({ prestadora_id, ...resto }) => ({ ...resto, del_producto: prestadora_id === null }));
}

/**
 * El control del lado del servidor. Es la puerta que tiene que atravesar cualquier pantalla antes
 * de guardar una respuesta a un formulario declarado.
 *
 * Devuelve la respuesta ya limpia: sin los casilleros escondidos, que no se ven y por lo tanto no
 * se guardan, y sin lo que nadie declaró.
 *
 * Si algo falta, levanta un `ErrorConMotivo` con la lista adentro. La lista dice sección,
 * repetición y casillero, todo por su clave: son nombres de la declaración, no de la base.
 */
export async function validarContraLaDeclaracion(clave, respuesta, prestadoraId, opciones = {}) {
  const declaracion = await declaracionDeFormulario(clave, prestadoraId);
  const faltantes = validarFormulario(declaracion, respuesta, opciones);

  if (faltantes.length > 0) {
    const error = new ErrorConMotivo('formulario_incompleto', `El formulario ${clave} llegó con ${faltantes.length} casillero(s) sin resolver`);
    error.faltantes = faltantes;
    throw error;
  }

  return { declaracion, respuesta: limpiarRespuesta(declaracion, respuesta, opciones) };
}

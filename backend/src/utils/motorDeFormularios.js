// El motor de los formularios declarados: qué se pide, cuándo se pide y qué se acepta.
//
// Los formularios se declaran, no se dibujan. La declaración sale de la base —qué secciones,
// qué casilleros, de qué tipo, con qué largo máximo, qué formatos de archivo, cuáles se repiten
// y bajo qué condición una sección pasa a ser obligatoria— y este archivo es lo único que la
// interpreta. La pantalla la dibuja y el servidor la controla, los dos llamando acá.
//
// POR QUÉ ESTÁ EN LOS DOS LADOS. Lo que se valida en la pantalla se vuelve a validar en el
// servidor, porque a la pantalla se la saltea cualquiera. Y como las dos carpetas se despliegan
// por separado y no se ven entre sí, el original es éste y su copia la mantiene
// `scripts/sincronizar_copias.mjs`. Nunca se edita la copia.
//
// LO QUE NO ESTÁ ACÁ. Ni una etiqueta HTML, ni un color, ni una medida: esto decide, no dibuja.
// Y ninguna frase visible: devuelve motivos, que son códigos, y la frase la resuelve quien
// muestra, en el idioma de quien mira.
//
// LO QUE NO VA A ESTAR NUNCA. Una línea de ayuda debajo de un casillero. Un casillero se explica
// solo: lleva su etiqueta y nada más. Por eso la declaración no tiene dónde guardar una
// explicación, y este archivo no tiene dónde leerla.

// ---------------------------------------------------------------------------
// Lo que se puede declarar
// ---------------------------------------------------------------------------

/** Los tipos de casillero que el motor sabe dibujar y controlar. */
export const TIPOS_DE_CAMPO = [
  'texto',
  'texto_largo',
  'fecha',
  'anio',
  'mes_anio',
  'casilla',
  'archivo',
  'telefono',
  'lista',
  'lista_multiple',
];

/** Los tipos que guardan un archivo y no un valor escrito. */
export const TIPOS_DE_ARCHIVO = ['archivo'];

/** Los tipos que eligen de una lista. */
export const TIPOS_DE_LISTA = ['lista', 'lista_multiple'];

/**
 * Los motivos que puede devolver el motor. Son códigos, no frases: el motor no sabe en qué
 * idioma está mirando la persona. La frase la busca quien muestra.
 */
export const MOTIVOS = {
  falta_un_dato_obligatorio: 'falta_un_dato_obligatorio',
  texto_demasiado_largo: 'texto_demasiado_largo',
  formato_de_archivo_no_admitido: 'formato_de_archivo_no_admitido',
  fecha_mal_escrita: 'fecha_mal_escrita',
  anio_mal_escrito: 'anio_mal_escrito',
  mes_y_anio_mal_escritos: 'mes_y_anio_mal_escritos',
  telefono_mal_escrito: 'telefono_mal_escrito',
  opcion_fuera_de_la_lista: 'opcion_fuera_de_la_lista',
  falta_hasta_cuando_vale: 'falta_hasta_cuando_vale',
  se_repite_de_mas: 'se_repite_de_mas',
  casillero_no_declarado: 'casillero_no_declarado',
  formulario_no_declarado: 'formulario_no_declarado',
};

// ---------------------------------------------------------------------------
// Las condiciones
// ---------------------------------------------------------------------------

/* Una condición se escribe en una sola línea y admite tres formas:
     casillero == true                     lo que se marcó en este mismo bloque
     casillero == 'valor'                  lo que se eligió en este mismo bloque
     casillero.propiedad == true           una propiedad de la opción elegida
   Más que eso no hace falta, y admitir más convierte la declaración en un lenguaje que hay que
   aprender. Lo que no se entiende se trata como no cumplida: una condición rota no puede dejar
   de pedir un dato obligatorio. */
const RE_CONDICION = /^\s*([a-z_]+)(?:\.([a-z_]+))?\s*==\s*(.+?)\s*$/i;

/* Sólo una comparación contra un valor escrito entre comillas esconde el casillero. La que mira
   una propiedad de la opción elegida cambia si el dato es obligatorio, y nada más: esconder por
   una propiedad que la persona no ve en ningún lado deja la pantalla cambiando sola. */
const RE_VALOR_ESCRITO = /==\s*['"]/;

function valorLiteral(escrito) {
  const limpio = String(escrito).trim();
  if (limpio === 'true') return true;
  if (limpio === 'false') return false;
  if (/^'.*'$/.test(limpio) || /^".*"$/.test(limpio)) return limpio.slice(1, -1);
  return limpio;
}

function mismoValor(izquierda, derecha) {
  if (typeof derecha === 'boolean') return Boolean(izquierda) === derecha;
  if (izquierda === null || izquierda === undefined) return false;
  return String(izquierda) === String(derecha);
}

/**
 * Resuelve si una condición se cumple.
 *
 * @param expresion  la condición escrita en la declaración.
 * @param bloque     los valores cargados en el bloque que se está mirando.
 * @param contexto   lo que se sabe alrededor: la opción elegida con sus propiedades, o los datos
 *                   de otras partes del formulario. `{ tipo_asistente: { requiere_matricula: true } }`
 * @returns true, false, o false si la condición no se entiende.
 */
export function condicionSeCumple(expresion, bloque = {}, contexto = {}) {
  if (!expresion) return false;
  const partes = RE_CONDICION.exec(String(expresion));
  if (!partes) return false;

  const [, nombre, propiedad, escrito] = partes;
  const esperado = valorLiteral(escrito);

  if (propiedad) {
    // Lo de la izquierda es una propiedad de algo que se resolvió afuera del bloque.
    const fuente = contexto?.[nombre];
    if (!fuente || typeof fuente !== 'object') return false;
    return mismoValor(fuente[propiedad], esperado);
  }

  const encontrado = nombre in bloque ? bloque[nombre] : contexto?.[nombre];
  return mismoValor(encontrado, esperado);
}

/** Si el casillero se ve. Sólo lo esconde una comparación contra un valor escrito. */
export function campoEstaVisible(campo, bloque = {}, contexto = {}) {
  const condicion = campo?.obligatorio_si || campo?.no_obligatorio_si;
  if (!condicion) return true;
  if (!RE_VALOR_ESCRITO.test(condicion)) return true;
  const cumple = condicionSeCumple(condicion, bloque, contexto);
  return campo.obligatorio_si ? cumple : !cumple;
}

/** Si el casillero hay que completarlo, mirando sus condiciones. */
export function campoEsObligatorio(campo, bloque = {}, contexto = {}) {
  if (!campo) return false;
  if (campo.obligatorio_si) return condicionSeCumple(campo.obligatorio_si, bloque, contexto);
  if (campo.no_obligatorio_si && condicionSeCumple(campo.no_obligatorio_si, bloque, contexto)) return false;
  return Boolean(campo.obligatorio);
}

/** Si la sección entera hay que completarla. Sin condición, es obligatoria desde que se abre. */
export function seccionEsObligatoria(seccion, respuesta = {}, contexto = {}) {
  if (!seccion) return false;
  if (!seccion.obligatoria_cuando) return true;
  return condicionSeCumple(seccion.obligatoria_cuando, respuesta, contexto);
}

// ---------------------------------------------------------------------------
// Las formas que tiene que tener cada tipo
// ---------------------------------------------------------------------------

const FORMAS = {
  fecha: { patron: /^\d{4}-\d{2}-\d{2}$/, motivo: MOTIVOS.fecha_mal_escrita },
  anio: { patron: /^\d{4}$/, motivo: MOTIVOS.anio_mal_escrito },
  mes_anio: { patron: /^\d{4}-(0[1-9]|1[0-2])$/, motivo: MOTIVOS.mes_y_anio_mal_escritos },
  // Se admite el signo de más adelante, los espacios, los guiones y los paréntesis, porque cada
  // país escribe el teléfono a su manera. Lo que se cuenta son los dígitos.
  telefono: { patron: /^\+?[\d\s().-]{6,25}$/, motivo: MOTIVOS.telefono_mal_escrito },
};

function estaVacio(valor) {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === 'string') return valor.trim() === '';
  if (Array.isArray(valor)) return valor.length === 0;
  if (typeof valor === 'boolean') return valor === false;
  return false;
}

/** La extensión de un nombre de archivo, en minúscula y sin el punto. */
export function extensionDelArchivo(nombre) {
  const limpio = String(nombre ?? '').trim().toLowerCase();
  const punto = limpio.lastIndexOf('.');
  if (punto <= 0 || punto === limpio.length - 1) return '';
  return limpio.slice(punto + 1);
}

/**
 * Controla un casillero suelto.
 *
 * @returns el motivo del rechazo, o null si pasa.
 */
export function validarCampo(campo, valor, { bloque = {}, contexto = {}, opciones = null } = {}) {
  if (!campo) return MOTIVOS.casillero_no_declarado;
  if (!campoEstaVisible(campo, bloque, contexto)) return null;

  const obligatorio = campoEsObligatorio(campo, bloque, contexto);
  const vacio = TIPOS_DE_ARCHIVO.includes(campo.tipo)
    ? estaVacio(valor?.nombre ?? valor?.archivo_url ?? valor)
    : estaVacio(valor);

  if (vacio) return obligatorio ? MOTIVOS.falta_un_dato_obligatorio : null;

  if (TIPOS_DE_ARCHIVO.includes(campo.tipo)) {
    const formatos = Array.isArray(campo.formatos) ? campo.formatos.map((f) => String(f).toLowerCase()) : [];
    const extension = extensionDelArchivo(valor?.nombre ?? valor?.archivo_url ?? valor);
    if (formatos.length > 0 && !formatos.includes(extension)) return MOTIVOS.formato_de_archivo_no_admitido;
    if (campo.vigencia && estaVacio(valor?.vigente_hasta)) return MOTIVOS.falta_hasta_cuando_vale;
    return null;
  }

  if (TIPOS_DE_LISTA.includes(campo.tipo)) {
    // Las opciones salen de la base. Si quien llama no las trajo, no se inventa una lista: se
    // acepta el valor y lo frena la base, que es donde la lista vive de verdad.
    if (!Array.isArray(opciones) || opciones.length === 0) return null;
    const admitidas = opciones.map((o) => String(o?.valor ?? o));
    const elegidas = Array.isArray(valor) ? valor : [valor];
    if (campo.tipo === 'lista' && elegidas.length > 1) return MOTIVOS.opcion_fuera_de_la_lista;
    for (const elegida of elegidas) {
      if (!admitidas.includes(String(elegida))) return MOTIVOS.opcion_fuera_de_la_lista;
    }
    return null;
  }

  if (campo.tipo === 'casilla') return null;

  const forma = FORMAS[campo.tipo];
  if (forma && !forma.patron.test(String(valor).trim())) return forma.motivo;

  const maximo = Number(campo.maximo ?? 0);
  if (maximo > 0 && String(valor).trim().length > maximo) return MOTIVOS.texto_demasiado_largo;

  if (campo.vigencia && estaVacio(bloque?.[`${campo.clave}_vigente_hasta`])) {
    return MOTIVOS.falta_hasta_cuando_vale;
  }

  return null;
}

// ---------------------------------------------------------------------------
// La sección y el formulario entero
// ---------------------------------------------------------------------------

function bloquesDeLaSeccion(seccion, respuesta) {
  const cargado = respuesta?.[seccion.clave];
  if (seccion.repetible) return Array.isArray(cargado) ? cargado : cargado ? [cargado] : [];
  return [cargado && typeof cargado === 'object' ? cargado : {}];
}

/**
 * Controla una sección entera y devuelve **todo** lo que falta, no lo primero.
 *
 * Frenar en el primer error obliga a mandar el formulario tantas veces como errores tenga, y
 * cada vuelta se descubre uno nuevo. Quien trabaja tiene que ver de una sola vez todo lo que le
 * falta.
 *
 * @returns una lista de { seccion, indice, campo, motivo }.
 */
export function validarSeccion(seccion, respuesta = {}, { contexto = {}, opcionesPorLista = {} } = {}) {
  const faltantes = [];
  if (!seccion) return faltantes;

  const campos = Array.isArray(seccion.campos) ? seccion.campos.filter((c) => c?.activo !== false) : [];
  const bloques = bloquesDeLaSeccion(seccion, respuesta);
  const exigida = seccionEsObligatoria(seccion, respuesta, contexto);

  const tope = Number(seccion.maximo_repeticiones ?? 0);
  if (seccion.repetible && tope > 0 && bloques.length > tope) {
    faltantes.push({ seccion: seccion.clave, indice: null, campo: null, motivo: MOTIVOS.se_repite_de_mas });
  }

  // Una sección que se repite, que es obligatoria y que quedó sin un solo renglón cargado no es
  // «nada que revisar»: es la sección sin completar. Sin esto pasaba callada, porque el control
  // recorre los renglones y ahí no había ninguno.
  const conAlgo = bloques.some((bloque) => campos.some((campo) => !estaVacio(bloque?.[campo.clave])));
  if (seccion.repetible && exigida && !conAlgo) {
    faltantes.push({ seccion: seccion.clave, indice: null, campo: null, motivo: MOTIVOS.falta_un_dato_obligatorio });
  }

  bloques.forEach((bloque, indice) => {
    const cargado = bloque && typeof bloque === 'object' ? bloque : {};
    // Un bloque que se repite y quedó vacío no es un error: es un renglón que nadie usó. El que
    // no se repite se controla igual, porque ahí el vacío sí es el formulario sin completar.
    const vacioEntero = campos.every((campo) => estaVacio(cargado[campo.clave]));
    if (seccion.repetible && vacioEntero) return;
    if (!exigida && vacioEntero) return;

    for (const campo of campos) {
      const opciones = campo.lista_de_opciones ? opcionesPorLista[campo.lista_de_opciones] : null;
      const motivo = validarCampo(campo, cargado[campo.clave], { bloque: cargado, contexto, opciones });
      if (motivo) faltantes.push({ seccion: seccion.clave, indice, campo: campo.clave, motivo });
    }
  });

  return faltantes;
}

/**
 * Controla el formulario entero, sección por sección.
 *
 * @param declaracion  lo que salió de la base: { clave, secciones: [...] }.
 * @param respuesta    lo cargado: { <clave de sección>: bloque | [bloques] }.
 * @returns una lista de { seccion, indice, campo, motivo }. Vacía quiere decir que pasa.
 */
export function validarFormulario(declaracion, respuesta = {}, opciones = {}) {
  if (!declaracion || !Array.isArray(declaracion.secciones)) {
    return [{ seccion: null, indice: null, campo: null, motivo: MOTIVOS.formulario_no_declarado }];
  }

  const faltantes = [];
  for (const seccion of declaracion.secciones) {
    if (seccion?.activo === false) continue;
    faltantes.push(...validarSeccion(seccion, respuesta, opciones));
  }

  // Lo que llegó y no está declarado no se guarda ni se ignora en silencio: se rechaza. Ignorarlo
  // deja a quien lo mandó creyendo que se guardó.
  const declaradas = new Set(declaracion.secciones.map((s) => s?.clave));
  for (const clave of Object.keys(respuesta)) {
    if (!declaradas.has(clave)) {
      faltantes.push({ seccion: clave, indice: null, campo: null, motivo: MOTIVOS.casillero_no_declarado });
    }
  }

  return faltantes;
}

/**
 * Deja la respuesta con lo que la declaración admite y nada más: saca los casilleros escondidos
 * —que no se ven, así que no se guardan— y los que nadie declaró.
 */
export function limpiarRespuesta(declaracion, respuesta = {}, { contexto = {} } = {}) {
  const limpia = {};
  if (!declaracion || !Array.isArray(declaracion.secciones)) return limpia;

  for (const seccion of declaracion.secciones) {
    if (!seccion || seccion.activo === false) continue;
    const campos = Array.isArray(seccion.campos) ? seccion.campos.filter((c) => c?.activo !== false) : [];
    const bloques = bloquesDeLaSeccion(seccion, respuesta).map((bloque) => {
      const cargado = bloque && typeof bloque === 'object' ? bloque : {};
      const bloqueLimpio = {};
      for (const campo of campos) {
        if (!campoEstaVisible(campo, cargado, contexto)) continue;
        if (campo.clave in cargado) bloqueLimpio[campo.clave] = cargado[campo.clave];
        const vigencia = `${campo.clave}_vigente_hasta`;
        if (campo.vigencia && vigencia in cargado) bloqueLimpio[vigencia] = cargado[vigencia];
      }
      return bloqueLimpio;
    });

    if (seccion.repetible) {
      limpia[seccion.clave] = bloques.filter((b) => Object.values(b).some((v) => !estaVacio(v)));
    } else {
      limpia[seccion.clave] = bloques[0] ?? {};
    }
  }

  return limpia;
}

/** El texto de la declaración en el idioma de quien mira, con el castellano como último recurso. */
export function textoDeclarado(texto, idioma) {
  if (!texto || typeof texto !== 'object') return '';
  return texto[idioma] || texto['es-AR'] || '';
}

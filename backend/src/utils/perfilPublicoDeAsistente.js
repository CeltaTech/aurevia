// ---------------------------------------------------------------------------
// perfilPublicoDeAsistente.js — qué se ve de un Asistente en la vidriera del
// Marketplace, en qué orden aparece la lista, y qué no sale nunca.
//
// QUÉ ES UN PERFIL PÚBLICO ACÁ. La Familia que entra a la modalidad marketplace
// mira gente que todavía no contrató. Lo que ve tiene que alcanzar para elegir
// —qué es esa persona, en qué zonas trabaja, desde cuándo, cómo está su carpeta
// de papeles y qué dijeron las Familias anteriores— y no tiene que alcanzar para
// ir a buscarla por fuera del producto. Eso segundo es justamente lo que el
// Marketplace vende, y se cobra aparte
// (`supabase/migrations/20260912100000_el_paquete_de_contactos.sql`).
//
// POR ESO EL DATO DE CONTACTO NO SALE DE ACÁ, NI TAPADO NI A MEDIAS. Teléfono,
// correo, documento, domicilio y cualquier otro medio por el que se pueda llegar
// a la persona quedan afuera de `COLUMNAS_PERFIL_PUBLICO`: no se piden a la base,
// así que no hay ningún camino por el que se filtren a la respuesta. La lista de
// abajo no es un adorno, es lo que prueban las pruebas.
//
// EL ORDEN DE LA LISTA ES NEUTRO, Y ESO NO ES UNA PREFERENCIA DE DISEÑO.
// `ranking_plataforma` es una de las cinco funciones de riesgo catalogadas: en
// Argentina, que la plataforma ordene a quién se le ofrece trabajo primero es uno
// de los indicios de dirección del trabajo (`docs/legal/argentina.md`, y el
// catálogo en `catalogo_funciones_marketplace`). Nace apagada, y mientras esté
// apagada el orden **no puede premiar ni castigar a nadie**. Tampoco puede ser
// alfabético: quien se llama Acosta quedaría primero todos los días del año, que
// es una ventaja permanente repartida por la plataforma. Así que se mezcla, de
// una forma que da lo mismo dentro del día y cambia al día siguiente.
//
// LA CALIFICACIÓN SE MUESTRA SI LA PRESTADORA MUESTRA CALIFICACIONES. Es la misma
// decisión que ya toma `familia_califica_al_asistente`, no una nueva: donde no se
// califica, tampoco se publica el promedio. Y mostrar el promedio no es ordenar
// por él — son dos cosas distintas y la segunda es la que tiene aviso legal.
// ---------------------------------------------------------------------------

/**
 * Las únicas columnas de `asistentes` que viajan a la aplicación de la Familia.
 * Se escriben como texto de consulta porque es así como se usan, y en un solo
 * lugar para que ninguna ruta nueva arme su propia lista más larga.
 */
export const COLUMNAS_PERFIL_PUBLICO = 'id, nombre, foto_url, tipo_asistente_id, fecha_alta';

/**
 * Lo que la ficha del Asistente tiene y esta vidriera no muestra jamás. Están
 * escritas para poder probarlas: la prueba arma un perfil a partir de una ficha
 * completa y comprueba que ninguna de estas palabras aparezca en la salida.
 */
export const NUNCA_SALEN = [
  'telefono',
  'email',
  'dni',
  'domicilio',
  'disponibilidad',
  'horas_semanales',
  'tipo_vinculo',
  'canales',
  'estado',
  'qr_token',
  'prestadora_id',
  'fecha_baja',
  'deleted_at',
  'importacion_id',
  'pendiente_conformidad',
  'disponible_para_ofertas',
  'especialidades',
];

/** Cómo se ordena la lista. La segunda existe sólo si la Prestadora encendió `ranking_plataforma`. */
export const ORDEN = {
  /** Mezclado, parejo, y distinto cada día. Es el que rige mientras la función esté apagada. */
  NEUTRO: 'neutro',
  /** Mejor calificado primero. Función de riesgo legal: no se usa sin encenderla. */
  CALIFICACION: 'calificacion',
};

/** La clave de la función de riesgo que habilita el otro orden, tal como está en el catálogo. */
export const FUNCION_QUE_HABILITA_EL_ORDEN = 'ranking_plataforma';

/**
 * Arma el perfil que se le muestra a la Familia.
 *
 * @param asistente     la ficha, ya leída con `COLUMNAS_PERFIL_PUBLICO`.
 * @param tipo          el tipo de Asistente, como lo devuelve `tareasDelTipo.js`, o `null`.
 * @param documentacion lo que devolvió `estadoDocumentalParaLaFamilia`, o `null` si no se informa.
 * @param calificacion  `{ promedio, cuantas }`, o `null` si esta Prestadora no muestra calificaciones.
 * @param ahora         desde cuándo se cuenta la antigüedad (la prueba manda una fecha fija).
 */
export function perfilPublicoDeAsistente({
  asistente,
  tipo = null,
  documentacion = null,
  calificacion = null,
  ahora = new Date(),
} = {}) {
  if (!asistente?.id) return null;

  return {
    id: asistente.id,
    nombre: asistente.nombre ?? null,
    foto_url: asistente.foto_url ?? null,
    // Dónde trabaja es la única parte del "dónde" que sale: dice si esa persona llega hasta el
    // barrio, que es lo que la Familia necesita para elegir. El domicilio de la persona no está
    // ni en la consulta.
    //
    // Son los nombres de los lugares que tiene guardados, y llegan armados desde afuera: no están
    // en su ficha sino en la tabla que la cruza con cada lugar.
    zonas: Array.isArray(asistente.zonas) ? asistente.zonas : [],
    // El tipo viaja armado y no como identificador suelto: el nombre visible de un tipo
    // general sale de las traducciones y el de uno propio de la Prestadora es un dato suyo,
    // y esa distinción ya vive una sola vez en `tipoDeAsistente.js`.
    tipo: tipo ? { id: tipo.id, clave: tipo.clave ?? null, nombre: tipo.nombre ?? null, prestadora_id: tipo.prestadora_id ?? null } : null,
    // Cuánto hace que trabaja, en meses. Es un hecho comprobable y no una opinión, y por eso
    // se puede decir sin que sea una calificación encubierta.
    antiguedad_meses: mesesDesde(asistente.fecha_alta, ahora),
    // La insignia de verificación es exactamente lo que ya se le cuenta a la Familia que
    // contrató: cuentas y palabras de estado, nunca el nombre de un papel
    // (`estadoDocumentalParaLaFamilia.js`).
    verificacion: documentacion
      ? {
          documentacion: documentacion.resumen,
          matricula: documentacion.matricula,
          papeles_exigidos: documentacion.papelesExigidos,
          papeles_al_dia: documentacion.alDia,
        }
      : null,
    calificacion,
  };
}

/**
 * El promedio y cuántas lo forman, a partir de las calificaciones públicas.
 *
 * Devuelve `null` sin ninguna: un promedio de cero opiniones no es un cero, y mostrarlo como
 * número haría que quien recién empieza aparezca peor calificado que nadie.
 */
export function promedioDeCalificaciones(filas) {
  const estrellas = (filas ?? []).map((f) => Number(f?.estrellas)).filter((n) => Number.isFinite(n));
  if (!estrellas.length) return null;
  const suma = estrellas.reduce((a, b) => a + b, 0);
  return {
    promedio: Math.round((suma / estrellas.length) * 10) / 10,
    cuantas: estrellas.length,
  };
}

/**
 * Ordena la vidriera.
 *
 * El neutro mezcla con una cuenta que sólo depende del identificador y del día: adentro del
 * mismo día la lista no salta mientras la persona la mira —ni entre una página y la
 * siguiente—, y al día siguiente el orden es otro. Nadie queda primero por ser quien es.
 *
 * @param perfiles  los perfiles ya armados.
 * @param orden     `ORDEN.NEUTRO` o `ORDEN.CALIFICACION`.
 * @param semilla   qué día es hoy, en texto. Se recibe para poder fijarla en la prueba.
 */
export function ordenarPool(perfiles, { orden = ORDEN.NEUTRO, semilla = '' } = {}) {
  const lista = [...(perfiles ?? [])];
  const neutro = (a, b) => mezcla(a.id, semilla) - mezcla(b.id, semilla);

  if (orden !== ORDEN.CALIFICACION) return lista.sort(neutro);

  // Con la función encendida: primero el promedio, y entre iguales el mismo desempate neutro.
  // Quien no tiene ninguna calificación va al final y no adelante: no tener opiniones no es
  // una nota, pero ponerlo primero sería premiar la falta de historia.
  return lista.sort((a, b) => {
    const pa = a.calificacion?.promedio ?? -1;
    const pb = b.calificacion?.promedio ?? -1;
    if (pa !== pb) return pb - pa;
    return neutro(a, b);
  });
}

/** Meses enteros entre la fecha de alta y hoy. `null` si no hay fecha. */
function mesesDesde(fechaAlta, ahora) {
  if (!fechaAlta) return null;
  const desde = new Date(fechaAlta);
  if (Number.isNaN(desde.getTime())) return null;
  const meses =
    (ahora.getFullYear() - desde.getFullYear()) * 12 + (ahora.getMonth() - desde.getMonth());
  const ajuste = ahora.getDate() < desde.getDate() ? 1 : 0;
  return Math.max(0, meses - ajuste);
}

/**
 * Un número estable a partir de un texto. No es azar: la misma entrada da siempre lo mismo,
 * que es justo lo que hace falta para que la lista no se reacomode sola mientras se la mira.
 */
function mezcla(id, semilla) {
  const texto = `${id ?? ''}|${semilla ?? ''}`;
  let h = 2166136261;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

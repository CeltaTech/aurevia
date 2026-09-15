/**
 * La llave que guarda el propio teléfono, y que se abre con huella o con cara.
 * =========================================================================
 *
 * QUÉ RESUELVE. Hoy para entrar a cualquiera de las dos aplicaciones hay que escribir el correo y
 * la contraseña, en un teclado de teléfono, parado en la puerta de una casa. Lo que pasa cuando
 * eso molesta es conocido: contraseñas cortas, contraseñas repetidas, y la sesión que nunca se
 * cierra para no tener que volver a escribirla. La llave del dispositivo saca el teclado del medio.
 *
 * NINGUNA HUELLA NI NINGUNA CARA ENTRA AL PRODUCTO, Y ESO NO ES UN DETALLE. El teléfono guarda una
 * llave privada adentro de su propio hardware y la destraba mirando a quien la usa. Lo que llega
 * acá es la mitad pública de esa llave y una firma hecha con la otra mitad: nunca la huella, nunca
 * la cara, nunca nada que pueda reconstruirlas. Por eso esto **no es tratamiento de dato
 * biométrico** y no arrastra la decisión legal que sí arrastra comparar dos fotos de una cara
 * (`docs/PLAN_HASTA_PRODUCCION.md`, sección «Reclutamiento»). El nombre de lo que se guarda dice
 * eso mismo: es la llave de un dispositivo, y la huella es apenas cómo el dueño la abre.
 *
 * POR QUÉ ESTO ESTÁ ACÁ Y NO ADENTRO DE LA RUTA. Lo que verifica la firma es una librería, y no
 * tiene sentido probarla de nuevo. Lo que sí hay que probar son las decisiones de alrededor, que
 * son las que dejan pasar o no: si el desafío todavía vale, si la llave sigue viva, si es de quien
 * dice, y si el contador retrocedió. Adentro de la ruta no las probaría nadie nunca.
 *
 * CADA APLICACIÓN TIENE SU PROPIA PARTE CONFIABLE, A PROPÓSITO. Una llave creada en la aplicación
 * del Asistente no sirve para entrar a la de la Familia, porque el navegador la ata al dominio
 * donde nació. Son dos aplicaciones distintas, con dos permisos distintos: que una llave sirviera
 * para las dos sería una puerta que nadie pidió.
 *
 * TODO FALLA CERRADO. Ante una llave que no está, una que fue revocada, un desafío que no se
 * encuentra o una dirección que no coincide, la respuesta es no (`celtatech/CLAUDE.md` §5).
 */

/**
 * Cuánto vale un desafío. Dos minutos alcanzan de sobra para apoyar un dedo y sobran poco: un
 * desafío que vive horas es un desafío que alguien puede llegar a reusar.
 */
export const MINUTOS_DE_VIDA_DEL_DESAFIO = 2;

/**
 * Dónde vive la aplicación de cada rol. Las dos direcciones ya existen —son las mismas con las que
 * se arma el enlace de activación de cuenta— y salen del entorno, nunca escritas acá
 * (`celtatech/CLAUDE.md` §8, «Nunca hardcodear»).
 */
const DIRECCION_POR_ROL = {
  asistente: 'PWA_ASISTENTES_URL',
  familia: 'PWA_FAMILIAS_URL',
};

export function rolesConLlaveDeDispositivo() {
  return Object.keys(DIRECCION_POR_ROL);
}

/**
 * El origen y la parte confiable de la aplicación de ese rol.
 *
 * El origen es la dirección entera y es contra lo que el navegador firma. La parte confiable es el
 * dominio sin el resto: es lo que el teléfono guarda junto a la llave para no ofrecérsela nunca a
 * otro sitio.
 *
 * Tira si el rol no tiene aplicación o si la dirección no está configurada. Devolver algo por
 * omisión sería aceptar firmas hechas contra cualquier lado.
 */
export function dondeViveLaApp(rol) {
  const variable = DIRECCION_POR_ROL[rol];
  if (!variable) throw new Error(`El rol «${rol}» no tiene aplicación con llave de dispositivo`);

  const configurada = String(process.env[variable] ?? '').trim();
  if (!configurada) throw new Error(`Falta la variable de entorno ${variable}`);

  const direccion = new URL(configurada);
  return { origen: direccion.origin, parteConfiable: direccion.hostname };
}

/** Si el desafío ya no vale. Sin fecha de vencimiento se considera vencido: falla cerrado. */
export function desafioVencido(venceEn, ahora = new Date()) {
  if (!venceEn) return true;
  const limite = new Date(venceEn);
  if (Number.isNaN(limite.getTime())) return true;
  return limite.getTime() <= ahora.getTime();
}

/**
 * Si el contador de usos retrocedió, que es la única señal de que la llave pudo haber sido copiada:
 * dos copias de la misma llave llevan cuentas distintas y tarde o temprano una llega más baja.
 *
 * Los dos en cero es el caso de los teléfonos que no llevan cuenta —la mayoría de los que guardan
 * la llave en el propio hardware—, y ahí el número no dice nada. Tomarlo como señal dejaría a esa
 * gente sin poder entrar nunca.
 */
export function elContadorRetrocedio(guardado, nuevo) {
  if (guardado === 0 && nuevo === 0) return false;
  return nuevo <= guardado;
}

/**
 * Si esta llave puede abrir la puerta.
 *
 * Contesta con un motivo y no con un booleano porque lo que sigue necesita distinguir: la llave
 * revocada se le explica a quien la revocó, y la que apunta a otra persona es un intento de entrar
 * con la llave ajena y se registra. **Ninguno de los dos motivos viaja hacia afuera**: la pantalla
 * recibe siempre el mismo aviso, como en la entrada con contraseña, donde tampoco se dice cuál de
 * los dos campos estaba mal (`celtatech/CLAUDE.md` §6).
 */
export function porQueNoAbre(llave, { usuarioId = null } = {}) {
  if (!llave) return 'llave_desconocida';
  if (llave.revocada_en) return 'llave_revocada';
  if (!llave.usuario_id) return 'llave_sin_dueño';
  if (usuarioId && llave.usuario_id !== usuarioId) return 'llave_de_otra_persona';
  return null;
}

/**
 * Lo que la pantalla muestra de una llave: cuándo se agregó y cuándo se usó por última vez, que es
 * lo único que le sirve a alguien para reconocer cuál es cuál y decidir si la saca.
 *
 * La mitad pública de la llave y su identificador no salen de acá. No son secretos, pero son el
 * dato que permite reconocer al mismo dispositivo en dos lados distintos, y no hacen falta para
 * nada de lo que la pantalla tiene que hacer.
 */
export function comoSeVeLaLlave(fila) {
  return {
    id: fila.id,
    agregadaEn: fila.creada_en,
    ultimoUsoEn: fila.ultimo_uso_en ?? null,
  };
}

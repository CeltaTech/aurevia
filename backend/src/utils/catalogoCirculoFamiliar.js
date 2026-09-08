// Catálogo único de qué se le puede dar, y qué se le puede negar, a cada persona anotada en el
// círculo familiar de una Familia.
//
// QUÉ CAMBIA ESTO. Hasta acá, quien la Prestadora anotaba en el círculo veía exactamente lo mismo
// que el titular. Las dos únicas diferencias eran que no podía calificar al Asistente ni pedir
// medicación, y no había forma de darle menos a uno que a otro. Ahora cada persona tiene lo suyo.
//
// CÓMO SE DECIDE, QUE NO ES UN DETALLE. El titular no configura nada por su cuenta: le dice a la
// Prestadora quién entra a su círculo y qué puede ver cada uno, la Prestadora lo carga, el sistema
// arma el documento con eso escrito en castellano y el titular lo firma. Así, el día que alguien
// diga «yo nunca autoricé eso», está la instrucción con nombre, fecha y firma. La constancia y el
// estado vigente viven en la base; ver la migración
// `20260908120000_los_accesos_del_circulo_familiar_los_pide_el_titular_por_escrito.sql`.
//
// ESTE ES EL ÚNICO LUGAR DONDE SE AGREGA UN ACCESO NUEVO. La tabla `permisos_circulo_familiar`
// guarda solamente lo decidido para cada persona; la lista de qué se puede decidir vive acá,
// porque describe lo que el producto sabe hacer —la escribe CeltaTech y cambia con cada versión—,
// no una decisión de nadie. Es la misma forma que `catalogoVisibilidad.js`, y por el mismo motivo.
//
// PERO ACÁ HAY UNA DIFERENCIA CON AQUEL, Y NO SE PUEDE SALTEAR. Algunas de estas claves las mira
// una política de la base, y la función `interno.circulo_puede` niega cuando no encuentra fila
// —falla cerrado, como manda CLAUDE.md—. Entonces: **toda clave nueva que vaya a mirar una
// política se rellena, para las personas que ya están anotadas, en la misma migración que escribe
// esa política.** Agregarla sólo a esta lista apagaría esa función para todo el mundo.
//
// LA UNIDAD ES EL BLOQUE, NO EL CAMPO SUELTO. Se da o se niega «el dinero», no la cuota aparte del
// código para pagar. Once decisiones las toma cualquiera; cincuenta no las toma nadie, y la
// Prestadora termina dejando todo como viene.
//
// LA CLAVE NO SE RENOMBRA NUNCA. Queda escrita adentro de filas que ya existen y adentro del texto
// de documentos que alguien firmó: cambiarla es perder la instrucción que el titular ya dio.
//
// EL VALOR DE FÁBRICA ES LO QUE PASA HOY. El círculo sigue viendo todo, y las dos acciones de
// escritura —calificar y pedir medicación— siguen apagadas, que es exactamente el comportamiento
// anterior. La Familia que no pida ningún cambio no nota ninguno.
//
// EL TITULAR NO ENTRA EN ESTA CUENTA. Firmó la prestación y ve todo, siempre. No hay instrucción
// que le pueda quitar nada, ni siquiera una suya. Por eso `accesosDelTitular()` no consulta filas.
//
// QUÉ NO ESTÁ ACÁ, A PROPÓSITO:
//   - Invitar o sacar gente del círculo. Eso lo sigue haciendo la Prestadora desde el Panel, como
//     hasta ahora. Estos accesos dicen qué ve quien ya está anotado, no quién está anotado.
//   - Los avisos al teléfono. A quién le llega cada aviso se decide en Configuración › Avisos
//     (`catalogoAvisos.js`), y poner acá otra casilla dejaría la misma regla en dos lugares.
//   - Cualquier cosa que la Prestadora tenga apagada para toda su aplicación. Ver abajo.

import { visibilidadDeFabrica } from './catalogoVisibilidad.js';

export const CATALOGO_CIRCULO_FAMILIAR = [
  {
    clave: 'circulo_reportes',
    descripcion: 'Leer los reportes de cada guardia',
    ayuda: 'Es lo que el Asistente deja escrito cada vez que va: cómo pasó el día, qué comió, cómo durmió.',
    de_fabrica: true,
    interruptor: null,
  },
  {
    clave: 'circulo_ficha_del_paciente',
    descripcion: 'Ver la ficha del Paciente',
    ayuda: 'Los datos de la persona cuidada, incluidas sus patologías si la Prestadora las muestra. Negarla deja ver que el Paciente existe y nada más.',
    de_fabrica: true,
    interruptor: null,
  },
  {
    clave: 'circulo_medicacion',
    descripcion: 'Ver la medicación vigente',
    ayuda: 'Qué toma, cuánto y a qué hora.',
    de_fabrica: true,
    interruptor: 'familia_medicacion_del_paciente',
  },
  {
    clave: 'circulo_guardias',
    descripcion: 'Ver la agenda de guardias',
    ayuda: 'Quién va, qué día y en qué horario, y quién fue cada día anterior.',
    de_fabrica: true,
    interruptor: null,
  },
  {
    clave: 'circulo_ubicacion_en_vivo',
    descripcion: 'Ver en el mapa dónde está el Asistente durante la guardia',
    ayuda: 'Negada, esa persona sigue viendo que el Asistente llegó y que se fue, pero no el recorrido.',
    de_fabrica: true,
    interruptor: 'familia_ubicacion_en_vivo',
  },
  {
    clave: 'circulo_alertas',
    descripcion: 'Leer las alertas de la revisión de los reportes',
    ayuda: 'Son avisos que salen de revisar lo que el Asistente escribió. Se leen solos, sin nadie que los explique.',
    de_fabrica: true,
    interruptor: 'familia_alertas_de_la_revision',
  },
  {
    clave: 'circulo_internaciones',
    descripcion: 'Ver las internaciones del Paciente',
    ayuda: 'Cuándo estuvo internado, dónde y por qué.',
    de_fabrica: true,
    interruptor: null,
  },
  {
    clave: 'circulo_dinero',
    descripcion: 'Ver la cuota, las facturas, los cobros y el código para pagar',
    ayuda: 'Todo lo económico junto. Es el acceso que más veces se niega: quien acompaña el cuidado no siempre es quien paga.',
    de_fabrica: true,
    interruptor: 'familia_pagos_y_suscripcion',
  },
  {
    clave: 'circulo_verifica_con_codigo',
    descripcion: 'Escanear el código del Asistente al llegar',
    ayuda: 'Sirve para confirmar que quien se presenta es quien tenía que venir. Lo usa quien está en la casa.',
    de_fabrica: true,
    interruptor: 'familia_verifica_con_codigo',
  },
  {
    clave: 'circulo_califica_al_asistente',
    descripcion: 'Calificar al Asistente',
    ayuda: 'Poner estrellas y un comentario. Viene negada porque calificar al trabajador es un acto del titular, no de quien mira.',
    de_fabrica: false,
    interruptor: 'familia_califica_al_asistente',
  },
  {
    clave: 'circulo_pide_medicacion',
    descripcion: 'Pedir un cambio de medicación',
    ayuda: 'Cargar una indicación para que la Prestadora la acepte o la rechace. Viene negada por el mismo motivo.',
    de_fabrica: false,
    interruptor: 'familia_pide_medicacion',
  },
];

export const CLAVES_DEL_CIRCULO = CATALOGO_CIRCULO_FAMILIAR.map((cosa) => cosa.clave);

export function cosaDelCatalogo(clave) {
  return CATALOGO_CIRCULO_FAMILIAR.find((cosa) => cosa.clave === clave) ?? null;
}

// Lo que rige mientras nadie haya pedido ningún cambio: el círculo ve todo, y las dos acciones de
// escritura siguen apagadas. Es exactamente el comportamiento anterior a esta función.
export function accesosDeFabrica() {
  return Object.fromEntries(CATALOGO_CIRCULO_FAMILIAR.map((cosa) => [cosa.clave, cosa.de_fabrica]));
}

// El titular tiene todo. No se consulta ninguna fila porque no hay ninguna que consultar: lo suyo
// no se configura.
export function accesosDelTitular() {
  return Object.fromEntries(CATALOGO_CIRCULO_FAMILIAR.map((cosa) => [cosa.clave, true]));
}

// El techo: el titular puede quitar, nunca agregar.
//
// Si la Prestadora apagó el mapa para toda su aplicación, ninguna Familia lo puede encender para
// nadie. Este tope se aplica siempre, incluso al titular, y va después de todo lo demás: es la
// decisión de quien presta el servicio, y ninguna instrucción de una Familia la puede levantar.
function conElTopeDeLaPrestadora(accesos, visibilidad) {
  const dePrestadora = visibilidad ?? visibilidadDeFabrica();
  const topados = { ...accesos };

  for (const cosa of CATALOGO_CIRCULO_FAMILIAR) {
    if (cosa.interruptor && dePrestadora[cosa.interruptor] === false) {
      topados[cosa.clave] = false;
    }
  }

  return topados;
}

// Lo que la aplicación consulta en cada pedido: un objeto plano clave → permitido.
//
// Función pura, sin base de datos, para poder probarla sola
// (utils/__tests__/catalogoCirculoFamiliar.test.js).
//
// Una fila guardada de una clave que ya no está en el catálogo se ignora: la lista de arriba manda,
// y un acceso retirado del producto no debe reaparecer por una fila vieja.
export function accesosEfectivos({ esTitular, filasGuardadas, visibilidad }) {
  if (esTitular) {
    return conElTopeDeLaPrestadora(accesosDelTitular(), visibilidad);
  }

  const efectivos = accesosDeFabrica();
  for (const fila of filasGuardadas ?? []) {
    if (Object.hasOwn(efectivos, fila.clave)) {
      efectivos[fila.clave] = Boolean(fila.permitido);
    }
  }

  return conElTopeDeLaPrestadora(efectivos, visibilidad);
}

// El catálogo completo con lo decidido encima. Es lo que dibuja la pantalla del Panel: muestra
// siempre las once, tenga o no fila guardada cada una.
//
// `topado` es lo que le permite a la pantalla explicar por qué una casilla está apagada y no se
// puede tocar: no la negó el titular, la apagó la Prestadora para toda su aplicación. Sin ese
// dato, quien carga la instrucción ve una casilla muerta y no sabe por qué.
export function mezclarAccesosConCatalogo({ filasGuardadas, visibilidad }) {
  const porClave = new Map((filasGuardadas ?? []).map((fila) => [fila.clave, fila]));
  const dePrestadora = visibilidad ?? visibilidadDeFabrica();

  return CATALOGO_CIRCULO_FAMILIAR.map((cosa) => {
    const fila = porClave.get(cosa.clave);
    const topado = Boolean(cosa.interruptor) && dePrestadora[cosa.interruptor] === false;
    const decidido = fila ? Boolean(fila.permitido) : cosa.de_fabrica;

    return {
      clave: cosa.clave,
      descripcion: cosa.descripcion,
      ayuda: cosa.ayuda,
      de_fabrica: cosa.de_fabrica,
      interruptor: cosa.interruptor,
      // Para que la pantalla pueda distinguir «acá hubo una instrucción» de «todavía no hubo
      // ninguna y esto es lo que pasa mientras tanto».
      configurado: Boolean(fila),
      topado,
      permitido: topado ? false : decidido,
    };
  });
}

// Normaliza lo que llega del Panel antes de guardarlo. Devuelve una lista lista para escribir, con
// las once claves siempre presentes: guardar sólo las que vinieron dejaría filas ausentes, y una
// fila ausente para la base significa «no» —la función falla cerrado—, con lo cual un formulario
// incompleto negaría accesos que nadie negó.
//
// Lo que venga con una clave desconocida se descarta sin ruido, y lo topado por la Prestadora se
// guarda en falso: el documento que va a firmar el titular tiene que decir lo mismo que rige.
export function accesosParaGuardar({ pedido, visibilidad }) {
  const dePrestadora = visibilidad ?? visibilidadDeFabrica();

  return CATALOGO_CIRCULO_FAMILIAR.map((cosa) => {
    const topado = Boolean(cosa.interruptor) && dePrestadora[cosa.interruptor] === false;
    const pedido_ = Object.hasOwn(pedido ?? {}, cosa.clave) ? Boolean(pedido[cosa.clave]) : cosa.de_fabrica;

    return { clave: cosa.clave, permitido: topado ? false : pedido_ };
  });
}

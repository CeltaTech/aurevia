// Grilla de guardias: dos vistas espejadas y tres niveles de acercamiento.
// ============================================================================
//
// Qué hace y qué NO hace.
//
// Esta grilla solo dibuja. No consulta la base, no guarda nada y no sabe de sesiones: recibe
// las guardias ya filtradas y avisa hacia afuera cuando alguien abre, elige o mueve una. Por
// eso acá no hay estado de "cargando" ni de "error": esos dos los maneja la pantalla que la
// usa, que es la que pide los datos (regla 3 de CLAUDE.md §7 se cumple entre las dos: la
// pantalla pone cargando y error, la grilla pone vacío y listo).
//
// Los dos ejes.
//
// 1. La VISTA decide contra qué se agrupan las filas: por Asistente o por Paciente. Son la
//    misma información mirada desde dos lados — la misma guardia aparece en las dos, cambia
//    solamente contra quién se la agrupa.
// 2. El ACERCAMIENTO decide qué son las columnas: un día, siete días, o las 24 horas de un
//    día. La línea de tiempo existe para ver dos cosas que en una grilla por día no se ven:
//    las guardias que se pisan y los huecos de horario.
//
// Ningún color y ningún texto se decide acá: el color sale de `lib/semaforoGuardia.js` a
// través de `data-tono`, y todo lo que se lee sale de los archivos de traducción.

import { Fragment, useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { FILA_SIN_CUBRIR, filaDeGuardia } from '../../lib/cobertura';
import { SIN_PACIENTES, filasPorPaciente } from '../../lib/pacientesDeGuardia';
import { ordenPorUrgencia, situacionDeGuardia, tonoDeGuardia } from '../../lib/semaforoGuardia';
import { correrHora, finDeGuardia, hoyISO, inicioDeGuardia, sumarDias } from '../../lib/horarios';
import { con } from '../../lib/textos';

/** Las dos vistas y los tres acercamientos posibles. No hay más. */
const VISTAS = ['asistente', 'paciente'];
const ZOOMS = ['dia', 'semana', 'linea'];

/* La fila donde caen las guardias que todavía no tienen ningún Paciente es `SIN_PACIENTES`,
   traída de `lib/pacientesDeGuardia.js`. Es el espejo de `FILA_SIN_CUBRIR`, que hace lo mismo
   del lado de los Asistentes, y no se define acá una segunda marca para lo mismo: dos nombres
   para la misma fila terminan comparándose entre sí y no coincidiendo nunca. */

const HORAS_DEL_DIA = 24;
const MS_POR_HORA = 60 * 60 * 1000;

/* Tope de columnas de la vista de semana.
   No es "una semana": es el techo que aguanta la pantalla. La grilla dibuja el rango entero
   que le pasan —si la pantalla de arriba pide nueve días, muestra nueve— porque si recortara
   por su cuenta, una guardia contada arriba podría no aparecer abajo y el contador quedaría
   mintiendo. El tope está solo para que un rango absurdo por error no cuelgue el navegador. */
const DIAS_MAXIMOS = 14;

// La primera columna de la grilla es siempre el nombre de la fila, y la primera hilera es
// siempre la de encabezados. Las cuentas de posición de la línea de tiempo arrancan después
// de esas dos, y estos nombres evitan tener un +2 suelto que nadie sabe de dónde salió.
const COLUMNAS_ANTES_DE_LOS_DATOS = 1;
const HILERAS_ANTES_DE_LOS_DATOS = 1;

/** Los días que entran en la vista de semana: los del rango pedido, sin pasar el tope. */
function diasDelRango(desde, hasta) {
  // Sin `hasta`, una semana desde el primer día: es lo que espera quien usa la grilla suelta.
  const tope = hasta ?? sumarDias(desde, 6);
  const dias = [];
  for (let i = 0; i < DIAS_MAXIMOS; i += 1) {
    const dia = sumarDias(desde, i);
    // Las fechas 'AAAA-MM-DD' se comparan bien como texto: ordenan igual que como fechas.
    if (dia > tope) break;
    dias.push(dia);
  }
  return dias.length ? dias : [desde];
}

/**
 * Las filas de la grilla, según la vista elegida.
 *
 * La fila de los huecos —sin Asistente en una vista, sin Paciente en la otra— va siempre
 * arriba de todo. Se pone primera a propósito: es el trabajo pendiente de la Prestadora, no
 * un renglón más al final de la lista.
 */
function filasDeGuardias(guardias, vista, t) {
  const porPaciente = vista === 'paciente';
  const idHueco = porPaciente ? SIN_PACIENTES : FILA_SIN_CUBRIR;
  const nombreHueco = porPaciente ? t.guardias.fila_sin_paciente : t.guardias.fila_sin_cubrir;

  const porId = new Map();
  for (const g of guardias) {
    // Del lado del Asistente cada guardia entra en una fila sola. Del lado del Paciente puede
    // entrar en varias, porque un turno cubre a más de una persona: la misma guardia aparece
    // en la fila de cada una.
    const entradas = porPaciente
      ? (g.pacientes?.length ? g.pacientes : [{ id: SIN_PACIENTES, nombre: null }])
      : [{ id: filaDeGuardia(g), nombre: g.asistente_nombre }];

    for (const entrada of entradas) {
      if (porId.has(entrada.id)) continue;
      const hueco = entrada.id === idHueco;
      porId.set(entrada.id, {
        id: entrada.id,
        hueco,
        nombre: hueco ? nombreHueco : entrada.nombre ?? '',
      });
    }
  }

  const conNombre = Array.from(porId.values())
    .filter((f) => !f.hueco)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const hueco = porId.get(idHueco);
  return hueco ? [hueco, ...conNombre] : conNombre;
}

/**
 * A qué filas pertenece una guardia, según la vista. Siempre devuelve una lista: por Asistente
 * tiene un solo elemento, por Paciente tiene tantos como personas cubra el turno.
 */
function filasDeGuardiaSegunVista(guardia, vista) {
  if (vista !== 'paciente') return [filaDeGuardia(guardia)];
  return filasPorPaciente(guardia);
}

/**
 * De qué hora a qué hora ocupa una guardia dentro de un día, para la línea de tiempo.
 *
 * Se calcula con `inicioDeGuardia` y `finDeGuardia` y nunca con `hora_fin` leída literal: la
 * guardia de noche empieza 22:00 y termina 06:00, y leída literal parece durar menos ocho
 * horas. Cuando cruza la medianoche, la barra se corta al final del día —hasta la línea 24—
 * y se avisa aparte que sigue.
 */
function tramoDelDia(guardia, dia) {
  const arranqueDelDia = new Date(`${dia}T00:00:00`).getTime();
  const desdeHoras = (inicioDeGuardia(guardia).getTime() - arranqueDelDia) / MS_POR_HORA;
  const hastaHoras = (finDeGuardia(guardia).getTime() - arranqueDelDia) / MS_POR_HORA;

  const primeraHora = Math.max(0, Math.min(HORAS_DEL_DIA - 1, Math.floor(desdeHoras)));
  const lineaFinal = Math.min(HORAS_DEL_DIA, Math.max(primeraHora + 1, Math.ceil(hastaHoras)));
  return { primeraHora, lineaFinal, cruzaLaMedianoche: hastaHoras > HORAS_DEL_DIA };
}

/**
 * Reparte las guardias de una fila en carriles para que dos que se pisan no queden dibujadas
 * una encima de la otra. Si quedaran superpuestas, la vista que existe justamente para ver
 * superposiciones sería la única que no las deja ver.
 */
function carrilesDeLaFila(guardiasDeLaFila) {
  const ordenadas = [...guardiasDeLaFila].sort((a, b) => inicioDeGuardia(a) - inicioDeGuardia(b));
  const finDeCadaCarril = [];
  const ubicadas = [];

  for (const g of ordenadas) {
    const arranca = inicioDeGuardia(g).getTime();
    const termina = finDeGuardia(g).getTime();
    // El primer carril que ya se liberó. Tocarse por el borde no es pisarse: una que termina
    // a las 14 y otra que empieza a las 14 van en el mismo carril.
    let carril = finDeCadaCarril.findIndex((fin) => fin <= arranca);
    if (carril === -1) {
      finDeCadaCarril.push(termina);
      carril = finDeCadaCarril.length - 1;
    } else {
      finDeCadaCarril[carril] = termina;
    }
    ubicadas.push({ guardia: g, carril });
  }

  return { ubicadas, cantidadDeCarriles: Math.max(1, finDeCadaCarril.length) };
}

export function GrillaGuardias({
  guardias = [],          // ya vienen filtradas por la pantalla de arriba
  desde,
  hasta,                  // rango 'AAAA-MM-DD'
  vista,
  onVista,                // 'asistente' | 'paciente'
  zoom,
  onZoom,                 // 'dia' | 'semana' | 'linea'
  diaElegido,
  onDiaElegido,           // 'AAAA-MM-DD', lo usan 'dia' y 'linea'
  ctx,                    // contexto del semáforo: { ahora, umbrales }
  seleccionadas,          // Set de ids
  onAlternarSeleccion,
  onAbrir,
  onMover,
}) {
  const { t, locale } = useLocale();

  // La grilla funciona con o sin quien la controle desde afuera. Si `vista` y `zoom` llegan,
  // manda la pantalla de arriba; si no llegan, la grilla se acuerda sola de lo que eligió la
  // persona. Así una prop que falta no rompe nada ni deja los interruptores muertos.
  const [vistaLocal, setVistaLocal] = useState('asistente');
  const [zoomLocal, setZoomLocal] = useState('semana');
  const [diaLocal, setDiaLocal] = useState(null);

  const vistaActiva = VISTAS.includes(vista) ? vista : vistaLocal;
  const zoomActivo = ZOOMS.includes(zoom) ? zoom : zoomLocal;

  const primerDia = desde ?? hoyISO();
  const dias = useMemo(() => diasDelRango(primerDia, hasta), [primerDia, hasta]);
  const diaActivo = diaElegido ?? diaLocal ?? dias[0];

  const contexto = useMemo(() => ctx ?? {}, [ctx]);
  const elegidas = seleccionadas ?? new Set();

  // Qué días se ven: la semana entera, o uno solo en los otros dos acercamientos.
  const diasVisibles = zoomActivo === 'semana' ? dias : [diaActivo];
  const horas = useMemo(() => Array.from({ length: HORAS_DEL_DIA }, (_, h) => h), []);

  const visibles = useMemo(
    () => guardias.filter((g) => diasVisibles.includes(g.fecha)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guardias, diasVisibles.join('|')],
  );

  const filas = useMemo(() => filasDeGuardias(visibles, vistaActiva, t), [visibles, vistaActiva, t]);

  // Las guardias de cada cruce fila × día, ya ordenadas por urgencia: lo que pide acción
  // arriba, y dentro de cada grupo la que empieza más temprano primero.
  const porCelda = useMemo(() => {
    const mapa = new Map();
    for (const g of visibles) {
      // Una guardia que cubre a tres personas se dibuja en las tres filas. Es el mismo turno
      // mirado desde tres lugares, no tres turnos.
      for (const idFila of filasDeGuardiaSegunVista(g, vistaActiva)) {
        const clave = `${idFila}__${g.fecha}`;
        if (!mapa.has(clave)) mapa.set(clave, []);
        mapa.get(clave).push(g);
      }
    }
    for (const lista of mapa.values()) {
      lista.sort(
        (a, b) =>
          ordenPorUrgencia(a, contexto) - ordenPorUrgencia(b, contexto) ||
          inicioDeGuardia(a) - inicioDeGuardia(b),
      );
    }
    return mapa;
  }, [visibles, vistaActiva, contexto]);

  // La línea de tiempo necesita saber, además, en qué hilera de la grilla arranca cada fila y
  // cuántos carriles ocupa. Se calcula una vez acá y no en medio del dibujo.
  const filasDeLinea = useMemo(() => {
    let hilera = HILERAS_ANTES_DE_LOS_DATOS + 1;
    return filas.map((fila) => {
      const suyas = visibles.filter((g) => filasDeGuardiaSegunVista(g, vistaActiva).includes(fila.id));
      const { ubicadas, cantidadDeCarriles } = carrilesDeLaFila(suyas);
      const desdeHilera = hilera;
      hilera += cantidadDeCarriles;
      return { fila, ubicadas, cantidadDeCarriles, desdeHilera };
    });
  }, [filas, visibles, vistaActiva]);

  // Qué celda está iluminada mientras se arrastra algo por encima. Sin esta marca, arrastrar
  // es adivinar dónde va a caer la guardia.
  const [celdaDestino, setCeldaDestino] = useState(null);

  function cambiarVista(v) {
    setVistaLocal(v);
    onVista?.(v);
  }

  function cambiarZoom(z) {
    setZoomLocal(z);
    onZoom?.(z);
    // Día y Línea de tiempo miran un día solo. Si nadie eligió cuál, se avisa hacia afuera
    // cuál se está mostrando, para que la pantalla de arriba no quede pensando en otro.
    if ((z === 'dia' || z === 'linea') && !diaElegido) {
      setDiaLocal(diaActivo);
      onDiaElegido?.(diaActivo);
    }
  }

  /* Moverse de día en Día y en Línea de tiempo.
     Se guarda acá adentro Y se avisa hacia afuera: adentro para que la grilla funcione aunque
     la pantalla de arriba no escuche, y afuera para que la que sí escucha —el Estado actual— pida
     a la base las guardias del día nuevo si le hicieran falta. Nunca sale del rango pedido:
     un día del que no se trajeron guardias se vería vacío y parecería que no hay ninguna. */
  function cambiarDia(nuevo) {
    const primero = dias[0];
    const ultimo = dias[dias.length - 1];
    if (nuevo < primero || nuevo > ultimo) return;
    setDiaLocal(nuevo);
    onDiaElegido?.(nuevo);
  }

  // ---------------------------------------------------------------------------------------
  // Arrastrar y soltar: qué cambia al soltar depende del acercamiento, y es a propósito.
  //
  // En Día y en Semana, soltar cambia la fila y la fecha, pero NO la hora. Quien arrastra una
  // guardia de un Asistente a otro está reasignándola, no reprogramándola; si el horario se
  // moviera solo, sería una sorpresa desagradable — y una que se descubre tarde, cuando
  // alguien se presenta a una hora que nunca eligió.
  //
  // En la Línea de tiempo sí cambia la hora, porque ahí la posición horizontal *es* la hora:
  // es lo único que esa vista significa. Soltar una guardia tres columnas a la derecha y que
  // no se mueva de horario sería la sorpresa inversa. La duración se conserva: si duraba ocho
  // horas, sigue durando ocho horas, corrida.
  // ---------------------------------------------------------------------------------------
  function handleDrop(e, fila, columna) {
    e.preventDefault();
    setCeldaDestino(null);
    // Las filas de huecos no son destinos: son la falta de un dato, no un lugar donde poner
    // algo. Soltar ahí sería "sacarle el Asistente" o "sacarle el Paciente" a una guardia que
    // ya lo tiene, que es otra operación y tiene su propia pantalla.
    if (fila.hueco) return;

    const guardiaId = e.dataTransfer.getData('guardiaId');
    if (!guardiaId) return;
    const guardia = guardias.find((g) => String(g.id) === String(guardiaId));
    if (!guardia) return;

    // De qué fila se la sacó. En la vista por Paciente hace toda la diferencia: un turno que
    // cubre a dos personas está dibujado en dos filas, y sin saber de cuál se lo arrastró no
    // hay forma de saber a quién se quiso cambiar. Sin este dato, la pantalla de arriba
    // terminaría cambiando al Paciente equivocado.
    const movimiento = {
      guardiaId,
      fila: fila.id,
      filaOrigen: e.dataTransfer.getData('filaOrigen') || null,
      fecha: columna.fecha,
      vista: vistaActiva,
    };

    if (zoomActivo === 'linea') {
      // Se corren las dos horas por la misma cantidad de minutos: así la duración queda igual
      // y la guardia que cruza la medianoche sigue cruzándola bien. `correrHora` da la vuelta
      // al día cuando hace falta.
      const minutos = (columna.hora - inicioDeGuardia(guardia).getHours()) * 60;
      movimiento.horaInicio = correrHora(guardia.hora_inicio, minutos);
      // El fin viaja con el inicio. Va aparte del contrato mínimo porque la duración original
      // solo la sabe la grilla, y sin esto la pantalla de arriba tendría que recalcularla.
      movimiento.horaFin = correrHora(guardia.hora_fin, minutos);
    }

    onMover?.(movimiento);
  }

  function marcarDestino(e, fila, clave) {
    if (fila.hueco) return;
    e.preventDefault();
    setCeldaDestino(clave);
  }

  function abrirOElegir(e, guardia) {
    // Clic con Ctrl (o Cmd en Mac) suma o saca de la selección; el clic pelado abre.
    if (e.ctrlKey || e.metaKey) {
      onAlternarSeleccion?.(guardia);
      return;
    }
    onAbrir?.(guardia);
  }

  function teclaEnChip(e, guardia) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onAbrir?.(guardia);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      onAlternarSeleccion?.(guardia);
    }
  }

  /**
   * Un chip de guardia. `estilo` solo llega en la línea de tiempo y solo lleva medidas de
   * posición dentro de la grilla (qué columnas ocupa y en qué carril va): son medidas que
   * dependen del horario de cada guardia, no decisiones de diseño.
   */
  function chipDeGuardia(guardia, estilo, filaOrigen) {
    const elegida = typeof elegidas.has === 'function' && elegidas.has(guardia.id);
    const espejo = vistaActiva === 'paciente' ? guardia.asistente_nombre : guardia.paciente_nombre;
    // Cuántas personas cubre la guardia. Se avisa solo cuando son más de una, y sobre todo en
    // la vista por Paciente: ahí la misma guardia está dibujada en varias filas y sin este
    // aviso parecen guardias distintas. Es una sola guardia, no dos.
    const cuantos = guardia.pacientes?.length ?? 0;
    // La palabra del chip es la SITUACIÓN, no la columna `estado` de la base. Dos guardias
    // pueden estar las dos como 'programada' y una estar en curso y la otra sin marca de
    // llegada: leer "Programada" en las dos escondería justo lo que hay que ver. El color
    // solo no alcanza —hay quien no lo distingue, y en una captura en blanco y negro no
    // existe—, así que la palabra y el color dicen siempre lo mismo.
    const textoEstado = t.guardias.situacion[situacionDeGuardia(guardia, contexto)];
    const horario = `${guardia.hora_inicio}–${guardia.hora_fin}`;
    const cruza = zoomActivo === 'linea' && tramoDelDia(guardia, diaActivo).cruzaLaMedianoche;

    return (
      <div
        key={guardia.id}
        className={`grilla-chip${elegida ? ' grilla-chip-elegida' : ''}`}
        data-tono={tonoDeGuardia(guardia, contexto)}
        style={estilo}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('guardiaId', guardia.id);
          if (filaOrigen) e.dataTransfer.setData('filaOrigen', filaOrigen);
        }}
        onClick={(e) => abrirOElegir(e, guardia)}
        onKeyDown={(e) => teclaEnChip(e, guardia)}
        role="button"
        tabIndex={0}
        aria-label={[t.guardias.elegir_guardia, espejo, guardia.fecha, horario, textoEstado]
          .filter(Boolean)
          .join(' · ')}
      >
        <div className="grilla-chip-cabecera">
          <span className="grilla-chip-horario">{horario}</span>
          {textoEstado && <span className="grilla-chip-detalle">{textoEstado}</span>}
        </div>
        {espejo && <div className="grilla-chip-detalle">{espejo}</div>}
        {cuantos > 1 && (
          <div className="grilla-chip-nota">{con(t.guardias.cubre_a_varios, { n: cuantos })}</div>
        )}
        {/* La guardia que cruza la medianoche se corta al final del día. Para que no parezca
            que termina a las 24, se muestra su hora de fin real. No lleva ninguna palabra
            porque todavía no existe ese texto traducido, y un texto a mano se vería en un
            solo idioma. */}
        {cruza && <div className="grilla-chip-nota">{guardia.hora_fin}</div>}
      </div>
    );
  }

  const columnas =
    zoomActivo === 'linea'
      ? `12rem repeat(${HORAS_DEL_DIA}, minmax(2.5rem, 1fr))`
      : `12rem repeat(${diasVisibles.length}, minmax(9rem, 1fr))`;

  const ayuda = [t.guardias.vista_ayuda, t.guardias[`zoom_ayuda_${zoomActivo}`]]
    .filter(Boolean)
    .join(' · ');

  const controles = (
    <>
      <div className="grilla-controles">
        <div className="grilla-interruptor">
          <button type="button" aria-pressed={vistaActiva === 'asistente'} onClick={() => cambiarVista('asistente')}>
            {t.guardias.vista_por_asistente}
          </button>
          <button type="button" aria-pressed={vistaActiva === 'paciente'} onClick={() => cambiarVista('paciente')}>
            {t.guardias.vista_por_paciente}
          </button>
        </div>

        <div className="grilla-interruptor">
          {ZOOMS.map((z) => (
            <button key={z} type="button" aria-pressed={zoomActivo === z} onClick={() => cambiarZoom(z)}>
              {t.guardias[`zoom_${z}`]}
            </button>
          ))}
        </div>

        {/* Día y Línea de tiempo miran un día solo, así que necesitan cómo cambiarlo. En
            Semana no aparece: ahí se ven todos los días del rango a la vez y un botón de
            "día siguiente" no querría decir nada. Nunca sale del rango que pidió la pantalla
            de arriba —el botón se apaga en la punta— para que no se pueda llegar a un día del
            que no se trajeron las guardias y parezca que no hay ninguna. */}
        {zoomActivo !== 'semana' && (
          <div className="grilla-dia">
            <div className="grilla-interruptor">
              <button
                type="button"
                onClick={() => cambiarDia(sumarDias(diaActivo, -1))}
                disabled={diaActivo <= dias[0]}
              >
                ‹ {t.guardias.dia_anterior}
              </button>
              <button
                type="button"
                onClick={() => cambiarDia(hoyISO())}
                disabled={diaActivo === hoyISO() || hoyISO() < dias[0] || hoyISO() > dias[dias.length - 1]}
              >
                {t.guardias.dia_hoy}
              </button>
              <button
                type="button"
                onClick={() => cambiarDia(sumarDias(diaActivo, 1))}
                disabled={diaActivo >= dias[dias.length - 1]}
              >
                {t.guardias.dia_siguiente} ›
              </button>
            </div>
            {/* Qué día se está mirando, escrito. En Línea de tiempo las columnas son horas y
                la fecha no aparece en ningún otro lado: sin esto se podrían estar mirando las
                guardias de ayer creyendo que son las de hoy. */}
            <span className="grilla-dia-actual">
              {new Date(`${diaActivo}T00:00:00`).toLocaleDateString(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </span>
          </div>
        )}
      </div>
      <p className="grilla-ayuda">{ayuda}</p>
    </>
  );

  // Vacío: no hay ninguna guardia que dibujar. Los interruptores se dejan visibles a
  // propósito — si desaparecieran, no habría forma de mirar el mismo rango desde otro lado.
  if (filas.length === 0) {
    return (
      <>
        {controles}
        <p className="estado-vacio">{t.guardias.sin_guardias_rango}</p>
      </>
    );
  }

  return (
    <>
      {controles}
      <div className="grilla-wrap">
        <div className="grilla" style={{ gridTemplateColumns: columnas }}>
          <div className="grilla-cabecera grilla-esquina" />

          {zoomActivo === 'linea'
            ? horas.map((h) => (
                <div key={h} className="grilla-cabecera">
                  {con(t.guardias.hora_columna, { hora: String(h).padStart(2, '0') })}
                </div>
              ))
            : diasVisibles.map((fecha) => (
                <div key={fecha} className="grilla-cabecera">
                  {new Date(`${fecha}T00:00:00`).toLocaleDateString(locale, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </div>
              ))}

          {zoomActivo === 'linea'
            ? filasDeLinea.map(({ fila, ubicadas, cantidadDeCarriles, desdeHilera }) => (
                <Fragment key={fila.id}>
                  <div
                    className={`grilla-fila-titulo${fila.hueco ? ' grilla-fila-titulo-hueco' : ''}`}
                    style={{ gridColumn: COLUMNAS_ANTES_DE_LOS_DATOS, gridRow: `${desdeHilera} / span ${cantidadDeCarriles}` }}
                  >
                    {fila.nombre}
                  </div>

                  {/* Una celda por hora, alta como todos los carriles de la fila. Son los
                      lugares donde se puede soltar; las guardias se dibujan encima. */}
                  {horas.map((h) => {
                    const clave = `${fila.id}__${h}`;
                    return (
                      <div
                        key={clave}
                        className={`grilla-celda${celdaDestino === clave ? ' grilla-celda-destino' : ''}`}
                        style={{
                          gridColumn: COLUMNAS_ANTES_DE_LOS_DATOS + 1 + h,
                          gridRow: `${desdeHilera} / span ${cantidadDeCarriles}`,
                        }}
                        onDragOver={(e) => marcarDestino(e, fila, clave)}
                        onDragLeave={() => setCeldaDestino((actual) => (actual === clave ? null : actual))}
                        onDrop={(e) => handleDrop(e, fila, { fecha: diaActivo, hora: h })}
                      />
                    );
                  })}

                  {ubicadas.map(({ guardia, carril }) => {
                    const { primeraHora, lineaFinal } = tramoDelDia(guardia, diaActivo);
                    return chipDeGuardia(
                      guardia,
                      {
                        gridColumn: `${COLUMNAS_ANTES_DE_LOS_DATOS + 1 + primeraHora} / ${COLUMNAS_ANTES_DE_LOS_DATOS + 1 + lineaFinal}`,
                        gridRow: desdeHilera + carril,
                      },
                      fila.id,
                    );
                  })}
                </Fragment>
              ))
            : filas.map((fila) => (
                <Fragment key={fila.id}>
                  <div className={`grilla-fila-titulo${fila.hueco ? ' grilla-fila-titulo-hueco' : ''}`}>
                    {fila.nombre}
                  </div>
                  {diasVisibles.map((fecha) => {
                    const clave = `${fila.id}__${fecha}`;
                    return (
                      <div
                        key={clave}
                        className={`grilla-celda${celdaDestino === clave ? ' grilla-celda-destino' : ''}`}
                        onDragOver={(e) => marcarDestino(e, fila, clave)}
                        onDragLeave={() => setCeldaDestino((actual) => (actual === clave ? null : actual))}
                        onDrop={(e) => handleDrop(e, fila, { fecha })}
                      >
                        {(porCelda.get(clave) ?? []).map((g) => chipDeGuardia(g, undefined, fila.id))}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
        </div>
      </div>
    </>
  );
}

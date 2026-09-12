/* Qué renglones lleva la factura de una Familia en un período.
   ============================================================

   QUÉ RESUELVE. La factura se armaba sumando el precio de todas las prestaciones `vigente` del
   Paciente, sin mirar ni una fecha y sin consultar nunca los paquetes. De ahí salían dos facturas
   equivocadas, y las dos en contra de alguien:

     * **Se cobraba lo que ya no corría, y lo que todavía no había empezado.** Una prestación que
       terminó en marzo seguía apareciendo en la factura de agosto, porque `estado` dice si el
       acuerdo sigue en pie y las fechas dicen cuándo corre. Son dos cosas distintas y hacían falta
       las dos.
     * **Un paquete se cobraba renglón por renglón.** Acordar tres prestaciones por un precio único
       es justamente pactar menos que la suma: cobrando cada una por separado, la Familia paga de
       más todos los meses y el descuento que se le prometió no existe.

   CÓMO SE MIRA LA VIGENCIA. Una prestación entra en el período si su vigencia se superpone con el
   mes, aunque sea un día: empezó antes de que el mes termine y no terminó antes de que el mes
   empiece. `vigente_hasta` vacío quiere decir que sigue corriendo.

   Y ENTRA POR EL PRECIO ACORDADO, ENTERO. Lo que se cobra es el precio del acuerdo, no una parte
   proporcional a los días: partirlo obligaría a decidir sobre cuántos días se parte, y eso lo
   acuerda cada Prestadora con cada Familia, no este archivo.

   CÓMO ENTRA UN PAQUETE. Las prestaciones que están adentro de un paquete vigente no ponen su
   precio: lo pone el paquete, una vez, con el precio pactado. Alcanza con que una de ellas corra en
   el período para que el paquete entre; si no corre ninguna, el paquete no entra.

   Y UN PAQUETE DADO DE BAJA NO TAPA NADA. Sus prestaciones vuelven a cobrarse por separado, que es
   lo que queda cuando el acuerdo del precio único se terminó. */

/** El último día del mes de un período `2026-08-01`. */
export function ultimoDiaDelPeriodo(periodo) {
  const anio = Number(String(periodo).slice(0, 4));
  const mes = Number(String(periodo).slice(5, 7));
  // El día cero del mes siguiente es el último del mes pedido, y así no hay ninguna lista de
  // cuántos días tiene cada uno ni ninguna excepción de año bisiesto.
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
}

/** Si el acuerdo de esta prestación corre en algún día del período. */
export function correEnElPeriodo(prestacion, periodo) {
  const desde = String(prestacion.vigente_desde ?? '').slice(0, 10);
  const hasta = prestacion.vigente_hasta ? String(prestacion.vigente_hasta).slice(0, 10) : null;
  if (!desde) return false;
  return desde <= ultimoDiaDelPeriodo(periodo) && (hasta === null || hasta >= periodo);
}

/**
 * Los renglones de la factura de una Familia en un período.
 *
 * @param {object} argumentos
 * @param {string} argumentos.periodo        El primer día del mes, `2026-08-01`.
 * @param {Map<string, string>} argumentos.nombresDePacientes
 * @param {Array} argumentos.prestaciones    Las del acuerdo, ya acotadas a esta Familia.
 * @param {Array} argumentos.paquetes        Los paquetes de esos Pacientes.
 * @param {Array} argumentos.itemsDePaquete  Qué prestación está en qué paquete.
 * @returns {Array<{paciente_id: string, servicio_id: string|null, descripcion: string, monto: number}>}
 */
export function armarLosRenglonesDeLaFactura({
  periodo,
  nombresDePacientes,
  prestaciones,
  paquetes,
  itemsDePaquete,
}) {
  const queCorren = (prestaciones ?? []).filter((p) => correEnElPeriodo(p, periodo));

  const paquetesVigentes = new Map(
    (paquetes ?? []).filter((pq) => pq.estado === 'vigente').map((pq) => [pq.id, pq])
  );
  const paqueteDeLaPrestacion = new Map();
  for (const item of itemsDePaquete ?? []) {
    if (paquetesVigentes.has(item.paquete_id)) paqueteDeLaPrestacion.set(item.prestacion_id, item.paquete_id);
  }

  const renglones = [];
  /** Qué prestaciones que corren aporta cada paquete, para nombrarlo y para saber si entra. */
  const loQueCubreCadaPaquete = new Map();

  for (const prestacion of queCorren) {
    const paqueteId = paqueteDeLaPrestacion.get(prestacion.id);
    if (paqueteId !== undefined) {
      if (!loQueCubreCadaPaquete.has(paqueteId)) loQueCubreCadaPaquete.set(paqueteId, []);
      loQueCubreCadaPaquete.get(paqueteId).push(prestacion);
      continue;
    }
    renglones.push({
      paciente_id: prestacion.paciente_id,
      servicio_id: prestacion.servicio_id ?? null,
      descripcion: `${prestacion.tipo_servicio} — ${nombresDePacientes.get(prestacion.paciente_id) ?? ''}`.trim(),
      monto: Number(prestacion.precio_final),
    });
  }

  for (const [paqueteId, cubiertas] of loQueCubreCadaPaquete) {
    const paquete = paquetesVigentes.get(paqueteId);
    renglones.push({
      paciente_id: paquete.paciente_id,
      // Un paquete puede juntar prestaciones de Servicios distintos, así que el renglón no puede
      // decir que es de uno solo.
      servicio_id: null,
      descripcion: `${nombreDelPaquete(paquete, cubiertas)} — ${nombresDePacientes.get(paquete.paciente_id) ?? ''}`.trim(),
      monto: Number(paquete.precio_paquete),
    });
  }

  return renglones;
}

/** Cómo se nombra un paquete en la factura. El nombre es opcional al armarlo, y el que no lo tiene
 *  se dice por lo que incluye, que es lo que la Familia necesita reconocer. */
function nombreDelPaquete(paquete, cubiertas) {
  const propio = String(paquete.nombre ?? '').trim();
  if (propio) return propio;
  return [...new Set(cubiertas.map((p) => p.tipo_servicio))].join(', ');
}

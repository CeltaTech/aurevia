import { Router } from 'express';
import { requiereRolFamilia } from '../middleware/requiereRolFamilia.js';
import { supabase } from '../db/connection.js';
import { resolverVitalesHabilitados } from '../utils/vitalesReferencia.js';
import { generarTokenQrCobro } from '../utils/qrCobroEfectivo.js';
import { marcaDeLaPrestadora } from '../utils/marcaPrestadora.js';
import { visibilidadDelPedido, exigeVisible } from '../utils/visibilidadPrestadora.js';
import { columnasSegunVisibilidad } from '../utils/catalogoVisibilidad.js';
import { tipoDelAsistente, tipoConSusTareas } from '../utils/tareasDelTipo.js';
import { esFechaISO, semanaQueContiene } from '../utils/fechas.js';
import { pacientesConDomicilioDeHoy } from '../utils/domicilioDelDia.js';
import { guardarSuscripcionPush } from '../utils/suscripcionesPush.js';
import { accesosDelPedido, exigeDelCirculo, soloElTitular, visibilidadDeLaPersona } from '../utils/accesosDelCirculo.js';
import { instruccionPendiente, pedirCodigo, confirmarConCodigo } from '../utils/instruccionesCirculo.js';
import { codigoParaMostrar } from '../utils/comprobacionDePresencia.js';
import { responderError, ErrorConMotivo } from '../utils/errorConMotivo.js';
import { topeDePedidos } from '../middleware/topeDePedidos.js';
import { llegadaEstimadaDeGuardia } from '../utils/estimarLlegadaDeGuardia.js';
import { darDeBajaElAcceso } from '../utils/bajaDelAcceso.js';

export const appFamiliasRouter = Router();

// pacientes.medicacion_habitual queda deprecado: la medicación vigente se deriva de
// indicaciones_medicacion (estado='aceptada'), nunca de este JSONB suelto.
//
// Las patologías y las coordenadas del domicilio solo se piden si la Prestadora las tiene
// prendidas: lo que no se puede ver, no se manda. `nivel_complejidad` no se pide —ninguna
// pantalla de la Familia lo muestra— y sería una etiqueta clínica de más viajando al teléfono.
//
// RECIBE EL PEDIDO ENTERO Y NO LA VISIBILIDAD SUELTA. Acá hay que saber dos cosas —qué muestra la
// Prestadora y qué le dieron a esta persona— y las dos ya vienen contestadas y guardadas en el
// pedido. Pasándolas por parámetro, una ruta nueva que se olvide de una le mandaría a alguien la
// ficha que el titular le negó, y nadie se enteraría.
async function pacienteDeLaFamilia(pacienteId, req) {
  const usuarioFamilia = req.usuarioFamilia;
  const visibilidad = await visibilidadDeLaPersona(req);
  const accesos = await accesosDelPedido(req);

  // A quien no le dieron la ficha se le contesta que el Paciente existe y nada más: sin domicilio,
  // sin patologías y sin coordenadas. No se lo saca de la lista —dejaría esa aplicación vacía y sin
  // explicación, y quien tenga la agenda o los reportes los sigue necesitando—, y los datos de la
  // persona cuidada directamente no salen de la base.
  const columnas = accesos.circulo_ficha_del_paciente
    ? columnasSegunVisibilidad([
      'id',
      'nombre',
      'domicilio',
      ['lat', 'familia_ubicacion_en_vivo'],
      ['lng', 'familia_ubicacion_en_vivo'],
      ['patologias', 'familia_patologias_del_paciente'],
      'familia_id',
      'prestadora_id',
    ], visibilidad)
    : 'id, nombre, familia_id, prestadora_id';

  const { data } = await supabase
    .from('pacientes')
    .select(columnas)
    .eq('id', pacienteId)
    .eq('familia_id', usuarioFamilia.familiaId)
    .eq('prestadora_id', usuarioFamilia.prestadoraId)
    .maybeSingle();
  if (!data) return data;

  // La dirección que se muestra es la de hoy, no la de la ficha, y la decide la base. Va acá
  // adentro y no en cada pantalla para que ninguna se olvide: todas las pantallas de la Familia
  // que muestran un Paciente pasan por esta función.
  const [conDomicilio] = await pacientesConDomicilioDeHoy([data]);
  return conDomicilio;
}

// ============================================================================
// Mi Perfil
// ============================================================================

appFamiliasRouter.get('/perfil', requiereRolFamilia, async (req, res) => {
  // Identidad (nombre/teléfono) vive en `usuarios` — igual que el resto de los roles de
  // login propio (asistentes es la excepción: ahí la tabla de negocio y la de login son la
  // misma). `familias` solo guarda el plan; el email lo tiene Supabase Auth, no una columna.
  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select('nombre, telefono')
    .eq('id', req.usuarioFamilia.id)
    .single();
  if (error || !usuario) {
    return res.status(404).json({ error: 'Perfil no encontrado' });
  }

  // La marca va acá y no en una dirección aparte porque el encabezado la
  // necesita ni bien la persona entra, que es exactamente cuando la aplicación
  // ya pide el perfil. Dos pedidos para dibujar una misma pantalla es un
  // pedido de más.
  const marca = await marcaDeLaPrestadora(req.usuarioFamilia.prestadoraId);

  // Qué eligió mostrar esta Prestadora, por el mismo motivo que la marca: la aplicación lo
  // necesita para dibujar el menú y las pantallas desde el primer momento, y ya está pidiendo
  // el perfil. Es una lista de qué dibujar, no un permiso: el candado de verdad está en cada
  // consulta del motor, que directamente no manda lo apagado.
  const visibilidad = await visibilidadDelPedido(req);

  // Qué le dejaron ver a esta persona, por el mismo motivo que los dos de arriba: la aplicación
  // lo necesita para dibujar el menú. Igual que la visibilidad, es una lista de qué dibujar y no
  // un permiso — el candado está en cada ruta, que directamente no contesta lo que no le dieron.
  const accesos = await accesosDelPedido(req);

  // El plan contratado es una condición comercial, no un dato del cuidado: va con el resto de
  // lo que la Prestadora decide mostrar sobre el dinero. Hay Prestadoras que cobran por fuera
  // de la aplicación y no quieren que el plan aparezca en el teléfono de la Familia. Apagado
  // el interruptor, ni siquiera se le pregunta a la base cuál es. Y lo mismo vale persona por
  // persona: quien acompaña el cuidado no siempre es quien paga.
  let plan = null;
  if (visibilidad.familia_pagos_y_suscripcion && accesos.circulo_dinero) {
    const { data: familia } = await supabase
      .from('familias')
      .select('plan')
      .eq('id', req.usuarioFamilia.familiaId)
      .maybeSingle();
    plan = familia?.plan ?? null;
  }

  // Y si hay una instrucción esperando su firma, se la ofrece. Sólo al titular: la instrucción
  // dice qué se le dio y qué se le negó a cada uno del círculo, y eso es del titular.
  const pendiente = req.usuarioFamilia.esTitular
    ? await instruccionPendiente(req.usuarioFamilia.familiaId)
    : null;

  res.json({
    perfil: {
      ...usuario,
      plan,
      esTitular: req.usuarioFamilia.esTitular,
    },
    marca,
    visibilidad,
    accesos,
    instruccionPendiente: pendiente,
  });
});

// ============================================================================
// La instrucción sobre los accesos del círculo, del lado del titular
//
// Acá el titular no configura nada: lee lo que pidió y lo confirma. Quién entra al círculo y qué
// ve cada uno lo carga la Prestadora, como siempre. Esta es la firma, y nada más.
//
// Y firma esta hoja y ninguna otra. Careonys no es un sistema para firmar documentos.
// ============================================================================

appFamiliasRouter.get('/instruccion-pendiente', requiereRolFamilia, soloElTitular, async (req, res) => {
  res.json({ instruccion: await instruccionPendiente(req.usuarioFamilia.familiaId) });
});

// Pide el código que llega al teléfono. La persona ya entró con su clave: el código es el segundo
// paso, no el único — juntos son la firma que se aprobó.
//
// LAS DOS RUTAS LLEVAN TOPE DE PEDIDOS POR MINUTO. Acá quien prueba los códigos es la misma
// persona que los pide, así que sin tope se piden y se prueban sin freno. Cada una cuenta por
// separado: gastar los pedidos de una no tiene que dejar sin la otra.
appFamiliasRouter.post('/instruccion/:instruccionId/codigo', requiereRolFamilia, soloElTitular, topeDePedidos({ nombre: 'instruccion_pedir_codigo' }), async (req, res) => {
  try {
    const { enviadoA } = await pedirCodigo({
      instruccionId: req.params.instruccionId,
      familiaId: req.usuarioFamilia.familiaId,
    });
    res.json({ ok: true, enviadoA });
  } catch (error) {
    responderError(res, error);
  }
});

appFamiliasRouter.post('/instruccion/:instruccionId/confirmar', requiereRolFamilia, soloElTitular, topeDePedidos({ nombre: 'instruccion_confirmar' }), async (req, res) => {
  const resultado = await confirmarConCodigo({
    instruccionId: req.params.instruccionId,
    familiaId: req.usuarioFamilia.familiaId,
    codigo: req.body?.codigo,
    // Con qué aparato firmó, para poder reconstruir el acto. Nunca la dirección de red ni ningún
    // otro dato que no haga falta para eso (CLAUDE.md §6).
    desde: req.headers['user-agent']?.slice(0, 300) ?? null,
  });

  if (!resultado.ok) {
    return res.status(400).json({ error: 'No se pudo confirmar', motivo: resultado.motivo });
  }
  res.json({ ok: true });
});

// ============================================================================
// Mis Pacientes — un solo Paciente: la app va directo a su pantalla (regla del PRD);
// varios: el frontend arma la lista con esta misma respuesta.
// ============================================================================

appFamiliasRouter.get('/pacientes', requiereRolFamilia, async (req, res) => {
  const { data, error } = await supabase
    .from('pacientes')
    .select('id, nombre, domicilio')
    .eq('familia_id', req.usuarioFamilia.familiaId)
    .eq('prestadora_id', req.usuarioFamilia.prestadoraId)
    .order('nombre');
  if (error) {
    return responderError(res, error);
  }
  // Si al Paciente lo están atendiendo estos días en otro lado, la Familia ve esa dirección y no
  // la de la ficha — es la misma respuesta que ve el Asistente en su teléfono, escrita una sola
  // vez en la base (regla 12). Sin esto, la Familia y quien la cuida leerían direcciones
  // distintas para la misma persona el mismo día.
  res.json({ pacientes: await pacientesConDomicilioDeHoy(data) });
});

// ============================================================================
// Pantalla del Paciente — guardia actual (con Asistente asignado, para que el frontend
// abra la suscripción Realtime a esa fila) o, si no hay ninguna activa, la próxima
// programada. Incluye alertas activas (nivel != verde, sin resolver) para el resumen.
// ============================================================================

appFamiliasRouter.get('/pacientes/:id', requiereRolFamilia, async (req, res) => {
  const visibilidad = await visibilidadDeLaPersona(req);
  const paciente = await pacienteDeLaFamilia(req.params.id, req);
  if (!paciente) {
    return res.status(404).json({ error: 'Paciente no encontrado' });
  }

  // Dónde está el Asistente en este momento solo se pide si la Prestadora tiene prendido el
  // mapa en vivo. Apagado, el dato ni siquiera sale de la base: la Familia sigue viendo que
  // llegó (`checkin_at`) y quién es, que es lo que no depende de seguirle el recorrido.
  const columnasGuardiaActiva = columnasSegunVisibilidad([
    'id', 'fecha', 'hora_inicio', 'hora_fin', 'estado', 'checkin_at',
    ['ubicacion_actual_lat', 'familia_ubicacion_en_vivo'],
    ['ubicacion_actual_lng', 'familia_ubicacion_en_vivo'],
    ['ubicacion_actual_at', 'familia_ubicacion_en_vivo'],
    'asistente_id', 'asistentes(nombre, foto_url)',
  ], visibilidad);

  const { data: guardiaActiva } = await supabase
    .from('guardias')
    .select(columnasGuardiaActiva)
    .eq('paciente_id', paciente.id)
    .eq('estado', 'activa')
    .order('fecha', { ascending: false })
    .limit(1)
    .maybeSingle();

  let guardiaProxima = null;
  if (!guardiaActiva) {
    const { data } = await supabase
      .from('guardias')
      // salida_checkin_at es lo que permite decirle a la Familia "en camino": el Asistente
      // ya salió de su casa pero todavía no llegó al domicilio.
      .select('id, fecha, hora_inicio, hora_fin, estado, salida_checkin_at, asistente_id, asistentes(nombre, foto_url)')
      .eq('paciente_id', paciente.id)
      .eq('estado', 'programada')
      .gte('fecha', new Date().toISOString().slice(0, 10))
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true })
      .limit(1)
      .maybeSingle();
    guardiaProxima = data || null;
  }

  // A qué hora se estima que llega quien ya salió.
  //
  // LO QUE VIAJA ES UNA HORA Y NADA MÁS. La Familia lee «llega alrededor de las 14:45». Nunca ve
  // por dónde va: el punto del que salió el Asistente es casi siempre su casa, y mandarlo al
  // teléfono de un tercero sería entregar la ubicación de quien trabaja. Por eso las coordenadas
  // se leen en una consulta aparte, quedan en una variable de este lado y no tocan la respuesta.
  //
  // Es una estimación, no una promesa, y así se dice en la pantalla. Cuando no se puede calcular
  // —salida sin GPS, domicilio sin coordenadas— viaja `null`, que la pantalla trata como «no se
  // sabe»: una hora inventada parece confiable y nadie la vuelve a mirar.
  let llegadaEstimadaAt = null;
  if (guardiaProxima?.salida_checkin_at) {
    const { data: conSuPuntoDeSalida } = await supabase
      .from('guardias')
      .select('id, fecha, paciente_id, salida_checkin_at, salida_lat, salida_lng')
      .eq('id', guardiaProxima.id)
      .eq('prestadora_id', paciente.prestadora_id)
      .maybeSingle();
    const estimada = await llegadaEstimadaDeGuardia(conSuPuntoDeSalida);
    llegadaEstimadaAt = estimada ? estimada.toISOString() : null;
  }

  // Las alertas de la revisión automática solo se consultan si esta Prestadora las muestra.
  // Apagadas, la revisión sigue corriendo y el Coordinador se sigue enterando igual — lo que
  // cambia es que no viajan al teléfono de la Familia.
  let alertasActivas = [];
  if (visibilidad.familia_alertas_de_la_revision) {
    const { data } = await supabase
      .from('alertas')
      .select('id, nivel, descripcion, created_at')
      .eq('paciente_id', paciente.id)
      .is('resuelta_at', null)
      .order('created_at', { ascending: false });
    alertasActivas = data || [];
  }

  // Acá no viaja la medicación vigente del Paciente. No la muestra ninguna pantalla de la
  // Familia: la lista de indicaciones tiene su propia dirección, con su propio candado. Sería
  // dato de salud saliendo al teléfono para que nadie lo leyera.
  res.json({
    paciente,
    guardiaActiva: guardiaActiva || null,
    guardiaProxima: guardiaProxima && { ...guardiaProxima, llegada_estimada_at: llegadaEstimadaAt },
    alertasActivas,
  });
});

// ============================================================================
// Las guardias de la semana — la pregunta "¿quién viene el jueves?"
//
// Esta dirección devuelve la semana entera: los siete días, con quién viene en cada uno y cómo
// terminó cada guardia. Con la guardia de ahora y la que sigue no alcanza: todo lo demás —el
// resto de la semana, y lo que pasó con las que ya fueron— termina preguntándose por teléfono,
// y esa llamada la atiende la Coordinadora.
//
// EL DÍA LO PONE EL TELÉFONO, NO EL SERVIDOR. El motor puede estar corriendo en otro huso
// horario que la Familia; a las diez de la noche en Buenos Aires, el reloj del servidor ya
// puede estar en el día siguiente. Si el servidor eligiera la semana, habría noches en que
// la Familia abriría la aplicación y vería la semana que viene. Por eso la pantalla manda su
// propio día y el motor devuelve la semana que lo contiene.
// ============================================================================

appFamiliasRouter.get('/pacientes/:id/guardias', requiereRolFamilia, exigeDelCirculo('circulo_guardias'), async (req, res) => {
  const visibilidad = await visibilidadDeLaPersona(req);
  const paciente = await pacienteDeLaFamilia(req.params.id, req);
  if (!paciente) {
    return res.status(404).json({ error: 'Paciente no encontrado' });
  }

  // Si el día no viene o viene mal escrito se usa el del servidor. Es un plan B, no el camino
  // normal: sirve para que un pedido roto muestre una semana razonable en vez de un error, y
  // como mucho se corre un día en las horas del borde.
  const dia = esFechaISO(req.query.dia) ? req.query.dia : new Date().toISOString().slice(0, 10);
  const semana = semanaQueContiene(dia);

  // Se pregunta por `guardia_pacientes` y no por `guardias.paciente_id`: la tabla del medio es
  // la que dice a quiénes cubre cada guardia, y una guardia puede cubrir a más de una persona
  // —el matrimonio que vive en la misma casa— (ver utils/pacientesDeGuardia.js). Buscando por
  // la columna vieja, esa Familia vería media semana.
  //
  // Los tres filtros están escritos a mano y los tres hacen falta: el motor entra a la base con
  // la llave maestra, así que las cerraduras de la base no lo frenan. `paciente_id` ya salió
  // comprobado contra la Familia por `pacienteDeLaFamilia`, y la Prestadora se vuelve a exigir
  // de los dos lados —en la tabla del medio y en la guardia— para que ni una fila de otra
  // empresa pueda colarse por un dato mal cargado.
  const { data: filas, error } = await supabase
    .from('guardia_pacientes')
    .select(`
      guardias!inner(
        id, fecha, hora_inicio, hora_fin, estado, cancelacion_origen,
        checkin_at, checkout_at, prestadora_id,
        asistentes(nombre)
      )
    `)
    .eq('paciente_id', paciente.id)
    .eq('prestadora_id', paciente.prestadora_id)
    .eq('guardias.prestadora_id', req.usuarioFamilia.prestadoraId)
    .gte('guardias.fecha', semana.desde)
    .lte('guardias.fecha', semana.hasta);

  if (error) {
    return responderError(res, error);
  }

  // Qué viaja al teléfono: lo que la pantalla dibuja y nada más. El identificador del Asistente
  // y su foto no se mandan —la pantalla muestra el nombre— y la ubicación tampoco entra acá:
  // dónde está el Asistente ahora es la pantalla del Paciente, con su propio interruptor.
  const guardias = (filas ?? []).map(({ guardias: g }) => ({
    id: g.id,
    fecha: g.fecha,
    hora_inicio: g.hora_inicio,
    hora_fin: g.hora_fin,
    estado: g.estado,
    // Quién canceló cambia lo que la Familia lee: no es lo mismo "ustedes la cancelaron" que
    // "la canceló la Prestadora". Es un dato que ya está guardado, no uno que se calcule acá.
    cancelacion_origen: g.cancelacion_origen,
    checkin_at: g.checkin_at,
    checkout_at: g.checkout_at,
    asistente: g.asistentes?.nombre ?? null,
  }));

  // El orden se arma acá y no en la consulta porque el pedido ordena la tabla del medio, no la
  // guardia de adentro: pedirle a la base que ordene por una columna prestada no ordena las
  // filas de arriba. Son las guardias de una semana, así que ordenarlas cuesta nada.
  guardias.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora_inicio.localeCompare(b.hora_inicio));

  // La semana sale con los siete días escritos, incluidos los que no tienen ninguna guardia.
  // "El jueves no viene nadie" también es una respuesta, y es de las que evitan la llamada.
  // Una guardia de noche que empieza a las 22:00 y termina a las 06:00 se muestra en el día en
  // que empieza, que es el día en que la Familia la espera.
  res.json({
    desde: semana.desde,
    hasta: semana.hasta,
    // Los días con los que la pantalla vuelve a pedir la semana de al lado. Van armados desde
    // el motor para que la pantalla no tenga que hacer cuentas de calendario por su cuenta.
    semanaAnterior: semana.semanaAnterior,
    semanaSiguiente: semana.semanaSiguiente,
    dias: semana.dias.map((fecha) => ({
      fecha,
      guardias: guardias.filter((g) => g.fecha === fecha),
    })),
  });
});

// ============================================================================
// Reportes del Paciente
// ============================================================================

// Qué columnas de un reporte viajan al teléfono. Una sola definición para la lista y para el
// reporte suelto: si se escribiera dos veces, con el tiempo una de las dos mandaría de más.
//
// `texto_libre` no se pide: es el relato crudo que dictó el Asistente antes de ordenarlo en
// campos, ninguna pantalla de la Familia lo muestra, y sería el dato más delicado del reporte
// viajando al teléfono sin que nadie lo leyera.
//
// `medicacion` es lo que se le dio en ese turno, y va bajo el mismo interruptor que la lista de
// indicaciones: si la Prestadora decidió que la medicación no se muestra, no alcanza con
// esconder la lista y dejarla escrita adentro de cada reporte.
function columnasDelReporte(visibilidad) {
  return columnasSegunVisibilidad([
    'id', 'alimentacion',
    ['medicacion', 'familia_medicacion_del_paciente'],
    ['signos_vitales', 'familia_signos_vitales'],
    'estado_animo', 'incidentes', 'observaciones', 'foto_url', 'created_at',
    'guardias!inner(fecha, asistente_id, asistentes(nombre))',
  ], visibilidad);
}

appFamiliasRouter.get('/pacientes/:id/reportes', requiereRolFamilia, exigeDelCirculo('circulo_reportes'), async (req, res) => {
  const visibilidad = await visibilidadDeLaPersona(req);
  const paciente = await pacienteDeLaFamilia(req.params.id, req);
  if (!paciente) {
    return res.status(404).json({ error: 'Paciente no encontrado' });
  }

  // El reporte dice de quién habla, así que se piden directo. Buscarlos por los turnos que
  // cubrieron a esta persona traería también los reportes de los otros Pacientes del mismo
  // turno: la Familia vería en la historia de su padre lo que se escribió sobre el vecino de
  // cuarto.
  const columnas = columnasDelReporte(visibilidad);

  const { data, error } = await supabase
    .from('reportes')
    .select(columnas)
    .eq('paciente_id', paciente.id)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) {
    return responderError(res, error);
  }

  // Los rangos normales solo tienen sentido junto a los valores: sin signos vitales en
  // pantalla, mandar el semáforo de "fuera del rango normal" es mandar información clínica de
  // esa persona sin nada a lo que aplicarla.
  const vitales = visibilidad.familia_signos_vitales
    ? await resolverVitalesHabilitados(paciente.id, paciente.prestadora_id)
    : { rangos: null };

  res.json({ reportes: data, rangosVitales: vitales.rangos });
});

// Un reporte suelto. Existe para que la pantalla que muestra un reporte no tenga que pedir la
// lista entera —hasta 60 reportes con todo adentro— para quedarse con uno solo: serían 59 días
// de información de salud de esa persona viajando al teléfono para descartarse en el acto.
appFamiliasRouter.get('/pacientes/:id/reportes/:reporteId', requiereRolFamilia, exigeDelCirculo('circulo_reportes'), async (req, res) => {
  const visibilidad = await visibilidadDeLaPersona(req);
  const paciente = await pacienteDeLaFamilia(req.params.id, req);
  if (!paciente) {
    return res.status(404).json({ error: 'Paciente no encontrado' });
  }

  // El filtro por Paciente no sobra aunque el reporte se pida por su id: sin él, quien conozca
  // el id de un reporte de otro Paciente lo leería pidiéndolo por esta dirección.
  const { data, error } = await supabase
    .from('reportes')
    .select(columnasDelReporte(visibilidad))
    .eq('id', req.params.reporteId)
    .eq('paciente_id', paciente.id)
    .maybeSingle();
  if (error) {
    return responderError(res, error);
  }
  if (!data) {
    return res.status(404).json({ error: 'Reporte no encontrado' });
  }

  const vitales = visibilidad.familia_signos_vitales
    ? await resolverVitalesHabilitados(paciente.id, paciente.prestadora_id)
    : { rangos: null };

  res.json({ reporte: data, rangosVitales: vitales.rangos });
});

// ============================================================================
// Alertas del Paciente (activas + historial resuelto — ver AI_PROMPTS.md IA Nivel 2)
// ============================================================================

appFamiliasRouter.get('/pacientes/:id/alertas', requiereRolFamilia, exigeVisible('familia_alertas_de_la_revision'), exigeDelCirculo('circulo_alertas'), async (req, res) => {
  const paciente = await pacienteDeLaFamilia(req.params.id, req);
  if (!paciente) {
    return res.status(404).json({ error: 'Paciente no encontrado' });
  }

  // `campos_preocupantes` no se manda: es la lista de qué campo del reporte disparó la alerta,
  // la usa el Panel para que el Coordinador sepa dónde mirar, y ninguna pantalla de la Familia
  // la muestra. Es detalle clínico saliendo al teléfono sin que nadie lo lea.
  const { data, error } = await supabase
    .from('alertas')
    .select('id, nivel, descripcion, reportes_relacionados, resuelta_at, created_at')
    .eq('paciente_id', paciente.id)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) {
    return responderError(res, error);
  }
  res.json({ alertas: data });
});

// ============================================================================
// Asistente Asignado — datos del Asistente que tuvo o tiene alguna guardia con este
// Paciente (RLS de asistentes/certificados ya lo acota a eso, ver schema_pwa_familias_01.sql
// §3-4), estado del Certificado de Aptitud, evaluaciones anteriores, y el id de la guardia
// activa/última (para el botón de calificar).
//
// Además devuelve el tipo del Asistente con sus dos listas de tareas: qué le
// corresponde hacer y qué no. Es el motivo por el que existe el catálogo de
// tipos: que la Familia lo lea antes y no lo discuta en la puerta.
// ============================================================================

appFamiliasRouter.get('/pacientes/:id/asistente', requiereRolFamilia, async (req, res) => {
  const visibilidad = await visibilidadDeLaPersona(req);
  const paciente = await pacienteDeLaFamilia(req.params.id, req);
  if (!paciente) {
    return res.status(404).json({ error: 'Paciente no encontrado' });
  }

  const { data: guardia } = await supabase
    .from('guardias')
    .select('id, estado, asistente_id')
    .eq('paciente_id', paciente.id)
    .not('asistente_id', 'is', null)
    .order('fecha', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!guardia?.asistente_id) {
    return res.json({ asistente: null, certificado: null, evaluaciones: [], guardiaId: null });
  }

  const { data: asistente } = await supabase
    .from('asistentes')
    .select('id, nombre, foto_url, tipo_asistente_id')
    .eq('id', guardia.asistente_id)
    .maybeSingle();

  // Qué es esta persona y qué le toca hacer. Sale del catálogo, que se lee desde un solo
  // lugar para que la Familia y el Asistente vean exactamente la misma lista.
  const { tipo, tareas } = await tipoConSusTareas(
    asistente?.tipo_asistente_id,
    paciente.prestadora_id
  );

  const { data: certificado } = await supabase
    .from('certificados')
    .select('activo, fecha_vencimiento')
    .eq('asistente_id', guardia.asistente_id)
    .eq('activo', true)
    .order('fecha_vencimiento', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Las calificaciones anteriores solo se piden si esta Prestadora deja calificar. Donde la
  // función está apagada, mostrar las estrellas que alguien puso antes sería seguir puntuando
  // a un trabajador por la ventana.
  let evaluaciones = [];
  if (visibilidad.familia_califica_al_asistente) {
    const { data } = await supabase
      .from('calificaciones_asistente')
      .select('id, estrellas, comentario, created_at')
      .eq('asistente_id', guardia.asistente_id)
      .eq('paciente_id', paciente.id)
      .order('created_at', { ascending: false });
    evaluaciones = data || [];
  }

  res.json({
    asistente: asistente || null,
    tipo,
    tareas,
    certificado: certificado || null,
    evaluaciones,
    guardiaId: guardia.id,
  });
});

// ============================================================================
// Escanear Asistente: verifica que el qr_token escaneado corresponda al Asistente
// asignado a la guardia de HOY de ese Paciente.
// ============================================================================

appFamiliasRouter.get('/pacientes/:id/verificar-asistente/:qrToken', requiereRolFamilia, exigeVisible('familia_verifica_con_codigo'), exigeDelCirculo('circulo_verifica_con_codigo'), async (req, res) => {
  const paciente = await pacienteDeLaFamilia(req.params.id, req);
  if (!paciente) {
    return res.status(404).json({ error: 'Paciente no encontrado' });
  }

  const { data: asistenteEscaneado } = await supabase
    .from('asistentes')
    .select('id, nombre, foto_url, tipo_asistente_id')
    .eq('qr_token', req.params.qrToken)
    .eq('prestadora_id', paciente.prestadora_id)
    .maybeSingle();

  if (!asistenteEscaneado) {
    return res.status(404).json({ error: 'qr_no_reconocido' });
  }

  // Qué es esta persona —cuidador/a, enfermero/a…—, para que la pantalla no muestre
  // solo un nombre y una foto. Acá alcanza con el tipo: al escanear no se listan tareas.
  const tipoEscaneado = await tipoDelAsistente(
    asistenteEscaneado.tipo_asistente_id,
    paciente.prestadora_id
  );

  const hoyISO = new Date().toISOString().slice(0, 10);

  const { data: guardiaHoy } = await supabase
    .from('guardias')
    .select('id, estado, hora_inicio, hora_fin, asistente_id')
    .eq('paciente_id', paciente.id)
    .eq('fecha', hoyISO)
    .order('hora_inicio', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!guardiaHoy) {
    return res.json({
      coincide: false,
      motivo: 'sin_guardia_hoy',
      asistenteEscaneado,
      tipoEscaneado,
      guardia: null,
      certificado: null,
    });
  }

  // La guardia de hoy existe pero está sin cubrir. No es lo mismo que "no hay guardia":
  // hay servicio previsto y nadie asignado, y la Familia tiene que poder distinguirlo —
  // si no, escanea el QR de alguien que se presentó y el sistema le contesta que hoy no
  // había nada previsto.
  if (!guardiaHoy.asistente_id) {
    return res.json({
      coincide: false,
      motivo: 'guardia_sin_cubrir',
      asistenteEscaneado,
      tipoEscaneado,
      guardia: {
        id: guardiaHoy.id,
        estado: guardiaHoy.estado,
        horaInicio: guardiaHoy.hora_inicio,
        horaFin: guardiaHoy.hora_fin,
      },
      certificado: null,
    });
  }

  const coincide = guardiaHoy.asistente_id === asistenteEscaneado.id;

  const { data: certificado } = await supabase
    .from('certificados')
    .select('activo, fecha_vencimiento')
    .eq('asistente_id', asistenteEscaneado.id)
    .eq('activo', true)
    .order('fecha_vencimiento', { ascending: false })
    .limit(1)
    .maybeSingle();

  res.json({
    coincide,
    motivo: coincide ? 'asignado' : 'no_asignado',
    asistenteEscaneado,
    tipoEscaneado,
    guardia: {
      id: guardiaHoy.id,
      estado: guardiaHoy.estado,
      horaInicio: guardiaHoy.hora_inicio,
      horaFin: guardiaHoy.hora_fin,
    },
    certificado: certificado || null,
  });
});

// ============================================================================
// Calificación del Asistente al cierre de una guardia (tabla calificaciones_asistente).
// ============================================================================

// Calificar es una de las dos acciones de escritura que tiene la Familia, y viene negada de
// fábrica para todo el círculo: poner estrellas y un comentario sobre el trabajo de alguien es un
// acto del titular. Lo decide la instrucción que el titular firmó, y no la columna `rol` del
// miembro: «solo lectura o no» no distingue entre las dos acciones de escritura ni permite dar
// una sin la otra.
appFamiliasRouter.post('/guardias/:guardiaId/calificar', requiereRolFamilia, exigeVisible('familia_califica_al_asistente'), exigeDelCirculo('circulo_califica_al_asistente'), async (req, res) => {
  const { estrellas, comentario } = req.body || {};
  if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) {
    return res.status(400).json({ error: 'La calificación debe ser un número entero de 1 a 5' });
  }

  // El turno se busca por la lista de Pacientes, no por la columna vieja. Un turno puede cubrir
  // a más de una persona de la misma casa, y la calificación es del Asistente por ese turno: se
  // guarda contra el Paciente de la Familia que califica, tomando el primero por orden de
  // nombre cuando son varios, para que dos calificaciones del mismo turno no queden colgadas de
  // Pacientes distintos según el orden en que la base devuelva las filas.
  const { data: filas } = await supabase
    .from('guardia_pacientes')
    .select('paciente_id, pacientes!inner(nombre, familia_id), guardias!inner(id, asistente_id, prestadora_id)')
    .eq('guardia_id', req.params.guardiaId)
    .eq('pacientes.familia_id', req.usuarioFamilia.familiaId);
  const fila = (filas ?? [])
    .slice()
    .sort((a, b) => (a.pacientes?.nombre ?? '').localeCompare(b.pacientes?.nombre ?? ''))[0];
  if (!fila) {
    return res.status(404).json({ error: 'Guardia no encontrada' });
  }
  const guardia = { ...fila.guardias, paciente_id: fila.paciente_id };
  // Una guardia que quedó sin cubrir no tiene a quién calificar. Sin este corte, el INSERT
  // manda asistente_id en NULL contra una columna obligatoria y devuelve un 500 sin
  // explicación.
  if (!guardia.asistente_id) {
    return res.status(400).json({ error: 'guardia_sin_asistente' });
  }

  const { error } = await supabase.from('calificaciones_asistente').insert({
    asistente_id: guardia.asistente_id,
    paciente_id: guardia.paciente_id,
    familia_id: req.usuarioFamilia.familiaId,
    guardia_id: guardia.id,
    prestadora_id: guardia.prestadora_id,
    estrellas,
    comentario: comentario || null,
  });
  if (error) {
    return responderError(res, error);
  }

  res.json({ ok: true });
});

// ============================================================================
// Notificaciones push (Web Push API + VAPID) — mismo contrato que appAsistentes.js,
// generalizado del lado de push.js a familia_id.
// ============================================================================

appFamiliasRouter.post('/push/suscribir', requiereRolFamilia, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Suscripción push incompleta' });
  }

  // La suscripción se guarda a nombre de la Familia, no de quien la registró. Los avisos se
  // mandan con `enviarPushFamilia(familia.id)`, así que una fila guardada con el identificador
  // propio de la persona no la encuentra nadie: para el titular daba igual —su identificador y
  // el de su Familia son el mismo—, pero quien está en el círculo familiar y no es el titular se
  // suscribía y no recibía nunca ningún aviso.
  const { error } = await guardarSuscripcionPush({
    prestadoraId: req.usuarioFamilia.prestadoraId,
    rol: 'familia',
    usuarioId: req.usuarioFamilia.familiaId,
    endpoint,
    keys,
    userAgent: req.headers['user-agent'],
  });
  if (error) {
    return responderError(res, error);
  }

  res.json({ ok: true });
});

appFamiliasRouter.delete('/push/suscribir', requiereRolFamilia, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) {
    return res.status(400).json({ error: 'Falta el endpoint de la suscripción' });
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('familia_id', req.usuarioFamilia.familiaId);
  if (error) {
    return responderError(res, error);
  }

  res.json({ ok: true });
});

// ============================================================================
// El acceso al Marketplace + cobro en efectivo por QR. El QR es la
// alternativa a la carga manual del cobrador: la Familia lo genera desde su propio
// dispositivo, de un solo uso y con vencimiento corto (10 min) — el canje ocurre siempre en
// el Panel vía service_role, nunca como UPDATE directo desde acá.
// ============================================================================

appFamiliasRouter.get('/acceso/:pacienteId', requiereRolFamilia, exigeVisible('familia_pagos_y_suscripcion'), exigeDelCirculo('circulo_dinero'), async (req, res) => {
  const { data, error } = await supabase
    .from('accesos_marketplace')
    .select(
      'id, estado, importe, gratis_hasta, proximo_cobro, cancelada_en, vigente_hasta, ' +
        'formas_de_cobro_marketplace(renueva_sola)'
    )
    .eq('familia_id', req.usuarioFamilia.familiaId)
    .eq('paciente_id', req.params.pacienteId)
    .maybeSingle();
  if (error) return responderError(res, error);
  // La pantalla necesita saber si hay renovación que apagar para decidir si ofrece la baja, y no
  // tiene por qué recibir la forma de cobro entera para eso.
  const acceso = data
    ? {
        ...sinLaFormaDeCobro(data),
        renueva_sola: Boolean(data.formas_de_cobro_marketplace?.renueva_sola),
      }
    : data;
  res.json({ acceso });
});

function sinLaFormaDeCobro({ formas_de_cobro_marketplace: _forma, ...resto }) {
  return resto;
}

// La baja en un clic del §3.2 del `docs/PRD_07_Modalidad_Marketplace.md`: la hace quien paga, sin
// pedírselo a nadie. Qué apaga y qué conserva lo decide `utils/bajaDelAcceso.js`, que es el único
// lugar por donde un acceso se da de baja; acá sólo se comprueba quién llama.
appFamiliasRouter.post('/acceso/:accesoId/baja', requiereRolFamilia, exigeVisible('familia_pagos_y_suscripcion'), exigeDelCirculo('circulo_dinero'), async (req, res) => {
  const resultado = await darDeBajaElAcceso({
    accesoId: req.params.accesoId,
    familiaId: req.usuarioFamilia.familiaId,
  });

  if (!resultado.ok) {
    // El motivo es un código y la frase vive en las traducciones; qué número de respuesta le
    // toca a cada uno lo decide `utils/errorConMotivo.js`, que es el único lugar que lo sabe.
    return responderError(res, new ErrorConMotivo(resultado.motivo, resultado.detalle));
  }

  res.json({ baja: resultado.baja, ya_estaba: Boolean(resultado.yaEstaba) });
});

appFamiliasRouter.post('/qr-cobro', requiereRolFamilia, exigeVisible('familia_pagos_y_suscripcion'), exigeDelCirculo('circulo_dinero'), async (req, res) => {
  const { acceso_id: accesoId } = req.body || {};
  if (!accesoId) {
    return res.status(400).json({ error: 'Falta acceso_id' });
  }

  const { data: acceso } = await supabase
    .from('accesos_marketplace')
    .select('id, familia_id, importe, proximo_cobro')
    .eq('id', accesoId)
    .eq('familia_id', req.usuarioFamilia.familiaId)
    .maybeSingle();
  if (!acceso) {
    return res.status(404).json({ error: 'Acceso no encontrado' });
  }

  const { token, expiraEn } = generarTokenQrCobro();
  const { data, error } = await supabase
    .from('qr_cobro_efectivo')
    .insert({
      acceso_id: acceso.id,
      familia_id: req.usuarioFamilia.familiaId,
      periodo: acceso.proximo_cobro || new Date().toISOString().slice(0, 10),
      monto: acceso.importe,
      token,
      expira_en: expiraEn.toISOString(),
    })
    .select('id, token, expira_en, usado_en')
    .single();
  if (error) return responderError(res, error);

  res.json({ qr: data });
});

appFamiliasRouter.get('/qr-cobro/:id', requiereRolFamilia, exigeVisible('familia_pagos_y_suscripcion'), exigeDelCirculo('circulo_dinero'), async (req, res) => {
  const { data, error } = await supabase
    .from('qr_cobro_efectivo')
    .select('id, expira_en, usado_en, cobro_id')
    .eq('id', req.params.id)
    .eq('familia_id', req.usuarioFamilia.familiaId)
    .maybeSingle();
  if (error) return responderError(res, error);
  if (!data) return res.status(404).json({ error: 'QR no encontrado' });
  res.json({ qr: data });
});

// ============================================================================
// El pase de guardia — el código que la Familia muestra en pantalla
//
// Cuando llega el Asistente, quien está en la casa abre esto y le muestra el código. Se renueva
// solo cada pocos segundos —los que configuró la Prestadora—, así que una foto de la pantalla no
// sirve un minuto después. No se usa un cartel impreso: pegado en la puerta sería un secreto
// permanente a la vista de cualquiera que pase.
//
// Lo muestra cualquiera del círculo familiar, sin acceso especial: no revela ningún dato del
// Paciente ni de la Prestadora, y su único efecto es dejar entrar a quien ya tenía la guardia
// asignada. El código vale para el círculo entero —sujeto_tipo 'familia'—, así que da lo mismo
// cuál de sus miembros esté en la casa ese día.
// ============================================================================

appFamiliasRouter.get('/codigo-de-presencia', requiereRolFamilia, async (req, res) => {
  try {
    const { codigo, segundos, expiraEn } = await codigoParaMostrar({
      prestadoraId: req.usuarioFamilia.prestadoraId,
      sujetoTipo: 'familia',
      sujetoId: req.usuarioFamilia.familiaId,
    });
    res.json({ codigo, segundos, expiraEn });
  } catch (e) {
    responderError(res, e);
  }
});

import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { responderError, ErrorConMotivo } from '../utils/errorConMotivo.js';
import { esDireccionDeCorreo } from '../utils/email.js';

// Alta y listado de prestadoras licenciatarias — pendiente #30, ítem I.
// Solo superadmin tiene uso legítimo de esto:
// para elegir a cuál Prestadora entrar con una sesión de soporte técnico, y para elegir la
// prestadora_id al dar de alta el primer admin_prestadora de una Prestadora nueva.
// Admin_prestadora/coordinador no ven otras Prestadoras bajo ninguna circunstancia
// (CLAUDE.md glosario).
//
// El alta es de este lado y no del de CeltaTech porque el identificador de la Organización lo
// crea el producto (`celtatech/CLAUDE.md` §3): CeltaTech guarda después esa referencia como
// texto opaco. Acá no entra ningún dato comercial —ni plan, ni precio, ni suscripción—, que es
// de CeltaTech y no del producto.
export const panelPrestadorasRouter = Router();

function requiereSuperadmin(req, res, next) {
  if (req.usuarioPanel?.rol !== 'superadmin') {
    return res.status(403).json({ error: 'Solo Superadmin puede ver la lista de Prestadoras' });
  }
  next();
}

// El alta queda en el registro de auditoría como lo que es: una escritura sobre `prestadoras`
// hecha por una persona de CeltaTech. Usa el mismo tipo de evento que las demás escrituras
// (`mutacion`), así que no hace falta inventar ninguno. No bloquea la respuesta si falla: la
// Prestadora ya está creada y perder el renglón del registro no puede deshacer eso.
async function registrarAltaEnAuditoria(adminId, prestadoraId) {
  const { error } = await supabase.from('auditoria_soporte_tecnico').insert({
    admin_id: adminId,
    prestadora_id: prestadoraId,
    tipo_evento: 'mutacion',
    tabla_afectada: 'prestadoras',
    operacion: 'INSERT',
    registro_id: prestadoraId,
  });
  if (error) console.error('Error registrando el alta de la Prestadora en la auditoría:', error.message);
}

panelPrestadorasRouter.get('/', requiereRolPanel, requiereSuperadmin, async (req, res) => {
  const { data, error } = await supabase
    .from('prestadoras')
    .select('id, nombre_fantasia, estado')
    .order('nombre_fantasia', { ascending: true });

  if (error) return responderError(res, error);
  res.json({ prestadoras: data });
});

// Los países en los que se puede dar de alta una Prestadora: los que tienen cargada su moneda.
// Sale de la base y no de una lista escrita en la pantalla, así que agregar un país nuevo es
// agregarle una fila al catálogo y nada más.
panelPrestadorasRouter.get('/paises', requiereRolPanel, requiereSuperadmin, async (req, res) => {
  const { data, error } = await supabase
    .from('monedas_por_pais')
    .select('pais, moneda')
    .order('pais', { ascending: true });

  if (error) return responderError(res, error);
  res.json({ paises: data });
});

// El alta de una Prestadora.
//
// Lo que se pide es lo mínimo con lo que la Prestadora puede empezar a existir: cómo se llama
// para el mundo, cómo se llama ante la ley, en qué país trabaja y a qué casilla quiere que le
// lleguen las respuestas de los avisos que manda. Todo lo demás —zonas, plazos, formas de
// cobro— lo configura ella después, y la fila de configuración inicial la siembra sola la base
// al insertar (disparador `trg_sembrar_configuracion_prestadora`).
//
// El estado con el que nace es el que pone la base, `prospecto`: quien da de alta no lo elige,
// porque certificar una Prestadora es otra cosa y tiene su propio camino.
panelPrestadorasRouter.post('/', requiereRolPanel, requiereSuperadmin, async (req, res) => {
  const razonSocial = String(req.body?.razon_social ?? '').trim();
  const nombreFantasia = String(req.body?.nombre_fantasia ?? '').trim();
  const pais = String(req.body?.pais ?? '').trim().toUpperCase();
  const identificacionFiscal = String(req.body?.identificacion_fiscal ?? '').trim();
  const emailRespuestas = String(req.body?.email_respuestas ?? '').trim();

  if (!razonSocial || !nombreFantasia || !pais || !emailRespuestas) {
    return responderError(res, new ErrorConMotivo('faltan_datos', 'alta de Prestadora sin razón social, nombre, país o casilla de respuestas'));
  }

  if (!esDireccionDeCorreo(emailRespuestas)) {
    return responderError(res, new ErrorConMotivo('correo_invalido', 'la casilla de respuestas no tiene forma de dirección de correo'));
  }

  // El país se comprueba contra el catálogo de monedas antes de insertar. Si no está, el
  // disparador que completa la moneda aborta con una excepción de la base, y esa excepción
  // nombra tablas y columnas: preguntando antes, quien da de alta lee que falta cargar ese país.
  const { data: paisConocido, error: errorPais } = await supabase
    .from('monedas_por_pais')
    .select('pais')
    .eq('pais', pais)
    .maybeSingle();

  if (errorPais) return responderError(res, errorPais);
  if (!paisConocido) {
    return responderError(res, new ErrorConMotivo('pais_sin_moneda', `país ${pais} fuera del catálogo de monedas`));
  }

  const { data: prestadora, error } = await supabase
    .from('prestadoras')
    .insert({
      razon_social: razonSocial,
      nombre_fantasia: nombreFantasia,
      pais,
      identificacion_fiscal: identificacionFiscal || null,
      fecha_alta: new Date().toISOString().slice(0, 10),
    })
    .select('id, nombre_fantasia, estado')
    .single();

  if (error) {
    // Dos Prestadoras no se llaman igual (índice `prestadoras_nombre_fantasia_unico`), y quien
    // está dando el alta puede corregirlo ahí mismo: por eso sale con motivo propio y no como
    // una falla del sistema.
    if (error.code === '23505') {
      return responderError(res, new ErrorConMotivo('nombre_de_prestadora_repetido', error.message));
    }
    return responderError(res, error);
  }

  // La casilla de respuestas va sobre la fila de configuración que acaba de sembrar la base.
  // Si esto falla, la Prestadora ya existe y no se deshace: se avisa en el Panel que quedó sin
  // casilla, que es un dato que se vuelve a cargar desde Configuración.
  const { error: errorCasilla } = await supabase
    .from('configuracion_prestadora')
    .update({ email: emailRespuestas, updated_at: new Date().toISOString() })
    .eq('prestadora_id', prestadora.id);

  if (errorCasilla) {
    console.error('El alta de la Prestadora quedó sin casilla de respuestas:', errorCasilla.message);
  }

  await registrarAltaEnAuditoria(req.usuarioPanel.id, prestadora.id);

  res.status(201).json({ prestadora, casilla_respuestas_guardada: !errorCasilla });
});

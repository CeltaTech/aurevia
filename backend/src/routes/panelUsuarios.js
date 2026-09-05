import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { acotarAUsuariosDelPanel } from '../middleware/alcancePrestadora.js';
import { supabase } from '../db/connection.js';
import { crearCuentaConPerfil, borrarCuenta } from '../utils/cuentasPanel.js';
import { exigirAdministracion } from '../middleware/exigirAdministracion.js';
import { ROLES_PANEL } from '../utils/roles.js';

export const panelUsuariosRouter = Router();

// Ver y gestionar otros usuarios del panel es sensible (alta/baja de acceso). Admin gestiona
// Coordinadores. Superadmin además gestiona cuentas de Admin y de otros Superadmin (acceso
// técnico del Módulo 8) — ver CLAUDE.md glosario y docs/CONTEXT.md.
//
// Ojo: acá no se exige prestadoraId, y es a propósito. Un Superadmin sin Organización activa
// igual tiene algo que gestionar: las cuentas de su propio equipo técnico, que no pertenecen a
// ninguna Prestadora. De eso se ocupa acotarAUsuariosDelPanel(). Lo que ya NO pasa (pendiente
// #98, cerrado el 2026-07-28) es que Superadmin vea las cuentas de Prestadoras en las que no
// entró: para eso hay que abrir una sesión de soporte técnico, y entonces queda auditado.
const soloAdministracion = exigirAdministracion('Solo Admin o Superadmin puede gestionar usuarios del panel');

// Roles que el solicitante tiene permitido crear/editar/borrar.
function rolesGestionables(rolSolicitante) {
  if (rolSolicitante === 'superadmin') return ROLES_PANEL;
  return ['coordinador'];
}

panelUsuariosRouter.get('/', requiereRolPanel, soloAdministracion, async (req, res) => {
  let query = supabase
    .from('usuarios')
    .select('id, rol, nombre, telefono, zonas, created_at')
    .in('rol', ROLES_PANEL)
    .order('created_at', { ascending: false });

  query = acotarAUsuariosDelPanel(query, req.usuarioPanel);

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });
  res.json({ usuarios: data });
});

panelUsuariosRouter.post('/', requiereRolPanel, soloAdministracion, async (req, res) => {
  const { email, nombre, telefono, zonas, rol } = req.body;
  if (!email || !nombre) {
    return res.status(400).json({ error: 'Faltan email o nombre' });
  }

  const rolPermitidos = rolesGestionables(req.usuarioPanel.rol);
  const rolNuevo = req.usuarioPanel.rol === 'superadmin' ? (rol || 'coordinador') : 'coordinador';
  if (!rolPermitidos.includes(rolNuevo)) {
    return res.status(403).json({ error: 'No hay permiso para crear cuentas con ese rol' });
  }

  // La cuenta nueva nace SIEMPRE en la Organización activa de quien la crea. Nadie elige el
  // destino a mano, ni siquiera Superadmin (pendiente #98, cerrado el 2026-07-28): antes podía
  // mandar un `prestadora_id` en el cuerpo del pedido y dar de alta una cuenta con acceso a
  // cualquier Prestadora sin haber entrado a ninguna, y sin que quedara auditado.
  // Para dar de alta al primer Admin de una Prestadora, se abre una sesión de soporte técnico
  // en esa Prestadora y se crea la cuenta desde adentro — sale igual de fácil y queda registrado
  // en auditoria_soporte_tecnico. Una cuenta superadmin nueva no lleva Prestadora ninguna
  // (prestadora_id nulo), que es lo que exige la restricción
  // usuarios_prestadora_id_solo_superadmin_null en la base.
  //
  // La cuenta superadmin nueva es el único caso aparte: se ancla a la Organización propia de
  // quien la crea (la Sandbox), nunca a la Prestadora de la sesión de soporte abierta. Si se
  // usara `prestadoraId` acá, un Superadmin dentro de una sesión de soporte le estaría dejando a
  // otro Superadmin una Prestadora real como Organización propia, que es justo lo que la
  // restricción de acceso de CLAUDE.md §5 viene a impedir.
  const prestadoraDestino = rolNuevo === 'superadmin'
    ? req.usuarioPanel.organizacionPropiaId
    : req.usuarioPanel.prestadoraId;

  if (!prestadoraDestino && rolNuevo !== 'superadmin') {
    return res.status(400).json({ error: 'Hace falta entrar a una prestadora antes de dar de alta la cuenta' });
  }

  try {
    const { userId, passwordTemporal } = await crearCuentaConPerfil({
      email, nombre, telefono, rol: rolNuevo, zonas,
      prestadoraId: prestadoraDestino,
    });
    res.json({ ok: true, id: userId, passwordTemporal });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

panelUsuariosRouter.patch('/:id', requiereRolPanel, soloAdministracion, async (req, res) => {
  const { nombre, telefono, zonas } = req.body;
  let query = supabase
    .from('usuarios')
    .update({ nombre, telefono, zonas })
    .eq('id', req.params.id)
    .in('rol', rolesGestionables(req.usuarioPanel.rol));

  query = acotarAUsuariosDelPanel(query, req.usuarioPanel);

  // Sin el .select('id') la base contesta que salió bien aunque no haya tocado ninguna fila, y
  // entonces se le avisa "guardado" a alguien que no guardó nada. Si no volvió ninguna fila, la
  // cuenta no existe o es de otra Prestadora: desde afuera es el mismo caso y se contesta igual,
  // para que la respuesta no permita averiguar qué cuentas tienen las demás Prestadoras.
  const { data: modificada, error } = await query.select('id');

  if (error) return res.status(500).json({ error: error.message });
  if (!modificada?.length) {
    return res.status(404).json({ error: 'No se encontró esa cuenta' });
  }
  res.json({ ok: true });
});

panelUsuariosRouter.delete('/:id', requiereRolPanel, soloAdministracion, async (req, res) => {
  if (req.params.id === req.usuarioPanel.id) {
    return res.status(400).json({ error: 'La cuenta propia no se da de baja desde acá' });
  }

  let queryUsuario = supabase.from('usuarios').select('rol, prestadora_id').eq('id', req.params.id);
  queryUsuario = acotarAUsuariosDelPanel(queryUsuario, req.usuarioPanel);
  const { data: usuario } = await queryUsuario.maybeSingle();
  if (!usuario || !rolesGestionables(req.usuarioPanel.rol).includes(usuario.rol)) {
    return res.status(400).json({ error: 'No hay permiso para dar de baja esa cuenta' });
  }

  await borrarCuenta(req.params.id, {
    prestadoraId: req.usuarioPanel.prestadoraId,
    esSuperadmin: req.usuarioPanel.rol === 'superadmin',
  });
  res.json({ ok: true });
});

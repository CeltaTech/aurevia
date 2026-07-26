import { Router } from 'express';
import { supabase } from '../db/connection.js';
import { solicitarCodigoRecuperacion, confirmarCodigoRecuperacion } from '../utils/mfaRecuperacionEmail.js';

// Pendiente #37 — recuperación de acceso por email para superadmin/admin_plataforma que
// pierde el dispositivo TOTP. A propósito NO usa requiereRolPanel: ese middleware exige
// aal2 cuando mfa_admin_obligatorio está en ON, y quien llega acá es precisamente alguien
// que todavía no pudo completar ese segundo factor (sesión aal1, ya autenticado con
// contraseña). Alcanza con validar el token y el rol, sin exigir aal2.
export const panelMfaRecuperacionRouter = Router();

async function requiereSesionBasica(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return res.status(401).json({ error: 'No autorizado' });

  const { data: perfil } = await supabase.from('usuarios').select('rol').eq('id', userData.user.id).single();
  if (!perfil || !['superadmin', 'admin_plataforma'].includes(perfil.rol)) {
    return res.status(403).json({ error: 'Rol sin permiso' });
  }

  req.usuarioId = userData.user.id;
  next();
}

panelMfaRecuperacionRouter.use(requiereSesionBasica);

panelMfaRecuperacionRouter.post('/solicitar', async (req, res) => {
  try {
    await solicitarCodigoRecuperacion(req.usuarioId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en /mfa-recuperacion/solicitar:', err);
    res.status(500).json({ error: err.message });
  }
});

panelMfaRecuperacionRouter.post('/confirmar', async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ error: 'Falta el código' });

  const valido = await confirmarCodigoRecuperacion(req.usuarioId, codigo);
  if (!valido) return res.status(400).json({ error: 'Código inválido, vencido o ya usado' });

  res.json({ ok: true });
});

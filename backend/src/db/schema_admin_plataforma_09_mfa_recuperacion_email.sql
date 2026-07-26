-- Pendiente #37 (docs/PENDIENTES.md) — recuperación de acceso por email cuando
-- superadmin/admin_plataforma pierde el dispositivo con la app TOTP. Decisión explícita
-- del Desarrollador 2026-07-26: nada de códigos pre-generados para guardar/anotar (mismo
-- problema que se busca resolver) — el código de un solo uso se manda al email ya
-- registrado del usuario, que siempre tiene a mano.

CREATE TABLE IF NOT EXISTS mfa_codigos_recuperacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  codigo_hash TEXT NOT NULL,
  expira_at TIMESTAMPTZ NOT NULL,
  usado BOOLEAN NOT NULL DEFAULT FALSE,
  usado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mfa_codigos_recuperacion ENABLE ROW LEVEL SECURITY;

-- Sin policies a propósito: el objetivo entero de este código es dejar entrar a alguien
-- que todavía no pasó el desafío de MFA (sesión aal1, no aal2) — no puede depender de
-- ninguna policy que exija sesión ya autorizada. Uso exclusivo del backend con Service
-- Role Key (backend/src/utils/mfaRecuperacionEmail.js), nunca acceso directo desde el Panel.

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Qué hace: crea `auditoria_cambio_dueno_push`, donde queda anotado cada vez que
-- la suscripción de avisos de un aparato pasa de una persona a otra.
--
-- Por qué (pendiente #167). Un aparato que quiere recibir avisos le pide al
-- navegador una dirección de entrega y nos la manda; nosotros la guardamos junto
-- con las dos claves con las que se cifra cada aviso para ese aparato. Esa
-- dirección es única en toda la tabla, sin condición de Prestadora, así que la
-- persona que la mande con sus propias claves se queda con la fila.
--
-- A partir de ahí, el aparato de la otra persona **deja de mostrar sus avisos**:
-- el motor le sigue mandando mensajes, pero cifrados con claves que ese
-- navegador no tiene, así que no se abren. Nada se lee ni llega a quien no
-- corresponde —los mensajes salen hacia el aparato de siempre, no hacia quien
-- pisó la fila—. Es apagar avisos, no espiarlos, y en un producto de cuidado eso
-- igual importa: el aviso que no llega puede ser el de una guardia sin cubrir.
--
-- ── Por qué se anota en vez de prohibirse ───────────────────────────────────
--
-- Porque el caso legítimo es idéntico al abusivo. Cuando dos personas usan el
-- mismo teléfono —una Familia y la Asistente que la atiende, dos hermanos que
-- comparten un aparato—, la dirección de entrega es la misma y pisarla es
-- exactamente lo correcto: el aparato es uno solo y los avisos tienen que ser
-- de quien esté usándolo. No hay forma de mirar un pedido y decir cuál de los
-- dos es. Entonces se deja pasar y se deja rastro, que es lo que permite
-- explicar después por qué alguien dejó de recibir avisos.
--
-- ── Qué se guarda y qué no ──────────────────────────────────────────────────
--
-- No se guarda la dirección de entrega. Es larga, es la única cosa que hace
-- falta conocer para pisar una suscripción, y esta tabla la leen personas: es
-- justamente lo que no conviene dejar a la vista (CLAUDE.md §6). Se guarda el
-- identificador de la fila de la suscripción, que alcanza para seguir el hilo
-- desde adentro.
--
-- Tampoco hay clave foránea contra `push_subscriptions`: una anotación de
-- auditoría tiene que sobrevivir al borrado de lo que describe, y esa fila se
-- borra sola en cuanto el aparato desinstala la aplicación.
--
-- Cómo se vuelve atrás: una migración nueva hacia adelante que borre la tabla.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.auditoria_cambio_dueno_push (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- La fila de `push_subscriptions` que cambió de dueño. Sin clave foránea a
  -- propósito (ver arriba): la anotación queda aunque la suscripción se borre.
  suscripcion_id uuid NOT NULL,

  -- Las dos Prestadoras involucradas. Casi siempre son la misma —el teléfono
  -- compartido dentro de una Prestadora—; cuando difieren, es el caso que este
  -- registro existe para poder explicar.
  prestadora_anterior uuid NOT NULL REFERENCES public.prestadoras(id),
  prestadora_nueva uuid NOT NULL REFERENCES public.prestadoras(id),

  -- Las dos personas: la que tenía la suscripción y la que se la quedó. Sin
  -- clave foránea, por la misma razón que `suscripcion_id`: si una de las dos se
  -- da de baja, la anotación tiene que seguir estando.
  usuario_anterior uuid NOT NULL,
  usuario_nuevo uuid NOT NULL,

  -- Si cada una entró como Asistente o como Familia. Una suscripción es de una
  -- de las dos audiencias, nunca de las dos (CHECK push_subscriptions_una_audiencia).
  rol_anterior text NOT NULL CHECK (rol_anterior IN ('asistente', 'familia')),
  rol_nuevo text NOT NULL CHECK (rol_nuevo IN ('asistente', 'familia')),

  -- Qué navegador mandó el pedido que se quedó con la suscripción. Es lo único
  -- que ayuda a distinguir "el mismo teléfono de siempre" de otro aparato.
  user_agent text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_cambio_dueno_push_anterior
  ON public.auditoria_cambio_dueno_push (prestadora_anterior, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_cambio_dueno_push_nueva
  ON public.auditoria_cambio_dueno_push (prestadora_nueva, created_at DESC);

ALTER TABLE public.auditoria_cambio_dueno_push ENABLE ROW LEVEL SECURITY;

-- Sin política de escritura: nadie escribe acá desde el Panel ni desde las dos
-- aplicaciones. La anotación la deja el motor con su llave de servicio, en el
-- mismo momento en que guarda la suscripción
-- (backend/src/utils/suscripcionesPush.js).

-- Lee el Admin de cualquiera de las dos Prestadoras involucradas: la que perdió
-- los avisos necesita poder explicar por qué dejaron de llegar, y la que se los
-- quedó necesita poder ver que alguien de su lado lo hizo.
CREATE POLICY "admin_prestadora_lee_los_cambios_que_la_involucran"
  ON public.auditoria_cambio_dueno_push FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND u.rol = 'admin_prestadora'
      AND u.prestadora_id IN (prestadora_anterior, prestadora_nueva)
  ));

-- Y el Superadmin, solamente sobre la Prestadora de la sesión de soporte técnico
-- que tenga abierta (CLAUDE.md §5), igual que en `auditoria_soporte_tecnico`.
CREATE POLICY "superadmin_lee_los_cambios_de_su_sesion_activa"
  ON public.auditoria_cambio_dueno_push FOR SELECT
  USING (es_superadmin() AND current_tenant() IN (prestadora_anterior, prestadora_nueva));

NOTIFY pgrst, 'reload schema';

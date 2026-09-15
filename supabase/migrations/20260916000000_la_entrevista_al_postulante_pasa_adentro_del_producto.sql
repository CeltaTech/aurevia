-- La entrevista al postulante pasa adentro del producto.
-- ======================================================
--
-- QUÉ FALTABA. La tercera etapa del Proceso de Incorporación de Asistentes es una entrevista
-- (`docs/PRD_03_Reclutamiento.md`), y hasta hoy el producto no la hacía: alguien la coordinaba por
-- teléfono o por correo, la hacía por afuera y después marcaba una casilla a mano. De esa
-- entrevista no quedaba nada: ni cuándo se acordó, ni quién la hizo, ni si la persona se
-- presentó.
--
-- Y COORDINARLA POR AFUERA OBLIGA A PASARSE DATOS DE CONTACTO. Quien entrevista le da su teléfono
-- o su correo a alguien que todavía es un postulante, y el postulante le da el suyo a una persona
-- y no a la Prestadora. Del lado del Marketplace esto ya estaba resuelto para la Familia y el
-- Asistente, y el motivo vale igual acá: se habla por adentro.
--
-- LA SALA ES LA MISMA QUE YA USA EL CHAT, y no hay proveedor escrito en el código. La dirección
-- base de las salas es de cada Prestadora y ya vive en `prestadoras.videollamada_base_url`; el
-- producto le agrega un nombre de sala imposible de adivinar. Donde esa dirección está vacía no
-- hay videollamada: la entrevista se puede agendar igual —sirve para acordar el día y la hora y
-- para que quede la constancia— y la pantalla avisa que esa parte no está configurada. No
-- prohíbe: avisa (`celtatech/CLAUDE.md` §7).
--
-- EL POSTULANTE NO TIENE CUENTA, ASÍ QUE ENTRA POR UNA LLAVE. Es lo único que tiene: todavía no
-- es Asistente, no hay a quién darle una sesión. La llave es larga e imposible de adivinar, viaja
-- por el correo que la persona dejó en su postulación, y **no es la dirección de la sala**: es una
-- dirección del producto, que comprueba que sea la hora antes de dejar entrar. Así la sala nunca
-- viaja por correo, y reprogramar la entrevista no obliga a mandar una llave nueva.
--
-- LA HORA DE LA CITA ES LO QUE ABRE LA PUERTA, y no el momento en que se creó la sala. Una
-- entrevista agendada para la semana que viene nacería vencida si valiera desde que se guardó.
-- Cuánto antes y cuánto después sigue valiendo está en `backend/src/utils/videollamada.js`, junto
-- con la vigencia de la sala del chat, porque es la misma decisión mirada de dos maneras.
--
-- UNA SOLA ENTREVISTA VIVA POR POSTULACIÓN. Reprogramar mueve el día de la que ya existe; dos
-- entrevistas agendadas al mismo tiempo para la misma persona serían dos citas y nadie sabría a
-- cuál ir. Las que terminaron —hechas, no asistidas o canceladas— quedan todas, porque son la
-- historia de esa postulación.

-- ---------------------------------------------------------------------------
-- 1. La entrevista
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.entrevistas_postulacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  postulacion_id bigint NOT NULL REFERENCES public.postulaciones(id) ON DELETE CASCADE,

  -- El día y la hora acordados. Es lo que decide si la puerta está abierta.
  agendada_para timestamptz NOT NULL,

  -- Lo que el postulante recibe por correo. Larga y sin ningún dato adentro: no se deduce de su
  -- nombre, de su postulación ni de la fecha.
  llave_publica text NOT NULL UNIQUE CHECK (length(llave_publica) >= 32),

  -- La sala de esta entrevista. Nace con ella y muere con ella.
  sala_videollamada text,

  estado text NOT NULL DEFAULT 'agendada'
    CHECK (estado IN ('agendada', 'realizada', 'no_asistio', 'cancelada')),

  -- Quién la agendó y quién cerró cómo salió. Es la constancia que antes no quedaba en ningún
  -- lado: la casilla marcada a mano no decía quién la había marcado.
  agendada_por uuid NOT NULL,
  cerrada_por uuid,
  cerrada_at timestamptz,

  -- Lo que quien entrevistó quiera dejar anotado. Lo lee sólo el Panel: el postulante nunca ve
  -- esta tabla.
  observaciones text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Una sola entrevista viva por postulación. Las cerradas no cuentan: son historia, y varias son
-- exactamente lo que se espera de alguien al que hubo que reprogramarle dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entrevista_una_viva_por_postulacion
  ON public.entrevistas_postulacion (postulacion_id)
  WHERE estado = 'agendada';

CREATE INDEX IF NOT EXISTS idx_entrevistas_postulacion_prestadora
  ON public.entrevistas_postulacion (prestadora_id, agendada_para DESC);

COMMENT ON TABLE public.entrevistas_postulacion IS
  'La entrevista de la etapa 3 del Proceso de Incorporacion de Asistentes. Guarda cuando es, quien la agendo, como salio y la sala donde se hizo. El postulante entra con una llave, porque todavia no tiene cuenta.';

COMMENT ON COLUMN public.entrevistas_postulacion.llave_publica IS
  'Lo que el postulante recibe por correo. No es la direccion de la sala: es una direccion del producto, que comprueba que sea la hora antes de dejar entrar.';

-- ---------------------------------------------------------------------------
-- 2. Quién ve qué
-- ---------------------------------------------------------------------------
--
-- Una sola política, y de lectura. Escribe el motor con la llave de servicio, que es el único que
-- sabe si es la hora, el único que arma la llave y el único que le manda el correo al postulante.
-- La condición es la misma que ya vale para `postulaciones`, porque es la misma gente mirando lo
-- mismo: quien puede ver una postulación puede ver su entrevista.
--
-- El postulante no aparece acá y es a propósito: no tiene sesión, así que no hay ninguna fila que
-- una política pueda reconocer como suya. Entra por el motor, con su llave.

ALTER TABLE public.entrevistas_postulacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY panel_lee_entrevistas_postulacion
  ON public.entrevistas_postulacion
  FOR SELECT
  USING (
    (interno.es_superadmin() AND prestadora_id = interno.current_tenant())
    OR (
      prestadora_id = interno.current_tenant()
      AND EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.rol = ANY (ARRAY['admin_prestadora'::text, 'coordinador'::text])
      )
    )
  );

-- El permiso de tabla no es la RLS, y en este esquema una tabla nueva nace con todo dado a `anon`
-- y a `authenticated`. Sin esto, cualquiera con la clave pública leería la llave de todas las
-- entrevistas, que es justamente lo único que protege la entrada del postulante.
REVOKE ALL ON TABLE public.entrevistas_postulacion FROM anon;
REVOKE ALL ON TABLE public.entrevistas_postulacion FROM authenticated;
GRANT SELECT ON TABLE public.entrevistas_postulacion TO authenticated;

NOTIFY pgrst, 'reload schema';

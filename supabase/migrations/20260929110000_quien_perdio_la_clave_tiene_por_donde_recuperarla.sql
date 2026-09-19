--
-- Quien perdió la clave tiene por dónde recuperarla
--
-- No había forma. Quien olvidaba su clave dependía de que un administrador le reenviara la
-- invitación, y el administrador que olvidaba la suya dependía del rol técnico. Esta tabla es lo
-- que guarda el enlace de un solo uso que le llega por correo a quien lo pidió.
--
-- ES EL ESPEJO DE `tokens_activacion_cuenta`, y a propósito: son el mismo problema —un enlace de
-- un solo uso, con vencimiento, que fija una clave— y lo que cambia es de dónde sale. Se guardan
-- aparte porque activar una cuenta que nunca se usó y recuperar una que ya está en uso no son lo
-- mismo: un enlace de activación no debería servir para entrar a una cuenta viva, ni al revés.
--
-- LA TABLA NO LLEVA NINGUNA POLÍTICA, y ésa es la constancia. Nadie con sesión la lee ni la
-- escribe: la usa solamente el motor, que entra con la llave de servicio. Quien pide recuperar su
-- clave todavía no tiene sesión —ése es justamente su problema—, así que no hay a quién darle
-- permiso. Con la protección por fila encendida y sin políticas, cualquiera que llegue con un pase
-- de persona no ve nada, que es lo que corresponde: el enlace guardado acá vale tanto como la
-- clave que reemplaza.
--
-- Y NO TIENE COLUMNA DE PRESTADORA. La cuenta ya dice a cuál pertenece, y ponerla acá sería
-- guardar por segunda vez algo que puede contradecirse. Además, este renglón nace de un correo
-- escrito en la pantalla de ingreso, donde todavía no se sabe de qué Prestadora se trata.
--

CREATE TABLE IF NOT EXISTS public.tokens_recuperacion_clave (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  usuario_id uuid NOT NULL,
  token text NOT NULL,
  expira_en timestamp with time zone NOT NULL,
  usado_en timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT tokens_recuperacion_clave_pkey PRIMARY KEY (id),
  CONSTRAINT tokens_recuperacion_clave_token_key UNIQUE (token),
  CONSTRAINT tokens_recuperacion_clave_usuario_id_fkey
    FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.tokens_recuperacion_clave IS
  'Los enlaces de un solo uso con los que alguien que perdió su clave elige una nueva. Los escribe y los lee únicamente el motor.';

CREATE INDEX IF NOT EXISTS idx_tokens_recuperacion_usuario
  ON public.tokens_recuperacion_clave USING btree (usuario_id);

ALTER TABLE public.tokens_recuperacion_clave ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

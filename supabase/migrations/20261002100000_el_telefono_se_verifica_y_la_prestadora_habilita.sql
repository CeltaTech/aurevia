-- ============================================================================
-- El teléfono se verifica, la Prestadora habilita, y el equipo nuevo pide código
--
-- QUÉ ESTABA MAL. `usuarios.telefono` es un dato que alguien tecleó y que nadie comprobó nunca.
-- Si quedó escrito el número viejo, el código de recuperación se le manda a un desconocido, y con
-- eso ese desconocido entra. Verificarlo es lo que convierte ese dato en una llave.
--
-- LAS TRES PIEZAS QUE TRAE, Y POR QUÉ VAN JUNTAS.
--   1. El código al teléfono, con su vencimiento, su tope de intentos y su tope de pedidos. Sirve
--      para tres cosas distintas —verificar el número, entrar desde un equipo nuevo y recuperar la
--      clave— y es un solo mecanismo, no tres copias.
--   2. Lo que la Prestadora habilita cuando alguien la llama: un cambio de clave que dura poco y
--      sirve una vez, y la confirmación de que un número es de esa persona. **Habilita, no
--      cambia**: acá no se guarda ninguna clave, ni nada con lo que se pueda deducir una.
--   3. Los equipos conocidos. Sin esto no existe «equipo nuevo», y el código al entrar no se puede
--      pedir nunca o hay que pedirlo siempre.
--
-- A NADIE SE LE SACA NADA. Los números ya cargados quedan sin verificar: `telefono_verificado_en`
-- nace nulo para todo el mundo. Esa persona sigue entrando y recuperando la clave por correo, y
-- las vías del teléfono no se le ofrecen hasta que lo verifique.
--
-- ESTO NO ENTRA EN LA CONFIGURACIÓN DE LA PRESTADORA. Cómo se entra y cómo se recupera la clave es
-- igual para todas: acá no hay ninguna columna que lo encienda o lo apague, y no se agrega. Lo
-- único que la Prestadora decide es **quién** atiende ese llamado, que es reparto de trabajo
-- adentro de ella, y para eso está el catálogo de permisos, más abajo.
--
-- NI EL NÚMERO NI EL CÓDIGO SE ESCRIBEN EN NINGÚN REGISTRO. El código no se guarda nunca —se
-- guarda su huella— y `registro_actividad` no admite ninguna clave que lleve un número ni un
-- código: el disparador que ya tiene rechaza lo que no esté en su catálogo, y acá no se le agrega
-- ninguna que pueda llevarlos.
--
-- NINGUNA FUNCIÓN DE POLÍTICA VIVE EN `public` y ningún disparador es `SECURITY DEFINER`
-- (CLAUDE.md del producto §6). Las dos funciones nuevas de política van en `interno`; la que
-- comprueba quién puede habilitar a quién es un disparador común, con permiso de ejecución dado
-- en `interno`, que es la salida escrita en esa misma regla.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. El número queda verificado, o no queda
-- ---------------------------------------------------------------------------

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS telefono_verificado_en timestamp with time zone;

COMMENT ON COLUMN public.usuarios.telefono_verificado_en IS
  'Cuándo se comprobó que este número es de esta persona, escribiendo el código que le llegó a él. Nulo quiere decir sin verificar, y así nacen todos los que ya estaban cargados: esa persona sigue entrando y recuperando por correo, y las vías del teléfono no se le ofrecen.';

-- El número nuevo nace sin verificar, y eso no se le pide a ninguna pantalla.
--
-- Un cambio de número que dejara la marca puesta es exactamente el ataque que esto viene a cerrar:
-- quien se sienta en una máquina abierta escribe su número y se queda con la cuenta. La pantalla
-- además pide la clave actual, pero eso lo hace el motor; acá queda la red de abajo, que no
-- depende de que ninguna pantalla se acuerde.
--
-- NO ES `SECURITY DEFINER`, y no lo necesita: no lee ni escribe ninguna tabla, sólo toca la fila
-- que se está escribiendo. Vive en `interno` porque es la regla de adentro de la base, y se le da
-- ejecución a quien escribe en `usuarios` (CLAUDE.md del producto §6).
CREATE OR REPLACE FUNCTION interno.el_telefono_nuevo_nace_sin_verificar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.telefono IS DISTINCT FROM OLD.telefono THEN
    NEW.telefono_verificado_en := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION interno.el_telefono_nuevo_nace_sin_verificar() FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.el_telefono_nuevo_nace_sin_verificar() FROM anon;
GRANT EXECUTE ON FUNCTION interno.el_telefono_nuevo_nace_sin_verificar() TO authenticated;
GRANT EXECUTE ON FUNCTION interno.el_telefono_nuevo_nace_sin_verificar() TO service_role;

DROP TRIGGER IF EXISTS trg_el_telefono_nuevo_nace_sin_verificar ON public.usuarios;
CREATE TRIGGER trg_el_telefono_nuevo_nace_sin_verificar
  BEFORE UPDATE ON public.usuarios
  FOR EACH ROW
  EXECUTE FUNCTION interno.el_telefono_nuevo_nace_sin_verificar();

-- ---------------------------------------------------------------------------
-- 2. Para qué sirve un código al teléfono. Catálogo, no lista escrita en el código
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalogo_usos_del_codigo_al_telefono (
  uso text PRIMARY KEY,
  orden smallint NOT NULL,
  creado_en timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.catalogo_usos_del_codigo_al_telefono IS
  'Para qué se manda un código al teléfono. Son tres y ninguna Prestadora las cambia: verificar el número, entrar desde un equipo nuevo y recuperar la clave.';

INSERT INTO public.catalogo_usos_del_codigo_al_telefono (uso, orden) VALUES
  ('verificar_el_telefono', 1),
  ('entrar_desde_un_equipo_nuevo', 2),
  ('recuperar_la_clave', 3)
ON CONFLICT (uso) DO NOTHING;

ALTER TABLE public.catalogo_usos_del_codigo_al_telefono ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cualquiera_lee_los_usos_del_codigo_al_telefono
  ON public.catalogo_usos_del_codigo_al_telefono;
CREATE POLICY cualquiera_lee_los_usos_del_codigo_al_telefono
  ON public.catalogo_usos_del_codigo_al_telefono
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.catalogo_usos_del_codigo_al_telefono FROM PUBLIC;
REVOKE ALL ON TABLE public.catalogo_usos_del_codigo_al_telefono FROM anon;
REVOKE ALL ON TABLE public.catalogo_usos_del_codigo_al_telefono FROM authenticated;
GRANT SELECT ON TABLE public.catalogo_usos_del_codigo_al_telefono TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. El código que se le manda al teléfono
-- ---------------------------------------------------------------------------
--
-- EL CÓDIGO NO SE GUARDA. Se guarda su huella, y se compara huella contra huella
-- (`backend/src/utils/codigoDeUnSoloUso.js`). Un código guardado en claro es un secreto que
-- cualquiera con lectura de esta tabla puede usar, y el sentido de todo esto es que no lo haya.
--
-- LA TABLA NO LLEVA NINGUNA POLÍTICA, y ésa es la constancia, igual que en
-- `tokens_recuperacion_clave`. Dos de los tres usos ocurren sin sesión —entrar desde un equipo
-- nuevo y recuperar la clave—, así que no hay a quién darle permiso; y el tercero tampoco lo
-- necesita, porque la pantalla nunca lee esta fila: escribe el código y el motor contesta si sirve
-- o no. Con la protección por fila encendida y sin políticas, nadie con pase de persona ve nada.
--
-- POR QUÉ EL NÚMERO SÍ ESTÁ ACÁ. Es el número que se está verificando, y hay que tenerlo para
-- mandarle el mensaje. No es un registro de actividad ni un rastro: es el dato en curso, bajo RLS
-- cerrada, que se va con la fila. Lo que nunca sale de acá es hacia una dirección web o hacia
-- `registro_actividad`.

CREATE TABLE IF NOT EXISTS public.codigos_al_telefono (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  uso text NOT NULL REFERENCES public.catalogo_usos_del_codigo_al_telefono(uso),
  telefono text NOT NULL,
  codigo_huella text NOT NULL,
  codigo_expira_en timestamp with time zone NOT NULL,
  codigo_intentos smallint NOT NULL DEFAULT 0,
  verificado_en timestamp with time zone,
  anulado_en timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.codigos_al_telefono IS
  'El código corto que se le manda al teléfono de una persona. Se guarda la huella del código, nunca el código. Lo escribe y lo lee únicamente el motor.';
COMMENT ON COLUMN public.codigos_al_telefono.codigo_intentos IS
  'Cuántas veces se probó un código contra este pedido. Es la cuenta del acto, no la del código: pedir uno nuevo no la vuelve a cero. Un código vencido no gasta intento.';
COMMENT ON COLUMN public.codigos_al_telefono.telefono IS
  'El número que se está verificando, que es al que se le manda el mensaje. No viaja a ninguna pantalla ni a ningún registro.';

CREATE INDEX IF NOT EXISTS idx_codigos_al_telefono_usuario
  ON public.codigos_al_telefono USING btree (usuario_id, uso, created_at DESC);

ALTER TABLE public.codigos_al_telefono ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.codigos_al_telefono FROM PUBLIC;
REVOKE ALL ON TABLE public.codigos_al_telefono FROM anon;
REVOKE ALL ON TABLE public.codigos_al_telefono FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. El tope de pedidos por número y por hora
-- ---------------------------------------------------------------------------
--
-- Cada envío cuesta plata, y lo paga la Prestadora. Sin tope, cualquiera desde afuera pide códigos
-- hasta que a ella le llegue la factura. El tope del motor (`middleware/topeDePedidos.js`) no sirve
-- acá: cuenta por persona con sesión, y dos de los tres usos ocurren sin ninguna.
--
-- SE CUENTA POR LA HUELLA DEL NÚMERO, no por el número. Para contar alcanza con saber que es el
-- mismo, y así este renglón —que sí queda un rato— no guarda a quién se le mandó nada.

CREATE TABLE IF NOT EXISTS public.pedidos_de_codigo_al_telefono (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  telefono_huella text NOT NULL,
  pedido_en timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pedidos_de_codigo_al_telefono IS
  'Un renglón por cada código que se mandó, para poder frenar al que pide de más. Guarda la huella del número y no el número: para contar alcanza, y así acá no queda a quién se le mandó nada.';

CREATE INDEX IF NOT EXISTS idx_pedidos_de_codigo_por_numero
  ON public.pedidos_de_codigo_al_telefono USING btree (telefono_huella, pedido_en DESC);

ALTER TABLE public.pedidos_de_codigo_al_telefono ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pedidos_de_codigo_al_telefono FROM PUBLIC;
REVOKE ALL ON TABLE public.pedidos_de_codigo_al_telefono FROM anon;
REVOKE ALL ON TABLE public.pedidos_de_codigo_al_telefono FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4 bis. El mismo tope, para el pedido de clave nueva
-- ---------------------------------------------------------------------------
--
-- Pedir una clave nueva no exige sesión —quien llega ahí perdió justamente la forma de tener una—,
-- así que esa puerta la abre cualquiera desde afuera. Sin tope, cualquiera le llena la casilla de
-- correo a una persona repitiendo el pedido, y cada mensaje lo paga la Prestadora.
--
-- SE CUENTA POR LA HUELLA DEL CORREO Y POR PRESTADORA: la huella porque para contar alcanza con
-- saber que es el mismo, y por Prestadora porque cada Prestadora donde esa persona trabaja es una
-- cuenta distinta, y el tope de una no puede dejar sin recuperar la clave de la otra.
--
-- SE ANOTA EXISTA EL CORREO O NO. Si sólo contaran los correos con cuenta, quedarse sin pedidos
-- sería la señal de que ese correo existe.

CREATE TABLE IF NOT EXISTS public.pedidos_de_clave_nueva (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  correo_huella text NOT NULL,
  pedido_en timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pedidos_de_clave_nueva IS
  'Un renglón por cada pedido de clave nueva, para poder frenar al que pide de más. Guarda la huella del correo y no el correo: para contar alcanza, y así acá no queda quién pidió nada.';

CREATE INDEX IF NOT EXISTS idx_pedidos_de_clave_por_correo
  ON public.pedidos_de_clave_nueva USING btree (prestadora_id, correo_huella, pedido_en DESC);

ALTER TABLE public.pedidos_de_clave_nueva ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pedidos_de_clave_nueva FROM PUBLIC;
REVOKE ALL ON TABLE public.pedidos_de_clave_nueva FROM anon;
REVOKE ALL ON TABLE public.pedidos_de_clave_nueva FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5. Los equipos conocidos, que son los que no piden código
-- ---------------------------------------------------------------------------
--
-- QUÉ ES UN EQUIPO NUEVO. Un aparato que no tiene llave guardada y desde el que nunca se entró.
-- Nada más que eso: no se reconoce el navegador y no se mira desde dónde se conecta. La llave la
-- emite el motor, la guarda el navegador, y acá queda su huella.
--
-- POR QUÉ NO ALCANZA `llaves_de_dispositivo`. Ésa es la llave de huella o cara de las dos
-- aplicaciones de teléfono, y el Panel no la tiene. Además prueba quién es; ésta sólo dice que
-- desde este aparato ya se entró antes.
--
-- LA PERSONA LEE LOS SUYOS Y NADA MÁS, porque necesita verlos para cerrar la sesión de todos los
-- equipos. Escribir es del motor.

CREATE TABLE IF NOT EXISTS public.equipos_conocidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  marca_huella text NOT NULL,
  primera_entrada_en timestamp with time zone NOT NULL DEFAULT now(),
  ultima_entrada_en timestamp with time zone NOT NULL DEFAULT now(),
  revocado_en timestamp with time zone,
  CONSTRAINT equipos_conocidos_marca_unica UNIQUE (usuario_id, marca_huella)
);

COMMENT ON TABLE public.equipos_conocidos IS
  'Los aparatos desde los que esta persona ya entró. Guarda la huella de una marca que emitió el motor y que el navegador conserva, nunca nada del aparato ni de dónde se conecta.';

CREATE INDEX IF NOT EXISTS idx_equipos_conocidos_usuario
  ON public.equipos_conocidos USING btree (usuario_id, ultima_entrada_en DESC);

ALTER TABLE public.equipos_conocidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cada_uno_ve_sus_equipos_conocidos ON public.equipos_conocidos;
CREATE POLICY cada_uno_ve_sus_equipos_conocidos
  ON public.equipos_conocidos
  FOR SELECT
  TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND usuario_id = auth.uid()
  );

REVOKE ALL ON TABLE public.equipos_conocidos FROM PUBLIC;
REVOKE ALL ON TABLE public.equipos_conocidos FROM anon;
REVOKE ALL ON TABLE public.equipos_conocidos FROM authenticated;
GRANT SELECT ON TABLE public.equipos_conocidos TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Quién puede habilitarle un cambio de clave a quién
-- ---------------------------------------------------------------------------
--
-- La regla es una sola y se escribe una sola vez: **se habilita hacia abajo, y nunca a uno mismo**.
-- El rol técnico de la empresa habilita a la administración; la administración, a quien coordina y
-- a la gente de las aplicaciones; quien coordina, a la gente de las aplicaciones. A ella misma no
-- la habilita nadie de su propio escalón, y por eso hay un escalón arriba.
--
-- Vive en `interno` y no en `public`: la usan un disparador y nada más, y `public` es además una
-- dirección web.
CREATE OR REPLACE FUNCTION interno.escalon_del_rol(p_rol text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_rol
    WHEN 'superadmin' THEN 4::smallint
    WHEN 'admin_prestadora' THEN 3::smallint
    WHEN 'coordinador' THEN 2::smallint
    WHEN 'asistente' THEN 1::smallint
    WHEN 'familia' THEN 1::smallint
    -- Falla cerrado: un rol que no se entiende no está por debajo de nadie, así que nadie lo
    -- habilita y él no habilita a nadie (CLAUDE.md de la empresa §5).
    ELSE 9::smallint
  END
$$;

REVOKE ALL ON FUNCTION interno.escalon_del_rol(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.escalon_del_rol(text) FROM anon;
GRANT EXECUTE ON FUNCTION interno.escalon_del_rol(text) TO authenticated;
GRANT EXECUTE ON FUNCTION interno.escalon_del_rol(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Lo que la Prestadora habilita cuando alguien la llama
-- ---------------------------------------------------------------------------
--
-- ELLA HABILITA, NO CAMBIA. Acá no hay ninguna columna con una clave, ni con una huella de clave,
-- ni con nada que sirva para elegir una. Lo que se guarda es que se abrió una puerta, para quién,
-- quién la abrió, hasta cuándo dura y si ya se usó. La clave la elige la persona del otro lado del
-- teléfono, sola, como en cualquier recuperación por correo.
--
-- DURA POCO Y SIRVE UNA VEZ. El cuánto no está escrito acá: lo pone el motor al insertar, porque es
-- la misma decisión que ya toman los enlaces de recuperación y no se escribe dos veces.

CREATE TABLE IF NOT EXISTS public.cambios_de_clave_habilitados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  habilitado_por uuid NOT NULL REFERENCES public.usuarios(id),
  expira_en timestamp with time zone NOT NULL,
  usado_en timestamp with time zone,
  anulado_en timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT cambios_de_clave_habilitados_no_a_uno_mismo CHECK (usuario_id <> habilitado_por)
);

COMMENT ON TABLE public.cambios_de_clave_habilitados IS
  'La puerta que la Prestadora le abre a alguien que llamó porque no puede entrar. Dura poco, sirve una vez, y no guarda ninguna clave ni nada con que deducirla: quien habilita nunca elige ni ve la clave de nadie.';

CREATE INDEX IF NOT EXISTS idx_cambios_de_clave_habilitados_usuario
  ON public.cambios_de_clave_habilitados USING btree (usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cambios_de_clave_habilitados_prestadora
  ON public.cambios_de_clave_habilitados USING btree (prestadora_id, created_at DESC);

-- La confirmación de que un número es de esa persona, hecha por quien la conoce.
--
-- Es el atajo del paso 17: si quien atiende el llamado confirma que ese número es de esa persona,
-- el número queda habilitado en el momento y no espera nada. Se guarda la huella del número y no
-- el número: lo que hay que poder contestar es «¿este número que estoy por usar es el que
-- confirmaron?», y para eso alcanza la huella.
CREATE TABLE IF NOT EXISTS public.telefonos_confirmados_por_la_prestadora (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  confirmado_por uuid NOT NULL REFERENCES public.usuarios(id),
  telefono_huella text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT telefonos_confirmados_no_a_uno_mismo CHECK (usuario_id <> confirmado_por),
  CONSTRAINT telefonos_confirmados_uno_por_numero UNIQUE (usuario_id, telefono_huella)
);

COMMENT ON TABLE public.telefonos_confirmados_por_la_prestadora IS
  'Quien atiende el llamado confirma que ese número es de esa persona, y con eso el número no espera nada para servir de llave. Guarda la huella del número, no el número.';

-- El mismo control para las dos tablas, escrito una sola vez.
--
-- NO ES `SECURITY DEFINER`, y no lo necesita. Corre con el rol de quien escribe, y quien escribe es
-- el motor con la llave de servicio: las dos consultas de adentro las alcanza sin privilegio
-- prestado. Convertirlo en `SECURITY DEFINER` sumaría código con privilegio de dueño y le sacaría
-- la protección por fila a lo que consulta (CLAUDE.md del producto §6).
CREATE OR REPLACE FUNCTION interno.se_habilita_hacia_abajo_y_nunca_a_uno_mismo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'interno'
AS $$
DECLARE
  v_destinatario record;
  v_quien record;
  v_quien_id uuid;
BEGIN
  v_quien_id := CASE TG_TABLE_NAME
    WHEN 'cambios_de_clave_habilitados' THEN NEW.habilitado_por
    ELSE NEW.confirmado_por
  END;

  SELECT rol, prestadora_id INTO v_destinatario FROM public.usuarios WHERE id = NEW.usuario_id;
  SELECT rol, prestadora_id INTO v_quien FROM public.usuarios WHERE id = v_quien_id;

  -- Falla cerrado ante cualquier cosa que no se pudo resolver.
  IF v_destinatario IS NULL OR v_quien IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver quién habilita a quién';
  END IF;

  -- Las dos cuentas son de la Prestadora de la fila, y de ninguna otra. El rol técnico de la
  -- empresa no tiene Prestadora propia, y por eso queda exceptuado del lado de quien habilita.
  IF v_destinatario.prestadora_id IS DISTINCT FROM NEW.prestadora_id THEN
    RAISE EXCEPTION 'La cuenta no es de esa Prestadora';
  END IF;
  IF v_quien.rol <> 'superadmin' AND v_quien.prestadora_id IS DISTINCT FROM NEW.prestadora_id THEN
    RAISE EXCEPTION 'Quien habilita no es de esa Prestadora';
  END IF;

  IF interno.escalon_del_rol(v_quien.rol) <= interno.escalon_del_rol(v_destinatario.rol) THEN
    RAISE EXCEPTION 'Nadie habilita a su propio escalón ni a uno de más arriba';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION interno.se_habilita_hacia_abajo_y_nunca_a_uno_mismo() FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.se_habilita_hacia_abajo_y_nunca_a_uno_mismo() FROM anon;
GRANT EXECUTE ON FUNCTION interno.se_habilita_hacia_abajo_y_nunca_a_uno_mismo() TO authenticated;
GRANT EXECUTE ON FUNCTION interno.se_habilita_hacia_abajo_y_nunca_a_uno_mismo() TO service_role;

DROP TRIGGER IF EXISTS trg_se_habilita_hacia_abajo ON public.cambios_de_clave_habilitados;
CREATE TRIGGER trg_se_habilita_hacia_abajo
  BEFORE INSERT ON public.cambios_de_clave_habilitados
  FOR EACH ROW
  EXECUTE FUNCTION interno.se_habilita_hacia_abajo_y_nunca_a_uno_mismo();

DROP TRIGGER IF EXISTS trg_se_confirma_hacia_abajo ON public.telefonos_confirmados_por_la_prestadora;
CREATE TRIGGER trg_se_confirma_hacia_abajo
  BEFORE INSERT ON public.telefonos_confirmados_por_la_prestadora
  FOR EACH ROW
  EXECUTE FUNCTION interno.se_habilita_hacia_abajo_y_nunca_a_uno_mismo();

-- Las dos las lee la administración de la Prestadora, para saber qué se habilitó y quién lo hizo.
-- Escribir es del motor, que antes comprueba el permiso de quien lo pide.
ALTER TABLE public.cambios_de_clave_habilitados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telefonos_confirmados_por_la_prestadora ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS la_administracion_lee_los_cambios_habilitados
  ON public.cambios_de_clave_habilitados;
CREATE POLICY la_administracion_lee_los_cambios_habilitados
  ON public.cambios_de_clave_habilitados
  FOR SELECT
  TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND (interno.es_superadmin() OR interno.es_la_administracion_de_la_prestadora(prestadora_id))
  );

DROP POLICY IF EXISTS la_administracion_lee_los_telefonos_confirmados
  ON public.telefonos_confirmados_por_la_prestadora;
CREATE POLICY la_administracion_lee_los_telefonos_confirmados
  ON public.telefonos_confirmados_por_la_prestadora
  FOR SELECT
  TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND (interno.es_superadmin() OR interno.es_la_administracion_de_la_prestadora(prestadora_id))
  );

REVOKE ALL ON TABLE public.cambios_de_clave_habilitados FROM PUBLIC;
REVOKE ALL ON TABLE public.cambios_de_clave_habilitados FROM anon;
REVOKE ALL ON TABLE public.cambios_de_clave_habilitados FROM authenticated;
GRANT SELECT ON TABLE public.cambios_de_clave_habilitados TO authenticated;

REVOKE ALL ON TABLE public.telefonos_confirmados_por_la_prestadora FROM PUBLIC;
REVOKE ALL ON TABLE public.telefonos_confirmados_por_la_prestadora FROM anon;
REVOKE ALL ON TABLE public.telefonos_confirmados_por_la_prestadora FROM authenticated;
GRANT SELECT ON TABLE public.telefonos_confirmados_por_la_prestadora TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Habilitar un cambio de clave entra al catálogo de permisos
-- ---------------------------------------------------------------------------
--
-- SALE DE FÁBRICA RESERVADA A ADMINISTRACIÓN (`default_solo_admin = true`), con el mismo molde que
-- `ver_pagos_asistente`. Quién atiende el llamado es reparto de trabajo adentro de la Prestadora y
-- eso sí lo decide ella; lo que no se configura en ningún lado es si la verificación se exige.

INSERT INTO public.catalogo_acciones_permisos (accion, default_solo_admin, orden)
SELECT 'habilitar_cambio_de_clave', true,
       (SELECT COALESCE(MAX(orden), 0) + 1 FROM public.catalogo_acciones_permisos)::smallint
 WHERE NOT EXISTS (
   SELECT 1 FROM public.catalogo_acciones_permisos WHERE accion = 'habilitar_cambio_de_clave'
 );

-- ---------------------------------------------------------------------------
-- 9. Todo esto queda registrado: quién, a quién y cuándo
-- ---------------------------------------------------------------------------
--
-- NUNCA EL CÓDIGO, NI LA CLAVE, NI EL NÚMERO. El disparador que ya tiene `registro_actividad`
-- rechaza cualquier clave de `detalle` que no esté en su catálogo, y acá no se agrega ninguna que
-- pueda llevarlos: la única que se suma es por cuál vía salió el código, que es «whatsapp» o
-- «correo» y nada más.

INSERT INTO public.catalogo_acciones_registradas (accion, grupo, orden)
SELECT v.accion, v.grupo,
       (SELECT COALESCE(MAX(orden), 0) FROM public.catalogo_acciones_registradas)::smallint + v.n
  FROM (VALUES
    ('verificacion_de_telefono',              'modificacion_critica',   1),
    ('cambio_de_telefono',                    'modificacion_critica',   2),
    ('entrada_desde_un_equipo_nuevo',         'entrada_administrativa', 3),
    ('recuperacion_de_clave',                 'modificacion_critica',   4),
    ('habilitacion_de_cambio_de_clave',       'permisos_y_membresia',   5),
    ('confirmacion_de_telefono_por_la_prestadora', 'permisos_y_membresia', 6),
    ('cierre_de_sesion_de_todos_los_equipos', 'modificacion_critica',   7)
  ) AS v(accion, grupo, n)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.catalogo_acciones_registradas c WHERE c.accion = v.accion
 );

INSERT INTO public.catalogo_datos_del_registro (clave, orden)
SELECT v.clave,
       (SELECT COALESCE(MAX(orden), 0) FROM public.catalogo_datos_del_registro)::smallint + v.n
  FROM (VALUES ('via', 1)) AS v(clave, n)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.catalogo_datos_del_registro c WHERE c.clave = v.clave
 );

-- ---------------------------------------------------------------------------
-- 10. El tope de intentos cuenta también para esta tabla
-- ---------------------------------------------------------------------------
--
-- Se agrega la tabla nueva a la función que ya existe, en vez de escribir una segunda. La lista
-- sigue cerrada y escrita a mano: la función no arma ninguna consulta con lo que le pasan.

CREATE OR REPLACE FUNCTION public.sumar_intento_de_codigo(p_tabla text, p_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intentos integer;
BEGIN
  IF p_tabla = 'instrucciones_acceso_circulo' THEN
    UPDATE public.instrucciones_acceso_circulo
       SET codigo_intentos = codigo_intentos + 1
     WHERE id = p_id
    RETURNING codigo_intentos INTO v_intentos;

  ELSIF p_tabla = 'guardia_comprobaciones' THEN
    UPDATE public.guardia_comprobaciones
       SET codigo_intentos = codigo_intentos + 1,
           updated_at = now()
     WHERE id = p_id
    RETURNING codigo_intentos INTO v_intentos;

  ELSIF p_tabla = 'codigos_al_telefono' THEN
    UPDATE public.codigos_al_telefono
       SET codigo_intentos = codigo_intentos + 1
     WHERE id = p_id
    RETURNING codigo_intentos INTO v_intentos;

  ELSE
    RAISE EXCEPTION 'sumar_intento_de_codigo: esa tabla no lleva cuenta de intentos';
  END IF;

  -- Si no se actualizó ninguna fila, `v_intentos` queda nulo. Se devuelve así a propósito: quien
  -- llama trata el nulo como "se agotaron", que es lo que corresponde cuando no se pudo contar.
  RETURN v_intentos;
END;
$$;

REVOKE ALL ON FUNCTION public.sumar_intento_de_codigo(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sumar_intento_de_codigo(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sumar_intento_de_codigo(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sumar_intento_de_codigo(text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Una sola lista de qué acciones quedan reservadas al administrador (pendiente #127).
--
-- El problema: esa lista estaba escrita en tres lugares distintos y los tres decían cosas
-- distintas. La base reservaba dos acciones, el motor cinco, y la pantalla donde el
-- administrador configura los permisos mostraba tres. O sea que la pantalla le mostraba a
-- la Prestadora un estado que no era el que el sistema aplicaba: decía que un Coordinador
-- podía ver lo que se le paga a cada Asistente cuando en realidad el motor se lo negaba.
-- Es exactamente lo que prohíbe la regla 12 del §7 de CLAUDE.md — la misma decisión escrita
-- más de una vez.
--
-- La solución tiene dos partes:
--
--   1. La lista pasa a ser una tabla. Deja de estar escrita adentro de un programa y pasa a
--      ser un dato, que es lo que la regla 1 del §7 pide para toda regla operativa.
--
--   2. La decisión pasa a estar programada una sola vez, acá adentro, en `tiene_permiso_de`.
--      Las reglas de acceso de la base la usan a través de `tiene_permiso`, y el motor la
--      usa desde Express. Ninguno de los dos vuelve a tener su propia copia. Esto es lo que
--      la regla 12 manda hacer cuando los puntos que comparten una decisión no pueden
--      compartir código: el punto único de verdad es una función de la base.
--
-- Qué cambia de comportamiento: nada en lo que el sistema efectivamente permite o niega hoy.
-- Las tres acciones que las reglas de acceso de la base consultan de verdad
-- (`editar_identidad_asistente`, `editar_datos_familia`, `editar_datos_paciente`) mantienen
-- el mismo valor por defecto que tenían. Lo que se corrige es la pantalla, que dejaba de
-- decir la verdad, y el desacuerdo latente: el día que alguien agregara una regla de acceso
-- para una de las otras cinco acciones, la base habría contestado lo contrario que el motor.

-- ---------------------------------------------------------------------------------------
-- 1. El catálogo
-- ---------------------------------------------------------------------------------------

-- Es un catálogo de la plataforma, no de cada Prestadora: por eso no lleva `prestadora_id`.
-- Lo que cada Prestadora decide encima de este valor por defecto sigue viviendo, como
-- siempre, en `permisos_prestadora`.
--
-- Guarda solamente identificadores, nunca texto que alguien lea: el nombre que se muestra en
-- pantalla para cada acción sale de los archivos de traducción, en los tres idiomas
-- (regla 1 del §7).
CREATE TABLE IF NOT EXISTS catalogo_acciones_permisos (
  accion             TEXT PRIMARY KEY,
  -- Verdadero: si la Prestadora no configuró nada, la acción queda solo para el
  -- administrador. Falso: si no configuró nada, el Coordinador también puede.
  default_solo_admin BOOLEAN  NOT NULL,
  -- En qué orden aparecen en la pantalla de configuración de permisos.
  orden              SMALLINT NOT NULL,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE catalogo_acciones_permisos IS
  'Las acciones que una Prestadora puede reservar al administrador, y qué pasa cuando no configuró nada. Punto único de verdad del valor por defecto (pendiente #127).';

INSERT INTO catalogo_acciones_permisos (accion, default_solo_admin, orden) VALUES
  -- Dar de alta a mano crea una persona en el sistema sin que haya pasado por el proceso de
  -- incorporación. Queda para el administrador.
  ('alta_manual_asistente',       TRUE,  1),
  ('alta_manual_familia',         TRUE,  2),
  -- Corregir datos del día a día es trabajo de Coordinación: si la Prestadora no dijo nada,
  -- el Coordinador puede.
  ('editar_identidad_asistente',  FALSE, 3),
  ('editar_datos_familia',        FALSE, 4),
  ('editar_datos_paciente',       FALSE, 5),
  -- Una importación masiva toca muchos registros de una vez y es difícil de deshacer.
  ('importar_datos_masivos',      TRUE,  6),
  -- Dar por bueno un informe que se le presenta a una Obra Social es lo que habilita el
  -- cobro. Queda para el administrador.
  ('validar_informe_obra_social', TRUE,  7),
  -- Lo que se le paga a cada Asistente es dato sensible (§6 de CLAUDE.md, "remuneraciones"):
  -- si la Prestadora no dijo nada, no se muestra.
  ('ver_pagos_asistente',         TRUE,  8)
ON CONFLICT (accion) DO UPDATE
  SET default_solo_admin = EXCLUDED.default_solo_admin,
      orden              = EXCLUDED.orden;

ALTER TABLE catalogo_acciones_permisos ENABLE ROW LEVEL SECURITY;

-- Se lee, no se escribe. Son ocho identificadores iguales para todas las Prestadoras; no hay
-- nada que aislar y no hay nada que una Prestadora deba poder cambiar. Se modifica desde una
-- migración, que es donde se agrega una acción nueva junto con el código que la usa.
DROP POLICY IF EXISTS cualquiera_lee_catalogo_acciones_permisos ON catalogo_acciones_permisos;
CREATE POLICY cualquiera_lee_catalogo_acciones_permisos
  ON catalogo_acciones_permisos FOR SELECT TO authenticated
  USING (TRUE);

-- ---------------------------------------------------------------------------------------
-- 2. Que no pueda volver a haber una acción por fuera del catálogo
-- ---------------------------------------------------------------------------------------

-- Antes de atar las dos tablas, comprobar que no haya quedado configurada una acción con un
-- nombre que el catálogo no conoce. Si la hubiera, esta migración se detiene con un mensaje
-- legible en vez de romper algo a medias.
DO $$
DECLARE v_sueltas TEXT;
BEGIN
  SELECT string_agg(DISTINCT p.accion, ', ') INTO v_sueltas
  FROM permisos_prestadora p
  WHERE NOT EXISTS (SELECT 1 FROM catalogo_acciones_permisos c WHERE c.accion = p.accion);

  IF v_sueltas IS NOT NULL THEN
    RAISE EXCEPTION
      'Hay permisos configurados con acciones que no están en el catálogo: %. Hay que agregarlas al catálogo o borrar esas filas antes de aplicar esta migración.',
      v_sueltas;
  END IF;
END $$;

ALTER TABLE permisos_prestadora
  DROP CONSTRAINT IF EXISTS permisos_prestadora_accion_fkey;
ALTER TABLE permisos_prestadora
  ADD CONSTRAINT permisos_prestadora_accion_fkey
  FOREIGN KEY (accion) REFERENCES catalogo_acciones_permisos(accion);

-- ---------------------------------------------------------------------------------------
-- 3. La decisión, programada una sola vez
-- ---------------------------------------------------------------------------------------

-- Recibe de quién se trata en vez de averiguarlo sola. Así la usan los dos lados: las reglas
-- de acceso de la base le pasan quien está conectado, y el motor —que corre en Express con
-- la clave de servicio, donde no hay nadie conectado— le pasa el usuario que hizo el pedido.
-- Antes esa segunda parte no existía y por eso el motor tenía su propia copia.
CREATE OR REPLACE FUNCTION tiene_permiso_de(p_usuario UUID, p_accion TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rol           TEXT;
  v_prestadora_id UUID;
  v_cfg           permisos_prestadora;
  v_solo_admin    BOOLEAN;
BEGIN
  SELECT rol, prestadora_id INTO v_rol, v_prestadora_id FROM usuarios WHERE id = p_usuario;

  IF v_rol IN ('admin_prestadora', 'superadmin') THEN
    RETURN TRUE;
  END IF;
  IF v_rol IS DISTINCT FROM 'coordinador' THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_cfg FROM permisos_prestadora
    WHERE prestadora_id = v_prestadora_id AND accion = p_accion;

  -- La Prestadora no configuró nada para esta acción: manda el valor por defecto del
  -- catálogo. Si la acción ni siquiera está en el catálogo, la respuesta es que no: un
  -- nombre mal escrito no puede terminar abriendo un permiso.
  IF NOT FOUND THEN
    SELECT default_solo_admin INTO v_solo_admin
      FROM catalogo_acciones_permisos WHERE accion = p_accion;
    RETURN NOT COALESCE(v_solo_admin, TRUE);
  END IF;

  IF p_usuario = ANY(v_cfg.excepciones_denegar)  THEN RETURN FALSE; END IF;
  IF p_usuario = ANY(v_cfg.excepciones_permitir) THEN RETURN TRUE;  END IF;
  RETURN v_cfg.alcance = 'admin_y_coordinador';
END;
$$;

COMMENT ON FUNCTION tiene_permiso_de(UUID, TEXT) IS
  'Si un usuario tiene permitida una acción. Único lugar donde está programada esa decisión: la usan las reglas de acceso de la base y también el motor (pendiente #127).';

-- La forma que ya usaban las reglas de acceso de la base, ahora sin lógica propia: pregunta
-- por quien está conectado. Se mantiene con el mismo nombre y la misma firma justamente para
-- no tener que tocar ninguna de esas reglas.
CREATE OR REPLACE FUNCTION tiene_permiso(p_accion TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT tiene_permiso_de(auth.uid(), p_accion);
$$;

-- Las ocho respuestas de una sola vez. Existe para que el Panel no tenga que preguntar ocho
-- veces seguidas cuando dibuja el menú y decide qué botones muestra.
CREATE OR REPLACE FUNCTION permisos_efectivos_de(p_usuario UUID)
RETURNS JSONB
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_object_agg(c.accion, tiene_permiso_de(p_usuario, c.accion)), '{}'::JSONB)
  FROM catalogo_acciones_permisos c;
$$;

NOTIFY pgrst, 'reload schema';

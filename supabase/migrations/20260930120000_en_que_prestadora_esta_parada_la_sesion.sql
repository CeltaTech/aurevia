--
-- En qué Prestadora está parada la sesión
--
-- Con la membresía, una persona puede ser parte de varias Prestadoras. Pero trabaja en una por
-- vez: la pantalla muestra los pacientes de una, las guardias de una y la configuración de una.
-- Falta decir en cuál está parada, y eso es lo que nace acá.
--
-- LO ESCRIBE EL SERVIDOR, NUNCA EL PEDIDO. La tabla tiene política de lectura y ninguna de
-- escritura, así que desde el navegador no se toca: la fila la pone el motor, con su llave, después
-- de comprobar que esa persona tiene membresía en esa Prestadora. Un encabezado, un subdominio o
-- un parámetro los falsifica quien llama, y por eso ninguno de los tres decide acá.
--
-- Y LA COMPROBACIÓN SE REPITE AL LEER. `current_tenant()` no se fía de la fila: la cruza contra la
-- membresía cada vez. Si alguien perdió la membresía —o si la fila quedara escrita por error—, la
-- Prestadora parada deja de valer sola, sin que haga falta salir a limpiar nada.
--
-- LA PRECEDENCIA SON TRES ESCALONES Y EL ORDEN IMPORTA. Primero la sesión de soporte técnico, que
-- ya estaba y no cambia: mientras está abierta manda ella, porque es la única puerta de CeltaTech
-- hacia los datos de un cliente y tiene que tapar cualquier otra cosa. Después la Prestadora
-- parada. Y último lo que dice la cuenta, que es lo que sigue valiendo para quien todavía no
-- eligió ninguna. Ese tercer escalón se retira al final de este paso, junto con la columna.
--

CREATE TABLE IF NOT EXISTS public.prestadora_de_la_sesion (
  usuario_id     uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  prestadora_id  uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  elegida_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.prestadora_de_la_sesion IS
  'En qué Prestadora está parada cada persona. Una por vez. La escribe el motor tras comprobar la membresía; desde el navegador no se escribe.';

ALTER TABLE public.prestadora_de_la_sesion ENABLE ROW LEVEL SECURITY;

-- Se lee la propia y nada más. No hay política de escritura a propósito: ver el encabezado.
DROP POLICY IF EXISTS cada_uno_ve_donde_esta_parado ON public.prestadora_de_la_sesion;
CREATE POLICY cada_uno_ve_donde_esta_parado ON public.prestadora_de_la_sesion
  FOR SELECT TO authenticated
  USING (usuario_id = auth.uid());

-- La precedencia, en un solo lugar. Los ciento sesenta lugares que preguntan en qué Prestadora
-- están siguen preguntando igual; lo que cambió es qué se mira para contestarles.
CREATE OR REPLACE FUNCTION interno.current_tenant()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'interno'
AS $$
  SELECT COALESCE(
    -- 1. La sesión de soporte técnico, mientras está viva. Tapa todo lo demás.
    (SELECT s.prestadora_id FROM sesiones_soporte_tecnico s
      WHERE s.admin_id = auth.uid()
        AND s.salida_at IS NULL
        AND s.expira_at > NOW()
        AND s.ultima_actividad_at > NOW() - INTERVAL '5 minutes'
      ORDER BY s.entrada_at DESC LIMIT 1),

    -- 2. Donde eligió pararse, si sigue siendo parte de esa Prestadora.
    (SELECT e.prestadora_id FROM prestadora_de_la_sesion e
      JOIN membresias m
        ON m.usuario_id = e.usuario_id
       AND m.prestadora_id = e.prestadora_id
     WHERE e.usuario_id = auth.uid()),

    -- 3. Lo que dice la cuenta. Se retira al final de este paso.
    (SELECT prestadora_id FROM usuarios WHERE id = auth.uid())
  )
$$;

NOTIFY pgrst, 'reload schema';

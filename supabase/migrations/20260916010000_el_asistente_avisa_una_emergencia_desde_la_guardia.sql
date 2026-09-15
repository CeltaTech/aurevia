-- El Asistente avisa una emergencia desde la guardia.
-- ===================================================
--
-- QUÉ FALTABA. Durante una guardia puede pasar algo que no admite esperar: una caída, una
-- descompensación, un accidente del propio Asistente. Hasta hoy el producto no tenía por dónde
-- decirlo. Lo que había era el Reporte Diario, que se escribe al cerrar, y el aviso de demora, que
-- es de antes de llegar. Quien estaba adentro de la casa con un problema tenía que salirse del
-- producto y llamar por teléfono, y de eso no quedaba constancia en ningún lado.
--
-- POR QUÉ NO SE REUTILIZA NINGUNA TABLA DE LAS QUE HAY. `alertas` es de la revisión automática de
-- los reportes: cuelga del Paciente, sus columnas hablan de qué reportes se analizaron, y **la
-- Familia la lee** cuando la Prestadora deja encendido ese interruptor. Una emergencia entrando
-- por ahí se le aparecería a la Familia bajo el rótulo de la revisión automática, antes de que
-- nadie la haya atendido. `alertas_tempranas_guardia` es señal de que una guardia puede quedar sin
-- cubrir, se muestra en la pantalla de Continuidad y sus motivos son estadística de ausentismo:
-- una emergencia adentro ensuciaría las dos cosas.
--
-- EL DETALLE ES TEXTO LIBRE Y OBLIGATORIO, Y NO HAY LISTA DE TIPOS. Ninguna lista de emergencias
-- escrita de antemano le va a servir a quien está en el medio de una: elegir de un desplegable
-- cuesta más que escribir, y el que no encuentra su caso pierde tiempo buscándolo. Además, una
-- taxonomía de emergencias es una decisión de negocio de la Prestadora y no se inventa acá
-- (`celtatech/CLAUDE.md` §4). El día que haga falta clasificarlas, se agrega una columna de código
-- al lado del detalle, que ya va a estar escrito.
--
-- Y ESE DETALLE NO SALE HACIA AFUERA. El aviso que le llega al Coordinador por WhatsApp o por
-- correo dice que hay una emergencia, de qué guardia y de cuándo, y nada más: el texto lo escribió
-- alguien que está mirando a un Paciente, así que es información sensible y no viaja por un canal
-- público (`celtatech/CLAUDE.md` §6). Se lee entrando al Panel.
--
-- EL PACIENTE NO ES UNA COLUMNA DE ESTA TABLA. La guardia ya dice a quién se está cuidando, y la
-- emergencia puede ser del Asistente y no del Paciente. Una columna que hoy nadie llenaría haría
-- creer que el formulario pregunta algo que no pregunta.
--
-- QUE SE ATIENDA ES PARTE DEL DATO. Un aviso que nadie marca como atendido no se distingue de uno
-- que quedó sin leer, y eso es justamente lo que hay que poder mirar al día siguiente. Por eso la
-- fila guarda quién la atendió, cuándo, y qué se hizo.

-- ---------------------------------------------------------------------------
-- 1. La emergencia
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.emergencias_guardia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  guardia_id uuid NOT NULL,

  -- Quién la reportó y cuándo. El momento es el que manda el teléfono si el aviso venía en la cola
  -- sin conexión, porque lo que importa es cuándo pasó y no cuándo se pudo enviar.
  reportado_por uuid NOT NULL,
  reportado_at timestamptz NOT NULL DEFAULT now(),

  -- Qué está pasando, escrito por quien está ahí. Obligatorio: un aviso sin texto no le sirve a
  -- nadie para decidir qué hacer.
  detalle text NOT NULL CHECK (length(btrim(detalle)) > 0),

  -- Cómo terminó. Mientras `atendida_at` esté en blanco, el aviso sigue esperando a alguien.
  atendida_at timestamptz,
  atendida_por uuid,
  atendida_nota text,

  -- Lo mismo que lleva una alerta temprana, y por el mismo motivo: si el aviso inmediato no salió,
  -- esto queda en blanco y el proceso de fondo lo reintenta.
  ultima_notificacion_at timestamptz,
  veces_notificado integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- La guardia se referencia junto con su Prestadora, para que ninguna fila pueda apuntar a una
  -- guardia de otra Organización.
  CONSTRAINT emergencias_guardia_guardia_fkey
    FOREIGN KEY (guardia_id, prestadora_id)
    REFERENCES public.guardias (id, prestadora_id) ON DELETE CASCADE
);

-- Lo que mira el Panel es siempre lo mismo: qué hay sin atender, lo más nuevo arriba.
CREATE INDEX IF NOT EXISTS idx_emergencias_guardia_sin_atender
  ON public.emergencias_guardia (prestadora_id, reportado_at DESC)
  WHERE atendida_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_emergencias_guardia_por_guardia
  ON public.emergencias_guardia (guardia_id);

COMMENT ON TABLE public.emergencias_guardia IS
  'Lo que el Asistente avisa desde la Guardia Activa cuando pasa algo que no admite esperar. No es la revision automatica de reportes ni la alerta de guardia sin cubrir: es un aviso de una persona, en el momento, que alguien tiene que atender.';

COMMENT ON COLUMN public.emergencias_guardia.detalle IS
  'Texto libre escrito por quien esta ahi. Es informacion sensible: no viaja en el aviso que sale por WhatsApp ni por correo, se lee entrando al Panel.';

COMMENT ON COLUMN public.emergencias_guardia.reportado_at IS
  'Cuando paso, no cuando se pudo enviar. Un aviso guardado en la cola sin conexion conserva el momento del telefono.';

-- ---------------------------------------------------------------------------
-- 2. Quién ve qué
-- ---------------------------------------------------------------------------
--
-- Escribe el motor con la llave de servicio, así que las políticas son de lectura y son la segunda
-- red. Las condiciones son las mismas que ya valen para `alertas_tempranas_guardia`, porque es la
-- misma gente mirando guardias: el Coordinador alcanza las de las zonas que atiende, y la
-- administración de la Prestadora las de toda su Organización.
--
-- El Asistente no aparece acá: reporta por el motor, y después no vuelve a leer lo que reportó.
-- La Familia tampoco, y eso es a propósito: quién avisa a una Familia de una emergencia, y con qué
-- palabras, es una decisión de la Prestadora y no una consecuencia de que el dato exista.

ALTER TABLE public.emergencias_guardia ENABLE ROW LEVEL SECURITY;

CREATE POLICY coordinador_lee_emergencias_de_su_zona
  ON public.emergencias_guardia
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      JOIN public.guardias g ON g.id = emergencias_guardia.guardia_id
      JOIN public.asistentes a ON a.id = g.asistente_id
      WHERE u.id = auth.uid()
        AND u.rol = 'coordinador'::text
        AND u.zonas && a.zonas
    )
  );

CREATE POLICY panel_lee_emergencias_guardia
  ON public.emergencias_guardia
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND (
      interno.es_superadmin()
      OR EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text
      )
    )
  );

-- El permiso de tabla no es la RLS, y en este esquema una tabla nueva nace con todo dado a `anon`
-- y a `authenticated`. Sin esto, cualquiera con la clave pública leería el detalle de todas las
-- emergencias de todas las Organizaciones.
REVOKE ALL ON TABLE public.emergencias_guardia FROM anon;
REVOKE ALL ON TABLE public.emergencias_guardia FROM authenticated;
GRANT SELECT ON TABLE public.emergencias_guardia TO authenticated;

NOTIFY pgrst, 'reload schema';

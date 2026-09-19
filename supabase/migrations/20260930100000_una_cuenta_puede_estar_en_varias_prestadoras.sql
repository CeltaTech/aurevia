--
-- Una cuenta puede estar en varias Prestadoras
--
-- Hasta acá la cuenta era de una Prestadora: `usuarios` guardaba `prestadora_id` y `rol` como si
-- cada persona trabajara en una sola y siempre con el mismo papel. La misma persona que cuida en
-- dos Prestadoras necesitaba dos cuentas, con dos correos, y las dos aplicaciones de teléfono no
-- tenían forma de mostrarle su semana entera.
--
-- LO QUE NACE ACÁ ES LA MEMBRESÍA: una fila por persona y por Prestadora, con el rol adentro. Es
-- lo que permite que alguien coordine en una y asista en otra sin que ninguna de las dos se
-- entere de la otra. La cuenta queda con lo que es de la persona; dónde trabaja y con qué papel
-- pasa a ser un vínculo, que es lo que siempre fue.
--
-- LAS DOS COLUMNAS VIEJAS NO SE BORRAN TODAVÍA, Y TODAVÍA SON LA VERDAD. Hoy las leen la función
-- que resuelve la Prestadora de la sesión, los tres controles de entrada y setenta y cuatro
-- archivos de rutas; borrarlas en esta migración dejaría el producto sin poder abrirse. Se
-- retiran en la última migración de este paso, cuando el último lector haya pasado a la
-- membresía, y ahí la membresía queda sola.
--
-- MIENTRAS TANTO LAS DOS SE ESCRIBEN JUNTAS, EN UN SOLO LUGAR. Una cuenta nace en un único punto
-- del motor —`backend/src/utils/cuentasPanel.js`, `crearCuentaConPerfil`—, y ahí se escriben la
-- fila de la cuenta y su membresía en la misma operación: si la segunda falla, el alta entera se
-- deshace. No hay disparador que lo haga por atrás: `usuarios` no tiene política de escritura, y
-- un disparador que la actualizara no afectaría ninguna fila y nadie se enteraría. Darle
-- privilegio de dueño al disparador para esquivar eso está prohibido en este producto, y con
-- razón.
--
-- EL CORREO ÚNICO NO SE TOCA ACÁ. Que dos personas distintas no puedan compartir correo adentro
-- de una Prestadora —y que la misma sí pueda estar en varias— es otra pieza y va en su propia
-- migración, porque vive del lado de la autenticación y no de acá.
--
-- Y LA MEMBRESÍA SE AUDITA COMO LO QUE ES. Dar de alta a alguien en una Prestadora, cambiarle el
-- papel o sacarlo son cambios de membresía, que ya entran en lo que se audita siempre. Esta
-- migración deja la tabla; el registro lo escribe quien la modifica.
--

CREATE TABLE IF NOT EXISTS public.membresias (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  prestadora_id  uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  rol            text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membresias_rol_check CHECK (
    rol = ANY (ARRAY['admin_prestadora', 'coordinador', 'asistente', 'familia', 'superadmin'])
  ),
  CONSTRAINT membresias_una_por_persona_y_prestadora UNIQUE (usuario_id, prestadora_id)
);

COMMENT ON TABLE public.membresias IS
  'De qué Prestadoras es parte cada cuenta, y con qué papel en cada una. Una persona puede tener varias; el papel es de la membresía, no de la persona.';

-- La segunda es la que hace falta para que las políticas resuelvan por membresía sin recorrer la
-- tabla entera; la primera, para armar la lista de Prestadoras de quien acaba de entrar.
CREATE INDEX IF NOT EXISTS membresias_por_usuario     ON public.membresias (usuario_id);
CREATE INDEX IF NOT EXISTS membresias_por_prestadora  ON public.membresias (prestadora_id);

-- Lo que ya estaba escrito en la cuenta pasa a ser una membresía. La cuenta del equipo técnico
-- que no tiene ninguna Prestadora anotada queda sin membresía, que es lo correcto: no es parte de
-- ninguna, y a la ficticia la alcanza por su rol.
INSERT INTO public.membresias (usuario_id, prestadora_id, rol, created_at)
SELECT u.id, u.prestadora_id, u.rol, COALESCE(u.created_at, now())
  FROM public.usuarios u
 WHERE u.prestadora_id IS NOT NULL
ON CONFLICT (usuario_id, prestadora_id) DO NOTHING;

ALTER TABLE public.membresias ENABLE ROW LEVEL SECURITY;

-- Quien entró ve de qué Prestadoras es parte. Sin esto no puede elegir en cuál pararse.
DROP POLICY IF EXISTS membresias_cada_uno_ve_las_suyas ON public.membresias;
CREATE POLICY membresias_cada_uno_ve_las_suyas ON public.membresias
  FOR SELECT TO authenticated
  USING (usuario_id = auth.uid());

-- Y quien administra la Prestadora gestiona las de su Prestadora, que es lo que hoy hace al dar
-- de alta una cuenta. No alcanza ninguna otra, ni la propia de otra Prestadora.
--
-- EL PAPEL TÉCNICO SÓLO LO REPARTE QUIEN YA LO TIENE, y esto no es una precaución de más. Hasta
-- hoy el papel de cada cuenta vivía en una tabla que no tiene política de escritura, así que
-- nadie podía cambiarlo desde el navegador. Al mudarlo a una tabla que sí se escribe, una
-- administración de Prestadora podría anotarse a sí misma como equipo técnico de CeltaTech y
-- salir a ver el resto de las Prestadoras. Queda cerrado en las dos direcciones: ni se crea una
-- membresía técnica, ni se toca una que ya exista.
DROP POLICY IF EXISTS membresias_las_gestiona_quien_administra ON public.membresias;
CREATE POLICY membresias_las_gestiona_quien_administra ON public.membresias
  FOR ALL TO authenticated
  USING (
    prestadora_id = interno.current_tenant()
    AND (interno.es_admin_prestadora() OR interno.es_superadmin())
    AND (rol <> 'superadmin' OR interno.es_superadmin())
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND (interno.es_admin_prestadora() OR interno.es_superadmin())
    AND (rol <> 'superadmin' OR interno.es_superadmin())
  );

NOTIFY pgrst, 'reload schema';

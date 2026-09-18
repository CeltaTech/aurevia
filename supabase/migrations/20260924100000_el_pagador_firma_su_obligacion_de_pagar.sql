-- ============================================================================
-- El Pagador firma su obligación de pagar, y sus papeles tienen dónde vivir
-- ============================================================================
--
-- QUÉ FALTABA. La contratación ya dice cuál Legajo es el Pagador —`familias.pagador_legajo_id`—,
-- pero apuntar a una Persona no la convierte en Pagador: lo que la convierte es que haya asumido
-- la obligación de pagar y lo haya firmado. Sin esa firma hay alguien anotado y nadie obligado.
--
-- QUÉ SE GUARDA. Tres cosas que no son la misma:
--
--   1. El texto que la Prestadora hace firmar. Es un documento hacia un tercero de ella, así que
--      es suyo: el producto trae un modelo y ella lo reemplaza por el que use. Mientras no cargue
--      ninguno rige el modelo, que vive en el código del motor y no acá.
--   2. Cada consentimiento firmado, con el texto entero tal como se firmó y su huella.
--   3. Los papeles que ese financiador exige, que cambian según quién pague: una obra social pide
--      cosas que una Familia no.
--
-- POR QUÉ EL TEXTO SE GUARDA ENTERO Y NO SE VUELVE A ARMAR. Mismo motivo que la instrucción del
-- círculo familiar: si mañana la Prestadora cambia su modelo, volver a armarlo mostraría un
-- documento que esa persona nunca vio. Se guarda lo que firmó, y la huella prueba que no cambió.
--
-- NO BLOQUEA NADA. Se puede dar de alta una Familia, elegir su Pagador y prestar el servicio con
-- el consentimiento pendiente. La pantalla lo muestra; decidir es de quien tiene la
-- responsabilidad, no del sistema.

-- ============================================================================
-- 0. La Familia se puede apuntar junto con su Prestadora
-- ============================================================================
--
-- Las tres tablas de más abajo apuntan a `(familia_id, prestadora_id)` a la vez, que es lo que
-- impide que una fila de una Prestadora cuelgue de la Familia de otra. Para poder apuntar así, la
-- Familia necesita esa clave, y todavía no la tenía. Es lo mismo que ya tienen el Paciente, el
-- Asistente, la Guardia y el Legajo.

ALTER TABLE public.familias
  DROP CONSTRAINT IF EXISTS familias_id_prestadora_unico;

ALTER TABLE public.familias
  ADD CONSTRAINT familias_id_prestadora_unico UNIQUE (id, prestadora_id);

-- ============================================================================
-- 1. El modelo que cada Prestadora adopta
-- ============================================================================
--
-- Una fila por Prestadora e idioma, o ninguna. Ninguna significa que usa el modelo que trae el
-- producto: no se siembra una copia por Prestadora, porque entonces el día que el modelo mejore
-- quedarían todas con la versión vieja sin haber decidido nada.

CREATE TABLE IF NOT EXISTS public.textos_consentimiento_pagador (
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  idioma text NOT NULL,
  cuerpo text NOT NULL,
  actualizado_por uuid REFERENCES public.usuarios(id),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (prestadora_id, idioma),

  CONSTRAINT textos_consentimiento_pagador_idioma_conocido
    CHECK (idioma IN ('es-AR', 'en', 'pt-BR')),
  CONSTRAINT textos_consentimiento_pagador_con_cuerpo
    CHECK (length(btrim(cuerpo)) > 0)
);

COMMENT ON TABLE public.textos_consentimiento_pagador IS
  'El texto que cada Prestadora hace firmar al Pagador. Sin fila rige el modelo que trae el producto: el documento es de ella y lo adopta, lo cambia o lo reemplaza.';

ALTER TABLE public.textos_consentimiento_pagador ENABLE ROW LEVEL SECURITY;

CREATE POLICY textos_consentimiento_pagador_los_lee_su_organizacion
  ON public.textos_consentimiento_pagador
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

CREATE POLICY textos_consentimiento_pagador_los_escribe_quien_puede
  ON public.textos_consentimiento_pagador
  FOR ALL
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('registrar_consentimiento_pagador')
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('registrar_consentimiento_pagador')
  );

CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.textos_consentimiento_pagador
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_soporte_mutacion();

-- ============================================================================
-- 2. El consentimiento
-- ============================================================================
--
-- Cuelga de la Familia y no del Legajo: lo que se asume es la obligación de pagar ESTA
-- contratación. La misma Persona puede ser Pagadora de dos Familias y haber firmado por una sola.
--
-- QUIÉN FIRMA VA COMO LEGAJO Y COMO NOMBRE ESCRITO. El Legajo es con quién quedó atado; el nombre
-- es cómo se llamaba el día que firmó. Si mañana se corrige el Legajo, el documento sigue diciendo
-- lo que decía, que es lo que esa persona leyó.

CREATE TABLE IF NOT EXISTS public.consentimientos_pagador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  familia_id uuid NOT NULL REFERENCES public.familias(id) ON DELETE CASCADE,

  -- Quién asumió la obligación. El Legajo puede ser de una persona física o de una jurídica: una
  -- obra social también firma.
  pagador_legajo_id uuid NOT NULL,
  pagador_nombre text NOT NULL,

  -- El documento tal cual se firmó, y su huella. Sin la huella el registro dice que firmó y no
  -- dice QUÉ firmó.
  documento_texto text NOT NULL,
  documento_huella text NOT NULL,
  documento_idioma text NOT NULL,

  -- `pendiente_firma` es un estado normal y no un error: el Servicio puede estar corriendo. Lo que
  -- no se puede es decir que hay un Pagador definido.
  estado text NOT NULL DEFAULT 'pendiente_firma',
  cerrado_como text,
  cerrado_en timestamptz,
  -- Con qué aparato se cerró, para poder reconstruir el acto. Nunca la dirección de red.
  cerrado_desde text,
  archivo_firmado_url text,

  cargado_por uuid NOT NULL REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT consentimientos_pagador_familia_tenant_fk
    FOREIGN KEY (familia_id, prestadora_id) REFERENCES public.familias(id, prestadora_id),
  CONSTRAINT consentimientos_pagador_legajo_tenant_fk
    FOREIGN KEY (pagador_legajo_id, prestadora_id) REFERENCES public.legajos(id, prestadora_id),

  CONSTRAINT consentimientos_pagador_estado_conocido
    CHECK (estado IN ('pendiente_firma', 'cerrado', 'anulado')),
  CONSTRAINT consentimientos_pagador_cerrado_como_conocido
    CHECK (cerrado_como IS NULL OR cerrado_como IN ('papel_firmado', 'confirmado_en_la_app')),
  -- Cerrado quiere decir las tres cosas a la vez, o el estado miente.
  CONSTRAINT consentimientos_pagador_cierre_coherente
    CHECK ((estado = 'cerrado') = (cerrado_como IS NOT NULL AND cerrado_en IS NOT NULL)),
  CONSTRAINT consentimientos_pagador_con_nombre
    CHECK (length(btrim(pagador_nombre)) > 0)
);

COMMENT ON TABLE public.consentimientos_pagador IS
  'Que el Pagador asumio la obligacion de pagar esta contratacion, y lo firmo. Sin una fila cerrada no hay Pagador definido.';
COMMENT ON COLUMN public.consentimientos_pagador.pagador_nombre IS
  'Como se llamaba el dia que firmo. El Legajo dice con quien quedo atado; esto, que fue lo que leyo.';
COMMENT ON COLUMN public.consentimientos_pagador.documento_huella IS
  'Huella del texto firmado. Si alguien le mueve una coma, deja de coincidir.';
COMMENT ON COLUMN public.consentimientos_pagador.cerrado_desde IS
  'Con que aparato se cerro. Nunca la direccion de red ni ningun otro dato que no haga falta.';

-- Uno pendiente por Familia. Si se carga otro antes de que se firme el anterior, el anterior se
-- anula: lo último que se le hizo firmar es lo que vale.
CREATE UNIQUE INDEX IF NOT EXISTS consentimientos_pagador_uno_pendiente_por_familia
  ON public.consentimientos_pagador (familia_id)
  WHERE estado = 'pendiente_firma';

CREATE INDEX IF NOT EXISTS consentimientos_pagador_por_familia
  ON public.consentimientos_pagador (familia_id, created_at DESC);

ALTER TABLE public.consentimientos_pagador ENABLE ROW LEVEL SECURITY;

-- Lo lee quien alcanza la Familia; lo escribe quien además tiene el permiso. Ver el estado —firmó
-- o no firmó— hace falta para trabajar; hacerlo firmar es otra cosa.
CREATE POLICY consentimientos_pagador_los_lee_su_organizacion
  ON public.consentimientos_pagador
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

CREATE POLICY consentimientos_pagador_los_escribe_quien_puede
  ON public.consentimientos_pagador
  FOR ALL
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('registrar_consentimiento_pagador')
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('registrar_consentimiento_pagador')
  );

CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.consentimientos_pagador
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_soporte_mutacion();

-- ============================================================================
-- 3. Qué papeles exige cada financiador
-- ============================================================================
--
-- El catálogo lo arma cada Prestadora, con el mismo molde que los tipos de documento del
-- Asistente. `financiador_tipo` nulo quiere decir «a todos»: una obra social pide cosas que una
-- Familia no, y una constancia de identidad la piden las dos.
--
-- El producto no siembra ninguno. Qué papeles exige un financiador lo sabe la Prestadora que
-- trabaja con él, y adivinarlo desde acá sería inventar un requisito que nadie pidió.

CREATE TABLE IF NOT EXISTS public.tipos_documento_pagador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  -- A qué tipo de financiador se le pide. Nulo, a todos. Los valores son los mismos que usa
  -- `familias.financiador_tipo`, que salen de `panel/src/lib/formaDePago.js`.
  financiador_tipo text,
  requiere_vencimiento boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tipos_documento_pagador_con_nombre
    CHECK (length(btrim(nombre)) > 0)
);

COMMENT ON TABLE public.tipos_documento_pagador IS
  'Que papeles exige cada financiador para aceptar la obligacion de pagar. Lo arma cada Prestadora; el producto no siembra ninguno.';

CREATE UNIQUE INDEX IF NOT EXISTS tipos_documento_pagador_sin_repetir
  ON public.tipos_documento_pagador (prestadora_id, lower(btrim(nombre)), coalesce(financiador_tipo, ''));

ALTER TABLE public.tipos_documento_pagador ENABLE ROW LEVEL SECURITY;

CREATE POLICY tipos_documento_pagador_los_lee_su_organizacion
  ON public.tipos_documento_pagador
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

CREATE POLICY tipos_documento_pagador_los_escribe_quien_puede
  ON public.tipos_documento_pagador
  FOR ALL
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('registrar_consentimiento_pagador')
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('registrar_consentimiento_pagador')
  );

CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.tipos_documento_pagador
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_soporte_mutacion();

-- ============================================================================
-- 4. Los papeles cargados
-- ============================================================================
--
-- Uno por Familia y por tipo. Cuelga de la Familia por lo mismo que el consentimiento: lo que se
-- documenta es esta contratación.

CREATE TABLE IF NOT EXISTS public.documentos_pagador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  familia_id uuid NOT NULL REFERENCES public.familias(id) ON DELETE CASCADE,
  tipo_documento_id uuid NOT NULL REFERENCES public.tipos_documento_pagador(id) ON DELETE CASCADE,

  -- Dónde quedó el archivo, en el depósito privado de más abajo. Nulo es que se anotó que existe
  -- pero todavía no se subió.
  archivo_url text,
  fecha_vencimiento date,

  cargado_por uuid NOT NULL REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT documentos_pagador_familia_tenant_fk
    FOREIGN KEY (familia_id, prestadora_id) REFERENCES public.familias(id, prestadora_id)
);

COMMENT ON TABLE public.documentos_pagador IS
  'Los papeles que el financiador exigio para esta contratacion, cargados. Uno por Familia y por tipo.';

CREATE UNIQUE INDEX IF NOT EXISTS documentos_pagador_uno_por_tipo
  ON public.documentos_pagador (familia_id, tipo_documento_id);

CREATE INDEX IF NOT EXISTS documentos_pagador_por_vencimiento
  ON public.documentos_pagador (prestadora_id, fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

ALTER TABLE public.documentos_pagador ENABLE ROW LEVEL SECURITY;

CREATE POLICY documentos_pagador_los_lee_su_organizacion
  ON public.documentos_pagador
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

CREATE POLICY documentos_pagador_los_escribe_quien_puede
  ON public.documentos_pagador
  FOR ALL
  USING (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('registrar_consentimiento_pagador')
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND interno.tiene_permiso('registrar_consentimiento_pagador')
  );

CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.documentos_pagador
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_soporte_mutacion();

-- ============================================================================
-- 5. Quién puede hacer todo esto lo decide cada Prestadora
-- ============================================================================
--
-- De fábrica en «sólo Admin»: hacer firmar una obligación de pagar tiene consecuencia económica y
-- se parece más a dar de alta una Familia que a corregir un teléfono. Abrirlo a quien coordina es
-- un clic en Configuración.

INSERT INTO public.catalogo_acciones_permisos (accion, default_solo_admin, orden)
SELECT 'registrar_consentimiento_pagador', true, 16
 WHERE NOT EXISTS (
   SELECT 1 FROM public.catalogo_acciones_permisos WHERE accion = 'registrar_consentimiento_pagador'
 );

-- ============================================================================
-- 6. Dónde vive el papel firmado
-- ============================================================================
--
-- Privado, como todos. La ruta empieza por la Prestadora y la política lo exige, así que nadie
-- alcanza el archivo de otra ni adivinando el nombre.

INSERT INTO storage.buckets (id, name, public)
SELECT 'documentos-pagador', 'documentos-pagador', false
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documentos-pagador');

CREATE POLICY documentos_pagador_los_alcanza_su_organizacion ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'documentos-pagador'
    AND (storage.foldername(name))[1] = interno.current_tenant()::text
    AND interno.tiene_permiso('registrar_consentimiento_pagador')
  )
  WITH CHECK (
    bucket_id = 'documentos-pagador'
    AND (storage.foldername(name))[1] = interno.current_tenant()::text
    AND interno.tiene_permiso('registrar_consentimiento_pagador')
  );

NOTIFY pgrst, 'reload schema';

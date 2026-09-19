--
-- Los papeles del legajo del Asistente tienen dónde vivir
--
-- `documentos_asistente` guardaba de qué papel se trata y cuándo vence, y nada más: **el papel en
-- sí no estaba en ningún lado.** La Prestadora anotaba que el certificado de antecedentes vence
-- en marzo, pero el certificado lo tenía por fuera del producto —en un correo, en una carpeta de
-- la computadora de quien lo recibió—, así que el sistema avisaba de un vencimiento sin poder
-- mostrar de qué. Acá está dónde.
--
-- LA RUTA EMPIEZA POR LA PRESTADORA —`<prestadora>/<asistente>/<identificador>`—, y la política lo
-- exige. Esto corrige un hueco conocido: donde esto ya estaba resuelto, la ruta empezaba por la
-- cuenta, y el día que una misma cuenta tenga legajo en dos Prestadoras las dos verían la misma
-- carpeta. Empezando por la Prestadora eso no puede pasar, y queda listo para cuando una cuenta
-- pueda estar en varias.
--
-- EL NOMBRE DEL ARCHIVO LLEVA UN IDENTIFICADOR ÚNICO, y por eso volver a presentar un papel no
-- pisa el anterior. Un papel renovado es un archivo nuevo; el renglón apunta al último. Quien
-- sube lo arma así (`panel/src/lib/papelesDelLegajo.js`), y la ruta guardada en
-- `documentos_asistente.ruta_archivo` es la única forma de volver a encontrarlo: adivinando el
-- nombre no se llega.
--
-- QUIÉN LO ALCANZA ES QUIEN YA ALCANZA EL RENGLÓN, y nadie más. Las dos políticas de acá son el
-- espejo exacto de las dos que ya rigen sobre la tabla: quien administra la Prestadora gestiona
-- los de su Prestadora, y quien coordina lee los de los Asistentes que alcanza. Que el papel se
-- viera más lejos que el renglón que lo nombra sería una fuga escrita a mano.
--
-- EL DEPÓSITO ACOTA TAMAÑO Y FORMATO. Un límite que sólo vive en la pantalla actúa después de que
-- el archivo ya viajó; escrito en el depósito, la base lo rechaza sola.
--
-- Y LA SEGUNDA CARPETA SE COMPARA COMO TEXTO, sin convertirla a identificador. Convertir un
-- nombre que no tiene la forma esperada no deniega: revienta la consulta entera con un error que
-- describe la base. Comparado como texto, una ruta mal armada simplemente no encuentra a nadie y
-- el permiso se niega, que es como tiene que fallar.
--

ALTER TABLE public.documentos_asistente
  ADD COLUMN IF NOT EXISTS ruta_archivo text;

COMMENT ON COLUMN public.documentos_asistente.ruta_archivo IS
  'Dónde está el papel dentro del depósito «documentos-asistente». Es la ruta, no una dirección: las direcciones de este depósito se firman y vencen.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'documentos-asistente', 'documentos-asistente', false, 10485760,
       ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']::text[]
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documentos-asistente');

DROP POLICY IF EXISTS papeles_del_legajo_los_gestiona_quien_administra ON storage.objects;
CREATE POLICY papeles_del_legajo_los_gestiona_quien_administra ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'documentos-asistente'
    AND (storage.foldername(name))[1] = interno.current_tenant()::text
    AND (interno.es_admin_prestadora() OR interno.es_superadmin())
  )
  WITH CHECK (
    bucket_id = 'documentos-asistente'
    AND (storage.foldername(name))[1] = interno.current_tenant()::text
    AND (interno.es_admin_prestadora() OR interno.es_superadmin())
  );

DROP POLICY IF EXISTS papeles_del_legajo_los_lee_quien_coordina ON storage.objects;
CREATE POLICY papeles_del_legajo_los_lee_quien_coordina ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos-asistente'
    AND (storage.foldername(name))[1] = interno.current_tenant()::text
    AND EXISTS (
      SELECT 1
        FROM public.asistentes a
       WHERE a.id::text = (storage.foldername(name))[2]
         AND interno.coordinador_alcanza_asistente(a.id)
    )
  );

NOTIFY pgrst, 'reload schema';

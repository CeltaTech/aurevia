-- ============================================================================
-- SIEMBRA DE LA BASE DE DATOS LOCAL
--
-- PARA QUÉ SIRVE. La base local se crea vacía: tiene todas las tablas pero
-- ninguna fila. Sin una Prestadora y sin un usuario no se puede ni iniciar
-- sesión, así que ninguna pantalla se puede mirar. Hasta ahora eso se
-- resolvía escribiendo filas a mano cada vez (ver `docs/PENDIENTES.md`, #111).
-- Este archivo lo deja hecho de una vez y para siempre.
--
-- CÓMO SE USA. Un solo comando, parado en la raíz de este repositorio:
--
--     npx supabase db reset
--
-- Ese comando borra la base local, vuelve a aplicar las migraciones y al
-- final corre este archivo. Está configurado así en `supabase/config.toml`
-- (sección `[db.seed]`), no hace falta indicárselo.
--
-- POR QUÉ NO SE TOCA LA BASE DE LA NUBE. Porque tiene datos reales de
-- personas reales y credenciales reales. Para mirar pantallas se usa esta
-- base local, que es descartable.
--
-- TODO LO DE ACÁ ADENTRO ES INVENTADO. Nombres, direcciones, teléfonos y
-- contraseñas son de fantasía. No hay un solo dato de una persona real, y no
-- puede haberlo nunca (regla 6 de `CLAUDE.md`).
--
-- LA CONTRASEÑA. Las diez cuentas entran con `local-sandbox-2026`. No es una
-- credencial: solo existe adentro de una base de datos que corre en la máquina
-- del Desarrollador y que se borra entera con cada `db reset`. **Nunca debe
-- usarse en la nube ni en ningún otro lado.**
--
-- POR QUÉ LA PRESTADORA SE LLAMA "SANDBOX". Porque es el nombre que el
-- producto ya tiene reservado para la Organización de prueba (§2 de
-- `CLAUDE.md`), y porque el rol Superadmin, fuera de una sesión de soporte,
-- solo puede ver esa Organización (§5). Si la Prestadora de prueba se llamara
-- de cualquier otra forma, el Superadmin no vería nada.
--
-- DOS TRABAS DEL ENTORNO QUE CONVIENE TENER A MANO (las dos ya nos pasaron):
--   * Si la máquina durmió, el contenedor que sirve los datos se queda con la
--     hora atrasada y rechaza todo con `JWT issued at future`. Se arregla
--     reiniciando ese contenedor.
--   * El backend lee `.env` (la nube) salvo que se le indique `.env.local`
--     (esta base) con la variable `DOTENV_CONFIG_PATH`.
--   Ver `panel/README.md` para el paso a paso de levantar Panel + backend
--   contra esta base.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. La Prestadora de prueba
--
--    Los identificadores están escritos a mano en vez de sorteados para que
--    la base quede siempre igual: así una dirección del navegador que uno
--    guardó ayer sigue funcionando después de volver a sembrar.
-- ----------------------------------------------------------------------------
INSERT INTO public.prestadoras (
  id, razon_social, nombre_fantasia, identificacion_fiscal, pais, estado,
  zonas_operacion, fecha_alta
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Sandbox — Organización de pruebas',
  'Sandbox',
  '30-00000000-0',
  'AR',
  'certificada',
  ARRAY['CABA', 'Zona Norte', 'Zona Sur'],
  CURRENT_DATE - 400
);

INSERT INTO public.configuracion_prestadora (
  prestadora_id, nombre, telefono, whatsapp_numero, email, dominio, zona_cobertura_texto
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Sandbox',
  '+54 11 4000-0000',
  '+54 9 11 4000-0000',
  'contacto@sandbox.local',
  -- `localhost` a propósito: es el dominio desde el que se abre el Panel en la
  -- máquina, y es lo que mira el backend para saber de qué Prestadora es una
  -- consulta pública sin sesión iniciada.
  'localhost',
  'Ciudad de Buenos Aires y Gran Buenos Aires'
);

-- Las dos formas de trabajar que la Prestadora tiene encendidas. Queda apagada
-- a propósito la tercera (`subcontratacion`), que está en pleno rediseño — ver
-- el pendiente #115.
INSERT INTO public.prestadora_modalidades (prestadora_id, modalidad, activa) VALUES
  ('11111111-1111-4111-8111-111111111111', 'directa',     true),
  ('11111111-1111-4111-8111-111111111111', 'marketplace', true);

INSERT INTO public.zonas_cobertura (prestadora_id, codigo, nombre, categoria, orden) VALUES
  ('11111111-1111-4111-8111-111111111111', 'caba',       'Ciudad de Buenos Aires', 'ciudad',  10),
  ('11111111-1111-4111-8111-111111111111', 'zona_norte', 'Zona Norte',             'partido', 20),
  ('11111111-1111-4111-8111-111111111111', 'zona_sur',   'Zona Sur',               'partido', 30);


-- ----------------------------------------------------------------------------
-- 2. Las diez cuentas: tres del Panel, cuatro Asistentes y tres Familias
--
--    Una cuenta vive en dos lugares. En `auth.users` está el correo y la
--    contraseña, que es lo que mira el sistema de ingreso; en `public.usuarios`
--    está el nombre, el rol y a qué Prestadora pertenece, que es lo que mira el
--    producto. Las dos filas comparten el mismo identificador. Hay además una
--    tercera fila, en `auth.identities`, donde el sistema de ingreso anota "por
--    qué medio entra esta persona"; sin ella, entrar con correo y contraseña no
--    funciona.
--
--    POR QUÉ ESTÁ TODO EN UNA SOLA ORDEN Y NO EN TRES. Porque la herramienta que
--    aplica esta siembra manda el archivo entero de una vez y revisa todas las
--    órdenes ANTES de ejecutar la primera. Eso descarta el camino cómodo —crear
--    una funcioncita que arme las tres filas y después llamarla diez veces—,
--    porque en el momento de la revisión esa función todavía no existe. La lista
--    de personas se escribe entonces una sola vez, arriba, y las tres tablas se
--    llenan de ella en la misma orden. Que las tres filas nazcan juntas no es un
--    problema: las comprobaciones de coherencia entre tablas se hacen al final
--    de la orden, cuando ya están las tres.
--
--    Los tres roles del Panel están para comprobar que cada uno ve lo que le
--    corresponde y nada más. Todos entran con la misma contraseña.
-- ----------------------------------------------------------------------------
WITH personas (id, email, nombre, rol, telefono, zonas) AS (
  VALUES
    -- Los tres roles del Panel
    ('20000000-0000-4000-8000-000000000001'::uuid, 'superadmin@sandbox.local'::text,   'Sofía Superadmin'::text,      'superadmin'::text,       NULL::text,          NULL::text[]),
    ('20000000-0000-4000-8000-000000000002',       'admin@sandbox.local',              'Andrea Administradora',       'admin_prestadora',       '+54 11 4000-0002',  NULL),
    ('20000000-0000-4000-8000-000000000003',       'coordinadora@sandbox.local',       'Carla Coordinadora',          'coordinador',            '+54 11 4000-0003',  ARRAY['caba', 'zona_norte']),
    -- Las cuatro Asistentes
    ('30000000-0000-4000-8000-000000000001',       'ana.asistente@sandbox.local',      'Ana Álvarez',                 'asistente',              '+54 11 4001-0001',  ARRAY['caba']),
    ('30000000-0000-4000-8000-000000000002',       'bruno.asistente@sandbox.local',    'Bruno Bianchi',               'asistente',              '+54 11 4001-0002',  ARRAY['caba', 'zona_norte']),
    ('30000000-0000-4000-8000-000000000003',       'clara.asistente@sandbox.local',    'Clara Cabrera',               'asistente',              '+54 11 4001-0003',  ARRAY['zona_sur']),
    ('30000000-0000-4000-8000-000000000004',       'delia.asistente@sandbox.local',    'Delia Duarte',                'asistente',              '+54 11 4001-0004',  ARRAY['zona_norte']),
    -- Las tres Familias
    ('40000000-0000-4000-8000-000000000001',       'familia.gomez@sandbox.local',      'Familia Gómez',               'familia',                '+54 11 4002-0001',  NULL),
    ('40000000-0000-4000-8000-000000000002',       'familia.lopez@sandbox.local',      'Familia López',               'familia',                '+54 11 4002-0002',  NULL),
    ('40000000-0000-4000-8000-000000000003',       'familia.morales@sandbox.local',    'Familia Morales',             'familia',                '+54 11 4002-0003',  NULL)
),
cuentas_de_ingreso AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  SELECT
    '00000000-0000-0000-0000-000000000000', p.id, 'authenticated', 'authenticated', p.email,
    extensions.crypt('local-sandbox-2026', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nombre', p.nombre),
    '', '', '', ''
  FROM personas p
  RETURNING id
),
medios_de_ingreso AS (
  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  )
  SELECT
    p.id::text, p.id,
    jsonb_build_object('sub', p.id::text, 'email', p.email, 'email_verified', true),
    'email', now(), now(), now()
  FROM personas p
  RETURNING user_id
)
INSERT INTO public.usuarios (id, rol, nombre, telefono, zonas, prestadora_id)
SELECT p.id, p.rol, p.nombre, p.telefono, p.zonas, '11111111-1111-4111-8111-111111111111'
FROM personas p;


-- ----------------------------------------------------------------------------
-- 3. Cuatro Asistentes
--
--    Tres en actividad y una dada de baja, para que las pantallas que filtran
--    por estado tengan algo distinto que mostrar en cada solapa.
--
--    Nota: la columna `especialidades` está deprecada — el reemplazo es el
--    vínculo al catálogo de tipos de Asistente, que todavía no existe como
--    columna (pendiente #88 / tarea 88). Cuando exista, esta siembra se
--    actualiza junto con esa tarea.
-- ----------------------------------------------------------------------------

INSERT INTO public.asistentes (
  id, prestadora_id, nombre, telefono, email, especialidades, zonas,
  estado, tipo_vinculo, fecha_alta, fecha_baja, causal_baja, valor_hora, dni, canales
) VALUES
  ('30000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Ana Álvarez', '+54 11 4001-0001', 'ana.asistente@sandbox.local',
   ARRAY['Cuidado de adultos mayores'], ARRAY['caba'],
   'activo', 'monotributo', CURRENT_DATE - 300, NULL, NULL, 4500.00, '20000001', ARRAY['directo']),

  ('30000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Bruno Bianchi', '+54 11 4001-0002', 'bruno.asistente@sandbox.local',
   ARRAY['Acompañamiento terapéutico'], ARRAY['caba', 'zona_norte'],
   'activo', 'dependencia', CURRENT_DATE - 220, NULL, NULL, 4800.00, '20000002', ARRAY['directo', 'marketplace']),

  ('30000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'Clara Cabrera', '+54 11 4001-0003', 'clara.asistente@sandbox.local',
   ARRAY['Enfermería domiciliaria'], ARRAY['zona_sur'],
   'activo', 'monotributo', CURRENT_DATE - 90, NULL, NULL, 5200.00, '20000003', ARRAY['marketplace']),

  ('30000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   'Delia Duarte', '+54 11 4001-0004', 'delia.asistente@sandbox.local',
   ARRAY['Cuidado de adultos mayores'], ARRAY['zona_norte'],
   'cesado', 'monotributo', CURRENT_DATE - 500, CURRENT_DATE - 40, 'renuncia', 4200.00, '20000004', ARRAY['directo']);


-- ----------------------------------------------------------------------------
-- 4. Tres Familias, cada una con su Paciente y su Servicio
--
--    El Servicio es el concepto de arriba: de él cuelgan las guardias. Una
--    Familia sin Servicio no tendría de dónde colgarlas.
-- ----------------------------------------------------------------------------

INSERT INTO public.familias (id, prestadora_id, plan) VALUES
  ('40000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'directo'),
  ('40000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'directo'),
  ('40000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'marketplace');

-- El nombre, el teléfono y la localidad de una Familia NO están en `familias`:
-- están en la Solicitud con la que entró, y `familias.solicitud_id` es el que la
-- señala. Sin esta parte, todas las pantallas que muestran una Familia la
-- muestran como "—". Por eso van las tres Solicitudes ya convertidas en Familia,
-- y dos más todavía sin contestar para que la pantalla de Solicitudes no esté
-- vacía.
--
-- El id de `solicitudes` lo genera la base sola, así que no se puede fijar acá:
-- primero se insertan y después se le avisa a cada Familia cuál es la suya.
INSERT INTO public.solicitudes (
  prestadora_id, nombre, telefono, email, nombre_paciente, localidad,
  tipo_servicio, modalidad, dias_horario, estado, familia_id
) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Familia Gómez', '+54 11 5001-0001',
   'familia.gomez@sandbox.local', 'Elena Gómez', 'CABA',
   'Cuidado de adultos mayores', 'Por horas', 'Lunes a viernes de 8 a 20', 'convertida',
   '40000000-0000-4000-8000-000000000001'),

  ('11111111-1111-4111-8111-111111111111', 'Familia López', '+54 11 5001-0002',
   'familia.lopez@sandbox.local', 'Héctor López', 'Zona Norte',
   'Cuidado de adultos mayores', 'Por horas', 'Lunes a sábado de 8 a 14', 'convertida',
   '40000000-0000-4000-8000-000000000002'),

  ('11111111-1111-4111-8111-111111111111', 'Familia Morales', '+54 11 5001-0003',
   'familia.morales@sandbox.local', 'Rosa Morales', 'Zona Sur',
   'Cuidado de adultos mayores', 'Permanente', 'Todos los días, las 24 horas', 'convertida',
   '40000000-0000-4000-8000-000000000003'),

  ('11111111-1111-4111-8111-111111111111', 'Familia Ibarra', '+54 11 5001-0004',
   'familia.ibarra@sandbox.local', 'Nélida Ibarra', 'CABA',
   'Acompañamiento', 'Por horas', 'Martes y jueves a la tarde', 'nueva', NULL),

  ('11111111-1111-4111-8111-111111111111', 'Familia Sosa', '+54 11 5001-0005',
   'familia.sosa@sandbox.local', 'Aníbal Sosa', 'Zona Oeste',
   'Enfermería domiciliaria', 'Por horas', 'Lunes, miércoles y viernes a la mañana', 'nueva', NULL);

UPDATE public.familias f
   SET solicitud_id = s.id
  FROM public.solicitudes s
 WHERE s.familia_id = f.id;

-- Quien inició sesión por la Familia también figura como miembro del grupo
-- familiar. Es lo que mira la aplicación de la Familia para saber qué puede ver.
INSERT INTO public.miembros_familia (usuario_id, familia_id, email, rol) VALUES
  ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'familia.gomez@sandbox.local',   'solo_lectura'),
  ('40000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'familia.lopez@sandbox.local',   'solo_lectura'),
  ('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', 'familia.morales@sandbox.local', 'solo_lectura');

INSERT INTO public.pacientes (
  id, prestadora_id, familia_id, nombre, fecha_nacimiento, patologias,
  nivel_complejidad, domicilio, lat, lng, obra_social, numero_afiliado
) VALUES
  ('50000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   '40000000-0000-4000-8000-000000000001', 'Elena Gómez', '1938-04-12',
   ARRAY['Hipertensión', 'Artrosis'], 'II',
   'Av. Siempreviva 742, CABA', -34.6037, -58.3816, 'Obra Social de Prueba', 'OSP-0001'),

  ('50000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   '40000000-0000-4000-8000-000000000002', 'Héctor López', '1942-11-03',
   ARRAY['Diabetes tipo 2'], 'I',
   'Calle Falsa 123, Zona Norte', -34.5000, -58.5200, 'Obra Social de Prueba', 'OSP-0002'),

  ('50000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   '40000000-0000-4000-8000-000000000003', 'Rosa Morales', '1935-07-25',
   ARRAY['Demencia senil', 'Movilidad reducida'], 'III',
   'Pasaje Inventado 55, Zona Sur', -34.7200, -58.3900, NULL, NULL);

INSERT INTO public.servicios (id, prestadora_id, familia_id, etiqueta, estado) VALUES
  ('60000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '40000000-0000-4000-8000-000000000001', 'Acompañamiento diurno de Elena',   'vigente'),
  ('60000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '40000000-0000-4000-8000-000000000002', 'Cuidado de mañana de Héctor',      'vigente'),
  ('60000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '40000000-0000-4000-8000-000000000003', 'Cuidado permanente de Rosa',       'vigente');

-- La Lista de Precios es el catálogo: lo que la Prestadora ofrece y a cuánto.
-- No es lo vendido. Lo vendido son las prestaciones de más abajo, que guardan el
-- precio del día en que se acordó (`precio_lista_snapshot`) para que un cambio de
-- catálogo no altere lo ya pactado.
INSERT INTO public.lista_precios (prestadora_id, tipo_servicio, modalidad, precio) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Cuidado de adultos mayores', 'Por hora',      3500.00),
  ('11111111-1111-4111-8111-111111111111', 'Cuidado de adultos mayores', 'Guardia de 12', 38000.00),
  ('11111111-1111-4111-8111-111111111111', 'Cuidado de adultos mayores', 'Guardia de 24', 70000.00),
  ('11111111-1111-4111-8111-111111111111', 'Enfermería domiciliaria',    'Por visita',    9000.00),
  ('11111111-1111-4111-8111-111111111111', 'Kinesiología',               'Por sesión',    12000.00),
  ('11111111-1111-4111-8111-111111111111', 'Limpieza del hogar',         'Por jornada',   25000.00);

-- Las prestaciones: lo que cada Servicio incluye de verdad. Rosa muestra el caso
-- que importa —un Servicio es una canasta, no una sola cosa—: cuidado permanente
-- más kinesiología más limpieza, tres prestaciones distintas dentro del mismo
-- Servicio (`docs/QUE_ES_UN_SERVICIO.md`).
INSERT INTO public.prestaciones (
  prestadora_id, servicio_id, paciente_id, tipo_servicio, precio_final,
  precio_lista_snapshot, nota, estado
) VALUES
  ('11111111-1111-4111-8111-111111111111', '60000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001', 'Cuidado de adultos mayores — Guardia de 12',
   38000.00, 38000.00, 'Incluye acompañamiento y apoyo en el baño. No incluye curaciones.', 'vigente'),

  ('11111111-1111-4111-8111-111111111111', '60000000-0000-4000-8000-000000000002',
   '50000000-0000-4000-8000-000000000002', 'Cuidado de adultos mayores — Por hora',
   3500.00, 3500.00, 'Seis horas por la mañana. No incluye traslados.', 'vigente'),

  ('11111111-1111-4111-8111-111111111111', '60000000-0000-4000-8000-000000000003',
   '50000000-0000-4000-8000-000000000003', 'Cuidado de adultos mayores — Guardia de 24',
   70000.00, 70000.00, 'Cobertura permanente, dos Asistentes rotando.', 'vigente'),

  ('11111111-1111-4111-8111-111111111111', '60000000-0000-4000-8000-000000000003',
   '50000000-0000-4000-8000-000000000003', 'Kinesiología — Por sesión',
   12000.00, 12000.00, 'Dos sesiones por semana, martes y jueves.', 'vigente'),

  ('11111111-1111-4111-8111-111111111111', '60000000-0000-4000-8000-000000000003',
   '50000000-0000-4000-8000-000000000003', 'Limpieza del hogar — Por jornada',
   25000.00, 25000.00, 'Una jornada semanal. Se dio de baja a pedido de la Familia.', 'de_baja');


-- ----------------------------------------------------------------------------
-- 5. Ocho guardias repartidas entre ayer, hoy y mañana
--
--    Las fechas son relativas al día en que se siembra, no fijas: así el
--    archivo no se vuelve viejo y "hoy" siempre tiene algo que mostrar.
--
--    Están a propósito los casos que suelen romper las pantallas:
--    una terminada, una en curso, una programada, una que nadie cubrió
--    todavía y una en la que la Asistente no se presentó.
-- ----------------------------------------------------------------------------
INSERT INTO public.guardias (
  id, prestadora_id, servicio_id, asistente_id, paciente_id, coordinador_id,
  fecha, hora_inicio, hora_fin, modalidad, estado, canal_modalidad,
  checkin_at, checkout_at
) VALUES
  -- Ayer: una terminada de punta a punta.
  ('70000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   '60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003',
   CURRENT_DATE - 1, '08:00', '16:00', 'presencial', 'completada', 'directa',
   (CURRENT_DATE - 1 + TIME '08:03') AT TIME ZONE 'America/Argentina/Buenos_Aires',
   (CURRENT_DATE - 1 + TIME '16:05') AT TIME ZONE 'America/Argentina/Buenos_Aires'),

  -- Ayer: la Asistente no se presentó.
  ('70000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   '60000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
   '50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003',
   CURRENT_DATE - 1, '07:00', '13:00', 'presencial', 'ausente', 'directa',
   NULL, NULL),

  -- Hoy temprano: terminada.
  ('70000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   '60000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
   '50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003',
   CURRENT_DATE, '06:00', '10:00', 'presencial', 'completada', 'directa',
   (CURRENT_DATE + TIME '06:01') AT TIME ZONE 'America/Argentina/Buenos_Aires',
   (CURRENT_DATE + TIME '10:02') AT TIME ZONE 'America/Argentina/Buenos_Aires'),

  -- Hoy: en curso. Entró y todavía no cerró.
  ('70000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   '60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003',
   CURRENT_DATE, '08:00', '16:00', 'presencial', 'activa', 'directa',
   (CURRENT_DATE + TIME '08:02') AT TIME ZONE 'America/Argentina/Buenos_Aires',
   NULL),

  -- Hoy a la tarde: asignada y todavía no empezó.
  ('70000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111',
   '60000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003',
   '50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003',
   CURRENT_DATE, '16:00', '22:00', 'presencial', 'programada', 'marketplace',
   NULL, NULL),

  -- Hoy a la noche: SIN CUBRIR. Nadie tiene asignada esta guardia todavía.
  -- Es el caso que estrena la migración de "guardia sin cubrir" y el que hace
  -- aparecer el aviso en la pantalla de Estado actual.
  ('70000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111',
   '60000000-0000-4000-8000-000000000003', NULL,
   '50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003',
   CURRENT_DATE, '22:00', '06:00', 'presencial', 'programada', 'marketplace',
   NULL, NULL),

  -- Mañana: dos programadas, para que la vista de la semana no quede vacía.
  ('70000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111',
   '60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003',
   CURRENT_DATE + 1, '08:00', '16:00', 'presencial', 'programada', 'directa',
   NULL, NULL),

  ('70000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111',
   '60000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
   '50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003',
   CURRENT_DATE + 1, '07:00', '13:00', 'presencial', 'programada', 'directa',
   NULL, NULL);


-- ----------------------------------------------------------------------------
-- 6. La configuración de avisos de la Prestadora de prueba
--
--    Las migraciones siembran estas filas para las Prestadoras que existían
--    cuando corrieron, pero Sandbox nace acá, después. Sin estas dos filas la
--    Prestadora de prueba queda muda y el aviso parece roto cuando en realidad
--    está apagado por falta de configuración.
--
--    6.a Cuándo avisar que una guardia sigue sin cubrir. Con 48 horas de
--        anticipación, la guardia sin cubrir de hoy a las 22:00 (sección 5)
--        dispara el aviso apenas arranca el backend, que es justo lo que hace
--        falta para probarlo sin esperar.
-- ----------------------------------------------------------------------------
INSERT INTO public.configuracion_aviso_guardia_sin_cubrir (
  prestadora_id, activo, horas_antes, horas_entre_avisos
) VALUES (
  '11111111-1111-4111-8111-111111111111', true, 48, 12
);

-- ----------------------------------------------------------------------------
--    6.b A quién le llega. La lista de correos va vacía a propósito: así el
--        aviso cae en el correo de contacto de la Prestadora
--        (`contacto@sandbox.local`, sección 1), que es el camino de respaldo
--        que conviene tener probado. Ver `destinatariosEvento()` en
--        `backend/src/utils/email.js`.
-- ----------------------------------------------------------------------------
INSERT INTO public.configuracion_notificaciones (
  evento, prestadora_id, descripcion, emails, activo
) VALUES (
  'guardia_sin_cubrir',
  '11111111-1111-4111-8111-111111111111',
  'Una guardia próxima sigue sin Asistente asignado',
  '{}',
  true
);


-- ----------------------------------------------------------------------------
--    6.c A dónde salen los correos en la máquina. Apuntan al buzón de pruebas
--        que trae la base local (se abre en http://127.0.0.1:54424), así que
--        nada sale a internet ni llega a una casilla real. Sin esto, probar un
--        aviso obliga a configurar el correo a mano cada vez que se resiembra.
--
--        Falta un paso que no se puede hacer desde acá: `backend/.env.local`
--        tiene que tener `SMTP_USER` con cualquier valor. El backend usa esa
--        variable como interruptor —si está vacía no intenta mandar nada— y ese
--        archivo no vive en el repositorio.
-- ----------------------------------------------------------------------------
INSERT INTO public.configuracion_email_prestadora (
  prestadora_id, activo, direccion_remitente, usuario_smtp, host, puerto
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  true,
  'avisos@sandbox.local',
  'avisos@sandbox.local',
  '127.0.0.1',
  54425
);

-- El buzón de pruebas no pide contraseña, pero el backend solo usa el remitente
-- propio de la Prestadora si encuentra una guardada. Se carga una de relleno.
SELECT guardar_credencial_smtp_prestadora(
  '11111111-1111-4111-8111-111111111111',
  'el-buzon-local-no-pide-clave'
);


-- ----------------------------------------------------------------------------
-- 7. Limpieza y aviso final
-- ----------------------------------------------------------------------------
-- Sin esto, la capa que sirve los datos puede seguir contestando 404 en tablas
-- que sí existen (§8 de `CLAUDE.md`).
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Base local sembrada. Prestadora: Sandbox.';
  RAISE NOTICE 'Contraseña de todas las cuentas: local-sandbox-2026';
  RAISE NOTICE '  Panel  -> superadmin@sandbox.local / admin@sandbox.local / coordinadora@sandbox.local';
  RAISE NOTICE '  Asistentes -> ana.asistente@sandbox.local (y bruno, clara, delia)';
  RAISE NOTICE '  Familias   -> familia.gomez@sandbox.local (y lopez, morales)';
  RAISE NOTICE 'Los correos que manda el backend quedan en http://127.0.0.1:54424';
  RAISE NOTICE '';
END $$;

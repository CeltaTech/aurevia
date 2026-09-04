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
)
-- Al dar de alta la Prestadora, la base ya le creó sus filas de configuración con los
-- valores de arranque (disparador `trg_sembrar_configuracion_prestadora`). Acá se le
-- pisan por los datos de la Sandbox, que es lo que hace falta para probar.
ON CONFLICT (prestadora_id) DO UPDATE SET
  nombre               = EXCLUDED.nombre,
  telefono             = EXCLUDED.telefono,
  whatsapp_numero      = EXCLUDED.whatsapp_numero,
  email                = EXCLUDED.email,
  dominio              = EXCLUDED.dominio,
  zona_cobertura_texto = EXCLUDED.zona_cobertura_texto;

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
--    Qué es cada uno sale del catálogo de tipos, más abajo. La columna vieja
--    `especialidades` —la casilla de texto libre de antes— quedó retirada y no
--    se escribe más; acá se carga a propósito en un solo Asistente, Bruno, que
--    además no tiene tipo, para poder ver funcionando la pantalla que pasa los
--    viejos al catálogo. Delia tampoco tiene tipo y no tiene texto viejo: es el
--    otro caso que esa pantalla tiene que saber mostrar.
--
--    Dos partes de la ficha no están en esta tabla: lo que cobra cada uno, en
--    `remuneraciones_asistente`, y lo reservado —por qué se lo dio de baja, su
--    puntaje de riesgo, por qué quedó excluido de recibir trabajo—, en
--    `datos_reservados_asistente`. Las dos, más abajo. Viven aparte porque las
--    reglas de acceso de la base filtran filas y no columnas, así que mientras
--    esos datos estaban acá cualquiera que podía ver la ficha podía leerlos.
-- ----------------------------------------------------------------------------

INSERT INTO public.asistentes (
  id, prestadora_id, nombre, telefono, email, especialidades, zonas,
  estado, tipo_vinculo, fecha_alta, fecha_baja,
  horas_semanales, dni, canales
) VALUES
  ('30000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Ana Álvarez', '+54 11 4001-0001', 'ana.asistente@sandbox.local',
   NULL, ARRAY['caba'],
   'activo', 'monotributo', CURRENT_DATE - 300, NULL,
   40, '20000001', ARRAY['directa']),

  ('30000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Bruno Bianchi', '+54 11 4001-0002', 'bruno.asistente@sandbox.local',
   ARRAY['Acompañamiento terapéutico'], ARRAY['caba', 'zona_norte'],
   'activo', 'dependencia', CURRENT_DATE - 220, NULL,
   40, '20000002', ARRAY['directa', 'marketplace']),

  ('30000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'Clara Cabrera', '+54 11 4001-0003', 'clara.asistente@sandbox.local',
   NULL, ARRAY['zona_sur'],
   'activo', 'monotributo', CURRENT_DATE - 90, NULL,
   24, '20000003', ARRAY['marketplace']),

  ('30000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   'Delia Duarte', '+54 11 4001-0004', 'delia.asistente@sandbox.local',
   NULL, ARRAY['zona_norte'],
   'cesado', 'monotributo', CURRENT_DATE - 500, CURRENT_DATE - 40,
   40, '20000004', ARRAY['directa']);

-- Los datos de plata van en dos columnas distintas y no en una sola, porque quien
-- está por monotributo cobra por hora (`valor_hora`) y quien está en relación de
-- dependencia cobra un sueldo que no se mueve con las horas (`sueldo_basico`).
-- Cada uno lleva el que le corresponde y el otro va en blanco: si se llenaran los
-- dos, la pantalla de Pagos a Asistentes podría mostrar bien un número que en
-- realidad está mal cargado.
INSERT INTO public.remuneraciones_asistente (
  asistente_id, prestadora_id, valor_hora, sueldo_basico
) VALUES
  ('30000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 4500.00, NULL),
  ('30000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', NULL, 980000.00),
  ('30000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 5200.00, NULL),
  ('30000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 4200.00, NULL);

-- Lo reservado de la ficha. Solo se carga donde hay algo que decir: la causa de
-- la baja de Delia, que es la única dada de baja, y un puntaje de riesgo en Ana,
-- que está por monotributo y trabaja 40 horas para una sola Prestadora — el caso
-- que la pantalla de Score de Riesgo existe para mostrar. Los otros dos no tienen
-- fila, que es el estado normal de un Asistente al que nunca se le cargó nada.
INSERT INTO public.datos_reservados_asistente (
  asistente_id, prestadora_id, causal_baja, score_riesgo_reclasificacion, indicadores_riesgo
) VALUES
  ('30000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   NULL, 45, '{"exclusividad_facturacion": 1, "horas_semanales_promedio": 1, "horario_fijo_impuesto": 1}'::jsonb),
  ('30000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   'renuncia', 0, '{}'::jsonb);


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
   'Pasaje Inventado 55, Zona Sur', -34.7200, -58.3900, NULL, NULL),

  -- El marido de Elena: misma Familia, MISMO DOMICILIO, escrito igual letra por letra.
  -- Está acá para que el domicilio compartido se pueda probar de verdad (pendiente #94):
  -- el Asistente va una sola vez a esa casa y los atiende a los dos, y eso es UNA guardia
  -- sola que cubre a dos Pacientes. Sin este cuarto Paciente, los tres domicilios de la
  -- siembra eran todos distintos y el caso no se podía reproducir sin tocar la base a mano.
  ('50000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   '40000000-0000-4000-8000-000000000001', 'Alberto Gómez', '1936-09-30',
   ARRAY['EPOC'], 'II',
   'Av. Siempreviva 742, CABA', -34.6037, -58.3816, 'Obra Social de Prueba', 'OSP-0004');

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
-- Servicio (ver el glosario, `CLAUDE.md` §4).
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
   NULL, NULL),

  -- Pasado mañana: OFRECIDA. Sin Asistente asignado, publicada a dos personas a la
  -- vez y con fecha límite. Es la que estrena la pantalla de guardias ofrecidas de
  -- la aplicación del Asistente: sin ella, esa pantalla arranca vacía después de
  -- rehacer la base y no hay forma de saber si anda o si está rota. Se la queda el
  -- primero que conteste, así que también sirve para probar qué ve el que pierde.
  ('70000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111',
   '60000000-0000-4000-8000-000000000001', NULL,
   '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003',
   CURRENT_DATE + 2, '08:00', '16:00', 'presencial', 'programada', 'directa',
   NULL, NULL);

UPDATE public.guardias
   SET ofrecida_at = now(),
       ofrecida_por = '20000000-0000-4000-8000-000000000003',
       oferta_limite_at = now() + INTERVAL '2 days'
 WHERE id = '70000000-0000-4000-8000-000000000009';

-- Las dos invitaciones, todavía sin contestar. Ana y Bruno trabajan los dos en
-- prestación directa, que es la modalidad de esta guardia; si se invitara a alguien
-- que no trabaja en esa modalidad, la propia base rechazaría la fila.
INSERT INTO public.ofertas_guardia (prestadora_id, guardia_id, asistente_id, invitado_por) VALUES
  ('11111111-1111-4111-8111-111111111111', '70000000-0000-4000-8000-000000000009',
   '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003'),
  ('11111111-1111-4111-8111-111111111111', '70000000-0000-4000-8000-000000000009',
   '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003');

-- ----------------------------------------------------------------------------
-- 5.b Dos visitas compartidas: una que ya se cumplió y otra por venir.
--
--     Elena y Alberto viven juntos (sección 4). Ana va una sola vez a esa casa
--     y los atiende a los dos: es UNA guardia con DOS Pacientes, no dos
--     guardias. Se agregan acá para que el caso se pueda mirar en pantalla sin
--     tener que tocar la base a mano.
--
--     Elena ya está en las dos listas: la puso sola el disparador que mantiene
--     al día la columna vieja `guardias.paciente_id` mientras esa columna siga
--     existiendo. Acá se suma únicamente Alberto.
--
--     Hacen falta las dos, porque cada una muestra una cosa distinta:
--
--       - la de anteayer está `completada`, y es la única que sirve para ver el
--         reparto de horas en el informe de obra social: ocho horas de visita
--         para dos Pacientes son cuatro horas para cada informe, no ocho y ocho
--         (ver `backend/src/utils/horasDeGuardia.js`). Una guardia que todavía
--         no se prestó no suma horas en ningún lado;
--
--       - la de mañana está `programada`, y es la que sirve para ver la grilla y
--         Estado actual: una sola fila con los dos nombres.
-- ----------------------------------------------------------------------------
INSERT INTO public.guardia_pacientes (guardia_id, paciente_id, prestadora_id) VALUES
  -- la que ya se cumplió
  ('70000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004',
   '11111111-1111-4111-8111-111111111111'),
  -- la que viene
  ('70000000-0000-4000-8000-000000000007', '50000000-0000-4000-8000-000000000004',
   '11111111-1111-4111-8111-111111111111');


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
)
ON CONFLICT (prestadora_id) DO UPDATE SET
  activo             = EXCLUDED.activo,
  horas_antes        = EXCLUDED.horas_antes,
  horas_entre_avisos = EXCLUDED.horas_entre_avisos;

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
)
ON CONFLICT (prestadora_id) DO UPDATE SET
  activo              = EXCLUDED.activo,
  direccion_remitente = EXCLUDED.direccion_remitente,
  usuario_smtp        = EXCLUDED.usuario_smtp,
  host                = EXCLUDED.host,
  puerto              = EXCLUDED.puerto;

-- El buzón de pruebas no pide contraseña, pero el backend solo usa el remitente
-- propio de la Prestadora si encuentra una guardada. Se carga una de relleno.
SELECT guardar_credencial_smtp_prestadora(
  '11111111-1111-4111-8111-111111111111',
  'el-buzon-local-no-pide-clave'
);


-- ----------------------------------------------------------------------------
--    6.d Cómo revisa esta Prestadora los reportes con inteligencia artificial.
--        Sin esta fila el producto igual funciona —los valores de fábrica están
--        en el backend—, pero la lista de palabras quedaría vacía y no se podría
--        probar en la máquina lo único que no tiene valor de fábrica: que un
--        reporte con una de estas palabras dispare la revisión en el momento en
--        vez de esperar al horario de siempre. Ver `backend/src/routes/
--        appAsistentes.js`, donde se leen al recibir el reporte.
--
--        Los números quedan distintos de los de fábrica a propósito (5 reportes
--        en vez de 7, la amarilla también le llega a la Familia), así se ve en
--        pantalla que lo guardado le gana al valor de fábrica.
-- ----------------------------------------------------------------------------
INSERT INTO public.configuracion_alertas_ia (
  prestadora_id, palabras_clave, reportes_a_analizar,
  roja_avisa_familia, amarilla_avisa_familia, amarilla_avisa_coordinador
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  ARRAY['caída', 'caida', 'sangrado', 'no responde', 'desorientado', 'fiebre alta', 'ahogo'],
  5,
  true,
  true,
  true
)
ON CONFLICT (prestadora_id) DO UPDATE SET
  palabras_clave             = EXCLUDED.palabras_clave,
  reportes_a_analizar        = EXCLUDED.reportes_a_analizar,
  roja_avisa_familia         = EXCLUDED.roja_avisa_familia,
  amarilla_avisa_familia     = EXCLUDED.amarilla_avisa_familia,
  amarilla_avisa_coordinador = EXCLUDED.amarilla_avisa_coordinador;


-- ----------------------------------------------------------------------------
-- 6 bis. Qué hace y qué no hace cada Asistente
-- ----------------------------------------------------------------------------
-- El catálogo de tipos viene con cuatro tipos de fábrica que trae el producto.
-- Acá se le da uno a cada Asistente y se arma un tipo propio de la Prestadora
-- con sus dos listas, para poder ver en pantalla los dos casos: el nombre que
-- se traduce y el nombre que escribió la Prestadora.
--
-- Las dos listas están cargadas a propósito con las cosas que en la vida real
-- generan la discusión en la puerta: limpiar toda la casa, cocinar para la
-- familia, dar una inyección.

INSERT INTO public.tipos_asistente (id, prestadora_id, clave, nombre, descripcion, requiere_matricula, tipo_matricula, activo, orden)
VALUES
  ('3a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   NULL, 'Acompañante terapéutico', 'Tipo propio de la Prestadora Sandbox.', false, NULL, true, 50);

INSERT INTO public.tareas_tipo_asistente (tipo_asistente_id, prestadora_id, clase, clave, texto, orden)
VALUES
  ('3a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'corresponde', NULL, 'Acompañar al Paciente en sus actividades diarias', 10),
  ('3a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'corresponde', NULL, 'Ayudarlo a higienizarse y a vestirse', 20),
  ('3a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'corresponde', NULL, 'Prepararle la comida y acompañarlo a comer', 30),
  ('3a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'corresponde', NULL, 'Dejar por escrito cómo pasó el día', 40),
  ('3a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'no_corresponde', NULL, 'Limpiar la casa o hacer las tareas del hogar de la familia', 10),
  ('3a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'no_corresponde', NULL, 'Cocinar para el resto de la familia', 20),
  ('3a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'no_corresponde', NULL, 'Dar inyecciones o curar heridas', 30),
  ('3a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'no_corresponde', NULL, 'Cambiar la dosis de un remedio por su cuenta', 40);

-- Ana lleva el tipo propio de la Prestadora; Clara, uno de fábrica, que se
-- traduce al idioma de quien mira.
UPDATE public.asistentes SET tipo_asistente_id = '3a000000-0000-4000-8000-000000000001'
WHERE id = '30000000-0000-4000-8000-000000000001';

UPDATE public.asistentes SET tipo_asistente_id = (
  SELECT id FROM public.tipos_asistente WHERE prestadora_id IS NULL AND clave = 'enfermero'
)
WHERE id = '30000000-0000-4000-8000-000000000003';


-- ----------------------------------------------------------------------------
-- 6 ter. Los papeles que vencen
-- ----------------------------------------------------------------------------
-- Sin estas filas, las tres pantallas que avisan vencimientos —Documentación,
-- Estado actual y el tablero— se ven vacías en la máquina y no hay forma de
-- comprobar que las tres clasifican igual.
--
-- Las fechas se calculan contra el día en que se siembra, no escritas a mano,
-- así el ejemplo no se pudre con el tiempo. Quedan los tres casos a la vista:
-- uno ya vencido, uno adentro del plazo de aviso y uno tranquilo.
--
-- El plazo de aviso de la Prestadora se dejó en 45 días a propósito, distinto
-- del valor de arranque de 30: si una pantalla estuviera usando el número de
-- fábrica en vez del configurado, el papel de 40 días se vería verde en una y
-- amarillo en otra, y el desacuerdo salta a la vista.

UPDATE public.prestadoras
SET dias_aviso_vencimiento_documentos = 45
WHERE id = '11111111-1111-4111-8111-111111111111';

INSERT INTO public.tipos_documento_asistente (id, prestadora_id, nombre, requiere_vencimiento, activo)
VALUES
  ('3d000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Libreta sanitaria', true, true),
  ('3d000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Certificado de antecedentes', true, true),
  ('3d000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'Título', false, true);

INSERT INTO public.documentos_asistente (prestadora_id, asistente_id, tipo_documento_id, fecha_vencimiento)
VALUES
  -- Ana: vencido hace una semana. Es el que tiene que salir en rojo.
  ('11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000001',
   '3d000000-0000-4000-8000-000000000001', CURRENT_DATE - 7),
  -- Ana: le quedan 40 días. Adentro del plazo de 45 que configuró la Prestadora,
  -- pero afuera del de fábrica: es el que delata a una pantalla desincronizada.
  ('11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000001',
   '3d000000-0000-4000-8000-000000000002', CURRENT_DATE + 40),
  -- Bruno: le quedan 10 días. Adentro del último tercio, o sea que apura.
  ('11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000002',
   '3d000000-0000-4000-8000-000000000001', CURRENT_DATE + 10),
  -- Clara: le queda medio año. Es el que tiene que quedarse callado.
  ('11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000003',
   '3d000000-0000-4000-8000-000000000001', CURRENT_DATE + 180);


-- ----------------------------------------------------------------------------
-- 6.b Cinco conceptos de liquidación para la Prestadora de prueba
-- ----------------------------------------------------------------------------
-- PARA QUÉ ESTÁN. La pantalla de Pagos arma la liquidación de cada Asistente
-- sumando y restando conceptos que configura la Prestadora. Con el catálogo
-- vacío la pantalla se puede abrir pero no se puede mirar: toda liquidación
-- saldría con el neto igual al bruto y no se vería ni un renglón.
--
-- LOS VALORES SON INVENTADOS. Ninguno de estos porcentajes ni de estos importes
-- es una cifra legal de ningún país. No sirven de referencia para nada y no
-- deben copiarse a la base de una Prestadora real: los valores de verdad los
-- carga cada Prestadora, y los que salen de la ley los carga un abogado
-- laboral en `escalas_legales` (regla 10 de `CLAUDE.md`: ningún porcentaje
-- vive en el código).
--
-- QUÉ CASO CUBRE CADA UNO. Están elegidos para que se vean los cinco caminos
-- distintos que sabe recorrer el generador:
--   * importe fijo mensual con moneda propia
--   * porcentaje sobre el bruto, que no lleva moneda
--   * importe por hora trabajada
--   * concepto que alcanza solo a una forma de vínculo
--   * concepto atado a una escala legal todavía no cargada, que el generador
--     tiene que saltear e informar en vez de estimar

INSERT INTO public.conceptos_liquidacion
  (id, prestadora_id, nombre, signo, unidad, origen_valor, valor, escala_tipo, moneda, aplica_a, orden)
VALUES
  -- Importe fijo, para todos. Es el caso más simple y el que prueba que la
  -- moneda se completa sola desde la Prestadora.
  ('6c000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Adicional por título', 'suma', 'monto_fijo_mensual', 'propio', 35000, NULL, NULL, 'todos', 10),

  -- Porcentaje sobre el bruto. Sin moneda a propósito: un porcentaje no es
  -- plata hasta que se aplica, y la base rechaza la fila si trae moneda.
  ('6c000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Adicional por antigüedad', 'suma', 'porcentaje', 'propio', 5, NULL, NULL, 'todos', 20),

  -- Importe por hora efectivamente trabajada. Distingue a quien hizo guardias
  -- de quien no hizo ninguna en el mes.
  ('6c000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'Refrigerio por hora', 'suma', 'monto_por_hora', 'propio', 300, NULL, NULL, 'todos', 30),

  -- Solo para quien está en relación de dependencia. A un monotributista no
  -- se le tiene que descontar: es el caso que prueba el filtro por vínculo.
  ('6c000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   'Aportes del trabajador', 'resta', 'porcentaje', 'propio', 17, NULL, NULL, 'dependencia', 40),

  -- Atado a una escala legal que hoy no está cargada (`escalas_legales` está
  -- vacía hasta que la complete un abogado, pendiente #130). Tiene que quedar
  -- afuera de la cuenta y aparecer en el aviso de la pantalla, nunca estimado.
  ('6c000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111',
   'Viático de traslado', 'suma', 'monto_fijo_mensual', 'escala_legal', NULL, 'viatico_traslado', NULL, 'todos', 50);


-- ----------------------------------------------------------------------------
-- 7. La segunda Prestadora: Cuidar del Sur
--
--    POR QUÉ EXISTE. La promesa central del producto es que una Prestadora
--    nunca ve datos de otra (§2 de `CLAUDE.md`). Con una sola Prestadora
--    sembrada, esa promesa no se puede probar: toda consulta devuelve lo
--    propio y no hay con qué comparar. Una pantalla vacía y una pantalla
--    correctamente aislada se ven igual.
--
--    Con dos, la prueba existe y es concluyente: cada usuario tiene que ver
--    lo suyo y nada de la otra, y hay que poder intentar romperlo a propósito
--    —pedirle al motor el identificador de una guardia ajena, por ejemplo— y
--    que rebote. Esa prueba la corre `scripts/probar_aislamiento.mjs`.
--
--    LA VENTANA SE CIERRA SOLA. Intentar romper el aislamiento a propósito
--    solo se puede hacer mientras todos los datos son inventados. El día que
--    exista la primera Prestadora real, cada prueba de este tipo se hace con
--    datos de personas adentro, y deja de ser gratis.
--
--    ES CHICA A PROPÓSITO. No necesita una operación completa: alcanza con un
--    usuario de cada rol y una fila en las tablas que las pantallas leen. Lo
--    que se prueba es el aislamiento, no el volumen.
-- ----------------------------------------------------------------------------
INSERT INTO public.prestadoras (id, razon_social, nombre_fantasia, identificacion_fiscal, pais, estado, zonas_operacion, fecha_alta, moneda)
VALUES ('22222222-2222-4222-8222-222222222222', 'Cuidados del Sur S.R.L.', 'Cuidar del Sur',
        '30-99999999-7', 'AR', 'certificada', ARRAY['la_plata'], current_date, 'ARS');

INSERT INTO public.zonas_cobertura (prestadora_id, codigo, nombre, categoria, orden) VALUES
  ('22222222-2222-4222-8222-222222222222', 'la_plata', 'La Plata', 'ciudad', 10);

-- Las cuatro cuentas de la segunda Prestadora, con la misma mecánica de tres
-- tablas que explica el punto 2. Entran con la misma contraseña que el resto.
WITH personas (id, email, nombre, rol, telefono) AS (
  VALUES
    ('50000000-0000-4000-8000-000000000001'::uuid, 'admin@sur.local'::text,   'Alicia Administradora Sur'::text, 'admin_prestadora'::text, '+54 221 400-0001'::text),
    ('50000000-0000-4000-8000-000000000002',       'coordinadora@sur.local',  'Cecilia Coordinadora Sur',        'coordinador',            '+54 221 400-0002'),
    ('50000000-0000-4000-8000-000000000003',       'asistente.sur@sur.local', 'Elena Escobar',                   'asistente',              '+54 221 400-0003'),
    ('50000000-0000-4000-8000-000000000004',       'familia.rios@sur.local',  'Familia Ríos',                    'familia',                '+54 221 400-0004')
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
INSERT INTO public.usuarios (id, rol, nombre, telefono, prestadora_id)
SELECT p.id, p.rol, p.nombre, p.telefono, '22222222-2222-4222-8222-222222222222'
FROM personas p;

INSERT INTO public.asistentes (id, nombre, prestadora_id)
VALUES ('50000000-0000-4000-8000-000000000003', 'Elena Escobar', '22222222-2222-4222-8222-222222222222');

INSERT INTO public.familias (id, prestadora_id)
VALUES ('50000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222');

-- Con familia, porque sin ella la aplicación de Familia de esta Prestadora no tiene
-- nada que leer y la prueba de aislamiento de ese lado no puede fallar.
INSERT INTO public.pacientes (id, nombre, prestadora_id, familia_id)
VALUES ('60000000-0000-4000-8000-000000000001', 'Rosa Ríos', '22222222-2222-4222-8222-222222222222',
        '50000000-0000-4000-8000-000000000004');

INSERT INTO public.servicios (id, prestadora_id, familia_id, etiqueta)
VALUES ('70000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
        '50000000-0000-4000-8000-000000000004', 'Cuidado diurno Ríos');

-- Con Asistente asignado, por el mismo motivo que el Paciente lleva Familia: un
-- Asistente sin Guardias no ve nada, y una prueba contra la nada no prueba nada.
INSERT INTO public.guardias (id, prestadora_id, asistente_id, paciente_id, fecha, hora_inicio, hora_fin, modalidad)
VALUES ('80000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
        '50000000-0000-4000-8000-000000000003',
        '60000000-0000-4000-8000-000000000001', current_date + 1, '08:00', '16:00', 'presencial');

-- La fila de `guardia_pacientes` no se siembra: la escribe sola la base al
-- insertar la Guardia.

-- ----------------------------------------------------------------------------
-- 8. Lo que leen las dos aplicaciones de teléfono, en las dos Prestadoras
--
--    POR QUÉ ESTÁ ACÁ. Las políticas que separan una Prestadora de otra en las
--    tablas de la aplicación del Asistente y la de la Familia sólo se pueden
--    comprobar si las dos Prestadoras tienen filas cargadas en ellas. Sobre una
--    tabla vacía toda consulta devuelve cero, y cero es exactamente lo que
--    devolvería una política rota que niega todo: la prueba no puede fallar, y
--    una prueba que no puede fallar no prueba nada.
--
--    Es una fila por tabla y por Prestadora. No hace falta más: lo que se
--    prueba es quién alcanza qué, no el volumen.
--
--    Todos los datos son inventados, como manda `CLAUDE.md`.
-- ----------------------------------------------------------------------------

-- Certificados del Asistente. Los lee él en su aplicación, y la Familia ve el
-- del Asistente que atiende a su Paciente.
INSERT INTO public.certificados (id, asistente_id, prestadora_id, fecha_emision, fecha_vencimiento)
VALUES ('9a000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        '11111111-1111-4111-8111-111111111111', current_date - 200, current_date + 500),
       ('9a000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003',
        '22222222-2222-4222-8222-222222222222', current_date - 100, current_date + 600);

-- Matrículas. Esta tabla no tiene columna de Prestadora: queda acotada por el
-- Asistente, que sí la tiene. Por eso es la que más vale probar.
INSERT INTO public.matriculas_asistente (id, asistente_id, tipo, numero_matricula, vigente_desde, registrado_por)
VALUES ('9b000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        'enfermeria', 'MP-10001', current_date - 400, '20000000-0000-4000-8000-000000000003'),
       ('9b000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003',
        'enfermeria', 'MP-20002', current_date - 300, '50000000-0000-4000-8000-000000000002');

-- Mensajes entre el Asistente y la Prestadora.
INSERT INTO public.mensajes_asistente (id, prestadora_id, asistente_id, usuario_id, mensaje)
VALUES ('9c000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003',
        'Recordatorio de la reunión de equipo del viernes.'),
       ('9c000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
        '50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002',
        'Se actualizó el instructivo de ingreso al domicilio.');

-- Consentimiento de seguimiento de ubicación, otorgado por cada Asistente.
INSERT INTO public.consentimientos_asistente
  (id, prestadora_id, asistente_id, clave, texto_consentimiento_id, version_mostrada,
   idioma_mostrado, texto_mostrado, decision)
VALUES ('9d000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        '30000000-0000-4000-8000-000000000001', 'seguimiento_ubicacion',
        (SELECT id FROM public.textos_consentimiento
          WHERE clave = 'seguimiento_ubicacion' AND idioma = 'es-AR' ORDER BY version DESC LIMIT 1),
        1, 'es-AR', 'Texto de prueba del consentimiento de seguimiento de ubicación.', 'otorgado'),
       ('9d000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
        '50000000-0000-4000-8000-000000000003', 'seguimiento_ubicacion',
        (SELECT id FROM public.textos_consentimiento
          WHERE clave = 'seguimiento_ubicacion' AND idioma = 'es-AR' ORDER BY version DESC LIMIT 1),
        1, 'es-AR', 'Texto de prueba del consentimiento de seguimiento de ubicación.', 'otorgado');

-- Calificación de la Familia al Asistente. El Asistente la lee y puede
-- contestarla; la Familia lee la que escribió.
INSERT INTO public.calificaciones_asistente
  (id, asistente_id, paciente_id, familia_id, guardia_id, prestadora_id, estrellas, comentario)
VALUES ('9e000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
        '70000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        5, 'Muy puntual y atenta.'),
       ('9e000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003',
        '60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004',
        '80000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
        4, 'Buen trato, llegó unos minutos tarde.');

-- Indicación de medicación cargada por la Familia. La lee también el Asistente
-- que atiende a ese Paciente.
INSERT INTO public.indicaciones_medicacion
  (id, prestadora_id, paciente_id, familia_id, medicamento, dosis, frecuencia,
   via_administracion, fecha_desde, estado, solicitado_por)
VALUES ('9f000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
        'Enalapril', '10 mg', 'cada 12 horas', 'oral', current_date - 30, 'aceptada',
        '40000000-0000-4000-8000-000000000001'),
       ('9f000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
        '60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004',
        'Metformina', '850 mg', 'cada 24 horas', 'oral', current_date - 15, 'aceptada',
        '50000000-0000-4000-8000-000000000004');

-- Rangos de referencia de los signos vitales, por Paciente.
INSERT INTO public.rangos_referencia_vitales
  (id, prestadora_id, paciente_id, signo, valor_min, valor_max, unidad, fuente)
VALUES ('a1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        '50000000-0000-4000-8000-000000000001', 'temperatura', 36.0, 37.5, '°C',
        'Valor de referencia general'),
       ('a1000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
        '60000000-0000-4000-8000-000000000001', 'temperatura', 36.0, 37.5, '°C',
        'Valor de referencia general');

-- Autorización para monitorear los signos vitales de un Paciente.
INSERT INTO public.autorizaciones_monitoreo_paciente
  (id, prestadora_id, paciente_id, nombre_avala, rol_avala, tipo_firma, archivo_url,
   fecha_autorizacion, registrado_por)
VALUES ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        '50000000-0000-4000-8000-000000000001', 'Dra. Inés Falcón', 'profesional', 'digital',
        '11111111-1111-4111-8111-111111111111/autorizaciones/prueba-a.pdf',
        current_date - 60, '20000000-0000-4000-8000-000000000003'),
       ('a2000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
        '60000000-0000-4000-8000-000000000001', 'Dr. Omar Vega', 'profesional', 'digital',
        '22222222-2222-4222-8222-222222222222/autorizaciones/prueba-b.pdf',
        current_date - 45, '50000000-0000-4000-8000-000000000002');

-- Una perilla de visibilidad tocada por cada Prestadora. La lista de perillas
-- posibles no se siembra: vive en `backend/src/utils/catalogoVisibilidad.js` y
-- la fila nace la primera vez que la Prestadora la cambia.
INSERT INTO public.configuracion_visibilidad_app (prestadora_id, clave, visible)
VALUES ('11111111-1111-4111-8111-111111111111', 'familia_ubicacion_en_vivo', true),
       ('22222222-2222-4222-8222-222222222222', 'familia_ubicacion_en_vivo', false);

-- Qué matrícula exige cada vía de administración.
INSERT INTO public.configuracion_matricula_via_medicacion
  (id, prestadora_id, via_administracion, tipo_matricula_requerida)
VALUES ('a3000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        'intravenosa', 'enfermeria'),
       ('a3000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
        'intravenosa', 'enfermeria');


-- ----------------------------------------------------------------------------
-- 9. Limpieza y aviso final
-- ----------------------------------------------------------------------------
-- Sin esto, la capa que sirve los datos puede seguir contestando 404 en tablas
-- que sí existen (§8 de `CLAUDE.md`).
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Base local sembrada. Dos Prestadoras: Sandbox y Cuidar del Sur.';
  RAISE NOTICE 'Contraseña de todas las cuentas: local-sandbox-2026';
  RAISE NOTICE '  Sandbox, Panel  -> superadmin@sandbox.local / admin@sandbox.local / coordinadora@sandbox.local';
  RAISE NOTICE '  Sandbox, Asistentes -> ana.asistente@sandbox.local (y bruno, clara, delia)';
  RAISE NOTICE '  Sandbox, Familias   -> familia.gomez@sandbox.local (y lopez, morales)';
  RAISE NOTICE '  Cuidar del Sur  -> admin@sur.local / coordinadora@sur.local / asistente.sur@sur.local / familia.rios@sur.local';
  RAISE NOTICE 'Los correos que manda el backend quedan en http://127.0.0.1:54424';
  RAISE NOTICE 'Para comprobar que ninguna ve datos de la otra: node scripts/probar_aislamiento.mjs';
  RAISE NOTICE '';
END $$;

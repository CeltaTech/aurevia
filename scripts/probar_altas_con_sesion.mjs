// ---------------------------------------------------------------------------
// probar_altas_con_sesion.mjs — ¿una persona con sesión puede dar de alta?
//
// Uso, desde la raíz del producto, con la base local levantada:
//   node scripts/probar_altas_con_sesion.mjs
//
// Devuelve 0 si todas las altas entraron y 1 si alguna rebotó.
//
// POR QUÉ EXISTE
//
// El Panel escribe en la base directamente desde el navegador, con el pase de
// la persona que entró. El motor, en cambio, entra con la llave de servicio,
// que puede todo. Son dos roles distintos con permisos distintos, y hasta que
// se escribió esta prueba **ninguna prueba del producto escribía con el pase de
// una persona**: las del motor pasan por la llave de servicio, y
// `probar_aislamiento.mjs` abre sesión de persona pero solamente lee.
//
// Por ese hueco se coló un defecto que estuvo dado de alta en el código sin que
// nada lo notara: catorce tablas tenían un disparador que llamaba a una función
// que quien inserta no tenía permiso de ejecutar, así que toda alta hecha desde
// el Panel se caía con «42501 permission denied». Con la llave de servicio
// entraba sin problema, y por eso las 576 pruebas del motor seguían en verde.
//
// QUÉ PRUEBA
//
// Dos cosas distintas, y las dos hacen falta:
//
//   1. EL CAMINO REAL. Abre sesión de administradora de la Prestadora de
//      pruebas y da de alta una fila en cada tabla que tenga uno de estos
//      disparadores, sin mandarle el dato que el disparador completa. Espera
//      que entre y que el dato haya quedado puesto. Lo que inserta se borra al
//      terminar.
//
//   2. QUE NO VUELVA A PASAR, ni acá ni en un disparador que se escriba mañana.
//      Le pregunta a la base, para todos sus disparadores que corren con el rol
//      de quien escribe, si alguno llama a una función que ese rol no pueda
//      ejecutar. Con el defecto puesto esto encontraba ocho.
//
// La primera prueba el caso conocido; la segunda, la clase entera. Sin la
// segunda, un disparador nuevo repetiría el defecto y esta prueba seguiría en
// verde porque no toca su tabla.
//
// QUÉ QUEDA AFUERA DEL CAMINO REAL, y por qué no queda sin probar
//
// Dos disparadores no se pueden alcanzar con una sesión de Panel, porque las
// filas que los despiertan no las escribe el Panel:
//
//   · `fn_completar_moneda_desde_familia`, de `qr_cobro_efectivo`, que escribe
//     una Familia y no el Panel, y cuya política exige además una suscripción
//     del Marketplace y el permiso de dinero adentro del Círculo.
//   · `fn_modalidades_de_asistente_nuevo`, que corre sólo al insertar un
//     Asistente, y un Asistente lo da de alta el motor: su identificador es el
//     de la persona, que tiene que existir antes.
//
// Los dos llaman a la misma función que otro disparador que sí se prueba acá,
// y la segunda comprobación los alcanza igual. De `asistentes` se prueba lo que
// el Panel hace de verdad, que es modificarle las modalidades a uno que ya
// existe (`panel/src/pages/asistentes/PerfilTab.jsx`).
//
// QUÉ NECESITA. La Prestadora de pruebas que siembra `supabase/seed.sql`, con
// sus pacientes y asistentes. Si falta algo, avisa y no corre.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// El contenedor de la base local. El nombre se arma con el identificador que
// está en `supabase/config.toml`, no escrito a mano acá.
const CONTENEDOR = process.env.CONTENEDOR_BASE || (() => {
  const toml = readFileSync(join(RAIZ, 'supabase', 'config.toml'), 'utf8');
  const id = toml.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
  if (!id) throw new Error('No encontré project_id en supabase/config.toml.');
  return `supabase_db_${id[1]}`;
})();

// Sirve sólo contra la base local de Docker, que se rehace de cero cuando se
// quiere. No es una clave: está escrita en `supabase/seed.sql`.
const CONTRASENA = 'local-sandbox-2026';
const ADMINISTRADORA = 'admin@sandbox.local';

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const rojo = (t) => `\x1b[31m${t}\x1b[0m`;
const gris = (t) => `\x1b[90m${t}\x1b[0m`;

function leerEntorno() {
  const archivo = join(RAIZ, 'panel', '.env.local');
  if (!existsSync(archivo)) {
    throw new Error(`Falta ${archivo}. Sin la dirección de la base local no hay nada que probar.`);
  }
  const valores = {};
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const corte = linea.indexOf('=');
    if (corte < 1 || linea.trimStart().startsWith('#')) continue;
    valores[linea.slice(0, corte).trim()] = linea.slice(corte + 1).trim();
  }
  return { base: valores.VITE_SUPABASE_URL, llavePublica: valores.VITE_SUPABASE_ANON_KEY };
}

function consultarBase(sql) {
  const salida = execFileSync(
    'docker',
    ['exec', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-F', '|', '-c', sql],
    { encoding: 'utf8' },
  );
  return salida.trim().split('\n').filter(Boolean).map((l) => l.split('|'));
}

async function entrar(base, llavePublica, email) {
  const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: llavePublica, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CONTRASENA }),
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!cuerpo.access_token) {
    throw new Error(`No se pudo entrar como ${email} (${r.status}). ¿Corriste "npx supabase db reset --local"?`);
  }
  return cuerpo.access_token;
}

// ---------------------------------------------------------------------------
// Los datos con los que se arman las altas
// ---------------------------------------------------------------------------

function anclas() {
  const [fila] = consultarBase(`
    WITH p AS (
      SELECT id, moneda FROM public.prestadoras
       WHERE razon_social ILIKE '%Sandbox%' OR nombre_fantasia ILIKE '%Sandbox%'
       LIMIT 1
    ),
    -- Un Asistente al que la Matrícula no le frene la Guardia, porque si lo
    -- frena el alta rebota por ese otro motivo y la prueba diría que hay un
    -- problema de permisos donde no lo hay. Y de esos, primero el que trabaje
    -- en más de una modalidad: es el único con el que se puede probar el
    -- disparador de las modalidades sin cambiarle a nadie la forma de trabajo.
    elegido AS (
      SELECT a.id, a.canales
        FROM public.asistentes a
       WHERE a.prestadora_id = (SELECT id FROM p)
         AND a.estado = 'activo'
         AND interno.motivo_bloqueo_matricula(a.id, CURRENT_DATE) IS NULL
         AND 'directa' = ANY(a.canales)
       ORDER BY coalesce(array_length(a.canales, 1), 0) DESC, a.id
       LIMIT 1
    )
    SELECT (SELECT id FROM p),
           (SELECT moneda FROM p),
           (SELECT id FROM public.pacientes WHERE prestadora_id = (SELECT id FROM p)
             ORDER BY id LIMIT 1),
           (SELECT id FROM elegido),
           (SELECT array_to_string(canales, ',') FROM elegido);
  `);

  const [prestadora, moneda, paciente, asistente, canalesEnTexto] = fila || [];
  const faltan = [
    !prestadora && 'la Prestadora de pruebas',
    !paciente && 'un Paciente suyo',
    !asistente && 'un Asistente suyo con la Matrícula al día y que trabaje en directa',
  ].filter(Boolean);

  if (faltan.length) {
    throw new Error(`Falta ${faltan.join(', ')} en la base. Corré "npx supabase db reset --local".`);
  }

  // Para que el disparador de las modalidades llegue a llamar a la función, lo
  // que se escribe tiene que ser distinto de lo que ya está: si es igual, el
  // disparador se corta antes de llamar a nada y la prueba pasaría sin haber
  // probado nada.
  const canalesAhora = (canalesEnTexto || '').split(',').filter(Boolean);
  const canalesDeLaPrueba = canalesAhora.length > 1 ? [canalesAhora[0]] : null;

  return { prestadora, moneda, paciente, asistente, canalesAhora, canalesDeLaPrueba };
}

// ---------------------------------------------------------------------------
// Primera comprobación: el camino real
// ---------------------------------------------------------------------------

async function probarLasAltas({ base, llavePublica }, token, d) {
  const hoy = new Date().toISOString().slice(0, 10);

  // Cada caso dice qué tabla, qué se manda, qué disparador se está probando y
  // qué tiene que haber quedado completo cuando el disparador hizo su trabajo.
  const casos = [
    {
      tabla: 'prestaciones',
      disparadores: 'fn_completar_moneda → interno.moneda_de_prestadora',
      fila: {
        prestadora_id: d.prestadora,
        paciente_id: d.paciente,
        tipo_servicio: 'Prueba de altas con sesión',
        precio_final: 1234.56,
      },
      completa: (f) => (f.moneda === d.moneda
        ? null
        : `la moneda quedó en ${JSON.stringify(f.moneda)} y la Prestadora trabaja en ${d.moneda}`),
    },
    {
      // Lo que hace el Panel de verdad: cambiarle las modalidades a un
      // Asistente que ya existe. Se le vuelven a poner las que tenía, así que
      // la fila queda como estaba.
      tabla: 'asistentes',
      modifica: d.canalesDeLaPrueba ? `id=eq.${d.asistente}` : null,
      sinCamino: 'ningún Asistente de prueba tiene más de una modalidad, así que no hay '
        + 'valor distinto que escribirle sin cambiarle la forma de trabajo',
      restaura: { canales: d.canalesAhora },
      disparadores: 'fn_modalidades_dentro_de_lo_habilitado → interno.modalidades_habilitadas_de_prestadora',
      fila: { canales: d.canalesDeLaPrueba },
      completa: (f) => (Array.isArray(f.canales) && f.canales.length
        ? null
        : `las modalidades quedaron en ${JSON.stringify(f.canales)}`),
    },
    {
      tabla: 'guardias',
      disparadores:
        'exigir_matricula_en_guardia → interno.motivo_bloqueo_matricula, y '
        + 'fn_modalidad_de_la_guardia → interno.asistente_trabaja_en_modalidad',
      fila: {
        prestadora_id: d.prestadora,
        paciente_id: d.paciente,
        asistente_id: d.asistente,
        fecha: hoy,
        hora_inicio: '08:00',
        hora_fin: '12:00',
        modalidad: 'presencial',
        canal_modalidad: 'directa',
      },
      completa: () => null,
    },
  ];

  // La oferta necesita la Guardia que crea el caso anterior, así que se arma
  // recién cuando ésa entró.
  const creado = [];
  const problemas = [];

  console.log('\n== El camino real: dar de alta con el pase de una persona ==\n');
  console.log(gris(`  Sesión: ${ADMINISTRADORA}\n`));

  for (const caso of [...casos, null]) {
    let elCaso = caso;

    if (elCaso === null) {
      const guardia = creado.find((c) => c.tabla === 'guardias');
      if (!guardia) continue;
      elCaso = {
        tabla: 'ofertas_guardia',
        disparadores:
          'exigir_matricula_en_oferta → interno.motivo_bloqueo_matricula, y '
          + 'fn_modalidad_en_oferta → interno.asistente_trabaja_en_modalidad',
        fila: {
          prestadora_id: d.prestadora,
          guardia_id: guardia.id,
          asistente_id: d.asistente,
        },
        completa: () => null,
      };
    }

    // Un caso que declara `modifica` cambia una fila que ya está en vez de
    // crear una nueva, porque eso es lo que hace el Panel con esa tabla.
    const modifica = 'modifica' in elCaso;
    if (modifica && !elCaso.modifica) {
      console.log(gris(`  – ${elCaso.tabla}: no se pudo probar por el camino real`));
      console.log(gris(`      ${elCaso.sinCamino}`));
      continue;
    }

    const escribir = async (cuerpoDelPedido, filtro) => {
      const r = await fetch(`${base}/rest/v1/${elCaso.tabla}${filtro ? `?${filtro}` : ''}`, {
        method: filtro ? 'PATCH' : 'POST',
        headers: {
          apikey: llavePublica,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(cuerpoDelPedido),
      });
      return [r, await r.json().catch(() => null)];
    };

    const [r, cuerpo] = await escribir(elCaso.fila, elCaso.modifica);

    if (!r.ok) {
      const detalle = cuerpo?.message || JSON.stringify(cuerpo);
      const codigo = cuerpo?.code ? `${cuerpo.code} ` : '';
      const verbo = modifica ? 'la modificación rebotó' : 'el alta rebotó';
      problemas.push(`${elCaso.tabla}: ${verbo} con ${r.status} — ${codigo}${detalle}`);
      console.log(rojo(`  ✗ ${elCaso.tabla}`));
      console.log(gris(`      ${elCaso.disparadores}`));
      console.log(rojo(`      ${r.status} ${codigo}${detalle}`));
      continue;
    }

    const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
    if (modifica) {
      // La fila era de antes y se queda: se le devuelve lo que tenía.
      await escribir(elCaso.restaura, elCaso.modifica);
    } else {
      creado.push({ tabla: elCaso.tabla, id: fila?.id });
    }

    const incompleto = elCaso.completa(fila || {});
    if (incompleto) {
      problemas.push(`${elCaso.tabla}: entró pero el disparador no hizo lo suyo — ${incompleto}`);
      console.log(rojo(`  ✗ ${elCaso.tabla}: ${incompleto}`));
    } else {
      console.log(verde(`  ✓ ${elCaso.tabla}`));
      console.log(gris(`      ${elCaso.disparadores}`));
    }
  }

  return { problemas, creado };
}

// ---------------------------------------------------------------------------
// Segunda comprobación: que no vuelva a pasar
// ---------------------------------------------------------------------------

function probarLaClaseEntera() {
  console.log('\n== La clase entera: ¿algún disparador llama algo que quien escribe no pueda? ==\n');

  const filas = consultarBase(`
    WITH disparadores AS (
      SELECT DISTINCT p.oid, n.nspname || '.' || p.proname AS quien, p.prosrc
        FROM pg_trigger t
        JOIN pg_proc p ON p.oid = t.tgfoid
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE NOT t.tgisinternal AND NOT p.prosecdef
    ),
    llamables AS (
      SELECT p.oid, n.nspname || '.' || p.proname AS cual, p.proname AS solo_nombre
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'interno')
    )
    SELECT DISTINCT d.quien, l.cual
      FROM disparadores d
      JOIN llamables l ON l.oid <> d.oid AND d.prosrc ~ ('\\y' || l.solo_nombre || '\\y')
     WHERE NOT has_function_privilege('authenticated', l.oid, 'EXECUTE')
     ORDER BY 1, 2;
  `);

  const [[cuantos]] = consultarBase(`
    SELECT count(DISTINCT p.oid) FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND NOT p.prosecdef;
  `);

  if (!filas.length) {
    console.log(verde(`  Los ${cuantos} disparadores que corren con el rol de quien escribe`));
    console.log(verde('  llaman solamente cosas que ese rol puede ejecutar.'));
    return [];
  }

  console.log(rojo(`  ${filas.length} llamada(s) que quien escribe no puede hacer:`));
  for (const [quien, cual] of filas) console.log(rojo(`    ${quien} → ${cual}`));
  return filas.map(([quien, cual]) => `${quien} llama a ${cual}, que quien escribe no puede ejecutar`);
}

// ---------------------------------------------------------------------------

function limpiar(creado, idAsistente) {
  // Se borra con la llave del dueño de la base y no con la sesión, porque lo
  // que importa que funcione es el alta; si el borrado fallara por permisos, la
  // prueba dejaría basura sembrada y la próxima corrida arrancaría sucia.
  const borrados = [];
  for (const { tabla, id } of [...creado].reverse()) {
    if (!id) continue;
    const comilla = typeof id === 'string' && id.includes('-') ? `'${id}'` : id;
    consultarBase(`DELETE FROM public.${tabla} WHERE id = ${comilla};`);
    borrados.push(tabla);
  }
  if (idAsistente) consultarBase(`DELETE FROM public.asistentes WHERE id = '${idAsistente}';`);
  return borrados;
}

async function main() {
  const entorno = leerEntorno();
  const d = anclas();
  const token = await entrar(entorno.base, entorno.llavePublica, ADMINISTRADORA);

  let resultado = { problemas: [], creado: [] };
  try {
    resultado = await probarLasAltas(entorno, token, d);
  } finally {
    const borrados = limpiar(resultado.creado);
    consultarBase("DELETE FROM public.asistentes WHERE nombre = 'Prueba de altas con sesión';");
    consultarBase("DELETE FROM public.prestaciones WHERE tipo_servicio = 'Prueba de altas con sesión';");
    if (borrados.length) console.log(gris(`\n  (se borró lo que se dio de alta: ${borrados.join(', ')})`));
  }

  const deLaClase = probarLaClaseEntera();
  const problemas = [...resultado.problemas, ...deLaClase];

  console.log('');
  if (problemas.length) {
    console.log(rojo(`FALLA — ${problemas.length} problema(s):`));
    for (const p of problemas) console.log(rojo(`  · ${p}`));
    console.log(gris('\n  Un «42501 permission denied for function» acá significa que un disparador'));
    console.log(gris('  llama a una función que quien inserta no puede ejecutar. No se arregla'));
    console.log(gris('  tocando políticas: la función tiene que estar del lado de adentro, en el'));
    console.log(gris('  esquema `interno`, y con permiso para `authenticated`.'));
    process.exit(1);
  }

  console.log(verde('BIEN — quien tiene sesión puede dar de alta, y ningún disparador pide un permiso que no tiene.'));
  process.exit(0);
}

main().catch((e) => {
  console.error(rojo(`\n${e.message}`));
  process.exit(1);
});

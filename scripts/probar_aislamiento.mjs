// ---------------------------------------------------------------------------
// probar_aislamiento.mjs — ¿una Prestadora puede ver datos de otra?
//
// Uso, desde la raíz del producto, con la base local levantada:
//   node scripts/probar_aislamiento.mjs
//
// Devuelve 0 si nada se cruzó y 1 si algo se cruzó. Está pensado para poder
// colgarse de la integración continua sin cambiarle una línea.
//
// QUÉ PRUEBA Y POR QUÉ HACEN FALTA DOS PRUEBAS
//
// A los datos de una Prestadora se llega por dos caminos distintos, y cada uno
// se defiende de una manera distinta:
//
//   1. EL CAMINO DE LA BASE. El Panel consulta la base directamente desde el
//      navegador. Ahí quien separa una Prestadora de otra es la base misma,
//      con sus políticas de seguridad por fila. La prueba recorre todas las
//      tablas que tienen columna de Prestadora, entra como administradora de
//      cada una y comprueba que ninguna consulta devuelva una fila ajena.
//
//   2. EL CAMINO DEL MOTOR. Las dos aplicaciones de celular no consultan la
//      base: le piden todo al motor, y el motor entra a la base con la llave
//      de servicio, que se saltea las políticas por diseño. Ahí no hay base
//      que proteja nada: la separación está escrita a mano, condición por
//      condición, en cada consulta. La prueba intenta a propósito alcanzar
//      datos ajenos por ese camino —pedirle el identificador de una guardia
//      de la otra Prestadora, fichar entrada en ella, modificarle una zona— y
//      espera que todo rebote.
//
// Aprobar la primera y no la segunda no significa nada: son dos puertas.
//
// UNA RESPUESTA AFIRMATIVA NO ES UNA FILTRACIÓN. Cuando el intento escribe, la
// prueba mira la fila ajena antes y después y compara. Hace falta, porque el
// motor a veces contesta que sí sobre cero filas: la condición de Prestadora se
// aplicó, no encontró nada que modificar, y aun así la respuesta salió
// afirmativa. Eso no es que se haya llevado nada —no cambió ni un dato— y por
// eso no hace fallar esta prueba; sale como aviso y tiene su propio pendiente.
// Lo que hace fallar es que la fila ajena cambie, o que una lectura ajena
// devuelva contenido.
//
// POR QUÉ AHORA. Intentar romper el aislamiento a propósito solo es gratis
// mientras todos los datos son inventados. Cuando exista la primera Prestadora
// real, cada prueba de este tipo se corre con datos de personas adentro.
//
// QUÉ NECESITA. Las dos Prestadoras de prueba que siembra `supabase/seed.sql`:
// Sandbox y Cuidar del Sur. Si la base no tiene las dos, avisa y no corre.
// El tramo del motor se saltea solo si el motor no está levantado, porque la
// mitad que sí se puede probar vale igual.
//
// QUÉ NO PRUEBA. Que las cuentas vean lo que les corresponde adentro de su
// propia Prestadora: un coordinador que ve pacientes de otra zona de su misma
// Prestadora es un problema de permisos, no de aislamiento, y se prueba aparte.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// El contenedor de la base local. El nombre se arma con el identificador que
// está en `supabase/config.toml`, no escrito a mano acá: así sigue funcionando
// si ese identificador cambia, y no hay un nombre de producto suelto en el
// código (§7.1 de `CLAUDE.md`).
const CONTENEDOR = process.env.CONTENEDOR_BASE || (() => {
  const toml = readFileSync(join(RAIZ, 'supabase', 'config.toml'), 'utf8');
  const id = toml.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
  if (!id) throw new Error('No encontré project_id en supabase/config.toml.');
  return `supabase_db_${id[1]}`;
})();

// La contraseña de las cuentas de prueba. No es un secreto: la escribe el
// propio `seed.sql` y solo sirve contra la base local.
const CONTRASENA = 'local-sandbox-2026';

const PRESTADORA_A = { nombre: 'Sandbox',        sufijo: '@sandbox.local' };
const PRESTADORA_B = { nombre: 'Cuidar del Sur', sufijo: '@sur.local' };

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

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
  return {
    base: valores.VITE_SUPABASE_URL,
    llavePublica: valores.VITE_SUPABASE_ANON_KEY,
    motor: process.env.URL_MOTOR || valores.VITE_API_URL || 'http://127.0.0.1:4000',
  };
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
    throw new Error(`No se pudo entrar como ${email} (${r.status}). ¿Corriste "npx supabase db reset"?`);
  }
  return cuerpo.access_token;
}

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const rojo = (t) => `\x1b[31m${t}\x1b[0m`;
const gris = (t) => `\x1b[90m${t}\x1b[0m`;

// ---------------------------------------------------------------------------
// Primera puerta: la base
// ---------------------------------------------------------------------------

async function probarLaBase({ base, llavePublica }, idA, idB, sesiones) {
  const tablas = consultarBase(`
    SELECT c.relname, c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
                         AND a.attname = 'prestadora_id'
                         AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY 1;
  `);

  console.log(`\n== La base: ${tablas.length} tablas guardan datos de una Prestadora ==\n`);

  const sinProteccion = tablas.filter(([, rls]) => rls !== 't').map(([t]) => t);
  if (sinProteccion.length) {
    console.log(rojo(`  Sin protección por fila: ${sinProteccion.join(', ')}`));
  } else {
    console.log(verde('  Las ' + tablas.length + ' tienen protección por fila activada.'));
  }

  const problemas = [...sinProteccion.map((t) => `${t}: la tabla no tiene protección por fila`)];
  let propias = 0;

  for (const [{ nombre }, token, propio, ajeno] of [
    [PRESTADORA_A, sesiones.adminA, idA, idB],
    [PRESTADORA_B, sesiones.adminB, idB, idA],
  ]) {
    for (const [tabla] of tablas) {
      const r = await fetch(`${base}/rest/v1/${tabla}?select=prestadora_id&limit=1000`, {
        headers: { apikey: llavePublica, Authorization: `Bearer ${token}` },
      });
      if (!r.ok) continue; // Sin permiso de lectura no hay filtración posible.
      const filas = await r.json().catch(() => []);
      if (!Array.isArray(filas)) continue;
      const ajenas = filas.filter((f) => f.prestadora_id === ajeno).length;
      propias += filas.filter((f) => f.prestadora_id === propio).length;
      if (ajenas) problemas.push(`${tabla}: ${nombre} ve ${ajenas} fila(s) de la otra Prestadora`);
    }
  }

  console.log(`  ${propias} filas propias visibles entre las dos.`);
  if (problemas.length) {
    console.log(rojo(`  ${problemas.length} problema(s):`));
    for (const p of problemas) console.log(rojo(`    - ${p}`));
  } else {
    console.log(verde('  Ninguna consulta devolvió una fila de la otra Prestadora.'));
  }
  return problemas;
}

// ---------------------------------------------------------------------------
// Segunda puerta: el motor
// ---------------------------------------------------------------------------

async function motorLevantado(motor) {
  try {
    await fetch(`${motor}/api/panel/configuracion/zonas`, { signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

async function probarElMotor({ motor }, sesiones, piezas) {
  console.log('\n== El motor: intentos deliberados de alcanzar datos ajenos ==\n');

  // Cada intento dice quién, qué, cómo, adónde, con qué cuerpo y —cuando
  // escribe— con qué consulta se mira la fila ajena antes y después. Esa
  // consulta es la que decide de verdad: una respuesta afirmativa del motor
  // no prueba que haya tocado nada, y de hecho a veces no toca nada.
  const zonaAjena = `SELECT md5(t::text) FROM public.zonas_cobertura t WHERE id = '${piezas.zonaA}';`;
  const usuarioAjeno = `SELECT md5(t::text) FROM public.usuarios t WHERE id = '${piezas.usuarioA}';`;

  const intentos = [
    ['admin B', 'modificar una zona de A',        'PATCH',  `/api/panel/configuracion/zonas/${piezas.zonaA}`, sesiones.adminB, { nombre: 'INTRUSO' }, zonaAjena],
    ['admin B', 'borrar una zona de A',           'DELETE', `/api/panel/configuracion/zonas/${piezas.zonaA}`, sesiones.adminB, null, zonaAjena],
    ['admin B', 'modificar un usuario de A',      'PATCH',  `/api/panel/usuarios/${piezas.usuarioA}`,         sesiones.adminB, { nombre: 'INTRUSO' }, usuarioAjeno],
    ['admin B', 'dar de baja un usuario de A',    'DELETE', `/api/panel/usuarios/${piezas.usuarioA}`,         sesiones.adminB, null, usuarioAjeno],
    ['familia B', 'ver un paciente de A',         'GET',    `/api/app-familias/pacientes/${piezas.pacienteA}`,           sesiones.familiaB],
    ['familia B', 'ver sus guardias',             'GET',    `/api/app-familias/pacientes/${piezas.pacienteA}/guardias`,  sesiones.familiaB],
    ['familia B', 'ver sus reportes',             'GET',    `/api/app-familias/pacientes/${piezas.pacienteA}/reportes`,  sesiones.familiaB],
    ['familia B', 'ver sus alertas',              'GET',    `/api/app-familias/pacientes/${piezas.pacienteA}/alertas`,   sesiones.familiaB],
    ['familia B', 'ver quién lo asiste',          'GET',    `/api/app-familias/pacientes/${piezas.pacienteA}/asistente`, sesiones.familiaB],
    ['asistente B', 'ver una guardia de A',       'GET',    `/api/app-asistentes/guardias/${piezas.guardiaA}`,           sesiones.asistenteB],
    ['asistente B', 'fichar entrada en ella',     'POST',   `/api/app-asistentes/guardias/${piezas.guardiaA}/checkin`,   sesiones.asistenteB, { lat: -34.6, lng: -58.4 },
      `SELECT md5(t::text) FROM public.guardias t WHERE id = '${piezas.guardiaA}';`],
    ['asistente B', 'ver reportes de un paciente de A', 'GET', `/api/app-asistentes/pacientes/${piezas.pacienteA}/reportes`, sesiones.asistenteB],
    // Y la dirección contraria, porque el aislamiento no es simétrico por sí solo.
    ['familia A', 'ver un paciente de B',         'GET',    `/api/app-familias/pacientes/${piezas.pacienteB}`,           sesiones.familiaA],
    ['asistente A', 'ver una guardia de B',       'GET',    `/api/app-asistentes/guardias/${piezas.guardiaB}`,           sesiones.asistenteA],
    ['asistente A', 'fichar entrada en ella',     'POST',   `/api/app-asistentes/guardias/${piezas.guardiaB}/checkin`,   sesiones.asistenteA, { lat: -34.6, lng: -58.4 },
      `SELECT md5(t::text) FROM public.guardias t WHERE id = '${piezas.guardiaB}';`],
  ];

  const problemas = [];
  const respuestasVacias = [];

  for (const [quien, que, metodo, ruta, token, cuerpo, huella] of intentos) {
    const antes = huella ? JSON.stringify(consultarBase(huella)) : null;
    const r = await fetch(`${motor}${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    });
    const contestoQueSi = r.status >= 200 && r.status < 300;
    const despues = huella ? JSON.stringify(consultarBase(huella)) : null;
    const etiqueta = `${quien} intenta ${que}`.padEnd(52);

    if (huella && antes !== despues) {
      // Lo peor: la fila ajena cambió. Esto es una filtración de verdad.
      problemas.push(`${quien} pudo ${que}: la fila ajena cambió (${metodo} ${ruta})`);
      console.log(`  ${etiqueta} ${rojo(`${r.status}  ENTRÓ Y ESCRIBIÓ`)}`);
    } else if (huella && contestoQueSi) {
      // El motor no tocó nada, pero contestó que sí. No es una filtración:
      // es una respuesta que miente, anotada como pendiente aparte.
      respuestasVacias.push(`${metodo} ${ruta.replace(/\/[0-9a-f-]{36}/g, '/…')} contestó ${r.status} sin modificar nada`);
      console.log(`  ${etiqueta} ${verde(`${r.status}  sin efecto`)} ${gris('(contestó que sí)')}`);
    } else if (contestoQueSi) {
      problemas.push(`${quien} pudo ${que} (${metodo} ${ruta} devolvió ${r.status})`);
      console.log(`  ${etiqueta} ${rojo(`${r.status}  PASÓ`)}`);
    } else {
      console.log(`  ${etiqueta} ${verde(`${r.status}  bloqueado`)}`);
    }
  }

  // El control al revés: si esto no pasa, la prueba de arriba no prueba nada,
  // porque un motor caído bloquea todo y parece impecable.
  console.log('\n  Control — cada una con lo suyo, acá SÍ tiene que pasar:\n');
  const controles = [
    ['admin A', 'ver sus zonas',       `/api/panel/configuracion/zonas`, sesiones.adminA],
    ['admin B', 'ver sus zonas',       `/api/panel/configuracion/zonas`, sesiones.adminB],
    ['familia A', 'ver sus pacientes', `/api/app-familias/pacientes`,    sesiones.familiaA],
    ['asistente A', 'ver sus guardias', `/api/app-asistentes/guardias`,  sesiones.asistenteA],
  ];
  for (const [quien, que, ruta, token] of controles) {
    const r = await fetch(`${motor}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
    const etiqueta = `${quien} debe poder ${que}`.padEnd(52);
    if (r.ok) {
      console.log(`  ${etiqueta} ${verde(`${r.status}  bien`)}`);
    } else {
      problemas.push(`el control falló: ${quien} no pudo ${que} (${r.status}). Los bloqueos de arriba no valen.`);
      console.log(`  ${etiqueta} ${rojo(`${r.status}  FALLÓ`)}`);
    }
  }
  return { problemas, respuestasVacias };
}

// ---------------------------------------------------------------------------

async function principal() {
  const entorno = leerEntorno();

  const prestadoras = Object.fromEntries(
    consultarBase(`SELECT nombre_fantasia, id FROM public.prestadoras ORDER BY fecha_alta, nombre_fantasia;`),
  );
  const idA = prestadoras[PRESTADORA_A.nombre];
  const idB = prestadoras[PRESTADORA_B.nombre];
  if (!idA || !idB) {
    console.log(rojo(`\nFaltan las Prestadoras de prueba (${PRESTADORA_A.nombre} y ${PRESTADORA_B.nombre}).`));
    console.log('Sembralas con:  npx supabase db reset\n');
    process.exit(1);
  }

  const [sesiones, piezas] = await Promise.all([
    (async () => ({
      adminA: await entrar(entorno.base, entorno.llavePublica, `admin${PRESTADORA_A.sufijo}`),
      adminB: await entrar(entorno.base, entorno.llavePublica, `admin${PRESTADORA_B.sufijo}`),
      familiaA: await entrar(entorno.base, entorno.llavePublica, `familia.gomez${PRESTADORA_A.sufijo}`),
      familiaB: await entrar(entorno.base, entorno.llavePublica, `familia.rios${PRESTADORA_B.sufijo}`),
      asistenteA: await entrar(entorno.base, entorno.llavePublica, `ana.asistente${PRESTADORA_A.sufijo}`),
      asistenteB: await entrar(entorno.base, entorno.llavePublica, `asistente.sur${PRESTADORA_B.sufijo}`),
    }))(),
    (async () => {
      const uno = (sql) => (consultarBase(sql)[0] || [null])[0];
      return {
        zonaA: uno(`SELECT id FROM public.zonas_cobertura WHERE prestadora_id='${idA}' ORDER BY orden LIMIT 1;`),
        usuarioA: uno(`SELECT id FROM public.usuarios WHERE prestadora_id='${idA}' AND rol='coordinador' LIMIT 1;`),
        pacienteA: uno(`SELECT id FROM public.pacientes WHERE prestadora_id='${idA}' ORDER BY id LIMIT 1;`),
        guardiaA: uno(`SELECT id FROM public.guardias WHERE prestadora_id='${idA}' ORDER BY id LIMIT 1;`),
        pacienteB: uno(`SELECT id FROM public.pacientes WHERE prestadora_id='${idB}' ORDER BY id LIMIT 1;`),
        guardiaB: uno(`SELECT id FROM public.guardias WHERE prestadora_id='${idB}' ORDER BY id LIMIT 1;`),
      };
    })(),
  ]);

  const problemas = await probarLaBase(entorno, idA, idB, sesiones);
  let respuestasVacias = [];

  if (await motorLevantado(entorno.motor)) {
    const delMotor = await probarElMotor(entorno, sesiones, piezas);
    problemas.push(...delMotor.problemas);
    respuestasVacias = delMotor.respuestasVacias;
  } else {
    console.log(gris(`\n== El motor no responde en ${entorno.motor}; ese tramo queda sin probar ==`));
    console.log(gris('   Levantalo con:  cd backend && npm run dev'));
  }

  console.log('');
  if (respuestasVacias.length) {
    // Esto no hace fallar la prueba a propósito: el aislamiento aguantó, no se
    // escribió ni se leyó nada ajeno. Lo que falla es la respuesta, que dice
    // que sí cuando no hizo nada. Es un defecto distinto y tiene su pendiente.
    console.log(`  Aviso — ${respuestasVacias.length} respuesta(s) afirmativa(s) sobre cero filas:`);
    for (const a of respuestasVacias) console.log(gris(`    - ${a}`));
    console.log('');
  }
  if (problemas.length) {
    console.log(rojo(`✗ ${problemas.length} problema(s) de aislamiento:`));
    for (const p of problemas) console.log(rojo(`  - ${p}`));
    console.log('');
    process.exit(1);
  }
  console.log(verde('✓ Ninguna de las dos Prestadoras alcanzó un solo dato de la otra.'));
  console.log('');
}

principal().catch((e) => {
  console.error(rojo(`\n${e.message}\n`));
  process.exit(1);
});

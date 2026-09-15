/**
 * Lo que el Asistente ve de su propia Matrícula se pide por Prestadora.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. `matriculas_asistente` era la única tabla de las que consultan las
 * dos aplicaciones de teléfono sin columna de Organización: colgaba del Asistente y nada más. La
 * migración `20260916040000_la_matricula_del_asistente_dice_de_que_prestadora_es.sql` le puso la
 * columna, y esto comprueba que las consultas la usan. El motor entra a la base con la llave de
 * servicio y se saltea la protección por fila, así que un filtro que falta no se ve: la pantalla
 * anda igual de bien.
 *
 * De esta lectura cuelga si el Asistente puede trabajar, porque la base lo frena sin Matrícula
 * vigente. Una Matrícula leída de la Prestadora equivocada lo habilita donde no corresponde.
 *
 * Qué daría con el sistema roto: sacarle el filtro de Prestadora a cualquiera de las dos
 * consultas hace fallar su comprobación. Los datos son inventados.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { olvidarPedidos } from '../../middleware/topeDePedidos.js';

const PRESTADORA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USUARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // usuarios.id === asistentes.id === auth.uid()

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con la dirección entera: los filtros van ahí. */
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, url: req.url });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada({ url: req.url }) : preparada ?? [];

    const unoSolo = (req.headers.accept || '').includes('vnd.pgrst.object+json');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(unoSolo && Array.isArray(valor) ? valor[0] ?? null : valor));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const { appAsistentesMatriculaRouter } = await import('../appAsistentesMatricula.js');

const app = express();
app.use(express.json());
app.use('/api/app-asistentes/matricula', appAsistentesMatriculaRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/app-asistentes/matricula`;

after(() => {
  motor.close();
  baseFalsa.close();
});

/** Las direcciones con las que se consultó una tabla. Los filtros están ahí. */
function consultasA(tabla, metodo = 'GET') {
  return llamadas.filter((l) => l.clave === `${metodo} /rest/v1/${tabla}`).map((l) => l.url);
}

beforeEach(() => {
  respuestas.clear();
  llamadas = [];
  olvidarPedidos();
  delete process.env.TOPE_PEDIDOS_POR_MINUTO;

  respuestas.set('GET /auth/v1/user', { id: USUARIO, aud: 'authenticated' });
  respuestas.set('GET /rest/v1/usuarios', [{ rol: 'asistente', prestadora_id: PRESTADORA }]);
});

describe('la Matrícula que el Asistente ve de sí mismo', () => {
  it('se pide filtrada por la Prestadora de la sesión', async () => {
    respuestas.set('GET /rest/v1/estado_matricula_asistente', [
      { asistente_id: USUARIO, requiere_matricula: true, tipo_matricula: 'enfermeria',
        motivo_bloqueo: null, matricula_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        vigente_hasta: '2027-01-01', verificada_at: '2026-09-01T10:00:00Z', dias_para_vencer: 108 },
    ]);
    respuestas.set('GET /rest/v1/prestadoras', [{ dias_aviso_vencimiento_documentos: 30 }]);
    respuestas.set('GET /rest/v1/matriculas_asistente', [
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', tipo: 'enfermeria', numero_matricula: '00000',
        vigente_desde: '2026-01-01', vigente_hasta: '2027-01-01', archivo_url: null,
        verificada_at: '2026-09-01T10:00:00Z', cargada_por_el_asistente: false,
        created_at: '2026-01-01T10:00:00Z' },
    ]);

    const respuesta = await fetch(DIRECCION, {
      headers: { Authorization: 'Bearer token-de-mentira' },
    });
    assert.equal(respuesta.status, 200);

    const [urlEstado] = consultasA('estado_matricula_asistente');
    assert.ok(urlEstado, 'no se consultó el estado de la Matrícula');
    assert.ok(
      urlEstado.includes(`prestadora_id=eq.${PRESTADORA}`),
      'el estado de la Matrícula no lleva el filtro de Prestadora'
    );
    assert.ok(urlEstado.includes(`asistente_id=eq.${USUARIO}`), urlEstado);

    const [urlMatriculas] = consultasA('matriculas_asistente');
    assert.ok(urlMatriculas, 'no se consultaron las Matrículas');
    assert.ok(
      urlMatriculas.includes(`prestadora_id=eq.${PRESTADORA}`),
      'la lista de Matrículas no lleva el filtro de Prestadora'
    );
    assert.ok(urlMatriculas.includes(`asistente_id=eq.${USUARIO}`), urlMatriculas);
  });
});

/**
 * Que el dato de contacto no quede guardado, y que el mensaje salga con su motivo.
 *
 *   npm test --prefix backend
 *
 * QUÉ SE PRUEBA ACÁ, Y POR QUÉ ESTO. Lo que el Marketplace vende es llegar a la persona por
 * afuera. El chat es libre, así que el chat es la puerta por la que ese dato se puede regalar:
 * alcanza con que alguien escriba su número. Estas pruebas son las del agujero, no las de la
 * expresión regular.
 *
 * DÓNDE SE TAPA, Y POR QUÉ LA PRUEBA VA CONTRA LA BASE. El tapado dejó de vivir en el motor: lo
 * hacen el cuerpo de reglas de `public.reglas_de_los_mensajes` y el disparador de
 * `mensajes_marketplace`, antes de escribir. Probar el motor no probaría nada, porque el motor ya
 * no tapa. Así que lo que estas pruebas hacen es **guardar un mensaje de verdad y leer lo que
 * quedó guardado**: si el dato sigue ahí, la prueba falla.
 *
 * QUÉ DARÍA CON EL SISTEMA ROTO. Sin disparador, o con las reglas apagadas, el mensaje se guarda
 * entero y cada caso encuentra el dato adentro del texto leído de vuelta. Si el tapado se llevara
 * puesto cualquier número, el mensaje con una hora y un precio lo reporta. Y si el cuerpo de
 * reglas quedara vacío, el caso que espera el corte pasaría a guardar el texto sin tocar.
 *
 * QUÉ PARTE DEL SISTEMA REAL NO ESTÁ ACÁ. La base local. Sin ella estas pruebas se saltean, y
 * saltearse no es aprobar: lo que se saltea no está probado. Se levanta con `npx supabase start`.
 *
 * NADA QUEDA ESCRITO. Cada caso corre adentro de una transacción que termina en `ROLLBACK`, así
 * que el hilo y los mensajes inventados no llegan a existir.
 *
 * LO QUE ESTAS PRUEBAS NO PUEDEN PROBAR. Que no se escape ninguna forma de escribir un teléfono.
 * Eso no lo prueba nadie, y por eso el producto tapa y avisa en la pantalla en vez de prometer que
 * tapa todo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mensajeHaciaAfuera } from '../contactoTapado.js';
import { IDENTIDAD } from '../../config/identidadProducto.js';

/** Datos inventados, como pide `celtatech/CLAUDE.md` §6: nunca datos de personas reales. */
const TELEFONO = '11 5555 4444';
const CORREO = 'alguien.inventado@ejemplo.test';
const USUARIO = 'usuario.ejemplo';

// El nombre del contenedor se arma con el código guardado del producto, no escrito a mano: es el
// mismo identificador con el que se nombra la base local.
const CONTENEDOR = `supabase_db_${IDENTIDAD.codigo}`;
const SEPARADOR = '';

/** Corre un guion contra la base local y devuelve lo que imprimió. */
function contraLaBase(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

/** Si la base local no está levantada, estas pruebas se saltean en lugar de aprobar de mentira. */
function porQueNoSePuede() {
  try {
    contraLaBase('SELECT 1;');
    return null;
  } catch {
    return `no hay base local respondiendo en el contenedor ${CONTENEDOR}; se levanta con «npx supabase start»`;
  }
}

const sinBase = porQueNoSePuede();
/** Con la base levantada no se le pasa ninguna opción: `skip` presente saltea aunque venga vacío. */
const salvoSinBase = sinBase ? { skip: sinBase } : {};

/**
 * Guarda un mensaje de verdad en un hilo inventado y devuelve lo que quedó guardado.
 * Todo adentro de una transacción que se deshace: no queda ninguna fila.
 */
function loQueQuedaGuardado(cuerpo, { automatico = false } = {}) {
  const escrito = cuerpo.replace(/'/g, "''");
  const salida = contraLaBase(`
BEGIN;
CREATE TEMP TABLE hilo_de_prueba ON COMMIT DROP AS
  SELECT f.prestadora_id, f.id AS familia_id, a.id AS asistente_id
    FROM public.familias f
    JOIN public.asistentes a ON a.prestadora_id = f.prestadora_id
   WHERE f.prestadora_id = '11111111-1111-4111-8111-111111111111'
   LIMIT 1;

INSERT INTO public.conversaciones_marketplace (id, prestadora_id, familia_id, asistente_id)
  SELECT '99999999-9999-4999-8999-999999999999', prestadora_id, familia_id, asistente_id
    FROM hilo_de_prueba;

INSERT INTO public.mensajes_marketplace
  (id, prestadora_id, conversacion_id, lado, autor_usuario_id, cuerpo, automatico)
  SELECT '99999999-9999-4999-8999-999999999998', prestadora_id,
         '99999999-9999-4999-8999-999999999999', 'asistente',
         '99999999-9999-4999-8999-999999999997', '${escrito}', ${automatico}
    FROM hilo_de_prueba;

SELECT coalesce(regla_tapada, '') || '${SEPARADOR}' || cuerpo
  FROM public.mensajes_marketplace
 WHERE id = '99999999-9999-4999-8999-999999999998';
ROLLBACK;
`);
  const linea = salida.split('\n').find((l) => l.includes(SEPARADOR));
  assert.ok(linea, `la base no devolvió el mensaje guardado: ${salida}`);
  const [regla, ...resto] = linea.split(SEPARADOR);
  return { regla: regla === '' ? null : regla, cuerpo: resto.join(SEPARADOR) };
}

describe('lo que no puede viajar en un mensaje no queda guardado', salvoSinBase, () => {
  it('un teléfono escrito de cualquier forma no queda escrito en la fila', () => {
    for (const forma of [TELEFONO, '+54 9 11 5555-4444', '(011) 5555-4444', '11.5555.4444', '1155554444']) {
      const guardado = loQueQuedaGuardado(`Llamame al ${forma} cuando puedas`);
      assert.ok(!/\d{4}/.test(guardado.cuerpo), `${forma} quedó guardado: ${guardado.cuerpo}`);
      assert.equal(guardado.regla, 'telefono', forma);
    }
  });

  it('el mensaje llega igual: lo que no es el dato sigue entero', () => {
    const guardado = loQueQuedaGuardado(`Llamame al ${TELEFONO} cuando puedas`);
    assert.ok(guardado.cuerpo.startsWith('Llamame al '), guardado.cuerpo);
    assert.ok(guardado.cuerpo.endsWith(' cuando puedas'), guardado.cuerpo);
  });

  it('un correo no queda escrito en la fila, ni entero ni a medias', () => {
    for (const forma of [CORREO, 'alguien.inventado@ejemplo', 'alguien arroba ejemplo punto test']) {
      const guardado = loQueQuedaGuardado(`escribime a ${forma}`);
      assert.ok(!guardado.cuerpo.includes('alguien'), `${forma} quedó guardado: ${guardado.cuerpo}`);
      assert.ok(guardado.regla !== null, forma);
    }
  });

  it('un nombre de usuario de otra aplicación no queda escrito en la fila', () => {
    const casos = [
      `agregame al face: ${USUARIO}`,
      `buscame en instagram: ${USUARIO}`,
      `${USUARIO} en instagram, buscame ahi`,
      `mi instagram es ${USUARIO}`,
      'escribime al telegram @juanitainventada',
    ];
    for (const mensaje of casos) {
      const guardado = loQueQuedaGuardado(mensaje);
      assert.ok(!/usuario\.ejemplo|juanitainventada/.test(guardado.cuerpo), `${mensaje} -> ${guardado.cuerpo}`);
      assert.ok(guardado.regla !== null, mensaje);
    }
  });

  it('una dirección web y un domicilio no quedan escritos en la fila', () => {
    const web = loQueQuedaGuardado('mira https://ejemplo.test/mi-perfil');
    assert.ok(!web.cuerpo.includes('ejemplo.test'), web.cuerpo);
    assert.equal(web.regla, 'enlace');

    const domicilio = loQueQuedaGuardado('vivo en calle Falsa 123, piso 4');
    assert.ok(!domicilio.cuerpo.includes('123'), domicilio.cuerpo);
    assert.ok(!domicilio.cuerpo.includes('piso 4'), domicilio.cuerpo);
  });

  it('una hora, un precio, una fecha y una aplicación nombrada al pasar quedan enteros', () => {
    const mensajes = [
      'puedo a las 14:30',
      'serian 2500 por turno',
      'empiezo el 15/09',
      'tengo 12 anios de experiencia',
      'no tengo WhatsApp, prefiero hablar por aca',
      'el zoom de la entrevista es a las 10',
    ];
    for (const mensaje of mensajes) {
      const guardado = loQueQuedaGuardado(mensaje);
      assert.equal(guardado.cuerpo, mensaje);
      assert.equal(guardado.regla, null, mensaje);
    }
  });

  it('no deja pegadas las palabras que rodeaban al dato', () => {
    const guardado = loQueQuedaGuardado(`antes ${TELEFONO} despues`);
    assert.match(guardado.cuerpo, /^antes \S+ despues$/u, guardado.cuerpo);
  });

  it('un mensaje automático no pasa por el tapado: su cuerpo es una clave', () => {
    const guardado = loQueQuedaGuardado('videollamada_empezo', { automatico: true });
    assert.equal(guardado.cuerpo, 'videollamada_empezo');
    assert.equal(guardado.regla, null);
  });

  it('con el cuerpo de reglas vacío falla cerrado: no guarda el mensaje entero', () => {
    assert.throws(
      () => contraLaBase(`
BEGIN;
DELETE FROM public.reglas_de_los_mensajes;
SELECT * FROM interno.tapar_lo_que_no_viaja_en_un_mensaje('Llamame al ${TELEFONO}', NULL);
ROLLBACK;
`),
      /reglas_de_los_mensajes_sin_cargar/
    );
  });

  it('el motivo de cada regla está en los tres idiomas', () => {
    const faltan = contraLaBase(`
SELECT count(*) FROM public.reglas_de_los_mensajes
 WHERE btrim(coalesce(motivo ->> 'es-AR', '')) = ''
    OR btrim(coalesce(motivo ->> 'en', '')) = ''
    OR btrim(coalesce(motivo ->> 'pt-BR', '')) = '';
`).trim();
    assert.equal(faltan, '0');
  });
});

describe('mensajeHaciaAfuera', () => {
  /** La fila ya viene tapada de la base: acá sólo se le da forma para la pantalla. */
  const fila = {
    id: 'm-1',
    lado: 'asistente',
    automatico: false,
    created_at: '2026-09-15T10:00:00Z',
    leido_at: null,
    cuerpo: 'Llamame al •••',
    regla_tapada: 'telefono',
    // Lo que nunca tiene que salir de acá: quién escribió, de qué Prestadora es y en qué hilo.
    autor_usuario_id: 'u-1',
    prestadora_id: 'p-1',
    conversacion_id: 'c-1',
  };

  const motivos = {
    telefono: {
      'es-AR': 'Parece un número de teléfono.',
      en: 'This looks like a phone number.',
      'pt-BR': 'Parece um número de telefone.',
    },
  };

  it('avisa que hay algo tapado y entrega el motivo en los tres idiomas', () => {
    const afuera = mensajeHaciaAfuera(fila, motivos);
    assert.equal(afuera.tapado, true);
    assert.equal(afuera.cuerpo, fila.cuerpo);
    assert.deepEqual(Object.keys(afuera.motivo_tapado).sort(), ['en', 'es-AR', 'pt-BR']);
  });

  it('sin nada tapado no hay motivo', () => {
    const afuera = mensajeHaciaAfuera({ ...fila, cuerpo: 'puedo a las 14:30', regla_tapada: null }, motivos);
    assert.equal(afuera.tapado, false);
    assert.equal(afuera.motivo_tapado, null);
  });

  it('una regla sin motivo en el catálogo no rompe el mensaje', () => {
    const afuera = mensajeHaciaAfuera({ ...fila, regla_tapada: 'una_que_no_esta' }, motivos);
    assert.equal(afuera.tapado, true);
    assert.equal(afuera.motivo_tapado, null);
  });

  it('no deja salir quién escribió, de qué Prestadora es ni de qué hilo', () => {
    const afuera = mensajeHaciaAfuera(fila, motivos);
    assert.deepEqual(
      Object.keys(afuera).sort(),
      ['automatico', 'created_at', 'cuerpo', 'id', 'lado', 'leido_at', 'motivo_tapado', 'tapado']
    );
  });

  it('un mensaje automático sale sin motivo: su cuerpo es una clave', () => {
    const automatico = { ...fila, automatico: true, cuerpo: 'videollamada_empezo', regla_tapada: null };
    const afuera = mensajeHaciaAfuera(automatico, motivos);
    assert.equal(afuera.cuerpo, 'videollamada_empezo');
    assert.equal(afuera.tapado, false);
  });
});

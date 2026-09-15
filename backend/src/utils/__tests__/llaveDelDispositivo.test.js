/**
 * La llave que guarda el teléfono: que lo que decide, decida bien.
 *
 *   npm test --prefix backend
 *
 * QUÉ SE PRUEBA ACÁ, y qué pasaría si alguna de estas cosas se rompiera:
 *
 *   1. CADA APLICACIÓN CONTRA SU PROPIO DOMINIO. Si el origen esperado o la parte confiable
 *      salieran mal, una llave creada en la aplicación del Asistente serviría para entrar a la de
 *      la Familia, que son dos permisos distintos. Y si faltando la variable de entorno se
 *      devolviera algo por omisión, se aceptarían firmas hechas contra cualquier sitio.
 *   2. EL DESAFÍO VENCIDO NO SIRVE. Si vencer se resolviera al revés, o un desafío sin fecha
 *      pasara por válido, una firma grabada hoy entraría mañana.
 *   3. EL CONTADOR QUE RETROCEDE ES UNA LLAVE CLONADA. Si esto dejara pasar, una copia de la
 *      llave entraría sin que nadie se entere. Y si fuera más estricto de la cuenta, los
 *      teléfonos que no llevan cuenta —los dos números en cero— no podrían entrar nunca.
 *   4. TODO FALLA CERRADO, Y EL MOTIVO NO SALE. La llave que no está, la revocada y la de otra
 *      persona son tres casos distintos adentro y uno solo hacia afuera.
 *   5. LA PANTALLA NO VE LA CREDENCIAL. Lo que se manda al navegador no incluye la mitad pública
 *      de la llave ni su identificador: son los datos que permiten reconocer al mismo aparato en
 *      dos lados distintos, y para listar llaves no hacen falta.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  MINUTOS_DE_VIDA_DEL_DESAFIO,
  comoSeVeLaLlave,
  desafioVencido,
  dondeViveLaApp,
  elContadorRetrocedio,
  porQueNoAbre,
  rolesConLlaveDeDispositivo,
} from '../llaveDelDispositivo.js';

/** Corre algo con estas variables de entorno puestas, y las deja como estaban. */
function conEntorno(valores, cuerpo) {
  const antes = {};
  for (const [clave, valor] of Object.entries(valores)) {
    antes[clave] = process.env[clave];
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  try {
    cuerpo();
  } finally {
    for (const [clave, valor] of Object.entries(antes)) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  }
}

describe('dónde vive cada aplicación', () => {
  it('las dos aplicaciones, y ninguna más', () => {
    assert.deepEqual(rolesConLlaveDeDispositivo().sort(), ['asistente', 'familia']);
  });

  it('el origen es la dirección entera y la parte confiable es sólo el dominio', () => {
    conEntorno({ PWA_ASISTENTES_URL: 'https://asistentes.ejemplo.com' }, () => {
      assert.deepEqual(dondeViveLaApp('asistente'), {
        origen: 'https://asistentes.ejemplo.com',
        parteConfiable: 'asistentes.ejemplo.com',
      });
    });
  });

  it('cada rol mira su propia dirección, así que una llave no cruza de aplicación', () => {
    conEntorno(
      {
        PWA_ASISTENTES_URL: 'https://asistentes.ejemplo.com',
        PWA_FAMILIAS_URL: 'https://familias.ejemplo.com',
      },
      () => {
        assert.notEqual(
          dondeViveLaApp('asistente').parteConfiable,
          dondeViveLaApp('familia').parteConfiable,
        );
      },
    );
  });

  it('una dirección con camino igual da el origen pelado, que es contra lo que se firma', () => {
    conEntorno({ PWA_FAMILIAS_URL: 'https://familias.ejemplo.com/entrar' }, () => {
      assert.equal(dondeViveLaApp('familia').origen, 'https://familias.ejemplo.com');
    });
  });

  it('sin la variable de entorno tira, en vez de aceptar cualquier origen', () => {
    conEntorno({ PWA_FAMILIAS_URL: undefined }, () => {
      assert.throws(() => dondeViveLaApp('familia'), /PWA_FAMILIAS_URL/);
    });
    conEntorno({ PWA_FAMILIAS_URL: '   ' }, () => {
      assert.throws(() => dondeViveLaApp('familia'), /PWA_FAMILIAS_URL/);
    });
  });

  it('un rol sin aplicación tira: el Panel no entra por acá', () => {
    assert.throws(() => dondeViveLaApp('coordinador'));
    assert.throws(() => dondeViveLaApp('superadmin'));
  });
});

describe('el desafío vence', () => {
  const ahora = new Date('2026-09-16T12:00:00Z');

  it('vale mientras no llegó la hora', () => {
    assert.equal(desafioVencido('2026-09-16T12:01:00Z', ahora), false);
  });

  it('no vale pasada la hora', () => {
    assert.equal(desafioVencido('2026-09-16T11:59:00Z', ahora), true);
  });

  it('el instante exacto del vencimiento ya no vale', () => {
    assert.equal(desafioVencido('2026-09-16T12:00:00Z', ahora), true);
  });

  it('sin fecha, o con una fecha ilegible, se considera vencido', () => {
    assert.equal(desafioVencido(null, ahora), true);
    assert.equal(desafioVencido(undefined, ahora), true);
    assert.equal(desafioVencido('', ahora), true);
    assert.equal(desafioVencido('cualquier cosa', ahora), true);
  });

  it('dura pocos minutos, no horas', () => {
    assert.ok(MINUTOS_DE_VIDA_DEL_DESAFIO > 0 && MINUTOS_DE_VIDA_DEL_DESAFIO <= 5);
  });
});

describe('el contador que retrocede', () => {
  it('avanzar está bien', () => {
    assert.equal(elContadorRetrocedio(4, 5), false);
    assert.equal(elContadorRetrocedio(0, 1), false);
  });

  it('retroceder es una llave clonada', () => {
    assert.equal(elContadorRetrocedio(5, 4), true);
  });

  it('repetir el mismo número también: esa firma ya se usó', () => {
    assert.equal(elContadorRetrocedio(5, 5), true);
  });

  it('pero los dos en cero es el teléfono que no lleva cuenta, y entra', () => {
    assert.equal(elContadorRetrocedio(0, 0), false);
  });
});

describe('por qué no abre', () => {
  const llave = { usuario_id: 'ana', revocada_en: null };

  it('la llave viva y de la persona que dice, abre', () => {
    assert.equal(porQueNoAbre(llave, { usuarioId: 'ana' }), null);
  });

  it('sin llave, no abre', () => {
    assert.equal(porQueNoAbre(null), 'llave_desconocida');
    assert.equal(porQueNoAbre(undefined), 'llave_desconocida');
  });

  it('la llave revocada no abre, aunque sea de quien dice', () => {
    assert.equal(
      porQueNoAbre({ ...llave, revocada_en: '2026-09-15T10:00:00Z' }, { usuarioId: 'ana' }),
      'llave_revocada',
    );
  });

  it('la llave de otra persona no abre', () => {
    assert.equal(porQueNoAbre(llave, { usuarioId: 'bruno' }), 'llave_de_otra_persona');
  });

  it('una llave sin dueño no abre: se falla cerrado, no se adivina', () => {
    assert.equal(porQueNoAbre({ usuario_id: null, revocada_en: null }), 'llave_sin_dueño');
  });

  it('sin pedir persona, alcanza con que la llave esté viva: es la entrada, donde todavía no se sabe quién', () => {
    assert.equal(porQueNoAbre(llave), null);
  });
});

describe('cómo se ve una llave en la pantalla', () => {
  const fila = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    usuario_id: 'ana',
    prestadora_id: 'pres-1',
    credencial_id: 'Y3JlZGVuY2lhbA',
    clave_publica: 'cGVnYW1lbnRv',
    contador: 7,
    creada_en: '2026-09-01T10:00:00Z',
    ultimo_uso_en: '2026-09-15T08:30:00Z',
  };

  it('muestra cuándo se agregó y cuándo se usó', () => {
    assert.deepEqual(comoSeVeLaLlave(fila), {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      agregadaEn: '2026-09-01T10:00:00Z',
      ultimoUsoEn: '2026-09-15T08:30:00Z',
    });
  });

  it('nunca manda la credencial ni la mitad pública de la llave', () => {
    const visto = JSON.stringify(comoSeVeLaLlave(fila));
    assert.ok(!visto.includes('Y3JlZGVuY2lhbA'));
    assert.ok(!visto.includes('cGVnYW1lbnRv'));
  });

  it('la llave que nunca se usó dice que nunca se usó, y no rompe', () => {
    assert.equal(comoSeVeLaLlave({ id: 'x', creada_en: 'hoy' }).ultimoUsoEn, null);
  });
});

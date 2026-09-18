/**
 * Pruebas del consentimiento que firma quien paga.
 *
 * Lo que se cuida acá es que el papel diga quién se obligó y quién lo firmó de puño y letra, que
 * no son siempre la misma persona: cuando quien paga es una empresa u organismo, firma su
 * Apoderado, y cuando es una persona, firma ella y no hay nadie en el medio.
 *
 * EL MARCADOR DEL APODERADO NO SE COMPORTA COMO LOS DEMÁS. Los otros, sin dato, quedan como una
 * raya, que se lee como «falta cargar esto». Éste, sin dato, se lleva el renglón entero, porque no
 * falta nada: no corresponde nadie. Eso es lo que más se prueba acá.
 *
 *   npm test --prefix backend
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  MARCADORES,
  MODELO_DE_FABRICA,
  textoDelConsentimiento,
  huellaDelDocumento,
} from '../documentoConsentimientoPagador.js';

const PRESTADORA = { nombre: 'Cuidados del Sur' };
const CLIENTE = { nombre: 'Gómez, Ana' };
const FECHA = new Date('2026-09-18T15:30:00Z');

const UNA_ENTIDAD = { nombre: 'Obra Social de Prueba', documento: 'CUIT 30-00000000-0' };
const UNA_PERSONA = { nombre: 'Prueba, Nadia', documento: 'DNI 00000000' };
const SU_APODERADA = { nombre: 'Prueba, Nadia' };

function unPapel({ pagador, apoderado, cuerpo }) {
  return textoDelConsentimiento({
    cuerpo,
    prestadora: PRESTADORA,
    pagador,
    cliente: CLIENTE,
    apoderado,
    fecha: FECHA,
  });
}

describe('El consentimiento de quien paga', () => {
  it('reemplaza todos los marcadores que anuncia', () => {
    const texto = unPapel({ pagador: UNA_ENTIDAD, apoderado: SU_APODERADA });
    for (const marcador of MARCADORES) {
      assert.equal(texto.includes(marcador), false, `quedó sin reemplazar ${marcador}`);
    }
  });

  it('nombra a la Prestadora, a quien se obliga, su documento y para quién es el servicio', () => {
    const texto = unPapel({ pagador: UNA_PERSONA, apoderado: null });
    assert.ok(texto.includes(PRESTADORA.nombre));
    assert.ok(texto.includes(UNA_PERSONA.nombre));
    assert.ok(texto.includes(UNA_PERSONA.documento));
    assert.ok(texto.includes(CLIENTE.nombre));
  });

  describe('Cuando paga una empresa u organismo', () => {
    it('dice qué persona firma en su representación', () => {
      const texto = unPapel({ pagador: UNA_ENTIDAD, apoderado: SU_APODERADA });
      const renglon = texto.split('\n').find((uno) => uno.includes(SU_APODERADA.nombre) && uno !== UNA_ENTIDAD.nombre);
      assert.ok(renglon, 'el papel no dice quién firmó por la entidad');
    });

    it('y quien se obliga sigue siendo la entidad, no quien firma', () => {
      const texto = unPapel({ pagador: UNA_ENTIDAD, apoderado: SU_APODERADA });
      assert.ok(texto.includes(UNA_ENTIDAD.nombre));
      assert.ok(texto.includes(UNA_ENTIDAD.documento));
    });
  });

  describe('Cuando paga una persona', () => {
    it('saca el renglón entero del apoderado, no lo deja como una raya', () => {
      const conRenglon = unPapel({ pagador: UNA_ENTIDAD, apoderado: SU_APODERADA });
      const sinRenglon = unPapel({ pagador: UNA_PERSONA, apoderado: null });
      assert.equal(sinRenglon.split('\n').length, conRenglon.split('\n').length - 1);
      // Y no quedó en su lugar un renglón con una raya, que se leería como un dato sin cargar.
      const rayaSuelta = sinRenglon.split('\n').some((uno) => /^[^:]+:\s*—\s*$/.test(uno));
      assert.equal(rayaSuelta, false, 'quedó un renglón que sólo dice una raya');
    });

    it('y lo saca también cuando la entidad todavía no tiene Apoderado cargado', () => {
      // Que falte no frena nada: el papel se arma igual, sin ese renglón, y la pantalla avisa.
      const texto = unPapel({ pagador: UNA_ENTIDAD, apoderado: null });
      assert.equal(texto.includes('{{apoderado}}'), false);
      assert.ok(texto.includes(UNA_ENTIDAD.nombre));
    });

    it('un apoderado con el nombre vacío se trata como si no hubiera ninguno', () => {
      const texto = unPapel({ pagador: UNA_ENTIDAD, apoderado: { nombre: '' } });
      assert.equal(texto.includes('{{apoderado}}'), false);
    });
  });

  describe('Cuando la Prestadora escribió su propio texto', () => {
    it('el marcador del apoderado funciona igual que en el modelo de fábrica', () => {
      const cuerpo = 'Quien se obliga: {{pagador}}\nFirmante: {{apoderado}}\nFecha: {{fecha}}';
      const conFirmante = unPapel({ pagador: UNA_ENTIDAD, apoderado: SU_APODERADA, cuerpo });
      const sinFirmante = unPapel({ pagador: UNA_PERSONA, apoderado: null, cuerpo });
      assert.ok(conFirmante.includes(`Firmante: ${SU_APODERADA.nombre}`));
      assert.equal(sinFirmante.includes('Firmante:'), false);
      assert.ok(sinFirmante.includes(UNA_PERSONA.nombre));
    });

    it('y si no usa ese marcador, el texto sale entero igual', () => {
      const cuerpo = 'Quien se obliga: {{pagador}}';
      assert.equal(unPapel({ pagador: UNA_PERSONA, apoderado: null, cuerpo }), `Quien se obliga: ${UNA_PERSONA.nombre}`);
    });
  });

  describe('La huella del documento', () => {
    it('cambia cuando cambia quién firmó', () => {
      const uno = huellaDelDocumento(unPapel({ pagador: UNA_ENTIDAD, apoderado: SU_APODERADA }));
      const otro = huellaDelDocumento(unPapel({ pagador: UNA_ENTIDAD, apoderado: { nombre: 'Otra, Persona' } }));
      assert.notEqual(uno, otro);
    });

    it('y también cuando la entidad se queda sin apoderado', () => {
      const con = huellaDelDocumento(unPapel({ pagador: UNA_ENTIDAD, apoderado: SU_APODERADA }));
      const sin = huellaDelDocumento(unPapel({ pagador: UNA_ENTIDAD, apoderado: null }));
      assert.notEqual(con, sin);
    });
  });

  it('el modelo de fábrica trae el marcador del apoderado solo en su renglón', () => {
    const renglon = MODELO_DE_FABRICA.split('\n').find((uno) => uno.includes('{{apoderado}}'));
    assert.ok(renglon, 'el modelo de fábrica perdió el renglón del apoderado');
    for (const otro of MARCADORES.filter((uno) => uno !== '{{apoderado}}')) {
      assert.equal(renglon.includes(otro), false, `${otro} comparte renglón con el apoderado y se iría con él`);
    }
  });
});

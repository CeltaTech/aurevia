/**
 * Cómo se llama y dónde se guarda cada documento generado del legajo.
 *
 *   npx vitest run   (desde `panel/`)
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Estas tres funciones son el punto único de verdad de dos cosas que
 * antes estaban escritas a mano en tres pantallas: el nombre con el que se baja un documento y la
 * ruta con la que se guarda. La ruta importa más de lo que parece: empieza por la Prestadora, y es
 * lo que el motor firma para dejar ver un documento de baja con nombre, documento y montos
 * (`../documentosDeCese.js`).
 *
 * Con el sistema roto —una ruta que no empiece por la Prestadora, o una lista de tipos abierta—
 * las pruebas de la ruta y de `esDocumentoDeCese` dan al revés.
 *
 * Datos inventados, como manda CLAUDE.md §6.
 */
import { describe, it, expect } from 'vitest';
import {
  DOCUMENTOS_DE_CESE, TIPO_LIQUIDACION, TIPO_TELEGRAMA, TIPO_NOTIFICACION_PRUEBA,
  esDocumentoDeCese, nombreDeArchivo, rutaEnElDeposito,
} from '../documentosDeCese';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const CESE = '33333333-3333-3333-3333-333333333333';

describe('qué documentos quedan guardados', () => {
  it('son los tres que cuelgan de un cese, y ninguno más', () => {
    expect(DOCUMENTOS_DE_CESE).toEqual([TIPO_LIQUIDACION, TIPO_TELEGRAMA, TIPO_NOTIFICACION_PRUEBA]);
    for (const tipo of DOCUMENTOS_DE_CESE) expect(esDocumentoDeCese(tipo)).toBe(true);
  });

  it('los del legajo que no cuelgan de un cese no entran', () => {
    expect(esDocumentoDeCese('certificado_trabajo')).toBe(false);
    expect(esDocumentoDeCese('certificado_remuneraciones')).toBe(false);
    expect(esDocumentoDeCese('constancia_ausencia')).toBe(false);
  });

  it('falla cerrado: lo que no está en la lista, no entra', () => {
    expect(esDocumentoDeCese('../../otra-prestadora/algo')).toBe(false);
    expect(esDocumentoDeCese('')).toBe(false);
    expect(esDocumentoDeCese(undefined)).toBe(false);
    expect(esDocumentoDeCese(null)).toBe(false);
  });
});

describe('el nombre con el que se baja un documento', () => {
  it('lleva de qué documento se trata, de quién y de cuándo', () => {
    expect(nombreDeArchivo(TIPO_LIQUIDACION, { persona: 'Juana Pérez', fecha: '2026-09-30' }))
      .toBe('liquidacion-Juana Pérez-2026-09-30.pdf');
  });

  it('sin fecha no queda un guión colgando', () => {
    expect(nombreDeArchivo('certificado_trabajo', { persona: 'Juana Pérez' }))
      .toBe('certificado-trabajo-Juana Pérez.pdf');
  });

  it('sin nada, alcanza con decir qué documento es', () => {
    expect(nombreDeArchivo(TIPO_TELEGRAMA)).toBe('telegrama-cese.pdf');
  });

  it('lo que en un nombre de archivo significa otra cosa se saca', () => {
    expect(nombreDeArchivo(TIPO_NOTIFICACION_PRUEBA, { persona: 'A/B: C*', fecha: '2026-09-30' }))
      .toBe('notificacion-fin-periodo-prueba-A B  C-2026-09-30.pdf');
  });
});

describe('dónde vive el documento guardado', () => {
  it('la ruta empieza por la Prestadora', () => {
    const ruta = rutaEnElDeposito(PRESTADORA, CESE, TIPO_LIQUIDACION);
    expect(ruta.startsWith(`${PRESTADORA}/`)).toBe(true);
    expect(ruta).toBe(`${PRESTADORA}/${CESE}/${TIPO_LIQUIDACION}.pdf`);
  });

  it('no lleva adentro el nombre de nadie: los tres documentos de un cese se distinguen por el tipo', () => {
    const rutas = DOCUMENTOS_DE_CESE.map((tipo) => rutaEnElDeposito(PRESTADORA, CESE, tipo));
    expect(new Set(rutas).size).toBe(3);
    for (const ruta of rutas) expect(ruta.includes('Juana')).toBe(false);
  });
});

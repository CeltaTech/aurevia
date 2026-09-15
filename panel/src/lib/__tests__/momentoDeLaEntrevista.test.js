import { describe, expect, it } from 'vitest';
import { desdeElCampo, paraElCampo } from '../momentoDeLaEntrevista';

/* El error que estas pruebas tienen que encontrar es el de la cita que se corre sola: se agenda
   una entrevista para las diez, se vuelve a abrir el formulario y dice otra hora. Pasa cuando una
   de las dos conversiones habla en la hora de quien mira y la otra en universal.

   Las pruebas no fijan un huso: corren en el de la máquina, y lo que comprueban es que ida y
   vuelta den lo mismo sea cual sea. Escribir «10:00 se guarda como 13:00Z» sólo probaría el huso
   de acá, y pasaría a fallar en la máquina que publica. */

describe('el día y la hora de una entrevista, del campo al motor y de vuelta', () => {
  it('ida y vuelta no corren la cita', () => {
    const enElCampo = '2026-10-07T10:00';
    expect(paraElCampo(desdeElCampo(enElCampo))).toBe(enElCampo);
  });

  it('y de vuelta tampoco, empezando por el instante guardado', () => {
    const guardado = '2026-10-07T13:00:00.000Z';
    expect(desdeElCampo(paraElCampo(guardado))).toBe(guardado);
  });

  it('lo que sale para el motor es siempre universal', () => {
    expect(desdeElCampo('2026-10-07T10:00')).toMatch(/Z$/);
  });

  // Un campo no puede quedar con «undefined» ni con «Invalid Date» a la vista: cuando no hay nada
  // que mostrar, lo que corresponde es que esté vacío.
  it('sin fecha, o con una que no se entiende, el campo queda vacío', () => {
    expect(paraElCampo(null)).toBe('');
    expect(paraElCampo('')).toBe('');
    expect(paraElCampo('cualquier cosa')).toBe('');
  });

  // Falla cerrado: una fecha a medio escribir no se manda como cita. Quien llama mira el `null` y
  // no llama al motor.
  it('una fecha a medio escribir no se manda', () => {
    expect(desdeElCampo('')).toBeNull();
    expect(desdeElCampo('2026-13-45T99:99')).toBeNull();
    expect(desdeElCampo('cualquier cosa')).toBeNull();
  });
});

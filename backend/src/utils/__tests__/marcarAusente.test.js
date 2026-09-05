/**
 * Quién era el que se quedó esperando el relevo.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Cuando un Asistente no llega, el sistema abre un incidente de
 * relevo y ahí anota qué guardia venía terminando: es la persona que se quedó en la casa sin
 * que nadie la reemplace. Si esa guardia no se encuentra, el incidente dice «Ausente sin relevo
 * previo», que es la alerta más grave del sistema — así que elegir mal no es un detalle de
 * presentación, es acusar de algo que no pasó, o dejar a alguien esperando sin avisar.
 *
 * Hasta el 2026-09-05 la elección se hacía comparando las dos horas de reloj como si fueran del
 * mismo día (`hora_fin <= hora_inicio`), y la guardia de noche no lo es: un turno `22:00 → 06:00`
 * termina a la mañana siguiente. Las dos pruebas de la medianoche de acá abajo son justamente las
 * dos caras de ese error, y **fallan** si alguien vuelve a comparar las horas sueltas.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

// La conexión a la base se arma sola al importar, y `createClient` no acepta una dirección
// vacía. Acá no se consulta nada —la función que se prueba es pura—, pero el import la trae.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';
const { laQueTerminoJustoAntes } = await import('../marcarAusente.js');

/** El turno que quedó vacío: mañana del sábado. */
const ENTRANTE = { id: 'entrante', fecha: '2026-09-05', hora_inicio: '08:00', hora_fin: '16:00' };

const NOCHE_DEL_DIA_ANTERIOR = { id: 'noche-anterior', fecha: '2026-09-04', hora_inicio: '22:00', hora_fin: '06:00' };
const NOCHE_DEL_MISMO_DIA = { id: 'noche-siguiente', fecha: '2026-09-05', hora_inicio: '22:00', hora_fin: '06:00' };
const TARDE_DEL_DIA_ANTERIOR = { id: 'tarde-anterior', fecha: '2026-09-04', hora_inicio: '14:00', hora_fin: '22:00' };

describe('laQueTerminoJustoAntes', () => {
  it('sin candidatas no hay saliente: es el caso «ausente sin relevo previo»', () => {
    assert.equal(laQueTerminoJustoAntes(ENTRANTE, []), null);
    assert.equal(laQueTerminoJustoAntes(ENTRANTE, null), null);
  });

  it('elige la que termina más cerca del arranque', () => {
    const elegida = laQueTerminoJustoAntes(ENTRANTE, [TARDE_DEL_DIA_ANTERIOR, NOCHE_DEL_DIA_ANTERIOR]);
    assert.equal(elegida.id, 'noche-anterior');
  });

  it('la que termina justo cuando la otra empieza cuenta: ése es el relevo normal', () => {
    const pegada = { id: 'pegada', fecha: '2026-09-05', hora_inicio: '00:00', hora_fin: '08:00' };
    assert.equal(laQueTerminoJustoAntes(ENTRANTE, [pegada]).id, 'pegada');
  });

  // Primera cara del error de la medianoche: la guardia de noche del día anterior termina a las
  // 06:00 del día del turno vacío, así que es la saliente. Comparando las horas sueltas
  // (`06:00 <= 08:00`) da bien de casualidad; lo que importa es que se la busque en el día
  // anterior, cosa que la consulta vieja no hacía.
  it('la guardia de noche que empezó el día anterior es la saliente', () => {
    const elegida = laQueTerminoJustoAntes(ENTRANTE, [NOCHE_DEL_DIA_ANTERIOR]);
    assert.equal(elegida.id, 'noche-anterior');
  });

  // Segunda cara, y la que rompe de verdad: la guardia de noche del MISMO día empieza a las
  // 22:00 y termina a las 06:00 del día siguiente — o sea, catorce horas DESPUÉS del turno
  // vacío. Comparando las horas sueltas (`06:00 <= 08:00`) figuraba como «ya terminó» y se la
  // señalaba como saliente. No lo es: ni siquiera había empezado.
  it('la guardia de noche del mismo día no es la saliente: termina al otro día', () => {
    assert.equal(laQueTerminoJustoAntes(ENTRANTE, [NOCHE_DEL_MISMO_DIA]), null);
  });

  it('entre las dos noches elige la del día anterior, no la del mismo día', () => {
    const elegida = laQueTerminoJustoAntes(ENTRANTE, [NOCHE_DEL_MISMO_DIA, NOCHE_DEL_DIA_ANTERIOR]);
    assert.equal(elegida.id, 'noche-anterior');
  });

  // La guardia de veinticuatro horas es de las más comunes del rubro y se guarda con las dos
  // horas iguales. Leída literal duraría cero y quedaría descartada por «todavía corriendo».
  it('la guardia de veinticuatro horas del día anterior termina cuando arranca la de hoy', () => {
    const deVeinticuatro = { id: 'de-24', fecha: '2026-09-04', hora_inicio: '08:00', hora_fin: '08:00' };
    assert.equal(laQueTerminoJustoAntes(ENTRANTE, [deVeinticuatro]).id, 'de-24');
  });

  it('una que todavía está corriendo no cuenta', () => {
    const enCurso = { id: 'en-curso', fecha: '2026-09-05', hora_inicio: '06:00', hora_fin: '14:00' };
    assert.equal(laQueTerminoJustoAntes(ENTRANTE, [enCurso]), null);
  });
});

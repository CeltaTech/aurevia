/**
 * Quién puede mandar texto suelto por WhatsApp, y quién no.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Meta entrega un mensaje de texto suelto sólo adentro de una
 * conversación que abrió la otra persona. El mensaje que empieza la Prestadora —cada aviso, cada
 * recordatorio, cada código— tiene que salir por una plantilla aprobada, y si sale como texto
 * suelto se pierde sin que nadie se entere: no hay pantalla que se rompa ni registro que avise.
 *
 * Por eso la regla no se comprueba mensaje por mensaje sino acá: `enviarWhatsApp` la puede usar
 * solamente quien está contestando. Cualquier archivo nuevo que la importe rompe esta prueba, y
 * entonces hay que decidir a conciencia de qué lado está: si empieza la conversación, va por
 * `avisarPorWhatsapp`; si contesta, se suma a la lista de abajo con el motivo escrito.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOTOR = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Los que contestan adentro de una conversación que abrió la otra persona. */
const CONTESTAN = new Set([
  // La respuesta automática a un mensaje que entra por el webhook de Meta.
  'routes/whatsappWebhook.js',
  // El Coordinador contestando desde el Panel una conversación abierta.
  'routes/panelWhatsapp.js',
  // La propia implementación.
  'utils/whatsapp.js',
]);

function archivosDelMotor(carpeta, relativo = '') {
  return readdirSync(join(MOTOR, carpeta, relativo), { withFileTypes: true }).flatMap((entrada) => {
    const camino = relativo ? `${relativo}/${entrada.name}` : entrada.name;
    if (entrada.isDirectory()) {
      return entrada.name === '__tests__' ? [] : archivosDelMotor(carpeta, camino);
    }
    return entrada.name.endsWith('.js') ? [`${carpeta}/${camino}`] : [];
  });
}

describe('el mensaje que empieza la Prestadora no sale por texto suelto', () => {
  it('sólo lo manda quien está contestando una conversación abierta', () => {
    const importadores = [...archivosDelMotor('routes'), ...archivosDelMotor('utils')].filter(
      (archivo) => /\benviarWhatsApp\b(?!PorPlantilla)/.test(readFileSync(join(MOTOR, archivo), 'utf8')),
    );

    assert.deepEqual(importadores.sort(), [...CONTESTAN].sort());
  });

  it('la lista de los que contestan no crece sola', () => {
    // Si alguien agrega un archivo a la lista de arriba, que sea con la mano y leyendo el porqué.
    assert.equal(CONTESTAN.size, 3);
  });
});

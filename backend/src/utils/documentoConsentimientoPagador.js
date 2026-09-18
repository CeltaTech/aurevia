import crypto from 'node:crypto';

// Arma la hoja que firma el Pagador, y su huella.
//
// QUÉ ES ESTE TEXTO Y DE QUIÉN ES. Es un documento entre la Prestadora y un tercero de ella, así
// que es de ella: el producto trae un modelo y ella lo adopta, lo cambia o lo reemplaza por el
// suyo desde Configuración. Lo de acá es lo que rige mientras no cargue ninguno. Que es un modelo,
// que no es asesoramiento legal y que adoptarlo es decisión suya se lo dice la pantalla donde lo
// ve, no este texto: adentro de la hoja que firma el Pagador esa aclaración no tiene sentido.
//
// POR QUÉ EL DOCUMENTO SE GUARDA Y NO SE VUELVE A ARMAR. Si mañana la Prestadora cambia su modelo,
// esta función devolvería otro texto. Lo que el Pagador firmó fue el de aquel día: se guarda
// entero, tal cual, y lo que se muestra después es lo guardado.
//
// POR QUÉ LA HUELLA. Sin ella el registro dice que firmó y no dice QUÉ firmó. Con ella, si alguien
// le mueve una coma al texto guardado, deja de coincidir. No es firma digital —eso se evaluó y se
// descartó para la instrucción del círculo familiar, y acá vale lo mismo—: es la constancia de que
// el texto no cambió desde que se firmó.
//
// EL DOCUMENTO VA EN CASTELLANO, y así queda anotado en `documento_idioma`. El día que una
// Prestadora cargue el suyo en otro idioma, el campo ya está puesto para distinguirlos.
export const IDIOMA_DEL_DOCUMENTO = 'es-AR';

const SEPARADOR = '-'.repeat(72);

// Los marcadores que se reemplazan en el cuerpo, sea el modelo de fábrica o el que cargó la
// Prestadora. Están acá, en un solo lugar, porque la pantalla de Configuración los tiene que
// mostrar para que quien escriba su propio texto sepa cuáles puede usar.
export const MARCADORES = ['{{prestadora}}', '{{pagador}}', '{{documento}}', '{{cliente}}', '{{fecha}}'];

// El modelo que trae el producto. Dice lo mínimo que hace a la obligación: quién se obliga, a qué,
// por el servicio de quién, y que puede dejar de estar obligado avisando. No fija plazos, importes
// ni intereses: eso es de cada Prestadora y de cada contrato, y escribirlo acá sería imponerle una
// condición comercial a quien licencia el producto.
export const MODELO_DE_FABRICA = [
  'CONSENTIMIENTO A LA OBLIGACIÓN DE PAGAR',
  '',
  'Prestadora: {{prestadora}}',
  'Quien se obliga: {{pagador}}',
  'Documento: {{documento}}',
  'Servicio contratado para: {{cliente}}',
  'Fecha: {{fecha}}',
  '',
  SEPARADOR,
  '',
  'Quien firma declara que conoce el servicio contratado y asume la obligación de pagarlo',
  'a {{prestadora}}, en las condiciones y con la periodicidad que se hayan acordado.',
  '',
  'Esta obligación es propia y no depende de que un tercero —una obra social, una prepaga u',
  'otro financiador— reconozca, autorice o pague la prestación.',
  '',
  'Quien firma puede dejar de estar obligado para adelante avisándolo por escrito a la',
  'Prestadora. Lo que ya se prestó hasta ese aviso queda alcanzado por esta obligación.',
  '',
  'Los datos personales que se dejan acá se usan para facturar y cobrar el servicio, y para',
  'nada más.',
  '',
  SEPARADOR,
  '',
  'Firma: ................................................................',
  '',
  'Aclaración: ...........................................................',
  '',
].join('\n');

function fechaLegible(fecha) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(fecha);
}

/**
 * Reemplaza los marcadores del cuerpo con lo de esta contratación.
 *
 * `cuerpo` es el que cargó la Prestadora, o el modelo de fábrica si no cargó ninguno. Lo que falte
 * queda como raya: un marcador sin dato se ve, y verlo es lo que hace que alguien lo complete. Un
 * marcador desconocido se deja como está, porque borrarlo escondería el error de quien lo escribió.
 */
export function textoDelConsentimiento({ cuerpo, prestadora, pagador, cliente, fecha }) {
  const valores = {
    '{{prestadora}}': prestadora?.nombre || '—',
    '{{pagador}}': pagador?.nombre || '—',
    '{{documento}}': pagador?.documento || '—',
    '{{cliente}}': cliente?.nombre || '—',
    '{{fecha}}': fechaLegible(fecha ?? new Date()),
  };

  let texto = cuerpo ?? MODELO_DE_FABRICA;
  for (const [marcador, valor] of Object.entries(valores)) {
    texto = texto.split(marcador).join(valor);
  }
  return texto;
}

export function huellaDelDocumento(texto) {
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
}

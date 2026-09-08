import crypto from 'node:crypto';
import { CATALOGO_CIRCULO_FAMILIAR } from './catalogoCirculoFamiliar.js';

// Arma la hoja que firma el titular, y su huella.
//
// POR QUÉ EL DOCUMENTO SE GUARDA Y NO SE VUELVE A ARMAR. Si mañana se cambia una descripción del
// catálogo, o se agrega un acceso, esta función devolvería otro texto. Lo que el titular firmó fue
// el texto de aquel día: se guarda entero, tal cual, y lo que se muestra después es lo guardado.
// Volver a armarlo sería mostrarle a alguien un documento que nunca vio.
//
// POR QUÉ LA HUELLA. Sin ella, el registro dice que el titular confirmó y no dice QUÉ confirmó:
// cualquiera puede sostener después que el texto era otro. Con ella, si alguien le mueve una coma
// al texto guardado, deja de coincidir y se nota. No es firma digital —eso se evaluó y se
// descartó—: es la constancia de que el texto no cambió desde que se firmó.
//
// EL DOCUMENTO VA EN CASTELLANO, y así queda anotado en `documento_idioma`. Las descripciones
// salen del catálogo, que hoy está escrito en castellano, igual que el de los interruptores de la
// Prestadora. El día que el catálogo tenga las tres versiones, este texto sale en el idioma de la
// cuenta y el campo ya está puesto para distinguirlos.
export const IDIOMA_DEL_DOCUMENTO = 'es-AR';

const SEPARADOR = '-'.repeat(72);

function fechaLegible(fecha) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(fecha);
}

// `personas` es una lista de `{ nombre, email, accesos }`, donde `accesos` es el objeto plano
// clave → permitido que ya pasó por el tope de la Prestadora. El orden de las personas y el de los
// accesos es el que se ve: el del catálogo, siempre igual, para que dos documentos de la misma
// Familia se puedan comparar renglón por renglón.
export function textoDeLaInstruccion({ prestadora, titular, personas, cargadaPor, fecha }) {
  const cuando = fecha ?? new Date();
  const renglones = [];

  renglones.push('INSTRUCCIÓN SOBRE LOS ACCESOS DEL CÍRCULO FAMILIAR');
  renglones.push('');
  renglones.push(`Prestadora: ${prestadora?.nombre ?? '—'}`);
  renglones.push(`Titular de la cuenta: ${titular?.nombre ?? '—'}`);
  renglones.push(`Fecha: ${fechaLegible(cuando)}`);
  renglones.push('');
  renglones.push('El titular de la cuenta instruye a la Prestadora para que las personas anotadas');
  renglones.push('en su círculo familiar tengan, en la aplicación, exactamente los accesos que se');
  renglones.push('detallan a continuación, y ninguno más.');
  renglones.push('');

  if (personas.length === 0) {
    renglones.push(SEPARADOR);
    renglones.push('No hay ninguna persona anotada en el círculo familiar.');
    renglones.push(SEPARADOR);
  }

  for (const persona of personas) {
    const puede = [];
    const noPuede = [];

    for (const cosa of CATALOGO_CIRCULO_FAMILIAR) {
      (persona.accesos?.[cosa.clave] ? puede : noPuede).push(`    - ${cosa.descripcion}`);
    }

    renglones.push(SEPARADOR);
    renglones.push(`${persona.nombre ?? '—'}  (${persona.email ?? '—'})`);
    renglones.push('');
    renglones.push('  Puede:');
    renglones.push(...(puede.length ? puede : ['    - Nada de lo que sigue.']));
    renglones.push('');
    renglones.push('  No puede:');
    renglones.push(...(noPuede.length ? noPuede : ['    - Nada: tiene todos los accesos.']));
    renglones.push('');
  }

  renglones.push(SEPARADOR);
  renglones.push('');
  renglones.push('El titular ve toda la información de su cuenta y esto no lo modifica.');
  renglones.push('');
  renglones.push('Esta instrucción rige desde que la Prestadora la registra. Para cambiarla, el');
  renglones.push('titular se lo pide a la Prestadora y se firma una hoja nueva, que reemplaza a');
  renglones.push('ésta por completo.');
  renglones.push('');
  renglones.push(`Cargada en el sistema por: ${cargadaPor?.nombre ?? '—'}`);
  renglones.push('');
  renglones.push('Firma del titular: ......................................................');
  renglones.push('');
  renglones.push('Aclaración: ............................................................');
  renglones.push('');

  return renglones.join('\n');
}

export function huellaDelDocumento(texto) {
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
}

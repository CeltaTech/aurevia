// Cada cuánto se le vuelve a insistir al Coordinador, según lo apurado que esté el asunto.
//
// "Premura" son los minutos que pasaron desde que se detectó la alerta o el incidente. Cada
// Prestadora arma sus propios tramos en `configuracion_escalada_coordinador.umbrales_premura`,
// y el tramo dice: "mientras no pasen más de X minutos, insistile cada Y". El último tramo
// lleva `maximo_minutos` en nulo, que significa "de ahí en adelante", y es el que evita que un
// incidente viejo se quede sin ningún intervalo asignado.
//
// Las dos funciones de este archivo son la misma regla mirada de los dos lados: una la aplica
// (el proceso que avisa) y la otra la controla antes de guardar (el Panel). Van juntas para que
// nadie cambie una y se olvide de la otra (CLAUDE.md §7 regla 12).
//
// Están acá, y no adentro de revisarNotificacionesCoordinador.js, porque son cuentas puras que
// no tocan la base: así se prueban solas, sin arrancar nada (__tests__/umbralesPremura.test.js).

export function intervaloParaPremura(umbrales, minutosPremura) {
  const tramos = Array.isArray(umbrales) ? umbrales : [];
  for (const tramo of tramos) {
    if (tramo.maximo_minutos === null || minutosPremura <= tramo.maximo_minutos) {
      return tramo.intervalo_minutos;
    }
  }
  return 60;
}

// Devuelve null si la lista está bien armada, o el motivo en castellano si no.
//
// El motivo se le muestra a una persona que administra una Prestadora, así que no nombra
// columnas ni campos: habla de tramos, del "hasta" y de cada cuánto se avisa, que es lo que esa
// persona ve en la pantalla.
//
// Sin este control, una lista mal armada no rompía nada al guardarse: rompía después y en
// silencio, porque intervaloParaPremura() cae a su intervalo de respaldo de una hora y le
// termina avisando cada una hora a alguien que había pedido que le avisen cada diez minutos.
export function validarUmbralesPremura(umbrales) {
  if (!Array.isArray(umbrales) || umbrales.length === 0) {
    return 'Hay que cargar al menos un tramo.';
  }

  let maximoAnterior = null;

  for (let indice = 0; indice < umbrales.length; indice += 1) {
    const tramo = umbrales[indice];
    const esUltimo = indice === umbrales.length - 1;
    const numeroDeTramo = indice + 1;

    if (!tramo || typeof tramo !== 'object' || Array.isArray(tramo)) {
      return `Al tramo ${numeroDeTramo} le faltan datos.`;
    }

    if (!Number.isInteger(tramo.intervalo_minutos) || tramo.intervalo_minutos <= 0) {
      return `En el tramo ${numeroDeTramo}, cada cuántos minutos se avisa tiene que ser un número entero mayor que cero.`;
    }

    if (esUltimo) {
      if (tramo.maximo_minutos !== null) {
        return 'El último tramo es el que vale de ahí en adelante, así que no lleva un "hasta".';
      }
      continue;
    }

    if (!Number.isInteger(tramo.maximo_minutos) || tramo.maximo_minutos <= 0) {
      return `El "hasta" del tramo ${numeroDeTramo} tiene que ser un número entero de minutos mayor que cero.`;
    }
    if (maximoAnterior !== null && tramo.maximo_minutos <= maximoAnterior) {
      return `Los tramos van de menor a mayor: el "hasta" del tramo ${numeroDeTramo} no puede ser menor ni igual al del tramo anterior.`;
    }
    maximoAnterior = tramo.maximo_minutos;
  }

  return null;
}

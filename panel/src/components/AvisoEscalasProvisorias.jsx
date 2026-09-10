// Punto único de verdad de "esta escala legal todavía no está validada", dentro del Panel.
//
// El catálogo legal que trae el sistema lo dice adentro de cada fila: la columna `fuente` de
// `escalas_legales` es texto libre y las filas que todavía no revisó un abogado laboralista
// llevan escrita la palabra PROVISORIO ("PROVISORIO — validar con abogado laboralista",
// "Peso relativo del indicador, sobre 100 — PROVISORIO"). Hasta acá eso se veía únicamente
// consultando la base: las pantallas calculaban con esos valores sin decirlo.
//
// La palabra se busca en un solo lugar —éste— y no pantalla por pantalla: el día que el
// catálogo se valide y la marca cambie de forma, cambia acá y en ningún otro lado.
//
// Y se busca por lo que la fila dice de sí misma, nunca por una lista de tipos escrita a mano:
// una lista así queda vieja sola en cuanto el catálogo suma una escala nueva, y la escala nueva
// —justo la que nadie revisó todavía— sería la que pasaría sin aviso.
//
// Este archivo no puede vivir en `lib/escalasLegales.js`: ese archivo se copia tal cual al
// backend (`scripts/copias_entre_apps.mjs`), y esto es una pantalla.

import { useLocale } from '../i18n/LocaleContext';
import { Alert } from './ui/Alert';

/** La marca que la propia fila lleva escrita en `escalas_legales.fuente`. */
const MARCA_PROVISORIA = 'PROVISORIO';

/** ¿Esta fila del catálogo legal se declara provisoria? */
function esEscalaProvisoria(escala) {
  return String(escala?.fuente ?? '').toUpperCase().includes(MARCA_PROVISORIA);
}

/**
 * ¿Alguna de estas escalas es provisoria?
 *
 * Alcanza con una: un cálculo que usa diez valores validados y uno que no, no está validado.
 *
 * Las dos de arriba no salen de este archivo a propósito: quien necesite saberlo es una
 * pantalla, y lo que una pantalla hace con esa respuesta es mostrar este mismo aviso.
 */
function hayEscalasProvisorias(escalas) {
  return (escalas ?? []).some(esEscalaProvisoria);
}

/**
 * El aviso, para poner donde esas escalas se ven o se usan.
 *
 * Recibe las escalas tal como las devuelve `useEscalasLegales` y no dibuja nada cuando ninguna
 * es provisoria: mientras están cargando la lista viene vacía, así que el cartel no aparece y
 * se va, y el día que el catálogo de un país esté validado la pantalla queda limpia sola.
 *
 * Avisa, no bloquea (§7 de CLAUDE.md): quien decide es quien tiene la responsabilidad.
 */
export function AvisoEscalasProvisorias({ escalas }) {
  const { t } = useLocale();
  if (!hayEscalasProvisorias(escalas)) return null;

  return (
    <Alert variant="warning">
      <strong>{t.escalas_legales.provisorias_titulo}</strong> {t.escalas_legales.provisorias_aviso}
    </Alert>
  );
}

import { useLocale } from '../../i18n/LocaleContext';
import { con } from '../../lib/textos';

// Un puntaje de una a cinco estrellas, dibujado una sola vez para todo el Panel.
//
// Las estrellas dibujadas no se leen: un lector de pantalla nombraría cinco símbolos seguidos,
// o directamente los saltearía. Al lado va el mismo dato escrito, que no se ve pero sí se
// escucha. Ese par —lo dibujado escondido, lo escrito al lado— es lo que se repetía pantalla
// por pantalla, y es lo que este componente deja en un solo lugar.
//
// El puntaje llega como número y se acota a la escala: la base ya exige de 1 a 5, pero un dato
// fuera de rango dibujaría una fila de estrellas más larga que las de al lado, y eso se lee
// como un puntaje más alto en vez de como un error.
const MAXIMO = 5;

export function Estrellas({ cantidad }) {
  const { t } = useLocale();
  const puntaje = Math.min(MAXIMO, Math.max(0, Math.round(Number(cantidad) || 0)));
  return (
    <>
      <span aria-hidden="true">
        {'★'.repeat(puntaje)}
        {'☆'.repeat(MAXIMO - puntaje)}
      </span>
      <span className="solo-lectores-pantalla">{con(t.comun.puntaje_estrellas, { n: puntaje })}</span>
    </>
  );
}

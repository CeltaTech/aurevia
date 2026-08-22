import { useCallback, useId, useRef } from 'react';

/* Lo que le falta a una ventana modal para que se pueda usar sin ver la pantalla y sin mouse.
   Está acá, en un solo lugar, porque el Panel abre casi cuarenta ventanas de estas y todas
   necesitan exactamente lo mismo (`CLAUDE.md` §7 regla 12).

   Son cuatro cosas, y ninguna cambia lo que se ve:

     · Se anuncia como ventana, con su título. Sin `role="dialog"` un lector de pantalla lee
       la ventana como un párrafo más en el medio de la pantalla de atrás, sin decir que se
       abrió nada; sin `aria-labelledby` la anuncia como "diálogo" a secas.
     · El foco entra a la ventana al abrirse, y vuelve al botón que la abrió al cerrarse. Si
       no, quien navega con el tabulador sigue parado en la pantalla de atrás, que quedó
       tapada, y tiene que recorrerla entera para llegar al primer campo.
     · El tabulador da la vuelta adentro de la ventana en lugar de escaparse hacia atrás.
     · La tecla Escape la cierra, igual que hacer clic afuera — que es lo único que había.

   Cómo se usa, sin tocar el JSX que ya está:

     const modal = useModalAccesible(onClose);
     …
     <div className="panel-modal-fondo" onClick={onClose}>
       <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
         <h2 id={modal.idTitulo}>…</h2>

   `etiqueta` es la salida para las pocas ventanas que no tienen título a la vista: en vez de
   señalar un elemento, se les pasa el nombre ya escrito (y traducido, nunca a mano). */

const FOCALIZABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalAccesible(cerrar, etiqueta) {
  const idTitulo = useId();
  const dialogo = useRef(null);
  const veniaDe = useRef(null);

  /* Referencia de función y no `useEffect`: muchas de estas ventanas se dibujan con un `&&`
     adentro de una pantalla que ya estaba montada, así que el momento en que aparecen no es
     el momento en que corre el efecto del componente. Esto avisa cuando el nodo entra y
     cuando se va, que es justo lo que hace falta para mover el foco. */
  const alMontar = useCallback((nodo) => {
    if (nodo) {
      veniaDe.current = document.activeElement;
      dialogo.current = nodo;
      nodo.focus();
      return;
    }
    dialogo.current = null;
    const anterior = veniaDe.current;
    veniaDe.current = null;
    if (anterior instanceof HTMLElement && document.contains(anterior)) anterior.focus();
  }, []);

  const alPresionarTecla = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        // Se corta acá para que una ventana adentro de otra cierre solo la de adentro.
        e.stopPropagation();
        cerrar?.();
        return;
      }
      if (e.key !== 'Tab' || !dialogo.current) return;
      const focalizables = Array.from(dialogo.current.querySelectorAll(FOCALIZABLES)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focalizables.length === 0) return;
      const primero = focalizables[0];
      const ultimo = focalizables[focalizables.length - 1];
      const donde = document.activeElement;
      if (e.shiftKey && (donde === primero || donde === dialogo.current)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && donde === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    },
    [cerrar],
  );

  return {
    idTitulo,
    props: {
      ref: alMontar,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': etiqueta,
      'aria-labelledby': etiqueta ? undefined : idTitulo,
      // El foco entra al recuadro y no al primer campo: así se lee primero de qué se trata la
      // ventana y recién después qué hay que completar.
      tabIndex: -1,
      onKeyDown: alPresionarTecla,
    },
  };
}

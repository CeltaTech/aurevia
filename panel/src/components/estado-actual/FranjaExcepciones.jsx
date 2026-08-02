import { useMemo } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { resumenDeExcepciones } from '../../lib/excepciones';
import { con } from '../../lib/textos';
import { Button } from '../ui/Button';

/* La franja de arriba del Estado actual: siete contadores, uno por cada cosa que puede estar mal.
   ============================================================================
   Para qué está. Quien abre el Panel a la mañana no quiere leer la semana entera para
   descubrir qué le falta hacer. Quiere ver de un vistazo cuántos agujeros hay, y poder tocar
   uno para que abajo queden solo esas guardias.

   Qué NO hace este archivo. No cuenta nada. Las seis definiciones —qué guardia cae en cada
   contador y cuándo el contador va en rojo— viven en `lib/excepciones.js`, que es el único
   lugar donde están escritas (`CLAUDE.md` §7 regla 12). Acá solo se dibuja lo que esa función
   devuelve. Si el número de arriba y la lista de abajo salieran de dos cuentas distintas,
   tarde o temprano dirían cosas diferentes y nadie volvería a confiar en el número.

   Tampoco decide colores. El rojo lo pide `critica`, que viene calculado; acá solo se le suma
   la clase que ya existe en `index.css`.

   Los cuatro estados obligatorios (regla 3: cargando / error / vacío / listo). Este componente
   no busca datos en ningún lado: recibe las guardias ya cargadas por props. Cargando y error
   los maneja la pantalla que las trae, porque es la que sabe si la consulta salió bien. Acá el
   único estado propio es el vacío —las siete en cero—, que se muestra con `franja_todo_en_orden`.
   No es que falten tres estados: es que tres no le corresponden a esta pieza.

   Cómo se usa desde la pantalla de Estado actual:

     <FranjaExcepciones
       guardias={guardias}
       ctx={ctx}
       excepcionActiva={filtro}
       onElegir={setFiltro}
     />

   `onElegir` recibe el id al tocar un contador, y `null` cuando se toca el que ya estaba
   activo o el botón de "ver todo otra vez". Es decir: quien elige el filtro es la pantalla de
   arriba, no la franja. La franja avisa y nada más, así el filtro puede vivir en la URL. */

export function FranjaExcepciones({ guardias, ctx, excepcionActiva, onElegir }) {
  const { t } = useLocale();

  // Recorrer las guardias seis veces no es gratis cuando la semana está llena, y la franja se
  // vuelve a dibujar cada vez que alguien toca un contador. Se recalcula solo si cambian las
  // guardias o el contexto.
  const resumen = useMemo(() => resumenDeExcepciones(guardias, ctx), [guardias, ctx]);

  // `con` es la única función del Panel que rellena los huecos `{...}` de un texto traducido
  // (`lib/textos.js`). No se hace acá a mano con `.replace` para que ninguna pantalla tenga su
  // propia versión de lo mismo (regla 12).
  const nombreDe = (exc) => con(t.estado_actual[exc.claveEtiqueta], exc.parametros);
  const ayudaDe = (exc) => con(t.estado_actual[exc.claveAyuda], exc.parametros);

  const todoEnOrden = resumen.every((exc) => exc.cantidad === 0);
  const activa = resumen.find((exc) => exc.id === excepcionActiva) ?? null;

  // Tocar el contador que ya estaba filtrando lo apaga. Es lo que uno espera de algo que se
  // hunde al apretarlo, y evita tener que buscar dónde está el botón para volver atrás.
  const alTocar = (id) => onElegir?.(id === excepcionActiva ? null : id);

  return (
    <section>
      <h2>{t.estado_actual.franja_titulo}</h2>
      <p className="panel-explicacion">{t.estado_actual.franja_ayuda}</p>

      <div className="estado-actual-franja">
        {/* Se muestran los seis SIEMPRE, incluso los que dan cero. Si el contador desapareciera
            al llegar a cero, la franja cambiaría de forma sola de un día para el otro y uno
            tendría que buscar cada cosa en un lugar distinto cada mañana. Un cero también es
            información: dice "esto lo miré y está bien". */}
        {resumen.map((exc) => {
          const elegida = excepcionActiva === exc.id;
          const clases = ['estado-actual-excepcion'];
          if (exc.critica) clases.push('estado-actual-excepcion-critica');
          if (elegida) clases.push('estado-actual-excepcion-activa');

          return (
            <button
              key={exc.id}
              type="button"
              className={clases.join(' ')}
              // Botón de verdad y no un div que escucha clics: así se llega con el tabulador y
              // `aria-pressed` le dice a un lector de pantalla si ese filtro está puesto o no.
              aria-pressed={elegida}
              title={ayudaDe(exc)}
              onClick={() => alTocar(exc.id)}
            >
              <span className="estado-actual-excepcion-valor">{exc.cantidad}</span>
              <span className="estado-actual-excepcion-etiqueta">{nombreDe(exc)}</span>
              <span className="estado-actual-excepcion-ayuda">{ayudaDe(exc)}</span>
            </button>
          );
        })}
      </div>

      {/* El único estado que le toca manejar a esta pieza: no hay nada roto. Los seis ceros
          quedan igual arriba; esta línea explica que eso es una buena noticia y no una pantalla
          que no cargó. */}
      {todoEnOrden && <p className="estado-actual-franja-vacia">{t.estado_actual.franja_todo_en_orden}</p>}

      {/* Con un filtro puesto, la grilla de abajo muestra una parte. Decirlo en palabras evita
          que alguien lea media semana creyendo que la está viendo entera. */}
      {activa && (
        <div className="estado-actual-filtro-activo">
          <span>{con(t.estado_actual.filtrando_por, { excepcion: nombreDe(activa) })}</span>
          <Button variant="secondary" onClick={() => onElegir?.(null)}>
            {t.estado_actual.quitar_filtro}
          </Button>
        </div>
      )}
    </section>
  );
}

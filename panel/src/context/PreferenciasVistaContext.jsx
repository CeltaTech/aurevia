import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/* Las dos preferencias de vista del Panel: el TEMA (claro u oscuro) y la DENSIDAD (cuánto
   respira cada renglón de una tabla).
   =========================================================================================

   Van juntas en un solo contexto a propósito. Las dos son lo mismo desde el punto de vista
   del programa: una elección personal de quien mira la pantalla, que no viaja a la base de
   datos, que se guarda en el navegador de esa persona y que se aplica escribiendo un
   atributo en la etiqueta <html>. Tenerlas en dos archivos distintos sería repetir la misma
   mecánica dos veces (`CLAUDE.md` §7 regla 12).

   POR QUÉ EN EL NAVEGADOR Y NO EN LA BASE. Porque no es un dato de la Prestadora ni del
   Paciente: es cómo prefiere ver la pantalla la persona que está sentada ahí, y cambia según
   el aparato. La misma persona puede querer el Panel oscuro en su notebook de noche y claro
   en la computadora de la oficina. Guardarlo en la base lo obligaría a ser uno solo.

   POR QUÉ SE ESCRIBE EN <html> Y NO EN CADA COMPONENTE. Porque así el CSS resuelve todo
   solo: `variables.css` tiene una regla para `[data-tema="oscuro"]` y los colores de todo
   el Panel se dan vuelta de una vez. Ninguna pantalla se entera de que existe un modo
   oscuro, y por lo tanto ninguna pantalla se puede olvidar de soportarlo. */

const PreferenciasVistaContext = createContext(null);

/** Los tres valores del tema. "automatico" quiere decir: lo que tenga puesto la computadora. */
export const TEMAS = ['automatico', 'claro', 'oscuro'];
export const TEMA_POR_DEFECTO = 'automatico';

/** Los tres modos de densidad, de más aire a menos. */
export const DENSIDADES = ['comoda', 'normal', 'compacta'];
export const DENSIDAD_POR_DEFECTO = 'normal';

const CLAVE_TEMA = 'careonys-panel-tema';
const CLAVE_DENSIDAD = 'careonys-panel-densidad';

function leerGuardado(clave, permitidos, porDefecto) {
  // Si el navegador tiene el almacenamiento bloqueado, `localStorage` puede tirar error.
  // Una preferencia de vista no vale romper el Panel, así que se cae al valor de arranque.
  try {
    const guardado = localStorage.getItem(clave);
    return permitidos.includes(guardado) ? guardado : porDefecto;
  } catch {
    return porDefecto;
  }
}

function guardar(clave, valor) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* Sin almacenamiento la preferencia dura lo que dure la pestaña. Es aceptable. */
  }
}

export function PreferenciasVistaProvider({ children }) {
  const [tema, setTemaEstado] = useState(() => leerGuardado(CLAVE_TEMA, TEMAS, TEMA_POR_DEFECTO));
  const [densidad, setDensidadEstado] = useState(() =>
    leerGuardado(CLAVE_DENSIDAD, DENSIDADES, DENSIDAD_POR_DEFECTO),
  );

  useEffect(() => {
    // En "automatico" se saca el atributo en vez de escribirlo: sin atributo manda la
    // preferencia de la computadora, que es exactamente lo que "automatico" significa.
    if (tema === 'automatico') {
      document.documentElement.removeAttribute('data-tema');
    } else {
      document.documentElement.setAttribute('data-tema', tema);
    }
  }, [tema]);

  useEffect(() => {
    document.documentElement.setAttribute('data-densidad', densidad);
  }, [densidad]);

  const valor = useMemo(
    () => ({
      tema,
      densidad,
      setTema(nuevo) {
        if (!TEMAS.includes(nuevo)) return;
        guardar(CLAVE_TEMA, nuevo);
        setTemaEstado(nuevo);
      },
      setDensidad(nueva) {
        if (!DENSIDADES.includes(nueva)) return;
        guardar(CLAVE_DENSIDAD, nueva);
        setDensidadEstado(nueva);
      },
    }),
    [tema, densidad],
  );

  return <PreferenciasVistaContext.Provider value={valor}>{children}</PreferenciasVistaContext.Provider>;
}

export function usePreferenciasVista() {
  const ctx = useContext(PreferenciasVistaContext);
  if (!ctx) throw new Error('usePreferenciasVista debe usarse dentro de PreferenciasVistaProvider');
  return ctx;
}

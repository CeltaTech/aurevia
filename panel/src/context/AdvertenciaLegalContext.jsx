import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';
import { useModalAccesible } from '../hooks/useModalAccesible';

const AdvertenciaLegalContext = createContext(null);

// El cartel que avisa antes de encender algo con riesgo legal.
//
// QUÉ HACE Y QUÉ NO. Muestra el texto escrito para la jurisdicción de esa Prestadora y
// espera la decisión de quien mira. Nada más: no bloquea —quien decide es quien tiene la
// responsabilidad (CLAUDE.md §7)— y tampoco escribe el registro de que se avisó.
//
// POR QUÉ EL REGISTRO NO SE ESCRIBE ACÁ. Hasta el 2026-09-10 esta pantalla insertaba la fila
// de auditoría al cerrar el cartel. Eso hacía que el registro dependiera de que la pantalla se
// acordara de escribirlo: cualquier otro camino hasta la misma acción encendía la función sin
// dejar rastro, y un registro que se puede saltear no sirve como registro. Ahora lo anota el
// motor, en el mismo pedido que hace la cosa (backend/src/utils/advertenciaLegal.js).
//
// Se usa así:
//
//   const { verificarAntesDeActivar } = useAdvertenciaLegal();
//   const puedeActivar = await verificarAntesDeActivar(prestadoraId, 'ranking_plataforma');
//   if (puedeActivar) { ...pedirle al motor que la encienda... }
//
// Si la jurisdicción de esa Prestadora no tiene texto escrito para esa función,
// verificarAntesDeActivar devuelve true de inmediato, sin mostrar nada: si el país no tiene
// documento, no hay aviso y no se improvisa uno (CLAUDE.md §7).
export function AdvertenciaLegalProvider({ children }) {
  const { t } = useLocale();
  const [pendiente, setPendiente] = useState(null); // { texto, prestadoraId, jurisdiccion, funcionClave }
  const resolverRef = useRef(null);

  // Va antes de useModalAccesible porque ese hook la recibe: escrita más abajo, la línea que
  // la usa se ejecuta cuando la constante todavía no existe y la pantalla no llega a dibujarse.
  const cancelar = useCallback(() => {
    resolverRef.current?.(false);
    resolverRef.current = null;
    setPendiente(null);
  }, []);

  const modal = useModalAccesible(cancelar);

  const verificarAntesDeActivar = useCallback(async (prestadoraId, funcionClave) => {
    const { data: prestadora, error: errorPrestadora } = await supabase
      .from('prestadoras')
      .select('pais')
      .eq('id', prestadoraId)
      .single();
    if (errorPrestadora || !prestadora) return true;

    const { data: advertencia } = await supabase
      .from('advertencias_legales')
      .select('texto_advertencia')
      .eq('jurisdiccion', prestadora.pais)
      .eq('funcion_clave', funcionClave)
      .maybeSingle();
    if (!advertencia) return true;

    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPendiente({
        texto: advertencia.texto_advertencia,
        prestadoraId,
        jurisdiccion: prestadora.pais,
        funcionClave,
      });
    });
  }, []);

  const confirmar = useCallback(() => {
    resolverRef.current?.(true);
    resolverRef.current = null;
    setPendiente(null);
  }, []);

  return (
    <AdvertenciaLegalContext.Provider value={{ verificarAntesDeActivar }}>
      {children}
      {pendiente && (
        <div className="panel-modal-fondo" onClick={cancelar}>
          <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
            <h2 id={modal.idTitulo}>{t.advertencias_legales.titulo}</h2>
            <p>{pendiente.texto}</p>
            <div className="panel-modal-acciones">
              <Button variant="secondary" onClick={cancelar}>{t.advertencias_legales.cancelar}</Button>
              <Button onClick={confirmar}>{t.advertencias_legales.aceptar}</Button>
            </div>
          </div>
        </div>
      )}
    </AdvertenciaLegalContext.Provider>
  );
}

export function useAdvertenciaLegal() {
  const ctx = useContext(AdvertenciaLegalContext);
  if (!ctx) throw new Error('useAdvertenciaLegal debe usarse dentro de AdvertenciaLegalProvider');
  return ctx;
}

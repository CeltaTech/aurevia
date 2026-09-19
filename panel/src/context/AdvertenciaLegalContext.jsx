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
//   const respuesta = await verificarAntesDeActivar(prestadoraId, 'ranking_plataforma');
//   if (respuesta === 'error') { ...mostrar que no se pudo y no hacer nada... }
//   if (respuesta === 'seguir') { ...pedirle al motor que la encienda... }
//
// Si la jurisdicción de esa Prestadora no tiene texto escrito para esa función, contesta
// 'seguir' de inmediato, sin mostrar nada: si el país no tiene documento, no hay aviso y no se
// improvisa uno (CLAUDE.md §7).
//
// LAS TRES RESPUESTAS SON DISTINTAS. Antes eran dos —sí y
// no— y la consulta que fallaba se contestaba con un sí: la función se encendía sin que nadie
// hubiera visto la advertencia y sin que nadie se enterara de que no se pudo leer. «No se pudo
// averiguar» no es «no hay nada que advertir». Ahora son tres:
//
//   'seguir'    → no hay advertencia escrita, o la persona la leyó y aceptó.
//   'cancelado' → la leyó y dijo que no.
//   'error'     → no se pudo consultar. La pantalla lo dice y no hace la acción; se reintenta.
//
// Esto no bloquea por razones legales, que es lo que la regla prohíbe: no se hace la acción
// porque la consulta falló, igual que no se haría cualquier otra cosa que necesite un dato que
// no llegó.
export function AdvertenciaLegalProvider({ children }) {
  const { t } = useLocale();
  const [pendiente, setPendiente] = useState(null); // { texto, prestadoraId, jurisdiccion, funcionClave }
  const resolverRef = useRef(null);

  // Va antes de useModalAccesible porque ese hook la recibe: escrita más abajo, la línea que
  // la usa se ejecuta cuando la constante todavía no existe y la pantalla no llega a dibujarse.
  const cancelar = useCallback(() => {
    resolverRef.current?.('cancelado');
    resolverRef.current = null;
    setPendiente(null);
  }, []);

  const modal = useModalAccesible(cancelar);

  const verificarAntesDeActivar = useCallback(async (prestadoraId, funcionClave) => {
    const { data: prestadora, error: errorPrestadora } = await supabase
      .from('prestadoras')
      .select('pais')
      .eq('id', prestadoraId)
      .maybeSingle();
    // No se pudo saber de qué país es esta Prestadora, así que tampoco se puede saber si hay
    // algo que advertirle. Sin fila —`maybeSingle` la devuelve en nulo sin error— es lo mismo:
    // una Prestadora sin país no tiene documento que consultar.
    if (errorPrestadora) return 'error';
    if (!prestadora?.pais) return 'seguir';

    const { data: advertencia, error: errorAdvertencia } = await supabase
      .from('advertencias_legales')
      .select('texto_advertencia')
      .eq('jurisdiccion', prestadora.pais)
      .eq('funcion_clave', funcionClave)
      .maybeSingle();
    if (errorAdvertencia) return 'error';
    if (!advertencia) return 'seguir';

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
    resolverRef.current?.('seguir');
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

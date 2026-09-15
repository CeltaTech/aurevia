// Los umbrales del semáforo de guardia, traídos de la configuración de cada Prestadora.
//
// QUÉ RESUELVE. El color de una guardia en la grilla —urgente, tarde, sin cerrar— sale de tres
// números que son reglas operativas, y una regla operativa no se escribe en el código
// (`celtatech/CLAUDE.md`, «Nunca hardcodear»). Los tres ya viven en la base, cada uno en la tabla
// donde esa Prestadora lo decidió; la traducción de columnas a umbrales está en
// `lib/semaforoGuardia.js` y acá sólo se consulta.
//
// POR QUÉ UNA SOLA CONSULTA PARA TODO EL PANEL. Los mismos tres números los necesitan la grilla,
// el Estado actual, la ficha de una Familia y la de un Asistente. Preguntarlos pantalla por
// pantalla serían cuatro consultas para el mismo dato y cuatro lugares donde arreglarlo el día que
// cambie, que es justamente el patrón repetido sin punto único de verdad.
//
// SE LEE CON EL PASE DE QUIEN MIRA. Las tres tablas tienen política de lectura para el Coordinador
// y para el Admin de su Prestadora, así que la protección por fila resuelve de cuál se trata: acá
// no viaja ningún identificador de Prestadora, que es lo que haría falsificable la consulta. Lo que
// sí se mira es `usePrestadoraActual()`, y sólo para volver a preguntar: una sesión de soporte
// abierta cambia la Prestadora sin cambiar la sesión, y sin esto la grilla de la Prestadora ajena
// se pintaría con los umbrales de la anterior.
//
// MIENTRAS NO LLEGÓ LA RESPUESTA, VALEN LOS DE FÁBRICA. Una pantalla que no puede pintar un chip
// no sirve, y la diferencia entre un umbral y otro es de matiz: en el peor caso una guardia queda
// un instante del color de al lado.

import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { UMBRALES, umbralesDeLaPrestadora } from '../lib/semaforoGuardia';
import { usePrestadoraActual } from '../hooks/usePrestadoraActual';

const UmbralesContext = createContext(UMBRALES);

async function cargarUmbralesPropios() {
  const [avisoSinCubrir, ausenciaAutomatica, escaladaCoordinador] = await Promise.all([
    supabase.from('configuracion_aviso_guardia_sin_cubrir').select('horas_antes').maybeSingle(),
    supabase.from('configuracion_ausencia_automatica').select('minutos_tolerancia_checkin').maybeSingle(),
    supabase
      .from('configuracion_escalada_coordinador')
      .select('minutos_gracia_cierre_guardia')
      .maybeSingle(),
  ]);

  return umbralesDeLaPrestadora({
    avisoSinCubrir: avisoSinCubrir.data,
    ausenciaAutomatica: ausenciaAutomatica.data,
    escaladaCoordinador: escaladaCoordinador.data,
  });
}

export function UmbralesProvider({ children }) {
  const prestadoraId = usePrestadoraActual();
  const [umbrales, setUmbrales] = useState(UMBRALES);

  useEffect(() => {
    // Sin Prestadora resuelta —la pantalla de ingreso, o el usuario todavía cargando— no hay a
    // quién preguntarle, y quedan los de fábrica.
    if (!prestadoraId) {
      setUmbrales(UMBRALES);
      return undefined;
    }

    let activo = true;
    cargarUmbralesPropios().then((traidos) => {
      if (activo) setUmbrales(traidos);
    });

    return () => {
      activo = false;
    };
  }, [prestadoraId]);

  return <UmbralesContext.Provider value={umbrales}>{children}</UmbralesContext.Provider>;
}

/** Los umbrales listos para el contexto del semáforo: `{ ahora, umbrales: useUmbrales() }`. */
export function useUmbrales() {
  return useContext(UmbralesContext);
}

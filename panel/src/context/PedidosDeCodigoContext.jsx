import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { usePrestadoraActual } from '../hooks/usePrestadoraActual';
import { useLocale } from '../i18n/LocaleContext';
import { llamarApiComprobaciones } from '../lib/apiComprobaciones';
import { escucharEnVivo, ASUNTOS } from '../lib/avisosEnVivo';
import { mensajeDeError } from '../lib/errores';

/* Los pedidos de código que están esperando, mirados desde cualquier pantalla del Panel.
   ==========================================================================

   QUÉ RESUELVE. El diseño del pase de guardia (pendiente #113) pide que, cuando el Asistente
   está parado en la puerta y no tiene a quién pedirle el código, eso **aparezca en el momento**
   en la pantalla de la Prestadora. Una lista que sólo se actualiza al entrar a su pantalla no
   alcanza: quien está de turno pasa el día en Guardias o en Estado actual, y el pedido llegaría
   cuando a alguien se le ocurriera ir a mirar.

   CÓMO SE ENTERA. Por el canal en vivo (`lib/avisosEnVivo.js`): el motor empuja el asunto en
   cuanto un pedido entra o se resuelve, y acá se vuelve a pedir la lista. El aviso no trae
   ningún dato —dice qué cambió, no qué quedó—, así que la lista sale siempre de la misma ruta,
   que comprueba la sesión y filtra por la Organización.

   Y IGUAL SE PREGUNTA CADA TANTO, ESPACIADO. Que el aviso llegue en el momento lo da el canal;
   que llegue siempre, no: puede estar caído sin que el navegador lo note, o el motor puede estar
   corriendo en más de un proceso y el aviso nacer en uno distinto del que atiende esta conexión.
   Sin esta vuelta de respaldo, un canal que se cae en silencio deja la pantalla quieta para
   siempre, que es peor que llegar tarde. Con el canal andando no cambia nada de lo que se ve; sin
   él, la pantalla se comporta como antes, sólo que más lenta.

   POR QUÉ ES UN CONTEXTO Y NO ESTADO DE LA PANTALLA. Porque lo consumen dos: el menú, que muestra
   cuántos hay esperando, y la pantalla del pase de guardia, que los muestra. Con estado propio en
   cada uno habría dos consultas en curso preguntando lo mismo y pudiendo contestar distinto.

   CUÁNDO NO PREGUNTA NADA. Sin sesión iniciada, y sin Organización activa —el Superadmin que
   todavía no abrió una sesión de soporte no está adentro de ninguna Prestadora, así que no hay
   pedidos que traer—. En los dos casos el contador no se muestra.

   SI LA CONSULTA FALLA, LA LISTA ANTERIOR SE QUEDA. Un corte de red de dos segundos no tiene por
   qué borrar de la pantalla un pedido que sigue esperando. El error se guarda aparte y lo muestra
   la pantalla; el menú no muestra ninguno, porque un cartel de error en el menú no lleva a
   ninguna parte. */

const PedidosDeCodigoContext = createContext(null);

/* Cada cuánto se vuelve a preguntar cuando el canal no avisó nada. Es la red de abajo, no el
   camino normal: lo que se está cubriendo es que el canal se haya caído sin avisar, y eso no pasa
   cada dos minutos. Es un ritmo de pantalla y no una decisión de negocio, así que no va a la
   configuración de la Prestadora: no cambia lo que el sistema hace, sólo cuánto tarda en
   enterarse quien está mirando el día que el canal falle. */
const CADA_CUANTO_MS = 2 * 60 * 1000;

export function PedidosDeCodigoProvider({ children }) {
  const { session } = useAuth();
  const { t } = useLocale();
  const prestadoraId = usePrestadoraActual();
  const hayQuePreguntar = Boolean(session) && Boolean(prestadoraId);

  const [pedidos, setPedidos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  // Para no encimar dos consultas cuando una tarda más que el intervalo.
  const enVueloRef = useRef(false);

  const recargar = useCallback(async () => {
    if (!hayQuePreguntar) {
      setPedidos([]);
      setEstado('listo');
      setError(null);
      return;
    }
    if (enVueloRef.current) return;
    enVueloRef.current = true;
    try {
      const lista = await llamarApiComprobaciones('/pedidos');
      setPedidos(Array.isArray(lista) ? lista : []);
      setError(null);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      // La primera consulta que falla deja la pantalla en error; una que falla después de haber
      // traído algo deja lo que ya se había traído, con el aviso al lado.
      setEstado((anterior) => (anterior === 'cargando' ? 'error' : anterior));
    } finally {
      enVueloRef.current = false;
    }
  }, [hayQuePreguntar, t]);

  useEffect(() => {
    recargar();
    if (!hayQuePreguntar) return undefined;

    const reloj = setInterval(recargar, CADA_CUANTO_MS);
    // El navegador frena los relojes de una pestaña que quedó atrás, así que al volver a ella lo
    // que se ve puede tener varios minutos. Se vuelve a preguntar en cuanto se la mira.
    const alVolverAMirar = () => {
      if (document.visibilityState === 'visible') recargar();
    };
    document.addEventListener('visibilitychange', alVolverAMirar);
    const dejarDeEscuchar = escucharEnVivo(ASUNTOS.PEDIDOS_DE_CODIGO, recargar);
    return () => {
      clearInterval(reloj);
      document.removeEventListener('visibilitychange', alVolverAMirar);
      dejarDeEscuchar();
    };
  }, [recargar, hayQuePreguntar]);

  return (
    <PedidosDeCodigoContext.Provider value={{ pedidos, estado, error, recargar, hayQuePreguntar }}>
      {children}
    </PedidosDeCodigoContext.Provider>
  );
}

export function usePedidosDeCodigo() {
  const ctx = useContext(PedidosDeCodigoContext);
  if (!ctx) throw new Error('usePedidosDeCodigo debe usarse dentro de PedidosDeCodigoProvider');
  return ctx;
}

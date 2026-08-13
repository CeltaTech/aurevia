import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';

/* Qué muestran las dos aplicaciones del teléfono.
   ==========================================================================

   Cada Prestadora decide qué ve la Familia y qué ve el Asistente. Lo que se apaga acá no se
   esconde de la pantalla: deja de pedirse en la consulta, así que no sale de la base y no
   llega al teléfono de ninguna manera. Esconderlo en el maquetado sería dejarlo viajando, y
   cualquiera que sepa mirar por debajo lo vería igual (tarea 65).

   LA LISTA NO SE ESCRIBE ACÁ. Las dieciocho interruptores, con su nombre y su explicación, viven
   en `backend/src/utils/catalogoVisibilidad.js`, que es el único lugar donde se agrega o se
   saca una (CLAUDE.md §7 regla 12). Esta pantalla dibuja lo que le llega: un interruptor nuevo
   aparece sola, sin tocar este archivo.

   Los textos salen de las traducciones, no de lo que manda el servidor: el catálogo está
   escrito en español y solo (regla 1). La descripción del servidor queda de respaldo por si
   alguna vez llega un interruptor que las traducciones todavía no conocen — es preferible un
   renglón en español antes que un renglón en blanco. Es el mismo camino que la lista de
   avisos de Configuración › Avisos.

   Se guarda con un solo botón y se manda un solo interruptor por vez, porque así es la ruta del
   servidor. Solo viajan las que cambiaron: tocar una casilla y arrepentirse no escribe nada. */

const APLICACIONES = ['familias', 'asistentes'];

export function ConfiguracionAplicaciones() {
  const { t } = useLocale();
  const [interruptores, setInterruptores] = useState([]);
  const [elegido, setElegido] = useState({});
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { visibilidad } = await llamarApi('/visibilidad-app');
      setInterruptores(visibilidad);
      setElegido(Object.fromEntries(visibilidad.map((p) => [p.clave, p.visible])));
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function cambiar(clave, valor) {
    setElegido((anterior) => ({ ...anterior, [clave]: valor }));
    setGuardado(false);
  }

  const cambiadas = interruptores.filter((p) => elegido[p.clave] !== p.visible);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      // De a una y en orden: si una falla, la recarga de abajo muestra exactamente cuáles
      // quedaron guardadas, en vez de dejar la pantalla diciendo algo que no pasó.
      for (const interruptor of cambiadas) {
        await llamarApi(`/visibilidad-app/${interruptor.clave}`, {
          method: 'PATCH',
          body: JSON.stringify({ visible: elegido[interruptor.clave] }),
        });
      }
      setGuardado(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
      recargar();
    }
  }

  return (
    <div>
      <h2>{t.configuracion.visibilidad_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.visibilidad_explicacion}</p>
      <p className="panel-explicacion">{t.configuracion.visibilidad_de_fabrica}</p>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && interruptores.length === 0}
        recargar={recargar}
      >
        <div>
          {error && <Alert variant="error">{error}</Alert>}
          {guardado && <Alert variant="info">{t.configuracion.visibilidad_guardado}</Alert>}

          {APLICACIONES.map((app) => (
            <div key={app}>
              <h3>{t.configuracion[`visibilidad_grupo_${app}`]}</h3>
              {interruptores
                .filter((interruptor) => interruptor.app === app)
                .map((interruptor) => (
                  <FormField
                    key={interruptor.clave}
                    label={t.configuracion[`visibilidad_${interruptor.clave}`] || interruptor.descripcion}
                    name={interruptor.clave}
                    type="checkbox"
                    checked={elegido[interruptor.clave] ?? interruptor.de_fabrica}
                    ayuda={t.configuracion[`visibilidad_${interruptor.clave}_ayuda`] || interruptor.ayuda}
                    onChange={(e) => cambiar(interruptor.clave, e.target.checked)}
                  />
                ))}
            </div>
          ))}

          <Button onClick={guardar} disabled={guardando || cambiadas.length === 0}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </EstadoLista>
    </div>
  );
}

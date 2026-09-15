import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { FOTOS_DE_IDENTIDAD, FORMATOS_DE_FOTO, TAMANO_MAXIMO_DE_FOTO } from '../../lib/fotosDeIdentidad';
import { subirFotoDeIdentidad, verFotosDeIdentidad } from '../../lib/fotosGuardadasDeIdentidad';

/* Las dos fotos de la verificación de identidad, una al lado de la otra.
   ==========================================================================

   PARA QUÉ. La etapa de verificación de identidad compara la foto del documento con la foto de la
   persona (`docs/PRD_03_Reclutamiento.md`). Hasta ahora las dos fotos no estaban en ninguna parte:
   quien revisaba las recibía por fuera del producto y marcaba la etapa a mano, sin que quedara
   nada de lo que había mirado. Acá quedan guardadas y se muestran juntas, que es lo que hace falta
   para poder compararlas.

   NO ESTÁ ADENTRO DE NINGUNA ETAPA, y no es un olvido: cada Prestadora define las etapas de su
   propio proceso y les pone las claves que quiera (Configuración > El cuidado), así que no hay
   ninguna clave que esta pantalla pueda buscar. Las dos fotos son de la persona, no de una etapa.

   EL VACÍO ESTÁ EN CADA FOTO Y NO EN EL BLOQUE ENTERO. Los dos lugares existen siempre —son dos y
   se saben cuáles—, así que lo que puede faltar es la foto de cada uno, con su botón al lado para
   cargarla. Un cartel de «todavía no hay nada» tapando los dos dejaría la pantalla sin la única
   salida que ofrece. */

export function FotosDeIdentidad({ asistente }) {
  const { t } = useLocale();
  const tf = t.asistentes.verificacion.fotos;
  const [fotos, setFotos] = useState({});
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [subiendo, setSubiendo] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      setFotos(await verFotosDeIdentidad(asistente.id));
      setEstado('listo');
    } catch (e) {
      setError(mensajeDeError(e, t));
      setEstado('error');
    }
  }, [asistente.id, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function subir(tipo, archivo) {
    if (!archivo) return;
    // El tamaño y el formato se miran también acá, aunque el motor los vuelva a mirar: así quien
    // eligió el archivo equivocado se entera antes de esperar la subida entera. Lo que decide
    // sigue siendo el servidor (`celtatech/CLAUDE.md` §6).
    if (!FORMATOS_DE_FOTO.includes(archivo.type) || archivo.size > TAMANO_MAXIMO_DE_FOTO) {
      // El tope no está escrito en la frase: sale del mismo sitio que lo hace cumplir, así que el
      // día que cambie no queda un texto diciendo otro número.
      setError(tf.formato_no_va.replace('{{tope}}', TAMANO_MAXIMO_DE_FOTO / (1024 * 1024)));
      return;
    }
    setSubiendo(tipo);
    setError(null);
    try {
      await subirFotoDeIdentidad(asistente.id, tipo, archivo);
      await recargar();
    } catch (e) {
      setError(mensajeDeError(e, t));
    } finally {
      setSubiendo(null);
    }
  }

  return (
    <section className="panel-card-verificacion">
      <h3>{tf.titulo}</h3>
      <p className="panel-explicacion">{tf.explicacion}</p>
      {/* Sólo cuando la carga salió bien: si el estado es de error, el cartel lo pone `EstadoLista`
          con su botón de reintentar, y los dos juntos dirían lo mismo dos veces. */}
      {error && estado === 'listo' && <Alert variant="error">{error}</Alert>}

      <EstadoLista estado={estado} error={error} recargar={recargar}>
        <div className="panel-fotos-identidad">
          {FOTOS_DE_IDENTIDAD.map((tipo) => (
            <Ranura
              key={tipo}
              tipo={tipo}
              url={fotos[tipo]}
              asistenteId={asistente.id}
              subiendo={subiendo === tipo}
              onElegir={(archivo) => subir(tipo, archivo)}
            />
          ))}
        </div>
      </EstadoLista>
    </section>
  );
}

function Ranura({ tipo, url, asistenteId, subiendo, onElegir }) {
  const { t } = useLocale();
  const tf = t.asistentes.verificacion.fotos;
  const entrada = useRef(null);
  const idEntrada = `foto-identidad-${asistenteId}-${tipo}`;

  return (
    <figure className="panel-foto-identidad">
      <figcaption>{tf[`titulo_${tipo}`]}</figcaption>
      {url
        // La dirección vence al minuto: es una imagen de documento y no queda a mano de nadie que
        // se lleve el enlace. El texto alternativo dice qué es la foto y no de quién: lo lee
        // quien no ve la pantalla, y ahí tampoco corresponde el nombre de la persona.
        ? <img src={url} alt={tf[`titulo_${tipo}`]} />
        : <p className="estado-vacio">{tf.sin_foto}</p>}
      <input
        id={idEntrada}
        ref={entrada}
        type="file"
        accept={FORMATOS_DE_FOTO.join(',')}
        className="panel-entrada-oculta"
        // Queda afuera del recorrido con el tabulador y de lo que lee un lector de pantalla: el
        // control es el botón de abajo, y las dos cosas juntas serían el mismo control dos veces.
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          onElegir(e.target.files?.[0] ?? null);
          // Se limpia para que volver a elegir el mismo archivo cuente como un cambio: sin esto,
          // quien sube una foto, la borra de su máquina y elige otra con el mismo nombre no
          // dispara nada.
          e.target.value = '';
        }}
      />
      <Button variant="secondary" disabled={subiendo} onClick={() => entrada.current?.click()}>
        {subiendo ? t.comun.guardando : (url ? tf.reemplazar : tf.cargar)}
      </Button>
    </figure>
  );
}

import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import { useCatalogo } from '../../hooks/useCatalogo';
import { supabase } from '../../lib/supabaseClient';
import { mensajeDeError } from '../../lib/errores';
import {
  claveDesdeElTexto,
  comoLoEscribioLaPrestadora,
  textoDeLaOpcion,
} from '../../lib/listasDeOpciones';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { EstadoLista } from '../../components/layout/EstadoLista';

/* Una sola pantalla para todas las listas de opciones.
 *
 * Antes cada lista costaba su propia pantalla, y las que no llegaron a tenerla quedaron escritas
 * adentro del archivo de traducciones. Acá se elige cuál lista se está mirando y se edita ahí
 * mismo: el registro es genérico, así que la lista que se agregue mañana ya se edita desde acá sin
 * escribir nada.
 *
 * QUÉ SE PUEDE TOCAR Y QUÉ NO. Lo que trae el producto se ve y no se toca: es igual para todas las
 * Prestadoras y entra por migración. Lo que agrega la Prestadora es suyo por completo, y sólo en
 * las listas que admiten opciones propias —la marca la hace cumplir la base, y acá lo único que se
 * hace es no ofrecer un botón que iba a volver rechazado—.
 *
 * Y NINGUNA OPCIÓN SE BORRA: SE APAGA. Borrarla dejaría sin nombre a todo lo que ya se eligió con
 * ella. Apagada deja de ofrecerse y sigue nombrando lo viejo. */
export function LasListasDeOpciones() {
  const { t, locale } = useLocale();

  const lasListas = useCatalogo('listas_de_opciones', {
    columnas: 'id, prestadora_id, clave, i18n, admite_opciones_propias, orden, activa',
    filtros: { activa: true },
    orden: 'orden',
  });

  const [claveElegida, setClaveElegida] = useState('');
  const listaElegida =
    lasListas.filas.find((lista) => lista.clave === claveElegida) ?? lasListas.filas[0] ?? null;

  return (
    <div>
      <h2>{t.configuracion.listas_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.listas_explicacion}</p>

      <EstadoLista
        estado={lasListas.estado}
        error={lasListas.error}
        recargar={lasListas.recargar}
        mensajeVacio={t.configuracion.listas_vacio}
      >
        <div className="panel-filtros">
          <select
            aria-label={t.configuracion.listas_elegir}
            value={listaElegida?.clave ?? ''}
            onChange={(e) => setClaveElegida(e.target.value)}
          >
            {lasListas.filas.map((lista) => (
              <option key={lista.id} value={lista.clave}>
                {textoDeLaOpcion(lista.i18n, locale) || lista.clave}
              </option>
            ))}
          </select>
        </div>

        {listaElegida && (
          <OpcionesDeLaLista key={listaElegida.id} lista={listaElegida} />
        )}
      </EstadoLista>
    </div>
  );
}

/* Las opciones de una lista, con las dos capas a la vista: primero lo que trae el producto y
   detrás lo que agregó la Prestadora. El orden lo pone la base —lo propio se numera desde 101—,
   así que acá no se calcula nada: se muestra como vino. */
function OpcionesDeLaLista({ lista }) {
  const { t, locale } = useLocale();
  const prestadoraId = usePrestadoraActual();
  const confirmarDestructivo = useConfirmarDestructivo();

  // Se piden también las apagadas: ésta es la pantalla donde se vuelven a encender, y una opción
  // que no se ve no se puede encender.
  const lasOpciones = useCatalogo('opciones_de_lista', {
    columnas: 'id, prestadora_id, clave, i18n, orden, activa',
    filtros: { lista_id: lista.id },
    orden: 'orden',
    requiere: [lista.id],
  });

  const [texto, setTexto] = useState('');
  const [agregando, setAgregando] = useState(false);
  const [ocupadaId, setOcupadaId] = useState(null);
  const [error, setError] = useState(null);

  async function agregar() {
    setAgregando(true);
    setError(null);
    // El número de orden no viaja: lo pone la base, que es la única que ve todas las filas.
    const { error: errorInsert } = await supabase.from('opciones_de_lista').insert({
      prestadora_id: prestadoraId,
      lista_id: lista.id,
      clave: claveDesdeElTexto(texto),
      i18n: comoLoEscribioLaPrestadora(texto),
    });
    setAgregando(false);
    if (errorInsert) {
      setError(mensajeDeError(errorInsert, t, 'opciones_de_lista'));
      return;
    }
    setTexto('');
    lasOpciones.recargar();
  }

  async function alternar(opcion) {
    if (opcion.activa && !(await confirmarDestructivo(t.configuracion.listas_confirmar_apagar))) {
      return;
    }
    setOcupadaId(opcion.id);
    setError(null);
    const { error: errorUpdate } = await supabase
      .from('opciones_de_lista')
      .update({ activa: !opcion.activa })
      .eq('id', opcion.id);
    setOcupadaId(null);
    if (errorUpdate) {
      setError(mensajeDeError(errorUpdate, t, 'opciones_de_lista'));
      return;
    }
    lasOpciones.recargar();
  }

  async function corregir(opcion, nuevoTexto) {
    setOcupadaId(opcion.id);
    setError(null);
    // La clave no se toca: es lo que quedó guardado en cada ficha que eligió esta opción.
    const { error: errorUpdate } = await supabase
      .from('opciones_de_lista')
      .update({ i18n: comoLoEscribioLaPrestadora(nuevoTexto) })
      .eq('id', opcion.id);
    setOcupadaId(null);
    if (errorUpdate) {
      setError(mensajeDeError(errorUpdate, t, 'opciones_de_lista'));
      return;
    }
    lasOpciones.recargar();
  }

  return (
    <div className="panel-detalle">
      {error && <Alert variant="error">{error}</Alert>}

      <EstadoLista
        estado={lasOpciones.estado}
        error={lasOpciones.error}
        recargar={lasOpciones.recargar}
        mensajeVacio={t.configuracion.listas_sin_opciones}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.listas_col_texto}</th>
              <th>{t.configuracion.listas_col_origen}</th>
              <th>{t.configuracion.listas_col_activa}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lasOpciones.filas.map((opcion) => (
              <RenglonDeOpcion
                key={opcion.id}
                opcion={opcion}
                idioma={locale}
                ocupada={ocupadaId === opcion.id}
                onAlternar={() => alternar(opcion)}
                onCorregir={(nuevoTexto) => corregir(opcion, nuevoTexto)}
              />
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {lista.admite_opciones_propias ? (
        <div className="panel-detalle">
          <h3>{t.configuracion.listas_agregar_titulo}</h3>
          <FormField
            label={t.configuracion.listas_texto_label}
            name={`nueva_opcion_${lista.clave}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <Button onClick={agregar} disabled={agregando || !claveDesdeElTexto(texto)}>
            {agregando ? t.comun.guardando : t.configuracion.listas_agregar}
          </Button>
        </div>
      ) : (
        <p className="panel-explicacion">{t.configuracion.listas_cerrada}</p>
      )}
    </div>
  );
}

function RenglonDeOpcion({ opcion, idioma, ocupada, onAlternar, onCorregir }) {
  const { t } = useLocale();
  const esPropia = Boolean(opcion.prestadora_id);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [texto, setTexto] = useState(() => textoDeLaOpcion(opcion.i18n, idioma));

  return (
    <tr>
      <td>
        {corrigiendo ? (
          <FormField
            label={t.configuracion.listas_texto_label}
            name={`opcion_${opcion.id}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        ) : (
          textoDeLaOpcion(opcion.i18n, idioma) || opcion.clave
        )}
      </td>
      <td>
        {esPropia
          ? t.configuracion.listas_origen_propia
          : t.configuracion.listas_origen_producto}
      </td>
      <td>{opcion.activa ? t.comun.si : t.comun.no}</td>
      <td>
        {esPropia && (
          <>
            {corrigiendo ? (
              <>
                <Button
                  onClick={async () => {
                    await onCorregir(texto);
                    setCorrigiendo(false);
                  }}
                  disabled={ocupada || !texto.trim()}
                >
                  {ocupada ? t.comun.guardando : t.comun.guardar}
                </Button>{' '}
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTexto(textoDeLaOpcion(opcion.i18n, idioma));
                    setCorrigiendo(false);
                  }}
                  disabled={ocupada}
                >
                  {t.comun.cancelar}
                </Button>
              </>
            ) : (
              <>
                <button onClick={() => setCorrigiendo(true)} disabled={ocupada}>
                  {t.comun.editar}
                </button>{' '}
                <button onClick={onAlternar} disabled={ocupada}>
                  {opcion.activa
                    ? t.configuracion.listas_apagar
                    : t.configuracion.listas_encender}
                </button>
              </>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

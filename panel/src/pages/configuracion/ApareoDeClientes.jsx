import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { traducirValor } from '../../i18n/valores';
import { llamarApiClientesExternos as llamarApi } from '../../lib/apiClientesExternos';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import {
  COLUMNAS_DEL_APAREO,
  LARGO_MAXIMO_DEL_CLIENTE_EXTERNO,
  armarArchivo,
  leerArchivo,
} from '../../lib/intercambioDeFacturacion';

/* Con qué cliente del otro software se corresponde cada Familia.
   ==========================================================================

   PARA QUÉ SIRVE. El padrón de clientes no se duplica: se parte. El producto es dueño de quién es el
   cliente y el software de afuera es dueño de cómo ese cliente figura ante el organismo fiscal,
   que acá no se guarda, no se pide y no se manda. Lo que une las dos mitades es la referencia que
   se escribe en esta pantalla: cómo identifica el otro software a esa misma persona.

   Hace falta para dos cosas. La conexión directa necesita poder decir de qué cliente está
   hablando, y una Prestadora que ya tenía sus clientes cargados antes de empezar necesita poder
   aparearlos con sus Familias sin rehacer nada de los dos lados.

   POR CONEXIÓN, PORQUE PUEDEN SER DOS. El software que factura y el que sigue la cobranza pueden
   ser de dos proveedores que no se conocen y cada uno numera sus clientes como quiere. Qué clases
   de conexión hay sale de la base, nunca de una lista escrita acá.

   EL ARCHIVO SIRVE PARA LAS DOS PUNTAS. Se baja con todas las Familias y la columna de la
   referencia —vacía en las que faltan—, se completa en cualquier planilla de cálculo y se vuelve a
   subir. Bajarlo y subirlo sin tocar nada no cambia nada: la fila que ya estaba vacía se cuenta
   sin cambio, no se borra.

   CAMBIAR DE SOFTWARE REHACE LA REFERENCIA Y NO MUEVE NINGÚN DATO DE ESTE LADO. */

function bajarComoArchivo(nombre, texto) {
  const direccion = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const enlace = document.createElement('a');
  enlace.href = direccion;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(direccion);
}

export function ApareoDeClientes() {
  const { t } = useLocale();
  const [conexiones, setConexiones] = useState([]);
  const [conexion, setConexion] = useState('');
  const [filas, setFilas] = useState([]);
  // Lo que se está escribiendo en cada renglón, por Familia. Se guarda aparte de lo que contestó
  // el motor para poder saber si el renglón cambió y no ofrecer guardar lo mismo.
  const [escrito, setEscrito] = useState({});
  const [guardando, setGuardando] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [rechazos, setRechazos] = useState([]);
  const [intercambiando, setIntercambiando] = useState(false);
  const campoDeArchivo = useRef(null);

  // Qué clases de conexión existen se pregunta una sola vez: no cambia mientras se mira.
  useEffect(() => {
    let vigente = true;
    llamarApi('/conexiones')
      .then((clases) => {
        if (!vigente) return;
        setConexiones(clases);
        setConexion((actual) => actual || clases[0] || '');
      })
      .catch((e) => {
        if (!vigente) return;
        setError(mensajeDeError(e, t));
        setEstado('error');
      });
    return () => {
      vigente = false;
    };
  }, [t]);

  const recargar = useCallback(async () => {
    if (!conexion) return;
    setEstado('cargando');
    setError(null);
    try {
      const traidas = await llamarApi(`/?conexion=${encodeURIComponent(conexion)}`);
      setFilas(traidas);
      setEscrito(Object.fromEntries(traidas.map((f) => [f.familia_id, f.cliente_externo])));
      setEstado('listo');
    } catch (e) {
      setError(mensajeDeError(e, t));
      setEstado('error');
    }
  }, [conexion, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function guardarUna(familiaId) {
    const referencia = (escrito[familiaId] ?? '').trim();
    setGuardando(familiaId);
    setError(null);
    setAviso(null);
    try {
      await llamarApi(`/${familiaId}`, {
        method: 'PUT',
        body: JSON.stringify({ conexion, cliente_externo: referencia }),
      });
      setFilas((antes) =>
        antes.map((f) => (f.familia_id === familiaId ? { ...f, cliente_externo: referencia } : f))
      );
      setEscrito((antes) => ({ ...antes, [familiaId]: referencia }));
    } catch (e) {
      setError(mensajeDeError(e, t));
    } finally {
      setGuardando(null);
    }
  }

  /* Baja todas las Familias con la referencia que ya tengan, para completar las que faltan. */
  function bajarElArchivo() {
    bajarComoArchivo(
      `clientes-${conexion}.csv`,
      armarArchivo(
        filas.map((f) => ({
          familia_id: f.familia_id,
          familia: f.familia,
          cliente_externo: f.cliente_externo,
        })),
        COLUMNAS_DEL_APAREO
      )
    );
  }

  /* Sube el archivo completado. El archivo se lee acá y al motor le van las filas ya separadas;
     de quién es cada Familia lo comprueba el motor, que es el único que puede. */
  async function subirElArchivo(evento) {
    const archivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!archivo) return;

    setIntercambiando(true);
    setAviso(null);
    setRechazos([]);
    setError(null);

    try {
      const { columnas, filas: leidas } = leerArchivo(await archivo.text());
      const faltan = ['familia_id', 'cliente_externo'].filter((c) => !columnas.includes(c));
      if (faltan.length > 0) {
        setError(t.configuracion.apareo_faltan_columnas.replace('{columnas}', faltan.join(', ')));
        return;
      }
      if (leidas.length === 0) {
        setError(t.configuracion.apareo_sin_filas);
        return;
      }

      const { resultados } = await llamarApi('/importar', {
        method: 'POST',
        body: JSON.stringify({ conexion, filas: leidas }),
      });
      const cuantos = (nombre) => resultados.filter((r) => r.resultado === nombre).length;
      setAviso(
        t.configuracion.apareo_resultado
          .replace('{apareadas}', cuantos('apareado'))
          .replace('{borradas}', cuantos('borrado'))
          .replace('{rechazadas}', cuantos('rechazado'))
      );
      setRechazos(
        resultados
          .map((r, i) => ({ ...r, renglon: i + 2 }))
          .filter((r) => r.resultado === 'rechazado')
          .map((r) => ({ renglon: r.renglon, motivo: r.motivo }))
      );
      recargar();
    } catch (e) {
      setError(mensajeDeError(e, t));
    } finally {
      setIntercambiando(false);
    }
  }

  const sinAparear = filas.filter((f) => !f.cliente_externo).length;

  return (
    <section>
      <h3>{t.configuracion.apareo_titulo}</h3>
      <p className="panel-explicacion">{t.configuracion.apareo_explicacion}</p>

      <div className="panel-filtros">
        {conexiones.length > 1 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {t.configuracion.apareo_conexion}
            <select value={conexion} onChange={(e) => setConexion(e.target.value)}>
              {conexiones.map((c) => (
                <option key={c} value={c}>
                  {traducirValor(t.configuracion, `apareo_conexion_${c}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button variant="secondary" onClick={bajarElArchivo} disabled={intercambiando || filas.length === 0}>
          {t.configuracion.apareo_exportar}
        </Button>
        <Button
          variant="secondary"
          onClick={() => campoDeArchivo.current?.click()}
          disabled={intercambiando}
        >
          {t.configuracion.apareo_importar}
        </Button>
        <input
          ref={campoDeArchivo}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={subirElArchivo}
          style={{ display: 'none' }}
        />
      </div>

      {aviso && <Alert variant="info">{aviso}</Alert>}

      {rechazos.length > 0 && (
        <Alert variant="error">
          <strong>{t.configuracion.apareo_rechazos_titulo}.</strong>{' '}
          {rechazos
            .map((r) =>
              t.configuracion.apareo_rechazo
                .replace('{renglon}', r.renglon)
                .replace('{motivo}', traducirValor(t.configuracion, `apareo_motivo_${r.motivo}`))
            )
            .join(' ')}
        </Alert>
      )}

      {estado === 'listo' && sinAparear > 0 && (
        <Alert variant="info">
          {t.configuracion.apareo_faltan.replace('{cantidad}', sinAparear)}
        </Alert>
      )}

      <EstadoLista
        estado={estado}
        error={error}
        recargar={recargar}
        vacio={filas.length === 0}
        mensajeVacio={t.configuracion.apareo_sin_familias}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.apareo_col_familia}</th>
              <th>{t.configuracion.apareo_col_cliente}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const valor = escrito[f.familia_id] ?? '';
              const cambio = valor.trim() !== f.cliente_externo;
              return (
                <tr key={f.familia_id}>
                  <td>{f.familia || '—'}</td>
                  <td>
                    <input
                      type="text"
                      value={valor}
                      maxLength={LARGO_MAXIMO_DEL_CLIENTE_EXTERNO}
                      aria-label={t.configuracion.apareo_col_cliente}
                      onChange={(e) =>
                        setEscrito((antes) => ({ ...antes, [f.familia_id]: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <Button
                      variant="secondary"
                      onClick={() => guardarUna(f.familia_id)}
                      disabled={!cambio || guardando === f.familia_id}
                    >
                      {guardando === f.familia_id ? t.comun.guardando : t.comun.guardar}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </EstadoLista>
    </section>
  );
}

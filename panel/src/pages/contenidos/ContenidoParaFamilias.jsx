import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { usePermisos } from '../../context/PermisosContext';
import { esAdminOSuperior } from '../../lib/roles';
import { claseBadge } from '../../lib/tonos';
import { llamarApiContenidos } from '../../lib/apiContenidos';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';
import { ContenidoDetalle } from './ContenidoDetalle';

/* Contenido para Familias.
   ==========================================================================

   La biblioteca que la Prestadora escribe para quien cuida en su casa: un título, un texto y, si
   ya publica material en otro lado, un enlace. CeltaTech no escribe nada de esto ni trae nada de
   fábrica — no es su oficio y no responde por él—, así que una Prestadora nueva arranca con la
   lista vacía.

   Quién la escribe lo decide cada Prestadora en Configuración › Accesos. Verla la ve cualquiera
   del Panel: un borrador hay que poder revisarlo. Sin el permiso, la pantalla es de sólo lectura,
   y quien niega de verdad es el motor. */
export function ContenidoParaFamilias() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const { puede } = usePermisos();
  const [contenidos, setContenidos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [seleccionado, setSeleccionado] = useState(null);
  const [creandoNuevo, setCreandoNuevo] = useState(false);

  const puedeEscribir = esAdminOSuperior(usuario?.rol) || puede('escribir_contenido_para_familias');

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { contenidos: filas } = await llamarApiContenidos('/');
      setContenidos(filas || []);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <div>
      <h1>{t.contenidos.titulo}</h1>
      <p className="panel-explicacion">{t.contenidos.explicacion}</p>

      {estado === 'error' && error && <Alert variant="error">{error}</Alert>}

      {puedeEscribir && (
        <div className="panel-filtros">
          <Button onClick={() => setCreandoNuevo(true)}>{t.contenidos.nuevo}</Button>
        </div>
      )}

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && contenidos.length === 0}
        recargar={recargar}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.contenidos.col_orden}</th>
              <th>{t.contenidos.col_titulo}</th>
              <th>{t.contenidos.col_enlace}</th>
              <th>{t.contenidos.col_publicado}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {contenidos.map((contenido) => (
              <tr key={contenido.id}>
                <td>{contenido.orden}</td>
                <td>{contenido.titulo}</td>
                <td>{contenido.enlace_url ? t.comun.si : '—'}</td>
                <td>
                  <span className={claseBadge(contenido.publicado ? 'activo' : 'inactivo')}>
                    {contenido.publicado ? t.contenidos.publicado_si : t.contenidos.publicado_no}
                  </span>
                </td>
                <td>
                  <button onClick={() => setSeleccionado(contenido)}>
                    {puedeEscribir ? t.comun.editar : t.comun.ver_detalle}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {(seleccionado || creandoNuevo) && (
        <ContenidoDetalle
          contenido={seleccionado}
          soloLectura={!puedeEscribir}
          onClose={() => {
            setSeleccionado(null);
            setCreandoNuevo(false);
          }}
          onGuardado={() => {
            setSeleccionado(null);
            setCreandoNuevo(false);
            recargar();
          }}
        />
      )}
    </div>
  );
}

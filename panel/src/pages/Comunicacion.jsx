import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { esAdminOSuperior } from '../lib/roles';
import { supabase } from '../lib/supabaseClient';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Alert } from '../components/ui/Alert';
import { HiloComunicacion } from '../components/comunicacion/HiloComunicacion';
import { HiloWhatsapp } from '../components/comunicacion/HiloWhatsapp';

// Bandeja única: las conversaciones internas con cada Asistente y los WhatsApp que entran
// al número de la Prestadora se ven en la misma lista. Antes el WhatsApp no se veía en
// ninguna pantalla, así que cuando la inteligencia artificial no se animaba a contestar
// sola, el mensaje quedaba esperando a alguien que no tenía dónde leerlo.

// Tope de mensajes que se traen para armar la vista previa de cada conversación. No es el
// hilo completo: el hilo entero se carga recién cuando se elige una conversación.
const TOPE_MENSAJES_PREVIA = 500;

function ultimoPorClave(filas, clave) {
  const ultimo = new Map();
  for (const fila of filas) {
    if (!ultimo.has(fila[clave])) ultimo.set(fila[clave], fila);
  }
  return ultimo;
}

export function Comunicacion() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const esAdmin = esAdminOSuperior(usuario?.rol);

  const [conversaciones, setConversaciones] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [avisoWhatsapp, setAvisoWhatsapp] = useState(null);
  const [seleccionada, setSeleccionada] = useState(null);
  const { f, set, limpiar, hayFiltros } = useFiltros({ canal: 'todos', soloPendientes: false });

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    setAvisoWhatsapp(null);

    const [
      { data: asistentesData, error: errorAsistentes },
      { data: mensajesInternos },
      { data: conversacionesData, error: errorConversaciones },
      { data: mensajesWhatsapp },
    ] = await Promise.all([
      supabase.from(esAdmin ? 'asistentes' : 'asistentes_coordinador').select('id, nombre'),
      supabase
        .from('mensajes_asistente')
        .select('asistente_id, mensaje, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('conversaciones_whatsapp')
        .select('id, telefono, ultimo_mensaje_at, requiere_atencion_coordinador, asistentes(nombre)')
        .order('ultimo_mensaje_at', { ascending: false }),
      supabase
        .from('mensajes_whatsapp')
        .select('conversacion_id, texto, created_at')
        .order('created_at', { ascending: false })
        .limit(TOPE_MENSAJES_PREVIA),
    ]);

    if (errorAsistentes) {
      setError(errorAsistentes.message);
      setEstado('error');
      return;
    }

    // Si el canal de WhatsApp falla (por ejemplo, porque este rol no lo tiene habilitado),
    // la bandeja igual muestra el canal interno y avisa qué quedó afuera.
    if (errorConversaciones) setAvisoWhatsapp(errorConversaciones.message);

    const ultimoInterno = ultimoPorClave(mensajesInternos ?? [], 'asistente_id');
    const ultimoWhatsapp = ultimoPorClave(mensajesWhatsapp ?? [], 'conversacion_id');

    const items = [
      ...(asistentesData ?? []).map((a) => {
        const ultimo = ultimoInterno.get(a.id) ?? null;
        return {
          clave: `interno:${a.id}`,
          canal: 'interno',
          id: a.id,
          titulo: a.nombre,
          preview: ultimo ? ultimo.mensaje : null,
          fecha: ultimo?.created_at ?? null,
          atencion: false,
          orden: a.nombre,
        };
      }),
      ...(conversacionesData ?? []).map((c) => {
        const ultimo = ultimoWhatsapp.get(c.id) ?? null;
        return {
          clave: `whatsapp:${c.id}`,
          canal: 'whatsapp',
          id: c.id,
          titulo: c.asistentes?.nombre ?? c.telefono,
          preview: ultimo ? ultimo.texto : null,
          fecha: ultimo?.created_at ?? c.ultimo_mensaje_at,
          atencion: c.requiere_atencion_coordinador,
          orden: c.asistentes?.nombre ?? c.telefono,
        };
      }),
    ];

    // Primero lo que espera respuesta, después lo más reciente, y al final lo que nunca
    // tuvo un mensaje, ordenado por nombre.
    items.sort((a, b) => {
      if (a.atencion !== b.atencion) return a.atencion ? -1 : 1;
      if (!a.fecha && !b.fecha) return a.orden.localeCompare(b.orden);
      if (!a.fecha) return 1;
      if (!b.fecha) return -1;
      return new Date(b.fecha) - new Date(a.fecha);
    });

    setConversaciones(items);
    setEstado('listo');
  }, [esAdmin]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const visibles = useMemo(
    () =>
      conversaciones.filter(
        (c) => (f.canal === 'todos' || c.canal === f.canal) && (!f.soloPendientes || c.atencion),
      ),
    [conversaciones, f],
  );

  const abierta = conversaciones.find((c) => c.clave === seleccionada) ?? null;

  return (
    <div>
      <h1>{t.comunicacion.titulo}</h1>
      <p className="panel-explicacion">{t.comunicacion.explicacion}</p>

      {avisoWhatsapp && <Alert variant="error">{avisoWhatsapp}</Alert>}

      <div className="panel-comunicacion-layout">
        <div className="panel-comunicacion-lista-wrap">
          <div className="panel-comunicacion-filtros">
            <select value={f.canal} onChange={(e) => set('canal', e.target.value)}>
              <option value="todos">{t.comunicacion.filtro_todos_los_canales}</option>
              <option value="interno">{t.comunicacion.canal_interno}</option>
              <option value="whatsapp">{t.comunicacion.canal_whatsapp}</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={f.soloPendientes}
                onChange={(e) => set('soloPendientes', e.target.checked)}
              />{' '}
              {t.comunicacion.filtro_solo_pendientes}
            </label>
          </div>

          <EstadoLista
            estado={estado}
            error={error}
            vacio={estado === 'listo' && visibles.length === 0}
            recargar={recargar}
            filtrado={hayFiltros}
            onLimpiarFiltros={limpiar}
            mensajeVacio={t.comunicacion.sin_conversaciones}
          >
            <div className="panel-comunicacion-lista">
              {visibles.map((c) => (
                <button
                  key={c.clave}
                  type="button"
                  className={`panel-comunicacion-item ${
                    seleccionada === c.clave ? 'panel-comunicacion-item-activo' : ''
                  }`}
                  onClick={() => setSeleccionada(c.clave)}
                >
                  <div className="panel-comunicacion-item-cabecera">
                    <span className="panel-comunicacion-item-nombre">{c.titulo}</span>
                    <span className="badge">
                      {c.canal === 'whatsapp' ? t.comunicacion.canal_whatsapp : t.comunicacion.canal_interno}
                    </span>
                  </div>
                  {c.atencion && <span className="badge badge-atencion">{t.comunicacion.espera_respuesta}</span>}
                  <div className="panel-comunicacion-item-preview">
                    {c.preview ?? t.comunicacion.sin_mensaje_previo}
                  </div>
                </button>
              ))}
            </div>
          </EstadoLista>
        </div>

        <div className="panel-comunicacion-hilo">
          {!abierta && <p className="estado-vacio">{t.comunicacion.seleccionar_conversacion}</p>}
          {abierta?.canal === 'interno' && (
            <HiloComunicacion asistenteId={abierta.id} mostrarEncabezado={false} onEnviado={recargar} />
          )}
          {abierta?.canal === 'whatsapp' && (
            <HiloWhatsapp conversacionId={abierta.id} onCambio={recargar} />
          )}
        </div>
      </div>
    </div>
  );
}

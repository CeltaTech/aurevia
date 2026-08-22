import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { usePermisos } from '../../context/PermisosContext';
import { useEmpresa } from '../../context/EmpresaContext';
import { useModalidades } from '../../context/ModalidadesContext';
import { esAdminOSuperior } from '../../lib/roles';
import {
  MODALIDADES_DE_ASISTENTE,
  modalidadesDelAsistente,
  modalidadesHabilitadas,
  mensajeDeModalidad,
} from '../../lib/modalidades';
import { nombreTipo } from '../../lib/tiposAsistente';
import { useTiposAsistente } from '../../hooks/useTiposAsistente';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import { useMonedaActual } from '../../hooks/useMonedaActual';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { generarCertificadoTrabajo, generarCertificadoRemuneracionesServicios, descargarPDF } from '../../lib/generarDocumentoCese';
import { con } from '../../lib/textos';

const API_URL = import.meta.env.VITE_API_URL;

export function PerfilTab({ asistente, onActualizado }) {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const { empresa } = useEmpresa();
  const esAdmin = esAdminOSuperior(usuario?.rol);
  const moneda = useMonedaActual();
  const { puede } = usePermisos();
  const puedeEditarIdentidad = esAdmin || puede('editar_identidad_asistente');
  const { paraElegir: tiposAsistente, porId: tiposPorId } = useTiposAsistente();
  const { modalidades } = useModalidades();

  /* Las formas de recibir trabajo que se pueden marcar en esta ficha. El techo lo pone la
     Prestadora con las modalidades que tenga activas. Se suma a la lista la que el Asistente
     ya tenga puesta aunque la Prestadora la haya apagado después: si no se mostrara, quedaría
     escrita en la ficha sin que nadie la vea, y el primer cambio de modalidad lo rechazaría la
     base sin explicación. Mismo criterio que el tipo de Asistente, más abajo. */
  const modalidadesPosibles = useMemo(() => {
    const habilitadas = modalidadesHabilitadas(modalidades);
    const puestas = modalidadesDelAsistente(asistente);
    return MODALIDADES_DE_ASISTENTE.filter((m) => habilitadas.includes(m) || puestas.includes(m));
  }, [modalidades, asistente]);

  const [form, setForm] = useState({
    nombre: asistente.nombre || '',
    dni: asistente.dni || '',
    telefono: asistente.telefono || '',
    email: asistente.email || '',
    domicilio: asistente.domicilio || '',
    tipo_asistente_id: asistente.tipo_asistente_id || '',
    zonas: (asistente.zonas || []).join(', '),
    estado: asistente.estado,
    tipo_vinculo: asistente.tipo_vinculo,
    categoria_cct: asistente.categoria_cct || '',
    valor_hora: asistente.valor_hora || '',
    sueldo_basico: asistente.sueldo_basico || '',
    horas_semanales: asistente.horas_semanales || '',
    modalidades: modalidadesDelAsistente(asistente),
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [guardado, setGuardado] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [mensajeReenvio, setMensajeReenvio] = useState(null);

  function set(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setGuardado(false);
  }

  function alternarModalidad(modalidad) {
    setForm((f) => ({
      ...f,
      modalidades: f.modalidades.includes(modalidad)
        ? f.modalidades.filter((m) => m !== modalidad)
        : [...f.modalidades, modalidad],
    }));
    setGuardado(false);
  }

  async function guardar() {
    /* Sin ninguna forma de recibir trabajo, este Asistente no puede recibir una sola guardia.
       La base lo dejaría guardar así, y el problema recién aparecería el día que se le quiera
       asignar algo, lejos de la pantalla donde se produjo. */
    if (esAdmin && form.modalidades.length === 0) {
      setError(t.modalidades.falta_elegir);
      return;
    }
    setGuardando(true);
    setError(null);
    const payload = {
      nombre: form.nombre.trim(),
      dni: form.dni.trim() || null,
      telefono: form.telefono.trim() || null,
      email: form.email.trim() || null,
      tipo_asistente_id: form.tipo_asistente_id || null,
      zonas: form.zonas.split(',').map((s) => s.trim()).filter(Boolean),
      estado: form.estado,
      ...(esAdmin && {
        /* Dónde vive, escrito para que lo lea una persona. Las coordenadas (`lat`/`lng`) no se
           cargan a mano acá: se completan a partir de esta dirección por una vía todavía sin
           decidir, y hasta entonces quedan en nulo.
           Viaja solo cuando la pantalla lo tenía para mostrar: la vista que lee el Coordinador
           (`asistentes_coordinador`) no trae esta columna, así que mandarlo igual borraría un
           domicilio ya cargado que esa pantalla nunca llegó a mostrar. */
        domicilio: form.domicilio.trim() || null,
        tipo_vinculo: form.tipo_vinculo,
        horas_semanales: form.horas_semanales || null,
        // La columna se llama `canales` de antes y no se renombra (regla 13). La palabra del
        // producto, acá y en toda la pantalla, es modalidad de trabajo.
        canales: form.modalidades,
      }),
    };
    const { error: errorUpdate } = await supabase.from('asistentes').update(payload).eq('id', asistente.id);
    if (errorUpdate) {
      setGuardando(false);
      // La base tiene la última palabra sobre la modalidad: puede rechazar una que la
      // Prestadora apagó mientras esta pantalla estaba abierta. Ese rechazo se traduce a una
      // frase que dice qué pasó y dónde se arregla, nunca el texto crudo del error.
      setError(mensajeDeModalidad(errorUpdate, t.modalidades) ?? t.comun.error_generico);
      return;
    }

    // Lo que cobra el Asistente se guarda aparte, en `remuneraciones_asistente`, donde la base
    // exige el permiso `ver_pagos_asistente` para leerlo y ser administración para cambiarlo.
    // Puede no existir todavía la fila —un Asistente dado de alta sin importes—, así que se
    // usa `upsert`: la crea la primera vez y la actualiza las siguientes.
    if (esAdmin) {
      const { error: errorRemuneracion } = await supabase
        .from('remuneraciones_asistente')
        .upsert(
          {
            asistente_id: asistente.id,
            prestadora_id: asistente.prestadora_id,
            categoria_cct: form.categoria_cct || null,
            valor_hora: form.valor_hora || null,
            sueldo_basico: form.sueldo_basico || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'asistente_id' },
        );
      if (errorRemuneracion) {
        setGuardando(false);
        setError(t.comun.error_generico);
        return;
      }
    }
    setGuardando(false);
    setGuardado(true);
    onActualizado();
  }

  async function reenviarInvitacion() {
    setReenviando(true);
    setMensajeReenvio(null);
    try {
      const { data } = await supabase.auth.getSession();
      const respuesta = await fetch(`${API_URL}/api/panel/cuentas/${asistente.id}/reenviar-activacion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) {
        throw new Error(resultado.error);
      }
      setMensajeReenvio({ tipo: 'info', texto: t.comun.invitacion_reenviada });
    } catch {
      setMensajeReenvio({ tipo: 'error', texto: t.comun.reenviar_invitacion_error });
    } finally {
      setReenviando(false);
    }
  }

  function descargarCertificadoTrabajo() {
    descargarPDF(generarCertificadoTrabajo({ asistente, nombreEmpresa: empresa?.nombre ?? '' }), `certificado-trabajo-${asistente.nombre}.pdf`);
  }

  function descargarCertificadoRemuneraciones() {
    descargarPDF(generarCertificadoRemuneracionesServicios({ asistente, nombreEmpresa: empresa?.nombre ?? '', moneda }), `certificado-remuneraciones-${asistente.nombre}.pdf`);
  }

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}
      {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}

      <FormField label={t.asistentes.col_nombre} name="nombre" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} disabled={!puedeEditarIdentidad} />
      <FormField label={t.asistentes.dni} name="dni" value={form.dni} onChange={(e) => set('dni', e.target.value)} disabled={!puedeEditarIdentidad} />
      <FormField label={t.asistentes.telefono} name="telefono" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} disabled={!puedeEditarIdentidad} />
      <FormField label={t.asistentes.email} name="email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} disabled={!puedeEditarIdentidad} />
      {/* El domicilio solo lo ve la administración: la vista del Coordinador no trae esa
          columna, así que ahí el campo aparecería siempre vacío por más que el dato exista. */}
      {esAdmin && (
        <FormField label={t.asistentes.domicilio} name="domicilio" value={form.domicilio} onChange={(e) => set('domicilio', e.target.value)} disabled={!puedeEditarIdentidad} />
      )}

      <dl className="panel-detalle-lista">
        <dt>{t.asistentes.fecha_alta}</dt>
        <dd>{new Date(asistente.fecha_alta).toLocaleDateString()}</dd>
      </dl>

      <FormField
        label={t.asistentes.col_tipo}
        name="tipo_asistente_id"
        type="select"
        value={form.tipo_asistente_id}
        onChange={(e) => set('tipo_asistente_id', e.target.value)}
        disabled={!puedeEditarIdentidad}
      >
        <option value="">{t.asistentes.tipo_sin_asignar}</option>
        {/* El tipo que tiene puesto puede haberse apagado después; igual se
            muestra, para que no aparezca vacío ni se pierda al guardar. */}
        {tiposAsistente.some((tipo) => tipo.id === form.tipo_asistente_id) === false && form.tipo_asistente_id && (
          <option value={form.tipo_asistente_id}>{nombreTipo(tiposPorId.get(form.tipo_asistente_id), t)}</option>
        )}
        {tiposAsistente.map((tipo) => (
          <option key={tipo.id} value={tipo.id}>{nombreTipo(tipo, t)}</option>
        ))}
      </FormField>

      {/* Lo que estaba escrito a mano antes de que existiera el catálogo. Se
          muestra solo mientras este Asistente no tenga tipo, para que quien
          mira sepa qué decía la ficha y pueda elegir el que corresponde. */}
      {!form.tipo_asistente_id && (asistente.especialidades || []).length > 0 && (
        <p className="panel-explicacion">
          {t.asistentes.tipo_antes_decia}: {asistente.especialidades.join(', ')}
        </p>
      )}

      <FormField label={t.asistentes.col_zonas} name="zonas" value={form.zonas} onChange={(e) => set('zonas', e.target.value)} disabled={!puedeEditarIdentidad} />

      {asistente.estado === 'cesado' ? (
        <>
          <FormField label={t.asistentes.col_estado} name="estado" type="select" value="cesado" disabled>
            <option value="cesado">{t.asistentes.estado_cesado}</option>
          </FormField>
          <Alert variant="info">{t.asistentes.cese.ya_cesado}</Alert>
        </>
      ) : (
        <FormField label={t.asistentes.col_estado} name="estado" type="select" value={form.estado} onChange={(e) => set('estado', e.target.value)} disabled={!puedeEditarIdentidad}>
          <option value="activo">{t.asistentes.estado_activo}</option>
          <option value="inactivo">{t.asistentes.estado_inactivo}</option>
        </FormField>
      )}

      {esAdmin && (
        <>
          <h2>{t.asistentes.tabs.perfil_vinculo}</h2>
          <FormField label={t.asistentes.col_vinculo} name="tipo_vinculo" type="select" value={form.tipo_vinculo} onChange={(e) => set('tipo_vinculo', e.target.value)}>
            <option value="monotributo">{t.asistentes.vinculo_monotributo}</option>
            <option value="dependencia">{t.asistentes.vinculo_dependencia}</option>
          </FormField>

          {form.tipo_vinculo === 'dependencia' ? (
            <>
              <FormField label={t.asistentes.categoria_cct} name="categoria_cct" value={form.categoria_cct} onChange={(e) => set('categoria_cct', e.target.value)} />
              <FormField label={t.asistentes.sueldo_basico} name="sueldo_basico" type="number" value={form.sueldo_basico} onChange={(e) => set('sueldo_basico', e.target.value)} />
            </>
          ) : (
            <FormField label={t.asistentes.valor_hora} name="valor_hora" type="number" value={form.valor_hora} onChange={(e) => set('valor_hora', e.target.value)} />
          )}
          <FormField label={t.asistentes.horas_semanales} name="horas_semanales" type="number" value={form.horas_semanales} onChange={(e) => set('horas_semanales', e.target.value)} />

          <h2>{t.modalidades.etiqueta}</h2>
          <p className="panel-explicacion">{t.modalidades.ayuda}</p>
          {modalidadesPosibles.map((modalidad) => (
            <FormField
              key={modalidad}
              label={t.modalidades[modalidad]}
              name={`modalidad_${modalidad}`}
              type="checkbox"
              checked={form.modalidades.includes(modalidad)}
              onChange={() => alternarModalidad(modalidad)}
            />
          ))}
        </>
      )}

      <Button onClick={guardar} disabled={guardando || !puedeEditarIdentidad}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>

      {esAdmin && (
        <>
          {mensajeReenvio && <Alert variant={mensajeReenvio.tipo}>{mensajeReenvio.texto}</Alert>}
          <Button variant="secondary" onClick={reenviarInvitacion} disabled={reenviando}>
            {reenviando ? t.comun.reenviando_invitacion : t.comun.reenviar_invitacion}
          </Button>

          <h2>{t.asistentes.documentos.titulo}</h2>
          <Button variant="secondary" onClick={descargarCertificadoTrabajo}>
            {t.asistentes.documentos.certificado_trabajo}
          </Button>
          <Button variant="secondary" onClick={descargarCertificadoRemuneraciones}>
            {t.asistentes.documentos.certificado_remuneraciones}
          </Button>

          <DocumentosVencimiento asistenteId={asistente.id} />
        </>
      )}
    </div>
  );
}

// Catálogo configurable por prestadora (Configuración > Documentos de Asistentes) — reemplaza
// las 3 columnas fijas vencimiento_monotributo/art/seguro (ver docs/PENDIENTES.md #18 punto 1,
// supabase/migrations/).
function DocumentosVencimiento({ asistenteId }) {
  const { t } = useLocale();
  const prestadoraId = usePrestadoraActual();
  const [tipos, setTipos] = useState([]);
  const [valores, setValores] = useState({});
  const [documentoIds, setDocumentoIds] = useState({});
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardandoTipoId, setGuardandoTipoId] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const [{ data: tiposData, error: errorTipos }, { data: documentosData, error: errorDocumentos }] = await Promise.all([
      supabase.from('tipos_documento_asistente').select('id, nombre, requiere_vencimiento').eq('activo', true).order('nombre'),
      supabase.from('documentos_asistente').select('id, tipo_documento_id, fecha_vencimiento').eq('asistente_id', asistenteId),
    ]);
    if (errorTipos || errorDocumentos) {
      setError(t.comun.error_generico);
      setEstado('error');
      return;
    }
    setTipos(tiposData ?? []);
    const nuevosValores = {};
    const nuevosIds = {};
    for (const doc of documentosData ?? []) {
      nuevosValores[doc.tipo_documento_id] = doc.fecha_vencimiento || '';
      nuevosIds[doc.tipo_documento_id] = doc.id;
    }
    setValores(nuevosValores);
    setDocumentoIds(nuevosIds);
    setEstado('listo');
  }, [asistenteId, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function guardarDocumento(tipoId) {
    setGuardandoTipoId(tipoId);
    setError(null);
    const fecha = valores[tipoId] || null;
    const { error: errorGuardar } = await supabase
      .from('documentos_asistente')
      .upsert(
        { id: documentoIds[tipoId], asistente_id: asistenteId, tipo_documento_id: tipoId, fecha_vencimiento: fecha, prestadora_id: prestadoraId },
        { onConflict: 'asistente_id,tipo_documento_id' },
      );
    setGuardandoTipoId(null);
    if (errorGuardar) {
      setError(t.comun.error_generico);
      return;
    }
    recargar();
  }

  return (
    <>
      <h2>{t.asistentes.documentos.vencimientos_titulo}</h2>
      {error && <Alert variant="error">{error}</Alert>}
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && tipos.length === 0} recargar={recargar} mensajeVacio={t.asistentes.documentos.vencimientos_sin_tipos}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.asistentes.documentos.vencimientos_col_tipo}</th>
              <th>{t.asistentes.documentos.vencimientos_col_vencimiento}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tipos.map((tipo) => (
              <tr key={tipo.id}>
                <td>{tipo.nombre}</td>
                <td>
                  {tipo.requiere_vencimiento ? (
                    <input
                      type="date"
                      value={valores[tipo.id] || ''}
                      onChange={(e) => setValores((v) => ({ ...v, [tipo.id]: e.target.value }))}
                      aria-label={con(t.comun.campo_de_fila, { campo: t.asistentes.documentos.vencimientos_col_vencimiento, nombre: tipo.nombre })}
                    />
                  ) : '—'}
                </td>
                <td>
                  {tipo.requiere_vencimiento && (
                    <button onClick={() => guardarDocumento(tipo.id)} disabled={guardandoTipoId === tipo.id}>
                      {guardandoTipoId === tipo.id ? t.comun.guardando : t.comun.guardar}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </>
  );
}

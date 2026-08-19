import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { usePermisos } from '../../context/PermisosContext';
import { useEmpresa } from '../../context/EmpresaContext';
import { esAdminOSuperior } from '../../lib/roles';
import { nombreTipo } from '../../lib/tiposAsistente';
import { useTiposAsistente } from '../../hooks/useTiposAsistente';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { generarCertificadoTrabajo, generarCertificadoRemuneracionesServicios, descargarPDF } from '../../lib/generarDocumentoCese';

const API_URL = import.meta.env.VITE_API_URL;

export function PerfilTab({ asistente, onActualizado }) {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const { empresa } = useEmpresa();
  const esAdmin = esAdminOSuperior(usuario?.rol);
  const { puede } = usePermisos();
  const puedeEditarIdentidad = esAdmin || puede('editar_identidad_asistente');
  const { paraElegir: tiposAsistente, porId: tiposPorId } = useTiposAsistente();
  const [form, setForm] = useState({
    nombre: asistente.nombre || '',
    dni: asistente.dni || '',
    telefono: asistente.telefono || '',
    email: asistente.email || '',
    tipo_asistente_id: asistente.tipo_asistente_id || '',
    zonas: (asistente.zonas || []).join(', '),
    estado: asistente.estado,
    tipo_vinculo: asistente.tipo_vinculo,
    categoria_cct: asistente.categoria_cct || '',
    valor_hora: asistente.valor_hora || '',
    sueldo_basico: asistente.sueldo_basico || '',
    horas_semanales: asistente.horas_semanales || '',
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

  async function guardar() {
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
        tipo_vinculo: form.tipo_vinculo,
        horas_semanales: form.horas_semanales || null,
      }),
    };
    const { error: errorUpdate } = await supabase.from('asistentes').update(payload).eq('id', asistente.id);
    if (errorUpdate) {
      setGuardando(false);
      setError(t.comun.error_generico);
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
    descargarPDF(generarCertificadoRemuneracionesServicios({ asistente, nombreEmpresa: empresa?.nombre ?? '' }), `certificado-remuneraciones-${asistente.nombre}.pdf`);
  }

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}
      {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}

      <FormField label={t.asistentes.col_nombre} name="nombre" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} disabled={!puedeEditarIdentidad} />
      <FormField label={t.asistentes.dni} name="dni" value={form.dni} onChange={(e) => set('dni', e.target.value)} disabled={!puedeEditarIdentidad} />
      <FormField label={t.asistentes.telefono} name="telefono" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} disabled={!puedeEditarIdentidad} />
      <FormField label={t.asistentes.email} name="email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} disabled={!puedeEditarIdentidad} />

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
  const { usuario } = useAuth();
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
        { id: documentoIds[tipoId], asistente_id: asistenteId, tipo_documento_id: tipoId, fecha_vencimiento: fecha, prestadora_id: usuario?.prestadora_id },
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

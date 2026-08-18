import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { useConfirmarDestructivo } from '../context/TenantSessionContext';
import { useZonasCobertura } from '../hooks/useZonasCobertura';
import { useTiposAsistente } from '../hooks/useTiposAsistente';
import { esAdminOSuperior } from '../lib/roles';
import { nombreTipo } from '../lib/tiposAsistente';
import { traducirCodigos } from '../lib/postulacionCodigos';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Alert } from '../components/ui/Alert';
import { mensajeDeError, errorDeLaRespuesta } from '../lib/errores';

const ESTADOS = ['pendiente', 'en_revision', 'aprobado', 'rechazado'];
const API_URL = import.meta.env.VITE_API_URL;

export function PostulacionDetalle({ postulacion, onClose, onActualizada }) {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const confirmarDestructivo = useConfirmarDestructivo();
  const navigate = useNavigate();
  const { filas: zonas } = useZonasCobertura(usuario.prestadora_id);
  const zonasLabels = useMemo(
    () => Object.fromEntries(zonas.map((z) => [z.codigo, z.nombre])),
    [zonas],
  );
  const { paraElegir: tiposAsistente } = useTiposAsistente();
  const [nuevoEstado, setNuevoEstado] = useState(postulacion.estado);
  const [tipoAsistenteId, setTipoAsistenteId] = useState('');
  const [nota, setNota] = useState(postulacion.nota_interna || '');
  const [guardando, setGuardando] = useState(false);
  const [iniciandoVerificacion, setIniciandoVerificacion] = useState(false);
  const [error, setError] = useState(null);

  async function handleIniciarVerificacion() {
    const confirmado = await confirmarDestructivo(t.postulaciones.confirmar_iniciar_verificacion);
    if (!confirmado) return;

    setIniciandoVerificacion(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const respuesta = await fetch(`${API_URL}/api/panel/cuentas/asistente`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token}`,
        },
        body: JSON.stringify({ postulacionId: postulacion.id, tipo_asistente_id: tipoAsistenteId }),
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
      navigate(`/asistentes/${resultado.asistenteId}`);
    } catch (err) {
      setError(mensajeDeError(err, t));
      setIniciandoVerificacion(false);
    }
  }

  async function handleGuardar() {
    if (nuevoEstado !== postulacion.estado) {
      const confirmado = await confirmarDestructivo(t.postulaciones.confirmar_cambio_estado);
      if (!confirmado) return;
    }

    setGuardando(true);
    setError(null);

    const { error: errorUpdate } = await supabase
      .from('postulaciones')
      .update({ estado: nuevoEstado, nota_interna: nota })
      .eq('id', postulacion.id);

    if (errorUpdate) {
      setError(t.comun.error_generico);
      setGuardando(false);
      return;
    }

    if (nuevoEstado !== postulacion.estado && nuevoEstado !== 'pendiente') {
      try {
        const { data } = await supabase.auth.getSession();
        await fetch(`${API_URL}/api/panel/notificar/postulante`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${data.session?.access_token}`,
          },
          body: JSON.stringify({
            email: postulacion.email,
            nombre: postulacion.nombre,
            nuevoEstado,
            idioma: postulacion.idioma,
          }),
        });
      } catch {
        // el cambio de estado ya se guardó; el email es best-effort
      }
    }

    setGuardando(false);
    onActualizada();
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{postulacion.nombre}</h2>

        {error && <Alert variant="error">{error}</Alert>}

        <dl className="panel-detalle-lista">
          <dt>{t.postulaciones.dni}</dt>
          <dd>{postulacion.dni || '—'}</dd>
          <dt>{t.postulaciones.telefono}</dt>
          <dd>{postulacion.telefono}</dd>
          <dt>{t.postulaciones.email}</dt>
          <dd>{postulacion.email}</dd>
          <dt>{t.postulaciones.col_especialidades}</dt>
          <dd>{traducirCodigos(postulacion.especialidades, t.postulaciones.especialidades_labels)}</dd>
          <dt>{t.postulaciones.col_zonas}</dt>
          <dd>{traducirCodigos(postulacion.zonas, zonasLabels)}</dd>
          <dt>{t.postulaciones.disponibilidad}</dt>
          <dd>{traducirCodigos(postulacion.disponibilidad, t.postulaciones.disponibilidad_labels)}</dd>
          <dt>{t.postulaciones.anios_experiencia}</dt>
          <dd>{postulacion.anios_experiencia || '—'}</dd>
          <dt>{t.postulaciones.col_situacion_fiscal}</dt>
          <dd>{t.postulaciones.situacion_fiscal_labels[postulacion.situacion_fiscal] ?? postulacion.situacion_fiscal}</dd>
          <dt>{t.postulaciones.como_conocio}</dt>
          <dd>{postulacion.como_conocio || '—'}</dd>
          <dt>{t.postulaciones.mensaje}</dt>
          <dd>{postulacion.mensaje || '—'}</dd>
        </dl>

        <FormField label={t.postulaciones.col_estado} name="estado" type="select" value={nuevoEstado} onChange={(e) => setNuevoEstado(e.target.value)}>
          {ESTADOS.map((estado) => (
            <option key={estado} value={estado}>
              {t.postulaciones[`estado_${estado}`]}
            </option>
          ))}
        </FormField>

        <FormField
          label={t.comun.nota_interna}
          name="nota"
          type="textarea"
          placeholder={t.comun.nota_interna_placeholder}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />

        {esAdminOSuperior(usuario?.rol) && postulacion.estado === 'aprobado' && (
          postulacion.asistente_id ? (
            <p className="panel-explicacion">{t.postulaciones.ya_iniciada_verificacion}</p>
          ) : (
            <div>
              <p className="panel-explicacion">{t.postulaciones.iniciar_verificacion_explicacion}</p>

              {/* Qué va a ser esta persona en la Prestadora. Se elige acá, mirando la
                  postulación, y no se copia de lo que la persona escribió en el
                  formulario público: el tipo decide si se le va a exigir Matrícula
                  vigente para poder atender, así que es una decisión de quien aprueba. */}
              <FormField
                label={t.postulaciones.tipo_asistente}
                name="tipo_asistente_id"
                type="select"
                value={tipoAsistenteId}
                onChange={(e) => setTipoAsistenteId(e.target.value)}
              >
                <option value="">{t.postulaciones.tipo_asistente_elegir}</option>
                {tiposAsistente.map((tipo) => (
                  <option key={tipo.id} value={tipo.id}>{nombreTipo(tipo, t)}</option>
                ))}
              </FormField>

              <Button
                variant="secondary"
                onClick={handleIniciarVerificacion}
                disabled={iniciandoVerificacion || !tipoAsistenteId}
              >
                {iniciandoVerificacion ? t.comun.guardando : t.postulaciones.iniciar_verificacion}
              </Button>
            </div>
          )
        )}

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            {t.comun.cancelar}
          </Button>
          <Button onClick={handleGuardar} disabled={guardando}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

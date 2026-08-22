import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { obtenerUbicacion } from '../../lib/ubicacion';
import { useAuth } from '../../context/AuthContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { useMotivosAvisoPrevio } from '../../hooks/useMotivosAvisoPrevio';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { COBERTURA, claveTextoCobertura, coberturaDeGuardia } from '../../lib/cobertura';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';

export function GuardiaAcciones({ guardia, asistentes = [], onReasignar, onClose, onActualizada }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const { usuario } = useAuth();
  const prestadoraId = usePrestadoraActual();
  const confirmarDestructivo = useConfirmarDestructivo();
  const { filas: motivosAvisoPrevio } = useMotivosAvisoPrevio(prestadoraId);
  const [medioTransporte, setMedioTransporte] = useState('');
  const [cancelacionOrigen, setCancelacionOrigen] = useState('');
  const [cancelacionAlcance, setCancelacionAlcance] = useState('');
  const [avisoPrevioMotivo, setAvisoPrevioMotivo] = useState('');
  const [nuevoAsistenteId, setNuevoAsistenteId] = useState('');
  const [nuevaFecha, setNuevaFecha] = useState(guardia.fecha);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState(null);

  // Alternativa por teclado/botón a la reasignación por arrastre de GuardiasGrid.jsx
  // (WCAG 2.5.7 — el drag-and-drop nunca puede ser la única forma de reasignar).
  async function handleReasignarDesdeModal() {
    setError(null);
    setProcesando(true);
    try {
      await onReasignar(guardia.id, nuevoAsistenteId, nuevaFecha);
    } finally {
      setProcesando(false);
    }
    onClose();
  }

  async function actualizar(cambios) {
    setError(null);
    setProcesando(true);
    const { error: errorUpdate } = await supabase.from('guardias').update(cambios).eq('id', guardia.id);
    if (errorUpdate) {
      setProcesando(false);
      setError(mensajeDeError(errorUpdate, t));
      return;
    }
    // Se espera a que termine la recarga del listado antes de cerrar el modal,
    // para que la card ya muestre el estado nuevo en el momento en que
    // desaparece el detalle — sin esto quedaba una ventana donde el listado
    // todavía tenía los datos viejos hasta el próximo recargar manual.
    await onActualizada();
    setProcesando(false);
    onClose();
  }

  async function handleRegistrarSalida() {
    const { lat, lng } = await obtenerUbicacion();
    actualizar({ salida_checkin_at: new Date().toISOString(), salida_lat: lat, salida_lng: lng, medio_transporte: medioTransporte });
  }

  async function handleRegistrarLlegada() {
    const { lat, lng } = await obtenerUbicacion();
    actualizar({ checkin_at: new Date().toISOString(), checkin_lat: lat, checkin_lng: lng, estado: 'activa' });
  }

  async function handleRegistrarCheckout() {
    const { lat, lng } = await obtenerUbicacion();
    actualizar({ checkout_at: new Date().toISOString(), checkout_lat: lat, checkout_lng: lng, estado: 'completada' });
  }

  async function handleCancelar() {
    if (!(await confirmarDestructivo(t.guardias.detalle.confirmar_cancelar))) return;
    actualizar({ estado: 'cancelada', cancelacion_origen: cancelacionOrigen, cancelacion_alcance: cancelacionAlcance });
  }

  async function handleMarcarAusente() {
    if (!(await confirmarDestructivo(t.guardias.detalle.confirmar_ausente))) return;
    setError(null);
    setProcesando(true);

    const { error: errorUpdate } = await supabase.from('guardias').update({ estado: 'ausente' }).eq('id', guardia.id);
    if (errorUpdate) {
      setProcesando(false);
      setError(mensajeDeError(errorUpdate, t));
      return;
    }

    // Busca si había un Asistente de la prestadora cubriendo justo antes, el mismo día, para
    // este Paciente — si no hay ninguna, es el caso "Ausente sin relevo previo" del
    // glosario de CLAUDE.md (ej. primera guardia del día) y guardia_saliente_id queda NULL.
    const { data: candidatas } = await supabase
      .from('guardias')
      .select('id, hora_fin')
      .eq('paciente_id', guardia.paciente_id)
      .eq('fecha', guardia.fecha)
      .neq('estado', 'cancelada')
      .neq('id', guardia.id)
      .lte('hora_fin', guardia.hora_inicio)
      .order('hora_fin', { ascending: false })
      .limit(1);

    const { error: errorIncidente } = await supabase.from('incidentes_relevo').insert({
      prestadora_id: prestadoraId,
      guardia_saliente_id: candidatas?.[0]?.id ?? null,
      guardia_entrante_id: guardia.id,
      nivel_actual: 1,
    });
    if (errorIncidente) {
      setProcesando(false);
      setError(mensajeDeError(errorIncidente, t));
      return;
    }

    await onActualizada();
    setProcesando(false);
    onClose();
  }

  async function handleRegistrarAvisoPrevio() {
    if (!(await confirmarDestructivo(t.guardias.detalle.confirmar_aviso_previo))) return;
    setError(null);
    setProcesando(true);

    const { error: errorAlerta } = await supabase.from('alertas_tempranas_guardia').insert({
      prestadora_id: prestadoraId,
      guardia_id: guardia.id,
      fuente: 'aviso_telefonico',
      motivo: avisoPrevioMotivo,
      reportado_por: usuario.id,
    });
    if (errorAlerta) {
      setProcesando(false);
      setError(mensajeDeError(errorAlerta, t));
      return;
    }

    await onActualizada();
    setProcesando(false);
    onClose();
  }

  // Publicar la guardia como disponible para que un Asistente la tome, o dejar de ofrecerla.
  // Solo tiene sentido mientras no haya nadie asignado.
  function handlePublicar() {
    actualizar({ ofrecida_at: new Date().toISOString(), ofrecida_por: usuario.id });
  }

  function handleDespublicar() {
    actualizar({ ofrecida_at: null, ofrecida_por: null });
  }

  // La cobertura es una pregunta aparte del estado de la guardia: "¿hay alguien que la
  // haga?", no "¿en qué momento de su vida está?". Sale del punto único de verdad
  // (lib/cobertura.js) para que ninguna pantalla la vuelva a deducir por su cuenta.
  const cobertura = coberturaDeGuardia(guardia);
  const tieneAsistente = cobertura === COBERTURA.CUBIERTA;

  // Sin Asistente asignado no hay nada que registrar: nadie sale de su casa, nadie llega,
  // nadie se retira y nadie faltó. La base también lo impide, pero mostrar botones que van a
  // fallar es peor que no mostrarlos.
  const puedeRegistrarSalida = tieneAsistente && guardia.estado === 'programada' && !guardia.salida_checkin_at;
  const puedeRegistrarLlegada = tieneAsistente && guardia.estado === 'programada' && !guardia.checkin_at;
  const muestraCheckout = tieneAsistente && guardia.estado === 'activa' && !guardia.checkout_at;
  const puedeCancelar = guardia.estado === 'programada' || guardia.estado === 'activa';
  const puedeMarcarAusente = tieneAsistente && guardia.estado === 'programada';
  const puedeReasignar = guardia.estado === 'programada' || guardia.estado === 'ausente';
  const puedeOfrecer = !tieneAsistente && guardia.estado === 'programada';

  // Lo que ya quedó registrado no se esconde. Hasta acá, cuando la salida o la llegada ya
  // estaban marcadas, el bloque con su botón simplemente desaparecía, y la pantalla no
  // decía si el momento se había registrado o si nunca se había hecho: dos cosas muy
  // distintas que se veían igual. Ahora se listan los que tienen hora, con su hora.
  const momentosRegistrados = [
    { clave: 'salida_registrada', at: guardia.salida_checkin_at },
    { clave: 'llegada_registrada', at: guardia.checkin_at },
    { clave: 'checkout_registrado', at: guardia.checkout_at },
  ].filter((m) => m.at);

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.guardias.detalle.titulo}</h2>

        {error && <Alert variant="error">{error}</Alert>}

        <dl className="panel-detalle-lista">
          <dt>{t.guardias.detalle.fecha}</dt>
          <dd>{guardia.fecha}</dd>
          <dt>{t.guardias.detalle.horario}</dt>
          <dd>{guardia.hora_inicio} – {guardia.hora_fin}</dd>
          <dt>{t.guardias.detalle.asistente}</dt>
          <dd>{tieneAsistente ? guardia.asistente_nombre : t.guardias[claveTextoCobertura(guardia)]}</dd>
          <dt>{t.guardias.detalle.paciente}</dt>
          <dd>{guardia.paciente_nombre}</dd>
          <dt>{t.guardias.detalle.modalidad}</dt>
          <dd>{guardia.modalidad}</dd>
          <dt>{t.guardias.detalle.estado}</dt>
          <dd>{t.guardias[`estado_${guardia.estado}`]}</dd>
        </dl>

        {momentosRegistrados.length > 0 && (
          <ul className="panel-momentos-registrados">
            {momentosRegistrados.map(({ clave, at }) => (
              <li key={clave}>
                {t.guardias.detalle[clave]} · {new Date(at).toLocaleString()}
              </li>
            ))}
          </ul>
        )}

        {puedeOfrecer && (
          <div className="panel-resultado-calculo">
            {cobertura === COBERTURA.OFRECIDA ? (
              <>
                <p className="panel-explicacion">
                  {t.guardias.publicada_el.replace('{fecha}', new Date(guardia.ofrecida_at).toLocaleString())}
                </p>
                <Button variant="secondary" onClick={handleDespublicar} disabled={procesando}>
                  {t.guardias.despublicar}
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={handlePublicar} disabled={procesando}>
                {procesando ? t.guardias.publicando : t.guardias.publicar}
              </Button>
            )}
          </div>
        )}

        {puedeRegistrarSalida && (
          <div className="panel-resultado-calculo">
            <h3>{t.guardias.detalle.checkpoint_salida}</h3>
            <FormField
              label={t.guardias.detalle.medio_transporte}
              name="medio_transporte"
              placeholder={t.guardias.detalle.medio_transporte_placeholder}
              value={medioTransporte}
              onChange={(e) => setMedioTransporte(e.target.value)}
            />
            <Button variant="secondary" onClick={handleRegistrarSalida} disabled={procesando}>
              {t.guardias.detalle.registrar_salida}
            </Button>
          </div>
        )}

        {puedeRegistrarLlegada && (
          <div className="panel-resultado-calculo">
            <h3>{t.guardias.detalle.checkin_llegada}</h3>
            <Button variant="secondary" onClick={handleRegistrarLlegada} disabled={procesando}>
              {t.guardias.detalle.registrar_llegada}
            </Button>
          </div>
        )}

        {muestraCheckout && (
          <div className="panel-resultado-calculo">
            <h3>{t.guardias.detalle.checkout}</h3>
            {guardia.checkout_bloqueado ? (
              <Alert variant="error">{t.guardias.detalle.checkout_bloqueado_explicacion}</Alert>
            ) : (
              <Button variant="secondary" onClick={handleRegistrarCheckout} disabled={procesando}>
                {t.guardias.detalle.registrar_checkout}
              </Button>
            )}
          </div>
        )}

        {puedeCancelar && (
          <div className="panel-resultado-calculo">
            <h3>{t.guardias.detalle.cancelar_guardia}</h3>
            <FormField
              label={t.guardias.detalle.cancelacion_origen}
              name="cancelacion_origen"
              type="select"
              value={cancelacionOrigen}
              onChange={(e) => setCancelacionOrigen(e.target.value)}
            >
              <option value="">{t.guardias.nueva_guardia.elegir}</option>
              <option value="familia">{t.guardias.detalle.cancelacion_origen_familia}</option>
              <option value="prestadora">{t.guardias.detalle.cancelacion_origen_prestadora}</option>
            </FormField>
            <FormField
              label={t.guardias.detalle.cancelacion_alcance}
              name="cancelacion_alcance"
              type="select"
              value={cancelacionAlcance}
              onChange={(e) => setCancelacionAlcance(e.target.value)}
            >
              <option value="">{t.guardias.nueva_guardia.elegir}</option>
              <option value="parcial">{t.guardias.detalle.cancelacion_alcance_parcial}</option>
              <option value="total">{t.guardias.detalle.cancelacion_alcance_total}</option>
            </FormField>
            <Button
              variant="secondary"
              onClick={handleCancelar}
              disabled={procesando || !cancelacionOrigen || !cancelacionAlcance}
            >
              {t.guardias.detalle.cancelar_guardia}
            </Button>
          </div>
        )}

        {puedeMarcarAusente && (
          <div className="panel-resultado-calculo">
            <h3>{t.guardias.detalle.aviso_previo_titulo}</h3>
            <FormField
              label={t.guardias.detalle.aviso_previo_motivo}
              name="aviso_previo_motivo"
              type="select"
              value={avisoPrevioMotivo}
              onChange={(e) => setAvisoPrevioMotivo(e.target.value)}
            >
              <option value="">{t.guardias.nueva_guardia.elegir}</option>
              {motivosAvisoPrevio.filter((m) => m.activo).map((m) => (
                <option key={m.id} value={m.nombre}>{m.nombre}</option>
              ))}
            </FormField>
            <Button
              variant="secondary"
              onClick={handleRegistrarAvisoPrevio}
              disabled={procesando || !avisoPrevioMotivo}
            >
              {t.guardias.detalle.registrar_aviso_previo}
            </Button>
          </div>
        )}

        {puedeMarcarAusente && (
          <div className="panel-resultado-calculo">
            <Button variant="secondary" onClick={handleMarcarAusente} disabled={procesando}>
              {t.guardias.detalle.marcar_ausente}
            </Button>
          </div>
        )}

        {puedeReasignar && (
          <div className="panel-resultado-calculo">
            <h3>{t.guardias.detalle.reasignar_titulo}</h3>
            <FormField
              label={t.guardias.detalle.reasignar_asistente}
              name="reasignar_asistente"
              type="select"
              value={nuevoAsistenteId}
              onChange={(e) => setNuevoAsistenteId(e.target.value)}
            >
              <option value="">{t.guardias.nueva_guardia.elegir}</option>
              {asistentes.map((a) => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </FormField>
            <FormField
              label={t.guardias.detalle.reasignar_fecha}
              name="reasignar_fecha"
              type="date"
              value={nuevaFecha}
              onChange={(e) => setNuevaFecha(e.target.value)}
            />
            <Button
              variant="secondary"
              onClick={handleReasignarDesdeModal}
              disabled={procesando || !nuevoAsistenteId || !nuevaFecha}
            >
              {t.guardias.detalle.reasignar_confirmar}
            </Button>
          </div>
        )}

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={procesando}>
            {t.comun.cerrar}
          </Button>
        </div>
      </div>
    </div>
  );
}

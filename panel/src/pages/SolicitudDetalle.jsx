import { useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { useConfirmarDestructivo } from '../context/TenantSessionContext';
import { usePrestadoraActual } from '../hooks/usePrestadoraActual';
import { useMotivosDeResolucion } from '../hooks/useMotivosDeResolucion';
import { resolver } from '../lib/resoluciones';
import { esAdminOSuperior } from '../lib/roles';
import { linkWhatsapp } from '../lib/telefono';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Alert } from '../components/ui/Alert';
import { mensajeDeError, errorDeLaRespuesta } from '../lib/errores';
import { useModalAccesible } from '../hooks/useModalAccesible';
import { useCatalogoDeLugares } from '../hooks/useCatalogoDeLugares';
import { ElegirUnLugar } from '../components/lugares/ElegirUnLugar';
import { AsistentesSugeridos } from './solicitudes/AsistentesSugeridos';
import { NuevaGuardiaModal } from './guardias/NuevaGuardiaModal';

// Qué se resuelve en esta pantalla. Es el nombre guardado de la tabla, y con él salen los motivos
// del catálogo de la Prestadora y se escribe la resolución.
const TABLA = 'solicitudes';
// El estado en el que queda una Solicitud que ya tiene su Guardia armada. Es lo único que esta
// pantalla nombra de los estados, porque es el que ella misma resuelve sin preguntar; el motivo
// con el que se resuelve sale igual del catálogo.
const ESTADO_ASIGNADA = 'asignada';
const API_URL = import.meta.env.VITE_API_URL;

export function SolicitudDetalle({ solicitud, onClose, onActualizada }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const { usuario } = useAuth();
  const confirmarDestructivo = useConfirmarDestructivo();
  const prestadoraId = usePrestadoraActual();
  // Los motivos de esta Prestadora para resolver una Solicitud. En qué estado queda lo dice el
  // motivo elegido, así que acá no hay ninguna lista de estados escrita.
  const {
    filas: motivos,
    estado: estadoMotivos,
    error: errorMotivos,
    recargar: recargarMotivos,
  } = useMotivosDeResolucion(prestadoraId, TABLA);
  const [motivoId, setMotivoId] = useState('');
  const [detalle, setDetalle] = useState('');
  const motivoElegido = useMemo(
    () => motivos.find((motivo) => motivo.id === motivoId) ?? null,
    [motivos, motivoId],
  );
  // Con cuál se resuelve sola la Solicitud que acaba de quedar con su Guardia armada.
  const motivoDeAsignada = useMemo(
    // Uno que no pida escribir qué pasó: nadie va a estar ahí para escribirlo.
    () => motivos.find((motivo) => motivo.estado === ESTADO_ASIGNADA && !motivo.pide_detalle) ?? null,
    [motivos],
  );
  const [nota, setNota] = useState(solicitud.nota_interna || '');
  // Qué lugar de la lista es el que dijo quien llamó. Son dos cosas distintas y por eso se guardan
  // aparte: `localidad` es lo que se escuchó, y esto es lo que se entendió. Sin esto, la Familia
  // que nazca de esta Solicitud arranca sin localidad y no la encuentra ninguna búsqueda.
  const [lugar, setLugar] = useState(solicitud.lugar_id || '');
  const catalogo = useCatalogoDeLugares();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [convirtiendo, setConvirtiendo] = useState(false);
  const [errorConversion, setErrorConversion] = useState(null);
  // Qué Asistente y qué Pacientes se eligieron en la lista de sugeridos, mientras la ventana de
  // guardia nueva está abierta. En nulo, esa ventana no está.
  const [guardiaNueva, setGuardiaNueva] = useState(null);

  // Una Solicitud con una guardia asignada ya no es una Solicitud nueva ni en gestión, y que ese
  // estado lo tenga que mover alguien a mano es pedirle a una persona que copie lo que el sistema
  // acaba de ver. Queda resuelta con el motivo del catálogo que deja la Solicitud asignada, y la
  // firma es de quien armó la guardia. Si la resolución falla, la guardia quedó creada igual: se
  // avisa y la ventana no se cierra, para que se pueda resolver a mano ahí mismo.
  async function guardiaCreada() {
    setGuardiaNueva(null);
    if (solicitud.estado === ESTADO_ASIGNADA) {
      onActualizada();
      return;
    }

    if (!motivoDeAsignada) {
      setError(t.comun.error_generico);
      return;
    }

    const { error: errorResolucion } = await resolver({
      tabla: TABLA,
      filaId: solicitud.id,
      motivoId: motivoDeAsignada.id,
    });

    if (errorResolucion) {
      setError(mensajeDeError(errorResolucion, t));
      return;
    }

    onActualizada();
  }

  async function handleConvertirEnFamilia() {
    const confirmado = await confirmarDestructivo(t.solicitudes.confirmar_convertir_familia);
    if (!confirmado) return;

    setConvirtiendo(true);
    setErrorConversion(null);

    try {
      const { data } = await supabase.auth.getSession();
      const respuesta = await fetch(`${API_URL}/api/panel/cuentas/familia`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token}`,
        },
        body: JSON.stringify({ solicitudId: solicitud.id }),
      });
      const resultado = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
      onActualizada();
    } catch (err) {
      setErrorConversion(mensajeDeError(err, t));
    } finally {
      setConvirtiendo(false);
    }
  }

  async function handleGuardar() {
    // Resolver no es pisar el estado: es dejar escrito por qué se decidió y quién lo decidió. El
    // estado en el que queda sale del motivo, nunca de esta pantalla.
    const nuevoEstado = motivoElegido?.estado ?? null;
    const cambiaElEstado = Boolean(nuevoEstado) && nuevoEstado !== solicitud.estado;

    if (cambiaElEstado) {
      const confirmado = await confirmarDestructivo(t.solicitudes.confirmar_cambio_estado);
      if (!confirmado) return;
    }

    setGuardando(true);
    setError(null);

    if (motivoElegido) {
      const { error: errorResolucion } = await resolver({
        tabla: TABLA,
        filaId: solicitud.id,
        motivoId: motivoElegido.id,
        detalle: motivoElegido.pide_detalle ? detalle.trim() : null,
      });

      if (errorResolucion) {
        setError(mensajeDeError(errorResolucion, t));
        setGuardando(false);
        return;
      }
    }

    // Lo que se anotó y qué lugar se reconoció son otra cosa que la decisión, y se guardan aparte.
    const { error: errorUpdate } = await supabase
      .from('solicitudes')
      .update({ nota_interna: nota, lugar_id: lugar || null })
      .eq('id', solicitud.id);

    if (errorUpdate) {
      setError(mensajeDeError(errorUpdate, t));
      setGuardando(false);
      return;
    }

    setGuardando(false);
    onActualizada();
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{solicitud.nombre}</h2>

        {error && <Alert variant="error">{error}</Alert>}

        <dl className="panel-detalle-lista">
          <dt>{t.solicitudes.col_telefono}</dt>
          <dd>
            <a href={linkWhatsapp(solicitud.telefono)} target="_blank" rel="noreferrer">{solicitud.telefono}</a> ({t.solicitudes.llamar})
          </dd>
          <dt>{t.solicitudes.email}</dt>
          <dd>{solicitud.email}</dd>
          <dt>{t.solicitudes.nombre_paciente}</dt>
          <dd>{solicitud.nombre_paciente || '—'}</dd>
          <dt>{t.solicitudes.col_localidad}</dt>
          <dd>{solicitud.localidad}</dd>
          <dt>{t.solicitudes.col_tipo_servicio}</dt>
          <dd>{solicitud.tipo_servicio}</dd>
          <dt>{t.solicitudes.col_modalidad}</dt>
          <dd>{solicitud.modalidad}</dd>
          <dt>{t.solicitudes.dias_horario}</dt>
          <dd>{solicitud.dias_horario}</dd>
          <dt>{t.solicitudes.descripcion}</dt>
          <dd>{solicitud.descripcion || '—'}</dd>
          <dt>{t.solicitudes.col_estado}</dt>
          <dd>{t.solicitudes[`estado_${solicitud.estado || 'nueva'}`]}</dd>
        </dl>

        {/* Es una lista y nunca texto libre: la localidad ya tiene ficha en la Prestadora y lo que
            queda guardado es cuál, no cómo se llama. El texto de arriba no se pisa, porque es lo
            que dijo quien llamó y puede no coincidir con ninguna ficha. */}
        <ElegirUnLugar
          lugares={catalogo.lugares}
          zonas={catalogo.zonas}
          estado={catalogo.estado}
          valor={lugar}
          onChange={(elegido) => setLugar(elegido || '')}
          label={t.solicitudes.lugar_reconocido}
          name="lugar_reconocido"
          deshabilitado={guardando}
        />

        {/* Los cuatro estados de lo que carga datos: mientras la lista de motivos viene, se avisa;
            si falló, se ofrece volver a pedirla; si la Prestadora se quedó sin ninguno encendido,
            no hay nada que elegir. */}
        {estadoMotivos === 'cargando' && <p>{t.comun.cargando}</p>}
        {estadoMotivos === 'error' && (
          <Alert variant="error">
            {errorMotivos}{' '}
            <Button variant="secondary" onClick={recargarMotivos}>{t.comun.reintentar}</Button>
          </Alert>
        )}
        {estadoMotivos === 'vacio' && (
          <Alert variant="info">{t.comun.vacio}</Alert>
        )}

        <FormField
          label={t.comun.motivo}
          name="motivo"
          type="select"
          value={motivoId}
          onChange={(e) => {
            setMotivoId(e.target.value);
            setDetalle('');
          }}
          disabled={guardando || estadoMotivos !== 'listo'}
        >
          <option value="">{t.comun.motivo_elegir}</option>
          {motivos.map((motivo) => (
            <option key={motivo.id} value={motivo.id}>{motivo.nombre}</option>
          ))}
        </FormField>

        {motivoElegido?.pide_detalle && (
          <FormField
            label={t.comun.detalle}
            name="detalle"
            type="textarea"
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            disabled={guardando}
            required
          />
        )}

        <FormField
          label={t.comun.nota_interna}
          name="nota"
          type="textarea"
          placeholder={t.comun.nota_interna_placeholder}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />

        <AsistentesSugeridos solicitud={solicitud} onAsignar={setGuardiaNueva} />

        {esAdminOSuperior(usuario?.rol) && (
          <div className="panel-resultado-calculo">
            {solicitud.familia_id ? (
              <p>{t.solicitudes.ya_convertida_familia}</p>
            ) : (
              <>
                <p>{t.solicitudes.convertir_en_familia_explicacion}</p>
                {errorConversion && <Alert variant="error">{errorConversion}</Alert>}
                <Button variant="secondary" onClick={handleConvertirEnFamilia} disabled={convirtiendo}>
                  {convirtiendo ? t.comun.guardando : t.solicitudes.convertir_en_familia}
                </Button>
              </>
            )}
          </div>
        )}

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            {t.comun.cancelar}
          </Button>
          <Button
            onClick={handleGuardar}
            disabled={guardando || (motivoElegido?.pide_detalle && !detalle.trim())}
          >
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>

      {/* La misma ventana de guardia nueva que usa la pantalla de Guardias, con el Asistente y
          los Pacientes ya elegidos. La fecha y el horario se completan ahí, porque lo que la
          Familia dejó escrito en la Solicitud es una frase —"lunes y jueves a la mañana"— y no
          un turno. */}
      {guardiaNueva && (
        <NuevaGuardiaModal
          inicial={guardiaNueva}
          onClose={() => setGuardiaNueva(null)}
          onCreada={guardiaCreada}
        />
      )}
    </div>
  );
}

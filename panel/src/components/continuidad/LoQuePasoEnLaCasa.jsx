import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../ui/Button';
import { FormField } from '../ui/FormField';
import { Alert } from '../ui/Alert';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import {
  MEDIOS_POSIBLES,
  revisarConsentimiento,
  revisarFamiliarQueSeQuedo,
} from '../../lib/pacienteSolo';

/* LO QUE PASÓ EN LA CASA CUANDO NO FUE NADIE

   Dos hechos y ningún cierre. Ninguno de los dos botones de acá termina el expediente del turno,
   y ninguno lo cuenta como cubierto: la Prestadora no mandó a quien tenía que mandar, y contarlo
   como prestado sería taparle su propia falla y cobrarle a la Familia un servicio que prestó ella.
   Cómo terminó el turno se elige aparte, al cerrarlo.

   POR QUÉ LOS DOS JUNTOS Y NO UNO SOLO. Son dos cosas distintas —en una no hay nadie en la casa,
   en la otra sí— y un mismo turno puede tener las dos: la Familia aceptó que quedara solo un rato,
   y después igual se quedó alguien. Están juntos porque se cargan en el mismo momento y desde la
   misma pantalla, no porque sean lo mismo.

   EL CONSENTIMIENTO SE REGISTRA, NO SE PIDE. Acá no se le pregunta nada a nadie: se deja escrita
   una conversación que ya ocurrió, con quién se habló y hasta cuándo vale lo que aceptó. Por eso
   se pide el medio —después, si alguien lo discute, es lo único que permite reconstruirlo—.

   Y NO SALE NINGUNA ADVERTENCIA LEGAL. Si algún día hay que advertir algo sobre dejar sola a la
   persona atendida, el texto sale del documento legal de ese país y de ningún otro lado. Hoy
   ninguno lo dice, así que el producto registra el hecho y se calla. */

const TABLA_CONSENTIMIENTOS = 'consentimientos_paciente_solo';
const TABLA_FAMILIAR = 'excepciones_familiar_relevo';

/**
 * Los dos botones, para un turno.
 *
 * @param {object} props
 * @param {string} props.guardiaId El turno del que cuelgan los dos hechos.
 * @param {Array} [props.pacientes] Los Pacientes del turno, con `id` y `nombre`. Un turno puede
 *   atender a más de uno, y el consentimiento es de una persona: por eso se pasan todos y se
 *   elige adentro, en vez de quedarse con el primero sin decirlo.
 * @param {string} props.origen Por cuál de los tres caminos el turno se quedó sin nadie.
 * @param {string} [props.incidenteId] El expediente del que salió, cuando hubo uno.
 * @param {Function} [props.alRegistrar] Para que quien llama recargue lo suyo.
 */
export function LoQuePasoEnLaCasa({ guardiaId, pacientes = [], origen, incidenteId, alRegistrar }) {
  const { t } = useLocale();
  const [abriendo, setAbriendo] = useState(null);

  const cerrar = () => setAbriendo(null);
  const listo = () => { setAbriendo(null); alRegistrar?.(); };
  const conId = pacientes.filter((p) => p?.id);

  return (
    <>
      {/* El consentimiento necesita saber de qué persona se habló; sin ninguna el botón no se
          ofrece, porque guardarlo sin Paciente dejaría un registro que no se puede leer. */}
      {conId.length > 0 && (
        <Button variant="secondary" onClick={() => setAbriendo('consentimiento')}>
          {t.continuidad.paciente_solo_boton}
        </Button>
      )}
      <Button variant="secondary" onClick={() => setAbriendo('familiar')}>
        {t.continuidad.familiar_se_quedo_boton}
      </Button>

      {abriendo === 'consentimiento' && (
        <RegistrarConsentimiento
          guardiaId={guardiaId}
          pacientes={conId}
          onClose={cerrar}
          onGuardado={listo}
        />
      )}
      {abriendo === 'familiar' && (
        <RegistrarFamiliarQueSeQuedo
          guardiaId={guardiaId}
          origen={origen}
          incidenteId={incidenteId}
          onClose={cerrar}
          onGuardado={listo}
        />
      )}
    </>
  );
}

/** El primer momento que se propone es ahora, en el formato que entiende el campo de fecha y hora. */
function ahoraParaElCampo(desplazamientoEnHoras = 0) {
  const momento = new Date(Date.now() + desplazamientoEnHoras * 60 * 60 * 1000);
  // En hora local y no universal: quien lo carga escribe la hora de su reloj, no la de Londres.
  const conCero = (n) => String(n).padStart(2, '0');
  return `${momento.getFullYear()}-${conCero(momento.getMonth() + 1)}-${conCero(momento.getDate())}`
    + `T${conCero(momento.getHours())}:${conCero(momento.getMinutes())}`;
}

function RegistrarConsentimiento({ guardiaId, pacientes, onClose, onGuardado }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const { usuario } = useAuth();
  const prestadoraId = usePrestadoraActual();
  const [pacienteId, setPacienteId] = useState(pacientes[0].id);
  const [quien, setQuien] = useState('');
  const [medio, setMedio] = useState(MEDIOS_POSIBLES[0]);
  const [desde, setDesde] = useState(() => ahoraParaElCampo());
  const [hasta, setHasta] = useState(() => ahoraParaElCampo(8));
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const datos = {
    quien_consintio: quien,
    medio,
    desde_at: desde,
    hasta_at: hasta,
    nota,
  };
  const revision = revisarConsentimiento(datos);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const { error: errorInsert } = await supabase.from(TABLA_CONSENTIMIENTOS).insert({
        prestadora_id: prestadoraId,
        guardia_id: guardiaId,
        paciente_id: pacienteId,
        quien_consintio: quien.trim(),
        medio,
        desde_at: new Date(desde).toISOString(),
        hasta_at: new Date(hasta).toISOString(),
        registrado_por: usuario?.id ?? null,
        nota: nota.trim() || null,
      });
      if (errorInsert) throw errorInsert;
      onGuardado();
    } catch (e) {
      setError(mensajeDeError(e, t));
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h3 id={modal.idTitulo}>{t.continuidad.paciente_solo_titulo}</h3>
        <p className="panel-explicacion">{t.continuidad.paciente_solo_explicacion}</p>

        {/* Con un solo Paciente no se pregunta nada: no hay nada que elegir, y una lista de una
            opción es un paso de más. Con dos o más, se elige, porque la Familia de uno no puede
            aceptar nada por el otro. */}
        {pacientes.length > 1 && (
          <FormField
            label={t.continuidad.col_paciente}
            name="paciente-consentimiento"
            type="select"
            value={pacienteId}
            onChange={(e) => setPacienteId(e.target.value)}
          >
            {pacientes.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre || '—'}</option>
            ))}
          </FormField>
        )}

        <FormField
          label={t.continuidad.paciente_solo_quien}
          name="quien-consintio"
          value={quien}
          onChange={(e) => setQuien(e.target.value)}
          required
        />

        <FormField
          label={t.continuidad.paciente_solo_medio}
          name="medio"
          type="select"
          value={medio}
          onChange={(e) => setMedio(e.target.value)}
        >
          {MEDIOS_POSIBLES.map((cual) => (
            <option key={cual} value={cual}>{t.continuidad[`paciente_solo_medio_${cual}`]}</option>
          ))}
        </FormField>

        <FormField
          label={t.continuidad.paciente_solo_desde}
          name="desde"
          type="datetime-local"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          required
        />
        {/* El fin se pide igual que el comienzo, y no es un olvido que no sea optativo: un
            consentimiento sin fin no es un consentimiento, es una renuncia abierta, y la Familia
            nunca aceptó eso. */}
        <FormField
          label={t.continuidad.paciente_solo_hasta}
          name="hasta"
          type="datetime-local"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
          required
        />

        <FormField
          label={t.continuidad.paciente_solo_nota}
          name="nota-consentimiento"
          type="textarea"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />

        {!revision.ok && quien.trim() !== '' && (
          <Alert variant="error">{t.continuidad[`paciente_solo_falta_${revision.campo}`] ?? t.continuidad.paciente_solo_falta_desde_at}</Alert>
        )}
        {error && <Alert variant="error">{error}</Alert>}

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={guardar} disabled={guardando || !revision.ok}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RegistrarFamiliarQueSeQuedo({ guardiaId, origen, incidenteId, onClose, onGuardado }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const { usuario } = useAuth();
  const prestadoraId = usePrestadoraActual();
  const [nombre, setNombre] = useState('');
  const [desde, setDesde] = useState(() => ahoraParaElCampo());
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const revision = revisarFamiliarQueSeQuedo({
    familiar_nombre: nombre,
    origen,
    desde_at: desde,
    motivo,
  });

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const { error: errorInsert } = await supabase.from(TABLA_FAMILIAR).insert({
        prestadora_id: prestadoraId,
        guardia_id: guardiaId,
        origen,
        incidente_id: incidenteId ?? null,
        familiar_nombre: nombre.trim(),
        // Quien firma deja escrito el hecho. No autorizó nada: a un familiar no se le pide que
        // se quede, y una columna que dijera lo contrario mentiría sobre lo que pasó.
        registrado_por: usuario?.id ?? null,
        motivo: motivo.trim() || null,
        desde_at: new Date(desde).toISOString(),
      });
      if (errorInsert) throw errorInsert;
      onGuardado();
    } catch (e) {
      setError(mensajeDeError(e, t));
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h3 id={modal.idTitulo}>{t.continuidad.familiar_se_quedo_titulo}</h3>

        {/* Se dice antes de cargarlo, mientras todavía se puede elegir otra cosa. */}
        <Alert variant="error">{t.continuidad.resolver_familiar_es_defecto_grave}</Alert>

        <FormField
          label={t.continuidad.excepciones_col_familiar}
          name="familiar-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
        />
        <FormField
          label={t.continuidad.familiar_se_quedo_desde}
          name="familiar-desde"
          type="datetime-local"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          required
        />
        {/* Optativo, y a propósito: el familiar no tiene que justificar por qué se quedó en su
            propia casa. */}
        <FormField
          label={t.continuidad.resolver_familiar_motivo}
          name="familiar-motivo"
          type="textarea"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />

        {error && <Alert variant="error">{error}</Alert>}

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={guardar} disabled={guardando || !revision.ok}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

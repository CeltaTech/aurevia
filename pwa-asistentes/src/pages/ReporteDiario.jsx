import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { agregarACola, nuevoId } from '../lib/colaOffline';
import { sincronizarCola } from '../lib/sincronizarCola';
import { con } from '../lib/textos';
import { useSeVe } from '../context/PerfilContext';

function esErrorDeRed(error) {
  return error instanceof TypeError;
}

const ESTADOS_ANIMO = ['muy_bien', 'bien', 'regular', 'mal', 'muy_mal'];
const CARAS_ANIMO = { muy_bien: '😄', bien: '🙂', regular: '😐', mal: '🙁', muy_mal: '😣' };

const SIGNOS = ['presion_sistolica', 'presion_diastolica', 'temperatura', 'saturacion', 'glucemia'];

function parseNumero(texto) {
  if (texto === null || texto === undefined) return '';
  const match = String(texto).match(/-?\d+([.,]\d+)?/);
  return match ? match[0].replace(',', '.') : '';
}

function signosIniciales(signosIA) {
  const presionMatch = String(signosIA?.presion || '').match(/(\d+)\D+(\d+)/);
  return {
    presion_sistolica: presionMatch ? presionMatch[1] : '',
    presion_diastolica: presionMatch ? presionMatch[2] : '',
    temperatura: parseNumero(signosIA?.temperatura),
    saturacion: parseNumero(signosIA?.saturacion),
    glucemia: parseNumero(signosIA?.glucemia),
  };
}

function colorSigno(valor, rango) {
  if (!rango || valor === '' || valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (Number.isNaN(numero)) return null;
  return numero >= rango.min && numero <= rango.max ? 'normal' : 'alerta';
}

export default function ReporteDiario() {
  const { id, pacienteId } = useParams();
  const { t } = useLocale();
  const navigate = useNavigate();
  const seVe = useSeVe();

  // De quién habla este reporte. El nombre se muestra arriba de todo, siempre, aunque el turno
  // cubra a una sola persona: escribir la comida y la medicación en la hoja equivocada es un
  // daño que después nadie encuentra.
  const [paciente, setPaciente] = useState(null);

  const [textoLibre, setTextoLibre] = useState('');
  const [estructurando, setEstructurando] = useState(false);
  const [estructurado, setEstructurado] = useState(null);
  const [foto, setFoto] = useState(null);
  const [fotoUrl, setFotoUrl] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState('');
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [guardadoPendiente, setGuardadoPendiente] = useState(false);
  const [vitalesHabilitados, setVitalesHabilitados] = useState(false);
  const [rangosVitales, setRangosVitales] = useState({});
  const [enLinea, setEnLinea] = useState(navigator.onLine);

  // Las tres interruptores que tocan esta hoja. Se preguntan una sola vez y el mismo valor decide
  // las dos cosas: qué se dibuja y qué viaja al guardar. Un campo que no se pidió no puede
  // terminar en la historia de un Paciente porque quedó un dato viejo en la memoria de la
  // pantalla (CLAUDE.md §7 regla 12).
  const veElRelatoConIa = seVe('asistente_relato_con_ia');
  const veLaFoto = seVe('asistente_foto_en_el_reporte');
  // Los signos vitales piden las dos cosas: que la Prestadora los tome, y que estén
  // autorizados para esta persona en particular.
  const veLosSignos = seVe('asistente_signos_vitales') && vitalesHabilitados;

  useEffect(() => {
    const alConectar = () => setEnLinea(true);
    const alDesconectar = () => setEnLinea(false);
    window.addEventListener('online', alConectar);
    window.addEventListener('offline', alDesconectar);
    return () => {
      window.removeEventListener('online', alConectar);
      window.removeEventListener('offline', alDesconectar);
    };
  }, []);

  useEffect(() => {
    let activo = true;
    api
      .guardia(id)
      .then(({ guardia, vitalesPorPaciente }) => {
        if (!activo) return;
        setPaciente((guardia?.pacientes ?? []).find((p) => p.id === pacienteId) ?? null);
        // Los signos vitales son de una persona: la presión normal de la señora de la casa no es
        // la del marido, y la autorización de monitoreo puede estar firmada para una y no para
        // la otra. Por eso se toman los de este Paciente y no los del turno.
        const vitales = vitalesPorPaciente?.[pacienteId];
        setVitalesHabilitados(!!vitales?.habilitados);
        setRangosVitales(vitales?.rangos || {});
      })
      .catch(() => {});
    return () => {
      activo = false;
    };
  }, [id, pacienteId]);

  // Sin la ayuda para redactar no hay ningún relato que contar primero, así que la hoja abre
  // directamente con los campos en blanco. Es exactamente lo que hace hoy "Completar a mano"
  // cuando no hay señal: el camino ya existía, lo único que cambia es que acá es el único.
  useEffect(() => {
    if (!veElRelatoConIa && !estructurado) completarAMano();
  }, [veElRelatoConIa, estructurado]);

  async function alEstructurar() {
    setError('');
    setEstructurando(true);
    try {
      const { estructurado: data } = await api.estructurarReporte(id, textoLibre);
      setEstructurado({ ...data, signos_vitales: signosIniciales(data.signos_vitales) });
    } catch (e) {
      setError(t.comun.error_generico);
    } finally {
      setEstructurando(false);
    }
  }

  // Sin conexión (o si la IA falla), el Asistente completa los campos a mano en vez de
  // quedar bloqueado sin poder llegar a la pantalla de revisión/confirmación.
  function completarAMano() {
    setError('');
    setEstructurado({
      alimentacion: {},
      medicacion: [],
      signos_vitales: signosIniciales({}),
      estado_animo: null,
      incidentes: '',
      observaciones: '',
    });
  }

  function actualizarCampo(campo, valor) {
    setEstructurado((prev) => ({ ...prev, [campo]: valor }));
  }

  function actualizarAlimentacion(clave, valor) {
    setEstructurado((prev) => ({ ...prev, alimentacion: { ...prev.alimentacion, [clave]: valor } }));
  }

  function actualizarSignos(clave, valor) {
    setEstructurado((prev) => ({ ...prev, signos_vitales: { ...prev.signos_vitales, [clave]: valor } }));
  }

  async function alSubirFoto(evento) {
    const archivo = evento.target.files?.[0];
    if (!archivo) return;
    setFoto(archivo);
    try {
      const { fotoUrl: ruta } = await api.subirFotoReporte(id, archivo);
      setFotoUrl(ruta);
    } catch {
      setError(t.comun.error_generico);
    }
  }

  // El reporte ya no pide ubicación: desde que el cierre de guardia es un acto propio
  // (tarea 66a), los dos momentos que dejan constancia de dónde estuvo el Asistente son la
  // llegada y el retiro, y los dos la registran. Exigir el GPS también acá solo servía para
  // dejarlo sin poder mandar el reporte cuando el teléfono no consigue señal satelital.
  async function alConfirmar() {
    setError('');
    setConfirmando(true);
    try {
      const clienteUuid = nuevoId();
      const datos = {
        pacienteId,
        textoLibre: veElRelatoConIa ? textoLibre : null,
        alimentacion: estructurado.alimentacion,
        medicacion: estructurado.medicacion,
        signosVitales: veLosSignos ? estructurado.signos_vitales : null,
        estadoAnimo: estructurado.estado_animo,
        incidentes: estructurado.incidentes,
        observaciones: estructurado.observaciones,
        fotoUrl: veLaFoto ? fotoUrl : null,
        clienteUuid,
      };
      try {
        await api.confirmarReporte(id, datos);
        setGuardadoOk(true);
      } catch (e) {
        if (!esErrorDeRed(e)) throw e;
        // Sin señal: se guarda local y se reintenta solo al volver la conexión.
        await agregarACola({ id: clienteUuid, tipo: 'reporte', guardiaId: id, payload: datos });
        setGuardadoPendiente(true);
        sincronizarCola();
      }
      // Vuelve a la guardia, no a la lista: ahí está el botón de cerrarla, que es el paso
      // que sigue y el que antes ocurría solo, sin que el Asistente lo viera.
      setTimeout(() => navigate(`/guardias/${id}`), 1500);
    } catch {
      setError(t.comun.error_generico);
    } finally {
      setConfirmando(false);
    }
  }

  if (guardadoOk) return <div className="alert alert-info">{t.reporte.guardado_ok}</div>;
  if (guardadoPendiente) {
    return (
      <div className="alert alert-alerta" aria-label={t.reporte.guardado_pendiente}>
        <span aria-hidden="true">⏳</span> {t.reporte.guardado_pendiente}
      </div>
    );
  }

  return (
    <div>
      <Link to={`/guardias/${id}`} className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        <span aria-hidden="true">←</span> {t.comun.volver}
      </Link>
      <h1>{paciente ? con(t.reporte.titulo_de, { nombre: paciente.nombre }) : t.reporte.titulo}</h1>
      {error && <div className="alert alert-error">{error}</div>}

      {veElRelatoConIa && !estructurado && (
        <>
          <div className="form-field">
            <label htmlFor="texto-libre">{t.reporte.texto_libre_label}</label>
            <textarea
              id="texto-libre"
              value={textoLibre}
              onChange={(e) => setTextoLibre(e.target.value)}
              placeholder={t.reporte.texto_libre_placeholder}
              rows={6}
            />
          </div>
          <button className="btn btn-primary btn-full" onClick={alEstructurar} disabled={estructurando || !textoLibre.trim() || !enLinea}>
            {estructurando ? t.reporte.estructurando : t.reporte.estructurar}
          </button>
          {!enLinea && (
            <>
              <p className="guardia-card-detalle">{t.reporte.ia_requiere_conexion}</p>
              <button className="btn btn-secondary btn-full" onClick={completarAMano}>
                {t.reporte.completar_a_mano}
              </button>
            </>
          )}
        </>
      )}

      {estructurado && (
        <>
          {/* "Revisar y corregir" es el encabezado de lo que escribió la ayuda automática. Sin
              esa ayuda no hay nada escrito que revisar: los campos van en blanco y el título
              de la hoja, arriba, ya dice de qué se trata. */}
          {veElRelatoConIa && <h2>{t.reporte.revisar_titulo}</h2>}

          <div className="reporte-preview-campo">
            <label>{t.reporte.campo_alimentacion}</label>
            <textarea
              value={estructurado.alimentacion?.descripcion || ''}
              onChange={(e) => actualizarAlimentacion('descripcion', e.target.value)}
              rows={2}
            />
          </div>

          {veLosSignos && (
            <div className="reporte-preview-campo">
              <label>{t.reporte.campo_signos_vitales}</label>
              {SIGNOS.map((signo) => {
                const rango = rangosVitales[signo];
                const color = colorSigno(estructurado.signos_vitales?.[signo], rango);
                return (
                  <div key={signo} className={`signo-vital-fila${color ? ` signo-vital-${color}` : ''}`} style={{ marginBottom: '0.4rem' }}>
                    <label htmlFor={`signo-${signo}`}>
                      {t.reporte[`signo_${signo}`]} {rango ? `(${rango.unidad})` : ''}
                    </label>
                    <input
                      id={`signo-${signo}`}
                      type="number"
                      step="0.1"
                      value={estructurado.signos_vitales?.[signo] || ''}
                      onChange={(e) => actualizarSignos(signo, e.target.value)}
                      style={{ width: '100%' }}
                    />
                    {color === 'alerta' && <span className="signo-vital-aviso">{t.reporte.signo_fuera_de_rango}</span>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="reporte-preview-campo">
            <label>{t.reporte.campo_estado_animo}</label>
            <div className="escala-animo">
              {ESTADOS_ANIMO.map((estado) => (
                <button
                  key={estado}
                  type="button"
                  className={`escala-animo-opcion${estructurado.estado_animo === estado ? ' seleccionada' : ''}`}
                  onClick={() => actualizarCampo('estado_animo', estado)}
                  aria-pressed={estructurado.estado_animo === estado}
                  title={t.reporte[`animo_${estado}`]}
                >
                  <span aria-hidden="true">{CARAS_ANIMO[estado]}</span>
                  <span className="escala-animo-etiqueta">{t.reporte[`animo_${estado}`]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="reporte-preview-campo">
            <label>{t.reporte.campo_incidentes}</label>
            <textarea value={estructurado.incidentes || ''} onChange={(e) => actualizarCampo('incidentes', e.target.value)} rows={2} />
          </div>

          <div className="reporte-preview-campo">
            <label>{t.reporte.campo_observaciones}</label>
            <textarea value={estructurado.observaciones || ''} onChange={(e) => actualizarCampo('observaciones', e.target.value)} rows={3} />
          </div>

          {veLaFoto && (
            <div className="form-field">
              <label htmlFor="foto">{t.reporte.agregar_foto}</label>
              <input id="foto" type="file" accept="image/jpeg,image/png" onChange={alSubirFoto} disabled={!enLinea} />
              {!enLinea && <p className="guardia-card-detalle">{t.reporte.foto_requiere_conexion}</p>}
            </div>
          )}

          <button className="btn btn-exito btn-full" onClick={alConfirmar} disabled={confirmando}>
            {confirmando ? t.reporte.confirmando : t.reporte.confirmar}
          </button>
        </>
      )}
    </div>
  );
}

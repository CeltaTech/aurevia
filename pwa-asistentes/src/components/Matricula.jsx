import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { con } from '../lib/textos';
import { mensajeDeError } from '../lib/errores';

// ============================================================================
// Mi Matrícula, en el teléfono del Asistente.
//
// POR QUÉ ESTA PANTALLA EXISTE
// Sin Matrícula vigente, la base no deja que le asignen guardias. Si eso pasa
// y él no se entera, lo único que ve es que dejaron de llamarlo. La regla es
// que nunca se bloquea en silencio: el motivo va arriba de todo, con qué hacer
// para destrabarlo al lado.
//
// LO QUE ACÁ SE PUEDE Y LO QUE NO
// Se carga, y nada más. No se verifica, no se edita, no se borra. Verificar es
// de la Prestadora, y toda Matrícula que entra por acá queda esperando que
// alguien la mire aunque la Prestadora trabaje en modo flexible — si no fuera
// así, cualquiera podría escribir un número inventado y habilitarse solo.
//
// SI NO LE CORRESPONDE, NO APARECE
// Los tipos de Asistente que no requieren Matrícula no ven nada de esto. Un
// bloque que dice "no te aplica" es ruido en una pantalla que se mira desde un
// teléfono.
// ============================================================================

/** Sin fecha de vencimiento no hay nada que avisar: hay títulos que no caducan. */
function hayQueAvisar(dias, diasAviso) {
  if (dias === null || dias === undefined) return false;
  const ventana = Number(diasAviso) > 0 ? Number(diasAviso) : 30;
  return dias <= ventana;
}

export default function Matricula() {
  const { t, locale } = useLocale();
  const tm = t.matricula;

  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [formAbierto, setFormAbierto] = useState(false);
  const [aviso, setAviso] = useState('');

  const [numero, setNumero] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState('');

  async function cargar() {
    try {
      setDatos(await api.matricula());
    } catch {
      setError(t.comun.error_generico);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function guardar(evento) {
    evento.preventDefault();
    setErrorForm('');
    if (!desde) {
      setErrorForm(tm.falta_desde);
      return;
    }
    setGuardando(true);
    try {
      await api.cargarMatricula({
        numeroMatricula: numero,
        vigenteDesde: desde,
        vigenteHasta: hasta,
        archivo,
      });
      setNumero('');
      setDesde('');
      setHasta('');
      setArchivo(null);
      setFormAbierto(false);
      setAviso(tm.cargada);
      await cargar();
    } catch (err) {
      setErrorForm(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  // El enlace al archivo se pide en el momento y dura un minuto. La dirección
  // del depósito nunca queda escrita en la pantalla.
  async function verArchivo(ruta) {
    try {
      const { url } = await api.archivoDeMatricula(ruta);
      window.open(url, '_blank', 'noopener');
    } catch {
      setAviso(t.comun.error_generico);
    }
  }

  if (cargando) return <div className="estado-cargando">{t.comun.cargando}</div>;
  if (error) return <div className="alert alert-error">{error}</div>;

  const estado = datos?.estado;
  if (!estado || estado.requiere_matricula !== true) return null;

  const matriculas = datos.matriculas ?? [];
  const dias = estado.dias_para_vencer;

  // El cartel de arriba, en orden de gravedad: primero lo que la traba hoy,
  // después lo que la va a trabar pronto, y si no hay nada de eso, la
  // confirmación de que está todo bien. Una pantalla que solo habla cuando algo
  // anda mal deja a la persona sin saber si el silencio es bueno o es que no
  // cargó.
  let cartel = null;
  if (estado.motivo_bloqueo === 'sin_verificar') {
    cartel = { clase: 'alert', texto: tm.esperando_verificacion };
  } else if (estado.motivo_bloqueo) {
    cartel = {
      clase: 'alert alert-error',
      titulo: tm.bloqueo_titulo,
      texto: [tm[`bloqueo_${estado.motivo_bloqueo}`], tm[`que_hacer_${estado.motivo_bloqueo}`]]
        .filter(Boolean)
        .join(' '),
    };
  } else if (hayQueAvisar(dias, datos.diasAviso)) {
    let frase = con(tm.vence_en_dias, { dias });
    if (dias === 0) frase = tm.vence_hoy;
    else if (dias === 1) frase = tm.vence_manana;
    else if (dias < 0) frase = con(tm.vencio_hace_dias, { dias: -dias });
    cartel = { clase: 'alert alert-alerta', texto: `${frase} ${tm.renovar_a_tiempo}` };
  } else {
    cartel = { clase: 'alert alert-info', texto: tm.al_dia };
  }

  return (
    <div>
      <h2 style={{ marginTop: '2rem' }}>{tm.titulo}</h2>

      <div className={cartel.clase}>
        {cartel.titulo && (
          <>
            <strong>{cartel.titulo}</strong>{' '}
          </>
        )}
        {cartel.texto}
      </div>

      {aviso && <div className="alert alert-info">{aviso}</div>}

      {!formAbierto && (
        <button type="button" className="btn btn-primary" onClick={() => setFormAbierto(true)}>
          {tm.cargar}
        </button>
      )}

      {formAbierto && (
        <form onSubmit={guardar} className="tarjeta-consentimiento">
          {errorForm && <div className="alert alert-error">{errorForm}</div>}

          <label htmlFor="matricula-numero">{tm.numero}</label>
          <input
            id="matricula-numero"
            type="text"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
          />

          <label htmlFor="matricula-desde">{tm.vigente_desde}</label>
          <input
            id="matricula-desde"
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            required
          />

          <label htmlFor="matricula-hasta">{tm.vigente_hasta}</label>
          <input
            id="matricula-hasta"
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />

          <label htmlFor="matricula-archivo">{tm.archivo}</label>
          <input
            id="matricula-archivo"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          />

          <div className="consentimiento-acciones">
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? t.comun.guardando : t.comun.guardar}
            </button>
            <button
              type="button"
              className="btn"
              disabled={guardando}
              onClick={() => setFormAbierto(false)}
            >
              {t.comun.cancelar}
            </button>
          </div>
        </form>
      )}

      <h3 style={{ marginTop: '1.5rem' }}>{tm.lista_titulo}</h3>
      {matriculas.length === 0 ? (
        <p>{tm.sin_cargas}</p>
      ) : (
        <ul>
          {matriculas.map((m) => (
            <li key={m.id}>
              {m.numero_matricula || '—'} ·{' '}
              {m.vigente_hasta
                ? new Date(`${m.vigente_hasta}T00:00:00`).toLocaleDateString(locale)
                : tm.sin_vencimiento}{' '}
              · {m.verificada_at ? tm.verificada : tm.sin_verificar_aun}
              {m.archivo_url && (
                <>
                  {' · '}
                  <button type="button" className="btn" onClick={() => verArchivo(m.archivo_url)}>
                    {tm.ver_archivo}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="texto-ayuda">{tm.solo_carga}</p>
    </div>
  );
}

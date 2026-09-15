import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { con } from '../lib/textos';
import { mensajeDeError } from '../lib/errores';

// Las calificaciones que le pusieron a este Asistente, y el descargo que puede dejar ante cada
// una.
//
// POR QUÉ EXISTE ESTA PANTALLA. Una calificación no se corrige ni se borra: queda escrita, y
// algunas se ven en el perfil público. Lo único que equilibra eso es que la persona calificada
// pueda dejar su versión al lado, y que se lea junto con la otra. El motor y la base ya lo
// tenían resuelto; lo que faltaba era la pantalla desde donde se hace.
//
// EL DESCARGO SE ESCRIBE UNA SOLA VEZ. No es una decisión de esta pantalla: la policy
// `asistente_carga_su_descargo` sólo deja escribir mientras el campo está vacío, y el motor
// contesta 409 al segundo intento. Acá eso se convierte en dos cosas: el formulario desaparece
// en cuanto hay descargo, y antes de guardar se pregunta de nuevo, porque no va a haber una
// segunda oportunidad de decirlo mejor.

function Estrellas({ cantidad, t }) {
  // Las estrellas dibujadas no se leen en voz alta —cinco símbolos seguidos no dicen nada—, así
  // que al lado va la frase entera, que no se ve. Es el mismo patrón que el número de ofertas.
  return (
    <span className="guardia-card-paciente">
      <span aria-hidden="true">{'★'.repeat(cantidad)}{'☆'.repeat(Math.max(0, 5 - cantidad))}</span>
      <span className="solo-lectores-pantalla">{con(t.calificaciones.estrellas, { n: cantidad })}</span>
    </span>
  );
}

function Descargo({ calificacion, onGuardado, t, locale }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  if (calificacion.descargo_asistente) {
    return (
      <div className="calificacion-descargo">
        <h3>{t.calificaciones.descargo_titulo}</h3>
        <p>{calificacion.descargo_asistente}</p>
        {calificacion.descargo_en && (
          <p className="guardia-card-detalle">
            {con(t.calificaciones.descargo_en, {
              fecha: new Date(calificacion.descargo_en).toLocaleDateString(locale, { dateStyle: 'short' }),
            })}
          </p>
        )}
      </div>
    );
  }

  if (!abierto) {
    return (
      <div className="calificacion-descargo">
        <button type="button" className="btn btn-secondary" onClick={() => setAbierto(true)}>
          {t.calificaciones.abrir}
        </button>
      </div>
    );
  }

  async function guardar() {
    setGuardando(true);
    setError('');
    try {
      await api.cargarDescargo(calificacion.id, texto);
      // La lista se vuelve a pedir al motor en vez de dar por hecho lo que se acaba de mandar:
      // lo que se muestra de acá en más es lo que quedó guardado, no lo que se escribió.
      await onGuardado();
    } catch (e) {
      setError(mensajeDeError(e, t, 'cargar descargo'));
      setGuardando(false);
      setConfirmando(false);
    }
  }

  return (
    <div className="calificacion-descargo">
      <h3>{t.calificaciones.descargo_titulo}</h3>
      <p className="texto-ayuda">{t.calificaciones.una_sola_vez}</p>
      <div className="form-field">
        <label htmlFor={`descargo-${calificacion.id}`}>{t.calificaciones.campo}</label>
        <textarea
          id={`descargo-${calificacion.id}`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={2000}
          disabled={guardando}
        />
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {confirmando ? (
        <>
          <p className="texto-ayuda" role="status">{t.calificaciones.confirmar_aviso}</p>
          <div className="oferta-botones">
            <button type="button" className="btn btn-primary" disabled={guardando} onClick={guardar}>
              {guardando ? t.calificaciones.guardando : t.calificaciones.confirmar}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={guardando}
              onClick={() => setConfirmando(false)}
            >
              {t.comun.cancelar}
            </button>
          </div>
        </>
      ) : (
        <div className="oferta-botones">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!texto.trim()}
            onClick={() => setConfirmando(true)}
          >
            {t.comun.guardar}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setAbierto(false);
              setTexto('');
              setError('');
            }}
          >
            {t.comun.cancelar}
          </button>
        </div>
      )}
    </div>
  );
}

export default function MisCalificaciones() {
  const { t, locale } = useLocale();
  const [calificaciones, setCalificaciones] = useState(null);
  const [error, setError] = useState('');
  const [guardado, setGuardado] = useState(false);

  function cargar() {
    return api
      .calificaciones()
      .then(({ calificaciones: data }) => {
        setCalificaciones(data ?? []);
        setError('');
      })
      .catch((e) => setError(mensajeDeError(e, t, 'calificaciones')));
  }

  useEffect(() => {
    cargar();
  }, []);

  if (error && calificaciones === null) return <div className="alert alert-error" role="alert">{error}</div>;
  if (calificaciones === null) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  return (
    <div>
      <h1>{t.calificaciones.titulo}</h1>
      <p className="texto-ayuda">{t.calificaciones.explicacion}</p>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {guardado && <div className="alert alert-info" role="status">{t.calificaciones.guardado}</div>}

      {calificaciones.length === 0 ? (
        <div className="estado-vacio" role="status">{t.calificaciones.sin_calificaciones}</div>
      ) : (
        calificaciones.map((calificacion) => (
          <div key={calificacion.id} className="guardia-card">
            <Estrellas cantidad={Number(calificacion.estrellas) || 0} t={t} />
            <div className="guardia-card-detalle">
              {con(t.calificaciones.cuando, {
                fecha: new Date(calificacion.created_at).toLocaleDateString(locale, { dateStyle: 'short' }),
              })}
            </div>
            <p>{calificacion.comentario || t.calificaciones.sin_comentario}</p>
            {/* Que se vea o no en el perfil público cambia el peso de dejar un descargo, así
                que se dice antes de ofrecerlo, no después. */}
            <p className="guardia-card-detalle">
              {calificacion.visible_publica
                ? t.calificaciones.visible_publica
                : t.calificaciones.no_visible_publica}
            </p>
            <Descargo
              calificacion={calificacion}
              t={t}
              locale={locale}
              onGuardado={async () => {
                setGuardado(true);
                await cargar();
              }}
            />
          </div>
        ))
      )}
    </div>
  );
}

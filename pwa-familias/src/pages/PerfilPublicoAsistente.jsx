import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { nombreTipo } from '../lib/tipoDeAsistente';
import { diaEnPalabras } from '../lib/fechaEnPalabras';
import { mensajeDeError } from '../lib/errores';
import { formatearImporte } from '../lib/dinero';
import EstadoDocumental from '../components/EstadoDocumental';
import EnlaceAlMapa from '../components/EnlaceAlMapa';

// El perfil público de una persona de la vidriera, antes de contratarla.
//
// Es la misma persona que la Familia que ya contrató ve en «Asistente Asignado», y por eso el
// estado de los papeles lo dibuja el mismo componente: decir una cosa acá y otra allá sobre la
// misma carpeta de documentos sería inventar una verificación distinta según quién mire.
//
// LAS OPINIONES VAN SIN QUIÉN LAS ESCRIBIÓ. Quien calificó es una Familia, y su nombre no es
// parte de lo que se publica. El motor ya no lo manda; acá no habría de dónde sacarlo.
//
// CÓMO LLEGAR A LA PERSONA SE PIDE APARTE, Y CON SU PROPIO BOTÓN. Eso es lo que el Marketplace
// vende, así que verlo cuesta. Mirar este perfil no abre nada: la pantalla pregunta qué pasaría
// —con qué forma se cobra, cuánto sale, si termina el período de prueba— y lo muestra en una
// confirmación. Recién cuando alguien toca «sí» sale el pedido que cobra. Abrir un contacto no
// puede ser nunca el efecto de haber entrado a una pantalla.
//
// Y QUIEN NO MIRA LA PLATA NO VE NINGUNA DE ESAS FRASES. El motor le contesta si el contacto ya
// está abierto y nada más: cuánto sale y cuánto saldo queda es plata, y en el círculo familiar no
// la mira cualquiera.
export default function PerfilPublicoAsistente() {
  const { id } = useParams();
  const { t, locale } = useLocale();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [abriendo, setAbriendo] = useState(false);
  const navegar = useNavigate();

  // El contacto se carga aparte del perfil, y su error también se muestra aparte: que no se pueda
  // decir cuánto sale no es motivo para tapar el perfil entero.
  const [contacto, setContacto] = useState(null);
  const [errorContacto, setErrorContacto] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [viendoContacto, setViendoContacto] = useState(false);

  async function verElContacto() {
    if (viendoContacto) return;
    setViendoContacto(true);
    setErrorContacto('');
    try {
      const abierto = await api.verElContactoDelAsistente(id);
      setContacto({ ...abierto, activacion: null });
      setConfirmando(false);
    } catch (e) {
      setErrorContacto(mensajeDeError(e, t, 'Contacto del Asistente'));
    } finally {
      setViendoContacto(false);
    }
  }

  async function escribirle() {
    if (abriendo) return;
    setAbriendo(true);
    try {
      const { conversacion_id } = await api.abrirConversacionConAsistente(id);
      navegar(`/mensajes/${conversacion_id}`);
    } catch (e) {
      setError(mensajeDeError(e, t, 'Perfil público del Asistente'));
    } finally {
      setAbriendo(false);
    }
  }

  useEffect(() => {
    let activo = true;
    api
      .asistenteDelMarketplace(id)
      .then((data) => {
        if (activo) setDatos(data);
      })
      .catch((e) => {
        if (activo) setError(mensajeDeError(e, t, 'Perfil público del Asistente'));
      });

    // Preguntar no cobra nada: esta consulta no toca el saldo ni termina ningún período de
    // prueba. Lo único que cobra es el botón.
    api
      .comoEstaElContactoDelAsistente(id)
      .then((estado) => {
        if (activo) setContacto(estado);
      })
      .catch((e) => {
        if (activo) setErrorContacto(mensajeDeError(e, t, 'Contacto del Asistente'));
      });
    return () => {
      activo = false;
    };
  }, [id]);

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (datos === null) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;
  if (!datos.asistente) return <div className="estado-vacio" role="status">{t.comun.vacio}</div>;

  const { asistente, opiniones } = datos;
  const { verificacion, calificacion } = asistente;

  return (
    <div>
      <Link to="/buscar" className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        <span aria-hidden="true">←</span> {t.comun.volver}
      </Link>
      <h1>{asistente.nombre}</h1>
      {asistente.foto_url && (
        <img
          src={asistente.foto_url}
          alt={asistente.nombre}
          style={{ width: '100%', maxWidth: 200, borderRadius: '12px', marginBottom: '1rem' }}
        />
      )}
      {asistente.tipo && (
        <p className="guardia-card-detalle">
          {t.asistente.tipo}: {nombreTipo(asistente.tipo, t)}
        </p>
      )}
      {asistente.zonas.length > 0 && (
        <p className="guardia-card-detalle">
          {t.vidriera.zonas}: {asistente.zonas.join(', ')}
        </p>
      )}
      {asistente.antiguedad_meses !== null && (
        <p className="guardia-card-detalle">
          {t.vidriera.antiguedad.replace('{meses}', asistente.antiguedad_meses)}
        </p>
      )}

      {/* Escribirle es libre: lo que se cobra es el dato de contacto, y adentro del chat sale
          tapado hasta que esta Familia lo abra. El botón se apaga mientras el hilo se abre, y si
          ya existía uno con esta persona lleva a ese mismo: no hay dos hilos por pareja. */}
      <button type="button" className="btn btn-primary" onClick={escribirle} disabled={abriendo}>
        {abriendo ? t.comun.cargando : t.chat.escribirle}
      </button>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>{t.vidriera.contacto_titulo}</h2>

        {errorContacto && <div className="alert alert-error" role="alert">{errorContacto}</div>}
        {!errorContacto && contacto === null && (
          <div className="estado-cargando" role="status">{t.comun.cargando}</div>
        )}

        {contacto?.abierto && contacto.contacto && (
          <>
            {contacto.contacto.telefono && (
              <p className="guardia-card-detalle">
                {t.vidriera.contacto_telefono}: {contacto.contacto.telefono}
              </p>
            )}
            {contacto.contacto.email && (
              <p className="guardia-card-detalle">
                {t.vidriera.contacto_email}: {contacto.contacto.email}
              </p>
            )}
            {contacto.contacto.domicilio && (
              <p className="guardia-card-detalle">
                {t.vidriera.contacto_domicilio}:{' '}
                <EnlaceAlMapa lugar={{ domicilio: contacto.contacto.domicilio }} t={t} />
              </p>
            )}
            <p className="guardia-card-detalle">{t.vidriera.contacto_ya_abierto}</p>
          </>
        )}

        {/* El motivo por el que no se puede no es una falla: cada uno se resuelve de una manera
            distinta, y la frase lo dice. */}
        {contacto && !contacto.abierto && contacto.motivo && (
          <div className="estado-vacio" role="status">
            {t.errores.motivos[contacto.motivo] || t.vidriera.contacto_aparte}
          </div>
        )}

        {/* Quien no mira la plata llega hasta acá: sabe que el dato existe y que se pide aparte. */}
        {contacto && !contacto.abierto && !contacto.motivo && !contacto.activacion && (
          <p className="guardia-card-detalle">{t.vidriera.contacto_aparte}</p>
        )}

        {contacto && !contacto.abierto && contacto.activacion && !confirmando && (
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmando(true)}>
            {t.vidriera.contacto_ver}
          </button>
        )}

        {/* La confirmación dice qué se va a cobrar antes de cobrarlo, y nombra las cuatro cosas
            que cambian: con qué forma, cuánto, si se renueva sola y si termina la prueba. */}
        {contacto && !contacto.abierto && contacto.activacion && confirmando && (
          <div className="alert alert-info">
            <strong>{t.vidriera.contacto_confirmar_titulo}</strong>
            <p>
              {t.vidriera.contacto_confirmar_importe
                .replace('{forma}', contacto.activacion.forma)
                .replace('{importe}', formatearImporte(contacto.activacion.importe, contacto.activacion.moneda, locale))}
            </p>
            {contacto.activacion.renueva_sola && <p>{t.vidriera.contacto_confirmar_renueva}</p>}
            {contacto.activacion.termina_el_periodo_gratuito && (
              <p>{t.vidriera.contacto_confirmar_termina_gratis}</p>
            )}
            {contacto.activacion.saldo_contactos !== null && (
              <p>{t.vidriera.contacto_confirmar_saldo.replace('{n}', contacto.activacion.saldo_contactos)}</p>
            )}
            <button type="button" className="btn btn-primary" onClick={verElContacto} disabled={viendoContacto}>
              {viendoContacto ? t.comun.cargando : t.vidriera.contacto_confirmar_si}
            </button>{' '}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirmando(false)}
              disabled={viendoContacto}
            >
              {t.comun.cancelar}
            </button>
          </div>
        )}
      </section>

      {verificacion && (
        <EstadoDocumental
          resumen={verificacion.documentacion}
          matricula={verificacion.matricula}
          alDia={verificacion.papeles_al_dia}
          papelesExigidos={verificacion.papeles_exigidos}
          t={t}
        />
      )}

      <h2 style={{ marginTop: '1.5rem' }}>{t.vidriera.opiniones_titulo}</h2>
      {calificacion ? (
        <p className="guardia-card-detalle">
          {/* Las estrellas dibujadas no se leen: un lector de pantalla las nombraría una por
              una. Al lado va el mismo dato escrito, que no se ve pero sí se escucha. */}
          <span aria-hidden="true">
            {'★'.repeat(Math.round(calificacion.promedio))}
            {'☆'.repeat(Math.max(0, 5 - Math.round(calificacion.promedio)))}
          </span>{' '}
          {t.vidriera.calificacion_cuenta
            .replace('{promedio}', calificacion.promedio)
            .replace('{cuantas}', calificacion.cuantas)}
        </p>
      ) : (
        <p className="guardia-card-detalle">{t.vidriera.sin_calificaciones}</p>
      )}

      {opiniones.length === 0 ? (
        <div className="estado-vacio" role="status">{t.vidriera.sin_opiniones}</div>
      ) : (
        opiniones.map((o) => (
          <div key={o.id} className="guardia-card">
            <div className="guardia-card-paciente">
              <span aria-hidden="true">
                {'★'.repeat(o.estrellas)}
                {'☆'.repeat(Math.max(0, 5 - o.estrellas))}
              </span>
              <span className="solo-lectores-pantalla">
                {t.comun.puntaje_estrellas.replace('{n}', o.estrellas)}
              </span>
            </div>
            {o.comentario && <div className="guardia-card-detalle">{o.comentario}</div>}
            <div className="guardia-card-detalle">{diaEnPalabras(String(o.created_at).slice(0, 10), locale)}</div>
          </div>
        ))
      )}
    </div>
  );
}

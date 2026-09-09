// El código que se le muestra al Asistente cuando llega o cuando se va (pendiente #113).
//
// QUÉ REEMPLAZA. Antes había un cartel impreso pegado en el domicilio y el Asistente lo
// escaneaba. Un cartel es un secreto permanente a la vista de cualquiera que pase por la puerta:
// se fotografía una vez y sirve desde cualquier lado. Éste no: sale en la pantalla del teléfono de
// quien está en la casa y se renueva solo cada pocos segundos.
//
// LA PANTALLA ES CASI TODA EL COMPONENTE. `components/CodigoDePresencia.jsx` es el mismo archivo
// que usa la aplicación del Asistente —cuando el que se va es él y llega el relevo, es él quien
// muestra el código—, y ahí adentro están los cuatro estados y la renovación. Acá queda el título,
// la explicación de para qué sirve y el camino de vuelta.
//
// NO LLEVA GUARDIÁN, y es a propósito: el código no revela ningún dato del Paciente ni de la
// Prestadora, y su único efecto es dejar entrar a quien ya tenía la guardia asignada. Cualquiera
// del círculo familiar puede estar en la casa el día que toquen el timbre, así que cualquiera lo
// tiene que poder mostrar. El motor piensa igual: su dirección sólo pide tener sesión de Familia.

import { Link } from 'react-router-dom';
import CodigoDePresencia from '../components/CodigoDePresencia';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';

export default function CodigoParaElAsistente() {
  const { t } = useLocale();

  return (
    <div>
      <Link to="/pacientes" className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        <span aria-hidden="true">←</span> {t.comun.volver}
      </Link>
      <h1>{t.codigo_para_el_asistente.titulo}</h1>
      <p className="guardia-card-detalle" style={{ marginBottom: '1rem' }}>
        {t.codigo_para_el_asistente.para_que_sirve}
      </p>
      <CodigoDePresencia t={t} pedirCodigo={api.codigoDePresencia} />
      <p className="guardia-card-detalle" style={{ marginTop: '1rem' }}>
        {t.codigo_para_el_asistente.si_no_pueden_mostrarlo}
      </p>
    </div>
  );
}

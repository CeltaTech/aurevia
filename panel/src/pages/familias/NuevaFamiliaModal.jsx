import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';

const API_URL = import.meta.env.VITE_API_URL;

export function NuevaFamiliaModal({ onClose, onCreada }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const [nombreContacto, setNombreContacto] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [localidad, setLocalidad] = useState('');
  const [nombrePaciente, setNombrePaciente] = useState('');
  const [domicilioPaciente, setDomicilioPaciente] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const { data } = await supabase.auth.getSession();
      const respuesta = await fetch(`${API_URL}/api/panel/cuentas/familia-directa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token}`,
        },
        body: JSON.stringify({ nombreContacto, telefono, email, localidad, nombrePaciente, domicilioPaciente }),
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) {
        throw new Error(resultado.error || t.comun.error_generico);
      }
      onCreada();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.familias.nueva.titulo}</h2>

        {error && <Alert variant="error">{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <FormField label={t.familias.col_nombre} name="nombreContacto" required value={nombreContacto} onChange={(e) => setNombreContacto(e.target.value)} />
          <FormField label={t.familias.col_telefono} name="telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          <FormField label={t.familias.col_email} name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <FormField label={t.familias.col_localidad} name="localidad" value={localidad} onChange={(e) => setLocalidad(e.target.value)} />
          <FormField label={t.familias.nueva.nombre_paciente} name="nombrePaciente" required value={nombrePaciente} onChange={(e) => setNombrePaciente(e.target.value)} />
          <FormField label={t.familias.nueva.domicilio_paciente} name="domicilioPaciente" value={domicilioPaciente} onChange={(e) => setDomicilioPaciente(e.target.value)} />

          <div className="panel-modal-acciones">
            <Button variant="secondary" type="button" onClick={onClose} disabled={guardando}>
              {t.comun.cancelar}
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? t.familias.nueva.creando : t.familias.nueva.crear}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';

const API_URL = import.meta.env.VITE_API_URL;

export function NuevoAsistenteModal({ onClose, onCreado }) {
  const { t } = useLocale();
  const [nombre, setNombre] = useState('');
  const [dni, setDni] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [especialidades, setEspecialidades] = useState('');
  const [zonas, setZonas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const { data } = await supabase.auth.getSession();
      const respuesta = await fetch(`${API_URL}/api/panel/cuentas/asistente-directo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token}`,
        },
        body: JSON.stringify({
          nombre,
          dni,
          telefono,
          email,
          especialidades: especialidades.split(',').map((s) => s.trim()).filter(Boolean),
          zonas: zonas.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) {
        throw new Error(resultado.error || t.comun.error_generico);
      }
      onCreado();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.asistentes.nuevo.titulo}</h2>

        {error && <Alert variant="error">{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <FormField label={t.asistentes.col_nombre} name="nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <FormField label={t.asistentes.dni} name="dni" value={dni} onChange={(e) => setDni(e.target.value)} />
          <FormField label={t.asistentes.telefono} name="telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          <FormField label={t.asistentes.email} name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <FormField label={t.asistentes.col_especialidades} name="especialidades" value={especialidades} onChange={(e) => setEspecialidades(e.target.value)} />
          <FormField label={t.asistentes.col_zonas} name="zonas" value={zonas} onChange={(e) => setZonas(e.target.value)} />
          <p className="panel-explicacion">{t.asistentes.nuevo.ayuda_estado}</p>

          <div className="panel-modal-acciones">
            <Button variant="secondary" type="button" onClick={onClose} disabled={guardando}>
              {t.comun.cancelar}
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? t.asistentes.nuevo.creando : t.asistentes.nuevo.crear}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { useModalidades } from '../../context/ModalidadesContext';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError, errorDeLaRespuesta } from '../../lib/errores';
import { canalesHabilitados, mensajeDeCanal } from '../../lib/canales';
import { nombreTipo } from '../../lib/tiposAsistente';
import { useTiposAsistente } from '../../hooks/useTiposAsistente';

const API_URL = import.meta.env.VITE_API_URL;

export function NuevoAsistenteModal({ onClose, onCreado }) {
  const { t } = useLocale();
  const [nombre, setNombre] = useState('');
  const [dni, setDni] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [tipoAsistenteId, setTipoAsistenteId] = useState('');
  const [zonas, setZonas] = useState('');
  const { paraElegir: tiposAsistente } = useTiposAsistente();
  const { modalidades } = useModalidades();

  /* Las formas de recibir trabajo que la Prestadora tiene activas. Arrancan todas marcadas:
     es lo mismo que haría la base si el alta no dijera nada, y así queda a la vista antes de
     crear a la persona, en vez de descubrirlo después en la ficha. */
  const canalesPosibles = useMemo(() => canalesHabilitados(modalidades), [modalidades]);
  const [canales, setCanales] = useState(null);
  const canalesMarcados = canales ?? canalesPosibles;

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  function alternarCanal(canal) {
    setCanales(
      canalesMarcados.includes(canal)
        ? canalesMarcados.filter((c) => c !== canal)
        : [...canalesMarcados, canal],
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (canalesMarcados.length === 0) {
      setError(t.canales.falta_elegir);
      return;
    }
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
          tipo_asistente_id: tipoAsistenteId || null,
          zonas: zonas.split(',').map((s) => s.trim()).filter(Boolean),
          canales: canalesMarcados,
        }),
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) {
        throw errorDeLaRespuesta(respuesta, resultado);
      }
      onCreado();
    } catch (err) {
      setError(mensajeDeCanal(err, t.canales) ?? mensajeDeError(err, t));
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
          <FormField label={t.asistentes.col_tipo} name="tipo_asistente_id" type="select" value={tipoAsistenteId} onChange={(e) => setTipoAsistenteId(e.target.value)}>
            <option value="">{t.asistentes.tipo_sin_asignar}</option>
            {tiposAsistente.map((tipo) => (
              <option key={tipo.id} value={tipo.id}>{nombreTipo(tipo, t)}</option>
            ))}
          </FormField>
          <FormField label={t.asistentes.col_zonas} name="zonas" value={zonas} onChange={(e) => setZonas(e.target.value)} />

          <h3>{t.canales.etiqueta}</h3>
          <p className="panel-explicacion">{t.canales.ayuda}</p>
          {canalesPosibles.map((canal) => (
            <FormField
              key={canal}
              label={t.canales[canal]}
              name={`canal_${canal}`}
              type="checkbox"
              checked={canalesMarcados.includes(canal)}
              onChange={() => alternarCanal(canal)}
            />
          ))}

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

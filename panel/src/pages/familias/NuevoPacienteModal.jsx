import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { useModalAccesible } from '../../hooks/useModalAccesible';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import { CamposDeDomicilio } from '../../components/domicilio/CamposDeDomicilio';
import { DOMICILIO_VACIO, partesParaGuardar } from '../../lib/partesDeDomicilio';

export function NuevoPacienteModal({ familiaId, onClose, onCreado }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const prestadoraId = usePrestadoraActual();
  const [nombre, setNombre] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [domicilio, setDomicilio] = useState(DOMICILIO_VACIO);
  const [nivelComplejidad, setNivelComplejidad] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    const { error: errorInsert } = await supabase.from('pacientes').insert({
      familia_id: familiaId,
      nombre,
      fecha_nacimiento: fechaNacimiento || null,
      ...partesParaGuardar(domicilio),
      nivel_complejidad: nivelComplejidad || null,
      prestadora_id: prestadoraId,
    });
    setGuardando(false);
    if (errorInsert) {
      setError(t.comun.error_generico);
      return;
    }
    onCreado();
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.familias.agregar_paciente}</h2>

        {error && <Alert variant="error">{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <FormField label={t.familias.col_nombre} name="nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <FormField label={t.familias.fecha_nacimiento} name="fecha_nacimiento" type="date" value={fechaNacimiento} onChange={(e) => setFechaNacimiento(e.target.value)} />
          <CamposDeDomicilio valor={domicilio} alCambiar={setDomicilio} deshabilitado={guardando} />
          <FormField label={t.familias.nivel_complejidad} name="nivel_complejidad" type="select" value={nivelComplejidad} onChange={(e) => setNivelComplejidad(e.target.value)}>
            <option value="">{t.comun.todos}</option>
            <option value="I">I</option>
            <option value="II">II</option>
            <option value="III">III</option>
          </FormField>

          <div className="panel-modal-acciones">
            <Button variant="secondary" type="button" onClick={onClose} disabled={guardando}>
              {t.comun.cancelar}
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? t.comun.guardando : t.comun.guardar}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

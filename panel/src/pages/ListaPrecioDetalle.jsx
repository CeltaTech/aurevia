import { useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useConfirmarDestructivo } from '../context/TenantSessionContext';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Alert } from '../components/ui/Alert';
import { useModalAccesible } from '../hooks/useModalAccesible';
import { usePrestadoraActual } from '../hooks/usePrestadoraActual';

export function ListaPrecioDetalle({ precio, soloLectura, onClose, onActualizada }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const prestadoraId = usePrestadoraActual();
  const confirmarDestructivo = useConfirmarDestructivo();
  const esNuevo = !precio;
  const [tipoServicio, setTipoServicio] = useState(precio?.tipo_servicio || '');
  const [modalidad, setModalidad] = useState(precio?.modalidad || '');
  const [valorPrecio, setValorPrecio] = useState(precio?.precio ?? '');
  const [vigenteDesde, setVigenteDesde] = useState(precio?.vigente_desde || new Date().toISOString().slice(0, 10));
  const [activo, setActivo] = useState(precio?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleGuardar() {
    if (!esNuevo && Number(valorPrecio) !== Number(precio.precio)) {
      const confirmado = await confirmarDestructivo(t.lista_precios.confirmar_cambio_precio);
      if (!confirmado) return;
    }

    setGuardando(true);
    setError(null);

    const datos = {
      tipo_servicio: tipoServicio,
      modalidad,
      precio: Number(valorPrecio),
      vigente_desde: vigenteDesde,
      activo,
    };

    const { error: errorGuardado } = esNuevo
      ? await supabase.from('lista_precios').insert({ ...datos, prestadora_id: prestadoraId })
      : await supabase.from('lista_precios').update(datos).eq('id', precio.id);

    if (errorGuardado) {
      setError(t.comun.error_generico);
      setGuardando(false);
      return;
    }

    setGuardando(false);
    onActualizada();
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{esNuevo ? t.lista_precios.nuevo : `${precio.tipo_servicio} — ${precio.modalidad}`}</h2>

        {error && <Alert variant="error">{error}</Alert>}

        {!esNuevo && (
          <Alert variant="info">{t.lista_precios.aviso_prestaciones_vinculadas}</Alert>
        )}

        <FormField
          label={t.lista_precios.col_tipo_servicio}
          name="tipo_servicio"
          value={tipoServicio}
          onChange={(e) => setTipoServicio(e.target.value)}
          disabled={soloLectura}
          required
        />

        <FormField
          label={t.lista_precios.col_modalidad}
          name="modalidad"
          value={modalidad}
          onChange={(e) => setModalidad(e.target.value)}
          disabled={soloLectura}
          required
        />

        <FormField
          label={t.lista_precios.col_precio}
          name="precio"
          type="number"
          step="0.01"
          value={valorPrecio}
          onChange={(e) => setValorPrecio(e.target.value)}
          disabled={soloLectura}
          required
        />

        <FormField
          label={t.lista_precios.col_vigente_desde}
          name="vigente_desde"
          type="date"
          value={vigenteDesde}
          onChange={(e) => setVigenteDesde(e.target.value)}
          disabled={soloLectura}
          required
        />

        <FormField
          label={t.lista_precios.col_activo}
          name="activo"
          type="checkbox"
          checked={activo}
          onChange={(e) => setActivo(e.target.checked)}
          disabled={soloLectura}
        />

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            {soloLectura ? t.comun.cerrar : t.comun.cancelar}
          </Button>
          {!soloLectura && (
            <Button onClick={handleGuardar} disabled={guardando}>
              {guardando ? t.comun.guardando : t.comun.guardar}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

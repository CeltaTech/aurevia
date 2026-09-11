import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiMarketplace } from '../../lib/apiMarketplace';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';
import { useMonedaActual } from '../../hooks/useMonedaActual';

/* Las piezas de una forma de cobro, para cargarlas o cambiarlas.
   ==========================================================================

   No hay una lista de formas para elegir: la forma sale de cómo se combinen estas piezas. Una
   mensualidad es un importe con período de un mes que se renueva sola; un paquete de contactos es
   un importe con saldo y sin período. Por eso este formulario no pregunta «qué tipo es»: pregunta
   las piezas, y la combinación es la decisión comercial de la Prestadora.

   La moneda no se elige. Es la de la Prestadora y la completa la base al guardar; se muestra al
   lado del importe porque un número de dinero sin moneda a la vista no se puede leer. */
export function FormaDeCobroDetalle({ forma, unidades, soloLectura, onClose, onGuardada }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const monedaDeLaPrestadora = useMonedaActual();
  const moneda = forma?.moneda ?? monedaDeLaPrestadora;
  const esNueva = !forma;

  const [nombre, setNombre] = useState(forma?.nombre || '');
  const [importe, setImporte] = useState(forma?.importe ?? '');
  const [periodoCantidad, setPeriodoCantidad] = useState(forma?.periodo_cantidad ?? '');
  const [periodoUnidad, setPeriodoUnidad] = useState(forma?.periodo_unidad || '');
  const [diasGratis, setDiasGratis] = useState(forma?.dias_gratis ?? '');
  const [contactos, setContactos] = useState(forma?.contactos_incluidos ?? '');
  const [renuevaSola, setRenuevaSola] = useState(forma?.renueva_sola ?? false);
  const [ofrecida, setOfrecida] = useState(forma?.ofrecida ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  // Un campo vacío es «no tiene», no cero. Mandarlo como texto vacío haría que el motor lo
  // rechace por no ser un entero, cuando lo que la persona quiso decir es que ahí no hay nada.
  const vacioEsNulo = (valor) => (valor === '' || valor === null ? null : valor);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const cuerpo = {
      nombre,
      importe,
      periodo_cantidad: vacioEsNulo(periodoCantidad),
      periodo_unidad: periodoUnidad || null,
      dias_gratis: vacioEsNulo(diasGratis),
      contactos_incluidos: vacioEsNulo(contactos),
      renueva_sola: renuevaSola,
      ofrecida,
    };
    try {
      await llamarApiMarketplace(esNueva ? '/formas-de-cobro' : `/formas-de-cobro/${forma.id}`, {
        method: esNueva ? 'POST' : 'PATCH',
        body: JSON.stringify(cuerpo),
      });
      onGuardada();
    } catch (err) {
      setError(mensajeDeError(err, t));
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{esNueva ? t.marketplace.formas_nueva : forma.nombre}</h2>

        {error && <Alert variant="error">{error}</Alert>}

        <FormField
          label={t.marketplace.forma_nombre}
          name="nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          disabled={soloLectura}
          required
        />

        <FormField
          label={moneda ? `${t.marketplace.forma_importe} (${moneda})` : t.marketplace.forma_importe}
          name="importe"
          type="number"
          step="0.01"
          value={importe}
          onChange={(e) => setImporte(e.target.value)}
          disabled={soloLectura}
          required
        />

        <p className="panel-explicacion">{t.marketplace.forma_periodo_explicacion}</p>

        <FormField
          label={t.marketplace.forma_periodo_cantidad}
          name="periodo_cantidad"
          type="number"
          value={periodoCantidad}
          onChange={(e) => setPeriodoCantidad(e.target.value)}
          disabled={soloLectura}
        />

        <FormField
          label={t.marketplace.forma_periodo_unidad}
          name="periodo_unidad"
          type="select"
          value={periodoUnidad}
          onChange={(e) => setPeriodoUnidad(e.target.value)}
          disabled={soloLectura}
        >
          <option value="">{t.marketplace.forma_periodo_sin_unidad}</option>
          {/* Las unidades vienen del motor, que las lee del catálogo de la base: acá no hay
              ninguna lista escrita a mano. */}
          {unidades.map((unidad) => (
            <option key={unidad} value={unidad}>
              {t.marketplace[`periodo_${unidad}`] || unidad}
            </option>
          ))}
        </FormField>

        <FormField
          label={t.marketplace.forma_dias_gratis}
          name="dias_gratis"
          type="number"
          value={diasGratis}
          onChange={(e) => setDiasGratis(e.target.value)}
          disabled={soloLectura}
        />

        <FormField
          label={t.marketplace.forma_contactos_incluidos}
          name="contactos_incluidos"
          type="number"
          value={contactos}
          onChange={(e) => setContactos(e.target.value)}
          disabled={soloLectura}
        />

        <FormField
          label={t.marketplace.forma_renueva_sola}
          name="renueva_sola"
          type="checkbox"
          checked={renuevaSola}
          onChange={(e) => setRenuevaSola(e.target.checked)}
          disabled={soloLectura}
        />

        <FormField
          label={t.marketplace.forma_ofrecida}
          name="ofrecida"
          type="checkbox"
          checked={ofrecida}
          onChange={(e) => setOfrecida(e.target.checked)}
          disabled={soloLectura}
        />
        <p className="panel-explicacion">{t.marketplace.forma_ofrecida_explicacion}</p>

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            {soloLectura ? t.comun.cerrar : t.comun.cancelar}
          </Button>
          {!soloLectura && (
            <Button onClick={guardar} disabled={guardando}>
              {guardando ? t.comun.guardando : t.comun.guardar}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

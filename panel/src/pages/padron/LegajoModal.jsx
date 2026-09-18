import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';
import { CamposDeDomicilio } from '../../components/domicilio/CamposDeDomicilio';
import { DOMICILIO_VACIO, partesDesdeFila, partesParaGuardar } from '../../lib/partesDeDomicilio';

/* El alta y la corrección de un Legajo.
   ==========================================================================

   El mismo formulario para las dos cosas, porque los datos que se piden son los mismos: cargar una
   Persona y corregir cómo está cargada no son dos tareas distintas.

   EL NÚMERO DE LEGAJO NO ESTÁ ACÁ, y no por olvido. Lo pone la base sola, en orden, y rechaza que
   alguien lo elija: dos personas con el mismo número no se pueden separar después.

   LA CLASE CAMBIA LOS CASILLEROS. Una persona física tiene nombre y apellido; una jurídica tiene
   razón social y no tiene apellido. Y cada clase tiene sus propios documentos, que salen del
   catálogo del país y no de acá.

   NO HAY BOTÓN DE BORRAR, y tampoco lo va a haber. Un Legajo queda con el historial de cómo se
   comportó esa persona en cada rol que desempeñó, y con quien dejó de ser Cliente se vuelve a
   cruzar. La base también lo rechaza, por si alguna pantalla lo intentara igual. */
export function LegajoModal({ legajo, prestadoraId, tiposDeDocumento, onClose, onGuardado }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const corrigiendo = Boolean(legajo);

  const [clase, setClase] = useState(legajo?.clase ?? 'fisica');
  const [nombre, setNombre] = useState(legajo?.nombre ?? '');
  const [apellido, setApellido] = useState(legajo?.apellido ?? '');
  const [documentoTipo, setDocumentoTipo] = useState(legajo?.documento_tipo ?? '');
  const [documentoNumero, setDocumentoNumero] = useState(legajo?.documento_numero ?? '');
  const [telefono, setTelefono] = useState(legajo?.telefono ?? '');
  const [email, setEmail] = useState(legajo?.email ?? '');
  const [notas, setNotas] = useState(legajo?.notas ?? '');
  const [domicilio, setDomicilio] = useState(legajo ? partesDesdeFila(legajo) : DOMICILIO_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const tipos = tiposDeDocumento?.[clase] ?? [];
  const esJuridica = clase === 'juridica';

  function cambiarClase(nueva) {
    setClase(nueva);
    // El documento elegido pertenece a la lista de la clase anterior: dejarlo puesto guardaría un
    // tipo que no le corresponde a esta Persona.
    setDocumentoTipo('');
    if (nueva === 'juridica') setApellido('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const partes = partesParaGuardar(domicilio);
      const fila = {
        clase,
        nombre: nombre.trim(),
        apellido: esJuridica ? null : apellido.trim(),
        documento_tipo: documentoTipo || null,
        documento_numero: documentoTipo ? documentoNumero.trim() : null,
        telefono: telefono.trim() || null,
        email: email.trim() || null,
        notas: notas.trim() || null,
        ...partes,
      };

      // Se escribe derecho contra la base: quién puede cargar y corregir lo decide la política.
      // La Prestadora va en el alta y la política comprueba que sea la de quien está trabajando;
      // en la corrección no viaja, porque un Legajo no cambia de Prestadora.
      const { error: errorGuardar } = corrigiendo
        ? await supabase.from('legajos').update(fila).eq('id', legajo.id)
        : await supabase.from('legajos').insert({ ...fila, prestadora_id: prestadoraId });
      if (errorGuardar) throw errorGuardar;
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{corrigiendo ? t.padron.corregir_titulo : t.padron.nuevo_titulo}</h2>

        {error && <Alert variant="error">{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <FormField
            label={t.padron.clase}
            name="clase"
            type="select"
            required
            value={clase}
            onChange={(e) => cambiarClase(e.target.value)}
            disabled={guardando}
            ayuda={t.padron.clase_ayuda}
          >
            <option value="fisica">{t.padron.clase_fisica}</option>
            <option value="juridica">{t.padron.clase_juridica}</option>
          </FormField>

          <FormField
            label={esJuridica ? t.padron.razon_social : t.padron.nombre}
            name="nombre"
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={guardando}
          />
          {!esJuridica && (
            <FormField
              label={t.padron.apellido}
              name="apellido"
              required
              value={apellido}
              onChange={(e) => setApellido(e.target.value)}
              disabled={guardando}
            />
          )}

          {/* Si el país de la Prestadora no tiene tipos de documento cargados, el documento no se
              pide. Un casillero libre acá haría que cada quien lo escriba a su manera. */}
          {tipos.length > 0 && (
            <>
              <FormField
                label={t.padron.documento_tipo}
                name="documento_tipo"
                type="select"
                value={documentoTipo}
                onChange={(e) => setDocumentoTipo(e.target.value)}
                disabled={guardando}
              >
                <option value="">{t.padron.documento_sin_elegir}</option>
                {tipos.map((tipo) => (
                  <option key={tipo.codigo} value={tipo.codigo}>{tipo.sigla}</option>
                ))}
              </FormField>
              {documentoTipo && (
                <FormField
                  label={t.padron.documento_numero}
                  name="documento_numero"
                  required
                  value={documentoNumero}
                  onChange={(e) => setDocumentoNumero(e.target.value)}
                  disabled={guardando}
                />
              )}
            </>
          )}

          <CamposDeDomicilio valor={domicilio} alCambiar={setDomicilio} deshabilitado={guardando} />

          <FormField
            label={t.padron.telefono}
            name="telefono"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            disabled={guardando}
          />
          <FormField
            label={t.padron.email}
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={guardando}
          />
          <FormField
            label={t.padron.notas}
            name="notas"
            type="textarea"
            rows={3}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            disabled={guardando}
          />

          <div className="panel-modal-acciones">
            <Button variant="secondary" type="button" onClick={onClose} disabled={guardando}>
              {t.comun.cancelar}
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? t.padron.guardando : t.padron.guardar}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

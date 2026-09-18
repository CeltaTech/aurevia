import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { useTiposDeDocumento } from '../../hooks/useTiposDeDocumento';
import { Button } from '../ui/Button';
import { FormField } from '../ui/FormField';
import { Alert } from '../ui/Alert';
import { mensajeDeError } from '../../lib/errores';
import { LegajoModal } from '../../pages/padron/LegajoModal';

/* El casillero que nombra a una Persona del Padrón.
   ==========================================================================

   Donde antes se tecleaba un nombre, se elige un Legajo. Un nombre tecleado crea un ente nuevo que
   no existe: la misma obra social escrita en cien fichas son cien financiadores distintos, y uno
   mal tipeado no se cruza nunca con el bueno.

   Y SE PUEDE DAR DE ALTA DESDE ACÁ, sin salir de lo que se estaba haciendo. Si obligara a ir al
   Padrón, volver y retomar, quien trabaja terminaría pidiendo un casillero libre otra vez.

   CÓMO SE LLAMA CADA PERSONA LO DICE LA BASE, en una sola columna calculada, para que todas las
   pantallas digan lo mismo. */
export function SelectorDeLegajo({
  valor,
  alElegir,
  prestadoraId,
  label,
  ayuda,
  name,
  deshabilitado = false,
  permitirAlta = true,
  clase = null,
}) {
  const { t } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [dandoDeAlta, setDandoDeAlta] = useState(false);

  const documentos = useTiposDeDocumento(prestadoraId);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    // `clase` acota la lista cuando el casillero admite una sola: el Apoderado de una entidad es
    // una persona de carne y hueso, y ofrecer ahí otra entidad sería ofrecer algo que la base
    // rechaza. Sin `clase` se ofrecen las dos, que es lo corriente, porque contrata y paga
    // cualquiera de las dos.
    let consulta = supabase
      .from('legajos')
      .select('id, numero_legajo, nombre_visible, documento_numero')
      .order('nombre_visible', { ascending: true });
    if (clase) consulta = consulta.eq('clase', clase);

    const { data, error: errorConsulta } = await consulta;

    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }

    setFilas(data ?? []);
    setEstado(data && data.length > 0 ? 'listo' : 'vacio');
  }, [t, clase]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  // Lo elegido se muestra siempre, aunque la búsqueda lo deje afuera: una lista que esconde lo que
  // ya está guardado se lee como si el dato se hubiera perdido.
  const listadas = useMemo(() => {
    const buscado = busqueda.trim().toLowerCase();
    if (!buscado) return filas;
    return filas.filter((fila) => (
      fila.id === valor
      || (fila.nombre_visible ?? '').toLowerCase().includes(buscado)
      || String(fila.numero_legajo).includes(buscado)
      || (fila.documento_numero ?? '').toLowerCase().includes(buscado)
    ));
  }, [filas, busqueda, valor]);

  function alGuardarElNuevo(nuevo) {
    setDandoDeAlta(false);
    recargar();
    if (nuevo?.id) alElegir(nuevo.id);
  }

  return (
    <>
      {error && <Alert variant="error">{error}</Alert>}

      {estado === 'listo' && filas.length > 10 && (
        <FormField
          label={t.padron.selector_buscar}
          name={`${name}_busqueda`}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          disabled={deshabilitado}
        />
      )}

      <FormField
        label={label}
        name={name}
        type="select"
        value={valor ?? ''}
        ayuda={ayuda}
        onChange={(e) => alElegir(e.target.value || null)}
        disabled={deshabilitado || estado === 'cargando' || estado === 'error'}
      >
        <option value="">
          {estado === 'cargando' ? t.padron.selector_cargando : t.padron.selector_sin_elegir}
        </option>
        {listadas.map((fila) => (
          <option key={fila.id} value={fila.id}>
            {fila.nombre_visible} · {t.padron.numero} {fila.numero_legajo}
          </option>
        ))}
      </FormField>

      {estado === 'vacio' && <p className="panel-explicacion">{t.padron.selector_vacio}</p>}

      {permitirAlta && (
        <p className="panel-explicacion">
          <Button variant="secondary" type="button" onClick={() => setDandoDeAlta(true)} disabled={deshabilitado}>
            {t.padron.selector_agregar}
          </Button>
        </p>
      )}

      {dandoDeAlta && (
        <LegajoModal
          legajo={null}
          claseInicial={clase}
          prestadoraId={prestadoraId}
          tiposDeDocumento={documentos.porClase}
          onClose={() => setDandoDeAlta(false)}
          onGuardado={alGuardarElNuevo}
        />
      )}
    </>
  );
}

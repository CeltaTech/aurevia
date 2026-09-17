import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { SelectorDeLugares } from '../../components/lugares/SelectorDeLugares';
import { useCatalogoDeLugares } from '../../hooks/useCatalogoDeLugares';
import { useModalAccesible } from '../../hooks/useModalAccesible';
import { mensajeDeError } from '../../lib/errores';
import { con } from '../../lib/textos';

/* Dónde trabaja la Prestadora: su lista de localidades y barrios, y qué abarca cada zona.
   ==========================================================================

   De esta lista salen después el domicilio del Paciente, el de la Asistente, los lugares donde
   cada una acepta trabajar y el alcance de cada coordinadora. Mientras eso eran textos escritos a
   mano, «Villa Urquiza» y «villa urquiza» eran dos lugares distintos y nadie se enteraba.

   La lista es de un solo nivel: un barrio se distingue de una localidad nada más que por colgar de
   ella. Y se carga con la ayuda del organismo oficial del país, que sugiere; lo que agrupa y lo que
   entra a la lista lo decide la Prestadora. */
export function TabLugares() {
  const { t } = useLocale();
  const { lugares, zonas, estado, error, recargar } = useCatalogoDeLugares();
  const [errorAccion, setErrorAccion] = useState(null);
  const [agregando, setAgregando] = useState(false);
  const [lugarEnCurso, setLugarEnCurso] = useState(null);

  async function alternarActivo(lugar) {
    setLugarEnCurso(lugar.id);
    setErrorAccion(null);
    try {
      await llamarApi(`/lugares/${lugar.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !lugar.activo }),
      });
      await recargar();
    } catch (err) {
      setErrorAccion(mensajeDeError(err, t));
    } finally {
      setLugarEnCurso(null);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.lugares_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.lugares_explicacion}</p>
      {errorAccion && <Alert variant="error">{errorAccion}</Alert>}

      <div className="panel-filtros">
        <Button onClick={() => setAgregando(true)}>{t.configuracion.lugares_agregar}</Button>
      </div>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && lugares.length === 0}
        mensajeVacio={t.configuracion.lugares_vacio}
        recargar={recargar}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.lugares_col_nombre}</th>
              <th>{t.configuracion.lugares_col_provincia}</th>
              <th>{t.configuracion.lugares_col_origen}</th>
              <th>{t.configuracion.lugares_col_activo}</th>
            </tr>
          </thead>
          <tbody>
            {lugares.map((lugar) => (
              <tr key={lugar.id}>
                <td>{lugar.nombre}</td>
                <td>{[lugar.provincia, lugar.municipio].filter(Boolean).join(' · ')}</td>
                <td>
                  {lugar.fuente === 'oficial'
                    ? t.configuracion.lugares_origen_oficial
                    : t.configuracion.lugares_origen_propio}
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(lugar.activo)}
                    onChange={() => alternarActivo(lugar)}
                    disabled={lugarEnCurso === lugar.id}
                    aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.lugares_col_activo, nombre: lugar.nombre })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {agregando && (
        <AgregarLugar
          lugares={lugares}
          onClose={() => setAgregando(false)}
          onAgregado={recargar}
        />
      )}

      <h2>{t.configuracion.lugares_zonas_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.lugares_zonas_explicacion}</p>
      {zonas.map((zona) => (
        <LugaresDeLaZona key={zona.id} zona={zona} lugares={lugares} onGuardado={recargar} />
      ))}
    </div>
  );
}

/* Agregar un lugar a la lista.
   ==========================================================================

   Dos caminos en una sola pantalla, y ése es el punto: se busca primero en el organismo oficial, y
   sólo lo que el organismo no tiene se escribe a mano, colgado de la localidad a la que pertenece.
   Al revés —escribir primero— se termina con la misma localidad cargada dos veces con dos grafías.

   Si el organismo no contesta, se dice eso y no una lista vacía: vacía haría creer que el lugar no
   existe y cargarlo a mano, duplicado. */
function AgregarLugar({ lugares, onClose, onAgregado }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const [provincias, setProvincias] = useState([]);
  const [provincia, setProvincia] = useState('');
  const [texto, setTexto] = useState('');
  const [sugerencias, setSugerencias] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [nombrePropio, setNombrePropio] = useState('');
  const [dentroDe, setDentroDe] = useState('');

  const cargarProvincias = useCallback(async () => {
    try {
      const { provincias: filas } = await llamarApi('/lugares/provincias');
      setProvincias(filas ?? []);
    } catch {
      // Sin provincias se busca igual, en todo el país. No es motivo para trabar la pantalla.
      setProvincias([]);
    }
  }, []);

  useEffect(() => {
    cargarProvincias();
  }, [cargarProvincias]);

  // Los que ya están en la lista se muestran igual, marcados como tales: esconderlos haría buscar
  // de nuevo algo que ya se cargó.
  const yaEsta = (idOficial) => lugares.some((lugar) => lugar.id_oficial && lugar.id_oficial === idOficial);

  async function buscar() {
    setBuscando(true);
    setError(null);
    try {
      const parametros = new URLSearchParams({ texto });
      if (provincia) parametros.set('provincia', provincia);
      const { lugares: encontrados } = await llamarApi(`/lugares/sugerencias?${parametros}`);
      setSugerencias(encontrados ?? []);
    } catch (err) {
      setError(mensajeDeError(err, t));
      setSugerencias(null);
    } finally {
      setBuscando(false);
    }
  }

  async function agregar(cuerpo) {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/lugares', { method: 'POST', body: JSON.stringify(cuerpo) });
      await onAgregado();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal panel-modal-ancho" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.configuracion.lugares_agregar}</h2>
        {error && <Alert variant="error">{error}</Alert>}

        {provincias.length > 0 && (
          <FormField
            label={t.configuracion.lugares_provincia}
            name="provincia"
            type="select"
            value={provincia}
            onChange={(e) => setProvincia(e.target.value)}
          >
            <option value="">{t.configuracion.lugares_provincia_todas}</option>
            {provincias.map((p) => (
              <option key={p.idOficial} value={p.nombre}>{p.nombre}</option>
            ))}
          </FormField>
        )}

        <FormField
          label={t.configuracion.lugares_buscar}
          name="texto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <Button onClick={buscar} disabled={buscando || !texto.trim()}>
          {buscando ? t.comun.cargando : t.configuracion.lugares_buscar_accion}
        </Button>

        {sugerencias === null && <p className="panel-dato-vacio">{t.configuracion.lugares_escriba_para_buscar}</p>}
        {sugerencias?.length === 0 && <p className="panel-dato-vacio">{t.configuracion.lugares_sin_resultados}</p>}
        {sugerencias?.length > 0 && (
          <div className="panel-modulos-lista">
            {sugerencias.map((sugerencia) => (
              <div key={sugerencia.idOficial} className="panel-modulo-fila">
                <span className="panel-modulo-fila-info">
                  <span>{sugerencia.nombre}</span>
                  <span className="panel-modulo-fila-origen">
                    {[sugerencia.provincia, sugerencia.municipio].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {yaEsta(sugerencia.idOficial) ? (
                  <span className="panel-modulo-fila-origen">{t.configuracion.lugares_agregado}</span>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={guardando}
                    onClick={() => agregar({
                      nombre: sugerencia.nombre,
                      provincia: sugerencia.provincia ?? null,
                      municipio: sugerencia.municipio ?? null,
                      id_oficial: sugerencia.idOficial,
                      lat: sugerencia.lat,
                      lng: sugerencia.lng,
                    })}
                  >
                    {t.configuracion.lugares_agregar}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <h3>{t.configuracion.lugares_propio_titulo}</h3>
        <p className="panel-explicacion">{t.configuracion.lugares_propio_explicacion}</p>
        <FormField
          label={t.configuracion.lugares_propio_nombre}
          name="nombre_propio"
          value={nombrePropio}
          onChange={(e) => setNombrePropio(e.target.value)}
        />
        <FormField
          label={t.configuracion.lugares_propio_dentro_de}
          name="dentro_de"
          type="select"
          value={dentroDe}
          onChange={(e) => setDentroDe(e.target.value)}
        >
          <option value=""></option>
          {lugares.map((lugar) => (
            <option key={lugar.id} value={lugar.id}>{lugar.nombre}</option>
          ))}
        </FormField>
        <Button
          variant="secondary"
          disabled={guardando || !nombrePropio.trim() || !dentroDe}
          onClick={() => {
            const contenedor = lugares.find((lugar) => lugar.id === dentroDe);
            return agregar({
              nombre: nombrePropio,
              // La provincia y el municipio son los de la localidad que lo contiene: un barrio no
              // está en otro lado que su localidad, y pedirlos de nuevo sería dejar que se carguen
              // distintos. El país lo pone el motor, que lo sabe por la Prestadora.
              provincia: contenedor?.provincia ?? null,
              municipio: contenedor?.municipio ?? null,
              parte_de: dentroDe,
            });
          }}
        >
          {guardando ? t.comun.guardando : t.configuracion.lugares_agregar}
        </Button>

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
        </div>
      </div>
    </div>
  );
}

/* Qué lugares abarca una zona. La lista entera para tildar, sin agrupar: acá no hay zonas con las
   cuales ordenar, porque la zona es justamente la que se está armando. */
function LugaresDeLaZona({ zona, lugares, onGuardado }) {
  const { t } = useLocale();
  const [elegidos, setElegidos] = useState(zona.lugares ?? []);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    setElegidos(zona.lugares ?? []);
  }, [zona.lugares]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi(`/zonas/${zona.id}/lugares`, {
        method: 'PUT',
        body: JSON.stringify({ lugares: elegidos }),
      });
      setGuardado(true);
      await onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h3>{zona.nombre}</h3>
      {error && <Alert variant="error">{error}</Alert>}
      {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      <SelectorDeLugares
        lugares={lugares}
        zonas={[]}
        nombreSinZona={t.configuracion.lugares_titulo}
        valor={elegidos}
        onChange={(siguiente) => { setElegidos(siguiente); setGuardado(false); }}
        deshabilitado={guardando}
      />
      <Button onClick={guardar} disabled={guardando}>
        {guardando ? t.comun.guardando : t.comun.guardar}
      </Button>
    </div>
  );
}

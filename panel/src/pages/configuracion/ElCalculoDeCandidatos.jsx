import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { con } from '../../lib/textos';
import { mensajeDeError } from '../../lib/errores';
import {
  NOMBRES_DE_PERFIL,
  PERFILES,
  PESOS_QUE_SE_PUEDEN_TOCAR,
  TOPES_QUE_SE_PUEDEN_TOCAR,
  PESOS,
  TOPES,
} from '../../lib/perfilesDeCandidatos';

/**
 * Cómo ordena esta Prestadora la lista de quiénes pueden cubrir un hueco.
 *
 * QUÉ SE DECIDE ACÁ. Cuando hay una guardia sin Asistente, el sistema propone a quiénes conviene
 * llamar primero. Ese orden sale de cuánto pesa cada cosa: haber atendido antes a ese Paciente,
 * vivir cerca, llegar descansado, tener la semana casi llena. Hasta ahora esos números eran
 * iguales para toda Prestadora.
 *
 * SE ELIGE UNA DE TRES FORMAS ARMADAS, y quien quiera puede además correr número por número. El
 * detalle está plegado a propósito: la mayoría elige una forma y no entra nunca más.
 *
 * EL ORDEN NO DECIDE. Esto cambia en qué orden aparece la lista y nada más. Quien elige sigue
 * siendo la Coordinadora, que sabe cosas que el sistema no sabe. Y estirar el turno de alguien
 * que ya está adentro tampoco se configura acá: eso es una decisión de un caso puntual.
 */
export function ElCalculoDeCandidatos() {
  const { t } = useLocale();
  const tc = t.configuracion;
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [perfil, setPerfil] = useState('continuidad');
  const [pesos, setPesos] = useState({});
  const [topes, setTopes] = useState({});
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { configuracion } = await llamarApi('/calculo-candidatos');
      setPerfil(configuracion.perfil);
      setPesos(configuracion.pesos);
      setTopes(configuracion.topes);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  /* Cambiar de forma armada vuelve a dejar todos los números como los trae esa forma. Es lo que
     espera quien la elige: si quedaran encima los cambios de la forma anterior, el nombre elegido
     diría una cosa y los números harían otra. Lo que se corrió a mano se vuelve a correr. */
  function elegirPerfil(nombre) {
    const armado = PERFILES[nombre] ?? PERFILES.continuidad;
    setPerfil(nombre);
    setPesos({ ...PESOS, ...armado.pesos });
    setTopes({ ...TOPES, ...armado.topes });
    setGuardado(false);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      await llamarApi('/calculo-candidatos', {
        method: 'PUT',
        body: JSON.stringify({ perfil, pesos, topes }),
      });
      setGuardado(true);
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{tc.calculo_titulo}</h2>
      <p className="panel-explicacion">{tc.calculo_explicacion}</p>
      <EstadoLista estado={estado} error={error} recargar={recargar}>
        {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}
        {guardado && <Alert variant="success">{tc.calculo_guardado}</Alert>}

        <fieldset>
          <legend>{tc.calculo_forma}</legend>
          {NOMBRES_DE_PERFIL.map((nombre) => (
            <label key={nombre}>
              <input
                type="radio"
                name="perfil_calculo_candidatos"
                value={nombre}
                checked={perfil === nombre}
                onChange={() => elegirPerfil(nombre)}
              />
              <span>
                <strong>{tc[`calculo_perfil_${nombre}`]}</strong>
                <br />
                {tc[`calculo_perfil_${nombre}_explicacion`]}
              </span>
            </label>
          ))}
        </fieldset>

        <button type="button" onClick={() => setDetalleAbierto((abierto) => !abierto)}>
          {detalleAbierto ? tc.calculo_cerrar_detalle : tc.calculo_abrir_detalle}
        </button>

        {detalleAbierto && (
          <>
            <p className="panel-explicacion">{tc.calculo_detalle_explicacion}</p>
            <TablaDeNumeros
              titulo={tc.calculo_pesos_titulo}
              bordes={PESOS_QUE_SE_PUEDEN_TOCAR}
              valores={pesos}
              nombreDe={(clave) => tc[`calculo_peso_${clave}`]}
              alCambiar={(clave, valor) => {
                setPesos((previos) => ({ ...previos, [clave]: valor }));
                setGuardado(false);
              }}
              t={t}
            />
            <TablaDeNumeros
              titulo={tc.calculo_topes_titulo}
              bordes={TOPES_QUE_SE_PUEDEN_TOCAR}
              valores={topes}
              nombreDe={(clave) => tc[`calculo_tope_${clave}`]}
              alCambiar={(clave, valor) => {
                setTopes((previos) => ({ ...previos, [clave]: valor }));
                setGuardado(false);
              }}
              t={t}
            />
          </>
        )}

        <button type="button" onClick={guardar} disabled={guardando}>
          {guardando ? t.comun.guardando : t.comun.guardar}
        </button>
      </EstadoLista>
    </div>
  );
}

/** Un número por renglón, con su borde a la vista para que nadie escriba algo que va a rebotar. */
function TablaDeNumeros({ titulo, bordes, valores, nombreDe, alCambiar, t }) {
  return (
    <>
      <h3>{titulo}</h3>
      <table className="panel-tabla">
        <thead>
          <tr>
            <th>{t.configuracion.calculo_col_criterio}</th>
            <th>{t.configuracion.calculo_col_valor}</th>
            <th>{t.configuracion.calculo_col_entre}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(bordes).map(([clave, borde]) => {
            const nombre = nombreDe(clave);
            return (
              <tr key={clave}>
                <td>{nombre}</td>
                <td>
                  <input
                    type="number"
                    step="any"
                    min={borde.minimo}
                    max={borde.maximo}
                    value={valores[clave] ?? ''}
                    onChange={(e) => alCambiar(clave, e.target.value === '' ? '' : Number(e.target.value))}
                    aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.calculo_col_valor, nombre })}
                  />
                </td>
                <td>
                  {borde.minimo} … {borde.maximo}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

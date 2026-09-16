import { useState } from 'react';
import { api } from '../lib/api';
import { con } from '../lib/textos';
import { mensajeDeError } from '../lib/errores';
import { horaDelMomento } from '../lib/horarios';
import { agregarACola, nuevoId } from '../lib/colaOffline';
import { sincronizarCola } from '../lib/sincronizarCola';

/**
 * El descanso adentro de la guardia.
 *
 * QUÉ RESUELVE. Hay guardias de 24, 48 y 72 horas que cubre una sola persona, y nadie puede estar
 * dos días sin dormir. En el domicilio se descansa, generalmente de noche, cuando el Paciente
 * duerme. Hasta acá de ese rato no quedaba ninguna constancia.
 *
 * DESCANSAR DISPONIBLE NO ES IRSE, Y LA PANTALLA TIENE QUE DECIRLO. No se descuenta de lo que se
 * le paga, no interrumpe el turno y no la saca de la guardia: si pasa algo, está. Quien aprieta
 * este botón no puede quedarse con la duda de si se está anotando una falta, porque con esa duda
 * no lo aprieta nunca y volvemos a no tener el dato.
 *
 * UN TOQUE PARA EMPEZAR Y UNO PARA TERMINAR. Acá no hace falta el segundo paso que sí tiene el
 * aviso de emergencia: apretarlo sin querer no le cuesta nada a nadie, y se arregla apretando
 * «terminé».
 *
 * NO SE PIDE MOTIVO. Descansar de noche en un turno largo es lo normal, no una excepción que haya
 * que justificar. La nota queda para cuando haya algo que decir, y casi nunca lo hay.
 *
 * SIN SEÑAL SALE SOLO CUANDO VUELVA. A diferencia de la emergencia, acá no hace falta avisar por
 * otro medio: nadie está esperando este dato del otro lado. Se guarda con la hora del teléfono, y
 * esa hora es la que vale.
 */
export default function DescansoEnGuardia({ t, locale, guardiaId, descansoAbierto, alCambiar }) {
  const tr = t.descanso;
  // Lo que esta pantalla sabe del descanso en curso: lo que vino del servidor, o lo que se acaba
  // de empezar acá y todavía no volvió.
  const [abierto, setAbierto] = useState(descansoAbierto ?? null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const [ultimoCierre, setUltimoCierre] = useState(null);

  async function alEmpezar() {
    setError('');
    setUltimoCierre(null);
    setTrabajando(true);
    const datos = { ocurrido_at: new Date().toISOString() };
    try {
      const resultado = await api.empezarDescanso(guardiaId, datos);
      setAbierto(resultado.descanso ?? { inicio_at: datos.ocurrido_at });
      alCambiar?.();
    } catch (e) {
      if (!(e instanceof TypeError)) {
        setError(mensajeDeError(e, t, 'registrar el descanso'));
        setTrabajando(false);
        return;
      }
      await agregarACola({ id: nuevoId(), tipo: 'descanso_empezar', guardiaId, payload: datos });
      setAbierto({ inicio_at: datos.ocurrido_at });
      alCambiar?.();
      sincronizarCola();
    } finally {
      setTrabajando(false);
    }
  }

  async function alTerminar() {
    setError('');
    setTrabajando(true);
    const datos = { ocurrido_at: new Date().toISOString() };
    try {
      await api.terminarDescanso(guardiaId, datos);
      setUltimoCierre(datos.ocurrido_at);
      setAbierto(null);
      alCambiar?.();
    } catch (e) {
      if (!(e instanceof TypeError)) {
        setError(mensajeDeError(e, t, 'cerrar el descanso'));
        setTrabajando(false);
        return;
      }
      await agregarACola({ id: nuevoId(), tipo: 'descanso_terminar', guardiaId, payload: datos });
      setUltimoCierre(datos.ocurrido_at);
      setAbierto(null);
      alCambiar?.();
      sincronizarCola();
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {abierto && (
        <div className="alert alert-info" role="status">
          {con(tr.en_curso, { hora: horaDelMomento(abierto.inicio_at, locale) })}
        </div>
      )}

      {!abierto && ultimoCierre && (
        <div className="alert alert-info" role="status">
          {con(tr.terminado, { hora: horaDelMomento(ultimoCierre, locale) })}
        </div>
      )}

      <button
        className="btn btn-secondary btn-full"
        onClick={abierto ? alTerminar : alEmpezar}
        disabled={trabajando}
      >
        {abierto ? tr.boton_terminar : tr.boton_empezar}
      </button>

      {!abierto && <p className="guardia-card-detalle">{tr.explicacion}</p>}
    </div>
  );
}

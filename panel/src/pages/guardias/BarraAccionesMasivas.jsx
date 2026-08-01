import { useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { FormField } from '../../components/ui/FormField';
import { correrHora, sumarDias } from '../../lib/horarios';
import { con } from '../../lib/textos';

// La barra de acciones de a muchas.
// ============================================================================
//
// El problema que resuelve. Hasta acá, cambiarle el Asistente a las guardias de una semana
// era abrir el detalle de cada una, elegir, guardar, cerrar, y repetir. Diez guardias eran
// cuarenta clics y la primera oportunidad de equivocarse aparecía en el clic tres. Acá se
// elige una vez y cae sobre todas las guardias marcadas en la grilla.
//
// Qué NO hace este archivo: hablar con la base. No importa `supabaseClient` a propósito. Este
// componente solo junta dos cosas —qué acción eligió el usuario y con qué parámetro— y se las
// pasa a `onAplicar`. Quien guarda, quien decide el orden, quien limpia lo que haya que
// limpiar de cada guardia (el incidente de relevo abierto, la publicación de la guardia
// ofrecida) es la pantalla padre, que ya sabe hacerlo de a una en `handleReasignar`. Si la
// barra guardara por su cuenta, esa lógica quedaría escrita dos veces y una de las dos
// versiones se iba a quedar vieja (regla 12 de CLAUDE.md §7).

// Las cuatro acciones posibles. El nombre es el que viaja en `onAplicar({ accion: ... })`.
const ACCIONES = ['reasignar', 'correr', 'cancelar', 'duplicar'];

// Qué clave de i18n titula el botón de cada acción. Se escribe una sola vez acá para que
// agregar una acción sea agregar una línea, y no tocar el JSX en tres lugares.
const CLAVE_BOTON = {
  reasignar: 'reasignar',
  correr: 'correr_horario',
  cancelar: 'cancelar',
  duplicar: 'duplicar',
};

const DIAS_POR_SEMANA = 7;

export function BarraAccionesMasivas({ seleccionadas = [], asistentes = [], onAplicar, onLimpiar }) {
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();

  const [accion, setAccion] = useState(null);
  const [asistenteId, setAsistenteId] = useState('');
  const [minutos, setMinutos] = useState('');
  const [semanas, setSemanas] = useState('1');
  // Quién pidió la cancelación y hasta dónde llega. Se preguntan también acá, y no solo en el
  // detalle de a una: si la vía rápida guardara menos datos que la lenta, la Prestadora
  // terminaría con la mitad de sus cancelaciones sin motivo, y el ahorro de clics se pagaría
  // el día que alguien tenga que explicar por qué se cayeron veinte guardias.
  const [origen, setOrigen] = useState('');
  const [alcance, setAlcance] = useState('');
  // `enCurso` es true mientras `onAplicar` no volvió. Bloquea todos los botones: la regla 5 de
  // CLAUDE.md §7 no admite un segundo envío, y acá un doble clic no duplicaría un cambio sino
  // veinte.
  const [enCurso, setEnCurso] = useState(false);
  const [resultado, setResultado] = useState(null);

  const textos = t.guardias.seleccion;
  const cantidad = seleccionadas.length;

  // El texto que dice sobre cuántas guardias cae la acción. Una acción masiva que no dice
  // sobre cuántas filas cae es una acción a ciegas.
  const textoCuenta = cantidad === 1 ? textos.una : con(textos.cuantas, { n: cantidad });

  const minutosNumero = Number.parseInt(minutos, 10);
  const semanasNumero = Number.parseInt(semanas, 10);
  // Correr el horario cero minutos, o duplicar a cero semanas adelante, no es un cambio: es
  // pedirle al sistema que trabaje para dejar todo igual. Se deshabilita antes de llegar ahí.
  const minutosValidos = Number.isInteger(minutosNumero) && minutosNumero !== 0;
  const semanasValidas = Number.isInteger(semanasNumero) && semanasNumero > 0;

  // ¿La acción elegida ya tiene lo que necesita para poder aplicarse?
  const listaParaAplicar =
    (accion === 'reasignar' && Boolean(asistenteId)) ||
    (accion === 'correr' && minutosValidos) ||
    (accion === 'duplicar' && semanasValidas) ||
    (accion === 'cancelar' && Boolean(origen) && Boolean(alcance));

  // Un adelanto de lo que va a pasar, calculado sobre la primera guardia marcada.
  // Es la única razón por la que este componente usa `horarios.js`: no guarda nada, solo
  // muestra. "Correr 90 minutos" no se entiende hasta que alguien ve que las 23:30 se vuelven
  // las 01:00 del día siguiente, y esa vuelta al día es justo donde la cuenta hecha a ojo
  // falla. Mejor que lo vea antes de aplicar y no después, sobre cuarenta guardias.
  const muestra = seleccionadas[0];
  const vistaPrevia = useMemo(() => {
    if (!muestra) return null;
    if (accion === 'correr' && minutosValidos) {
      const inicio = correrHora(muestra.hora_inicio, minutosNumero);
      const fin = correrHora(muestra.hora_fin, minutosNumero);
      return `${muestra.hora_inicio}–${muestra.hora_fin} → ${inicio}–${fin}`;
    }
    if (accion === 'duplicar' && semanasValidas) {
      return `${muestra.fecha} → ${sumarDias(muestra.fecha, semanasNumero * DIAS_POR_SEMANA)}`;
    }
    return null;
  }, [muestra, accion, minutosValidos, minutosNumero, semanasValidas, semanasNumero]);

  // Cambiar de acción o de parámetro borra el resultado anterior: dejarlo puesto haría creer
  // que ese "listo" habla del cambio que se está por hacer ahora.
  function elegirAccion(nueva) {
    setResultado(null);
    setAccion((anterior) => (anterior === nueva ? null : nueva));
  }

  function parametrosDe(cual) {
    if (cual === 'reasignar') return { asistenteId };
    if (cual === 'correr') return { minutos: minutosNumero };
    if (cual === 'duplicar') return { semanas: semanasNumero };
    if (cual === 'cancelar') return { origen, alcance };
    return {};
  }

  async function handleAplicar() {
    if (!accion || !listaParaAplicar || enCurso) return;

    // Cancelar guardias es destructivo (regla 4 de CLAUDE.md §7): se pregunta antes, diciendo
    // cuántas son y que desde acá no se deshace. Se usa la confirmación del proyecto y no un
    // `window.confirm`, porque esa es la que además avisa cuando se está trabajando dentro de
    // una Prestadora ajena en una sesión de soporte técnico.
    if (accion === 'cancelar') {
      const mensaje = con(textos.confirmar_cancelar, { n: cantidad });
      if (!(await confirmarDestructivo(mensaje))) return;
    }

    setResultado(null);
    setEnCurso(true);
    try {
      const respuesta = await onAplicar({ accion, ...parametrosDe(accion) });
      setResultado({
        ok: respuesta?.ok ?? 0,
        total: respuesta?.total ?? cantidad,
      });
    } catch {
      // Si la pantalla padre se cayó entera, ninguna guardia cambió. Se informa como el
      // resultado parcial de siempre —cero de tantas— en vez de tragarse el error: el usuario
      // tiene que saber que sus guardias quedaron como estaban.
      setResultado({ ok: 0, total: cantidad });
    } finally {
      setEnCurso(false);
    }
  }

  // Sin nada elegido la barra no existe. No se muestra vacía ni deshabilitada: ocupa espacio
  // abajo de la grilla y no tiene nada que decir.
  if (cantidad === 0) return null;

  return (
    <div className="barra-masiva" role="region" aria-label={textoCuenta}>
      <span className="barra-masiva-cuenta">{textoCuenta}</span>

      <div className="barra-masiva-acciones">
        {ACCIONES.map((a) => (
          <Button
            key={a}
            type="button"
            variant={accion === a ? 'primary' : 'secondary'}
            onClick={() => elegirAccion(a)}
            disabled={enCurso}
            aria-pressed={accion === a}
          >
            {textos[CLAVE_BOTON[a]]}
          </Button>
        ))}
        <Button type="button" variant="secondary" onClick={onLimpiar} disabled={enCurso}>
          {textos.limpiar}
        </Button>
      </div>

      {/* El control que le falta a la acción elegida aparece recién cuando se la elige, y se
          anuncia: quien navega con lector de pantalla tiene que enterarse de que apareció un
          campo nuevo, no descubrirlo tabulando. */}
      {(accion || resultado) && (
        <div className="barra-masiva-detalle" aria-live="polite">
          {accion === 'reasignar' && (
            <FormField
              label={textos.reasignar_a}
              name="masiva_asistente"
              type="select"
              value={asistenteId}
              onChange={(e) => {
                setResultado(null);
                setAsistenteId(e.target.value);
              }}
              disabled={enCurso}
            >
              <option value="">{t.guardias.nueva_guardia.elegir}</option>
              {asistentes.map((a) => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </FormField>
          )}

          {accion === 'correr' && (
            <FormField
              label={textos.correr_minutos}
              name="masiva_minutos"
              type="number"
              step="5"
              value={minutos}
              onChange={(e) => {
                setResultado(null);
                setMinutos(e.target.value);
              }}
              disabled={enCurso}
            />
          )}

          {accion === 'cancelar' && (
            <>
              {/* Las mismas dos preguntas que hace el detalle de una guardia, con las mismas
                  palabras: son la misma decisión, no dos parecidas. */}
              <FormField
                label={t.guardias.detalle.cancelacion_origen}
                name="masiva_cancelacion_origen"
                type="select"
                value={origen}
                onChange={(e) => {
                  setResultado(null);
                  setOrigen(e.target.value);
                }}
                disabled={enCurso}
              >
                <option value="">{t.guardias.nueva_guardia.elegir}</option>
                <option value="familia">{t.guardias.detalle.cancelacion_origen_familia}</option>
                <option value="prestadora">{t.guardias.detalle.cancelacion_origen_prestadora}</option>
              </FormField>
              <FormField
                label={t.guardias.detalle.cancelacion_alcance}
                name="masiva_cancelacion_alcance"
                type="select"
                value={alcance}
                onChange={(e) => {
                  setResultado(null);
                  setAlcance(e.target.value);
                }}
                disabled={enCurso}
              >
                <option value="">{t.guardias.nueva_guardia.elegir}</option>
                <option value="parcial">{t.guardias.detalle.cancelacion_alcance_parcial}</option>
                <option value="total">{t.guardias.detalle.cancelacion_alcance_total}</option>
              </FormField>
            </>
          )}

          {accion === 'duplicar' && (
            <FormField
              label={textos.duplicar_semanas}
              name="masiva_semanas"
              type="number"
              min="1"
              value={semanas}
              onChange={(e) => {
                setResultado(null);
                setSemanas(e.target.value);
              }}
              disabled={enCurso}
            />
          )}

          {vistaPrevia && <p className="panel-explicacion">{vistaPrevia}</p>}

          {accion && (
            <Button
              type="button"
              onClick={handleAplicar}
              disabled={enCurso || !listaParaAplicar}
            >
              {enCurso ? textos.aplicando : textos.aplicar}
            </Button>
          )}

          {/* Que unas salgan y otras no es un resultado normal, no una falla rara: el Asistente
              nuevo puede estar ocupado en tres de las cuatro fechas, y esas tres se rechazan
              solas mientras la cuarta pasa. Se dice tal cual, con los dos números. Mostrar
              "listo" a secas y esconder las que quedaron afuera sería mentir, y la mentira se
              descubre igual: cuando alguien mira la grilla y las ve como estaban. */}
          {resultado && (
            resultado.ok === resultado.total ? (
              <Alert variant="info">{con(textos.hecho, { n: resultado.ok })}</Alert>
            ) : (
              <Alert variant="warning">
                {con(textos.error_parcial, { ok: resultado.ok, total: resultado.total })}
              </Alert>
            )
          )}
        </div>
      )}
    </div>
  );
}

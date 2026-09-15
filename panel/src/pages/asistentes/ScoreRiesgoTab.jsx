import { useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useEscalasLegales } from '../../hooks/useEscalasLegales';
import { resolverEscalasVigentes } from '../../lib/escalasLegales';
import { calcularScoreRiesgo, INDICADORES_RIESGO } from '../../lib/scoreRiesgo';
import { INDICADORES_DEDUCIDOS, deducirIndicadores, indicadoresParaElPuntaje } from '../../lib/indicadoresDeducidos';
import { con } from '../../lib/textos';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { AvisoEscalasProvisorias } from '../../components/AvisoEscalasProvisorias';

// Qué dice la pantalla debajo de cada indicador que se calculó solo. Vive acá y no en el
// cálculo porque es texto visible, y el cálculo no conoce el idioma de quien está mirando.
function detalleDeducido(t, indicador, deducido) {
  if (indicador === 'exclusividad_zona') {
    return deducido.dato === 1
      ? t.asistentes.score.detalle_zona_una
      : con(t.asistentes.score.detalle_zona_varias, { n: deducido.dato });
  }
  const plantilla = indicador === 'antiguedad_vinculo'
    ? t.asistentes.score.detalle_antiguedad
    : t.asistentes.score.detalle_horas;
  return con(plantilla, { n: deducido.dato, umbral: deducido.umbral });
}

export function ScoreRiesgoTab({ asistente, onActualizado }) {
  const { t } = useLocale();
  // La Prestadora va sí o sí: sin ella el hook no consulta nada y el estado se queda en
  // "cargando" para siempre —el puntaje da 0 y el botón de guardar nunca se enciende—.
  const { filas: escalasCrudas, estado } = useEscalasLegales(asistente.prestadora_id);
  // Sólo los que se cargan a mano viven en el estado de la pantalla: los otros tres no se
  // tocan acá, salen de la ficha cada vez que se muestra.
  const [indicadores, setIndicadores] = useState(asistente.indicadores_riesgo ?? {});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const hoy = new Date().toISOString().slice(0, 10);
  const escalasResueltas = estado === 'listo' ? resolverEscalasVigentes(escalasCrudas, hoy) : null;

  // Tres de los siete indicadores salen de datos que la ficha ya tiene, así que se deducen acá
  // y no se preguntan. Eso es lo que hace que el puntaje se recalcule solo: cambian las horas
  // del Asistente y el número cambia, sin que nadie vuelva a entrar a tildar nada.
  const { valores: deducidos, sinDeducir } = useMemo(
    () => (escalasResueltas ? deducirIndicadores(asistente, escalasResueltas, hoy) : { valores: {}, sinDeducir: [] }),
    [asistente, escalasResueltas, hoy],
  );

  const indicadoresCompletos = indicadoresParaElPuntaje(indicadores, deducidos);
  const { score, advertencias } = escalasResueltas
    ? calcularScoreRiesgo(indicadoresCompletos, escalasResueltas)
    : { score: 0, advertencias: [] };

  const aMano = INDICADORES_RIESGO.filter((i) => !INDICADORES_DEDUCIDOS.includes(i));

  async function guardar() {
    setGuardando(true);
    setError(null);
    // El puntaje y los motivos que lo forman se guardan aparte, en
    // `datos_reservados_asistente`, donde la base exige el permiso
    // `ver_datos_reservados_asistente` para leerlos y ser administración para cambiarlos.
    // Puede no existir todavía la fila —un Asistente al que nunca se le calculó el puntaje—,
    // así que se usa `upsert`: la crea la primera vez y la actualiza las siguientes.
    // Se guardan los siete, deducidos incluidos: lo guardado tiene que explicar el número
    // guardado, y el día que cambie un umbral el histórico sigue diciendo con qué se calculó.
    const { error: errorUpdate } = await supabase
      .from('datos_reservados_asistente')
      .upsert(
        {
          asistente_id: asistente.id,
          prestadora_id: asistente.prestadora_id,
          indicadores_riesgo: indicadoresCompletos,
          score_riesgo_reclasificacion: score,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'asistente_id' },
      );
    setGuardando(false);
    if (errorUpdate) {
      setError(t.comun.error_generico);
      return;
    }
    onActualizado();
  }

  return (
    <div>
      <h2>{t.asistentes.score.titulo}</h2>
      <Alert variant="info">{t.asistentes.score.explicacion}</Alert>
      {/* El puntaje sale de pesos que hoy son provisorios: se dice antes de mostrarlo. */}
      <AvisoEscalasProvisorias escalas={escalasCrudas} />
      {error && <Alert variant="error">{error}</Alert>}
      {advertencias.map((a, i) => <Alert key={i} variant="error">{a}</Alert>)}

      <h3>{t.asistentes.score.deducidos_titulo}</h3>
      <p>{t.asistentes.score.deducidos_explicacion}</p>
      <ul className="score-riesgo-deducidos">
        {INDICADORES_DEDUCIDOS.map((indicador) => {
          const deducido = deducidos[indicador];
          const faltante = sinDeducir.find((s) => s.indicador === indicador);
          return (
            <li key={indicador}>
              <strong>{t.asistentes.score.indicadores[indicador]}</strong>
              {deducido && <span> — {detalleDeducido(t, indicador, deducido)}</span>}
              {/* Un indicador que no se pudo deducir se dice, no se muestra en cero: un cero
                  silencioso se lee como «no hay indicio», que es otra cosa. */}
              {faltante && <span> — {faltante.motivo === 'sin_dato' ? t.asistentes.score.sin_dato : t.asistentes.score.sin_umbral}</span>}
            </li>
          );
        })}
      </ul>

      <h3>{t.asistentes.score.a_mano_titulo}</h3>
      <p>{t.asistentes.score.a_mano_explicacion}</p>
      {aMano.map((indicador) => (
        <FormField
          key={indicador}
          label={t.asistentes.score.indicadores[indicador]}
          name={indicador}
          type="checkbox"
          checked={Boolean(indicadores[indicador])}
          onChange={(e) => setIndicadores((prev) => ({ ...prev, [indicador]: e.target.checked ? 1 : 0 }))}
        />
      ))}

      <p className="score-riesgo-valor">{t.asistentes.score.resultado}: <strong>{score}</strong> / 100</p>

      {asistente.tipo_vinculo === 'monotributo' && (
        <p className="score-riesgo-nota">
          {score >= 60 ? t.asistentes.score.riesgo_alto : score >= 30 ? t.asistentes.score.riesgo_medio : t.asistentes.score.riesgo_bajo}
        </p>
      )}

      <Button onClick={guardar} disabled={guardando || estado !== 'listo'}>
        {guardando ? t.comun.guardando : t.comun.guardar}
      </Button>
    </div>
  );
}

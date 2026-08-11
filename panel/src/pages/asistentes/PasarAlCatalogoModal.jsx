import { useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { nombreTipo, sugerirTipo } from '../../lib/tiposAsistente';
import { useTiposAsistente } from '../../hooks/useTiposAsistente';
import { mensajeDeError } from '../../lib/errores';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';

// La pantalla donde se le pone tipo a los Asistentes que todavía no lo tienen.
//
// Antes el tipo de un Asistente era una casilla de texto libre: cada quien
// escribía lo que le parecía. Ahora se elige de una lista. Los que ya estaban
// cargados no se convierten solos: esta pantalla los pone uno debajo del otro,
// muestra qué decía la ficha vieja y propone el tipo que más se le parece —
// pero la propone, no la aplica. La confirma una persona.
//
// También caen acá los que entraron por una planilla importada donde el tipo no
// se pudo reconocer. Esos no tienen ficha vieja que mostrar: la columna del
// medio queda con un guion y el tipo se elige a mano, que es lo mismo que hace
// quien pasa los viejos.
//
// Por qué no se convierte solo: el tipo es lo que decide si a esa persona se le
// exige matrícula para poder atender. Adivinar mal ahí no es un renglón feo en
// una pantalla, es dejar trabajar a alguien que no debería, o frenar a alguien
// que sí puede. Cuando la sugerencia duda, no sugiere nada y la casilla queda
// vacía a propósito.
//
// El día que no quede ningún Asistente sin tipo, el aviso de la lista deja de
// aparecer y esta pantalla no se abre más.
export function PasarAlCatalogoModal({ asistentes, onClose, onGuardado }) {
  const { t } = useLocale();
  const { paraElegir: tipos } = useTiposAsistente();
  const [elegidos, setElegidos] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  // La sugerencia se calcula una vez por Asistente, cuando ya llegó el
  // catálogo. Lo que la persona toca a mano manda siempre sobre la sugerencia.
  const sugerencias = useMemo(() => {
    const porAsistente = {};
    for (const asistente of asistentes) {
      porAsistente[asistente.id] = sugerirTipo(asistente.especialidades, tipos, t);
    }
    return porAsistente;
  }, [asistentes, tipos, t]);

  function valorDe(asistenteId) {
    return elegidos[asistenteId] ?? sugerencias[asistenteId] ?? '';
  }

  const cuantosTienenTipo = asistentes.filter((a) => valorDe(a.id)).length;

  async function guardar() {
    setGuardando(true);
    setError(null);
    const cambios = asistentes
      .map((a) => ({ id: a.id, tipo_asistente_id: valorDe(a.id) }))
      .filter((cambio) => cambio.tipo_asistente_id);

    for (const cambio of cambios) {
      const { error: errorGuardar } = await supabase
        .from('asistentes')
        .update({ tipo_asistente_id: cambio.tipo_asistente_id })
        .eq('id', cambio.id);
      if (errorGuardar) {
        setGuardando(false);
        setError(mensajeDeError(errorGuardar, t));
        return;
      }
    }

    setGuardando(false);
    onGuardado();
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.asistentes.pasar_al_catalogo.titulo}</h2>
        <p className="panel-explicacion">{t.asistentes.pasar_al_catalogo.explicacion}</p>

        {error && <Alert variant="error">{error}</Alert>}

        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.asistentes.col_nombre}</th>
              <th>{t.asistentes.pasar_al_catalogo.col_antes_decia}</th>
              <th>{t.asistentes.col_tipo}</th>
            </tr>
          </thead>
          <tbody>
            {asistentes.map((asistente) => (
              <tr key={asistente.id}>
                <td>{asistente.nombre}</td>
                <td>{(asistente.especialidades || []).join(', ') || '—'}</td>
                <td>
                  <select
                    value={valorDe(asistente.id)}
                    onChange={(e) => setElegidos((previos) => ({ ...previos, [asistente.id]: e.target.value }))}
                  >
                    <option value="">{t.asistentes.pasar_al_catalogo.dejar_para_despues}</option>
                    {tipos.map((tipo) => (
                      <option key={tipo.id} value={tipo.id}>{nombreTipo(tipo, t)}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="panel-modal-acciones">
          <Button variant="secondary" type="button" onClick={onClose} disabled={guardando}>
            {t.comun.cancelar}
          </Button>
          <Button type="button" onClick={guardar} disabled={guardando || cuantosTienenTipo === 0}>
            {guardando ? t.comun.guardando : t.asistentes.pasar_al_catalogo.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

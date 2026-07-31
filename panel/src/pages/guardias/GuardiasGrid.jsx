import { Fragment, useMemo } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { FILA_SIN_CUBRIR, claseCobertura, claveTextoCobertura, filaDeGuardia } from '../../lib/cobertura';

function diasDeGrilla(desde, hasta) {
  const dias = [];
  const inicio = new Date(`${desde}T00:00:00`);
  const fin = new Date(`${hasta}T00:00:00`);
  for (let i = 0; i < 7; i += 1) {
    const f = new Date(inicio);
    f.setDate(f.getDate() + i);
    if (f > fin) break;
    dias.push(f.toISOString().slice(0, 10));
  }
  return dias.length ? dias : [desde];
}

export function GuardiasGrid({ filas, desde, hasta, tieneAlerta, onSeleccionar, onReasignar }) {
  const { t } = useLocale();

  const dias = useMemo(() => diasDeGrilla(desde, hasta), [desde, hasta]);

  // Cada fila de la grilla es un Asistente, salvo una: las guardias que todavía no tienen a
  // nadie se juntan en una fila propia, que va arriba de todo. Se pone primera a propósito —
  // es el trabajo pendiente de la Prestadora, no un renglón más al final de la lista.
  const filasGrilla = useMemo(() => {
    const porId = new Map();
    for (const g of filas) {
      if (!dias.includes(g.fecha)) continue;
      const id = filaDeGuardia(g);
      if (!porId.has(id)) {
        porId.set(id, {
          id,
          nombre: id === FILA_SIN_CUBRIR ? t.guardias.fila_sin_cubrir : g.asistente_nombre,
          sinCubrir: id === FILA_SIN_CUBRIR,
        });
      }
    }
    const conAsistente = Array.from(porId.values())
      .filter((f) => !f.sinCubrir)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const hueco = porId.get(FILA_SIN_CUBRIR);
    return hueco ? [hueco, ...conAsistente] : conAsistente;
  }, [filas, dias, t]);

  const celdas = useMemo(() => {
    const mapa = new Map();
    for (const g of filas) {
      const clave = `${filaDeGuardia(g)}__${g.fecha}`;
      if (!mapa.has(clave)) mapa.set(clave, []);
      mapa.get(clave).push(g);
    }
    return mapa;
  }, [filas]);

  function handleDrop(e, asistenteId, fecha) {
    e.preventDefault();
    // No se puede soltar una guardia en la fila de "sin cubrir": eso sería sacarle el
    // Asistente a una guardia que ya lo tiene, y no es lo mismo que reasignarla. Si la
    // guardia ya empezó, la base directamente lo rechaza.
    if (asistenteId === FILA_SIN_CUBRIR) return;
    const guardiaId = e.dataTransfer.getData('guardiaId');
    if (!guardiaId) return;
    onReasignar(guardiaId, asistenteId, fecha);
  }

  if (filasGrilla.length === 0) {
    return <p className="estado-vacio">{t.guardias.sin_guardias_rango}</p>;
  }

  return (
    <div className="panel-guardias-grid-wrap">
      <div className="panel-guardias-grid">
        <div className="panel-guardias-grid-header panel-guardias-grid-esquina">{t.guardias.col_asistente}</div>
        {dias.map((fecha) => (
          <div key={fecha} className="panel-guardias-grid-header">
            {new Date(`${fecha}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
        ))}

        {filasGrilla.map((fila) => (
          <Fragment key={fila.id}>
            <div className={`panel-guardias-grid-fila-titulo${fila.sinCubrir ? ' panel-guardias-fila-sin-cubrir' : ''}`}>
              {fila.nombre}
            </div>
            {dias.map((fecha) => (
              <div
                key={`${fila.id}-${fecha}`}
                className="panel-guardias-grid-celda"
                onDragOver={(e) => { if (!fila.sinCubrir) e.preventDefault(); }}
                onDrop={(e) => handleDrop(e, fila.id, fecha)}
              >
                {(celdas.get(`${fila.id}__${fecha}`) ?? []).map((g) => (
                  <div
                    key={g.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('guardiaId', g.id)}
                    onClick={() => onSeleccionar(g)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSeleccionar(g);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={
                      fila.sinCubrir
                        ? t.guardias.abrir_detalle_sin_cubrir.replace('{fecha}', g.fecha)
                        : t.guardias.abrir_detalle_para.replace('{asistente}', g.asistente_nombre).replace('{fecha}', g.fecha)
                    }
                    className={`panel-guardia-chip guardia-${g.estado} ${claseCobertura(g)}`}
                  >
                    <strong>{g.hora_inicio}–{g.hora_fin}</strong>
                    <div>{g.paciente_nombre}</div>
                    {fila.sinCubrir && (
                      <div className="panel-guardia-cobertura">{t.guardias[claveTextoCobertura(g)]}</div>
                    )}
                    {tieneAlerta(g) && <div className="panel-guardia-alerta">{t.guardias.alerta_checkin_sin_checkout}</div>}
                  </div>
                ))}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

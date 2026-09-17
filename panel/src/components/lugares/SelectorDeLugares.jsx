import { useMemo, useState } from 'react';
import { con } from '../../lib/textos';
import { useLocale } from '../../i18n/LocaleContext';

/* Elegir lugares.
   ==========================================================================

   El mismo componente en las tres pantallas donde se eligen lugares: qué abarca una zona de
   cobertura, dónde acepta trabajar una Asistente y hasta dónde llega una coordinadora. Escrito una
   sola vez, porque las tres hacen exactamente lo mismo y escrito tres veces se comportaría distinto
   en cada una.

   LO QUE QUEDA GUARDADO SON LUGARES, NUNCA ZONAS. La zona es dos cosas acá: el atajo para marcar
   —se marca entera y después se desmarca lo que no va— y la forma de ordenar la pantalla, porque
   una lista de doscientas localidades sueltas no se lee. Agrupar para mostrar no es lo mismo que
   guardar: si se guardara la zona, una Asistente que cubre dos localidades del norte y una del
   oeste aparecería disponible en todo el norte y todo el oeste.

   UN LUGAR PUEDE ESTAR EN MÁS DE UNA ZONA, y entonces aparece debajo de cada una. La tilde es del
   lugar, así que marcarlo en una zona lo deja marcado en la otra: es el mismo lugar visto dos
   veces, no dos cosas distintas.

   LOS APAGADOS NO SE OFRECEN, pero sí se muestran los que ya estaban elegidos. Un lugar donde la
   Prestadora dejó de trabajar no tiene que aparecer para marcarlo de nuevo; si alguien ya lo tenía
   marcado, esconderlo haría que lo sacara sin enterarse. */
export function SelectorDeLugares({ lugares, zonas, valor, onChange, deshabilitado = false, nombreSinZona }) {
  const { t } = useLocale();
  const [busqueda, setBusqueda] = useState('');

  const elegidos = useMemo(() => new Set(valor ?? []), [valor]);

  // Cómo se llama el grupo del final. Al elegir para una persona son los lugares que todavía no
  // entraron en ninguna zona; al armar una zona no hay zonas con las cuales agrupar, y entonces
  // ese grupo es la lista entera y lo dice quien llama.
  const grupoFinal = nombreSinZona ?? t.configuracion.lugares_sin_zona;

  const grupos = useMemo(
    () => agrupar(lugares ?? [], zonas ?? [], elegidos, busqueda, grupoFinal),
    [lugares, zonas, elegidos, busqueda, grupoFinal],
  );

  function alternar(lugarId) {
    const siguiente = new Set(elegidos);
    if (siguiente.has(lugarId)) siguiente.delete(lugarId);
    else siguiente.add(lugarId);
    onChange([...siguiente]);
  }

  function marcarGrupo(grupo, marcar) {
    const siguiente = new Set(elegidos);
    for (const lugar of grupo.lugares) {
      if (marcar) siguiente.add(lugar.id);
      else siguiente.delete(lugar.id);
    }
    onChange([...siguiente]);
  }

  if (!lugares?.length) {
    return <p className="panel-dato-vacio">{t.configuracion.lugares_sin_lista}</p>;
  }

  return (
    <div>
      <div className="panel-filtros">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={t.configuracion.lugares_buscar}
          aria-label={t.configuracion.lugares_buscar}
        />
        <span className="panel-modulo-fila-origen">
          {con(t.configuracion.lugares_elegidos, { cantidad: elegidos.size })}
        </span>
      </div>

      {grupos.length === 0 && <p className="panel-dato-vacio">{t.configuracion.lugares_sin_resultados}</p>}

      {grupos.map((grupo) => {
        const todosMarcados = grupo.lugares.every((lugar) => elegidos.has(lugar.id));
        return (
          <div key={grupo.id}>
            <div className="panel-form-fila">
              <strong>{grupo.nombre}</strong>
              <button
                type="button"
                onClick={() => marcarGrupo(grupo, !todosMarcados)}
                disabled={deshabilitado}
              >
                {todosMarcados ? t.configuracion.lugares_desmarcar_zona : t.configuracion.lugares_marcar_zona}
              </button>
            </div>
            <div className="panel-modulos-lista">
              {grupo.lugares.map((lugar) => (
                <label key={`${grupo.id}-${lugar.id}`} className="panel-modulo-fila">
                  <span className="panel-modulo-fila-info">
                    <span>{lugar.nombre}</span>
                    <span className="panel-modulo-fila-origen">
                      {[lugar.provincia, lugar.municipio].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={elegidos.has(lugar.id)}
                    onChange={() => alternar(lugar.id)}
                    disabled={deshabilitado}
                    aria-label={con(t.comun.campo_de_fila, { campo: grupo.nombre, nombre: lugar.nombre })}
                  />
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Arma los grupos que se muestran: una zona por grupo, más uno al final con lo que no cayó en
   ninguna. El último existe para que ningún lugar quede invisible por no estar agrupado todavía. */
function agrupar(lugares, zonas, elegidos, busqueda, nombreSinZona) {
  const texto = busqueda.trim().toLowerCase();
  const seOfrece = (lugar) =>
    (lugar.activo !== false || elegidos.has(lugar.id)) &&
    (!texto || String(lugar.nombre ?? '').toLowerCase().includes(texto));

  const porId = new Map(lugares.map((lugar) => [lugar.id, lugar]));
  const agrupados = new Set();
  const grupos = [];

  for (const zona of zonas) {
    const suyos = (zona.lugares ?? [])
      .map((id) => porId.get(id))
      .filter(Boolean);
    for (const lugar of suyos) agrupados.add(lugar.id);
    const visibles = suyos.filter(seOfrece);
    if (visibles.length) grupos.push({ id: zona.id, nombre: zona.nombre, lugares: visibles });
  }

  const sueltos = lugares.filter((lugar) => !agrupados.has(lugar.id)).filter(seOfrece);
  if (sueltos.length) {
    grupos.push({ id: 'sin-zona', nombre: nombreSinZona, lugares: sueltos });
  }
  return grupos;
}

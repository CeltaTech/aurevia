import { useMemo } from 'react';
import { FormField } from '../ui/FormField';
import { useLocale } from '../../i18n/LocaleContext';

/* Elegir UN lugar, para el domicilio de una persona.
   ==========================================================================

   No es lo mismo que `SelectorDeLugares`, y por eso son dos. Aquél elige muchos: dónde acepta
   trabajar una Asistente, qué abarca una zona, hasta dónde llega quien coordina. Éste elige uno
   solo, porque una persona vive en un lugar.

   ES UNA LISTA Y NUNCA TEXTO LIBRE. La localidad ya tiene ficha en la Prestadora: lo que queda
   guardado es cuál, no cómo se llama. Tecleada a mano, «Vicente López» y «Vicente Lopez» son dos
   lugares distintos para el sistema, la Asistente que cubre uno no aparece para el otro, y nadie
   se entera (CLAUDE.md del producto, §6).

   SE AGRUPA POR ZONA para poder leerlo: doscientas localidades sueltas en una lista no se
   encuentran. Agrupar es para mostrar; lo guardado sigue siendo el lugar.

   LOS APAGADOS NO SE OFRECEN, salvo el que ya estaba elegido. Si la Prestadora dejó de trabajar
   ahí, no tiene que aparecer para elegirlo de nuevo; pero esconder el que la ficha ya tenía lo
   borraría sin que nadie lo pida.

   LA LISTA LLEGA DE AFUERA, no la pide este componente. Una pantalla puede necesitar el mismo
   catálogo para otra cosa —armar el renglón del domicilio, por ejemplo—, y pidiéndolo adentro se
   lo traería dos veces. */
export function ElegirUnLugar({ lugares, zonas, estado, valor, onChange, label, name = 'lugar_id', requerido = false, deshabilitado = false, error }) {
  const { t } = useLocale();

  const grupos = useMemo(() => agrupar(lugares, zonas, valor, t.configuracion.lugares_sin_zona), [lugares, zonas, valor, t]);

  // Mientras carga se deja el casillero apagado en lugar de esconderlo: el formulario no cambia de
  // forma a mitad de camino, y quien estaba escribiendo no ve saltar los campos de abajo.
  const cargando = estado === 'cargando';
  const sinLista = estado === 'listo' && !lugares?.length;

  return (
    <FormField
      type="select"
      label={label ?? t.comun.domicilio_lugar}
      name={name}
      required={requerido}
      value={valor ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={deshabilitado || cargando || sinLista}
      error={error}
    >
      <option value="">{t.comun.domicilio_lugar_ninguno}</option>
      {grupos.map((grupo) => (
        <optgroup key={grupo.id} label={grupo.nombre}>
          {grupo.lugares.map((lugar) => (
            <option key={`${grupo.id}-${lugar.id}`} value={lugar.id}>
              {lugar.nombre}
            </option>
          ))}
        </optgroup>
      ))}
    </FormField>
  );
}

/* Una zona por grupo, más uno al final con los lugares que todavía no entraron en ninguna. Un lugar
   que está en dos zonas se ofrece debajo de las dos: es el mismo lugar visto dos veces, y elegirlo
   por un camino o por el otro guarda lo mismo. */
function agrupar(lugares, zonas, elegido, nombreSinZona) {
  const seOfrece = (lugar) => lugar.activo !== false || lugar.id === elegido;

  const porId = new Map((lugares ?? []).map((lugar) => [lugar.id, lugar]));
  const agrupados = new Set();
  const grupos = [];

  for (const zona of zonas ?? []) {
    const suyos = (zona.lugares ?? []).map((id) => porId.get(id)).filter(Boolean);
    for (const lugar of suyos) agrupados.add(lugar.id);
    const visibles = suyos.filter(seOfrece);
    if (visibles.length) grupos.push({ id: zona.id, nombre: zona.nombre, lugares: visibles });
  }

  const sueltos = (lugares ?? []).filter((lugar) => !agrupados.has(lugar.id)).filter(seOfrece);
  if (sueltos.length) grupos.push({ id: 'sin-zona', nombre: nombreSinZona, lugares: sueltos });

  return grupos;
}

// El domicilio, escrito de forma que tocarlo abra el mapa del teléfono.
//
// Antes cada pantalla dibujaba la dirección como texto suelto: el Asistente que está por salir
// hacia una casa tenía que copiarla a mano a su aplicación de mapas, parado en la calle y con el
// turno por empezar. Ahora se toca y se abre, y el que decide con qué aplicación es el teléfono.
//
// CUANDO NO HAY ADÓNDE IR SE DIBUJA EL TEXTO Y NADA MÁS. Un enlace que no lleva a ningún lado es
// peor que ninguno: se toca, no pasa nada, y quien lo tocó no sabe si falló el teléfono o si el
// dato no estaba. La decisión de si hay adónde ir la toma `enlaceAlMapa`, una sola vez, y esta
// pantalla no la vuelve a escribir.
//
// Los textos salen de `t.domicilio`, que existe con las mismas claves en las dos aplicaciones.

import { enlaceAlMapa } from '../lib/enlaceAlMapa';
import { con } from '../lib/textos';

export default function EnlaceAlMapa({ lugar, t }) {
  const texto = typeof lugar?.domicilio === 'string' ? lugar.domicilio.trim() : '';
  const destino = enlaceAlMapa(lugar);
  if (!destino) return <>{texto || '—'}</>;
  return (
    <a href={destino} className="enlace-mapa" aria-label={con(t.domicilio.abrir_en_mapa, { domicilio: texto })}>
      {texto || t.domicilio.ver_en_el_mapa}
    </a>
  );
}

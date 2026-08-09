// La marca que ven la Familia y el Asistente.
//
// Acá hay tres marcas y no se mezclan: CeltaTech es la empresa y no la ve
// nadie dentro del producto; Careonys es el producto y lo ve quien trabaja en
// la Prestadora; y la Prestadora es la que contrataron la Familia y el
// Asistente. En toda pantalla, correo o aviso dirigido a esos dos últimos, la
// marca principal es la de **su** Prestadora (`CLAUDE.md` §7, regla 1).
//
// Este archivo es el único lugar que la busca. Existe por la regla 12: la
// misma pregunta la hacen las dos aplicaciones, el correo de activación y los
// avisos que llegan al teléfono, y si cada uno la resolviera por su cuenta,
// el día que cambie algo se cambiaría en tres lados y se olvidaría el cuarto.

import { supabase } from '../db/connection.js';

// Devuelve el nombre visible, el logo y si va la línea del producto al pie.
//
// `mostrarMarcaProducto` es lo que decide si al pie se lee "con la tecnología
// de Careonys". Se muestra siempre, salvo que la Prestadora tenga contratada
// la función que la apaga; quien contesta esa pregunta es una sola función de
// la base, `prestadora_oculta_marca_producto`.
//
// Si la Prestadora no aparece —cosa que no debería pasar, pero pasa cuando un
// dato quedó a medio cargar— se devuelve la marca vacía y la línea encendida.
// El encabezado se queda sin nombre por un rato; lo que no puede pasar es que
// una pantalla se caiga por esto.
export async function marcaDeLaPrestadora(prestadoraId) {
  if (!prestadoraId) {
    return { nombre: null, logoUrl: null, mostrarMarcaProducto: true };
  }

  const { data: prestadora } = await supabase
    .from('prestadoras')
    .select('nombre_fantasia, logo_url')
    .eq('id', prestadoraId)
    .maybeSingle();

  const { data: oculta } = await supabase.rpc('prestadora_oculta_marca_producto', {
    p_prestadora_id: prestadoraId,
  });

  return {
    nombre: prestadora?.nombre_fantasia ?? null,
    logoUrl: prestadora?.logo_url ?? null,
    mostrarMarcaProducto: oculta !== true,
  };
}

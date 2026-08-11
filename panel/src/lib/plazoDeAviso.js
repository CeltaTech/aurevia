// ---------------------------------------------------------------------------
// plazoDeAviso.js — con cuántos días de anticipación avisa esta Prestadora
//
// POR QUÉ EXISTE
// Tres pantallas necesitaban el mismo número y cada una lo pedía a su manera:
// dos se lo pedían al motor por una puerta que solo abre para Administrador o
// más, y la tercera lo leía derecho de la base. Para una Coordinadora las dos
// primeras fallaban y se quedaban con el valor de arranque, así que la misma
// Prestadora que configuró 60 días veía el tablero contado con 30. Un número,
// una forma de pedirlo (regla 12 de CLAUDE.md §7).
//
// POR QUÉ SE LEE DE LA BASE Y NO DEL MOTOR
// Porque es la única forma que funciona para los tres roles que miran estas
// pantallas. La base ya deja que cada quien vea la ficha de su propia
// Prestadora y de ninguna otra; igual se pide por id, escrito, porque filtrar
// por Prestadora nunca se deja librado a que el candado de la base lo haga solo.
//
// La cuenta de qué está por vencer no está acá: está en `reglaVencimientos.js`,
// que no habla con la base y por eso puede vivir igual en las tres aplicaciones.
// ---------------------------------------------------------------------------

import { supabase } from './supabaseClient';
import { DIAS_AVISO_POR_DEFECTO } from './reglaVencimientos';

/**
 * Los días de anticipación configurados por la Prestadora.
 *
 * Nunca falla: si la consulta no vuelve, devuelve el valor de arranque. Que no se pueda leer la
 * configuración no puede voltear una pantalla entera — se avisa con el plazo de siempre, que es
 * el mismo con el que nace toda Prestadora nueva.
 */
export async function diasDeAvisoDeLaPrestadora(prestadoraId) {
  if (!prestadoraId) return DIAS_AVISO_POR_DEFECTO;

  const { data } = await supabase
    .from('prestadoras')
    .select('dias_aviso_vencimiento_documentos')
    .eq('id', prestadoraId)
    .single();

  return data?.dias_aviso_vencimiento_documentos ?? DIAS_AVISO_POR_DEFECTO;
}

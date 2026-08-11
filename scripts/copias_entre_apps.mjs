// ---------------------------------------------------------------------------
// copias_entre_apps.mjs — la lista de archivos que existen más de una vez
//
// Este archivo no hace nada solo: es la lista que usan los otros dos.
//   - scripts/sincronizar_copias.mjs  copia el original encima de las copias.
//   - scripts/verificar_identidad.mjs falla el build si alguna se despegó.
//
// POR QUÉ HAY COPIAS Y NO UN IMPORT COMPARTIDO
// Cada carpeta de acá se despliega por su cuenta y sin ver el resto del repo:
// `railway up` sube solo backend/, y cada frontend se sube a Cloudflare Pages
// desde su propia carpeta. Un archivo compartido arriba de todas no viajaría.
// La regla 12 de CLAUDE.md pide un solo punto de verdad; cuando la plataforma
// no lo permite, el punto de verdad es el original y las copias se mantienen
// honestas por máquina, nunca a mano.
//
// CÓMO SE AGREGA UN GRUPO NUEVO
// Se escribe acá abajo y listo: los dos scripts lo toman solos.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

export const GRUPOS = [
  {
    que: 'la identidad del producto',
    original: 'backend/src/config/identidadProducto.js',
    copias: [
      'panel/src/config/identidadProducto.js',
      'pwa-asistentes/src/config/identidadProducto.js',
      'pwa-familias/src/config/identidadProducto.js',
      'sitio-web/src/config/identidadProducto.js',
    ],
  },
  {
    que: 'el traductor de mensajes de error',
    original: 'panel/src/lib/errores.js',
    copias: ['pwa-asistentes/src/lib/errores.js', 'pwa-familias/src/lib/errores.js'],
  },
  {
    que: 'la regla de cuándo algo está por vencer',
    original: 'panel/src/lib/reglaVencimientos.js',
    copias: ['pwa-asistentes/src/lib/reglaVencimientos.js', 'backend/src/utils/reglaVencimientos.js'],
  },
];

// Todas las rutas de todos los grupos, original incluido. La usan los chequeos
// que necesitan saber qué archivos son copias.
export const TODAS_LAS_RUTAS = GRUPOS.flatMap((g) => [g.original, ...g.copias]);

/**
 * Devuelve las copias que ya no son idénticas a su original.
 * Cada elemento es { que, original, copia }.
 */
export function copiasDespegadas() {
  const despegadas = [];
  for (const grupo of GRUPOS) {
    const original = readFileSync(join(RAIZ, grupo.original), 'utf8');
    for (const copia of grupo.copias) {
      let actual = null;
      try {
        actual = readFileSync(join(RAIZ, copia), 'utf8');
      } catch {
        // no existe todavía: cuenta como despegada
      }
      if (actual !== original) despegadas.push({ que: grupo.que, original: grupo.original, copia });
    }
  }
  return despegadas;
}

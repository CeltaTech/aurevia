// ---------------------------------------------------------------------------
// construir.mjs — arma sitio-web/dist/ listo para publicar
//
// Uso, desde la raíz del repo:
//   node sitio-web/construir.mjs
//
// Esto no es una aplicación: es una sola página estática. No tiene React, ni
// Vite, ni dependencias. Lo único que hace falta "construir" es reemplazar los
// marcadores {{producto}} / {{productoCorto}} / {{dominio}} del index.html por
// los valores de identidadProducto.js, que es exactamente lo que hacen las tres
// aplicaciones en su vite.config.js. Sin este paso el nombre del producto habría
// que escribirlo a mano, y eso lo prohíbe CLAUDE.md §7 regla 1 (y lo caza
// scripts/verificar_identidad.mjs).
//
// Publicar lo que quede en dist/:
//   npx wrangler pages deploy sitio-web/dist --project-name=careonys-sitio
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aplicarIdentidad } from './src/config/identidadProducto.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const DESTINO = join(AQUI, 'dist');

mkdirSync(DESTINO, { recursive: true });

// 1. La página, con los marcadores ya resueltos.
const html = aplicarIdentidad(readFileSync(join(AQUI, 'index.html'), 'utf8'));
if (html.includes('{{')) {
  throw new Error('Quedaron marcadores sin resolver en index.html — revisar aplicarIdentidad().');
}
writeFileSync(join(DESTINO, 'index.html'), html, 'utf8');
console.log('  ✓ index.html');

// 2. El ícono. Sale del Panel para no tener dos archivos de marca distintos
//    dando vueltas; el contrato de qué archivos de marca existen es docs/MARCA.md.
const ICONO_ORIGEN = join(RAIZ, 'panel', 'public', 'favicon.svg');
if (existsSync(ICONO_ORIGEN)) {
  copyFileSync(ICONO_ORIGEN, join(DESTINO, 'favicon.svg'));
  console.log('  ✓ favicon.svg');
} else {
  console.warn('  ! No se encontró panel/public/favicon.svg — la página sale sin ícono');
}

// 3. Cualquier dirección de este dominio muestra la misma página. Mientras esto
//    sea una página de obra, entrar a /servicios no tiene que dar un 404 feo.
//    El 200 (y no un 301) es a propósito: no queremos que un buscador registre
//    redirecciones permanentes que después haya que deshacer.
writeFileSync(join(DESTINO, '_redirects'), '/*  /index.html  200\n', 'utf8');
console.log('  ✓ _redirects');

console.log(`\nListo. Carpeta para publicar: ${DESTINO}`);

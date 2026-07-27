import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { IDENTIDAD, aplicarIdentidad } from './src/config/identidadProducto.js';

// index.html no pasa por i18n ni por React — es lo primero que ve el navegador, antes de que
// cargue nada. Sus marcadores {{producto}} se resuelven acá, en tiempo de compilación.
function identidadEnHtml() {
  return {
    name: 'identidad-en-html',
    transformIndexHtml: (html) => aplicarIdentidad(html),
  };
}

export default defineConfig({
  plugins: [
    react(),
    identidadEnHtml(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png'],
      // injectManifest (no generateSW): el service worker necesita manejar el evento 'push'
      // (notificaciones push a Asistentes) además del precache del shell de la app.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // El manifiesto se arma desde la identidad del producto: es lo que queda escrito bajo
      // el ícono cuando alguien instala la PWA en su teléfono. El sufijo por app y la
      // descripción son texto propio de esta app, no del producto, y siguen acá — el
      // manifiesto se compila en un solo idioma y no pasa por i18n.
      manifest: {
        name: `${IDENTIDAD.nombre} — Familias`,
        short_name: IDENTIDAD.nombreCorto,
        description: `App para que las Familias sigan el servicio de sus Pacientes en ${IDENTIDAD.nombre}`,
        theme_color: IDENTIDAD.colorPrimario,
        background_color: IDENTIDAD.colorFondo,
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // Nunca cachear llamadas a la API (datos de guardias/reportes cambian todo el
        // tiempo y son sensibles) — el precache es solo para el shell de la app.
        globPatterns: ['**/*.{js,css,html,svg}'],
      },
    }),
  ],
});

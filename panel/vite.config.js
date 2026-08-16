import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { aplicarIdentidad } from './src/config/identidadProducto.js'

// index.html no pasa por i18n ni por React — es lo primero que ve el navegador, antes de que
// cargue nada. Sus marcadores {{producto}} se resuelven acá, en tiempo de compilación, igual
// que en las dos aplicaciones del teléfono (CLAUDE.md §7 regla 1: el nombre del producto
// nunca se escribe a mano).
function identidadEnHtml() {
  return {
    name: 'identidad-en-html',
    transformIndexHtml: (html) => aplicarIdentidad(html),
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), identidadEnHtml()],
})

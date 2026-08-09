import { precacheAndRoute } from 'workbox-precaching';
import { leerMarcaGuardada } from './lib/marcaGuardada.js';

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Notificaciones push a Familias — docs/PRD_04_05_App_Servicio.md:58,76 (Asistente llegó al
// domicilio, reporte confirmado, alerta ROJA). El payload lo arma el backend
// (backend/src/utils/push.js) como { titulo, cuerpo, url }.
//
// El nombre que encabeza el aviso es el de la Prestadora, no el del producto: es a ella a
// quien la Familia llamó (`CLAUDE.md` §7, regla 1). Como acá no hay sesión abierta, se lee
// del depósito que dejó la aplicación (lib/marcaGuardada.js).
self.addEventListener('push', (event) => {
  event.waitUntil(mostrarAviso(event));
});

async function mostrarAviso(event) {
  let datos = { titulo: '', cuerpo: '' };
  try {
    datos = event.data.json();
  } catch {
    // payload no vino en formato JSON, se usa el título/cuerpo por defecto
  }

  const marca = await leerMarcaGuardada();

  await self.registration.showNotification(datos.titulo || marca?.nombre || '', {
    body: datos.cuerpo || '',
    icon: '/favicon.svg',
    data: { url: datos.url || '/' },
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientes) => {
      const clienteAbierto = clientes.find((cliente) => cliente.url.includes(self.location.origin));
      if (clienteAbierto) {
        clienteAbierto.focus();
        clienteAbierto.navigate(url);
        return;
      }
      self.clients.openWindow(url);
    })
  );
});

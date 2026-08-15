/// <reference lib="webworker" />
export {};
declare const self: ServiceWorkerGlobalScope;

import { precacheAndRoute } from 'workbox-precaching';

// vite-plugin-pwa (estrategia injectManifest) reemplaza esto con la lista
// real de archivos a precachear en el build.
precacheAndRoute(self.__WB_MANIFEST);

interface ReminderPayload {
  title: string;
  body: string;
}

self.addEventListener('push', (event) => {
  let payload: ReminderPayload = { title: 'Taller de Ilustración', body: '¡Tienes un recordatorio!' };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // Payload no era JSON válido — se usa el mensaje genérico de arriba en
    // vez de tronar el service worker.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});

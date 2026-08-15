import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // injectManifest (en vez del generateSW por default) porque el
      // recordatorio diario necesita código propio de service worker
      // (eventos push / notificationclick) — ver src/sw.ts.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Taller de Ilustración',
        short_name: 'Taller',
        description: 'Curso de ilustración con feedback de un mentor de IA',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/graphql': 'http://localhost:4000',
      '/upload': 'http://localhost:4000',
      '/auth': 'http://localhost:4000',
      '/push': 'http://localhost:4000',
    },
  },
});

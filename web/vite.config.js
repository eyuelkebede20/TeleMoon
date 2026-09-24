import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [react(), VitePWA({ registerType: 'autoUpdate', devOptions: { enabled: true }, manifest: { name: 'TeleMoon Drive', short_name: 'TeleMoon', description: 'Your private Telegram-backed cloud drive', theme_color: '#1a1b1e', background_color: '#1a1b1e', display: 'standalone', icons: [{ src: '/moon.svg', sizes: '192x192', type: 'image/svg+xml' }, { src: '/moon.svg', sizes: '512x512', type: 'image/svg+xml' }] } })],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8080" },
  },
});

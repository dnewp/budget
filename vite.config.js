import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Express server (server/index.js) mounts Vite in middleware mode for dev,
// so there is no separate Vite port and no /api proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    // Vite rejects unfamiliar Host headers to guard against DNS rebinding. Quick
    // Cloudflare tunnels get a random hostname every run, so allow that domain in
    // order to test on a real phone. Dev only: production serves the built files
    // from Express and never runs Vite.
    allowedHosts: ['.trycloudflare.com', 'localhost'],
  },
})

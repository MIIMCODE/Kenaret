import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The site is deployed to GitHub Pages under https://miimcode.github.io/Kenaret/
// `base` must match that sub-path so every asset resolves correctly.
export default defineConfig({
  base: '/Kenaret/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow the Arena preview proxy host (and any *.e2b.app) to reach the dev server.
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          jalali: ['jalaali-js'],
        },
      },
    },
  },
})

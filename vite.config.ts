import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The site is deployed to GitHub Pages under https://miimcode.github.io/Kenaret/
// `base` must match that sub-path so every asset resolves correctly.
export default defineConfig({
  base: '/Kenaret/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})

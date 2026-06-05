import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../school-bells-server/public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/announce': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    }
  }
})

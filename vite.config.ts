import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/shield-api': {
        target: 'https://api.testnet.swap.shield.fi',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/shield-api/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})

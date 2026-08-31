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
      // The Aleo node needs proxying for the same reason as the DEX API: the
      // browser blocks the cross-origin read, which takes down every chain read
      // the quote depends on.
      '/aleo-api': {
        target: 'https://api.provable.com/v2',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/aleo-api/, ''),
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

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: './index.html',
        adminsida: './adminsida.html',
        demo: './demo.html',
      },
    },
  },
  server: {
    port: 3000,
  },
});
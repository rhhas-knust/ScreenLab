import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // Chromebooks that no longer get updates can be several Chrome versions behind:
  // emit JavaScript and CSS those browsers understand.
  build: { chunkSizeWarningLimit: 1000, target: ['chrome90', 'edge90', 'firefox90', 'safari15'], cssTarget: 'chrome90' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
} as never);

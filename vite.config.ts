import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/studio/client'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'skills/agent-world/studio/dist'),
    emptyOutDir: true
  }
});

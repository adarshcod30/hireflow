/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/test/**', 'src/types.ts', 'src/**/*.test.{ts,tsx}'],
      reporter: ['text-summary', 'text', 'lcov'],
      thresholds: { statements: 80, branches: 70, functions: 75, lines: 80 },
    },
  },
});

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
      // Measured at 97.9 / 95.6 / 97.1 / 98.7. The gate sits just below, so a drop fails the build.
      thresholds: { statements: 95, branches: 92, functions: 95, lines: 96 },
    },
  },
});

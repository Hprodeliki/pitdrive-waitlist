import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Testes de integração usam um Postgres real e compartilham tabelas.
    fileParallelism: false,
  },
});

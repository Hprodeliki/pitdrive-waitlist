import { defineConfig, devices } from '@playwright/test';

// E2E contra o build de produção (vite preview + /api local) e um Postgres de teste.
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/pitdrive_test';

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [
    // Emulação de viewport/toque/user agent. Safari real (WebKit) precisa ser conferido num iPhone.
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/lista-de-espera',
    reuseExistingServer: false,
    env: { DATABASE_URL: DB, IP_HASH_SALT: 'e2e-salt' },
  },
});

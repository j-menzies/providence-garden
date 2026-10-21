import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  timeout: 60000,
  use: { baseURL: 'http://localhost:4173/providence-garden/', launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173/providence-garden/', reuseExistingServer: true },
});

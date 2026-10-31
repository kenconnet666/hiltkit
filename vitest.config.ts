import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'hiltkit' } },
  resolve: { conditions: ['@hiltkit/source', ...defaultClientConditions] },
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});

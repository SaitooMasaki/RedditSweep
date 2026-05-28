const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname);

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 30_000,
  retries: 1,

  // E2E tests run sequentially (extension state is shared)
  workers: 1,

  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  use: {
    // Chrome with extension loaded
    // Note: extensions require headless:false, or --headless=new (Chrome 112+)
    browserName: 'chromium',
    launchOptions: {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
      ],
    },
    // Capture artifacts on failure
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chrome-extension',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

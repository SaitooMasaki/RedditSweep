module.exports = {
  testEnvironment: 'jsdom',

  // Chrome API mocks are loaded before every test file
  setupFiles: ['jest-webextension-mock'],
  setupFilesAfterEnv: ['./tests/unit/setup.js'],

  testMatch: ['**/tests/unit/**/*.test.js'],

  // Show coverage for core logic files only
  collectCoverageFrom: [
    'background.js',
    'content.js',
    '!**/node_modules/**',
  ],

  // Human-readable output
  verbose: true,
};

// npm test. Everything tested so far is plain logic (src/core, src/api, src/state) and runs under Node, against Sinko's fixtures and,
// for the network tests, against the mock box (mock/), which needs ../sinko and python3.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
  testTimeout: 30000,
};

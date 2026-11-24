// ESLint for the dashboard code: rules that find mistakes (a name that doesn't exist, an import nobody uses, a key
// written twice), none about style. Dev-only; nothing here ships to a screen.
// Run from the repository root, which is what the paths below are relative to:
//   engine/_dev/node_modules/.bin/eslint -c engine/_dev/eslint.config.mjs engine sites tools
import js from '@eslint/js';
import globals from 'globals';

// Mistakes, in every kind of file.
const rules = {
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-prototype-builtins': 'off',
  'no-implicit-globals': 'error',
};

// Properties of window that read like ordinary variable names. Without this a forgotten declaration (`name`, `status`,
// `event`, `top` …) is not an undefined name: the code quietly reads the window's. Write window.name when it is meant.
const windowNames = ['name', 'status', 'event', 'length', 'top', 'parent', 'self', 'closed', 'origin', 'external', 'frames',
  'opener', 'screen', 'find', 'stop', 'open', 'close', 'print', 'scroll', 'focus', 'blur']
  .map((name) => ({ name, message: `Not declared here, so this is window.${name}. Declare it, or write window.${name}.` }));

export default [
  // third-party and generated files
  { ignores: ['**/vendor/**', '**/node_modules/**', 'engine/icons.js'] },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,

  // What a screen runs: ES modules in a browser. L (Leaflet), Hls (hls.js) and qrcode come from vendor/ scripts.
  {
    files: ['engine/**/*.js', 'sites/*/dash/**/*.js'],
    ignores: ['engine/_dev/**', 'engine/boot.js'],
    languageOptions: {
      ecmaVersion: 2022, sourceType: 'module',
      globals: { ...globals.browser, L: 'readonly', Hls: 'readonly', qrcode: 'readonly' },
    },
    rules: { ...rules, 'no-restricted-globals': ['error', ...windowNames] },
  },
  // The loader is a classic script, not a module: it writes the import map the modules are loaded through.
  {
    files: ['engine/boot.js'],
    languageOptions: { ecmaVersion: 2019, sourceType: 'script', globals: globals.browser },
    rules: { ...rules, 'no-restricted-globals': ['error', ...windowNames] },
  },
  // Dev tools, mock data, tests and checks: Node modules; the Playwright scripts also hold functions that run in the page.
  {
    files: ['engine/_dev/**/*.{js,mjs}', 'tools/**/*.mjs', 'phone/*/dev/**/*.mjs', 'sites/*/mock/**/*.{js,mjs}', 'sites/*/checks/**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules,
  },
];

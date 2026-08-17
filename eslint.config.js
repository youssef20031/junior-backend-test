const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier');
const globals = require('globals');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Config files are plain CommonJS, where `require()` is the correct idiom
    // rather than a lint error.
    files: ['*.js'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: 'commonjs' },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // challenge-2/queries.mongo.js runs inside mongosh, not Node, so it gets the
    // shell's globals instead.
    files: ['challenge-2/**/*.js'],
    languageOptions: {
      globals: { db: 'readonly', print: 'readonly', printjson: 'readonly' },
      parserOptions: { sourceType: 'script' },
    },
  },
  prettier,
);

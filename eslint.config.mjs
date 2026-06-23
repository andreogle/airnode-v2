import { defineConfig, globalIgnores } from 'eslint/config';
import functionalPlugin from 'eslint-plugin-functional';
import importPlugin from 'eslint-plugin-import-x';
import promisePlugin from 'eslint-plugin-promise';
import unicornPlugin from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    'book/',
    'contracts/cache/',
    'contracts/lib/',
    'contracts/out/',
    'coverage/',
    'dist/',
    'examples/plugins/*/dist/',
    'examples/plugins/*/node_modules/',
  ]),

  ...tseslint.configs.strictTypeChecked,
  unicornPlugin.configs.recommended,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  promisePlugin.configs['flat/recommended'],

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    plugins: {
      functional: functionalPlugin,
      'import-x': importPlugin,
    },

    settings: {
      'import-x/resolver': {
        typescript: true,
        node: true,
      },
    },

    rules: {
      // --- TypeScript strict overrides ---
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],

      // --- Early returns, no else ---
      'no-else-return': ['error', { allowElseIf: false }],

      // --- General strict rules ---
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-return-await': 'error',
      'no-throw-literal': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-template': 'error',

      // --- Functional style (no mutations) ---
      'functional/immutable-data': ['error', { ignoreClasses: true }],
      'functional/no-let': 'error',
      'functional/no-loop-statements': 'error',

      // --- Unicorn overrides ---
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/name-replacements': 'off',
      // Conflicts with functional/no-loop-statements (recursion replaces loops).
      'unicorn/no-useless-recursion': 'off',
      // Conflicts with the no-else / early-return style (wants `else if`).
      'unicorn/prefer-else-if': 'off',
      // Conflicts with the no-try/catch convention and deliberate promise
      // combinators used to cache and race promises.
      'unicorn/prefer-await': 'off',

      // --- Import ordering (alphabetical) ---
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          alphabetize: { order: 'asc', caseInsensitive: true },
          'newlines-between': 'never',
        },
      ],
      'import-x/no-duplicates': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-cycle': ['error', { maxDepth: 4 }],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      ...Object.fromEntries(Object.keys(functionalPlugin.rules).map((rule) => [`functional/${rule}`, 'off'])),
      // Standard async fixture pattern: `let ctx; beforeAll(() => { ctx = ... })`.
      'unicorn/no-top-level-assignment-in-function': 'off',
      // Tests mock process globals (e.g. fetch) and nest calls in assertions.
      'unicorn/no-global-object-property-assignment': 'off',
      'unicorn/max-nested-calls': 'off',
    },
  },

  {
    // CLI command modules build commander.js commands at module load.
    files: ['src/cli/**/*.ts'],
    rules: { 'unicorn/no-top-level-side-effects': 'off' },
  },
]);

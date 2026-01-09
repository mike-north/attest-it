import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
import nodePlugin from 'eslint-plugin-n'
import securityPlugin from 'eslint-plugin-security'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      n: nodePlugin,
      security: securityPlugin,
    },
    rules: {
      // Allow underscore-prefixed unused variables and parameters
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      // Allow ++ and -- operators
      'no-plusplus': 'off',

      // Strict: No any types
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // Strict: No type assertions (use type guards or generics instead)
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        {
          assertionStyle: 'never',
        },
      ],

      // Node.js rules
      'n/no-unsupported-features/node-builtins': 'error',
      'n/no-deprecated-api': 'error',

      // Security rules
      'security/detect-object-injection': 'warn',
      // Disable non-literal fs filename check - this is a file I/O library that
      // intentionally accepts user-provided file paths as part of its API
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-require': 'error',
      'security/detect-possible-timing-attacks': 'warn',
    },
  },
  prettierConfig,
  {
    // Disable security/detect-object-injection for test files (false positives in controlled test code)
    files: ['**/test/**', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.vite/**',
      '**/.nx/**',
      '**/tsup.config.ts',
    ],
  },
)

// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import aetherConfig from '@aether/config/eslint-preset.cjs';

const { sharedIgnores } = aetherConfig;

// Standard NestJS v11 CLI-generated flat config (matches the devDependency
// set already in package.json — @eslint/js, typescript-eslint,
// eslint-plugin-prettier — which existed with no eslint.config.mjs to use
// them), plus the ignore patterns shared with apps/web via @aether/config.
// Deliberately `tseslint.configs.recommended` rather than
// `recommendedTypeChecked`: the type-aware ruleset would need auditing
// hundreds of pre-existing files for a first pass, which is a separate,
// much larger effort than "get a working lint config in place."
export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  sharedIgnores,
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // NestJS's constructor-injection + decorator-heavy style leans on
      // `any` at framework/driver boundaries (raw pg query results,
      // dynamic DTO/details bags) more than typical TS code — same
      // default every NestJS-generated eslint.config.mjs ships with.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
);

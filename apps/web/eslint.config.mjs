import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import aetherConfig from '@aether/config/eslint-preset.cjs';

const { sharedIgnores } = aetherConfig;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// Standard create-next-app-generated flat config (matches the
// @eslint/eslintrc + eslint-config-next devDependencies already in
// package.json, which existed with no eslint.config.mjs to use them),
// plus the ignore patterns shared with apps/api via @aether/config.
const eslintConfig = [
  sharedIgnores,
  // Next's own generated file ("This file should not be edited" — its own
  // header comment) — its triple-slash references are how Next wires up
  // its own ambient types, not something to lint.
  { ignores: ['next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default eslintConfig;

// Shared ESLint flat-config pieces for apps/api (NestJS) and apps/web
// (Next.js) — the two ecosystems need different rule sets (Node/Nest vs.
// React/Next) and only apps/api has a Prettier integration today, so this
// only holds what's genuinely common to both: ignore patterns for build/
// generated output. Each app's own eslint.config.mjs spreads
// `sharedIgnores` in alongside its ecosystem-specific config.
'use strict';

const sharedIgnores = {
  ignores: [
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/*.generated.ts',
    '**/generated.ts',
  ],
};

module.exports = { sharedIgnores };

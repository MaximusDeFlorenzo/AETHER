// Generated types land in ./generated.ts. Regenerate with
// `pnpm run generate` (root) or `pnpm --filter @aether/contracts generate`
// directly — this runs `apps/api`'s `generate:openapi` first (writes
// apps/api/openapi.json via a standalone Nest bootstrap, no server process
// needed) then points openapi-typescript at that static file. CI runs this
// on every build and fails if `generated.ts` doesn't match what's committed
// (see .github/workflows/ci.yml), so drift can't silently creep in.
//
// Re-export hand-written domain enums here that both apps/web and apps/api
// need before the generator has ever been run, to avoid a chicken-and-egg
// bootstrap problem on a fresh clone.

export type HazardType = 'earthquake' | 'flood' | 'landslide' | 'wildfire';

export type ExposureLevel = 'low' | 'moderate' | 'high' | 'severe';

export type PriorityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface DecisionReason {
  factor: string;
  detail: string;
  weight: number | null;
}

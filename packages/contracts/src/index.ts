// Generated types land in ./generated.ts via `pnpm --filter @aether/contracts generate`
// (requires apps/api running locally so its OpenAPI/Swagger doc is reachable).
// Re-export hand-written domain enums here that both apps/web and apps/api need
// before the generator has ever been run, to avoid a chicken-and-egg bootstrap
// problem on a fresh clone.

export type HazardType = 'earthquake' | 'flood' | 'landslide' | 'wildfire';

export type ExposureLevel = 'low' | 'moderate' | 'high' | 'severe';

export type PriorityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface DecisionReason {
  factor: string;
  detail: string;
  weight: number | null;
}

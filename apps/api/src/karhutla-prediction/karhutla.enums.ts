// Kept beside the feature (like public-alerts/public-alert.enums.ts) rather
// than in common/enums/domain.enum.ts — nothing outside this module uses them.

export enum KarhutlaRunStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  // Finished, but at least one cluster failed or lacked data.
  PARTIAL = 'partial',
  FAILED = 'failed',
}

export enum KarhutlaRunTrigger {
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
}

export enum KarhutlaForecastStatus {
  OK = 'ok',
  // Some horizons/engines produced output, others lacked data or failed.
  PARTIAL = 'partial',
  INSUFFICIENT_DATA = 'insufficient_data',
  FAILED = 'failed',
}

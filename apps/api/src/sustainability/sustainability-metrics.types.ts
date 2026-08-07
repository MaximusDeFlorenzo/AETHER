export interface SdgIndicatorValue {
  goal: string;
  label: string;
  score: number;
  target: number;
}

export interface SustainabilityMetricsResponse {
  district: {
    id: string;
    bpsCode: string;
    name: string;
    areaKm2: number | null;
  } | null;
  periodStart: string;
  periodEnd: string;
  climateResilienceScore: number;
  carbonReductionEstimateTons: number;
  protectedPopulation: number;
  responseEfficiencyScore: number;
  sdgIndicators: SdgIndicatorValue[];
}

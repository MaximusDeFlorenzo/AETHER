export enum HazardType {
  EARTHQUAKE = 'earthquake',
  FLOOD = 'flood',
  LANDSLIDE = 'landslide',
  WILDFIRE = 'wildfire',
}

export enum ExposureLevel {
  LOW = 'low',
  MODERATE = 'moderate',
  HIGH = 'high',
  SEVERE = 'severe',
}

export enum RiskAssessmentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum PriorityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum NotificationType {
  NEW_HAZARD_EVENT = 'new_hazard_event',
  HIGH_RISK_ASSESSMENT = 'high_risk_assessment',
  HAZARD_RELATIONSHIP_DETECTED = 'hazard_relationship_detected',
  SYSTEM = 'system',
}

// Cascading-hazard link semantics (docs/DATABASE_SCHEMA.md §16): 'triggers'
// (e.g. earthquake -> landslide), 'exacerbates' (compounds an existing
// hazard's impact), 'coincides' (correlated but no causal direction implied).
export enum HazardRelationshipType {
  TRIGGERS = 'triggers',
  EXACERBATES = 'exacerbates',
  COINCIDES = 'coincides',
}

// Computer Vision Engine detection categories (docs/DATABASE_SCHEMA.md §22).
export enum CvDetectionType {
  FLOOD = 'flood',
  SMOKE = 'smoke',
  FIRE = 'fire',
  INFRA_DAMAGE = 'infra_damage',
}

export enum HazardEventSource {
  BMKG_AUTOGEMPA = 'bmkg_autogempa',
  BMKG_GEMPATERKINI = 'bmkg_gempaterkini',
  WEATHER_API = 'weather_api',
  NASA_FIRMS = 'nasa_firms',
  // Registered like a real source (see SentinelAdapter's docstring) but
  // never actually produced — its fetch() always returns [].
  SENTINEL = 'sentinel',
  MANUAL = 'manual',
}

/**
 * Internal pub/sub contract (EventEmitter2, in-process). Decouples the
 * modules that produce state changes from the ones that react to them —
 * hazard-events doesn't know about risk-engine orchestration, notifications,
 * or WebSocket gateways, and vice versa. See docs/ARCHITECTURE.md §2 sequence
 * diagrams.
 *
 * Note: this is in-process only, same trade-off ORION accepted — fanning
 * these out across multiple apps/api instances would mean bridging them
 * through Redis pub/sub the same way NotificationsModule already does for
 * cross-instance notification delivery. Not needed for this single-instance
 * deployment; called out here as the extension point.
 */
export const DomainEvents = {
  HAZARD_EVENT_CREATED: 'hazard_event.created',
  RISK_ASSESSMENT_COMPLETED: 'risk_assessment.completed',
  RISK_ASSESSMENT_FAILED: 'risk_assessment.failed',
  DECISION_RECOMMENDATION_CREATED: 'decision_recommendation.created',
  HAZARD_RELATIONSHIP_DETECTED: 'hazard_relationship.detected',
  RESOURCE_PLAN_GENERATED: 'resource_plan.generated',
} as const;

export interface HazardEventCreatedEvent {
  hazardEventId: string;
  hazardType: string;
  affectedDistrictIds: string[];
}

export interface RiskAssessmentCompletedEvent {
  riskAssessmentId: string;
  hazardEventId: string | null;
  hazardType: string;
  districtId: string;
  districtName: string;
  riskScore: number;
  exposureLevel: string | null;
}

export interface RiskAssessmentFailedEvent {
  hazardEventId: string | null;
  districtId: string;
  hazardType: string;
  reason: string;
}

export interface DecisionRecommendationCreatedEvent {
  decisionRecommendationId: string;
  riskAssessmentId: string;
  hazardEventId: string | null;
  hazardType: string;
  districtId: string;
  districtName: string;
  priorityLevel: string;
  priorityScore: number;
  exposureLevel: string;
  estimatedAffectedPopulation: number | null;
}

export interface HazardRelationshipDetectedEvent {
  hazardRelationshipId: string;
  sourceEventId: string;
  relatedEventId: string;
  relationshipType: string;
  confidenceScore: number;
}

export interface ResourcePlanGeneratedEvent {
  resourceOptimizationPlanId: string;
  districtId: string;
  districtName: string;
  hazardEventId: string | null;
  planType: string;
}

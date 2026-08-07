import {
  HazardType,
  HazardRelationshipType,
} from '../common/enums/domain.enum';

/**
 * Fixed time-window + distance-threshold correlation rules for cascading
 * hazards (docs/DATABASE_SCHEMA.md §16) — deliberately simple/documented
 * heuristics, not ML, matching apps/ai-engine's
 * `spatial_intelligence/relationship_detector.py` `PLAUSIBLE_TRIGGER_PAIRS`.
 * Each rule says: "if a `from` hazard event is followed within `withinHours`
 * by a `to` hazard event within `withinKm`, record a relationship of `type`."
 *
 * Phase 2 additions mirror apps/ai-engine's `PLAUSIBLE_TRIGGER_PAIRS`
 * exactly, each a well-documented cascading-hazard pathway:
 * - landslide -> flood: debris damming a waterway, then failing (outburst
 *   flood) or simply backing up water behind the blockage.
 * - wildfire -> flood: burn scars lose vegetation/infiltration capacity, so
 *   the next rainfall runs off far faster than on unburned ground.
 * - wildfire -> landslide: the same loss of root-structure/infiltration
 *   destabilizes slopes (post-fire debris flows).
 */
export interface HazardRelationshipRule {
  from: HazardType;
  to: HazardType;
  type: HazardRelationshipType;
  withinHours: number;
  withinKm: number;
  // Baseline confidence for a match on this rule; spatial-intelligence
  // service scales it down slightly by distance/time as a simple decay.
  baseConfidence: number;
}

export const HAZARD_RELATIONSHIP_RULES: HazardRelationshipRule[] = [
  {
    from: HazardType.EARTHQUAKE,
    to: HazardType.LANDSLIDE,
    type: HazardRelationshipType.TRIGGERS,
    withinHours: 72,
    withinKm: 50,
    baseConfidence: 0.75,
  },
  {
    from: HazardType.LANDSLIDE,
    to: HazardType.FLOOD,
    type: HazardRelationshipType.TRIGGERS,
    withinHours: 48,
    withinKm: 15,
    baseConfidence: 0.55,
  },
  {
    from: HazardType.WILDFIRE,
    to: HazardType.FLOOD,
    type: HazardRelationshipType.TRIGGERS,
    withinHours: 168,
    withinKm: 25,
    baseConfidence: 0.6,
  },
  {
    from: HazardType.WILDFIRE,
    to: HazardType.LANDSLIDE,
    type: HazardRelationshipType.TRIGGERS,
    withinHours: 168,
    withinKm: 25,
    baseConfidence: 0.55,
  },
];

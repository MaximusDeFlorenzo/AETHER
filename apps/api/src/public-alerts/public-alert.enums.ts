// Public (citizen-facing) emergency alarms are deliberately NOT keyed on
// `HazardType`: the alarm vocabulary includes situations AETHER has no
// ingestion pipeline for yet (tsunami warnings, volcano level IV, dangerous
// smoke/haze), which a BPBD operator still needs to be able to broadcast.
export enum PublicAlertHazard {
  FLOOD = 'flood',
  LANDSLIDE = 'landslide',
  EARTHQUAKE = 'earthquake',
  TSUNAMI = 'tsunami',
  VOLCANO = 'volcano',
  WILDFIRE_SMOKE = 'wildfire_smoke',
  OTHER = 'other',
}

// BNPB status level of an alarm — sets the alarm screen's colour (Waspada
// yellow, Siaga orange, Awas red) and how insistently the siren sounds.
export enum PublicAlertLevel {
  WASPADA = 'waspada',
  SIAGA = 'siaga',
  AWAS = 'awas',
}

export enum PublicAlertStatus {
  ACTIVE = 'active',
  ENDED = 'ended',
}

export enum PublicAlertResponseStatus {
  SAFE = 'safe',
  NEEDS_HELP = 'needs_help',
}

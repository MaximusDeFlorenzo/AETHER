// Citizen-portal shapes. Mirrors apps/api/src/public-alerts (PublicAlertView,
// PublicWeather) — the portal never sees operator identities or other
// citizens' responses.

export type CitizenLevel = 'normal' | 'waspada' | 'siaga' | 'awas';

export type PublicAlertHazard =
  | 'flood'
  | 'landslide'
  | 'earthquake'
  | 'tsunami'
  | 'volcano'
  | 'wildfire_smoke'
  | 'other';

export type PublicAlertLevel = 'waspada' | 'siaga' | 'awas';

export interface PublicAlert {
  id: string;
  hazard: PublicAlertHazard;
  /** BNPB level: sets the alarm screen colour. Absent from older APIs → 'awas'. */
  level?: PublicAlertLevel;
  status: 'active' | 'ended';
  isActive: boolean;
  title: string;
  action: string;
  message: string;
  destinationName: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  avoidText: string | null;
  sourceLabel: string;
  area: {
    districtId: string;
    districtName: string;
    subdistrictId: string | null;
    subdistrictName: string | null;
    villageId: string | null;
    villageName: string | null;
  };
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
}

export interface OperatorPublicAlert extends PublicAlert {
  createdByName: string | null;
  pushSentCount: number;
  pushFailedCount: number;
  /** needsHelp = nobody has acted yet; helpDispatched = team on the way;
   * helpResolved = safe / evacuated. */
  responses: { safe: number; needsHelp: number; helpDispatched?: number; helpResolved?: number };
}

/** Officer progress on a help request (null = still waiting). */
export type HelpRequestHandling = 'dispatched' | 'resolved';

export interface PublicAlertResponses {
  counts: { safe: number; needsHelp: number; helpDispatched?: number; helpResolved?: number };
  needsHelp: Array<{
    id: string;
    latitude: number | null;
    longitude: number | null;
    peopleCount: number | null;
    note: string | null;
    contactPhone: string | null;
    handling?: HelpRequestHandling | null;
    handledAt?: string | null;
    handledByName?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface PublicWeather {
  districtId: string;
  observedAt: string;
  windSpeedKmh: number;
  /** Direction the wind blows FROM (meteorological), degrees from north. */
  windFromDeg: number;
  precipitationMm: number;
  hourly: Array<{ time: string; windSpeedKmh: number; windFromDeg: number; precipitationMm: number }>;
  /** Today and tomorrow in the district's local time zone (newer API only). */
  daily?: Array<{
    /** Local calendar date, YYYY-MM-DD. */
    date: string;
    precipitationSumMm: number | null;
    precipitationProbabilityMax: number | null;
    /** WMO weather interpretation code. */
    weatherCode: number | null;
  }>;
  source: 'open-meteo';
}

/** The area a citizen picked. Only the district is required — kecamatan and
 * desa are optional refinements (alarms that target a finer area still
 * reach someone who only picked the district). */
export interface CitizenLocation {
  districtId: string;
  districtName: string;
  provinceName: string | null;
  subdistrictId: string | null;
  subdistrictName: string | null;
  villageId: string | null;
  villageName: string | null;
  /** District reference point [lng, lat] — NOT the citizen's doorstep. */
  point: [number, number] | null;
}

export interface WatchedLocation extends CitizenLocation {
  label: string;
  /** Family member's phone, as typed — for one-tap call / WhatsApp check-in. */
  phone?: string;
  /** Family member's email (e.g. Gmail) for a check-in message. */
  email?: string;
}

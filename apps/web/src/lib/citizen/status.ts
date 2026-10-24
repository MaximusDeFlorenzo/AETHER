import type { ExposureLevel, HazardEvent, HazardType, RiskAssessment } from '@/types/domain';
import { GENERAL_PREPAREDNESS, GUIDES, SMOKE_PREPAREDNESS, guideKeyForAlertHazard, guideKeyForHazardType, type GuideKey } from './guides';
import type { CitizenLevel, PublicAlert, PublicAlertHazard } from './types';

// Same recency heuristic as lib/hazard-severity.ts's ONGOING_WINDOW_HOURS:
// hazard_events has no resolved/active status, so "still happening" means
// "happened within the last 24h" everywhere in the app.
export const ACTIVE_WINDOW_HOURS = 24;

export const LEVEL_ORDER: CitizenLevel[] = ['normal', 'waspada', 'siaga', 'awas'];

export const LEVEL_META: Record<
  CitizenLevel,
  { label: string; meaning: string; text: string; soft: string; solid: string; ring: string }
> = {
  normal: {
    label: 'Normal',
    meaning: 'Tidak ada ancaman aktif',
    text: 'text-lv-normal',
    soft: 'bg-lv-normal-soft',
    solid: 'bg-lv-normal',
    ring: 'ring-lv-normal',
  },
  waspada: {
    label: 'Waspada',
    meaning: 'Ada potensi bahaya, tetap pantau',
    text: 'text-lv-waspada',
    soft: 'bg-lv-waspada-soft',
    solid: 'bg-lv-waspada',
    ring: 'ring-lv-waspada',
  },
  siaga: {
    label: 'Siaga',
    meaning: 'Bahaya mungkin terjadi, bersiap mengungsi',
    text: 'text-lv-siaga',
    soft: 'bg-lv-siaga-soft',
    solid: 'bg-lv-siaga',
    ring: 'ring-lv-siaga',
  },
  awas: {
    label: 'Awas',
    meaning: 'Bahaya sedang terjadi, ikuti arahan petugas',
    text: 'text-lv-awas',
    soft: 'bg-lv-awas-soft',
    solid: 'bg-lv-awas',
    ring: 'ring-lv-awas',
  },
};

// The risk engine's exposure scale mapped onto the four levels citizens
// already know from BPBD/PVMBG announcements. "low" exposure on an active
// event still reads as Normal — there is an event, but it isn't expected to
// affect this area.
export function exposureToLevel(exposure: ExposureLevel | null): CitizenLevel {
  switch (exposure) {
    case 'severe':
      return 'awas';
    case 'high':
      return 'siaga';
    case 'moderate':
      return 'waspada';
    default:
      return 'normal';
  }
}

export function levelRank(level: CitizenLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

export const HAZARD_NOUN: Record<HazardType, string> = {
  earthquake: 'gempa',
  flood: 'banjir',
  landslide: 'longsor',
  wildfire: 'kebakaran lahan',
};

export const HAZARD_LABEL_ID: Record<HazardType, string> = {
  earthquake: 'Gempa bumi',
  flood: 'Banjir',
  landslide: 'Tanah longsor',
  wildfire: 'Kebakaran hutan & lahan',
};

export const ALERT_HAZARD_LABEL: Record<PublicAlertHazard, string> = {
  flood: 'Banjir',
  landslide: 'Tanah longsor',
  earthquake: 'Gempa bumi',
  tsunami: 'Tsunami',
  volcano: 'Erupsi gunung api',
  wildfire_smoke: 'Asap kebakaran lahan',
  other: 'Keadaan darurat',
};

export function isRecent(isoTime: string, hours = ACTIVE_WINDOW_HOURS, now = Date.now()): boolean {
  const age = now - new Date(isoTime).getTime();
  return age >= 0 && age <= hours * 60 * 60 * 1000;
}

export interface RegionStatus {
  level: CitizenLevel;
  /** The event hazard driving the level, or the alarm's hazard. */
  hazardType: HazardType | null;
  alertHazard: PublicAlertHazard | null;
  guideKey: GuideKey | null;
  event: HazardEvent | null;
  alert: PublicAlert | null;
  activeAssessments: RiskAssessment[];
  /** Highest standing (baseline) risk for the area — "wilayah Anda rawan …". */
  proneTo: HazardType[];
}

/**
 * A citizen's area status: an operator-issued alarm always wins (it is a
 * human's decision that lives are at risk); otherwise the worst exposure
 * among this district's risk assessments for events in the last 24h.
 */
export function computeRegionStatus(
  assessments: RiskAssessment[],
  alerts: PublicAlert[],
  now = Date.now(),
): RegionStatus {
  const activeAssessments = assessments.filter(
    (assessment) =>
      !assessment.isBaseline &&
      assessment.status === 'completed' &&
      assessment.hazardEvent !== null &&
      isRecent(assessment.hazardEvent.eventTime, ACTIVE_WINDOW_HOURS, now),
  );

  const proneTo = Array.from(
    new Set(
      assessments
        .filter(
          (assessment) =>
            assessment.isBaseline &&
            assessment.status === 'completed' &&
            (assessment.exposureLevel === 'high' || assessment.exposureLevel === 'severe'),
        )
        .map((assessment) => assessment.hazardType),
    ),
  );

  const alert = alerts.find((candidate) => candidate.isActive) ?? null;
  if (alert) {
    return {
      level: 'awas',
      hazardType: null,
      alertHazard: alert.hazard,
      guideKey: guideKeyForAlertHazard(alert.hazard),
      event: null,
      alert,
      activeAssessments,
      proneTo,
    };
  }

  let worst: RiskAssessment | null = null;
  for (const assessment of activeAssessments) {
    if (!worst || levelRank(exposureToLevel(assessment.exposureLevel)) > levelRank(exposureToLevel(worst.exposureLevel))) {
      worst = assessment;
    }
  }
  const level = worst ? exposureToLevel(worst.exposureLevel) : 'normal';
  const hazardType = worst && level !== 'normal' ? worst.hazardType : null;

  return {
    level,
    hazardType,
    alertHazard: null,
    guideKey: hazardType ? guideKeyForHazardType(hazardType) : null,
    event: level !== 'normal' ? (worst?.hazardEvent ?? null) : null,
    alert: null,
    activeAssessments,
    proneTo,
  };
}

export interface StatusCopy {
  tag: string;
  headline: string;
  body: string;
}

export function statusCopy(status: RegionStatus, areaName: string): StatusCopy {
  if (status.alert) {
    return {
      tag: status.alert.title,
      headline: status.alert.action,
      body: status.alert.message,
    };
  }
  const noun = status.hazardType ? HAZARD_NOUN[status.hazardType] : 'bencana';
  switch (status.level) {
    case 'awas':
      return {
        tag: `Awas ${noun}`,
        headline: 'Bahaya sedang terjadi, ikuti arahan petugas sekarang',
        body: `Dampak ${noun} di ${areaName} diperkirakan sangat tinggi. Siapkan diri untuk mengungsi dan pantau instruksi resmi BPBD.`,
      };
    case 'siaga':
      return {
        tag: `Siaga ${noun}`,
        headline: `Bersiap ya, ${noun} bisa berdampak ke wilayah Anda`,
        body: `Dampak ${noun} di ${areaName} diperkirakan tinggi. Siapkan tas siaga dan kenali jalan ke tempat aman.`,
      };
    case 'waspada':
      return {
        tag: `Waspada ${noun}`,
        headline: `Tetap waspada ya, ada potensi ${noun} di sekitar Anda`,
        body: `Belum perlu mengungsi, tetapi pantau terus kabar terbaru untuk ${areaName}.`,
      };
    default:
      return {
        tag: 'Normal',
        headline: 'Wilayah Anda aman saat ini',
        body: `Tidak ada peringatan bencana aktif untuk ${areaName} dalam 24 jam terakhir. Tetap siaga dengan persiapan sederhana.`,
      };
  }
}

export interface StatusTaskList {
  /** Checklist storage key — a different list must never reuse another's ticks. */
  storageKey: string;
  tasks: string[];
}

/**
 * What to do right now, most urgent first (the home page shows the first
 * three and folds the rest): the matching guide's steps during a hazard,
 * otherwise general preparedness — led by smoke steps when karhutla smoke
 * may reach the area.
 */
export function statusTasks(status: RegionStatus, options: { smoke?: boolean } = {}): StatusTaskList {
  if (status.guideKey && status.level !== 'normal') {
    const guide = GUIDES[status.guideKey];
    return {
      storageKey: `${status.guideKey}-${status.level}`,
      tasks: status.level === 'awas' ? guide.during : guide.before,
    };
  }
  if (options.smoke) return { storageKey: 'asap-normal', tasks: [...SMOKE_PREPAREDNESS, ...GENERAL_PREPAREDNESS] };
  return { storageKey: 'umum-normal', tasks: GENERAL_PREPAREDNESS };
}

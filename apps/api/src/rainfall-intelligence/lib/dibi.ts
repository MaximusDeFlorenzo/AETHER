import type { DisasterLabelHazard } from '../../database/entities/disaster-event-label.entity';

/**
 * BNPB DIBI (Data dan Informasi Bencana Indonesia) event records → flood /
 * landslide evaluation labels (docs/RAINFALL_INTELLIGENCE.md, Milestone 7).
 * Pure functions; the HTTP side is providers/dibi.client.ts.
 *
 * DIBI's public dashboard (dibi.bnpb.go.id, Apache Superset) serves its
 * per-event table through the dashboard's chart-data API; the query must
 * carry the dashboard and chart it belongs to, exactly as the dashboard
 * page itself sends it (without that context Superset answers 403).
 */

export const DIBI_SOURCE = 'dibi';
export const DIBI_DASHBOARD_ID = 2; // "Data Informasi Bencana Indonesia"
export const DIBI_EVENT_TABLE_CHART_ID = 51; // "Tabel dampak kejadian bencana"
export const DIBI_EVENT_DATASET_ID = 1; // "Dampak kejadian bencana"
// DIBI's own categories that hold every flood / landslide event type.
const DIBI_CATEGORIES = ['Banjir', 'Longsor'];

// DIBI `jenis_bencana` → hazards labelled. Rain-driven types only:
// "Banjir Rob" (tidal coastal flooding) is excluded — no rainfall rule can
// or should predict it. Verified type list 2026-10-08: Banjir, Tanah
// Longsor, Banjir dan Tanah Longsor, Banjir Bandang, Banjir Rob, Gerakan
// Tanah, Banjir Genangan.
const HAZARDS_BY_EVENT_TYPE: Record<string, DisasterLabelHazard[]> = {
  Banjir: ['flood'],
  'Banjir Bandang': ['flood'],
  'Banjir Genangan': ['flood'],
  'Tanah Longsor': ['landslide'],
  'Gerakan Tanah': ['landslide'],
  'Banjir dan Tanah Longsor': ['flood', 'landslide'],
};

export function hazardsForEventType(eventType: string): DisasterLabelHazard[] {
  return HAZARDS_BY_EVENT_TYPE[eventType.trim()] ?? [];
}

export interface DibiEventRow {
  id: string;
  /** Epoch ms of DIBI's timestamp column. */
  dt: number;
  id_kab_sdi: string | null;
  jenis_bencana: string | null;
  meninggal: number | null;
  hilang: number | null;
  menderita_mengungsi: number | null;
  rumah_terendam: number | null;
  rumah_rusak_berat: number | null;
  rumah_rusak_sedang: number | null;
  rumah_rusak_ringan: number | null;
}

const COLUMNS: Array<keyof DibiEventRow> = [
  'id',
  'dt',
  'id_kab_sdi',
  'jenis_bencana',
  'meninggal',
  'hilang',
  'menderita_mengungsi',
  'rumah_terendam',
  'rumah_rusak_berat',
  'rumah_rusak_sedang',
  'rumah_rusak_ringan',
];

/** Superset chart-data request for one year of flood/landslide events. */
export function dibiQueryBody(year: number, rowLimit: number) {
  return {
    datasource: { id: DIBI_EVENT_DATASET_ID, type: 'table' },
    force: false,
    form_data: {
      slice_id: DIBI_EVENT_TABLE_CHART_ID,
      dashboardId: DIBI_DASHBOARD_ID,
      datasource: `${DIBI_EVENT_DATASET_ID}__table`,
      viz_type: 'table',
    },
    queries: [
      {
        columns: COLUMNS,
        metrics: [],
        filters: [
          { col: 'kategori_bencana', op: 'IN', val: DIBI_CATEGORIES },
          { col: 'tahun', op: '==', val: year },
        ],
        orderby: [['dt', true]],
        row_limit: rowLimit,
      },
    ],
    result_format: 'json',
    result_type: 'full',
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * DIBI timestamps are wall-clock times without a zone, which Superset
 * serialises as if they were UTC — so the UTC fields ARE the reported local
 * date and time. Evidence (2026-10-08, 3,000 recent events): reports peak at
 * 14–18 h, the afternoon convective-rain maximum in local time; read as UTC
 * they would peak after local midnight. ~10 % sit at exactly 00:00, i.e. a
 * date without a time: those get `localTime` null.
 */
export function dibiLocalDateTime(epochMs: number): {
  localDate: string;
  localTime: string | null;
} | null {
  if (!Number.isFinite(epochMs)) return null;
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return null;
  const localDate = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  return {
    localDate,
    localTime: midnight
      ? null
      : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}

export interface DisasterLabelDraft {
  source: string;
  externalId: string;
  hazard: DisasterLabelHazard;
  eventType: string;
  districtId: string;
  regionCode: string;
  localDate: string;
  localTime: string | null;
  dead: number;
  missing: number;
  affectedDisplaced: number;
  housesFlooded: number;
  housesDamaged: number;
}

export type DibiSkipReason =
  'not_rain_driven' | 'unknown_region' | 'bad_timestamp';

const count = (v: number | null | undefined) =>
  Number.isFinite(v) && (v as number) > 0 ? Math.round(v as number) : 0;

/** One DIBI row → 0–2 labels, or why it was skipped. */
export function dibiRowToLabels(
  row: DibiEventRow,
  districtIdByCode: Map<string, string>,
): DisasterLabelDraft[] | DibiSkipReason {
  const eventType = (row.jenis_bencana ?? '').trim();
  const hazards = hazardsForEventType(eventType);
  if (!hazards.length) return 'not_rain_driven';
  const regionCode = (row.id_kab_sdi ?? '').trim();
  const districtId = districtIdByCode.get(regionCode);
  if (!districtId) return 'unknown_region';
  const when = dibiLocalDateTime(row.dt);
  if (!when) return 'bad_timestamp';
  return hazards.map((hazard) => ({
    source: DIBI_SOURCE,
    externalId: String(row.id),
    hazard,
    eventType,
    districtId,
    regionCode,
    localDate: when.localDate,
    localTime: when.localTime,
    dead: count(row.meninggal),
    missing: count(row.hilang),
    affectedDisplaced: count(row.menderita_mengungsi),
    housesFlooded: count(row.rumah_terendam),
    housesDamaged:
      count(row.rumah_rusak_berat) +
      count(row.rumah_rusak_sedang) +
      count(row.rumah_rusak_ringan),
  }));
}

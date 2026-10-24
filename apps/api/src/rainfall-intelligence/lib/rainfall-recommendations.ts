import type { Recommendation } from '../../karhutla-prediction/lib/recommendations';

/** A rule-based recommendation with its Bahasa Indonesia rendering. */
export interface RainfallRecommendation extends Recommendation {
  /** Same advice as `text`, in Bahasa Indonesia (citizen-facing wording). */
  textId: string;
}
import type { Freshness } from '../rainfall.enums';

/**
 * Predefined, rule-based recommendations for one district's rainfall
 * outlook (docs/RAINFALL_INTELLIGENCE.md, Milestone 6). Same discipline as
 * the karhutla recommendations: every item names the rule and evidence
 * that produced it (`basis`); no free-text generation; never an evacuation
 * order — AETHER supports, and does not replace, BMKG / BNPB / BPBD.
 *
 * Public advice paraphrases BNPB's "Buku Saku Tanggap Tangkas Tangguh
 * Menghadapi Bencana" (2012): flood actions and the main warning signs of
 * a landslide.
 */

export const RAINFALL_RULES_VERSION = 'rainfall-rules-v0.1';

type Level = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
const RANK: Record<Level, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, EXTREME: 3 };

// Nowcast probability above which rain in the next hour is mentioned. The
// probabilities are uncalibrated neighbourhood fractions; in the first
// backtest (§4) motion_advection +1 h forecasts of 0.5–0.7 verified 33 %
// of the time and >= 0.7 verified 74 %, so this marks "rain indicated",
// never "rain certain".
export const RAIN_INDICATED_PROBABILITY = 0.5;

const ALWAYS_TRUE_REASON = /not calibrated|understates/;

const BNPB_BASIS =
  'BNPB, Buku Saku Tanggap Tangkas Tangguh Menghadapi Bencana (2012)';

export interface RiskSummary {
  status: 'ok' | 'insufficient_data';
  level: Level | null;
  confidence: 'low' | 'very_low';
  confidenceReasons: string[];
  /** Factors that raised the level: "rain_24h 55 mm (lebat)". */
  raisedBy: string[];
}

export interface FloodSummary extends RiskSummary {
  /** Official gauge that set a floor on the level, if any. */
  gauge: { name: string; label: string } | null;
}

export interface LandslideSummary extends RiskSummary {
  terrainClass: 'low' | 'medium' | 'high' | 'unknown';
}

export interface RainSummary {
  currentMmPerHour: number | null;
  nextHourProbability: number | null;
  method: string | null;
  calibrated: boolean;
  freshness: Freshness;
}

export interface OutlookRecommendationInput {
  flood: FloodSummary | null;
  landslide: LandslideSummary | null;
  rain: RainSummary | null;
}

const atLeast = (level: Level | null | undefined, min: Level) =>
  !!level && RANK[level] >= RANK[min];

const because = (summary: RiskSummary, name: string) =>
  `${name} level ${summary.level}` +
  (summary.raisedBy.length
    ? ` (raised by ${summary.raisedBy.join('; ')})`
    : '');

export function buildRainfallRecommendations(
  input: OutlookRecommendationInput,
): RainfallRecommendation[] {
  const { flood, landslide, rain } = input;
  const recs: RainfallRecommendation[] = [
    {
      code: 'CHECK_OFFICIAL_WARNINGS',
      audience: 'responders',
      priority: 'priority',
      text: 'Cross-check with BMKG early weather warnings and the local BPBD before acting. AETHER rainfall outlooks are experimental, uncalibrated and derived from satellite and model data, not rain gauges.',
      textId:
        'Cocokkan dengan peringatan dini cuaca BMKG dan BPBD setempat sebelum bertindak. Outlook hujan AETHER bersifat eksperimental, belum dikalibrasi, dan berasal dari data satelit dan model, bukan alat penakar hujan.',
      basis:
        'Always issued: no level is calibrated against Indonesian flood or landslide history.',
    },
  ];

  const issued: RiskSummary[] = [flood, landslide].filter(
    (s): s is FloodSummary | LandslideSummary =>
      !!s && s.status === 'ok' && s.level !== null,
  );
  if (!issued.length) {
    recs.push({
      code: 'OUTLOOK_UNAVAILABLE',
      audience: 'responders',
      priority: 'advisory',
      text: 'No flood or landslide level could be issued for this district (rainfall missing or too old). Rely on BMKG and BPBD information.',
      textId:
        'Level banjir atau longsor belum dapat diterbitkan untuk kabupaten/kota ini (data hujan tidak ada atau terlalu lama). Gunakan informasi BMKG dan BPBD.',
      basis: 'Flood and landslide runs: no usable result for this district.',
    });
  }

  if (rain && rain.freshness !== 'fresh') {
    recs.push({
      code: 'REFRESH_OBSERVATION',
      audience: 'responders',
      priority: 'advisory',
      text: 'The newest satellite rain field behind this outlook is not current. Check whether rain has started or stopped (field reports, BMKG radar) before relying on it.',
      textId:
        'Data hujan satelit terbaru di balik outlook ini sudah tidak terkini. Periksa apakah hujan sudah mulai atau berhenti (laporan lapangan, radar BMKG) sebelum mengandalkannya.',
      basis: `Rain field freshness classified "${rain.freshness}" (GSMaP updates hourly).`,
    });
  }

  const degraded = issued.filter((s) => s.confidence === 'very_low');
  if (degraded.length) {
    // Reasons that hold for every output (no calibration, 90 m DEM) are
    // stated by CHECK_OFFICIAL_WARNINGS; list only what is degraded here.
    const reasons = Array.from(
      new Set(
        degraded
          .flatMap((s) => s.confidenceReasons)
          .filter((r) => !ALWAYS_TRUE_REASON.test(r)),
      ),
    ).slice(0, 3);
    recs.push({
      code: 'DEGRADED_INPUTS',
      audience: 'responders',
      priority: 'info',
      text: 'Some inputs behind this outlook are degraded; treat the levels as indicative only.',
      textId:
        'Sebagian data masukan outlook ini menurun kualitasnya; anggap level hanya sebagai indikasi.',
      basis: `Confidence "very_low": ${reasons.join('; ') || 'see confidenceReasons'}.`,
    });
  }

  if (flood && flood.status === 'ok') {
    if (flood.gauge) {
      recs.push({
        code: 'FLOOD_GAUGE_ALERT',
        audience: 'responders',
        priority: 'priority',
        text: `Official river gauge ${flood.gauge.name} reports ${flood.gauge.label}. Follow the BPBD operating procedure for that alert status.`,
        textId: `Pos pantau sungai resmi ${flood.gauge.name} melaporkan ${flood.gauge.label}. Ikuti prosedur operasi BPBD untuk status siaga tersebut.`,
        basis:
          'Official gauge status (BPBD via PetaBencana) set the flood level floor.',
      });
    }
    if (atLeast(flood.level, 'HIGH')) {
      recs.push({
        code: 'FLOOD_PREPARE',
        audience: 'responders',
        priority: 'priority',
        text: 'Review flood preparedness with BPBD: check pumps and drainage, pre-position response resources, and prepare information on safe locations and flood posts (posko banjir). Do not order evacuations on the basis of this model alone.',
        textId:
          'Tinjau kesiapsiagaan banjir bersama BPBD: periksa pompa dan drainase, siapkan sumber daya penanganan, serta siapkan informasi lokasi aman dan posko banjir. Jangan memerintahkan evakuasi hanya berdasarkan model ini.',
        basis: because(flood, 'Flood'),
      });
      recs.push({
        code: 'FLOOD_PUBLIC_ACTIONS',
        audience: 'public',
        priority: 'advisory',
        text: 'Very heavy rainfall or a high river level has been detected around this area. If water starts to rise: stay away from drains and channels so you are not swept away, move valuables to a higher place, switch off electricity at home (or ask PLN), move early to a safe place or flood post while the water can still be crossed, and contact the village head, lurah or camat if the water keeps rising. Follow BPBD instructions.',
        textId:
          'Hujan sangat lebat atau tinggi muka air sungai yang tinggi terdeteksi di sekitar wilayah ini. Jika air mulai naik: jauhi saluran air atau selokan agar tidak terseret arus, pindahkan barang berharga ke tempat yang lebih tinggi, matikan listrik di rumah (atau hubungi PLN), segera mengungsi ke tempat aman atau posko banjir selagi air masih bisa diseberangi, dan hubungi kepala desa, lurah, atau camat jika air terus naik. Ikuti arahan BPBD.',
        basis: `${because(flood, 'Flood')}. Actions: ${BNPB_BASIS}, "Ketika Terjadi Banjir".`,
      });
    } else if (atLeast(flood.level, 'MEDIUM')) {
      recs.push({
        code: 'FLOOD_MONITOR',
        audience: 'responders',
        priority: 'advisory',
        text: 'Monitor drainage channels, river levels (BPBD / PetaBencana gauges where available) and reports of inundation in low-lying areas.',
        textId:
          'Pantau saluran drainase, tinggi muka air sungai (pos pantau BPBD / PetaBencana jika tersedia), dan laporan genangan di dataran rendah.',
        basis: because(flood, 'Flood'),
      });
    }
  }

  if (landslide && landslide.status === 'ok') {
    const terrainNote =
      landslide.terrainClass === 'unknown'
        ? ' Terrain slope is not yet known for this district.'
        : '';
    const terrainNoteId =
      landslide.terrainClass === 'unknown'
        ? ' Kemiringan lereng untuk kabupaten/kota ini belum diketahui.'
        : '';
    if (atLeast(landslide.level, 'HIGH')) {
      recs.push({
        code: 'LANDSLIDE_PREPARE',
        audience: 'responders',
        priority: 'priority',
        text: `Rainfall exceeds the upper landslide-trigger curve. Increase monitoring of steep slopes, road cuts and settlements on or below slopes, and review landslide preparedness with BPBD. Do not order evacuations on the basis of this model alone.${terrainNote}`,
        textId: `Curah hujan melampaui kurva atas pemicu longsor. Tingkatkan pemantauan lereng curam, tebing jalan, serta permukiman di atas atau di bawah lereng, dan tinjau kesiapsiagaan longsor bersama BPBD. Jangan memerintahkan evakuasi hanya berdasarkan model ini.${terrainNoteId}`,
        basis: because(landslide, 'Landslide'),
      });
    } else if (atLeast(landslide.level, 'MEDIUM')) {
      recs.push({
        code: 'LANDSLIDE_MONITOR',
        audience: 'responders',
        priority: 'advisory',
        text: `Rainfall exceeds the global minimum landslide-trigger curve. Watch steep slopes, road cuts and settlements below slopes for warning signs.${terrainNote}`,
        textId: `Curah hujan melampaui kurva minimum global pemicu longsor. Awasi tanda-tanda longsor di lereng curam, tebing jalan, dan permukiman di bawah lereng.${terrainNoteId}`,
        basis: because(landslide, 'Landslide'),
      });
    }
    if (atLeast(landslide.level, 'MEDIUM')) {
      recs.push({
        code: 'LANDSLIDE_WARNING_SIGNS',
        audience: 'public',
        priority: atLeast(landslide.level, 'HIGH') ? 'advisory' : 'info',
        text: 'If you live on or below a steep slope, be alert while rain is heavy. Main warning signs of a landslide: new vertical cracks in the slope, groundwater suddenly appearing, well water near the slope turning murky, and small stones falling. If you see them, move away from the slope and report to the village office or BPBD.',
        textId:
          'Jika Anda tinggal di atas atau di bawah lereng curam, waspadalah selama hujan lebat. Tanda-tanda utama tanah longsor: muncul retakan tegak baru di tebing, muncul mata air baru secara tiba-tiba, air sumur di sekitar lereng menjadi keruh, dan batu-batu kecil mulai berjatuhan. Jika melihatnya, menjauhlah dari lereng dan laporkan ke kantor desa atau BPBD.',
        basis: `${because(landslide, 'Landslide')}. Signs: ${BNPB_BASIS}, "Tanda-tanda Utama Terjadi Tanah Longsor".`,
      });
    }
  }

  const triggered = issued.filter((s) => atLeast(s.level, 'MEDIUM'));
  if (
    triggered.length &&
    rain &&
    rain.nextHourProbability !== null &&
    rain.nextHourProbability >= RAIN_INDICATED_PROBABILITY
  ) {
    recs.push({
      code: 'MORE_RAIN_INDICATED',
      audience: 'responders',
      priority: 'advisory',
      text: 'Further rain (≥ 1 mm/h) is indicated around this district within about an hour, where a flood or landslide trigger is already met: conditions may worsen.',
      textId:
        'Hujan lanjutan (≥ 1 mm/jam) terindikasi di sekitar kabupaten/kota ini dalam sekitar satu jam, di wilayah yang pemicu banjir atau longsornya sudah terpenuhi: kondisi bisa memburuk.',
      basis: `Nowcast ${rain.method} +1 h probability ${rain.nextHourProbability.toFixed(2)} >= ${RAIN_INDICATED_PROBABILITY}${rain.calibrated ? '' : ' (uncalibrated)'}.`,
    });
  }

  if (
    issued.length &&
    issued.every((s) => s.level === 'LOW') &&
    (!flood || flood.status === 'ok') &&
    (!landslide || landslide.status === 'ok')
  ) {
    recs.push({
      code: 'NO_TRIGGER_DETECTED',
      audience: 'responders',
      priority: 'info',
      text: 'No rainfall trigger detected for flood or landslide. This is not an all-clear: the satellite estimate averages ~11 km cells and can miss intense local rain.',
      textId:
        'Tidak terdeteksi pemicu hujan untuk banjir atau longsor. Ini bukan berarti aman: estimasi satelit merata-ratakan sel ~11 km dan bisa melewatkan hujan lokal yang intens.',
      basis: 'Flood and landslide levels LOW.',
    });
  }

  return recs;
}

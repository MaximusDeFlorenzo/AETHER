export const KARHUTLA_PREDICTION_QUEUE = 'karhutla-prediction';

// 12 h backs the citizen map's "12 jam" smoke view.
export const DEFAULT_HORIZONS_HOURS = [1, 3, 6, 12];
export const MAX_HORIZON_HOURS = 12;
// Hotspots within this distance of any cluster member join the cluster.
// ~2.5x a MODIS nadir pixel, so adjacent/diagonal pixels of one burning
// area link, while separate fires a few km apart stay separate.
export const CLUSTER_LINK_KM = 2.5;
// Atmosphere grid around each cluster for smoke transport.
export const WIND_GRID_HALF_WIDTH_DEG = 1.5;
export const WIND_GRID_SPACING_DEG = 0.75;
export const SMOKE_PARTICLES = 800;
// Spread engine accepts at most 2000 hotspots per cluster (newest kept).
export const MAX_HOTSPOTS_PER_CLUSTER = 2000;
// Districts farther than this from a fire can't be inside any footprint.
export const DISTRICT_CANDIDATE_RADIUS_KM = 500;
// A queued/running run older than this is considered abandoned (worker
// died without the BullMQ failure handler firing) and no longer blocks
// new runs.
export const ABANDONED_RUN_MINUTES = 45;
// Hotspots stamped later than issuedAt by more than this are conflicting
// inputs (clock/feed error) and are excluded.
export const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

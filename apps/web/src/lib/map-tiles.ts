// CARTO basemaps (basemaps.cartocdn.com) need an API key on every tile URL;
// without one CARTO serves a placeholder "API KEY REQUIRED" tile. The key is
// meant for the browser (it travels in each tile request) — limit it to the
// app's domains in the CARTO dashboard. https://carto.com/basemaps/apikey
const CARTO_BASEMAP_KEY = process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY ?? '';

export type CartoStyle = 'voyager' | 'dark_all';

const CARTO_PATHS: Record<CartoStyle, string> = {
  voyager: 'rastertiles/voyager',
  dark_all: 'dark_all',
};

/** Leaflet tile URL template for a CARTO raster style, with the API key. */
export function cartoTileUrl(style: CartoStyle): string {
  const url = `https://{s}.basemaps.cartocdn.com/${CARTO_PATHS[style]}/{z}/{x}/{y}{r}.png`;
  return CARTO_BASEMAP_KEY ? `${url}?key=${encodeURIComponent(CARTO_BASEMAP_KEY)}` : url;
}

// Esri World Imagery: keyless satellite imagery (forests, parks, rivers and
// built-up areas visible). Tile scheme is {z}/{y}/{x} (ArcGIS convention).
export const SATELLITE_TILES = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  maxZoom: 19,
} as const;

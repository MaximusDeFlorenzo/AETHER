import leaflet from 'leaflet';

// Drop Leaflet's own "Leaflet" link from every map's attribution control.
// Leaflet's BSD-2 licence doesn't require it on screen; the tile providers'
// credits (Esri, CARTO, OpenStreetMap) are added by each TileLayer and stay.
// Imported by every map component, before its MapContainer is created.
leaflet.Control.Attribution.prototype.options.prefix = false;

"use client";

/**
 * CivitasMap — Reusable interactive map component.
 *
 * Features:
 * - Pan, zoom, marker click to view entity details
 * - Optional GIS layers (tile / WMS / GeoJSON) rendered above the base map
 * - Max 200 markers per viewport (requirement 17.3)
 * - Tile provider configured via NEXT_PUBLIC_MAP_TILE_URL env var
 * - WCAG 2.2 AA: keyboard-accessible controls, aria-labels, focus indicators
 * - Renders via <iframe> with Leaflet to avoid SSR issues in Next.js
 *
 * Props:
 * - markers: Array of { id, lat, lng, label?, description? }
 * - layers: Array of { id, name, sourceType, url, styleJson?, zIndex, visible }
 * - center: { lat, lng } — initial map center
 * - zoom: initial zoom level (default 12)
 * - onMarkerClick: callback when a marker is clicked
 * - maxMarkers: max visible markers (default 200)
 * - className: additional CSS classes for the container
 * - height: container height (default "400px")
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  description?: string;
}

export interface MapCenter {
  lat: number;
  lng: number;
}

export type MapLayerSourceType = "tile" | "wms" | "geojson";

export interface MapLayer {
  id: string;
  name: string;
  sourceType: MapLayerSourceType;
  url: string;
  /** Leaflet style/options object (e.g. { color, weight, layers, format }). */
  styleJson?: Record<string, unknown> | null;
  zIndex: number;
  visible: boolean;
}

export interface CivitasMapProps {
  markers?: MapMarker[];
  layers?: MapLayer[];
  center?: MapCenter;
  zoom?: number;
  onMarkerClick?: (marker: MapMarker) => void;
  maxMarkers?: number;
  className?: string;
  height?: string;
}

const DEFAULT_CENTER: MapCenter = { lat: 20.5937, lng: 78.9629 }; // India center
const DEFAULT_ZOOM = 5;
const MAX_MARKERS_DEFAULT = 200;

// Default OSM tile URL — overridable via NEXT_PUBLIC_MAP_TILE_URL
const TILE_URL =
  typeof window !== "undefined"
    ? (window as unknown as Record<string, string>).__CIVITAS_MAP_TILE_URL ??
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

/**
 * Generates the Leaflet HTML content for the iframe-based map.
 */
function generateMapHtml(
  markers: MapMarker[],
  layers: MapLayer[],
  center: MapCenter,
  zoom: number,
  tileUrl: string,
): string {
  const markersJson = JSON.stringify(markers);
  // Only visible layers reach the map, ordered by zIndex (lowest first).
  const orderedLayers = [...layers]
    .filter((l) => l.visible)
    .sort((a, b) => a.zIndex - b.zIndex);
  const layersJson = JSON.stringify(orderedLayers);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Map</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
    integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
    crossorigin="" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
    integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
    crossorigin=""></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; }
    .leaflet-control-zoom a:focus {
      outline: 3px solid #2563eb;
      outline-offset: 2px;
    }
    .marker-popup { font-family: system-ui, sans-serif; font-size: 14px; }
    .marker-popup h3 { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .marker-popup p { font-size: 12px; color: #6b7280; margin: 0; }
    .marker-popup a { font-size: 12px; color: #2563eb; }
  </style>
</head>
<body>
  <div id="map" role="application" aria-label="Interactive map showing locations"></div>
  <script>
    (function() {
      var map = L.map('map', {
        center: [${center.lat}, ${center.lng}],
        zoom: ${zoom},
        keyboard: true,
        zoomControl: true,
        attributionControl: true
      });

      L.tileLayer('${tileUrl}', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
      }).addTo(map);

      // GIS overlay layers (tile / wms / geojson), ordered by zIndex.
      var layers = ${layersJson};
      layers.forEach(function(layer) {
        try {
          var style = layer.styleJson || {};
          if (layer.sourceType === 'tile') {
            L.tileLayer(layer.url, Object.assign({ zIndex: layer.zIndex, maxZoom: 19 }, style)).addTo(map);
          } else if (layer.sourceType === 'wms') {
            L.tileLayer.wms(layer.url, Object.assign(
              { format: 'image/png', transparent: true, zIndex: layer.zIndex },
              style
            )).addTo(map);
          } else if (layer.sourceType === 'geojson') {
            fetch(layer.url).then(function(r) { return r.json(); }).then(function(data) {
              L.geoJSON(data, {
                style: style,
                onEachFeature: function(feature, lyr) {
                  var name = (feature.properties && (feature.properties.name || feature.properties.label));
                  if (name) lyr.bindPopup(String(name));
                }
              }).addTo(map);
            }).catch(function() { /* best-effort: bad/blocked GeoJSON source is non-fatal */ });
          }
        } catch (e) { /* one bad layer must not break the map */ }
      });

      var markers = ${markersJson};

      markers.forEach(function(m) {
        var marker = L.marker([m.lat, m.lng], {
          title: m.label || '',
          alt: m.label || 'Map marker at ' + m.lat.toFixed(4) + ', ' + m.lng.toFixed(4),
          keyboard: true
        }).addTo(map);

        var popupContent = '<div class="marker-popup">';
        if (m.label) popupContent += '<h3>' + m.label + '</h3>';
        if (m.description) popupContent += '<p>' + m.description + '</p>';
        popupContent += '<p>(' + m.lat.toFixed(6) + ', ' + m.lng.toFixed(6) + ')</p>';
        popupContent += '</div>';

        marker.bindPopup(popupContent);

        marker.on('click', function() {
          window.parent.postMessage({ type: 'marker-click', marker: m }, '*');
        });
      });

      // Keyboard zoom controls
      document.addEventListener('keydown', function(e) {
        if (e.key === '+' || e.key === '=') map.zoomIn();
        if (e.key === '-') map.zoomOut();
      });
    })();
  </script>
</body>
</html>`;
}

export function CivitasMap({
  markers = [],
  layers = [],
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  onMarkerClick,
  maxMarkers = MAX_MARKERS_DEFAULT,
  className = "",
  height = "400px",
}: CivitasMapProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mapId = useId();
  const [focusVisible, setFocusVisible] = useState(false);

  // Cap markers at maxMarkers (200 by default per requirement 17.3)
  const visibleMarkers = useMemo(
    () => markers.slice(0, maxMarkers),
    [markers, maxMarkers],
  );

  // Listen for marker click messages from the iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "marker-click" && onMarkerClick) {
        onMarkerClick(event.data.marker as MapMarker);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onMarkerClick]);

  // Generate map HTML
  const mapHtml = useMemo(
    () => generateMapHtml(visibleMarkers, layers, center, zoom, TILE_URL),
    [visibleMarkers, layers, center, zoom],
  );

  const srcDoc = mapHtml;

  const handleFocus = useCallback(() => setFocusVisible(true), []);
  const handleBlur = useCallback(() => setFocusVisible(false), []);

  return (
    <div
      className={`relative rounded-lg border border-gray-200 overflow-hidden ${className}`}
      style={{ height }}
      role="region"
      aria-label="Map view"
    >
      {/* Keyboard instructions for screen readers */}
      <div className="sr-only" id={`${mapId}-instructions`}>
        Use arrow keys to pan the map. Press plus or minus to zoom in or out.
        Click on markers to view details.
      </div>

      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        title="Interactive map showing locations"
        aria-describedby={`${mapId}-instructions`}
        className={`w-full h-full border-0 ${focusVisible ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
        sandbox="allow-scripts"
        onFocus={handleFocus}
        onBlur={handleBlur}
        tabIndex={0}
      />

      {/* Marker count indicator */}
      {markers.length > maxMarkers && (
        <div
          className="absolute bottom-2 left-2 bg-amber-100 text-amber-800 text-xs px-2 py-1 rounded"
          role="status"
          aria-live="polite"
        >
          Showing {maxMarkers} of {markers.length} markers
        </div>
      )}
    </div>
  );
}

export default CivitasMap;

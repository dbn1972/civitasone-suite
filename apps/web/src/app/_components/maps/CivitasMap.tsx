"use client";

/**
 * CivitasMap — Reusable interactive map component.
 *
 * Features:
 * - Pan, zoom, marker click to view entity details
 * - Optional GIS layers (tile / WMS / GeoJSON) rendered above the base map
 * - Max 200 markers per viewport (requirement 17.3)
 * - Tile provider passed in as the `tileUrl` prop (the server pages read the
 *   MAP_TILE_URL env; unset falls back to public OpenStreetMap tiles)
 * - Leaflet is self-hosted from /vendor/leaflet (no third-party CDN, CSP-safe,
 *   works on an air-gapped / on-prem network with an internal tile server)
 * - A visible, retryable error shows when the map script or tiles fail to load
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
 * - tileUrl: base-map XYZ tile URL template
 * - className: additional CSS classes for the container
 * - height: container height (default "400px")
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

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
  /** Base-map XYZ tile URL template. Defaults to public OpenStreetMap tiles. */
  tileUrl?: string;
  className?: string;
  height?: string;
}

const DEFAULT_CENTER: MapCenter = { lat: 20.5937, lng: 78.9629 }; // India center
const DEFAULT_ZOOM = 5;
const MAX_MARKERS_DEFAULT = 200;

export const DEFAULT_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

/**
 * Generates the Leaflet HTML content for the iframe-based map.
 */
function generateMapHtml(
  markers: MapMarker[],
  layers: MapLayer[],
  center: MapCenter,
  zoom: number,
  tileUrl: string,
  assetBase: string,
): string {
  // Only visible layers reach the map, ordered by zIndex (lowest first).
  const orderedLayers = [...layers]
    .filter((l) => l.visible)
    .sort((a, b) => a.zIndex - b.zIndex);
  // Data, not code: serialised into a non-executed JSON block read by
  // /maps/civitas-map.js. "<", ">" and "&" are escaped so no value (a marker
  // label, a tile URL) can close the block or open a tag.
  const config = JSON.stringify({ markers, layers: orderedLayers, center, zoom, tileUrl })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Map</title>
  <link rel="stylesheet" href="${assetBase}/vendor/leaflet/leaflet.css" />
  <script src="${assetBase}/vendor/leaflet/leaflet.js"></script>
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
  <script type="application/json" id="civitas-map-config">${config}</script>
  <script src="${assetBase}/maps/civitas-map.js"></script>
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
  tileUrl = DEFAULT_TILE_URL,
  className = "",
  height = "400px",
}: CivitasMapProps) {
  const t = useTranslations("mapsCommon");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mapId = useId();
  const [focusVisible, setFocusVisible] = useState(false);
  // The iframe is a srcdoc document (opaque origin), so the self-hosted
  // Leaflet assets need an absolute URL. Known only on the client.
  const [origin, setOrigin] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setOrigin(window.location.origin), []);

  // Cap markers at maxMarkers (200 by default per requirement 17.3)
  const visibleMarkers = useMemo(
    () => markers.slice(0, maxMarkers),
    [markers, maxMarkers],
  );

  // Listen for marker click messages from the iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Only trust messages from our own map iframe.
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "map-error") {
        setFailed(true);
        return;
      }
      if (event.data?.type === "marker-click" && onMarkerClick) {
        onMarkerClick(event.data.marker as MapMarker);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onMarkerClick]);

  // Generate map HTML
  const srcDoc = useMemo(
    () => (origin === null ? "" : generateMapHtml(visibleMarkers, layers, center, zoom, tileUrl, origin)),
    [visibleMarkers, layers, center, zoom, tileUrl, origin],
  );

  // New content (or a retry) gets a fresh chance to load.
  useEffect(() => setFailed(false), [srcDoc, attempt]);

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
        key={attempt}
        ref={iframeRef}
        srcDoc={srcDoc}
        title="Interactive map showing locations"
        aria-describedby={`${mapId}-instructions`}
        className={`w-full h-full border-0 ${focusVisible ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
        sandbox="allow-scripts"
        onFocus={handleFocus}
        onBlur={handleBlur}
      />

      {failed && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center"
          style={{ background: "var(--panel)", color: "var(--ink)" }}
        >
          <p>{t("loadFailed")}</p>
          <button type="button" className="btn primary" onClick={() => setAttempt((n) => n + 1)}>
            {t("retry")}
          </button>
        </div>
      )}

      {/* Marker count indicator */}
      {markers.length > maxMarkers && (
        <div
          className="absolute bottom-2 start-2 bg-amber-100 text-amber-800 text-xs px-2 py-1 rounded"
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

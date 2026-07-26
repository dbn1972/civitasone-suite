"use client";

/**
 * MonitoringMap — SVC-119 Map-based monitoring dashboard.
 *
 * Consumes `GET /api/proxy/v1/locations/map-markers?domain=&status=&bbox=` and
 * plots the returned markers on the CivitasMap with domain / status / date
 * filter controls. Selecting a marker reveals its label + status and a link to
 * the underlying record.
 *
 * Accessible (labelled filters, keyboard-selectable markers via the map), responsive
 * and theme-aware via civitas-ds classes.
 */

import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/app/_components/ds/PageHeader";
import { StatGrid } from "@/app/_components/ds/StatGrid";
import { StatCard } from "@/app/_components/ds/StatCard";
import { EmptyState } from "@/app/_components/ds/EmptyState";
import { CivitasMap, type MapMarker } from "@/app/_components/maps";

const API = "/api/proxy/v1/locations/map-markers";

const INPUT_STYLE: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "9px 12px",
  fontSize: 13.5,
  background: "var(--panel)",
  color: "var(--ink)",
  fontFamily: "inherit",
};

export interface MonitoringMarker {
  id: string;
  domain: string;
  refId: string;
  lat: number;
  lng: number;
  label: string;
  status: string;
}

const DOMAINS = ["", "infrastructure", "land_parcel", "geofence"] as const;
const STATUSES = ["", "active", "inactive", "alert", "maintenance"] as const;

/** Best-effort route to the record behind a marker. */
function recordHref(domain: string, refId: string): string {
  switch (domain) {
    case "infrastructure":
      return `/assets/${encodeURIComponent(refId)}`;
    case "land_parcel":
      return `/locations/list?ref=${encodeURIComponent(refId)}`;
    case "geofence":
      return `/locations?geofence=${encodeURIComponent(refId)}`;
    default:
      return `/locations/list?ref=${encodeURIComponent(refId)}`;
  }
}

function normalizeMarkers(body: unknown): MonitoringMarker[] {
  const raw =
    (body as { markers?: unknown[] })?.markers ??
    (Array.isArray(body) ? body : (body as { data?: unknown[] })?.data ?? []);
  return (raw as Record<string, unknown>[])
    .map((m, i) => ({
      id: String(m.id ?? `marker-${i}`),
      domain: String(m.domain ?? "unknown"),
      refId: String(m.refId ?? m.id ?? ""),
      lat: Number(m.lat),
      lng: Number(m.lng),
      label: String(m.label ?? "Untitled"),
      status: String(m.status ?? "unknown"),
    }))
    .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
}

export function MonitoringMap() {
  const [markers, setMarkers] = useState<MonitoringMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [selected, setSelected] = useState<MonitoringMarker | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (domain) qs.set("domain", domain);
      if (status) qs.set("status", status);
      if (date) qs.set("date", date);
      const res = await fetch(`${API}?${qs.toString()}`);
      if (!res.ok) throw new Error(`Failed to load markers (${res.status})`);
      const body = await res.json();
      setMarkers(normalizeMarkers(body));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load markers");
    } finally {
      setLoading(false);
    }
  }, [domain, status, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const mapMarkers: MapMarker[] = useMemo(
    () =>
      markers.map((m) => ({
        id: m.id,
        lat: m.lat,
        lng: m.lng,
        label: m.label,
        description: `${m.domain} · ${m.status}`,
      })),
    [markers],
  );

  const byId = useMemo(() => {
    const map = new Map<string, MonitoringMarker>();
    for (const m of markers) map.set(m.id, m);
    return map;
  }, [markers]);

  const onMarkerClick = useCallback(
    (marker: MapMarker) => setSelected(byId.get(marker.id) ?? null),
    [byId],
  );

  const alerts = markers.filter((m) => m.status === "alert").length;
  const active = markers.filter((m) => m.status === "active").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Map monitoring"
        subtitle="Live geospatial monitoring across infrastructure, land parcels and geofences. Filter and select a marker to jump to its record."
        back="/locations"
      />

      <StatGrid>
        <StatCard icon="📍" iconBg="#eef2ff" label="Markers" value={String(markers.length)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={String(active)} />
        <StatCard
          icon="⚠️"
          iconBg={alerts > 0 ? "#fef2f2" : "#f2f4f7"}
          label="Alerts"
          value={String(alerts)}
        />
      </StatGrid>

      <div
        className="card"
        style={{ margin: "16px 0" }}
        role="search"
        aria-label="Marker filters"
      >
        <div
          className="pad"
          style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}
        >
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--ink2)" }}>Domain</span>
            <select
              style={INPUT_STYLE}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              aria-label="Filter by domain"
            >
              {DOMAINS.map((d) => (
                <option key={d || "all"} value={d}>
                  {d || "All domains"}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--ink2)" }}>Status</span>
            <select
              style={INPUT_STYLE}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
            >
              {STATUSES.map((s) => (
                <option key={s || "all"} value={s}>
                  {s || "All statuses"}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--ink2)" }}>As of date</span>
            <input
              style={INPUT_STYLE}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Filter by date"
            />
          </label>
          <button type="button" className="btn ghost" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="card" role="alert" style={{ borderColor: "#fecaca", marginBottom: 12 }}>
          <div className="pad" style={{ color: "#b42318" }}>
            {error}{" "}
            <button type="button" className="btn ghost" onClick={() => void load()}>
              Retry
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 320px)",
          alignItems: "start",
        }}
        className="map-layout"
      >
        <CivitasMap markers={mapMarkers} onMarkerClick={onMarkerClick} height="70vh" />

        <div className="card" aria-label="Selected marker">
          <div className="card-h">
            <h3>Details</h3>
          </div>
          <div className="pad">
            {loading ? (
              <p style={{ color: "var(--ink2)", fontSize: 13 }}>Loading markers…</p>
            ) : markers.length === 0 ? (
              <EmptyState
                icon="🛰️"
                title="No markers"
                message="No markers match the current filters."
              />
            ) : selected ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{selected.label}</div>
                <div style={{ fontSize: 13, color: "var(--ink2)" }}>
                  Domain: {selected.domain}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink2)" }}>
                  Status: {selected.status}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>
                  ({selected.lat.toFixed(5)}, {selected.lng.toFixed(5)})
                </div>
                <Link
                  href={recordHref(selected.domain, selected.refId)}
                  className="btn primary"
                  style={{ marginTop: 4, textAlign: "center" }}
                >
                  Open record →
                </Link>
              </div>
            ) : (
              <p style={{ color: "var(--ink2)", fontSize: 13 }}>
                Select a marker on the map to see its details and open the underlying
                record.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default MonitoringMap;

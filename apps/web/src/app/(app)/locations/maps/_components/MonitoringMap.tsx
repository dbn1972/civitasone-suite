"use client";

/**
 * MonitoringMap — SVC-119 Map-based monitoring dashboard.
 *
 * Consumes `GET /api/proxy/v1/locations/map-markers?domain=&status=&bbox=` and
 * plots the returned markers on the CivitasMap with domain / status filter
 * controls. Selecting a marker reveals its label + status and a link to the
 * underlying record. The data is a snapshot refreshed on filter change or when
 * Refresh is pressed (there is no polling), and the page says when it was
 * last updated. The service has no history, so the "as of date" control is
 * disabled with an honest note rather than sending a parameter it ignores.
 *
 * Accessible (labelled filters, keyboard-selectable markers via the map), responsive
 * and theme-aware via civitas-ds classes.
 */

import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/app/_components/ds/PageHeader";
import { StatGrid } from "@/app/_components/ds/StatGrid";
import { StatCard } from "@/app/_components/ds/StatCard";
import { EmptyState } from "@/app/_components/ds/EmptyState";
import { CivitasMap, type MapMarker } from "@/app/_components/maps";
import { useFormError } from "@/lib/useFormError";
import { formatInIST } from "@/lib/formatters";

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

// The feed names cadastral parcels "parcel" (location-service map-markers repo).
const DOMAINS = ["", "infrastructure", "parcel", "geofence"] as const;
const STATUSES = ["", "active", "inactive", "alert", "maintenance"] as const;

const DOMAIN_LABEL_KEY = {
  infrastructure: "domainInfrastructure",
  parcel: "domainParcel",
  land_parcel: "domainParcel",
  geofence: "domainGeofence",
} as const;
const STATUS_LABEL_KEY = {
  active: "statusActive",
  inactive: "statusInactive",
  alert: "statusAlert",
  maintenance: "statusMaintenance",
} as const;

/**
 * The page that shows the record behind a marker, or null when none exists.
 * Infrastructure markers carry location-service's own asset id (not an
 * asset-service id), so they open the infrastructure register rather than a
 * /assets/:id page that would 404. A cadastral parcel marker's refId is the
 * parcel id, which opens that parcel's own page (GAP-LOCATIONS-MAPS-MONITORING-01).
 */
function recordHref(domain: string, refId: string): string | null {
  switch (domain) {
    case "parcel":
      return refId ? `/locations/parcels/${encodeURIComponent(refId)}` : null;
    case "infrastructure":
      return "/locations/infrastructure";
    case "geofence":
      return "/locations/geofences";
    default:
      return null;
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

export function MonitoringMap({ tileUrl }: { tileUrl?: string } = {}) {
  const t = useTranslations("locationsMaps");
  const [markers, setMarkers] = useState<MonitoringMarker[]>([]);
  // Counts across every status for the selected domain, so the Active / Alerts
  // tiles don't read 0 just because the status filter hid them.
  const [summary, setSummary] = useState<MonitoringMarker[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [selected, setSelected] = useState<MonitoringMarker | null>(null);
  const formError = useFormError("map marker");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (domain) qs.set("domain", domain);
      if (status) qs.set("status", status);
      const res = await fetch(`${API}?${qs.toString()}`, { signal });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "load")).message);
        return;
      }
      const body = await res.json();
      // CLOS-S2-04: a superseded (aborted) load must not apply stale results.
      if (signal?.aborted) return;
      setMarkers(normalizeMarkers(body));
      setTruncated((body as { meta?: { truncated?: unknown } })?.meta?.truncated === true);
      setUpdatedAt(new Date());
      if (status) {
        // A status filter hides the other statuses; fetch the unfiltered-by-status
        // set for the stat tiles. Best-effort: on failure the tiles fall back to the view.
        const sq = new URLSearchParams();
        if (domain) sq.set("domain", domain);
        const sres = await fetch(`${API}?${sq.toString()}`, { signal }).catch(() => null);
        if (signal?.aborted) return;
        setSummary(sres?.ok ? normalizeMarkers(await sres.json()) : null);
      } else {
        setSummary(null);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(formError.fromException("load", err).message);
    } finally {
      // CLOS-S2-04: the aborted call must not clear the flag its replacement set.
      if (!signal?.aborted) setLoading(false);
    }
    // formError.fromResponse/fromException are stable (useCallback'd on a
    // fixed `area` string inside useFormError) even though the wrapping
    // `formError` object literal isn't, so omitting it here is safe and
    // avoids re-creating load (and re-running its effect, which was
    // genuinely looping — "Maximum update depth exceeded" — before this
    // fix) every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, status]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const domainLabel = useCallback(
    (d: string) => (d in DOMAIN_LABEL_KEY ? t(DOMAIN_LABEL_KEY[d as keyof typeof DOMAIN_LABEL_KEY]) : d),
    [t],
  );
  const statusLabel = useCallback(
    (s: string) => (s in STATUS_LABEL_KEY ? t(STATUS_LABEL_KEY[s as keyof typeof STATUS_LABEL_KEY]) : s),
    [t],
  );

  const mapMarkers: MapMarker[] = useMemo(
    () =>
      markers.map((m) => ({
        id: m.id,
        lat: m.lat,
        lng: m.lng,
        label: m.label,
        description: `${domainLabel(m.domain)} · ${statusLabel(m.status)}`,
      })),
    [markers, domainLabel, statusLabel],
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

  const counted = summary ?? markers;
  const alerts = counted.filter((m) => m.status === "alert").length;
  const active = counted.filter((m) => m.status === "active").length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Map monitoring"
        subtitle={t("monitoringSubtitle")}
        back="/locations"
      />

      <StatGrid>
        <StatCard icon="📍" tone="info" label="Markers" value={String(markers.length)} />
        <StatCard icon="✅" tone="good" label="Active" value={String(active)} />
        <StatCard
          icon="⚠️"
          iconBg={alerts > 0 ? "var(--badbg)" : "var(--line2)"}
          label="Alerts"
          value={String(alerts)}
        />
      </StatGrid>
      <p style={{ color: "var(--ink2)", fontSize: 12, marginTop: 6 }}>{t("statsNote")}</p>

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
                  {d ? domainLabel(d) : t("domainAll")}
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
                  {s ? statusLabel(s) : t("statusAll")}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--ink2)" }}>{t("asOfLabel")}</span>
            <input
              style={INPUT_STYLE}
              type="date"
              value=""
              disabled
              readOnly
              aria-label={t("asOfLabel")}
              aria-describedby="as-of-note"
            />
            <span id="as-of-note" style={{ fontSize: 11, color: "var(--ink2)" }}>{t("asOfUnavailable")}</span>
          </label>
          <button type="button" className="btn ghost" onClick={() => void load()}>
            Refresh
          </button>
          {updatedAt ? (
            <span role="status" style={{ fontSize: 12, color: "var(--ink2)" }}>
              {t("updatedAt", { time: formatInIST(updatedAt, { hour: "2-digit", minute: "2-digit" }) })}
            </span>
          ) : null}
        </div>
      </div>

      {error && (
        <div className="card" role="alert" style={{ borderColor: "var(--badbg)", marginBottom: 12 }}>
          <div className="pad" style={{ color: "var(--bad)" }}>
            {error}{" "}
            <button type="button" className="btn ghost" onClick={() => void load()}>
              Retry
            </button>
          </div>
        </div>
      )}

      {truncated ? (
        <p role="status" style={{ color: "var(--warn)", fontSize: 13, marginBottom: 8 }}>
          {t("truncated", { shown: markers.length })}
        </p>
      ) : null}

      <div className="map-layout">
        <CivitasMap markers={mapMarkers} onMarkerClick={onMarkerClick} height="clamp(320px, 60vh, 800px)" {...(tileUrl ? { tileUrl } : {})} />

        <div className="card" role="region" aria-label="Selected marker">
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
                  Domain: {domainLabel(selected.domain)}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink2)" }}>
                  Status: {statusLabel(selected.status)}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>
                  ({selected.lat.toFixed(4)}, {selected.lng.toFixed(4)})
                </div>
                {recordHref(selected.domain, selected.refId) ? (
                  <Link
                    href={recordHref(selected.domain, selected.refId) as string}
                    className="btn primary"
                    style={{ marginTop: 4, textAlign: "center" }}
                  >
                    Open record →
                  </Link>
                ) : null}
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
    </div>
  );
}

export default MonitoringMap;

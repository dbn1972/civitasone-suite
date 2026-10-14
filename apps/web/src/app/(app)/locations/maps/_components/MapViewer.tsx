"use client";

/**
 * MapViewer — SVC-112 Map viewer + layers page.
 *
 * Renders the full-page CivitasMap with a GIS layer panel. Consumes
 * `GET /api/proxy/v1/locations/map-layers` and (for admins) creates, edits and
 * deletes layers via POST/PATCH/DELETE on the same endpoint. Layer visibility
 * can be toggled locally to control what is drawn on the map; that choice is a
 * browser-local preference (localStorage) that survives layer reloads and page
 * visits, and is NOT shared with other users or devices.
 *
 * Deleting a layer is destructive for every user, so it goes through a
 * ConfirmDialog that requires a reason; the reason is sent with the request and
 * recorded in the audit event.
 *
 * Accessible (labelled controls, keyboard toggles), responsive and theme-aware
 * via civitas-ds classes.
 */

import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/app/_components/ds/PageHeader";
import { ConfirmDialog } from "@/app/_components/ds/ConfirmDialog";
import { EmptyState } from "@/app/_components/ds/EmptyState";
import { CivitasMap, type MapLayer, type MapLayerSourceType } from "@/app/_components/maps";
import { useFormError } from "@/lib/useFormError";

const API = "/api/proxy/v1/locations/map-layers";

const SOURCE_TYPES: MapLayerSourceType[] = ["tile", "wms", "geojson"];
const SOURCE_LABEL_KEY = { tile: "srcTile", wms: "srcWms", geojson: "srcGeojson" } as const;

/** Browser-local layer visibility overrides: layer id -> shown (true) / hidden (false). */
const VISIBILITY_KEY = "civitas.maps.layerVisibility";

function readVisibility(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(VISIBILITY_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeVisibility(next: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(VISIBILITY_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private window, blocked): the toggle still works for this visit.
  }
}

type DraftLayer = {
  name: string;
  sourceType: MapLayerSourceType;
  url: string;
  zIndex: number;
};

const EMPTY_DRAFT: DraftLayer = { name: "", sourceType: "tile", url: "", zIndex: 10 };

const INPUT_STYLE: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "9px 12px",
  fontSize: 13.5,
  background: "var(--panel)",
  color: "var(--ink)",
  fontFamily: "inherit",
};

function normalizeLayers(body: unknown): MapLayer[] {
  const raw = Array.isArray(body)
    ? body
    : ((body as { data?: unknown[]; layers?: unknown[] })?.data ??
       (body as { layers?: unknown[] })?.layers ??
       []);
  return (raw as Record<string, unknown>[]).map((l, i) => ({
    id: String(l.id ?? `layer-${i}`),
    name: String(l.name ?? `Layer ${i + 1}`),
    sourceType: (SOURCE_TYPES.includes(l.sourceType as MapLayerSourceType)
      ? l.sourceType
      : "tile") as MapLayerSourceType,
    url: String(l.url ?? ""),
    styleJson: (l.styleJson as Record<string, unknown> | undefined) ?? null,
    zIndex: typeof l.zIndex === "number" ? l.zIndex : Number(l.zIndex ?? 10) || 10,
    visible: l.visible !== false,
  }));
}

export function MapViewer({ canManage = false, tileUrl }: { canManage?: boolean; tileUrl?: string }) {
  const t = useTranslations("locationsMaps");
  const [layers, setLayers] = useState<MapLayer[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<MapLayer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLayer>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const formError = useFormError("map layer");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API, { signal });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "load")).message);
        return;
      }
      const body = await res.json();
      const next = normalizeLayers(body);
      setLayers(next);
      // Drop saved choices for layers that no longer exist.
      setOverrides((prev) => {
        const ids = new Set(next.map((l) => l.id));
        const kept = Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id)));
        if (Object.keys(kept).length !== Object.keys(prev).length) writeVisibility(kept);
        return kept;
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(formError.fromException("load", err).message);
    } finally {
      setLoading(false);
    }
    // formError.fromResponse/fromException are stable (useCallback'd on a
    // fixed `area` string inside useFormError) even though the wrapping
    // `formError` object literal isn't, so omitting it here is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setOverrides(readVisibility());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const isShown = useCallback((l: MapLayer) => overrides[l.id] ?? l.visible, [overrides]);

  const visibleLayers = useMemo(
    () => layers.filter(isShown).map((l) => ({ ...l, visible: true })),
    [layers, isShown],
  );

  const toggleVisibility = useCallback(
    (layer: MapLayer) => {
      setOverrides((prev) => {
        const next = { ...prev, [layer.id]: !(prev[layer.id] ?? layer.visible) };
        writeVisibility(next);
        return next;
      });
    },
    [],
  );

  const createLayer = useCallback(async () => {
    if (!draft.name.trim() || !draft.url.trim()) return;
    // The service enforces this too; checking here gives an immediate, clear message.
    if (!/^https:\/\//i.test(draft.url.trim())) {
      setError(t("httpsOnly"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, visible: true }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDraft(EMPTY_DRAFT);
      setFormOpen(false);
      await load();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [draft, load, t]);

  const deleteLayer = useCallback(
    async (id: string, reason?: string) => {
      setError(null);
      setDeleteError(undefined);
      setDeleting(true);
      try {
        const qs = reason ? `?reason=${encodeURIComponent(reason)}` : "";
        const res = await fetch(`${API}/${encodeURIComponent(id)}${qs}`, { method: "DELETE" });
        if (!res.ok) {
          setDeleteError((await formError.fromResponse(res, "save")).message);
          return;
        }
        setPendingDelete(null);
        await load();
      } catch (caught) {
        setDeleteError(formError.fromException("save", caught).message);
      } finally {
        setDeleting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
    [load],
  );

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Map viewer"
        subtitle="Explore your geospatial layers on an interactive map. Toggle layers on or off; administrators can add or remove sources."
        back="/locations"
        actions={
          canManage ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => setFormOpen((o) => !o)}
              aria-expanded={formOpen}
            >
              {formOpen ? "Close" : "＋ Add layer"}
            </button>
          ) : undefined
        }
      />

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

      {canManage && formOpen && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-h">
            <h3>Add a map layer</h3>
          </div>
          <div
            className="pad"
            style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
          >
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>Name</span>
              <input
                style={INPUT_STYLE}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Ward boundaries"
                aria-label="Layer name"
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>Source type</span>
              <select
                style={INPUT_STYLE}
                value={draft.sourceType}
                onChange={(e) =>
                  setDraft({ ...draft, sourceType: e.target.value as MapLayerSourceType })
                }
                aria-label="Layer source type"
              >
                {SOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(SOURCE_LABEL_KEY[type])}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>Source URL</span>
              <input
                style={INPUT_STYLE}
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                placeholder="https://…/{z}/{x}/{y}.png"
                aria-label="Layer source URL"
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>Z-index</span>
              <input
                style={INPUT_STYLE}
                type="number"
                value={draft.zIndex}
                onChange={(e) => setDraft({ ...draft, zIndex: Number(e.target.value) || 0 })}
                aria-label="Layer z-index"
              />
            </label>
          </div>
          <div className="pad" style={{ display: "flex", gap: 8, paddingTop: 0 }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => void createLayer()}
              disabled={saving || !draft.name.trim() || !draft.url.trim()}
            >
              {saving ? "Saving…" : "Save layer"}
            </button>
            <button type="button" className="btn ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="map-layout">
        <CivitasMap layers={visibleLayers} height="clamp(320px, 60vh, 800px)" {...(tileUrl ? { tileUrl } : {})} />

        <div className="card" role="region" aria-label="Layers panel">
          <div className="card-h">
            <h3>Layers</h3>
            <div className="lnk">{layers.length}</div>
          </div>
          <div className="pad" style={{ display: "grid", gap: 8 }}>
            {loading ? (
              <p style={{ color: "var(--ink2)", fontSize: 13 }}>Loading layers…</p>
            ) : layers.length === 0 ? (
              <EmptyState
                icon="🗺️"
                title="No layers yet"
                message={
                  canManage
                    ? "Add a tile, WMS or GeoJSON source to see it on the map."
                    : "An administrator hasn't configured any map layers yet."
                }
              />
            ) : (
              layers.map((layer) => (
                <div
                  key={layer.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 4px",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isShown(layer)}
                    onChange={() => toggleVisibility(layer)}
                    id={`layer-${layer.id}`}
                    aria-label={`Toggle ${layer.name}`}
                  />
                  <label
                    htmlFor={`layer-${layer.id}`}
                    style={{ flex: 1, cursor: "pointer", fontSize: 14 }}
                  >
                    {layer.name}
                    <span
                      style={{ marginLeft: 6, fontSize: 11, color: "var(--ink2)" }}
                    >
                      {t(SOURCE_LABEL_KEY[layer.sourceType])}
                    </span>
                  </label>
                  {canManage && (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ padding: "2px 8px", fontSize: 12 }}
                      onClick={() => {
                        setDeleteError(undefined);
                        setPendingDelete(layer);
                      }}
                      aria-label={`Delete ${layer.name}`}
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        requireReason
        maxReasonLength={500}
        title={t("deleteTitle")}
        description={pendingDelete ? t("deleteDescription", { name: pendingDelete.name }) : undefined}
        reasonLabel={t("deleteReasonLabel")}
        confirmLabel={t("deleteConfirm")}
        busy={deleting}
        {...(deleteError ? { errorMessage: deleteError } : {})}
        onConfirm={(reason) => {
          if (pendingDelete) void deleteLayer(pendingDelete.id, reason);
        }}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteError(undefined);
        }}
      />
    </div>
  );
}

export default MapViewer;

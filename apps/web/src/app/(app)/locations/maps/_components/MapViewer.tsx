"use client";

/**
 * MapViewer — SVC-112 Map viewer + layers page.
 *
 * Renders the full-page CivitasMap with a GIS layer panel. Consumes
 * `GET /api/proxy/v1/locations/map-layers` and (for admins) creates, edits and
 * deletes layers via POST/PATCH/DELETE on the same endpoint. Layer visibility
 * can be toggled locally to control what is drawn on the map.
 *
 * Accessible (labelled controls, keyboard toggles), responsive and theme-aware
 * via civitas-ds classes.
 */

import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/app/_components/ds/PageHeader";
import { EmptyState } from "@/app/_components/ds/EmptyState";
import { CivitasMap, type MapLayer, type MapLayerSourceType } from "@/app/_components/maps";

const API = "/api/proxy/v1/locations/map-layers";

const SOURCE_TYPES: MapLayerSourceType[] = ["tile", "wms", "geojson"];

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

export function MapViewer({ canManage = false }: { canManage?: boolean }) {
  const [layers, setLayers] = useState<MapLayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLayer>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API);
      if (!res.ok) throw new Error(`Failed to load map layers (${res.status})`);
      const body = await res.json();
      setLayers(normalizeLayers(body));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load map layers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleLayers = useMemo(() => layers.filter((l) => l.visible), [layers]);

  const toggleVisibility = useCallback((id: string) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    );
  }, []);

  const createLayer = useCallback(async () => {
    if (!draft.name.trim() || !draft.url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, visible: true }),
      });
      if (!res.ok) throw new Error(`Failed to create layer (${res.status})`);
      setDraft(EMPTY_DRAFT);
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create layer");
    } finally {
      setSaving(false);
    }
  }, [draft, load]);

  const deleteLayer = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const res = await fetch(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Failed to delete layer (${res.status})`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete layer");
      }
    },
    [load],
  );

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
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
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
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

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 320px)",
          alignItems: "start",
        }}
        className="map-layout"
      >
        <CivitasMap layers={visibleLayers} height="70vh" />

        <div className="card" aria-label="Layers panel">
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
                    checked={layer.visible}
                    onChange={() => toggleVisibility(layer.id)}
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
                      {layer.sourceType}
                    </span>
                  </label>
                  {canManage && (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ padding: "2px 8px", fontSize: 12 }}
                      onClick={() => void deleteLayer(layer.id)}
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
    </main>
  );
}

export default MapViewer;

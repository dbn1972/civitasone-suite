"use client";

import type { Ref } from "react";
import { Button } from "../../../_components/ds";

export type FunctionalLocation = { id: string; code: string; name: string };
export type LocationsLoad = "loading" | "error" | "ready";

type Props = {
  locations: FunctionalLocation[];
  /** Fetch state of GET /v1/assets/locations -- a failure is never "no locations". */
  load: LocationsLoad;
  onRetry: () => void;
  value: string;
  onChange: (name: string) => void;
  error?: string;
  selectRef?: Ref<HTMLSelectElement>;
};

/** GAP-ASSETS-VERIFICATION-01: required site picker for a verification session. */
export function LocationPicker({ locations, load, onRetry, value, onChange, error, selectRef }: Props) {
  const ready = load === "ready";
  const hasLocations = ready && locations.length > 0;
  const placeholder = load === "loading"
    ? "Loading locations…"
    : load === "error"
      ? "Locations could not be loaded"
      : hasLocations ? "Choose a location…" : "No locations set up yet";
  const helpId = load === "error" ? "ver-location-load-err" : !hasLocations && ready ? "ver-location-help" : undefined;

  return (
    <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
      <label className="l" htmlFor="ver-location">Location to verify</label>
      <select
        id="ver-location"
        ref={selectRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!hasLocations}
        aria-required="true"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? "ver-location-err" : helpId}
        style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}
      >
        <option value="">{placeholder}</option>
        {locations.map((l) => (
          <option key={l.id} value={l.name}>{l.code ? `${l.code} · ${l.name}` : l.name}</option>
        ))}
      </select>
      {error ? <p id="ver-location-err" role="alert" style={{ color: "var(--bad)", fontSize: 12, margin: 0 }}>{error}</p> : null}
      {load === "error" ? (
        <div id="ver-location-load-err" role="alert" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--bad)" }}>
          Couldn&apos;t load locations.
          <Button type="button" variant="ghost" size="sm" onClick={onRetry}>Retry</Button>
        </div>
      ) : null}
      {ready && !hasLocations ? (
        <p id="ver-location-help" style={{ fontSize: 12, margin: 0, color: "var(--ink2)" }}>
          Create functional locations first. <a className="lnk" href="/assets/locations">Go to locations</a>
        </p>
      ) : null}
    </div>
  );
}

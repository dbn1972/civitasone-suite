"use client";
import { Card, EmptyState, LoadErrorState, ProgressBar } from "@/app/_components/ds";
import { limitCells, type LimitLevel } from "./usageLimits";
import type { UsageResource } from "@/app/_data/loaders";

const COLOUR: Record<LimitLevel, string | undefined> = { none: undefined, ok: undefined, warn: "#f59e0b", bad: "#dc2626" };

/**
 * GAP-ADMIN-METERING-05: current usage against the plan limit for the signed-in
 * organisation. Three distinct states: failed to load, nothing reported, rows.
 */
export function UsageLimitsPanel({ resources, source, errorStatus }: { resources: UsageResource[]; source: "api" | "error"; errorStatus?: number }) {
  if (source === "error") {
    return (
      <Card title="Usage against plan limits">
        <LoadErrorState result={{ status: errorStatus }} area="plan limits" backHref="/admin" />
      </Card>
    );
  }
  const cells = limitCells(resources);
  return (
    <Card title="Usage against plan limits">
      {cells.length === 0 ? (
        <EmptyState icon="📏" title="No limits reported" message="No plan limits are recorded for this organisation yet." />
      ) : (
        <div style={{ display: "grid", gap: 14, padding: "4px 2px" }}>
          {cells.map((c) => (
            <div key={c.resource} data-testid={`limit-${c.resource}`} data-level={c.level}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <strong>{c.label}</strong>
                <span>
                  {c.used ?? "—"} / {c.limit ?? "—"} {c.unit}
                </span>
              </div>
              {c.percent !== null && <ProgressBar value={c.percent} color={COLOUR[c.level]} />}
              <div style={{ fontSize: 12, marginTop: 4, color: c.level === "bad" ? "#b42318" : c.level === "warn" ? "#92400e" : "var(--mut)" }}>
                {c.level === "none" ? "No limit set" : c.text}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

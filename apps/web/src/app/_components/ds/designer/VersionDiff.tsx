"use client";

import Link from "next/link";
import { useState } from "react";
import type { ServiceDefinitionDto } from "@/app/(app)/designer/_data/designerApi";
import {
  buildVersionDiffRows,
  type DiffViewMode,
} from "@/app/(app)/designer/_data/versionDiffModel";
import { Segmented } from "../Segmented";

export interface VersionDiffProps {
  current: ServiceDefinitionDto;
  published: Record<string, unknown> | null;
  /** Controlled view mode; defaults to internal toggle. */
  viewMode?: DiffViewMode;
  onViewModeChange?: (mode: DiffViewMode) => void;
}

export function VersionDiff({
  current,
  published,
  viewMode: controlledMode,
  onViewModeChange,
}: VersionDiffProps) {
  const [internalMode, setInternalMode] = useState<DiffViewMode>("unified");
  const mode = controlledMode ?? internalMode;
  const setMode = (next: DiffViewMode) => {
    onViewModeChange?.(next);
    if (controlledMode == null) setInternalMode(next);
  };

  const rows = buildVersionDiffRows(current, published);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, color: "var(--ink)" }}>
          Changes from published version
        </h3>
        <Segmented
          value={mode === "unified" ? "Unified" : "Side by side"}
          onChange={(v) => setMode(v === "Unified" ? "unified" : "side-by-side")}
          options={["Unified", "Side by side"]}
        />
      </div>
      {!published ? (
        <p style={{ color: "var(--mut)", marginTop: 0 }}>
          This is the first version — nothing is live yet.
        </p>
      ) : null}
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)",
              background: "var(--panel)",
              fontSize: 13,
            }}
          >
            {mode === "unified" ? (
              <div>
                <div style={{ fontWeight: 600, color: "var(--ink2)", marginBottom: 4 }}>
                  {row.label}
                </div>
                <p style={{ margin: 0, color: "var(--ink)" }}>{row.summary}</p>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "160px 1fr 1fr",
                  gap: 12,
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--ink2)" }}>{row.label}</span>
                <span style={{ color: "var(--mut)" }}>{row.before}</span>
                <span style={{ color: "var(--ink)" }}>{row.after}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <p style={{ marginTop: 12, fontSize: 12, color: "var(--mut)" }}>
        <Link href={`/designer/${current.id}/b1`}>Open read-only wizard walkthrough</Link>
      </p>
    </div>
  );
}

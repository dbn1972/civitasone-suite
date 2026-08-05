/**
 * Pure helpers for the Customer 360 profile screen (P1-14).
 *
 * cdp-service holds a golden profile as a flat attribute bag plus an append-only
 * `sourceLineage` trail. A lineage entry may name the attribute keys that source
 * supplied; when it does, this module resolves each attribute back to the system
 * that last wrote it. Attribution is derived here rather than in the service so
 * the rule is visible and testable in one place.
 */
import type { CDPProfile, CDPProfileLineageEntry } from "@civitasone/types";

export interface AttributeSource {
  key: string;
  value: string;
  /** System of record for this attribute, or null when no lineage claims it. */
  source: string | null;
  sourceId: string | null;
  /** When that source supplied it, ISO 8601. */
  recordedAt: string | null;
}

/** Renders an attribute value for a table cell without collapsing meaningful shapes. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.trim() === "" ? "—" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(displayValue).join(", ");
  return JSON.stringify(value);
}

/**
 * Latest lineage entry that claims a given attribute key.
 *
 * "Latest" is by timestamp, with the later position in the append-only array
 * breaking a tie: two ingests inside the same millisecond are ordered by the
 * order they were accepted, which is the only ordering the trail actually
 * guarantees.
 */
function latestClaimFor(key: string, lineage: CDPProfileLineageEntry[]): CDPProfileLineageEntry | null {
  let best: CDPProfileLineageEntry | null = null;
  for (const entry of lineage) {
    if (!entry.attributes?.includes(key)) continue;
    if (best === null) {
      best = entry;
      continue;
    }
    // >= keeps the later array position on an exact timestamp tie.
    if (entry.timestamp >= best.timestamp) best = entry;
  }
  return best;
}

/**
 * Every attribute on the profile with the source that last supplied it.
 *
 * An attribute no lineage entry claims comes back with `source: null` rather
 * than being attributed to the profile's most recent ingest. Guessing there
 * would put a system's name against a value it never sent, which is exactly the
 * claim a data-quality dispute turns on.
 */
export function resolveAttributeSources(profile: Pick<CDPProfile, "attributes" | "sourceLineage">): AttributeSource[] {
  const lineage = profile.sourceLineage ?? [];
  return Object.keys(profile.attributes ?? {})
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const claim = latestClaimFor(key, lineage);
      return {
        key,
        value: displayValue(profile.attributes[key]),
        source: claim?.source ?? null,
        sourceId: claim?.sourceId ?? null,
        recordedAt: claim?.timestamp ?? null,
      };
    });
}

/**
 * Share of attributes that can be traced to a named source, 0-100.
 *
 * This is the honest headline for a Customer 360: a profile assembled from
 * unattributed writes looks identical to a fully governed one until you measure
 * how much of it has provenance.
 */
export function attributionCoveragePct(sources: AttributeSource[]): number {
  if (sources.length === 0) return 0;
  const attributed = sources.filter((s) => s.source !== null).length;
  return Math.round((attributed / sources.length) * 100);
}

/** Distinct contributing systems, most recent contribution first. */
export function contributingSources(lineage: CDPProfileLineageEntry[]): Array<{ source: string; lastSeen: string }> {
  const latest = new Map<string, string>();
  for (const entry of lineage) {
    const seen = latest.get(entry.source);
    if (seen === undefined || entry.timestamp > seen) latest.set(entry.source, entry.timestamp);
  }
  return [...latest.entries()]
    .map(([source, lastSeen]) => ({ source, lastSeen }))
    .sort((a, b) => (a.lastSeen === b.lastSeen ? a.source.localeCompare(b.source) : b.lastSeen.localeCompare(a.lastSeen)));
}

/** Lineage newest-first, which is the order a steward reads a provenance trail in. */
export function lineageNewestFirst(lineage: CDPProfileLineageEntry[]): CDPProfileLineageEntry[] {
  return [...lineage].reverse();
}

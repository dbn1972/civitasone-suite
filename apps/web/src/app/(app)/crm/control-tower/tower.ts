import type { CRMControlTowerException, CRMControlTowerRegion } from "@civitasone/types";

/**
 * GAP-CRM-CONTROL-TOWER-04: parse a paise string defensively. `BigInt("12.5")`
 * and `BigInt("abc")` throw a SyntaxError; before this guard a single malformed
 * pipelineMinor took the whole control-tower route into its error boundary.
 * Malformed values sort as 0 so one bad row can never crash the page.
 */
function safeBig(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * GAP-CRM-CONTROL-TOWER-02: contact `region` is free text ("South" vs " south ")
 * so the same district can arrive as two server rows. As an interim safeguard
 * (until a tenant region master exists) we fold rows whose region matches after
 * trimming and case-folding into one, summing their deals and pipeline. The
 * first-seen display spelling is kept so the UI still shows a human label.
 */
export function mergeRegionsByName(regions: CRMControlTowerRegion[]): CRMControlTowerRegion[] {
  const byKey = new Map<string, CRMControlTowerRegion>();
  for (const r of regions) {
    const key = (r.region ?? "").trim().toLowerCase() || "unknown";
    const existing = byKey.get(key);
    if (existing) {
      existing.dealCount += r.dealCount;
      existing.pipelineMinor = (safeBig(existing.pipelineMinor) + safeBig(r.pipelineMinor)).toString();
    } else {
      byKey.set(key, { region: r.region, dealCount: r.dealCount, pipelineMinor: r.pipelineMinor });
    }
  }
  return [...byKey.values()];
}

export function rankRegions(regions: CRMControlTowerRegion[]): CRMControlTowerRegion[] {
  // Merge spelling/case variants first so a district never splits into two rows.
  return mergeRegionsByName(regions).sort((a, b) => {
    const av = safeBig(a.pipelineMinor);
    const bv = safeBig(b.pipelineMinor);
    if (av === bv) return a.region.localeCompare(b.region);
    return av > bv ? -1 : 1;
  });
}

export function hotExceptions(exceptions: CRMControlTowerException[]): CRMControlTowerException[] {
  return [...exceptions].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
    return b.count - a.count;
  });
}

export function totalExceptionCount(exceptions: CRMControlTowerException[]): number {
  return exceptions.reduce((sum, e) => sum + e.count, 0);
}

import type { CRMControlTowerException, CRMControlTowerRegion } from "@civitasone/types";

export function rankRegions(regions: CRMControlTowerRegion[]): CRMControlTowerRegion[] {
  return [...regions].sort((a, b) => {
    const av = BigInt(a.pipelineMinor || "0");
    const bv = BigInt(b.pipelineMinor || "0");
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

/**
 * S8-G4 server loaders for the grade-band screens. Both are advisory: any failure answers the safe default
 * (government pay matrix, no bands) so a screen never breaks -- or shows band UI to a government tenant --
 * because the policy or band list could not be read.
 */
import { fetchJson } from "@/app/_data/apiClient";
import { bandsFromResponse, payScaleFromPolicies, type GradeBand, type PayScaleKind } from "@/lib/gradeBands";

export async function getPayScaleKind(): Promise<PayScaleKind> {
  try {
    const r = await fetchJson<unknown, unknown>("/api/v1/hrms/policy-settings", [], {
      telemetryKey: "hr.policy-settings.pay-scale",
      mapResponse: (p) => p,
    });
    return r.source === "error" ? "cpc7" : payScaleFromPolicies(r.data);
  } catch {
    return "cpc7";
  }
}

export async function getGradeBands(includeInactive = true): Promise<{ bands: GradeBand[]; failed: boolean }> {
  try {
    const r = await fetchJson<unknown, GradeBand[]>(`/api/v1/hrms/admin/grade-bands${includeInactive ? "" : "?includeInactive=false"}`, [], {
      telemetryKey: "hr.grade-bands",
      mapResponse: (p) => bandsFromResponse(p),
    });
    return { bands: r.source === "error" ? [] : bandsFromResponse(r.data), failed: r.source === "error" };
  } catch {
    return { bands: [], failed: true };
  }
}

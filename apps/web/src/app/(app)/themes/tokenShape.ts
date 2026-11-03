import type { ThemeTokenSummary } from "@civitasone/types";

/**
 * theme-service's GET /v1/themes/tokens rows carry the token's identifier as
 * `name` ({ id, name, value, category, status, version }), while the screens
 * (ThemeTokenTable, ThemeContrastPanel, ThemeActions' contrast warning) read
 * `key`. With no `key`, the contrast panel's `t.key.toLowerCase()` threw and
 * /themes/tokens crashed on every load (UAT L1, Phase 1B). This maps either
 * shape onto `{ key, value }` and drops rows with no usable identifier.
 */
export function normaliseThemeTokens(rows: ReadonlyArray<unknown>): ThemeTokenSummary[] {
  const out: ThemeTokenSummary[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const key = typeof r.key === "string" && r.key ? r.key : typeof r.name === "string" ? r.name : "";
    if (!key) continue;
    out.push({ ...(r as object), key, value: r.value == null ? "" : String(r.value) } as ThemeTokenSummary);
  }
  return out;
}

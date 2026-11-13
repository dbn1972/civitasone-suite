import { fetchJson } from "@/app/_data/apiClient";

export type TemplateRow = { id: string; name: string; isLocked: boolean; templateVersion: number; effectiveFrom: string | null; activeComponents: number };

/**
 * Section 8 G2: whether the component admin is enabled (GET /v1/payroll/pay-components/meta, flag
 * S8_PAY_COMPONENTS_ENABLED, default off) and, if so, the CTC templates. Tolerant of a failed or missing
 * response: anything unexpected means "not enabled", so the structures page is then unchanged.
 */
export async function getPayComponentsView(): Promise<{ enabled: boolean; templates: TemplateRow[] }> {
  const meta = await fetchJson<unknown, { enabled: boolean } | null>("/api/v1/payroll/pay-components/meta", null, {
    telemetryKey: "payroll.pay-components-meta",
    mapResponse: (p) => (p && typeof p === "object" && "enabled" in p ? (p as { enabled: boolean }) : null),
  });
  if (!meta?.data?.enabled) return { enabled: false, templates: [] };
  const templates = await fetchJson<unknown, TemplateRow[]>("/api/v1/payroll/ctc-templates", [], {
    telemetryKey: "payroll.ctc-templates",
    mapResponse: (p) => {
      const arr = (p as { data?: TemplateRow[] } | undefined)?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return { enabled: true, templates: templates?.data ?? [] };
}

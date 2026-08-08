/**
 * FN-11 VersionDiff helpers — human-readable field-level diff (not JSON).
 */

import type { ServiceDefinitionDto } from "./designerApi";

export type DiffViewMode = "side-by-side" | "unified";

export interface VersionDiffRow {
  label: string;
  before: string;
  after: string;
  /** Plain-language sentence for unified view, e.g. "Fee changed ₹500 → ₹750". */
  summary: string;
  kind?: "info" | "change";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function formatPaiseInr(amountMinor: number | null | undefined): string {
  if (amountMinor == null || Number.isNaN(amountMinor)) return "—";
  const rupees = (amountMinor / 100).toLocaleString("en-IN", {
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `₹${rupees}`;
}

/** Prefer forms[0].runtimeMeta.feeFromMinor, then top-level feeFromMinor on published blobs. */
export function extractFeeFromMinor(source: unknown): number | null {
  if (!isRecord(source)) return null;
  if (typeof source.feeFromMinor === "number") return source.feeFromMinor;
  if (Array.isArray(source.forms)) {
    for (const form of source.forms) {
      if (!isRecord(form)) continue;
      const meta = form.runtimeMeta;
      if (isRecord(meta) && typeof meta.feeFromMinor === "number") return meta.feeFromMinor;
    }
  }
  return null;
}

export function countFormFields(source: unknown): number {
  if (!isRecord(source)) return 0;
  if (Array.isArray(source.forms)) {
    let total = 0;
    for (const form of source.forms) {
      if (!isRecord(form)) continue;
      const design = form.formDesign;
      if (isRecord(design) && isRecord(design.fields)) {
        total += Object.keys(design.fields).length;
        continue;
      }
      if (Array.isArray(form.fields)) total += form.fields.length;
    }
    if (total > 0) return total;
  }
  return 0;
}

function pushChange(
  rows: VersionDiffRow[],
  label: string,
  before: string,
  after: string,
  summary?: string,
) {
  if (before === after) return;
  rows.push({
    label,
    before,
    after,
    summary: summary ?? `${label} changed ${before} → ${after}`,
    kind: "change",
  });
}

export function buildVersionDiffRows(
  current: ServiceDefinitionDto,
  published: Record<string, unknown> | null,
): VersionDiffRow[] {
  if (!published) {
    return [{
      label: "Version",
      before: "—",
      after: "First version (nothing published yet)",
      summary: "This is the first version — nothing is live yet.",
      kind: "info",
    }];
  }

  const rows: VersionDiffRow[] = [];

  const pubName = String(published.name ?? "");
  pushChange(rows, "Service name", pubName || "—", current.name || "—");

  const pubSla = published.slaDays == null ? "—" : String(published.slaDays);
  const curSla = current.slaDays == null ? "—" : String(current.slaDays);
  pushChange(rows, "SLA (days)", pubSla, curSla, `SLA changed ${pubSla} → ${curSla} days`);

  const pubHoa = published.hoaCode == null ? "—" : `HOA ${String(published.hoaCode)}`;
  const curHoa = current.hoaCode == null ? "—" : `HOA ${current.hoaCode}`;
  pushChange(rows, "Head of Account", pubHoa, curHoa, `Head of Account changed ${pubHoa} → ${curHoa}`);

  const pubFee = published.feeModel == null ? "—" : String(published.feeModel);
  const curFee = current.feeModel ?? "—";
  pushChange(rows, "Fee model", pubFee, curFee, `Fee model changed ${pubFee} → ${curFee}`);

  const pubAmount = extractFeeFromMinor(published);
  const curAmount = extractFeeFromMinor(current);
  if (pubAmount !== curAmount && (pubAmount != null || curAmount != null)) {
    const before = formatPaiseInr(pubAmount);
    const after = formatPaiseInr(curAmount);
    pushChange(rows, "Fee amount", before, after, `Fee changed ${before} → ${after}`);
  }

  const pubChannels = Array.isArray(published.channels)
    ? (published.channels as string[]).join(", ")
    : "—";
  const curChannels = current.channels.join(", ") || "—";
  pushChange(rows, "Channels", pubChannels, curChannels);

  const pubDocs = Array.isArray(published.requiredDocuments)
    ? published.requiredDocuments.length
    : 0;
  const curDocs = current.requiredDocuments?.length ?? 0;
  if (pubDocs !== curDocs) {
    pushChange(
      rows,
      "Required documents",
      `${pubDocs} document(s)`,
      `${curDocs} document(s)`,
      curDocs > pubDocs
        ? `Added ${curDocs - pubDocs} required document(s) (${pubDocs} → ${curDocs})`
        : `Removed ${pubDocs - curDocs} required document(s) (${pubDocs} → ${curDocs})`,
    );
  }

  const pubFields = countFormFields(published);
  const curFields = countFormFields(current);
  if (pubFields !== curFields) {
    pushChange(
      rows,
      "Form fields",
      `${pubFields} field(s)`,
      `${curFields} field(s)`,
      curFields > pubFields
        ? `Added ${curFields - pubFields} form field(s) (${pubFields} → ${curFields})`
        : `Form fields changed ${pubFields} → ${curFields}`,
    );
  }

  const pubWf = published.workflowDefinitionId == null
    ? null
    : String(published.workflowDefinitionId);
  const curWf = current.workflowDefinitionId ?? null;
  if (pubWf !== curWf) {
    rows.push({
      label: "Approval chain",
      before: pubWf == null ? "None" : "Configured",
      after: curWf == null ? "None" : "Configured",
      summary:
        pubWf == null
          ? "Approval chain added"
          : curWf == null
            ? "Approval chain removed"
            : "Approval chain changed",
      kind: "change",
    });
  }

  const pubElig = published.eligibilityRuleSetId == null
    ? null
    : String(published.eligibilityRuleSetId);
  const curElig = current.eligibilityRuleSetId ?? null;
  if (pubElig !== curElig) {
    rows.push({
      label: "Eligibility",
      before: pubElig == null ? "None" : "Configured",
      after: curElig == null ? "None" : "Configured",
      summary: "Eligibility rules changed",
      kind: "change",
    });
  }

  const pubIssuance = published.issuanceType == null ? "—" : String(published.issuanceType);
  const curIssuance = current.issuanceType ?? "—";
  pushChange(rows, "Output type", pubIssuance, curIssuance);

  if (rows.length === 0) {
    rows.push({
      label: "Changes",
      before: "—",
      after: "No field-level differences detected from published version.",
      summary: "No field-level differences detected from the published version.",
      kind: "info",
    });
  }

  return rows;
}

export function feeSummaryForPublish(def: ServiceDefinitionDto): string {
  const amount = extractFeeFromMinor(def);
  const parts: string[] = [];
  if (def.feeModel) parts.push(`${def.feeModel} fee`);
  if (amount != null) parts.push(`from ${formatPaiseInr(amount)}`);
  if (def.hoaCode) parts.push(`HOA ${def.hoaCode}`);
  return parts.length > 0 ? parts.join(" · ") : "No fee configured";
}

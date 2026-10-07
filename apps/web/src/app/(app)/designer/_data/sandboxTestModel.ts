/**
 * FN-10 sandbox test helpers — pure mapping / formatting (no DOM, no fetch).
 */

import type { TestRunStep, TestStepStatus } from "@/app/_components/ds/designer";
import { formatMoney, minorToRupeesOrNull } from "@/lib/formatters";

export const DEFAULT_SANDBOX_STEPS: TestRunStep[] = [
  { id: "form", label: "Intake form validates", status: "pending" },
  { id: "eligibility", label: "Eligibility rules", status: "pending" },
  { id: "workflow", label: "Approval chain lanes", status: "pending" },
  { id: "demand", label: "Fee demand lines", status: "pending" },
  { id: "payment", label: "Test payment", status: "pending" },
  { id: "gl", label: "Accounts posting (ledger entry)", status: "pending" },
  { id: "certificate", label: "Certificate issuance", status: "pending" },
];

export interface ThreePartError {
  what: string;
  why: string;
  next: string;
}

export interface DemandLineArtifact {
  label: string;
  amountMinor: number;
  taxHeadCode?: string;
}

export interface JournalPreviewArtifact {
  debit: string;
  credit: string;
  amountMinor: number;
}

/** Split a concatenated sandbox error, or use structured why/next when present. */
export function resolveThreePartError(input: {
  error?: string | null;
  why?: string | null;
  next?: string | null;
  what?: string | null;
}): ThreePartError | null {
  const why = typeof input.why === "string" ? input.why.trim() : "";
  const next = typeof input.next === "string" ? input.next.trim() : "";
  const whatExplicit = typeof input.what === "string" ? input.what.trim() : "";
  const error = typeof input.error === "string" ? input.error.trim() : "";

  if (whatExplicit || why || next) {
    let what = whatExplicit;
    if (!what && error) {
      // Backend concatenates `${what} ${why} ${next}` — peel structured tails when possible.
      what = error;
      if (why && what.endsWith(why)) what = what.slice(0, -why.length).trim();
      if (next && what.endsWith(next)) what = what.slice(0, -next.length).trim();
      if (why && what.endsWith(why)) what = what.slice(0, -why.length).trim();
    }
    return {
      what: what || error || "This step failed.",
      why: why || "The sandbox could not complete this check.",
      next: next || "Open the linked block and fix the configuration.",
    };
  }

  if (!error) return null;
  return {
    what: error,
    why: "The sandbox could not complete this check.",
    next: "Open the linked block and fix the configuration.",
  };
}

export function formatPaise(amountMinor: number | null | undefined, currency = "INR"): string {
  // UX-018: amountMinor is non-nullable by type (DemandLineArtifact/JournalPreviewArtifact
  // both default it to 0 in parseDemandLines/parseJournalPreview), but this helper is
  // exported and could be called directly with an unchecked API value — guard anyway
  // rather than let a future caller silently show "₹NaN" or a fabricated "₹0.00".
  // GAP-DESIGNER-DETAIL-ENGINES-04: delegate the INR path to the shared formatMoney
  // so B5, test, and review all render the same fee identically (always 2dp).
  if (currency === "INR") return formatMoney(amountMinor);
  const rupees = minorToRupeesOrNull(amountMinor);
  if (rupees === null) return "—";
  const formatted = rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${currency}`;
}

export function parseDemandLines(artifacts?: Record<string, unknown> | null): DemandLineArtifact[] {
  if (!artifacts || !Array.isArray(artifacts.sampleLines)) return [];
  return artifacts.sampleLines.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      label: typeof row.label === "string" ? row.label : "Line",
      amountMinor: typeof row.amountMinor === "number" ? row.amountMinor : 0,
      taxHeadCode: typeof row.taxHeadCode === "string" ? row.taxHeadCode : undefined,
    };
  });
}

export function parseJournalPreview(
  artifacts?: Record<string, unknown> | null,
): JournalPreviewArtifact | null {
  const raw = artifacts?.journalPreview;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.debit !== "string" || typeof row.credit !== "string") return null;
  return {
    debit: row.debit,
    credit: row.credit,
    amountMinor: typeof row.amountMinor === "number" ? row.amountMinor : 0,
  };
}

function mapStatus(raw: unknown): TestStepStatus {
  if (raw === "pass" || raw === "fail" || raw === "running" || raw === "pending") return raw;
  if (raw === "skip") return "pass";
  return "pending";
}

/** Map API sandbox steps onto the canonical FN-10 checklist order. */
export function mapSandboxSteps(steps: unknown, definitionId: string): TestRunStep[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    return DEFAULT_SANDBOX_STEPS.map((s) => ({ ...s }));
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const s of steps) {
    if (!s || typeof s !== "object") continue;
    const row = s as Record<string, unknown>;
    byId.set(String(row.id ?? ""), row);
  }

  const orderedIds = DEFAULT_SANDBOX_STEPS.map((s) => s.id);
  const extras = [...byId.keys()].filter((id) => id && !orderedIds.includes(id));

  return [...orderedIds, ...extras].map((id) => {
    const fallback = DEFAULT_SANDBOX_STEPS.find((s) => s.id === id);
    const row = byId.get(id);
    if (!row) {
      return fallback ? { ...fallback } : { id, label: id, status: "pending" as const };
    }

    const status = mapStatus(row.status);
    const skipped = row.status === "skip";
    const three = resolveThreePartError({
      error: typeof row.error === "string" ? row.error : undefined,
      why: typeof row.why === "string" ? row.why : undefined,
      next: typeof row.next === "string" ? row.next : undefined,
      what: typeof row.what === "string" ? row.what : undefined,
    });

    let blockLink = typeof row.blockLink === "string" ? row.blockLink : undefined;
    if (blockLink) blockLink = blockLink.replace("__ID__", definitionId);
    else if (typeof row.blockId === "string") {
      blockLink = `/designer/${definitionId}/${row.blockId}`;
    }

    return {
      id,
      label: typeof row.label === "string" && row.label
        ? row.label
        : (fallback?.label ?? id),
      status: skipped ? "pass" : status,
      skipped,
      error: three?.what,
      why: three?.why,
      next: three?.next,
      blockLink,
      artifacts:
        typeof row.artifacts === "object" && row.artifacts !== null
          ? (row.artifacts as Record<string, unknown>)
          : undefined,
    };
  });
}

export function stepsAsRunning(): TestRunStep[] {
  return DEFAULT_SANDBOX_STEPS.map((s) => ({ ...s, status: "running" as const }));
}

export function stepsAsTransportFail(message: string): TestRunStep[] {
  const three = resolveThreePartError({ error: message })!;
  return DEFAULT_SANDBOX_STEPS.map((s) => ({
    ...s,
    status: "fail" as const,
    error: three.what,
    why: three.why,
    next: three.next,
  }));
}

/**
 * GAP-DESIGNER-DETAIL-TEST-03: map sandbox test step ids to wizard block ids,
 * so a failed step can mark the owning block with status 'error' + errorCount
 * in the WizardShell block rail.
 */
export const STEP_TO_BLOCK: Record<string, string> = {
  form: "b2",
  eligibility: "b3",
  workflow: "b4",
  demand: "b5",
  payment: "b5",
  gl: "b5",
  certificate: "b7",
};

/**
 * Derive per-block error counts from sandbox test steps, suitable for passing
 * to WizardShell as `blocks[].status = 'error'` + `errorCount`.
 */
/**
 * GAP-DESIGNER-DETAIL-TEST-02: a passing test run is considered stale if the
 * definition was updated after the test was created. This ensures canSubmit
 * rejects results that no longer reflect the current design.
 *
 * Returns true when the test run is out-of-date, false when still current, and
 * false when either date is missing (erring on the side of not blocking).
 */
export function isTestStale(
  testCreatedAt: string | null | undefined,
  defUpdatedAt: string | null | undefined,
): boolean {
  if (!testCreatedAt || !defUpdatedAt) return false;
  const testMs = new Date(testCreatedAt).getTime();
  const defMs = new Date(defUpdatedAt).getTime();
  if (Number.isNaN(testMs) || Number.isNaN(defMs)) return false;
  return defMs > testMs;
}

export function blockErrorsFromSteps(
  steps: TestRunStep[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const step of steps) {
    if (step.status !== "fail") continue;
    const blockId = STEP_TO_BLOCK[step.id];
    if (blockId) counts[blockId] = (counts[blockId] ?? 0) + 1;
  }
  return counts;
}

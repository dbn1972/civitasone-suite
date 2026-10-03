/**
 * GAP-ADMIN-ONBOARDING-07 follow-up: browser helpers for creating an onboarding request and moving it
 * between stages, so the queue is usable without an API client. Both only publish a command (202);
 * the server re-checks the stage machine atomically, and a stale view comes back as a plain 409.
 */
import { toHumanError } from "@/lib/messages";

export const ONBOARDING_STAGE_ORDER = ["new request", "in progress", "go-live pending", "completed", "rejected", "cancelled"] as const;
export type CanonicalStage = (typeof ONBOARDING_STAGE_ORDER)[number];

// Mirrors admin-service platform-ops/domain.ts TRANSITIONS (the server stays the authority).
const NEXT: Record<CanonicalStage, readonly CanonicalStage[]> = {
  "new request": ["in progress", "rejected", "cancelled"],
  "in progress": ["go-live pending", "rejected", "cancelled"],
  "go-live pending": ["completed", "in progress", "cancelled"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function nextStages(stage: string): CanonicalStage[] {
  const s = stage.trim().toLowerCase().replace(/[_-]+/g, " ") === "go live pending" ? "go-live pending" : stage.trim().toLowerCase();
  return (NEXT as Record<string, readonly CanonicalStage[]>)[s]?.slice() ?? [];
}

/** Moves that close a request unsuccessfully: a reason is required. */
export function needsReason(to: CanonicalStage): boolean {
  return to === "rejected" || to === "cancelled";
}

export const STAGE_ACTION_LABEL: Record<CanonicalStage, string> = {
  "new request": "Reopen",
  "in progress": "Start work",
  "go-live pending": "Ready for go-live",
  completed: "Complete",
  rejected: "Reject",
  cancelled: "Cancel request",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID.test(v.trim());

export type ActionResult = { ok: true } | { ok: false; message: string };

async function failure(res: Response | null): Promise<string> {
  let code: string | undefined;
  try {
    const b = (await res?.json()) as { code?: string; error?: { code?: string } } | undefined;
    code = b?.code ?? b?.error?.code;
  } catch { /* no body */ }
  if (code === "STAGE_CHANGED") return "Someone else already moved this request. Refresh the queue and try again.";
  if (code === "ILLEGAL_TRANSITION") return "That step is not allowed from the request's current stage.";
  const h = toHumanError("save", { area: "onboarding request" });
  return `${h.what} ${h.next}`;
}

async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.ok ? { ok: true } : { ok: false, message: await failure(res) };
  } catch {
    return { ok: false, message: await failure(null) };
  }
}

export function createOnboardingRequest(b: { orgName: string; contactName: string; contactEmail: string; notes?: string }): Promise<ActionResult> {
  return send("/api/proxy/v1/admin/onboarding", "POST", {
    orgName: b.orgName.trim(), contactName: b.contactName.trim(), contactEmail: b.contactEmail.trim(),
    ...(b.notes?.trim() ? { notes: b.notes.trim() } : {}),
  });
}

export function moveOnboardingStage(id: string, b: { from: string; to: CanonicalStage; note?: string; provisionedTenantId?: string }): Promise<ActionResult> {
  return send(`/api/proxy/v1/admin/onboarding/${encodeURIComponent(id)}/stage`, "PATCH", {
    from: b.from, to: b.to,
    ...(b.note?.trim() ? { note: b.note.trim() } : {}),
    ...(b.to === "completed" && b.provisionedTenantId?.trim() ? { provisionedTenantId: b.provisionedTenantId.trim() } : {}),
  });
}

/**
 * court feature — client-side API calls (mutations + interactive reads).
 *
 * Uses the app's browser client (src/lib/api/browserClient.ts) which routes
 * through the BFF proxy /api/proxy/<path> (httpOnly session cookie + device
 * headers). Paths are the gateway paths WITHOUT the /api prefix, e.g.
 * "v1/court/..."; the gateway then rewrites "/api/v1/court" → the service's
 * internal "/v1/court". Every function throws on non-2xx; callers show a
 * plain-language error state.
 *
 * Write paths are command-bus backed and answer 202 Accepted with an envelope
 * like { accepted: true, ... }; we return it verbatim where the id is useful.
 * Optimistic locking: mutations that change an existing row carry the
 * caller's last-read `expectedVersion`; a concurrent edit makes it stale and
 * the service rejects the write (409) rather than silently clobbering.
 */
import { browserFetch } from "@/lib/api/browserClient";
import type {
  CaseStatus,
  CauseListItem,
  CauseListRef,
  CertifiedCopy,
  ConfigEntry,
  CopyStatus,
  CourtCase,
  CourtOrder,
  Hearing,
  PresetName,
} from "./types";

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `Request failed (${res.status})`;
    try {
      const j = JSON.parse(text) as {
        message?: string;
        code?: string;
        error?: { message?: string; code?: string };
      };
      return (
        j.error?.message ?? j.message ?? j.error?.code ?? j.code ?? text
      );
    } catch {
      return text;
    }
  } catch {
    return `Request failed (${res.status})`;
  }
}

async function send<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  opts: { body?: unknown } = {},
): Promise<T> {
  const res = await browserFetch(path, {
    method,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!res.ok) throw new Error(await readError(res));
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await browserFetch(path);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

// ─── Interactive reads ───────────────────────────────────────────────────────

export async function fetchCases(status?: CaseStatus): Promise<CourtCase[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}&limit=100` : "?limit=100";
  const out = await get<{ items?: CourtCase[] }>(`v1/court/cases${qs}`);
  return out.items ?? [];
}

export async function fetchCaseOrders(caseId: string): Promise<CourtOrder[]> {
  const out = await get<{ items?: CourtOrder[] }>(`v1/court/cases/${caseId}/orders`);
  return out.items ?? [];
}

export async function fetchCaseHearings(caseId: string): Promise<Hearing[]> {
  const out = await get<{ items?: Hearing[] }>(`v1/court/cases/${caseId}/hearings`);
  return out.items ?? [];
}

export async function fetchCaseCertifiedCopies(caseId: string): Promise<CertifiedCopy[]> {
  const out = await get<{ items?: CertifiedCopy[] }>(`v1/court/cases/${caseId}/certified-copies`);
  return out.items ?? [];
}

export async function fetchCauseListItems(causeListId: string): Promise<CauseListItem[]> {
  const out = await get<{ items?: CauseListItem[] }>(
    `v1/court/cause-lists/${causeListId}/items`,
  );
  return out.items ?? [];
}

export async function fetchConfigNamespace(namespace: string): Promise<ConfigEntry[]> {
  const out = await get<{ items?: ConfigEntry[] }>(`v1/court/config/${namespace}`);
  return out.items ?? [];
}

// ─── Case lifecycle ──────────────────────────────────────────────────────────

/** Move a case to a new lifecycle status (registrar/court_admin/judge). */
export async function transitionCase(
  caseId: string,
  input: { toStatus: CaseStatus; expectedVersion: number; reason?: string },
): Promise<void> {
  await send("PATCH", `v1/court/cases/${caseId}/status`, {
    body: {
      toStatus: input.toStatus,
      expectedVersion: input.expectedVersion,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });
}

// ─── Hearings ────────────────────────────────────────────────────────────────

/** Schedule a hearing on a case. `scheduledAt` is an ISO-8601 instant. */
export async function scheduleHearing(
  caseId: string,
  input: { scheduledAt: string; purpose?: string; benchId?: string },
): Promise<void> {
  await send("POST", `v1/court/cases/${caseId}/hearings`, {
    body: {
      scheduledAt: input.scheduledAt,
      ...(input.purpose ? { purpose: input.purpose } : {}),
      ...(input.benchId ? { benchId: input.benchId } : {}),
    },
  });
}

/** Adjourn a scheduled hearing to a next date (§20). */
export async function adjournHearing(
  hearingId: string,
  input: { reason: string; nextDate: string; expectedVersion: number },
): Promise<void> {
  await send("PATCH", `v1/court/hearings/${hearingId}/adjourn`, {
    body: {
      reason: input.reason,
      nextDate: input.nextDate,
      expectedVersion: input.expectedVersion,
    },
  });
}

/** Record a scheduled hearing's outcome (held | cancelled). */
export async function recordHearingOutcome(
  hearingId: string,
  input: { outcome: "held" | "cancelled"; notes?: string; expectedVersion: number },
): Promise<void> {
  await send("PATCH", `v1/court/hearings/${hearingId}/outcome`, {
    body: {
      outcome: input.outcome,
      ...(input.notes ? { notes: input.notes } : {}),
      expectedVersion: input.expectedVersion,
    },
  });
}

// ─── Orders + issuance (maker-checker) ───────────────────────────────────────

/** Draft (record) an order on a case — the MAKER's first step (judge/court_admin). */
export async function recordOrder(
  caseId: string,
  input: { orderType: string; orderText: string; orderDate?: string; hearingId?: string },
): Promise<{ id?: string }> {
  const out = await send<{ id?: string; data?: { id?: string } }>(
    "POST",
    `v1/court/cases/${caseId}/orders`,
    {
      body: {
        orderType: input.orderType,
        orderText: input.orderText,
        ...(input.orderDate ? { orderDate: input.orderDate } : {}),
        ...(input.hearingId ? { hearingId: input.hearingId } : {}),
      },
    },
  );
  return out.data ?? out;
}

/** Submit a drafted order for approval (draft → pending_approval). */
export async function submitOrderForApproval(
  orderId: string,
  expectedVersion: number,
): Promise<void> {
  await send("PATCH", `v1/court/orders/${orderId}/submit-for-approval`, {
    body: { expectedVersion },
  });
}

/**
 * Approve + issue (pronounce) an order — the CHECKER's step (pending_approval →
 * issued). The service enforces maker-checker separation server-side: the
 * approver MUST differ from the maker, and issuance is a human, DSC-signed act.
 * `dscSignature` is the detached Digital Signature Certificate blob.
 */
export async function approveAndIssueOrder(
  orderId: string,
  input: { dscSignature: string; expectedVersion: number; issuedDate?: string },
): Promise<void> {
  await send("PATCH", `v1/court/orders/${orderId}/approve-issue`, {
    body: {
      dscSignature: input.dscSignature,
      expectedVersion: input.expectedVersion,
      ...(input.issuedDate ? { issuedDate: input.issuedDate } : {}),
    },
  });
}

/** Send a pending order back to its maker for revision (pending_approval → draft). */
export async function sendBackOrder(
  orderId: string,
  input: { expectedVersion: number; remarks?: string },
): Promise<void> {
  await send("PATCH", `v1/court/orders/${orderId}/send-back`, {
    body: {
      expectedVersion: input.expectedVersion,
      ...(input.remarks ? { remarks: input.remarks } : {}),
    },
  });
}

/** Recall an already-issued order (issued → recalled). Reason mandatory. */
export async function recallOrder(
  orderId: string,
  input: { recallReason: string; expectedVersion: number },
): Promise<void> {
  await send("PATCH", `v1/court/orders/${orderId}/recall`, {
    body: { recallReason: input.recallReason, expectedVersion: input.expectedVersion },
  });
}

// ─── Certified copies (§30) ──────────────────────────────────────────────────

/** Apply for a certified copy of an order / judgment / case document. */
export async function requestCertifiedCopy(
  caseId: string,
  input: {
    orderId?: string;
    documentRef?: string;
    applicantName?: string;
    copiesCount?: number;
    urgent?: boolean;
  },
): Promise<{ copyId?: string }> {
  const out = await send<{ copyId?: string }>("POST", `v1/court/cases/${caseId}/certified-copies`, {
    body: {
      ...(input.orderId ? { orderId: input.orderId } : {}),
      ...(input.documentRef ? { documentRef: input.documentRef } : {}),
      ...(input.applicantName ? { applicantName: input.applicantName } : {}),
      copiesCount: input.copiesCount ?? 1,
      ...(input.urgent ? { urgent: true } : {}),
    },
  });
  return out;
}

/**
 * Transition a certified copy (advance / issue / reject). Moving to
 * `fee_paid` REQUIRES `paymentRef` + `receiptMinor` — the service rejects a
 * bare status flip with no proof the fee was actually collected (§30
 * integrity), and separately asserts the receipted amount matches the
 * server-computed fee.
 */
export async function transitionCertifiedCopy(
  copyId: string,
  input: {
    target: CopyStatus;
    expectedVersion: number;
    paymentRef?: string;
    receiptMinor?: string | number;
    deliveryMode?: string;
    remarks?: string;
  },
): Promise<void> {
  await send("PATCH", `v1/court/certified-copies/${copyId}/status`, {
    body: {
      target: input.target,
      expectedVersion: input.expectedVersion,
      ...(input.paymentRef ? { paymentRef: input.paymentRef } : {}),
      ...(input.receiptMinor !== undefined ? { receiptMinor: input.receiptMinor } : {}),
      ...(input.deliveryMode ? { deliveryMode: input.deliveryMode } : {}),
      ...(input.remarks ? { remarks: input.remarks } : {}),
    },
  });
}

// ─── Cause list ──────────────────────────────────────────────────────────────

/** Generate (materialize) a cause-list for a court/day. Returns its id. */
export async function createCauseList(input: {
  courtId: string;
  listDate: string;
  benchId?: string;
  listType?: string;
}): Promise<CauseListRef> {
  const out = await send<{ id?: string; data?: { id?: string } } & Record<string, unknown>>(
    "POST",
    `v1/court/cause-lists`,
    {
      body: {
        courtId: input.courtId,
        listDate: input.listDate,
        ...(input.benchId ? { benchId: input.benchId } : {}),
        ...(input.listType ? { listType: input.listType } : {}),
      },
    },
  );
  const id = out.data?.id ?? out.id ?? "";
  return { id, courtId: input.courtId, listDate: input.listDate };
}

/** List a case onto a slot/courtroom of a cause-list. */
export async function addCauseListItem(
  causeListId: string,
  input: { caseId: string; itemNumber: number; slot: string; courtroom: string },
): Promise<void> {
  await send("POST", `v1/court/cause-lists/${causeListId}/items`, {
    body: {
      caseId: input.caseId,
      itemNumber: input.itemNumber,
      slot: input.slot,
      courtroom: input.courtroom,
    },
  });
}

// ─── Config engine (§47) ─────────────────────────────────────────────────────

export async function setConfig(input: {
  namespace: string;
  configKey: string;
  value: unknown;
  label?: string;
  expectedVersion?: number;
}): Promise<void> {
  await send("POST", "v1/court/config", {
    body: {
      namespace: input.namespace,
      configKey: input.configKey,
      value: input.value,
      ...(input.label ? { label: input.label } : {}),
      ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
    },
  });
}

/** Deactivate (soft-retire) a config entry by id. */
export async function deactivateConfig(
  configId: string,
  expectedVersion: number,
): Promise<void> {
  await send("PATCH", `v1/court/config/${configId}/deactivate`, {
    body: { expectedVersion },
  });
}

/** Apply a vertical onboarding preset (revenue | consumer | tribunal). */
export async function applyPreset(preset: PresetName): Promise<void> {
  await send("POST", `v1/court/config/presets/${preset}`, { body: {} });
}

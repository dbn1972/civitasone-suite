import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import type { InstrumentRow } from "../treasury/schema.js";
import * as repo from "./repo.js";
import type { Queue } from "@civitasone/queue";
import { recordAudit } from "../../shared/audit-event.js";
import { publishCommand, subscribeApply, type Accepted, type Actor, type Tx } from "../../shared/finance-command.js";
import { COMMANDS } from "../../topics.js";
import { getPolicy, readPolicyWith } from "../masters/policy.js";
import { isStale, todayIso, validUntil } from "./domain.js";
import type { IssueInstrumentBody, BounceInstrumentBody, ReasonedInstrumentBody } from "./validators.js";

function serialize(row: InstrumentRow) {
  return {
    id: row.id,
    instrumentType: row.instrumentType,
    instrumentNo: row.instrumentNo,
    bankAccountId: row.bankAccountId,
    bankName: row.bankName,
    payee: row.payee,
    amountMinor: row.amountMinor.toString(),
    currency: row.currency,
    issueDate: row.issueDate,
    status: row.status,
    presentedAt: row.presentedAt,
    clearedAt: row.clearedAt,
    bouncedAt: row.bouncedAt,
    cancelledAt: row.cancelledAt,
    bounceReason: row.bounceReason,
    paymentId: row.paymentId,
    version: row.version,
    // GAP-FINANCE-TREASURY-CHEQUES-DETAIL-03: the actor behind each lifecycle step (ids; the web
    // resolves names). issuedBy is the creator. Null for steps taken before migration 0085.
    issuedBy: row.createdBy,
    presentedBy: row.presentedBy ?? null,
    clearedBy: row.clearedBy ?? null,
    bouncedBy: row.bouncedBy ?? null,
    cancelledBy: row.cancelledBy ?? null,
    cancelReason: row.cancelReason ?? null,
    representCount: row.representCount,
    lastRepresentedAt: row.lastRepresentedAt ?? null,
    lastRepresentedBy: row.lastRepresentedBy ?? null,
    representReason: row.representReason ?? null,
    staledAt: row.staledAt ?? null,
    staledBy: row.staledBy ?? null,
  };
}
export type InstrumentView = ReturnType<typeof serialize>;

type AuditableAction = "issue" | "present" | "clear" | "bounce" | "cancel";

/** Audit event for an instrument mutation, enqueued inside the mutation's own transaction. */
async function auditInstrumentTx(
  tx: Parameters<typeof enqueue>[0], ctx: Actor, action: AuditableAction,
  row: Pick<InstrumentRow, "id" | "instrumentType" | "instrumentNo">, fromStatus: string | null, toStatus: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: {
      service: "finance", action, resourceType: "instrument", resourceId: row.id, outcome: "success",
      details: { instrumentType: row.instrumentType, instrumentNo: row.instrumentNo, fromStatus, toStatus },
    },
  });
}

/**
 * GAP-FINANCE-TREASURY-CHEQUES-03: maker != checker. The officer who issued an
 * instrument may not also record its clearance or dishonour -- the bank outcome
 * of a payment instrument is confirmed by a second person. Always enforced, with
 * no switch (a deployment-wide off-switch would disable the control for every
 * tenant); any per-tenant opt-out belongs on the tenant finance policy.
 */
export function assertInstrumentChecker(issuerId: string, actorId: string): void {
  if (issuerId === actorId) {
    throw new HttpError(403, "MAKER_CHECKER_VIOLATION",
      "the officer who issued this instrument cannot also record its clearance or dishonour (maker-checker)");
  }
}

/** Terms that must match for a re-issue of the same instrument number to count as the same instrument. */
function sameTerms(row: InstrumentRow, body: IssueInstrumentBody): boolean {
  return row.amountMinor === BigInt(body.amountMinor) && row.payee === body.payee;
}

function conflict(body: IssueInstrumentBody): HttpError {
  return new HttpError(409, "INSTRUMENT_CONFLICT",
    `instrument ${body.instrumentType} ${body.instrumentNo} already issued with different terms`);
}

/**
 * Issue (consumer side): one transaction -- the idempotency marker is the caller's, the insert is idempotent on
 * (tenant, type, number), and only the request that actually creates the row is audited. A re-issue with different
 * material terms is a conflict (409 -> dead-lettered, nothing written).
 */
export async function applyIssue(tx: Tx, actor: Actor, body: IssueInstrumentBody): Promise<void> {
  const issueDate = body.issueDate ?? new Date().toISOString().slice(0, 10);
  const res = await repo.insertInstrumentTx(tx, {
    tenantId: actor.tenantId,
    instrumentType: body.instrumentType,
    instrumentNo: body.instrumentNo,
    bankName: body.bankName,
    payee: body.payee,
    amountMinor: BigInt(body.amountMinor),
    currency: body.currency,
    issueDate,
    status: "issued",
    createdBy: actor.actorId,
    updatedBy: actor.actorId,
    ...(body.bankAccountId ? { bankAccountId: body.bankAccountId } : {}),
    ...(body.paymentId ? { paymentId: body.paymentId } : {}),
  });
  if (!sameTerms(res.row, body)) throw conflict(body);
  if (res.created) {
    await enqueue(tx, {
      topic: "finance.instrument.issued", eventType: "finance.instrument.issued",
      tenantId: actor.tenantId, actorId: actor.actorId, correlationId: actor.correlationId,
      payload: { instrumentNo: body.instrumentNo, instrumentType: body.instrumentType, amountMinor: body.amountMinor },
    });
    await auditInstrumentTx(tx, actor, "issue", res.row, null, "issued");
  }
}

async function load(ctx: RequestContext, id: string): Promise<InstrumentRow> {
  const row = await repo.findById(ctx.tenantId, id);
  if (!row) throw new HttpError(404, "NOT_FOUND", "instrument not found");
  return row;
}

export type TransitionAction = "present" | "clear" | "bounce" | "cancel";
const TRANSITIONS: Record<TransitionAction, { from: string[]; to: string; ts: "presentedAt" | "clearedAt" | "bouncedAt" | "cancelledAt" }> = {
  present: { from: ["issued"], to: "presented", ts: "presentedAt" },
  clear: { from: ["issued", "presented"], to: "cleared", ts: "clearedAt" },
  bounce: { from: ["issued", "presented"], to: "bounced", ts: "bouncedAt" },
  cancel: { from: ["issued"], to: "cancelled", ts: "cancelledAt" },
};

function staleError(policyMonths: number, issueDate: string): HttpError {
  return new HttpError(409, "INSTRUMENT_STALE",
    `instrument is past its ${policyMonths}-month validity (valid until ${validUntil(issueDate, policyMonths)}); it cannot be presented`);
}

/**
 * Transition (consumer side): ONE guarded UPDATE + audit in the caller's transaction. The WHERE pins the source
 * status, so a replay or a lost race matches no row: an already-applied transition is an idempotent no-op (no second
 * audit), anything else is an ILLEGAL_TRANSITION (409). Maker != checker is enforced here too (clear / bounce), so
 * the queue cannot be used to get around the check the route pre-checks.
 *   present: issued -> presented (refused once past the validity horizon)
 *   clear / bounce: issued|presented -> cleared / bounced        cancel: issued -> cancelled (reason mandatory)
 */
export async function applyTransition(
  tx: Tx, actor: Actor, input: { id: string; action: TransitionAction; reason?: string | undefined },
): Promise<void> {
  const t = TRANSITIONS[input.action];
  if (!t) throw new HttpError(400, "UNKNOWN_ACTION", `unknown instrument action ${String(input.action)}`);
  const cur = await repo.findByIdTx(tx, actor.tenantId, input.id);
  if (!cur) throw new HttpError(404, "NOT_FOUND", "instrument not found");
  if (cur.status === t.to) return; // idempotent
  if (input.action === "clear" || input.action === "bounce") assertInstrumentChecker(cur.createdBy, actor.actorId);
  if (input.action === "present") {
    const policy = await readPolicyWith(tx, actor.tenantId);
    if (isStale(String(cur.issueDate), policy.chequeValidityMonths, todayIso())) throw staleError(policy.chequeValidityMonths, String(cur.issueDate));
  }
  const patch = input.action === "bounce" ? { bounceReason: input.reason ?? "dishonoured" }
    : input.action === "cancel" ? { cancelReason: input.reason ?? "" } : {};
  const row = await repo.transitionTx(tx, actor.tenantId, input.id, t.from, t.to, patch, t.ts, actor.actorId);
  if (!row) {
    // Lost a race: the winner may have applied this very transition (idempotent replay, no second audit).
    const latest = await repo.findByIdTx(tx, actor.tenantId, input.id);
    if (latest?.status === t.to) return;
    throw illegal(latest?.status ?? cur.status, t.to);
  }
  await enqueue(tx, {
    topic: `finance.instrument.${t.to}`, eventType: `finance.instrument.${t.to}`,
    tenantId: actor.tenantId, actorId: actor.actorId, correlationId: actor.correlationId,
    payload: { id: input.id, status: t.to },
  });
  await recordAudit(tx, actor, {
    action: input.action, resourceType: "instrument", resourceId: input.id,
    details: {
      instrumentType: row.instrumentType, instrumentNo: row.instrumentNo, fromStatus: cur.status, toStatus: t.to,
      ...(input.action === "cancel" ? { reason: input.reason } : {}),
    },
  });
}

/**
 * How long a route waits for its command to be applied before answering 202 instead. The consumer is the only writer;
 * the wait just lets the route keep its original contract (the updated view) on the normal, prompt path.
 */
const APPLY_WAIT_MS = Number(process.env.FINANCE_COMMAND_WAIT_MS ?? 5000);

async function waitFor<T>(probe: () => Promise<T | null>): Promise<T | null> {
  const deadline = Date.now() + APPLY_WAIT_MS;
  for (;;) {
    const hit = await probe();
    if (hit) return hit;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 40));
  }
}

/**
 * Issue a cheque/DD. Route side: read-only pre-checks, then publish; the consumer writes. Idempotent on
 * (tenant, type, number): an existing instrument with the same terms is returned as-is, with different terms it is a 409.
 * Returns the view once applied, or Accepted (202) if the consumer has not applied it within the wait.
 */
export async function issueInstrument(ctx: RequestContext, body: IssueInstrumentBody): Promise<InstrumentView | Accepted> {
  const existing = await repo.findByNumber(ctx.tenantId, body.instrumentType, body.instrumentNo);
  if (existing) {
    if (!sameTerms(existing, body)) throw conflict(body);
    return serialize(existing);
  }
  const accepted = await publishCommand(ctx, COMMANDS.instrumentIssue, { ...body }, `${body.instrumentType}:${body.instrumentNo}`);
  const row = await waitFor(() => repo.findByNumber(ctx.tenantId, body.instrumentType, body.instrumentNo));
  if (!row) return accepted;
  if (!sameTerms(row, body)) throw conflict(body);
  return serialize(row);
}

/** Shared route side of the four status transitions. */
async function requestTransition(ctx: RequestContext, id: string, action: TransitionAction, reason?: string): Promise<InstrumentView | Accepted> {
  const t = TRANSITIONS[action];
  const current = await load(ctx, id);
  if (current.status === t.to) return serialize(current); // idempotent: nothing to publish
  if (action === "clear" || action === "bounce") assertInstrumentChecker(current.createdBy, ctx.actorId);
  if (!t.from.includes(current.status)) throw illegal(current.status, t.to);
  if (action === "present") {
    const policy = await getPolicy(ctx.tenantId);
    if (isStale(String(current.issueDate), policy.chequeValidityMonths, todayIso())) throw staleError(policy.chequeValidityMonths, String(current.issueDate));
  }
  const accepted = await publishCommand(ctx, COMMANDS.instrumentTransition, { id, action, ...(reason ? { reason } : {}) }, id);
  const row = await waitFor(async () => {
    const r = await repo.findById(ctx.tenantId, id);
    return r && r.status !== current.status ? r : null;
  });
  if (!row) return accepted;
  if (row.status !== t.to) throw illegal(row.status, t.to); // another transition won the race
  return serialize(row);
}

/** present: issued -> presented. Idempotent. Illegal from a terminal state -> 409. */
export const presentInstrument = (ctx: RequestContext, id: string) => requestTransition(ctx, id, "present");

/** clear: issued|presented -> cleared. Idempotent. Maker != checker. */
export const clearInstrument = (ctx: RequestContext, id: string) => requestTransition(ctx, id, "clear");

/** bounce: issued|presented -> bounced (dishonoured). Idempotent. Maker != checker. */
export const bounceInstrument = (ctx: RequestContext, id: string, body: BounceInstrumentBody) =>
  requestTransition(ctx, id, "bounce", body.reason);

/** cancel: only an un-presented (issued) instrument; a reason is mandatory (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04). Idempotent. */
export const cancelInstrument = (ctx: RequestContext, id: string, body: ReasonedInstrumentBody) =>
  requestTransition(ctx, id, "cancel", body.reason);

/**
 * re-present: bounced -> presented again, with a reason. Refused once the instrument is past its validity horizon
 * (it can no longer be presented, only re-issued). Consumer side: one guarded UPDATE + audit in the caller's tx.
 */
export async function applyRepresent(tx: Tx, actor: Actor, input: { id: string; reason: string }): Promise<void> {
  const cur = await repo.findByIdTx(tx, actor.tenantId, input.id);
  if (!cur) throw new HttpError(404, "NOT_FOUND", "instrument not found");
  if (cur.status !== "bounced") throw illegal(cur.status, "presented");
  const policy = await readPolicyWith(tx, actor.tenantId);
  if (isStale(String(cur.issueDate), policy.chequeValidityMonths, todayIso())) {
    throw new HttpError(409, "INSTRUMENT_STALE",
      `instrument is past its ${policy.chequeValidityMonths}-month validity (valid until ${validUntil(String(cur.issueDate), policy.chequeValidityMonths)}); re-issue it instead`);
  }
  const row = await repo.representTx(tx, actor.tenantId, input.id, input.reason, actor.actorId);
  if (!row) throw illegal("changed concurrently", "presented");
  await recordAudit(tx, actor, {
    action: "represent", resourceType: "instrument", resourceId: input.id,
    details: { instrumentType: row.instrumentType, instrumentNo: row.instrumentNo, fromStatus: "bounced", toStatus: "presented", reason: input.reason, representCount: row.representCount },
  });
}

/** mark stale: issued -> stale, only once older than the tenant's validity horizon (default 3 months, RBI). Idempotent. */
export async function applyMarkStale(tx: Tx, actor: Actor, input: { id: string; reason?: string | undefined }): Promise<void> {
  const cur = await repo.findByIdTx(tx, actor.tenantId, input.id);
  if (!cur) throw new HttpError(404, "NOT_FOUND", "instrument not found");
  if (cur.status === "stale") return;
  if (cur.status !== "issued") throw illegal(cur.status, "stale");
  const policy = await readPolicyWith(tx, actor.tenantId);
  if (!isStale(String(cur.issueDate), policy.chequeValidityMonths, todayIso())) {
    throw new HttpError(409, "INSTRUMENT_NOT_STALE",
      `instrument is valid until ${validUntil(String(cur.issueDate), policy.chequeValidityMonths)}; it cannot be marked stale before then`);
  }
  const row = await repo.staleTx(tx, actor.tenantId, input.id, actor.actorId);
  if (!row) throw illegal("changed concurrently", "stale");
  await recordAudit(tx, actor, {
    action: "mark_stale", resourceType: "instrument", resourceId: input.id,
    details: { instrumentType: row.instrumentType, instrumentNo: row.instrumentNo, fromStatus: "issued", toStatus: "stale", ...(input.reason ? { reason: input.reason } : {}) },
  });
}

/** Route side of re-present: read-only pre-checks (immediate 409) then publish; the consumer is authoritative. */
export async function representInstrument(ctx: RequestContext, id: string, body: ReasonedInstrumentBody): Promise<Accepted> {
  const cur = await load(ctx, id);
  if (cur.status !== "bounced") throw illegal(cur.status, "presented");
  const policy = await getPolicy(ctx.tenantId);
  if (isStale(String(cur.issueDate), policy.chequeValidityMonths, todayIso())) {
    throw new HttpError(409, "INSTRUMENT_STALE",
      `instrument is past its ${policy.chequeValidityMonths}-month validity (valid until ${validUntil(String(cur.issueDate), policy.chequeValidityMonths)}); re-issue it instead`);
  }
  return publishCommand(ctx, COMMANDS.instrumentRepresent, { id, reason: body.reason }, id);
}

export async function markInstrumentStale(ctx: RequestContext, id: string, body: { reason?: string | undefined }): Promise<Accepted> {
  const cur = await load(ctx, id);
  if (cur.status !== "stale") {
    if (cur.status !== "issued") throw illegal(cur.status, "stale");
    const policy = await getPolicy(ctx.tenantId);
    if (!isStale(String(cur.issueDate), policy.chequeValidityMonths, todayIso())) {
      throw new HttpError(409, "INSTRUMENT_NOT_STALE",
        `instrument is valid until ${validUntil(String(cur.issueDate), policy.chequeValidityMonths)}; it cannot be marked stale before then`);
    }
  }
  return publishCommand(ctx, COMMANDS.instrumentMarkStale, { id, ...(body.reason ? { reason: body.reason } : {}) }, id);
}

export function registerInstrumentWorkflowConsumers(q: Queue): void {
  subscribeApply<{ id: string; reason: string }>(q, COMMANDS.instrumentRepresent, async (tx, actor, p) => { await applyRepresent(tx, actor, p); });
  subscribeApply<{ id: string; reason?: string }>(q, COMMANDS.instrumentMarkStale, async (tx, actor, p) => { await applyMarkStale(tx, actor, p); });
}

/**
 * Audited reveal of the drawn-on account number (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-01). The audit
 * event carries the instrument id, the actor and the reason, never the number itself.
 */
export async function revealInstrumentAccount(ctx: RequestContext, id: string, reason: string): Promise<{ accountNo: string }> {
  return db.transaction(async (tx) => {
    const cur = await repo.findByIdTx(tx, ctx.tenantId, id);
    if (!cur) throw new HttpError(404, "NOT_FOUND", "instrument not found");
    if (!cur.bankAccountId) throw new HttpError(404, "NO_BANK_ACCOUNT", "this instrument is not linked to a bank account");
    const accountNo = await repo.accountNoForInstrumentTx(tx, ctx.tenantId, cur.bankAccountId);
    if (!accountNo) throw new HttpError(404, "NO_BANK_ACCOUNT", "the linked bank account was not found");
    await recordAudit(tx, ctx, {
      action: "account_reveal", resourceType: "instrument", resourceId: id,
      details: { instrumentNo: cur.instrumentNo, bankAccountId: cur.bankAccountId, reason },
    });
    return { accountNo };
  });
}

export async function getInstrument(ctx: RequestContext, id: string) {
  const row = await load(ctx, id);
  const policy = await getPolicy(ctx.tenantId);
  const last4 = row.bankAccountId ? (await repo.accountLast4ByBankId(ctx.tenantId, [row.bankAccountId])).get(row.bankAccountId) ?? null : null;
  return {
    ...serialize(row),
    accountNoLast4: last4,
    // The last day the instrument is valid; the web offers "Mark stale" only after this date.
    validUntil: validUntil(String(row.issueDate), policy.chequeValidityMonths),
  };
}

export async function listInstruments(
  ctx: RequestContext,
  filters: { status?: string; type?: string; limit: number },
): Promise<InstrumentView[]> {
  const rows = await repo.listInstruments(ctx.tenantId, filters);
  const bankIds = [...new Set(rows.map((r) => r.bankAccountId).filter((id): id is string => !!id))];
  const last4 = await repo.accountLast4ByBankId(ctx.tenantId, bankIds);
  return rows.map((r) => ({ ...serialize(r), accountNoLast4: r.bankAccountId ? last4.get(r.bankAccountId) ?? null : null }));
}

function illegal(from: string, to: string): HttpError {
  return new HttpError(409, "ILLEGAL_TRANSITION", `cannot move instrument from '${from}' to '${to}'`);
}

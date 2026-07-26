/**
 * consent-exchange repository (SVC-150). All reads/writes run under the tenant
 * GUC (runWithTenant + db.transaction) so FORCED RLS scopes them to the tenant.
 * `performFetch` is the one synchronous, atomic path: it evaluates consent,
 * reads the in-scope holdings, appends the access ledger and emits the
 * `consent.accessed` event inside a single transaction.
 */
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { enqueue } from "@civitasone/outbox";
import { db } from "../../shared/db.js";
import {
  consentArtefacts, consentHoldings, consentLedger,
  type ConsentArtefactRow, type ConsentHoldingRow, type ConsentLedgerRow,
} from "./schema.js";
import { evaluateFetch, type FetchDecision } from "./policy.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

// ── artefacts ─────────────────────────────────────────────────────────
export function listArtefacts(tenantId: string, filter: { principalId?: string | undefined; status?: string | undefined } = {}): Promise<ConsentArtefactRow[]> {
  return scoped(tenantId, (tx) => {
    const conds = [eq(consentArtefacts.tenantId, tenantId)];
    if (filter.principalId) conds.push(eq(consentArtefacts.principalId, filter.principalId));
    if (filter.status) conds.push(eq(consentArtefacts.status, filter.status));
    return tx.select().from(consentArtefacts).where(and(...conds)).orderBy(desc(consentArtefacts.requestedAt));
  });
}

export function findArtefact(tenantId: string, id: string): Promise<ConsentArtefactRow | undefined> {
  return scoped(tenantId, (tx) => findArtefactTx(tx, tenantId, id));
}

export async function findArtefactTx(tx: Tx, tenantId: string, id: string): Promise<ConsentArtefactRow | undefined> {
  const rows = await tx.select().from(consentArtefacts).where(and(eq(consentArtefacts.id, id), eq(consentArtefacts.tenantId, tenantId))).limit(1);
  return rows[0];
}

export async function insertArtefact(tx: Tx, data: typeof consentArtefacts.$inferInsert): Promise<void> {
  await tx.insert(consentArtefacts).values(data);
}

/** Grant (status -> active) or deny (status -> denied) a requested consent. */
export async function decideArtefact(tx: Tx, id: string, status: "active" | "denied", decidedBy: string, reason: string | null): Promise<void> {
  await tx.update(consentArtefacts)
    .set({ status, decidedBy, decidedAt: new Date(), reason, updatedAt: new Date() })
    .where(eq(consentArtefacts.id, id));
}

export async function revokeArtefact(tx: Tx, id: string, revokedBy: string): Promise<void> {
  await tx.update(consentArtefacts)
    .set({ status: "revoked", revokedBy, revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(consentArtefacts.id, id));
}

// ── holdings (providing dept data) ──────────────────────────────────────
export async function upsertHolding(tx: Tx, data: typeof consentHoldings.$inferInsert): Promise<void> {
  await tx.insert(consentHoldings).values(data).onConflictDoUpdate({
    target: [consentHoldings.tenantId, consentHoldings.principalId, consentHoldings.providingDept, consentHoldings.category],
    set: { value: data.value ?? {}, updatedAt: new Date() },
  });
}

// ── ledger (append-only) ────────────────────────────────────────────────
export async function appendLedger(tx: Tx, data: typeof consentLedger.$inferInsert): Promise<void> {
  await tx.insert(consentLedger).values(data);
}

export function listLedgerByPrincipal(tenantId: string, principalId: string): Promise<ConsentLedgerRow[]> {
  return scoped(tenantId, (tx) =>
    tx.select().from(consentLedger)
      .where(and(eq(consentLedger.tenantId, tenantId), eq(consentLedger.principalId, principalId)))
      .orderBy(desc(consentLedger.at)));
}

export type FetchResult =
  | { allowed: true; artefactId: string; data: { category: string; value: Record<string, unknown> }[] }
  | { allowed: false; reason: string };

/**
 * The synchronous, atomic fetch path. Evaluates consent under a row lock,
 * appends the access ledger for both allow and deny, and — on allow — reads the
 * in-scope holdings, increments the fetch count (expiring one-time consents)
 * and emits `consent.accessed`. Returns 403-worthy denials rather than throwing.
 */
export function performFetch(
  tenantId: string, id: string,
  req: { purposeKey: string; categories: string[] },
  actor: { actorId: string; correlationId: string },
  now: Date = new Date(),
): Promise<FetchResult> {
  return scoped(tenantId, async (tx) => {
    const rows = await tx.select().from(consentArtefacts)
      .where(and(eq(consentArtefacts.id, id), eq(consentArtefacts.tenantId, tenantId)))
      .limit(1).for("update");
    const artefact = rows[0];
    if (!artefact) return { allowed: false, reason: "NOT_FOUND" };

    const decision: FetchDecision = evaluateFetch(artefact, req, now);

    if (!decision.allowed) {
      await appendLedger(tx, {
        tenantId, artefactId: id, principalId: artefact.principalId, eventType: "fetch",
        outcome: "denied", requestingDept: artefact.requestingDept, purposeKey: req.purposeKey,
        categories: req.categories, reason: decision.reason, actorId: actor.actorId, correlationId: actor.correlationId,
      });
      return { allowed: false, reason: decision.reason };
    }

    const holdings = await tx.select().from(consentHoldings).where(and(
      eq(consentHoldings.tenantId, tenantId),
      eq(consentHoldings.principalId, artefact.principalId),
      eq(consentHoldings.providingDept, artefact.providingDept),
      inArray(consentHoldings.category, req.categories),
    ));
    const data = holdings.map((h) => ({ category: h.category, value: h.value }));

    const nextStatus = artefact.frequency === "one-time" ? "expired" : "active";
    await tx.update(consentArtefacts)
      .set({ fetchCount: sql`${consentArtefacts.fetchCount} + 1`, status: nextStatus, updatedAt: new Date() })
      .where(eq(consentArtefacts.id, id));

    await appendLedger(tx, {
      tenantId, artefactId: id, principalId: artefact.principalId, eventType: "fetch",
      outcome: "allowed", requestingDept: artefact.requestingDept, purposeKey: req.purposeKey,
      categories: req.categories, reason: null, actorId: actor.actorId, correlationId: actor.correlationId,
    });

    await enqueue(tx, {
      topic: "consent.accessed", eventType: "consent.accessed", tenantId,
      actorId: actor.actorId, correlationId: actor.correlationId,
      payload: {
        artefactId: id, principalId: artefact.principalId, requestingDept: artefact.requestingDept,
        providingDept: artefact.providingDept, purposeKey: req.purposeKey, categories: req.categories,
        categoriesReturned: data.map((d) => d.category),
      },
    });

    return { allowed: true, artefactId: id, data };
  });
}

export type { ConsentArtefactRow, ConsentHoldingRow, ConsentLedgerRow };

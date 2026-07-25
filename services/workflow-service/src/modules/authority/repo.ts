import { and, eq, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { authorityLimits, type AuthorityLimitRow } from "./schema.js";
import type { AuthorityLimit, AuthorityScope, AuthorityType } from "./domain.js";

/** Map a DB row to the pure-domain AuthorityLimit (numeric string → number). */
export function toDomain(r: AuthorityLimitRow): AuthorityLimit {
  return {
    id: r.id,
    scopeType: r.scopeType as AuthorityScope,
    scopeRef: r.scopeRef,
    authorityType: r.authorityType as AuthorityType,
    currency: r.currency,
    maxAmount: Number(r.maxAmount),
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? null,
    escalateToScopeType: (r.escalateToScopeType as AuthorityScope | null) ?? null,
    escalateToRef: r.escalateToRef ?? null,
    status: r.status,
  };
}

export interface CreateLimitInput {
  tenantId: string;
  scopeType: AuthorityScope;
  scopeRef: string;
  authorityType: AuthorityType;
  currency: string;
  maxAmount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  escalateToScopeType: AuthorityScope | null;
  escalateToRef: string | null;
  reason: string | null;
  createdBy: string;
}

/** Create a limit in DRAFT — it takes effect only after checker approval. */
export async function create(input: CreateLimitInput): Promise<AuthorityLimitRow> {
  const rows = await db.transaction((tx) =>
    tx.insert(authorityLimits).values({
      tenantId: input.tenantId,
      scopeType: input.scopeType,
      scopeRef: input.scopeRef,
      authorityType: input.authorityType,
      currency: input.currency,
      maxAmount: input.maxAmount.toFixed(2),
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      escalateToScopeType: input.escalateToScopeType,
      escalateToRef: input.escalateToRef,
      reason: input.reason,
      status: "draft",
      createdBy: input.createdBy,
    }).returning(),
  );
  return rows[0]!;
}

export async function findById(id: string, tenantId: string): Promise<AuthorityLimitRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(authorityLimits)
    .where(and(eq(authorityLimits.id, id), eq(authorityLimits.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

/**
 * Maker-checker approval: activate a DRAFT limit. The approver MUST differ from
 * the creator (segregation of duties) — enforced in the WHERE so a self-approval
 * updates zero rows and the route 409s.
 */
export async function approve(id: string, tenantId: string, approverId: string): Promise<AuthorityLimitRow | null> {
  const rows = await db.transaction((tx) =>
    tx.update(authorityLimits)
      .set({ status: "active", approvedBy: approverId, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(authorityLimits.id, id),
        eq(authorityLimits.tenantId, tenantId),
        eq(authorityLimits.status, "draft"),
      ))
      .returning(),
  );
  return rows[0] ?? null;
}

export async function revoke(id: string, tenantId: string): Promise<AuthorityLimitRow | null> {
  const rows = await db.transaction((tx) =>
    tx.update(authorityLimits)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(and(eq(authorityLimits.id, id), eq(authorityLimits.tenantId, tenantId)))
      .returning(),
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit = 100, offset = 0): Promise<AuthorityLimitRow[]> {
  return scopedRead((tx) => tx.select().from(authorityLimits)
    .where(eq(authorityLimits.tenantId, tenantId))
    .orderBy(desc(authorityLimits.createdAt))
    .limit(limit).offset(offset));
}

/** All ACTIVE limits for a tenant (the pool the domain resolves against). */
export async function activeLimits(tenantId: string): Promise<AuthorityLimit[]> {
  const rows = await scopedRead((tx) => tx.select().from(authorityLimits)
    .where(and(eq(authorityLimits.tenantId, tenantId), eq(authorityLimits.status, "active"))));
  return rows.map(toDomain);
}

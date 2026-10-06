import { and, desc, eq } from "drizzle-orm";
import { setTenantGuc } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { tokens, revisions, type RevisionRow } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export type PublishedRevision = {
  id: string;
  name: string;
  version: number;
  status: string;
  publishedAt: string | null;
};

export class StaleRevisionError extends Error {
  constructor(public latestVersion: number) {
    super("a newer theme revision has been published since you loaded this page");
  }
}

function toView(r: RevisionRow): PublishedRevision {
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    status: r.status,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
  };
}

/** The latest published revision for a tenant, or null when none exists. */
export async function latestPublished(tenantId: string): Promise<PublishedRevision | null> {
  const rows = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.tenantId, tenantId), eq(revisions.status, "published")))
    .orderBy(desc(revisions.version))
    .limit(1);
  const row = rows[0];
  return row ? toView(row) : null;
}

/**
 * GAP-THEMES-HOME-01 / GAP-THEMES-TOKENS-02: publish a new theme revision.
 *
 * Runs in a single transaction: snapshots the tenant's current tokens into the
 * revision, assigns the next monotonic version, marks it published, and writes
 * the audit event (with the reason) in the SAME transaction. When
 * `expectedVersion` is supplied it is checked against the latest published
 * version so a publish built on a stale page is rejected (optimistic
 * concurrency) rather than silently clobbering a newer revision.
 */
export async function publish(args: {
  tenantId: string;
  actorId: string;
  correlationId: string;
  name: string;
  reason: string;
  expectedVersion?: number;
}): Promise<PublishedRevision> {
  return db.transaction(async (tx) => {
    // Set app.tenant_id transaction-local so the revisions RLS WITH CHECK
    // policy accepts the insert, derived from the JWT tenant (ctx.tenantId)
    // rather than relying on the x-tenant-id header being present.
    await setTenantGuc(tx as unknown as { execute: (q: unknown) => Promise<unknown> }, args.tenantId);
    const latestRows = await tx
      .select({ version: revisions.version })
      .from(revisions)
      .where(and(eq(revisions.tenantId, args.tenantId), eq(revisions.status, "published")))
      .orderBy(desc(revisions.version))
      .limit(1);
    const latestVersion = latestRows[0]?.version ?? 0;

    if (args.expectedVersion !== undefined && args.expectedVersion !== latestVersion) {
      throw new StaleRevisionError(latestVersion);
    }

    const tokenRows = await tx
      .select({ name: tokens.name, value: tokens.value })
      .from(tokens)
      .where(eq(tokens.tenantId, args.tenantId));
    const snapshot: Record<string, string> = {};
    for (const t of tokenRows) snapshot[t.name] = t.value;

    const nextVersion = latestVersion + 1;
    const now = new Date();
    const inserted = await tx
      .insert(revisions)
      .values({
        tenantId: args.tenantId,
        name: args.name,
        status: "published",
        tokens: snapshot,
        reason: args.reason,
        publishedAt: now,
        createdBy: args.actorId,
        updatedBy: args.actorId,
        version: nextVersion,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("failed to insert theme revision");

    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: args.tenantId,
      actorId: args.actorId,
      correlationId: args.correlationId,
      payload: {
        service: "themes",
        action: "publish",
        resourceType: "revision",
        resourceId: row.id,
        outcome: "success",
        reason: args.reason,
        version: nextVersion,
        tokenCount: tokenRows.length,
      },
    });

    return toView(row);
  });
}

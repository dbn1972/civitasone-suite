/**
 * Reads + transactional writes for the LM-002 public lead-capture form registry.
 *
 * Two read paths with different security postures, kept in one file so the contrast is
 * visible:
 *  - `listForms` / `findById` are TENANT-SCOPED (scopedRead → RLS GUC set).
 *  - `findByFormKey` is the ANONYMOUS resolver and runs with NO tenant, because the
 *    form key is what tells us the tenant. See the comment on that function and the
 *    matching SELECT-only RLS policy in migration 0038.
 */
import { eq, and, sql } from "drizzle-orm";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { db, scopedRead, sqlClient } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import {
  leadCaptureForms,
  type LeadCaptureFormRow,
  type LeadCaptureFormInsert,
  type LeadCaptureFormView,
  type ResolvedCaptureForm,
} from "./capture-forms-schema.js";

const log = pino({ name: "crm-lead-capture-forms-repo" });

/**
 * Cache resource segment, shared with the command publisher and consumer so the key
 * written here always sits under the prefix they invalidate.
 */
export const RESOURCE = "lead_capture_form";

/**
 * 64 lowercase hex chars of crypto randomness (two UUIDs' worth = 256 bits), which is
 * exactly the varchar(64) width.
 *
 * This is generated SERVER-SIDE and never accepted from a client. The key is the sole
 * credential on an unauthenticated write endpoint, so anything guessable, sequential
 * or tenant-derived (a slug, an incrementing number, the tenant id) would let an
 * attacker enumerate every tenant's forms and post leads into them.
 */
export function generateFormKey(): string {
  return `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
}

export function toView(r: LeadCaptureFormRow): LeadCaptureFormView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    formKey: r.formKey,
    name: r.name,
    enabled: r.enabled,
    requireConsent: r.requireConsent,
    allowedOrigins: r.allowedOrigins,
    defaultLeadSource: r.defaultLeadSource,
    campaignId: r.campaignId,
    maxPerMinute: r.maxPerMinute,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function loadForms(tenantId: string): Promise<LeadCaptureFormView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(leadCaptureForms)
      .where(eq(leadCaptureForms.tenantId, tenantId))
      .orderBy(leadCaptureForms.name),
  );
  return rows.map(toView);
}

/** The tenant's forms, read through Redis. Configuration, so whole-set granularity. */
export async function listForms(tenantId: string): Promise<LeadCaptureFormView[]> {
  // Standard graceful degradation for an AUTHENTICATED read: a cache-layer failure
  // falls through to Postgres and logs WARN. (The public capture path does the
  // opposite for its rate limiter — see public-capture-rate-limit.ts.)
  let dbFailed = false;
  const loader = async (): Promise<LeadCaptureFormView[]> => {
    try {
      return await loadForms(tenantId);
    } catch (err) {
      dbFailed = true;
      throw err;
    }
  };
  try {
    return (await cache.getOrLoad<LeadCaptureFormView[]>(
      cache.makeKey(tenantId, RESOURCE, "all"),
      loader,
    )) ?? [];
  } catch (err) {
    if (dbFailed) throw err;
    log.warn({ err, tenantId }, "lead capture form cache unavailable; read through to Postgres");
    return loadForms(tenantId);
  }
}

export async function findById(tenantId: string, id: string): Promise<LeadCaptureFormView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(leadCaptureForms)
      .where(and(eq(leadCaptureForms.tenantId, tenantId), eq(leadCaptureForms.id, id)))
      .limit(1),
  );
  return rows[0] ? toView(rows[0]) : null;
}

/**
 * ANONYMOUS form-key resolution — the entry point of the unauthenticated write path.
 *
 * Runs OUTSIDE a tenant transaction on purpose: at this moment we do not know the
 * tenant, and the whole job of this query is to find it out. Migration 0038 grants a
 * narrow FOR SELECT policy that permits exactly this (and only when app.tenant_id is
 * unset); writes still require the tenant-isolation policy.
 *
 * Raw parameterised SQL rather than Drizzle because a Drizzle call would go through
 * `db.transaction`, which injects the GUC when AsyncLocalStorage happens to hold a
 * tenant from an earlier request on the same connection — the lookup must not depend
 * on ambient state. Deliberately returns only the policy columns; the form's name and
 * audit fields have no business on this path.
 */
export async function findByFormKey(formKey: string): Promise<ResolvedCaptureForm | null> {
  const rows = await sqlClient<Array<{
    id: string;
    tenantId: string;
    enabled: boolean;
    requireConsent: boolean;
    allowedOrigins: string[] | null;
    defaultLeadSource: string | null;
    campaignId: string | null;
    maxPerMinute: number;
  }>>`
    SELECT id,
           tenant_id           AS "tenantId",
           enabled,
           require_consent     AS "requireConsent",
           allowed_origins     AS "allowedOrigins",
           default_lead_source AS "defaultLeadSource",
           campaign_id         AS "campaignId",
           max_per_minute      AS "maxPerMinute"
    FROM crm.lead_capture_forms
    WHERE form_key = ${formKey}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, allowedOrigins: row.allowedOrigins ?? [] };
}

export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

export async function insert(tx: Writer, row: LeadCaptureFormInsert): Promise<void> {
  // onConflictDoNothing on the globally unique form_key: a redelivered create command
  // must not raise 23505 and dead-letter, and `markProcessed` already gates the normal
  // replay. A genuine key collision is astronomically unlikely at 256 bits.
  await (tx as typeof db).insert(leadCaptureForms).values(row).onConflictDoNothing();
}

/**
 * Guarded UPDATE. Returns false when nothing matched, so the caller can distinguish
 * "form deleted between the route's 404 check and the consumer running" from success
 * instead of emitting an event for a write that never happened.
 */
export async function update(
  tx: Writer,
  tenantId: string,
  id: string,
  patch: Partial<LeadCaptureFormInsert>,
  actorId: string,
): Promise<boolean> {
  const rows = await (tx as typeof db).update(leadCaptureForms)
    .set({ ...patch, updatedAt: new Date(), updatedBy: actorId, version: sql`${leadCaptureForms.version} + 1` })
    .where(and(eq(leadCaptureForms.tenantId, tenantId), eq(leadCaptureForms.id, id)))
    .returning({ id: leadCaptureForms.id });
  return rows.length > 0;
}

/**
 * Hard DELETE, which is the one place this service diverges from "DELETE = soft-delete".
 * A capture form is not user data: it is a live credential on a public endpoint. Leaving
 * a `deleted_at` row behind would keep the URL resolvable unless every read remembered
 * to filter it, and the failure mode of forgetting is an endpoint an admin believes is
 * closed but which still accepts leads. The leads it captured are untouched.
 */
export async function remove(tx: Writer, tenantId: string, id: string): Promise<boolean> {
  const rows = await (tx as typeof db).delete(leadCaptureForms)
    .where(and(eq(leadCaptureForms.tenantId, tenantId), eq(leadCaptureForms.id, id)))
    .returning({ id: leadCaptureForms.id });
  return rows.length > 0;
}

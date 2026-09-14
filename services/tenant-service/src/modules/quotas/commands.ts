/**
 * Quota command handlers (WRITE PATH).
 * Validate → publish command → return 202. Consumer does the durable DB write.
 * quotaCheck is synchronous (read-only) — not queued.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { readScoped } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import type { QuotaSetBody, QuotaIncrementBody, QuotaCheckBody } from "./validators.js";
import * as repo from "./repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface QuotaCheckResult {
  allowed: boolean;
  resource: string;
  limit: number;
  used: number;
  usagePercent: number;
  overLimit: boolean;
}

const RESOURCE = "quota";

export async function quotaSet(ctx: RequestContext, body: QuotaSetBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.quotaSet, {
    messageId: id,
    type: COMMANDS.quotaSet,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: body.tenantId, resource: body.resource, limit: body.limit },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function quotaIncrement(ctx: RequestContext, body: QuotaIncrementBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.quotaIncrement, {
    messageId: id,
    type: COMMANDS.quotaIncrement,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: body.tenantId, resource: body.resource, delta: body.delta },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * quotaCheck — synchronous read (not queued).
 * Returns whether the requested amount would exceed the quota.
 *
 * SEC-012: tenant identity comes exclusively from the authenticated
 * session (`ctx.tenantId`), never from the request body. Without this, any
 * authenticated caller could read another tenant's quota/usage numbers by
 * putting that tenant's id in `body.tenantId` -- a cross-tenant data leak.
 * `body.tenantId` is still accepted on the wire (validators.ts) for
 * backward compatibility but is intentionally never read here.
 *
 * Reads go through `readScoped` (runWithTenant + db.transaction), not the
 * bare `repo.findByTenantAndResource`. quotas.quotas is FORCE ROW LEVEL
 * SECURITY (migrations/0010_rls_full_tenant_isolation.sql), and the
 * app.tenant_id GUC is only ever set inside a wrapped db.transaction() (see
 * wrapWithTenantGuc in packages/db/src/wrap-tenant-db.ts) -- a bare
 * db.select() never sets it, so the policy's `tenant_id =
 * tenant.current_tenant_id()` clause compares against NULL and the query
 * always comes back empty, for every tenant. That made this route silently
 * non-functional (always "unlimited"), and made the SEC-012 fix untestable
 * -- ctx.tenantId was correct but could never actually find a row. Scoped
 * exactly like the identical read in modules/tenant-extensions/routes.ts.
 */
export async function quotaCheck(ctx: RequestContext, body: QuotaCheckBody): Promise<QuotaCheckResult> {
  const quota = await readScoped(ctx.tenantId, (tx) =>
    repo.findByTenantAndResourceTx(tx as unknown as repo.Writer, ctx.tenantId, body.resource),
  );
  if (!quota) {
    // No quota set = unlimited
    return { allowed: true, resource: body.resource, limit: 0, used: 0, usagePercent: 0, overLimit: false };
  }
  const wouldExceed = (quota.used + body.requestedAmount) > quota.limit;
  return {
    allowed: !wouldExceed,
    resource: body.resource,
    limit: quota.limit,
    used: quota.used,
    usagePercent: repo.usagePercent(quota),
    overLimit: repo.isOverLimit(quota),
  };
}

/**
 * Tenant-scoped transaction factory — auto-sets app.tenant_id GUC.
 *
 * Use this as a drop-in replacement for db.transaction() in services.
 * Wraps the transaction so RLS policies see the correct tenant.
 *
 * Usage:
 *   import { tenantTransaction } from "@civitasone/db";
 *
 *   await tenantTransaction(db, ctx.tenantId, async (tx) => {
 *     await tx.insert(table).values({ ... });
 *   });
 *
 * This is equivalent to withTenantScope but with a simpler API that matches
 * the common db.transaction() pattern used across all services.
 */
import { setTenantGuc } from "./tenant-scope.js";
import { tenantStorage } from "./tenant-context.js";

type DrizzleDb = {
  transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
};

/**
 * Run fn inside a transaction with app.tenant_id GUC set (transaction-local).
 * RLS policies will enforce tenant isolation as a defense-in-depth backstop.
 */
export async function tenantTransaction<T>(
  db: DrizzleDb,
  tenantId: string,
  fn: (tx: unknown) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const runner = tx as { execute: (q: unknown) => Promise<unknown> };
    await setTenantGuc(runner, tenantId);
    return fn(tx);
  });
}

/**
 * Minimal shape of the verified request context this hook reads: the
 * RequestContext that `@civitasone/auth`'s authPlugin attaches as `req.ctx` in
 * its own onRequest hook (registered before this one in every service app.ts).
 * Declared structurally so this package does not depend on `@civitasone/auth`.
 */
interface VerifiedCtx {
  tenantId?: string;
  actorId?: string;
}

interface TenantHookRequest {
  headers: Record<string, string | string[] | undefined>;
  ctx?: VerifiedCtx | null;
  log?: { warn: (obj: Record<string, unknown>, msg: string) => void };
  url?: string;
  method?: string;
}

export interface RlsTenantResolution {
  /** Tenant the request GUC is scoped to; undefined = no GUC (FORCE RLS fails closed). */
  tenantId: string | undefined;
  /** Set when x-tenant-id named a different tenant than the verified one (ignored, logged). */
  ignoredHeaderTenantId?: string;
}

function headerTenant(req: TenantHookRequest): string | undefined {
  const raw = req.headers["x-tenant-id"];
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return v ? v : undefined;
}

/**
 * F2 (UAT bundle 10): decide which tenant the request's RLS GUC is scoped to.
 *
 * The GUC MUST come from the same verified tenant the app authorizes against
 * (`req.ctx.tenantId`), never from the raw `x-tenant-id` header. Through the
 * gateway the two are always equal (the gateway overwrites the header with the
 * verified `tid`), but a request sent straight to a service used to be able to
 * carry a valid tenant-A token plus `x-tenant-id: <B>` and scope RLS to tenant B.
 *
 *  - Verified tenant present: use it. A header naming a DIFFERENT tenant is
 *    IGNORED and logged (warn, event tenant_header_mismatch), never honoured;
 *    the request proceeds scoped to its own tenant, matching the contract the
 *    service suites already pin (e.g. crm pipelines-deals "SEC" tests: a
 *    mismatched header neither hides the caller's rows nor leaks the other
 *    tenant's). This covers the `x-internal`
 *    service path: authPlugin sets `ctx.tenantId` from the header only AFTER the
 *    constant-time INTERNAL_SERVICE_SECRET check, so there the header is
 *    authoritative and always matches.
 *  - Public route (`ctx.actorId === "anonymous"`, no principal at all) with no
 *    tenant in ctx: the header is the only tenant source and grants nothing an
 *    anonymous caller could not already name (e.g. the public careers portal).
 *  - Anything else (no ctx, /health, a token that carries no tenant): no GUC,
 *    so FORCE RLS fails closed.
 *
 * Workers/consumers never pass through this hook; they scope the GUC from the
 * message envelope via runWithTenant / tenantTransaction, unchanged.
 */
export function resolveRlsTenant(req: TenantHookRequest): RlsTenantResolution {
  const header = headerTenant(req);
  const ctx = req.ctx ?? undefined;
  const verified = ctx?.tenantId?.trim() || undefined;
  if (verified) {
    if (header && header !== verified) {
      return { tenantId: verified, ignoredHeaderTenantId: header };
    }
    return { tenantId: verified };
  }
  if (ctx?.actorId === "anonymous") return { tenantId: header };
  return { tenantId: undefined };
}

/**
 * Fastify onRequest hook factory — sets up a per-request db helper AND stores
 * the request's VERIFIED tenant (see resolveRlsTenant) in AsyncLocalStorage so
 * that ANY db.transaction() within the request lifecycle (including bare calls
 * in repos) automatically gets the GUC. Register it AFTER authPlugin.
 *
 * Usage in app.ts:
 *   await app.register(authPlugin);
 *   app.addHook("onRequest", createTenantTxHook(db));
 *
 * Then in routes:
 *   const tx = await req.tenantTx(async (tx) => { ... });
 *   // OR simply use db.transaction() — GUC is auto-set via AsyncLocalStorage
 */
export function createTenantTxHook(db: DrizzleDb) {
  return async function tenantTxHook(req: TenantHookRequest, _reply: unknown) {
    const resolved = resolveRlsTenant(req);
    if (resolved.ignoredHeaderTenantId) {
      req.log?.warn(
        {
          event: "tenant_header_mismatch",
          verifiedTenantId: resolved.tenantId,
          // Raw client input: truncated so a crafted header cannot flood the log line.
          headerTenantId: resolved.ignoredHeaderTenantId.slice(0, 64),
          path: req.url?.split("?")[0] ?? "",
          method: req.method,
        },
        "x-tenant-id does not match the authenticated tenant; header ignored",
      );
    }
    const tenantId = resolved.tenantId;

    // Store tenantId in AsyncLocalStorage so tenant-aware db.transaction()
    // picks it up automatically (fixes bare db.transaction() calls).
    if (tenantId) {
      tenantStorage.enterWith({ tenantId });
    } else if (tenantStorage.getStore()) {
      // No tenant for THIS request: clear any store inherited from the
      // surrounding async context (e.g. an earlier request on the same
      // keep-alive connection / app.inject chain) so it cannot leak in.
      tenantStorage.enterWith({ tenantId: "" });
    }

    // Also provide the explicit req.tenantTx helper for backward compat
    (req as unknown as { tenantTx: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> }).tenantTx =
      tenantId
        ? <T>(fn: (tx: unknown) => Promise<T>) => tenantTransaction(db, tenantId, fn)
        : <T>(fn: (tx: unknown) => Promise<T>) => db.transaction(fn);
  };
}

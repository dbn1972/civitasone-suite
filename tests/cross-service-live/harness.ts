/**
 * tests/cross-service-live/harness.ts — cross-service live harness v0 (PR-FF02-06a).
 *
 * Design: erp-gap-remediation/03-designs/FF-02.md WP6; harness contract in
 * erp-gap-remediation/06-verification.md §2.3. Decision D-17: everything
 * cross-service-live lives under this directory.
 *
 * WHAT THIS IS
 * ------------
 * A Tier-1 harness library that lets one vitest worker host several services'
 * real Drizzle singletons against ONE real Postgres (one database and one
 * NON-SUPERUSER service role per service), carry their events across a single
 * real MemoryQueue, and move outbox rows with the SAME production `relayOnce`
 * the real relay runs — so a hand-off is proved end to end, not mocked.
 *
 * It packages, as a reusable library, the pattern already proven on main in
 * `services/trade-service/tests/cross-service-integration.test.ts` (three
 * services in one worker, real Postgres, `relayOnce` + `MemoryQueue.drain()`).
 * The only mechanism is: each service's `shared/db.ts` binds its Drizzle client
 * from `DATABASE_URL` once, at first import, so the harness sets
 * `process.env.DATABASE_URL` to the target service's database immediately
 * before a dynamic `import()` and restores it afterwards.
 *
 * WHY NON-SUPERUSER ROLES
 * -----------------------
 * `scripts/ci/bootstrap-postgres.sh` creates each service's login role as
 * NOBYPASSRLS/NOSUPERUSER (verify: `SELECT rolname,rolsuper,rolbypassrls FROM
 * pg_roles`). The harness connects as those roles — never the bootstrapping
 * superuser — so FORCE ROW LEVEL SECURITY is genuinely enforced on every read
 * and write. A cross-tenant read therefore returns zero rows, which is exactly
 * what `harness.selftest.test.ts` asserts.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * No fixed sleeps (docs/TEST-INFRA.md bans unseeded time): callers await
 * `relayAll()`, which drives `relayOnce` + `queue.drain()` to quiescence.
 * The event-contract registry (`defineContract`) is PR-FF02-01 and is not on
 * main yet; `tap()` therefore validates the transport envelope with the real
 * `parseEnvelope` and records every boundary-crossing message so a contract
 * validator can be slotted in without changing callers when FF-02 WP1 lands.
 */
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { relayOnce, type DrizzleTx } from "@civitasone/outbox";
import { withTenantScope, sql } from "@civitasone/db";

/**
 * `<db>:<role>` per service, mirroring the SERVICE_DBS map in
 * `scripts/ci/bootstrap-postgres.sh`. Only the entries the harness callers
 * need are listed; add a row here (and confirm the service is in
 * bootstrap-postgres.sh) to mount another service. Role password follows the
 * fleet convention `<role-without-_svc>_dev_pw`, the same literal every
 * service's own `vitest.config.ts` already uses in CI.
 */
export const SERVICE_DB_MAP: Record<string, { db: string; role: string }> = {
  "finance-service": { db: "civitas_finance", role: "finance_svc" },
  "notification-service": { db: "civitas_notification", role: "notification_svc" },
  "procurement-service": { db: "civitas_procurement", role: "procurement_svc" },
  "trade-service": { db: "civitas_trade", role: "trade_svc" },
  "revenue-service": { db: "civitas_revenue", role: "revenue_svc" },
  "billing-service": { db: "civitas_billing", role: "billing_svc" },
  "inventory-service": { db: "civitas_inventory", role: "inventory_svc" },
  "asset-service": { db: "civitas_asset", role: "asset_svc" },
  "payroll-service": { db: "civitas_payroll", role: "payroll_svc" },
  "hrms-service": { db: "civitas_hrms", role: "hrms_svc" },
  "citizen-service": { db: "civitas_citizen", role: "citizen_svc" },
  "grant-service": { db: "civitas_grant", role: "grant_svc" },
  "admin-service": { db: "civitas_admin", role: "admin_svc" },
  "smarttransfer-service": { db: "civitas_smarttransfer", role: "smarttransfer_svc" },
};

const PASSWORD_FOR = (role: string): string => `${role.replace(/_svc$/, "")}_dev_pw`;

/** The Postgres TCP port the harness connects to. */
export function harnessPgPort(): string {
  // bootstrap-postgres.sh and ci.yml both key off PGPORT; the shared long-lived
  // dev instance is 5435 (see assertFresh()).
  return process.env.PGPORT ?? "5435";
}

/** The host the harness connects to (127.0.0.1 avoids a Unix-socket fallback). */
export function harnessPgHost(): string {
  return process.env.PGHOST ?? "127.0.0.1";
}

/** Build the per-service DSN as the NON-SUPERUSER service role. */
export function serviceDsn(name: string): string {
  const entry = SERVICE_DB_MAP[name];
  if (!entry) {
    throw new Error(
      `harness: unknown service "${name}". Add it to SERVICE_DB_MAP and confirm it is in scripts/ci/bootstrap-postgres.sh.`,
    );
  }
  return `postgres://${entry.role}:${PASSWORD_FOR(entry.role)}@${harnessPgHost()}:${harnessPgPort()}/${entry.db}`;
}

/** A mounted service: its real Drizzle db + raw postgres-js client. */
export interface MountedService {
  name: string;
  dsn: string;
  role: string;
  /** Real Drizzle db from the service's own shared/db.ts (tenant-GUC wrapped). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  /** Raw postgres-js client from the same module, for teardown + raw checks. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sqlClient: any;
}

/**
 * Mount a service: bind its `shared/db.ts` Drizzle singleton against its own
 * database as its non-superuser role, by swapping DATABASE_URL for the one
 * dynamic import and restoring it afterwards. First import wins — a service can
 * be mounted once per worker (its db.ts caches the client), which is the whole
 * point of the swap-then-import dance.
 *
 * `extraEnv` lets a caller set service-specific env a module reads at import
 * time (e.g. PII_ENC_KEY), exactly as the trade-service reference test does.
 */
export async function mountService(
  name: string,
  extraEnv: Record<string, string> = {},
): Promise<MountedService> {
  const entry = SERVICE_DB_MAP[name];
  if (!entry) {
    throw new Error(`harness: unknown service "${name}". Add it to SERVICE_DB_MAP.`);
  }
  const dsn = serviceDsn(name);

  const prevUrl = process.env.DATABASE_URL;
  const prevDbUrl = process.env.DB_URL;
  const prevExtra: Record<string, string | undefined> = {};
  for (const k of Object.keys(extraEnv)) prevExtra[k] = process.env[k];

  process.env.DATABASE_URL = dsn;
  process.env.DB_URL = dsn;
  for (const [k, v] of Object.entries(extraEnv)) {
    // Do not clobber a value the caller/CI already set deliberately.
    process.env[k] = process.env[k] ?? v;
  }

  try {
    const mod = await import(
      /* @vite-ignore */ `../../services/${name}/src/shared/db.js`
    );
    const db = mod.db;
    const sqlClient = mod.sqlClient;
    if (!db || !sqlClient) {
      throw new Error(
        `harness: services/${name}/src/shared/db.js did not export both { db, sqlClient }`,
      );
    }
    // First import wins: if the service's db.ts was imported earlier in this
    // worker it kept that earlier DSN. Prove we really are the NOSUPERUSER,
    // NOBYPASSRLS service role, or FORCE RLS would be silently bypassed.
    const [who] = await sqlClient`
      select current_user as "u", r.rolsuper as "su", r.rolbypassrls as "bypass"
      from pg_roles r where r.rolname = current_user`;
    if (!who || who.u !== entry.role || who.su || who.bypass) {
      throw new Error(
        `harness: ${name} is connected as ${who?.u} (superuser=${who?.su}, bypassrls=${who?.bypass}); expected non-superuser, non-BYPASSRLS ${entry.role}. Was services/${name}/src/shared/db.js imported before mountService()?`,
      );
    }
    return { name, dsn, role: entry.role, db, sqlClient };
  } finally {
    // Restore so the next mountService() can swap again, and so anything that
    // re-reads DATABASE_URL later in the worker sees the original value.
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevDbUrl === undefined) delete process.env.DB_URL;
    else process.env.DB_URL = prevDbUrl;
    for (const [k, v] of Object.entries(prevExtra)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A single boundary-crossing envelope recorded by tap(). */
export interface TappedEnvelope {
  topic: string;
  messageId: string;
  tenantId: string;
  type: string;
  schemaVersion: string;
  valid: boolean;
  error?: string;
}

/**
 * The live harness: one MemoryQueue shared by every mounted service, a set of
 * mounted services whose outboxes relayAll() drains, and a tap of every message
 * that crossed the queue.
 */
export class LiveHarness {
  readonly queue: MemoryQueue;
  // NOTE: there is deliberately no "tenant-scoped queue" here. Consumers
  // subscribed on `queue` run WITHOUT a tenant GUC. A caller that needs the
  // handler to run inside the message's tenant context wraps the queue with the
  // owning service's own `tenantScoped()` (per service:
  // services/<name>/src/shared/tenant-queue.js) before subscribing.
  private readonly services: MountedService[] = [];
  readonly tapped: TappedEnvelope[] = [];
  private tapping = false;

  constructor(opts: { maxAttempts?: number } = {}) {
    // maxAttempts: 1 so a failing consumer reaches the dead-letter list at once,
    // with no retry backoff hiding a refusal (06-verification.md §2.3).
    this.queue = new MemoryQueue({ maxAttempts: opts.maxAttempts ?? 1 });
  }

  /** Register a mounted service so relayAll() drains its outbox. */
  track(svc: MountedService): MountedService {
    this.services.push(svc);
    return svc;
  }

  /** Mount a service and track it in one call. */
  async mount(name: string, extraEnv: Record<string, string> = {}): Promise<MountedService> {
    return this.track(await mountService(name, extraEnv));
  }

  /**
   * Install tap() on the shared queue: every message delivered to a subscribed
   * handler — the real boundary crossing — is recorded, and its FULLY-STAMPED
   * transport envelope (messageId, type, tenantId, actorId, correlationId,
   * timestamp, schemaVersion the bus adds in `envelope()`) is validated with
   * the real `parseEnvelope`. Validating at the consumer boundary, not at the
   * publish call, is why the stamped `timestamp`/`traceparent` are present.
   * Idempotent. Only subscriptions made AFTER tap() is called are recorded, so
   * call it before any `queue.subscribe(...)`.
   *
   * When PR-FF02-01 lands the event-contract registry, add an
   * `expectContract(topic, payload)` check alongside the envelope check here;
   * callers do not change.
   */
  async tap(): Promise<void> {
    if (this.tapping) return;
    this.tapping = true;
    const { parseEnvelope } = await import("@civitasone/events");
    const realSubscribe = this.queue.subscribe.bind(this.queue);
    const record = (topic: string, msg: Record<string, unknown>): void => {
      const parsed = (parseEnvelope as (m: unknown) => { ok: boolean; error?: string })(msg);
      this.tapped.push({
        topic,
        messageId: String(msg.messageId ?? ""),
        tenantId: String(msg.tenantId ?? ""),
        type: String(msg.type ?? ""),
        schemaVersion: String(msg.schemaVersion ?? ""),
        valid: parsed.ok,
        ...(parsed.ok ? {} : { error: parsed.error }),
      });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.queue as any).subscribe = (topic: string, handler: any, options?: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapped = async (msg: any): Promise<void> => {
        record(topic, msg as Record<string, unknown>);
        return handler(msg);
      };
      return realSubscribe(topic, wrapped, options);
    };
  }

  /**
   * Drive every mounted service's outbox onto the shared queue and let the
   * consumers run to quiescence. Loops `relayOnce(...) + queue.drain()` until a
   * full pass across all services publishes nothing — so a consumer that itself
   * enqueues a follow-on event is drained too. Returns the total rows relayed.
   */
  async relayAll(batch = 100): Promise<number> {
    let total = 0;
    for (;;) {
      let publishedThisPass = 0;
      for (const svc of this.services) {
        const n = await relayOnce(svc.db as DrizzleTx, this.queue, batch, svc.name);
        publishedThisPass += n;
        await this.queue.drain();
      }
      total += publishedThisPass;
      if (publishedThisPass === 0) break;
    }
    return total;
  }

  /**
   * The silent-ack surface after relayAll(): dead-letter entries, unpublished
   * outbox rows per service, and (where the table exists) command_results rows
   * recorded as failed/rejected. Lets a trace test assert "no refusal was acked
   * without a record".
   *
   * `_inbox.command_results` is FORCE RLS (D-20), so a read with no tenant GUC
   * returns zero rows. The caller therefore passes the tenant id(s) under test
   * and the query runs inside `withTenantScope` for each, with an explicit
   * tenant_id filter as well (the table may not carry the D-20 policy yet). Only SQLSTATE 42P01
   * (table not rolled out in that service yet) is treated as "no records";
   * every other error is rethrown.
   */
  async silent(tenantIds: string[]): Promise<{
    deadLetters: Array<{ topic: string; messageId: string; error: string }>;
    unpublished: Record<string, number>;
    recordedOutcomes: Record<string, Array<{ messageId: string; status: string; reason: string | null }>>;
  }> {
    type Outcome = { messageId: string; status: string; reason: string | null };
    const deadLetters = this.queue.dlq.map((d) => ({
      topic: d.topic,
      messageId: d.msg.messageId,
      error: d.error,
    }));
    const unpublished: Record<string, number> = {};
    const recordedOutcomes: Record<string, Outcome[]> = {};
    for (const svc of this.services) {
      const [u] = await svc.sqlClient`select count(*)::int as c from _outbox.messages where published_at is null`;
      unpublished[svc.name] = u?.c ?? 0;
      const out: Outcome[] = [];
      for (const tenantId of tenantIds) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows = await withTenantScope(svc.db, tenantId, async (tx: any) =>
            tx.execute(sql`
              select message_id as "messageId", status, reason
              from _inbox.command_results
              where tenant_id = ${tenantId}::uuid
                and status in ('failed','rejected')`),
          );
          out.push(...(rows as unknown as Outcome[]));
        } catch (e) {
          const err = e as { code?: string; cause?: { code?: string } };
          if ((err.code ?? err.cause?.code) === "42P01") continue; // table not rolled out in this service
          throw e;
        }
      }
      recordedOutcomes[svc.name] = out;
    }
    return { deadLetters, unpublished, recordedOutcomes };
  }

  /** Start the shared queue (push-based; present for symmetry with Tier 2). */
  async start(): Promise<void> {
    await this.queue.start();
  }

  /** Stop the queue and close every mounted service's postgres-js client. */
  async stop(): Promise<void> {
    await this.queue.stop();
    for (const svc of this.services) {
      try {
        await svc.sqlClient.end({ timeout: 5 });
      } catch {
        /* already closed */
      }
    }
  }
}

/**
 * Refuse to run against anything but a disposable instance. Mirrors TX-017's
 * assertOutboxIsFresh: relayOnce has no test-only mode and marks whatever it
 * reads as published, so pointing it at the shared long-lived dev instance
 * (port 5435, container civitasone-postgres) would mark OTHER services' real
 * unpublished rows published without delivering them.
 *
 * Rules: (1) PGPORT must not be the shared dev port 5435 unless running in CI;
 * (2) no mounted service's _outbox.messages may hold more than `maxRows`.
 */
export async function assertFresh(
  services: MountedService[],
  maxRows = 5000,
): Promise<void> {
  const port = harnessPgPort();
  const inCi = process.env.CI === "true" || process.env.CI === "1";
  if (port === "5435" && !inCi) {
    throw new Error(
      "harness.assertFresh: PGPORT is the shared dev port 5435 outside CI. Point PGPORT at a " +
        "disposable Postgres bootstrapped with scripts/ci/bootstrap-postgres.sh; refusing to run " +
        "(relayOnce would mark other services' real unpublished rows published). See TX-017.",
    );
  }
  for (const svc of services) {
    const [row] = await svc.sqlClient`select count(*)::int as c from _outbox.messages`;
    const count = row?.c ?? 0;
    if (count > maxRows) {
      throw new Error(
        `harness.assertFresh: ${svc.name} _outbox.messages already has ${count} rows (> ${maxRows}) ` +
          "before this test wrote anything — this is not a freshly-bootstrapped test database. Refusing " +
          "to run so relayOnce does not read and mark-published rows it did not produce. See TX-017.",
      );
    }
  }
}

/** A fresh tenant id per call (crypto UUID). A test file uses its own tenant(s). */
export function tenant(): string {
  return randomUUID();
}

/**
 * UAT B10-F83 ops CLI: find audit events that a producer service committed to
 * its outbox and relayed, but that never reached the audit store, and (only
 * with --apply) queue them for a second delivery.
 *
 * Why this is safe:
 *  - Nothing is published from here. --apply only clears `published_at` on the
 *    producer's own `_outbox.messages` rows, so that service's normal relay
 *    sends them again with the SAME messageId (the outbox row id).
 *  - Lost = the row id is absent from audit `_inbox.processed`. Dedupe is by
 *    message id only (never by content, which would also suppress distinct
 *    sibling events). audit-service keeps processed ids 31 days once this
 *    change is deployed, and dedupes a second delivery by id.
 *  - Where the dedupe history does not reach back (a row published before the
 *    oldest processed entry), an id-less miss is ambiguous only if audit holds
 *    an event of that tenant and correlation recorded before that point; such
 *    rows are reported as `ambiguous` and never re-queued.
 *  - The event keeps its true time: the relay sends the outbox created_at as
 *    the envelope timestamp, which audit stores as `event_at` (migration 0036).
 *    The payload is stamped `_replay` (reason, time) so the record shows it was
 *    re-delivered.
 *  - Each database is handled on its own: a failure is reported and the run
 *    continues; databases without `_outbox.messages` are skipped. A per-DB
 *    summary is printed. Default is a dry run (counts only).
 *
 * Run in services/audit-service with:
 *   AUDIT_DATABASE_URL     audit DB, read only (_inbox.processed)
 *   PRODUCER_DSN_TEMPLATE  producer DSN with "{db}" for the database name, as a
 *                          role that can read (and with --apply UPDATE) _outbox.messages
 *
 *   pnpm exec tsx src/scripts/replay-lost-audit-events.ts \
 *     --from 2026-10-28T16:00:00Z --to 2026-10-29T15:05:00Z --databases all [--apply]
 *
 * `--databases all` lists every civitas_* database through the template's
 * server (connecting to "postgres"); otherwise give a comma list.
 */
import postgres from "postgres";

const AUDIT_TOPIC = "audit.event.record";
const DB_RE = /^civitas_[a-z0-9_]+$/;

export type Args = { from: Date; to: Date; databases: string[] | "all"; apply: boolean; reason: string };

export function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (a === "--apply") { apply = true; continue; }
    if (a === "--dry-run") continue;
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    out[a.slice(2)] = argv[++i] ?? "";
  }
  const from = new Date(out.from ?? "");
  const to = new Date(out.to ?? "");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw new Error("--from and --to are required ISO timestamps with from < to");
  }
  if (to.getTime() - from.getTime() > 31 * 86_400_000) throw new Error("window longer than 31 days refused");
  const raw = (out.databases ?? "").trim();
  let databases: string[] | "all";
  if (raw === "all") databases = "all";
  else {
    databases = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (databases.length === 0 || databases.some((d) => !DB_RE.test(d))) {
      throw new Error("--databases must be 'all' or a comma list of civitas_* database names");
    }
  }
  return { from, to, databases, apply, reason: out.reason || "UAT-B10-F83 replay" };
}

export type DbResult = {
  db: string; status: "ok" | "skipped" | "error";
  published: number; lost: number; ambiguous: number; applied: number; detail?: string;
};

/** Ids among `ids` that audit has not processed. */
export async function unprocessed(audit: postgres.Sql, ids: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    for (const r of await audit<{ message_id: string }[]>`SELECT message_id FROM _inbox.processed WHERE message_id = ANY(${chunk}::uuid[])`) {
      seen.add(r.message_id);
    }
  }
  return new Set(ids.filter((id) => !seen.has(id)));
}

/** Oldest entry of audit's dedupe history (null when empty). */
export async function dedupeHistoryStart(audit: postgres.Sql): Promise<Date | null> {
  const [cov] = await audit<{ oldest: Date | null }[]>`SELECT min(processed_at) AS oldest FROM _inbox.processed`;
  return cov?.oldest ?? null;
}

export async function replayOne(
  dbName: string, producer: postgres.Sql, audit: postgres.Sql, a: Args, historyStart?: Date | null,
): Promise<DbResult> {
  const empty = { published: 0, lost: 0, ambiguous: 0, applied: 0 };
  const [reg] = await producer<{ t: string | null }[]>`SELECT to_regclass('_outbox.messages')::text AS t`;
  if (!reg?.t) return { db: dbName, status: "skipped", ...empty, detail: "no _outbox.messages" };
  const start = historyStart === undefined ? await dedupeHistoryStart(audit) : historyStart;
  const rows = await producer<{ id: string; tenant_id: string; correlation_id: string; published_at: Date }[]>`
    SELECT id, tenant_id, correlation_id, published_at FROM _outbox.messages
     WHERE topic = ${AUDIT_TOPIC} AND published_at IS NOT NULL
       AND published_at >= ${a.from} AND published_at < ${a.to}`;
  const missing = await unprocessed(audit, rows.map((r) => r.id));
  const lost: string[] = [];
  let ambiguous = 0;
  for (const r of rows) {
    if (!missing.has(r.id)) continue;
    if (!start || r.published_at < start) {
      const [hit] = await audit<{ n: number }[]>`
        SELECT 1 AS n FROM events.events
         WHERE tenant_id = ${r.tenant_id} AND correlation_id = ${r.correlation_id}
           AND created_at < ${start ?? new Date()} LIMIT 1`;
      if (hit) { ambiguous += 1; continue; }
    }
    lost.push(r.id);
  }
  let applied = 0;
  if (a.apply && lost.length > 0) {
    await producer.begin(async (tx) => {
      for (let i = 0; i < lost.length; i += 1000) {
        const chunk = lost.slice(i, i + 1000);
        const res = await tx`
          UPDATE _outbox.messages
             SET published_at = NULL,
                 payload = payload || jsonb_build_object('_replay', jsonb_build_object(
                   'reason', ${a.reason}::text, 'replayedAt', now()::text))
           WHERE id = ANY(${chunk}::uuid[]) AND topic = ${AUDIT_TOPIC} AND published_at IS NOT NULL`;
        applied += res.count;
      }
    });
  }
  return { db: dbName, status: "ok", published: rows.length, lost: lost.length, ambiguous, applied };
}

async function listDatabases(template: string): Promise<string[]> {
  const admin = postgres(template.replace("{db}", "postgres"), { max: 1 });
  try {
    const rows = await admin<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname LIKE 'civitas\\_%' ORDER BY 1`;
    return rows.map((r) => r.datname).filter((d) => DB_RE.test(d) && d !== "civitas_audit_test");
  } finally {
    await admin.end();
  }
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const auditUrl = process.env.AUDIT_DATABASE_URL;
  const template = process.env.PRODUCER_DSN_TEMPLATE;
  if (!auditUrl || !template || !template.includes("{db}")) {
    throw new Error("AUDIT_DATABASE_URL and PRODUCER_DSN_TEMPLATE (with {db}) are required");
  }
  const audit = postgres(auditUrl, { max: 1 });
  const results: DbResult[] = [];
  try {
    const start = await dedupeHistoryStart(audit);
    process.stdout.write(`${JSON.stringify({ dedupeHistoryStart: start?.toISOString() ?? null })}\n`);
    const dbs = a.databases === "all" ? await listDatabases(template) : a.databases;
    for (const dbName of dbs) {
      const producer = postgres(template.replace("{db}", dbName), { max: 1, connect_timeout: 10 });
      try {
        results.push(await replayOne(dbName, producer, audit, a, start));
      } catch (err) {
        results.push({ db: dbName, status: "error", published: 0, lost: 0, ambiguous: 0, applied: 0, detail: err instanceof Error ? err.message : String(err) });
      } finally {
        await producer.end({ timeout: 5 }).catch(() => undefined);
      }
      process.stdout.write(`${JSON.stringify(results[results.length - 1])}\n`);
    }
  } finally {
    await audit.end();
  }
  const sum = (k: "published" | "lost" | "ambiguous" | "applied") => results.reduce((n, r) => n + r[k], 0);
  process.stdout.write(`${JSON.stringify({
    mode: a.apply ? "apply" : "dry-run", from: a.from.toISOString(), to: a.to.toISOString(),
    databases: results.length, ok: results.filter((r) => r.status === "ok").length,
    skipped: results.filter((r) => r.status === "skipped").map((r) => r.db),
    errors: results.filter((r) => r.status === "error").map((r) => ({ db: r.db, detail: r.detail })),
    published: sum("published"), lost: sum("lost"), ambiguous: sum("ambiguous"), applied: sum("applied"),
  })}\n`);
  if (results.some((r) => r.status === "error")) process.exitCode = 2;
}

if (process.argv[1] && /replay-lost-audit-events\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err: unknown) => {
    process.stderr.write(`replay-lost-audit-events failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

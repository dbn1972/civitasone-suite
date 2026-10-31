/**
 * UAT B10-F83 ops CLI: find audit events that a producer service committed to
 * its outbox and relayed, but that never reached the audit store, and (only
 * with --apply) queue them for a second delivery.
 *
 * Why this is safe:
 *  - Nothing is published from here. --apply only clears `published_at` on the
 *    producer's own `_outbox.messages` rows, so that service's normal relay
 *    sends them again with the SAME messageId (= the outbox row id).
 *  - A row is selected only when its id is absent from audit
 *    `_inbox.processed` AND no `events.events` row of that tenant carries the
 *    same correlation id, target and action (the second check covers
 *    processed entries the 7-day purge has removed). audit-service dedupes on
 *    messageId, so a row that does arrive twice is still stored once.
 *  - The window is required and bounded, and the default is a dry run that
 *    only prints counts.
 *  - --apply stamps `_replay` (original created_at, reason) into the payload,
 *    so the audit record shows the event was re-delivered, and when it really
 *    happened. Its occurred_at will be the replay time (the hash chain only
 *    appends), so readers should use `_replay.originalCreatedAt`.
 *
 * Run in services/audit-service with:
 *   AUDIT_DATABASE_URL     audit DB (read only: _inbox.processed, events.events)
 *   PRODUCER_DSN_TEMPLATE  producer DSN with "{db}" for the database name, as a
 *                          role that can UPDATE _outbox.messages (owner or admin)
 *
 *   pnpm exec tsx src/scripts/replay-lost-audit-events.ts \
 *     --from 2026-10-28T16:00:00Z --to 2026-10-29T15:05:00Z \
 *     --databases civitas_hrms,civitas_notification,...   [--apply]
 *
 * Producer rows are purged 7 days after published_at (30 days for audit
 * topics once this change is deployed), so run it before then.
 */
import postgres from "postgres";

const AUDIT_TOPIC = "audit.event.record";
const DB_RE = /^civitas_[a-z0-9_]+$/;

type Args = { from: Date; to: Date; databases: string[]; apply: boolean; reason: string };

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
  if (to.getTime() - from.getTime() > 8 * 86_400_000) throw new Error("window longer than 8 days refused");
  const databases = (out.databases ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (databases.length === 0 || databases.some((d) => !DB_RE.test(d))) {
    throw new Error("--databases must be a comma list of civitas_* database names");
  }
  return { from, to, databases, apply, reason: out.reason || "UAT-B10-F83 replay" };
}

type Row = { id: string; tenant_id: string; correlation_id: string; created_at: Date; payload: Record<string, unknown> };

async function lostRows(producer: postgres.Sql, audit: postgres.Sql, a: Args): Promise<Row[]> {
  const rows = await producer<Row[]>`
    SELECT id, tenant_id, correlation_id, created_at, payload
      FROM _outbox.messages
     WHERE topic = ${AUDIT_TOPIC} AND published_at IS NOT NULL
       AND published_at >= ${a.from} AND published_at < ${a.to}`;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const seen = new Set(
    (await audit<{ message_id: string }[]>`SELECT message_id FROM _inbox.processed WHERE message_id = ANY(${ids}::uuid[])`)
      .map((r) => r.message_id),
  );
  const candidates = rows.filter((r) => !seen.has(r.id));
  const lost: Row[] = [];
  for (const r of candidates) {
    const target = typeof r.payload.resourceId === "string" ? r.payload.resourceId : null;
    const action = typeof r.payload.action === "string" ? r.payload.action : null;
    const [hit] = await audit<{ n: number }[]>`
      SELECT 1 AS n FROM events.events
       WHERE tenant_id = ${r.tenant_id} AND correlation_id = ${r.correlation_id}
         AND target IS NOT DISTINCT FROM ${target} AND payload->>'action' IS NOT DISTINCT FROM ${action}
       LIMIT 1`;
    if (!hit) lost.push(r);
  }
  return lost;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const auditUrl = process.env.AUDIT_DATABASE_URL;
  const template = process.env.PRODUCER_DSN_TEMPLATE;
  if (!auditUrl || !template || !template.includes("{db}")) {
    throw new Error("AUDIT_DATABASE_URL and PRODUCER_DSN_TEMPLATE (with {db}) are required");
  }
  // BYPASSRLS/admin role expected: _inbox/_outbox are relay tables, events.events is tenant-scoped.
  const audit = postgres(auditUrl, { max: 1 });
  let total = 0;
  try {
    for (const dbName of a.databases) {
      const producer = postgres(template.replace("{db}", dbName), { max: 1 });
      try {
        const lost = await lostRows(producer, audit, a);
        total += lost.length;
        if (a.apply && lost.length > 0) {
          await producer.begin(async (tx) => {
            for (const r of lost) {
              await tx`
                UPDATE _outbox.messages
                   SET published_at = NULL,
                       payload = payload || jsonb_build_object('_replay', jsonb_build_object(
                         'originalCreatedAt', ${r.created_at.toISOString()}::text, 'reason', ${a.reason}::text))
                 WHERE id = ${r.id} AND topic = ${AUDIT_TOPIC} AND published_at IS NOT NULL`;
            }
          });
        }
        process.stdout.write(`${JSON.stringify({ db: dbName, lost: lost.length, applied: a.apply })}\n`);
      } finally {
        await producer.end();
      }
    }
  } finally {
    await audit.end();
  }
  process.stdout.write(`${JSON.stringify({ total, mode: a.apply ? "apply" : "dry-run" })}\n`);
}

if (process.argv[1] && /replay-lost-audit-events\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err: unknown) => {
    process.stderr.write(`replay-lost-audit-events failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

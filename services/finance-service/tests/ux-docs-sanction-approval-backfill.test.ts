/**
 * PR #2463 review, blocker 2: scripts/backfill-sanction-approvals.ts fills approved_by/approved_at
 * for sanctions approved before migration 0162, from the approval event of record. Dry run plans
 * only; --apply writes once and never overwrites; a sanction with no event stays unresolved.
 * Runs as the bootstrap superuser on the disposable DB (the script is an owner/admin tool).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { planSanctionApprovals, applySanctionApprovals } from "../scripts/backfill-sanction-approvals.js";

const T = "aaaaaaaa-1111-4000-8000-0000000d0c81";
const MAKER = "00000000-aaaa-4000-8000-0000000d0c81";
const APPROVER_EVENT = "00000000-aaaa-4000-8000-0000000d0c82";
const APPROVER_AUDIT = "00000000-aaaa-4000-8000-0000000d0c83";
const CLERK = "00000000-aaaa-4000-8000-0000000d0c84";
const HEAD = "00000000-bbbb-4000-8000-0000000d0c81";
const S_EVENT = "00000000-cccc-4000-8000-0000000d0c81";
const S_AUDIT = "00000000-cccc-4000-8000-0000000d0c82";
const S_NONE = "00000000-cccc-4000-8000-0000000d0c83";
const S_DONE = "00000000-cccc-4000-8000-0000000d0c84";

const admin = postgres({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT), database: "civitas_finance",
  username: process.env.PGUSER ?? "civitas", password: process.env.PGPASSWORD ?? "", max: 1,
});

async function wipe() {
  await admin`DELETE FROM _outbox.messages WHERE tenant_id = ${T}::uuid`;
  await admin`DELETE FROM budget.finance_sanctions WHERE tenant_id = ${T}::uuid`;
  await admin`DELETE FROM budget.finance_heads WHERE id = ${HEAD}::uuid`;
}

beforeAll(async () => {
  await wipe();
  await admin`INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${HEAD}, ${T}, ${"BF-UX-01"}, ${"Backfill head"}, 2, ${MAKER}, ${MAKER})`;
  for (const [id, no, extra] of [[S_EVENT, "BF-EVENT", null], [S_AUDIT, "BF-AUDIT", null], [S_NONE, "BF-NONE", null], [S_DONE, "BF-DONE", APPROVER_AUDIT]] as const) {
    // updated_by = a bill clerk: the backfill must never take the approver from it
    await admin`INSERT INTO budget.finance_sanctions (id, tenant_id, sanction_no, purpose, head_id, amount_minor, status, approved_by, approved_at, created_by, updated_by)
                VALUES (${id}, ${T}, ${no}, ${"p"}, ${HEAD}, 100000, ${"approved"}, ${extra}, ${extra ? new Date("2026-01-01T00:00:00Z") : null}, ${MAKER}, ${CLERK})`;
  }
  await admin`INSERT INTO _outbox.messages (topic, event_type, tenant_id, actor_id, correlation_id, payload, created_at)
              VALUES (${"finance.sanction.approved"}, ${"finance.sanction.approved"}, ${T}, ${APPROVER_EVENT}, ${"c-bf"}, ${admin.json({ sanctionId: S_EVENT })}, ${new Date("2026-09-10T06:00:00Z")}),
                     (${"audit.event.record"}, ${"audit.event.record"}, ${T}, ${APPROVER_AUDIT}, ${"c-bf"}, ${admin.json({ service: "finance", action: "approve", resourceType: "sanction", resourceId: S_AUDIT })}, ${new Date("2026-09-11T06:00:00Z")})`;
});
afterAll(async () => { await wipe(); await admin.end(); });

describe("backfill-sanction-approvals", () => {
  it("plans from the sanction.approved event, then the approve audit event; leaves the rest unresolved; dry run writes nothing", async () => {
    const plans = await planSanctionApprovals(admin, [T]);
    const by = Object.fromEntries(plans.map((p) => [p.sanctionNo, p]));
    expect(Object.keys(by).sort()).toEqual(["BF-AUDIT", "BF-EVENT", "BF-NONE"]); // BF-DONE already has an approver
    expect(by["BF-EVENT"]).toMatchObject({ source: "sanction_approved_event", approvedBy: APPROVER_EVENT, approvedAt: "2026-09-10T06:00:00.000Z" });
    expect(by["BF-AUDIT"]).toMatchObject({ source: "approve_audit_event", approvedBy: APPROVER_AUDIT });
    expect(by["BF-NONE"]).toMatchObject({ source: "unresolved", approvedBy: null });
    const [{ n }] = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM budget.finance_sanctions WHERE tenant_id = ${T}::uuid AND approved_by IS NULL`;
    expect(n).toBe(3);
  });

  it("--apply fills once, is idempotent, and never touches a set approver or takes updated_by", async () => {
    const first = await applySanctionApprovals(admin, await planSanctionApprovals(admin, [T]));
    expect(first).toBe(2);
    expect(await applySanctionApprovals(admin, await planSanctionApprovals(admin, [T]))).toBe(0);
    const rows = await admin<{ sanction_no: string; approved_by: string | null }[]>`SELECT sanction_no, approved_by::text FROM budget.finance_sanctions WHERE tenant_id = ${T}::uuid ORDER BY sanction_no`;
    expect(Object.fromEntries(rows.map((r) => [r.sanction_no, r.approved_by]))).toEqual({
      "BF-AUDIT": APPROVER_AUDIT, "BF-DONE": APPROVER_AUDIT, "BF-EVENT": APPROVER_EVENT, "BF-NONE": null,
    });
    expect(rows.some((r) => r.approved_by === CLERK)).toBe(false);
  });
});

/**
 * PR #2463 review, blocker 2: scripts/backfill-sanction-approvals.ts fills approved_by/approved_at
 * for sanctions approved before migration 0162, from the approval event of record. Dry run plans
 * only; --apply writes once and never overwrites; a sanction with no event stays unresolved.
 * Runs as the RLS-enforced service role (finance_svc, DATABASE_URL): the script and this fixture both set the
 * tenant GUC per transaction, so it must pass without superuser/BYPASSRLS. It also proves tenant isolation: a
 * second tenant's unapproved sanction is neither planned nor written when only the first tenant is scanned.
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
const T2 = "aaaaaaaa-1111-4000-8000-0000000d0c91";
const HEAD2 = "00000000-bbbb-4000-8000-0000000d0c91";
const S_OTHER = "00000000-cccc-4000-8000-0000000d0c91";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL (the finance_svc role on a disposable database) is required");
const admin = postgres(url, { max: 1 });
type Sql = typeof admin;

/** Fixture access goes through the same per-tenant GUC the script uses (FORCE RLS applies to this role). */
const asTenant = <R>(tenant: string, fn: (tx: typeof admin) => Promise<R>): Promise<R> =>
  admin.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`; return fn(tx as unknown as typeof admin); }) as Promise<R>;

async function wipe() {
  await asTenant(T, async (tx) => {
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${T}::uuid`;
    await tx`DELETE FROM budget.finance_sanctions WHERE tenant_id = ${T}::uuid`;
    await tx`DELETE FROM budget.finance_heads WHERE id = ${HEAD}::uuid`;
  });
  await asTenant(T2, async (tx) => {
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${T2}::uuid`;
    await tx`DELETE FROM budget.finance_sanctions WHERE tenant_id = ${T2}::uuid`;
    await tx`DELETE FROM budget.finance_heads WHERE id = ${HEAD2}::uuid`;
  });
}

beforeAll(async () => {
  await wipe();
  await asTenant(T, (tx) => seedTenantA(tx));
  await asTenant(T2, async (tx) => {
    await tx`INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${HEAD2}, ${T2}, ${"BF-UX-02"}, ${"Backfill head 2"}, 2, ${MAKER}, ${MAKER})`;
    await tx`INSERT INTO budget.finance_sanctions (id, tenant_id, sanction_no, purpose, head_id, amount_minor, status, created_by, updated_by)
             VALUES (${S_OTHER}, ${T2}, ${"BF-OTHER"}, ${"p"}, ${HEAD2}, 100000, ${"approved"}, ${MAKER}, ${CLERK})`;
    await tx`INSERT INTO _outbox.messages (topic, event_type, tenant_id, actor_id, correlation_id, payload, created_at)
             VALUES (${"finance.sanction.approved"}, ${"finance.sanction.approved"}, ${T2}, ${APPROVER_EVENT}, ${"c-bf2"}, ${tx.json({ sanctionId: S_OTHER })}, ${new Date("2026-09-12T06:00:00Z")})`;
  });
});

async function seedTenantA(admin: Sql) {
  await admin`INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${HEAD}, ${T}, ${"BF-UX-01"}, ${"Backfill head"}, 2, ${MAKER}, ${MAKER})`;
  for (const [id, no, extra] of [[S_EVENT, "BF-EVENT", null], [S_AUDIT, "BF-AUDIT", null], [S_NONE, "BF-NONE", null], [S_DONE, "BF-DONE", APPROVER_AUDIT]] as const) {
    // updated_by = a bill clerk: the backfill must never take the approver from it
    await admin`INSERT INTO budget.finance_sanctions (id, tenant_id, sanction_no, purpose, head_id, amount_minor, status, approved_by, approved_at, created_by, updated_by)
                VALUES (${id}, ${T}, ${no}, ${"p"}, ${HEAD}, 100000, ${"approved"}, ${extra}, ${extra ? new Date("2026-01-01T00:00:00Z") : null}, ${MAKER}, ${CLERK})`;
  }
  await admin`INSERT INTO _outbox.messages (topic, event_type, tenant_id, actor_id, correlation_id, payload, created_at)
              VALUES (${"finance.sanction.approved"}, ${"finance.sanction.approved"}, ${T}, ${APPROVER_EVENT}, ${"c-bf"}, ${admin.json({ sanctionId: S_EVENT })}, ${new Date("2026-09-10T06:00:00Z")}),
                     (${"audit.event.record"}, ${"audit.event.record"}, ${T}, ${APPROVER_AUDIT}, ${"c-bf"}, ${admin.json({ service: "finance", action: "approve", resourceType: "sanction", resourceId: S_AUDIT })}, ${new Date("2026-09-11T06:00:00Z")})`;
}
afterAll(async () => { await wipe(); await admin.end(); });

async function sanctionRows(tenant: string) {
  return asTenant(tenant, (tx) => tx<{ sanction_no: string; approved_by: string | null }[]>`SELECT sanction_no, approved_by::text FROM budget.finance_sanctions WHERE tenant_id = ${tenant}::uuid ORDER BY sanction_no`);
}

describe("backfill-sanction-approvals", () => {
  it("plans from the sanction.approved event, then the approve audit event; leaves the rest unresolved; dry run writes nothing", async () => {
    const plans = await planSanctionApprovals(admin, [T]);
    const by = Object.fromEntries(plans.map((p) => [p.sanctionNo, p]));
    expect(Object.keys(by).sort()).toEqual(["BF-AUDIT", "BF-EVENT", "BF-NONE"]); // BF-DONE already has an approver
    expect(by["BF-EVENT"]).toMatchObject({ source: "sanction_approved_event", approvedBy: APPROVER_EVENT, approvedAt: "2026-09-10T06:00:00.000Z" });
    expect(by["BF-AUDIT"]).toMatchObject({ source: "approve_audit_event", approvedBy: APPROVER_AUDIT });
    expect(by["BF-NONE"]).toMatchObject({ source: "unresolved", approvedBy: null });
    expect((await sanctionRows(T)).filter((r) => r.approved_by === null)).toHaveLength(3);
  });

  it("--apply fills once, is idempotent, and never touches a set approver or takes updated_by", async () => {
    const first = await applySanctionApprovals(admin, await planSanctionApprovals(admin, [T]));
    expect(first).toBe(2);
    expect(await applySanctionApprovals(admin, await planSanctionApprovals(admin, [T]))).toBe(0);
    const rows = await sanctionRows(T);
    expect(Object.fromEntries(rows.map((r) => [r.sanction_no, r.approved_by]))).toEqual({
      "BF-AUDIT": APPROVER_AUDIT, "BF-DONE": APPROVER_AUDIT, "BF-EVENT": APPROVER_EVENT, "BF-NONE": null,
    });
    expect(rows.some((r) => r.approved_by === CLERK)).toBe(false);
  });

  it("is tenant-scoped: scanning tenant A never plans or writes tenant B's sanction (and B is filled when scanned itself)", async () => {
    const plansA = await planSanctionApprovals(admin, [T]);
    expect(plansA.every((p) => p.tenantId === T)).toBe(true);
    expect((await sanctionRows(T2)).map((r) => r.approved_by)).toEqual([null]);
    const plansB = await planSanctionApprovals(admin, [T2]);
    expect(plansB).toHaveLength(1);
    expect(plansB[0]).toMatchObject({ tenantId: T2, sanctionNo: "BF-OTHER", source: "sanction_approved_event", approvedBy: APPROVER_EVENT });
    expect(await applySanctionApprovals(admin, plansB)).toBe(1);
    expect((await sanctionRows(T2)).map((r) => r.approved_by)).toEqual([APPROVER_EVENT]);
  });
});

/**
 * Workforce Core — backfill & mapping tool (SmartTransfer OS, ST-M01-08).
 *
 * Spec §4 (Universal domain model: Sanctioned Position, Occupancy, Posting
 * History) and §19 (Migrations / data deliverables). Decisions:
 *   • D-ST-01 — Workforce Core owns the canonical Post + effective-dated
 *     Occupancy; the four legacy fragments become the SOURCE of a one-time
 *     backfill, not the master.
 *   • D-ST-02 — office = the HRMS department tree (by id).
 *   • D-ST-03 — cadre master is owned by Workforce Core.
 *   • D-ST-23 — Workforce Core is a liftable module profile; its tables live in
 *     their own `workforce_core` schema.
 *
 * WHAT IT DOES
 * ------------
 * Reads the three legacy sanctioned-post fragments and the current employee
 * rows and PLANS a Workforce Core backfill:
 *   • workforce_core.post       ← manpower.plans
 *                               ← reservation.hrms_sanctioned_posts
 *                               ← tenant.positions (tenant-service, read NOT by
 *                                 cross-service SQL — see readTenantPositions)
 *   • workforce_core.posting_ledger ← current employee.hrms_employees rows
 *     (department = office, date_of_joining = effective_from).
 *
 * It produces a REPORT (JSON + a human summary) and, in DRY-RUN mode (the
 * default), WRITES NOTHING — the whole plan executes inside a single
 * `SET TRANSACTION READ ONLY` transaction so any accidental write throws at the
 * database, and the report records the opening/closing txid snapshot and the
 * per-table row counts to prove nothing changed.
 *
 * APPLY mode is behind TWO gates: the explicit `apply:true` option AND the
 * WORKFORCE_CORE_LEDGER_ENABLED flag (ST-M01-07 config.ts). It runs per tenant
 * inside the tenant transaction (app.tenant_id GUC set), writes ONLY the
 * caller's tenant rows (so the RLS policy's WITH CHECK is satisfied with NO
 * FORCE…FORCE bypass), uses deterministic ids (uuidv5 over stable natural keys)
 * so a re-run is idempotent, and enqueues one `audit.event.record` outbox row
 * in the SAME transaction (house rule 1). Rows that would violate the
 * one-substantive-holder-per-post / per-employee constraint, or whose source is
 * ambiguous, are reported as conflicts/overlaps and NOT written.
 *
 * NO cross-service SQL and NO cross-service FKs (CLAUDE.md §3; D-ST-10):
 * office_id / designation_id / employee_id are opaque ids; tenant.positions is
 * read through tenant-service's HTTP API or an operator-supplied export file,
 * never by querying another service's database.
 */
import { createHash, randomUUID } from "node:crypto";
import { isPostingLedgerEnabled } from "./config.js";

/**
 * A minimal "sql" surface — the subset of the postgres-js tagged-template client
 * and `.unsafe(text, params)` the backfill uses. The CLI passes a real
 * postgres-js client; tests pass the same. Kept narrow so the module has no hard
 * dependency on the driver package shape.
 */
export interface SqlClient {
  unsafe(
    query: string,
    params?: readonly unknown[],
  ): Promise<Array<Record<string, unknown>>>;
}

/** Deterministic UUIDv5 (RFC 4122 §4.3, SHA-1) over a fixed namespace + name. */
const WC_BACKFILL_NAMESPACE = "6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b";

export function deterministicId(name: string): string {
  const nsBytes = Buffer.from(WC_BACKFILL_NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(nsBytes)
    .update(Buffer.from(name, "utf8"))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export type PostSource =
  | "manpower.plans"
  | "reservation.hrms_sanctioned_posts"
  | "tenant.positions";

export interface PlannedPost {
  id: string;
  postNo: string;
  officeId: string | null;
  designationId: string | null;
  cadreCode: string | null;
  gradePayLevel: string | null;
  reservationTag: string | null;
  source: PostSource;
  /** The natural key the deterministic id was derived from. */
  naturalKey: string;
}

export interface PlannedLedger {
  id: string;
  employeeId: string;
  officeId: string;
  effectiveFrom: string; // date (date_of_joining)
}

export interface UnmappedRow {
  source: PostSource | "employee";
  ref: string;
  reason: string;
}

export interface ConflictRow {
  kind:
    | "duplicate_post_no"
    | "duplicate_natural_key"
    | "post_overlap"
    | "employee_overlap";
  ref: string;
  detail: string;
}

export interface SourceCounts {
  manpowerPlans: number;
  sanctionedPosts: number;
  tenantPositions: number;
  employees: number;
}

export interface BackfillReport {
  tenantId: string;
  mode: "dry-run" | "apply";
  generatedAt: string;
  ledgerFlagEnabled: boolean;
  rowsRead: SourceCounts;
  postsPlanned: number;
  ledgerPlanned: number;
  occupancyPlanned: number;
  postsWritten: number;
  ledgerWritten: number;
  occupancyWritten: number;
  unmapped: UnmappedRow[];
  conflicts: ConflictRow[];
  /** Which house-rule-compliant path supplied tenant.positions (set by the CLI). */
  positionsSource?: string;
  /** Proof the dry-run wrote nothing: counts before and after + txid snapshot. */
  proof: {
    readOnly: boolean;
    txidBefore: string | null;
    txidAfter: string | null;
    rowCountsBefore: Record<string, number>;
    rowCountsAfter: Record<string, number>;
  };
}

export interface TenantPosition {
  id: string;
  orgUnitId: string | null;
  code: string;
  title: string;
  grade: string | null;
  status: string;
}

/** Input for a single-tenant backfill plan + optional apply. */
export interface BackfillOptions {
  sql: SqlClient;
  tenantId: string;
  apply: boolean;
  /** Operator-supplied tenant.positions export (Mode: file) or HTTP-fetched. */
  tenantPositions?: TenantPosition[];
  /** Override env for the ledger flag (tests). */
  env?: NodeJS.ProcessEnv;
  /** Actor id for the audit event on apply. Defaults to a well-known ops id. */
  actorId?: string;
  /** correlationId for the audit event on apply. */
  correlationId?: string;
}

const WC = "workforce_core";

const COUNT_TABLES = [
  `${WC}.post`,
  `${WC}.posting_ledger`,
  `${WC}.post_occupancy`,
] as const;

async function snapshotCounts(
  sql: SqlClient,
  tenantId: string,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const tbl of COUNT_TABLES) {
    const rows = await sql.unsafe(
      `SELECT count(*)::int AS n FROM ${tbl} WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    out[tbl] = Number(rows[0]?.n ?? 0);
  }
  return out;
}

async function currentTxid(sql: SqlClient): Promise<string | null> {
  const rows = await sql.unsafe(
    `SELECT pg_current_xact_id_if_assigned()::text AS t`,
  );
  const t = rows[0]?.t;
  return t == null ? null : String(t);
}

/**
 * Build the backfill plan from the three post fragments and current employees.
 * Pure read of the already-tenant-scoped tables, plus the operator-supplied (or
 * HTTP-fetched) tenant.positions. Deterministic: given the same source rows it
 * yields the same ids, so a re-run (apply) is idempotent.
 */
export async function planBackfill(opts: BackfillOptions): Promise<{
  posts: PlannedPost[];
  ledger: PlannedLedger[];
  occupancy: PlannedLedger[];
  unmapped: UnmappedRow[];
  conflicts: ConflictRow[];
  rowsRead: SourceCounts;
}> {
  const { sql, tenantId } = opts;
  const unmapped: UnmappedRow[] = [];
  const conflicts: ConflictRow[] = [];
  const posts: PlannedPost[] = [];
  const seenPostNo = new Map<string, string>();
  const seenNaturalKey = new Set<string>();

  function addPost(p: Omit<PlannedPost, "id">): void {
    if (seenNaturalKey.has(p.naturalKey)) {
      conflicts.push({
        kind: "duplicate_natural_key",
        ref: p.naturalKey,
        detail: `two source rows map to the same post natural key (${p.source})`,
      });
      return;
    }
    const prior = seenPostNo.get(p.postNo);
    if (prior) {
      conflicts.push({
        kind: "duplicate_post_no",
        ref: p.postNo,
        detail: `post_no already claimed by ${prior}; ${p.source} row skipped`,
      });
      return;
    }
    seenNaturalKey.add(p.naturalKey);
    seenPostNo.set(p.postNo, `${p.source}:${p.naturalKey}`);
    posts.push({ id: deterministicId(`post:${tenantId}:${p.naturalKey}`), ...p });
  }

  // ── 1. manpower.plans ─────────────────────────────────────────────────────
  // Expand each APPROVED plan's sanctioned_strength into N posts, office =
  // unit_id. Non-approved / office-less / zero-strength plans are unmapped.
  const plans = await sql.unsafe(
    `SELECT id, unit_id, cadre, designation_id, sanctioned_strength, status
       FROM manpower.plans WHERE tenant_id = $1::uuid`,
    [tenantId],
  );
  for (const r of plans) {
    const planId = String(r.id);
    const status = String(r.status);
    const sanctioned = Number(r.sanctioned_strength ?? 0);
    if (status !== "approved") {
      unmapped.push({ source: "manpower.plans", ref: planId, reason: `plan status '${status}' is not approved` });
      continue;
    }
    if (!r.unit_id) {
      unmapped.push({ source: "manpower.plans", ref: planId, reason: "plan has no unit_id (office)" });
      continue;
    }
    if (sanctioned <= 0) {
      unmapped.push({ source: "manpower.plans", ref: planId, reason: "sanctioned_strength <= 0" });
      continue;
    }
    for (let i = 1; i <= sanctioned; i++) {
      addPost({
        postNo: `PLAN-${planId}-${i}`,
        officeId: String(r.unit_id),
        designationId: r.designation_id ? String(r.designation_id) : null,
        cadreCode: r.cadre ? String(r.cadre) : null,
        gradePayLevel: null,
        reservationTag: null,
        source: "manpower.plans",
        naturalKey: `manpower:${planId}:${i}`,
      });
    }
  }

  // ── 2. reservation.hrms_sanctioned_posts ──────────────────────────────────
  // Cadre-level strength with NO office dimension. Planned with office_id=null
  // and reported unmapped-office (D-ST-02); apply skips office-less posts.
  const sposts = await sql.unsafe(
    `SELECT id, cadre, designation_id, pay_level, sanctioned_strength, status
       FROM reservation.hrms_sanctioned_posts WHERE tenant_id = $1::uuid`,
    [tenantId],
  );
  for (const r of sposts) {
    const spId = String(r.id);
    const status = String(r.status);
    const sanctioned = Number(r.sanctioned_strength ?? 0);
    if (status !== "active") {
      unmapped.push({ source: "reservation.hrms_sanctioned_posts", ref: spId, reason: `status '${status}' not active` });
      continue;
    }
    if (sanctioned <= 0) {
      unmapped.push({ source: "reservation.hrms_sanctioned_posts", ref: spId, reason: "sanctioned_strength <= 0" });
      continue;
    }
    unmapped.push({
      source: "reservation.hrms_sanctioned_posts",
      ref: spId,
      reason:
        "no office dimension (D-ST-02): planned with office_id=null, not applied until an office is supplied",
    });
    for (let i = 1; i <= sanctioned; i++) {
      addPost({
        postNo: `RSVP-${spId}-${i}`,
        officeId: null,
        designationId: r.designation_id ? String(r.designation_id) : null,
        cadreCode: r.cadre ? String(r.cadre) : null,
        gradePayLevel: r.pay_level ? String(r.pay_level) : null,
        reservationTag: null,
        source: "reservation.hrms_sanctioned_posts",
        naturalKey: `reservation:${spId}:${i}`,
      });
    }
  }

  // ── 3. tenant.positions (tenant-service, read via API/file — NOT SQL) ──────
  const positions = opts.tenantPositions ?? [];
  for (const p of positions) {
    if (p.status !== "active") {
      unmapped.push({ source: "tenant.positions", ref: p.id, reason: `status '${p.status}' not active` });
      continue;
    }
    if (!p.orgUnitId) {
      unmapped.push({ source: "tenant.positions", ref: p.id, reason: "position has no org_unit_id (office)" });
      continue;
    }
    addPost({
      postNo: `POS-${p.code}`,
      officeId: p.orgUnitId,
      designationId: null,
      cadreCode: null,
      gradePayLevel: p.grade,
      reservationTag: null,
      source: "tenant.positions",
      naturalKey: `tenant:${p.id}`,
    });
  }

  // ── 4. current employee rows → posting_ledger (+ current occupancy plan) ──
  const emps = await sql.unsafe(
    `SELECT id, department_id, date_of_joining, status
       FROM employee.hrms_employees WHERE tenant_id = $1::uuid`,
    [tenantId],
  );
  const ledger: PlannedLedger[] = [];
  const occupancy: PlannedLedger[] = [];
  const empSeen = new Set<string>();
  for (const e of emps) {
    const empId = String(e.id);
    const dept = e.department_id ? String(e.department_id) : null;
    const doj = e.date_of_joining ? String(e.date_of_joining) : null;
    if (!dept) {
      unmapped.push({ source: "employee", ref: empId, reason: "employee has no department_id (no resolvable post/office)" });
      continue;
    }
    if (!doj) {
      unmapped.push({ source: "employee", ref: empId, reason: "employee has no date_of_joining (no ledger start date)" });
      continue;
    }
    if (empSeen.has(empId)) {
      conflicts.push({ kind: "employee_overlap", ref: empId, detail: "employee appears twice in the employee source" });
      continue;
    }
    empSeen.add(empId);
    ledger.push({ id: deterministicId(`ledger:${tenantId}:${empId}`), employeeId: empId, officeId: dept, effectiveFrom: doj });
    occupancy.push({ id: deterministicId(`occ:${tenantId}:${empId}`), employeeId: empId, officeId: dept, effectiveFrom: doj });
  }

  const rowsRead: SourceCounts = {
    manpowerPlans: plans.length,
    sanctionedPosts: sposts.length,
    tenantPositions: positions.length,
    employees: emps.length,
  };

  return { posts, ledger, occupancy, unmapped, conflicts, rowsRead };
}

const AUDIT_TOPIC = "audit.event.record";
const OPS_ACTOR = "00000000-0000-0000-0000-0000000000ff";

/**
 * Run the backfill for ONE tenant. Dry-run (default) wraps the plan in a
 * read-only transaction and writes nothing. Apply writes tenant-scoped rows and
 * one audit event in a single transaction, gated by the ledger flag.
 */
export async function runBackfillForTenant(
  opts: BackfillOptions,
): Promise<BackfillReport> {
  const { sql, tenantId, apply } = opts;
  const env = opts.env ?? process.env;
  const ledgerFlagEnabled = isPostingLedgerEnabled(env);
  const generatedAt = new Date().toISOString();

  // Scope every statement to this tenant (RLS). Session GUC so snapshotCounts
  // (outside the tx) is tenant-scoped too; re-asserted LOCAL inside each tx.
  await sql.unsafe(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

  if (!apply) {
    // DRY-RUN: a read-only transaction. Any INSERT/UPDATE/DELETE throws
    // (read_only_sql_transaction), proving the plan path writes nothing.
    const rowCountsBefore = await snapshotCounts(sql, tenantId);
    const txidBefore = await currentTxid(sql);
    await sql.unsafe(`BEGIN`);
    let plan;
    try {
      await sql.unsafe(`SET TRANSACTION READ ONLY`);
      await sql.unsafe(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      plan = await planBackfill(opts);
      await sql.unsafe(`COMMIT`);
    } catch (e) {
      await sql.unsafe(`ROLLBACK`).catch(() => undefined);
      throw e;
    }
    const rowCountsAfter = await snapshotCounts(sql, tenantId);
    const txidAfter = await currentTxid(sql);
    const occPlanned = plan.occupancy.filter((o) => o.officeId).length;
    return {
      tenantId,
      mode: "dry-run",
      generatedAt,
      ledgerFlagEnabled,
      rowsRead: plan.rowsRead,
      postsPlanned: plan.posts.length,
      ledgerPlanned: plan.ledger.length,
      occupancyPlanned: occPlanned,
      postsWritten: 0,
      ledgerWritten: 0,
      occupancyWritten: 0,
      unmapped: plan.unmapped,
      conflicts: plan.conflicts,
      proof: {
        readOnly: true,
        txidBefore,
        txidAfter,
        rowCountsBefore,
        rowCountsAfter,
      },
    };
  }

  // APPLY — gated by the ledger flag (ST-M01-07). Fail closed when off.
  if (!ledgerFlagEnabled) {
    throw new Error(
      "apply mode requires WORKFORCE_CORE_LEDGER_ENABLED=true (ST-M01-07 flag); refusing to write",
    );
  }

  const rowCountsBefore = await snapshotCounts(sql, tenantId);
  const plan = await planBackfill(opts);
  const actorId = opts.actorId ?? OPS_ACTOR;
  const correlationId = (opts.correlationId ?? randomUUID()).slice(0, 64);

  let postsWritten = 0;
  let ledgerWritten = 0;
  const occupancyWritten = 0;

  await sql.unsafe(`BEGIN`);
  try {
    await sql.unsafe(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    // Posts: only those with a resolvable office (D-ST-02). ON CONFLICT on
    // (tenant_id, post_no) + a deterministic id make a re-run idempotent.
    for (const p of plan.posts) {
      if (!p.officeId) continue;
      const res = await sql.unsafe(
        `INSERT INTO ${WC}.post
           (id, tenant_id, post_no, office_id, designation_id, grade_pay_level, reservation_tag, status, created_by, updated_by)
         VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,'sanctioned',$8::uuid,$8::uuid)
         ON CONFLICT (tenant_id, post_no) DO NOTHING
         RETURNING id`,
        [p.id, tenantId, p.postNo, p.officeId, p.designationId, p.gradePayLevel, p.reservationTag, actorId],
      );
      postsWritten += res.length;
    }

    // Posting ledger: deterministic id, ON CONFLICT (id) DO NOTHING. An
    // open-ended substantive span from date_of_joining — this is the initial
    // posting the standalone-feasibility note (§8) asks the backfill to create.
    for (const l of plan.ledger) {
      const res = await sql.unsafe(
        `INSERT INTO ${WC}.posting_ledger
           (id, tenant_id, employee_id, office_id, charge_type, effective_from, created_by)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'substantive',$5::date,$6::uuid)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [l.id, tenantId, l.employeeId, l.officeId, l.effectiveFrom, actorId],
      );
      ledgerWritten += res.length;
    }

    // Occupancy is POST-level (FK to workforce_core.post) and effective-dated;
    // the office-level current holder has no resolved post here, so this tool
    // does not write post_occupancy — that is applyPosting's job (ST-M01-09),
    // which is the only writer of occupancy. Reported as occupancyWritten=0.

    // One audit event for the whole tenant backfill, in the same transaction
    // (house rule 1: guarded write + audit.event.record atomically).
    await sql.unsafe(
      `INSERT INTO _outbox.messages
         (topic, event_type, tenant_id, actor_id, correlation_id, schema_version, payload)
       VALUES ($1,$1,$2::uuid,$3::uuid,$4,'1.0',$5::jsonb)`,
      [
        AUDIT_TOPIC,
        tenantId,
        actorId,
        correlationId,
        JSON.stringify({
          service: "hrms",
          action: "backfill",
          resourceType: "workforce_core",
          resourceId: tenantId,
          outcome: "success",
          metadata: {
            postsWritten,
            ledgerWritten,
            occupancyWritten,
            tool: "workforce-core-backfill",
            decisions: ["D-ST-01", "D-ST-02", "D-ST-03", "D-ST-23"],
          },
        }),
      ],
    );

    await sql.unsafe(`COMMIT`);
  } catch (e) {
    await sql.unsafe(`ROLLBACK`).catch(() => undefined);
    throw e;
  }

  const rowCountsAfter = await snapshotCounts(sql, tenantId);
  const occPlanned = plan.occupancy.filter((o) => o.officeId).length;
  return {
    tenantId,
    mode: "apply",
    generatedAt,
    ledgerFlagEnabled,
    rowsRead: plan.rowsRead,
    postsPlanned: plan.posts.length,
    ledgerPlanned: plan.ledger.length,
    occupancyPlanned: occPlanned,
    postsWritten,
    ledgerWritten,
    occupancyWritten,
    unmapped: plan.unmapped,
    conflicts: plan.conflicts,
    proof: {
      readOnly: false,
      txidBefore: null,
      txidAfter: null,
      rowCountsBefore,
      rowCountsAfter,
    },
  };
}

/** Render a human-readable summary of a report. */
export function renderHumanSummary(r: BackfillReport): string {
  const lines: string[] = [];
  lines.push(`Workforce Core backfill — tenant ${r.tenantId} [${r.mode}]`);
  lines.push(`generated: ${r.generatedAt}`);
  lines.push(`ledger flag (WORKFORCE_CORE_LEDGER_ENABLED): ${r.ledgerFlagEnabled ? "ON" : "off"}`);
  lines.push("");
  lines.push("rows read per source:");
  lines.push(`  manpower.plans:                    ${r.rowsRead.manpowerPlans}`);
  lines.push(`  reservation.hrms_sanctioned_posts: ${r.rowsRead.sanctionedPosts}`);
  lines.push(`  tenant.positions:                  ${r.rowsRead.tenantPositions}`);
  lines.push(`  employees:                         ${r.rowsRead.employees}`);
  lines.push("");
  lines.push("mapped (planned):");
  lines.push(`  posts:          ${r.postsPlanned}  (written: ${r.postsWritten})`);
  lines.push(`  posting_ledger: ${r.ledgerPlanned}  (written: ${r.ledgerWritten})`);
  lines.push(`  occupancy:      ${r.occupancyPlanned}  (written: ${r.occupancyWritten})`);
  lines.push("");
  lines.push(`unmapped (${r.unmapped.length}):`);
  for (const u of r.unmapped.slice(0, 50)) lines.push(`  [${u.source}] ${u.ref}: ${u.reason}`);
  if (r.unmapped.length > 50) lines.push(`  … and ${r.unmapped.length - 50} more`);
  lines.push("");
  lines.push(`duplicates/conflicts/overlaps (${r.conflicts.length}):`);
  for (const c of r.conflicts.slice(0, 50)) lines.push(`  [${c.kind}] ${c.ref}: ${c.detail}`);
  if (r.conflicts.length > 50) lines.push(`  … and ${r.conflicts.length - 50} more`);
  lines.push("");
  if (r.mode === "dry-run") {
    const unchanged =
      JSON.stringify(r.proof.rowCountsBefore) === JSON.stringify(r.proof.rowCountsAfter);
    lines.push(
      `DRY RUN — wrote nothing. read-only=${r.proof.readOnly}, row counts unchanged=${unchanged}, ` +
        `txid before=${r.proof.txidBefore ?? "none"} after=${r.proof.txidAfter ?? "none"}.`,
    );
  }
  const clean = r.conflicts.length === 0;
  if (r.mode === "dry-run") {
    lines.push(
      clean
        ? "RESULT: backfill dry run is clean (no conflicts)."
        : "RESULT: conflicts present — resolve before apply.",
    );
  } else {
    lines.push(
      clean
        ? `RESULT: apply complete — ${r.postsWritten} posts, ${r.ledgerWritten} ledger rows written (no conflicts).`
        : "RESULT: apply complete with conflicts reported — review the conflict list.",
    );
  }
  return lines.join("\n");
}

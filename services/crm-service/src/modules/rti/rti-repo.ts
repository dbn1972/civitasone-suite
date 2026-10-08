/**
 * RTI Act 2005 — database access layer.
 *
 * All mutations go through scopedRead (GUC-scoped connection, RLS enforced).
 * The calling route is responsible for extracting tenantId / actorId from ctx.
 */
import { sql, type SQL } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { recordStatusHistory, listStatusHistory } from "../../shared/case-status-history.js";
import { EVENTS } from "../../topics.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export const RTI_STATUS = [
  "RECEIVED",
  "TRANSFERRED",
  "RESPONDED",
  "REJECTED",
  "FIRST_APPEAL",
  "SECOND_APPEAL",
  "DISPOSED",
] as const;
export type RtiStatus = (typeof RTI_STATUS)[number];

export type RtiRow = Record<string, unknown>;

export type RtiListOpts = {
  tenantId: string;
  status?: string;
  section?: string;
  departmentRef?: string;
  search?: string;
  pageSize: number;
  offset: number;
};

export type RtiCreateData = {
  tenantId: string;
  actorId: string;
  /** GAP2-CRM-RTI-AUDIT-03: correlation id for the audit event emitted on create. */
  correlationId?: string;
  referenceNo: string;
  section: string;
  departmentRef: string;
  applicantName: string;
  applicantContact?: string;
  subject: string;
  description: string;
  feePaid?: boolean;
  feeAmount?: number;
  /** GAP-CRM-RTI-NEW-01: application fee in minor units (paise), bigint-safe string. Preferred. */
  feeAmountMinor?: string;
  /** GAP-CRM-RTI-NEW-02: date of physical receipt (YYYY-MM-DD). Omitted -> now(). */
  receivedDate?: string;
  /** GAP-CRM-RTI-NEW-02: mode of receipt (online|post|email|in_person|by_hand). */
  mode?: string;
};

// ---------------------------------------------------------------------------
// Repo functions
// ---------------------------------------------------------------------------

export async function getRtiList(
  opts: RtiListOpts,
): Promise<{ rows: RtiRow[]; total: number }> {
  const statusF = opts.status
    ? sql`AND r.status = ${opts.status}`
    : sql``;
  const sectionF = opts.section
    ? sql`AND r.section = ${opts.section}`
    : sql``;
  const deptF = opts.departmentRef
    ? sql`AND r.department_ref ILIKE ${"%" + opts.departmentRef + "%"}`
    : sql``;
  const searchF = opts.search
    ? sql`AND (r.applicant_name ILIKE ${"%" + opts.search + "%"}
               OR r.subject ILIKE ${"%" + opts.search + "%"}
               OR r.reference_no ILIKE ${"%" + opts.search + "%"})`
    : sql``;

  const rows = (await scopedRead((tx) =>
    tx.execute(sql`
      SELECT r.id,
             r.reference_no        AS "referenceNo",
             r.section,
             r.department_ref      AS "departmentRef",
             r.applicant_name      AS "applicantName",
             r.applicant_contact   AS "applicantContact",
             r.subject,
             r.status,
             r.mode,
             r.fee_paid            AS "feePaid",
             r.fee_amount          AS "feeAmount",
             r.fee_amount_minor    AS "feeAmountMinor",
             r.received_at         AS "receivedAt",
             r.due_at              AS "dueAt",
             r.first_appeal_due_at AS "firstAppealDueAt",
             r.responded_at        AS "respondedAt",
             r.created_at          AS "createdAt",
             r.updated_at          AS "updatedAt"
      FROM crm.rti_requests r
      WHERE r.tenant_id = ${opts.tenantId}
        ${statusF} ${sectionF} ${deptF} ${searchF}
      ORDER BY r.due_at ASC
      LIMIT  ${opts.pageSize}
      OFFSET ${opts.offset}
    `),
  )) as unknown as RtiRow[];

  const [ct] = (await scopedRead((tx) =>
    tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM crm.rti_requests r
      WHERE r.tenant_id = ${opts.tenantId}
        ${statusF} ${sectionF} ${deptF} ${searchF}
    `),
  )) as unknown as Array<{ total: number }>;

  return { rows, total: ct?.total ?? 0 };
}

export async function getRtiById(
  tenantId: string,
  id: string,
): Promise<RtiRow | null> {
  const rows = (await scopedRead((tx) =>
    tx.execute(sql`
      SELECT r.id,
             r.reference_no        AS "referenceNo",
             r.section,
             r.department_ref      AS "departmentRef",
             r.applicant_name      AS "applicantName",
             r.applicant_contact   AS "applicantContact",
             r.subject,
             r.description,
             r.status,
             r.mode,
             r.fee_paid            AS "feePaid",
             r.fee_amount          AS "feeAmount",
             r.fee_amount_minor    AS "feeAmountMinor",
             r.received_at         AS "receivedAt",
             r.due_at              AS "dueAt",
             r.first_appeal_due_at AS "firstAppealDueAt",
             r.responded_at        AS "respondedAt",
             r.response_text       AS "responseText",
             r.first_appeal_order      AS "firstAppealOrder",
             r.first_appeal_outcome    AS "firstAppealOutcome",
             r.first_appeal_decided_at AS "firstAppealDecidedAt",
             r.second_appeal_at        AS "secondAppealAt",
             r.second_appeal_ref       AS "secondAppealRef",
             r.disposed_at             AS "disposedAt",
             r.disposal_reason         AS "disposalReason",
             r.created_by          AS "createdBy",
             r.created_at          AS "createdAt",
             r.updated_at          AS "updatedAt"
      FROM crm.rti_requests r
      WHERE r.id = ${id}::uuid
        AND r.tenant_id = ${tenantId}
    `),
  )) as unknown as RtiRow[];

  return rows[0] ?? null;
}

/** fee_amount is numeric(10,2): max 99,999,999.99 rupees = 9,999,999,999 paise. */
export const MAX_FEE_MINOR = 9_999_999_999n;

export type FeeResolution =
  | { ok: true; feeAmount?: number; feeAmountMinor?: string }
  | { ok: false; code: "FEE_OUT_OF_RANGE" | "FEE_AMOUNT_MISMATCH"; message: string };

/**
 * Validate and reconcile the two fee inputs. Out-of-range values (which would
 * overflow numeric(10,2)/bigint and 500) and disagreeing feeAmount (rupees) /
 * feeAmountMinor (paise) are rejected; a lone input is passed through.
 */
export function resolveFee(feeAmount: number | undefined, feeAmountMinor: string | number | undefined): FeeResolution {
  let minor: bigint | undefined;
  if (feeAmountMinor !== undefined) {
    const raw = String(feeAmountMinor);
    if (!/^\d+$/.test(raw) || BigInt(raw) > MAX_FEE_MINOR) {
      return { ok: false, code: "FEE_OUT_OF_RANGE", message: "feeAmountMinor must be a non-negative integer of at most 9999999999 paise" };
    }
    minor = BigInt(raw);
  }
  let fromRupees: bigint | undefined;
  if (feeAmount !== undefined) {
    if (!Number.isFinite(feeAmount) || feeAmount < 0 || feeAmount > 99_999_999.99) {
      return { ok: false, code: "FEE_OUT_OF_RANGE", message: "feeAmount must be between 0 and 99999999.99 rupees" };
    }
    fromRupees = BigInt(Math.round(feeAmount * 100));
  }
  if (minor !== undefined && fromRupees !== undefined && minor !== fromRupees) {
    return { ok: false, code: "FEE_AMOUNT_MISMATCH", message: "feeAmount and feeAmountMinor disagree; send one, or values that match exactly" };
  }
  return {
    ok: true,
    ...(feeAmount !== undefined ? { feeAmount } : {}),
    ...(minor !== undefined ? { feeAmountMinor: minor.toString() } : {}),
  };
}

export async function createRti(data: RtiCreateData): Promise<RtiRow> {
  // GAP-CRM-RTI-NEW-02: when a date of receipt is supplied, received_at is set
  // to that calendar day at UTC midnight -- the same UTC basis the generated
  // due_at column uses, so due_at = receivedDate + 30 days exactly. When
  // omitted, the column default (now()) applies. mode is nullable.
  const receivedAtExpr = data.receivedDate
    ? sql`(${data.receivedDate}::date AT TIME ZONE 'UTC')`
    : sql`now()`;

  // GAP-CRM-RTI-NEW-01: fee_amount_minor (paise) is the source of truth. If the
  // caller sent paise, use it directly and derive the legacy rupees column from
  // it (minor/100). If only the legacy rupees number was sent, store it and
  // derive paise (round(rupees*100)). Either way both columns stay consistent
  // during the expand phase; the paise column never loses precision.
  const feeMinorExpr =
    data.feeAmountMinor !== undefined
      ? sql`${data.feeAmountMinor}::bigint`
      : data.feeAmount !== undefined
        ? sql`round(${data.feeAmount}::numeric * 100)::bigint`
        : sql`NULL`;
  const feeRupeesExpr =
    data.feeAmount !== undefined
      ? sql`${data.feeAmount}::numeric(10,2)`
      : data.feeAmountMinor !== undefined
        ? sql`(${data.feeAmountMinor}::numeric / 100)::numeric(10,2)`
        : sql`NULL`;

  const rows = (await scopedRead(async (tx) => {
    const inserted = (await tx.execute(sql`
      INSERT INTO crm.rti_requests (
        tenant_id, reference_no, section, department_ref,
        applicant_name, applicant_contact,
        subject, description,
        fee_paid, fee_amount, fee_amount_minor, received_at, mode, created_by
      ) VALUES (
        ${data.tenantId}::uuid,
        ${data.referenceNo},
        ${data.section},
        ${data.departmentRef},
        ${data.applicantName},
        ${data.applicantContact ?? null},
        ${data.subject},
        ${data.description},
        ${data.feePaid ?? false},
        ${feeRupeesExpr},
        ${feeMinorExpr},
        ${receivedAtExpr},
        ${data.mode ?? null},
        ${data.actorId}::uuid
      )
      RETURNING id,
                reference_no   AS "referenceNo",
                section,
                department_ref AS "departmentRef",
                applicant_name AS "applicantName",
                subject,
                status,
                mode,
                fee_paid         AS "feePaid",
                fee_amount       AS "feeAmount",
                fee_amount_minor AS "feeAmountMinor",
                received_at    AS "receivedAt",
                due_at         AS "dueAt",
                created_at     AS "createdAt"
    `)) as unknown as RtiRow[];
    // F6-01: seed the timeline with the opening transition (null -> RECEIVED).
    await recordStatusHistory(tx, {
      tenantId: data.tenantId,
      resourceType: "rti_request",
      resourceId: String(inserted[0]?.["id"]),
      fromStatus: null,
      toStatus: String(inserted[0]?.["status"] ?? "RECEIVED"),
      note: null,
      actorId: data.actorId,
    });
    // GAP2-CRM-RTI-AUDIT-03: logging an RTI is a statutory act; emit the audit
    // event in the SAME tx. emitWithAudit only reads tenantId/actorId/
    // correlationId from the context. Payload carries NO applicant PII.
    const auditCtx = {
      tenantId: data.tenantId,
      actorId: data.actorId,
      correlationId: data.correlationId ?? "",
    } as AuditCtx;
    await emitWithAudit(tx, auditCtx, {
      eventType: EVENTS.rtiCreated,
      action: "create",
      resourceType: "rti_request",
      resourceId: String(inserted[0]?.["id"]),
      payload: {
        rtiId: String(inserted[0]?.["id"]),
        status: String(inserted[0]?.["status"] ?? "RECEIVED"),
        section: data.section,
      },
    });
    return inserted;
  })) as unknown as RtiRow[];

  return rows[0]!;
}

export async function forwardRti(
  ctx: AuditCtx,
  id: string,
  departmentRef: string,
): Promise<RtiRow | null> {
  const tenantId = ctx.tenantId;
  const actorId = ctx.actorId;
  return scopedRead(async (tx) => {
    const prev = (await tx.execute(sql`
      SELECT status FROM crm.rti_requests WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
    `)) as unknown as Array<{ status: string }>;
    const rows = (await tx.execute(sql`
      UPDATE crm.rti_requests
      SET status         = 'TRANSFERRED',
          department_ref = ${departmentRef},
          updated_at     = now()
      WHERE id          = ${id}::uuid
        AND tenant_id   = ${tenantId}
        AND status NOT IN ('DISPOSED', 'RESPONDED')
      RETURNING id, status,
                department_ref AS "departmentRef",
                updated_at     AS "updatedAt"
    `)) as unknown as RtiRow[];
    if (!rows[0]) return null;
    await recordStatusHistory(tx, {
      tenantId,
      resourceType: "rti_request",
      resourceId: id,
      fromStatus: prev[0]?.status ?? null,
      toStatus: "TRANSFERRED",
      note: `Transferred to ${departmentRef}`,
      actorId,
    });
    // GAP2-CRM-RTI-AUDIT-03: a department transfer is a statutory act -> audit it.
    await emitWithAudit(tx, ctx, {
      eventType: EVENTS.rtiForwarded,
      action: "forward",
      resourceType: "rti_request",
      resourceId: id,
      payload: { rtiId: id, status: "TRANSFERRED", departmentRef },
    });
    return rows[0];
  });
}

export async function respondRti(
  ctx: AuditCtx,
  id: string,
  responseText: string,
): Promise<RtiRow | null> {
  const tenantId = ctx.tenantId;
  const actorId = ctx.actorId;
  return scopedRead(async (tx) => {
    const prev = (await tx.execute(sql`
      SELECT status FROM crm.rti_requests WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
    `)) as unknown as Array<{ status: string }>;
    const rows = (await tx.execute(sql`
      UPDATE crm.rti_requests
      SET status        = 'RESPONDED',
          response_text = ${responseText},
          responded_at  = now(),
          updated_at    = now()
      WHERE id        = ${id}::uuid
        AND tenant_id = ${tenantId}
        AND status   != 'DISPOSED'
      RETURNING id, status,
                responded_at  AS "respondedAt",
                response_text AS "responseText",
                updated_at    AS "updatedAt"
    `)) as unknown as RtiRow[];
    if (!rows[0]) return null;
    await recordStatusHistory(tx, {
      tenantId,
      resourceType: "rti_request",
      resourceId: id,
      fromStatus: prev[0]?.status ?? null,
      toStatus: "RESPONDED",
      note: responseText,
      actorId,
    });
    // GAP2-CRM-RTI-AUDIT-03: a statutory response is exactly what an RTI audit
    // needs. Payload carries NO response text (that can contain PII).
    await emitWithAudit(tx, ctx, {
      eventType: EVENTS.rtiResponded,
      action: "respond",
      resourceType: "rti_request",
      resourceId: id,
      payload: { rtiId: id, status: "RESPONDED" },
    });
    return rows[0];
  });
}

/** s.19 RTI Act — first-appeal within 30 days of response. */
export async function firstAppeal(
  ctx: AuditCtx,
  id: string,
): Promise<RtiRow | null> {
  const tenantId = ctx.tenantId;
  const actorId = ctx.actorId;
  return scopedRead(async (tx) => {
    const prev = (await tx.execute(sql`
      SELECT status FROM crm.rti_requests WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
    `)) as unknown as Array<{ status: string }>;
    const rows = (await tx.execute(sql`
      UPDATE crm.rti_requests
      SET status              = 'FIRST_APPEAL',
          first_appeal_due_at = COALESCE(responded_at, now()) + interval '30 days',
          updated_at          = now()
      WHERE id        = ${id}::uuid
        AND tenant_id = ${tenantId}
        AND status IN ('RESPONDED', 'REJECTED')
      RETURNING id, status,
                first_appeal_due_at AS "firstAppealDueAt",
                updated_at          AS "updatedAt"
    `)) as unknown as RtiRow[];
    if (!rows[0]) return null;
    await recordStatusHistory(tx, {
      tenantId,
      resourceType: "rti_request",
      resourceId: id,
      fromStatus: prev[0]?.status ?? null,
      toStatus: "FIRST_APPEAL",
      note: null,
      actorId,
    });
    // GAP2-CRM-RTI-AUDIT-03: filing a first appeal is a statutory transition.
    await emitWithAudit(tx, ctx, {
      eventType: EVENTS.rtiFirstAppealed,
      action: "first_appeal",
      resourceType: "rti_request",
      resourceId: id,
      payload: { rtiId: id, status: "FIRST_APPEAL" },
    });
    return rows[0];
  });
}

// ---------------------------------------------------------------------------
// GAP-CRM-RTI-DETAIL-01: appeal chain (FAA decision -> second appeal -> disposal)
//
// Each transition is a guarded UPDATE (the WHERE clause is the state machine:
// zero rows updated means the request is not in a state that allows it) and
// emits its domain + audit event in the SAME transaction, so the statutory
// trail commits or rolls back with the row. Event payloads carry no PII.
// ---------------------------------------------------------------------------

export const FIRST_APPEAL_OUTCOMES = ["allowed", "partly_allowed", "dismissed"] as const;
export type FirstAppealOutcome = (typeof FIRST_APPEAL_OUTCOMES)[number];

type AuditCtx = Parameters<typeof emitWithAudit>[1];

async function transition(
  ctx: AuditCtx,
  id: string,
  action: string,
  eventType: string,
  update: SQL,
  extraPayload: Record<string, unknown> = {},
  note: string | null = null,
): Promise<RtiRow | null> {
  return scopedRead(async (tx) => {
    // Capture the pre-transition status for the timeline (F6-01), inside the
    // same tx as the guarded UPDATE.
    const prevRows = (await tx.execute(sql`
      SELECT status FROM crm.rti_requests
      WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}
    `)) as unknown as Array<{ status: string }>;
    const fromStatus = prevRows[0]?.status ?? null;

    const rows = (await tx.execute(update)) as unknown as RtiRow[];
    const row = rows[0];
    if (!row) return null;
    await emitWithAudit(tx, ctx, {
      eventType,
      action,
      resourceType: "rti_request",
      resourceId: id,
      payload: { rtiId: id, status: row["status"], ...extraPayload },
    });
    // F6-01: record the transition in the shared timeline, same tx.
    await recordStatusHistory(tx, {
      tenantId: ctx.tenantId,
      resourceType: "rti_request",
      resourceId: id,
      fromStatus,
      toStatus: String(row["status"]),
      note,
      actorId: ctx.actorId,
    });
    return row;
  });
}

/** s.19(1)/(6): record the First Appellate Authority's order. Once only. */
export function decideFirstAppeal(
  ctx: AuditCtx,
  id: string,
  outcome: FirstAppealOutcome,
  orderText: string,
): Promise<RtiRow | null> {
  return transition(
    ctx,
    id,
    "decide_first_appeal",
    EVENTS.rtiFirstAppealDecided,
    sql`
      UPDATE crm.rti_requests
      SET first_appeal_order      = ${orderText},
          first_appeal_outcome    = ${outcome},
          first_appeal_decided_at = now(),
          first_appeal_decided_by = ${ctx.actorId}::uuid,
          updated_at              = now()
      WHERE id        = ${id}::uuid
        AND tenant_id = ${ctx.tenantId}
        AND status    = 'FIRST_APPEAL'
        AND first_appeal_decided_at IS NULL
      RETURNING id, status,
                first_appeal_outcome    AS "firstAppealOutcome",
                first_appeal_decided_at AS "firstAppealDecidedAt",
                updated_at              AS "updatedAt"
    `,
    { outcome },
    `First appeal decided (${outcome}): ${orderText}`,
  );
}

/**
 * s.19(3): record that a second appeal has been filed with the Information
 * Commission. Lies against the FAA's decision OR its failure to decide, so it
 * is allowed from FIRST_APPEAL whether or not a decision is on record.
 */
export function recordSecondAppeal(
  ctx: AuditCtx,
  id: string,
  ref: string,
): Promise<RtiRow | null> {
  return transition(
    ctx,
    id,
    "record_second_appeal",
    EVENTS.rtiSecondAppealRecorded,
    sql`
      UPDATE crm.rti_requests
      SET status            = 'SECOND_APPEAL',
          second_appeal_at  = now(),
          second_appeal_ref = ${ref},
          updated_at        = now()
      WHERE id        = ${id}::uuid
        AND tenant_id = ${ctx.tenantId}
        AND status    = 'FIRST_APPEAL'
      RETURNING id, status,
                second_appeal_at AS "secondAppealAt",
                updated_at       AS "updatedAt"
    `,
    {},
    `Second appeal filed: ${ref}`,
  );
}

/**
 * Close the request. Allowed once the FAA has decided (and no second appeal
 * followed) or after a second appeal. An undecided first appeal cannot be
 * disposed — that would close a statutory appeal with no order on record.
 */
export function disposeRti(
  ctx: AuditCtx,
  id: string,
  reason: string,
): Promise<RtiRow | null> {
  return transition(
    ctx,
    id,
    "dispose",
    EVENTS.rtiDisposed,
    sql`
      UPDATE crm.rti_requests
      SET status          = 'DISPOSED',
          disposed_at     = now(),
          disposal_reason = ${reason},
          disposed_by     = ${ctx.actorId}::uuid,
          updated_at      = now()
      WHERE id        = ${id}::uuid
        AND tenant_id = ${ctx.tenantId}
        AND (status = 'SECOND_APPEAL'
             OR (status = 'FIRST_APPEAL' AND first_appeal_decided_at IS NOT NULL))
      RETURNING id, status,
                disposed_at AS "disposedAt",
                updated_at  AS "updatedAt"
    `,
    {},
    reason,
  );
}

/**
 * F6-01: ordered status timeline for one RTI request (oldest first). Reads the
 * shared crm.case_status_history table via the shared helper.
 */
export function getRtiHistory(tenantId: string, id: string) {
  return listStatusHistory(tenantId, "rti_request", id);
}

/**
 * RTI Act 2005 — database access layer.
 *
 * All mutations go through scopedRead (GUC-scoped connection, RLS enforced).
 * The calling route is responsible for extracting tenantId / actorId from ctx.
 */
import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";

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
  referenceNo: string;
  section: string;
  departmentRef: string;
  applicantName: string;
  applicantContact?: string;
  subject: string;
  description: string;
  feePaid?: boolean;
  feeAmount?: number;
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
             r.fee_paid            AS "feePaid",
             r.fee_amount          AS "feeAmount",
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
             r.fee_paid            AS "feePaid",
             r.fee_amount          AS "feeAmount",
             r.received_at         AS "receivedAt",
             r.due_at              AS "dueAt",
             r.first_appeal_due_at AS "firstAppealDueAt",
             r.responded_at        AS "respondedAt",
             r.response_text       AS "responseText",
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

export async function createRti(data: RtiCreateData): Promise<RtiRow> {
  const rows = (await scopedRead((tx) =>
    tx.execute(sql`
      INSERT INTO crm.rti_requests (
        tenant_id, reference_no, section, department_ref,
        applicant_name, applicant_contact,
        subject, description,
        fee_paid, fee_amount, created_by
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
        ${data.feeAmount ?? null},
        ${data.actorId}::uuid
      )
      RETURNING id,
                reference_no   AS "referenceNo",
                section,
                department_ref AS "departmentRef",
                applicant_name AS "applicantName",
                subject,
                status,
                received_at    AS "receivedAt",
                due_at         AS "dueAt",
                created_at     AS "createdAt"
    `),
  )) as unknown as RtiRow[];

  return rows[0]!;
}

export async function forwardRti(
  tenantId: string,
  _actorId: string,
  id: string,
  departmentRef: string,
): Promise<RtiRow | null> {
  const rows = (await scopedRead((tx) =>
    tx.execute(sql`
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
    `),
  )) as unknown as RtiRow[];

  return rows[0] ?? null;
}

export async function respondRti(
  tenantId: string,
  _actorId: string,
  id: string,
  responseText: string,
): Promise<RtiRow | null> {
  const rows = (await scopedRead((tx) =>
    tx.execute(sql`
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
    `),
  )) as unknown as RtiRow[];

  return rows[0] ?? null;
}

/** s.19 RTI Act — first-appeal within 30 days of response. */
export async function firstAppeal(
  tenantId: string,
  _actorId: string,
  id: string,
): Promise<RtiRow | null> {
  const rows = (await scopedRead((tx) =>
    tx.execute(sql`
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
    `),
  )) as unknown as RtiRow[];

  return rows[0] ?? null;
}

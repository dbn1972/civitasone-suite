/**
 * Tenant slip letterhead (GAP-PAYROLL-SALARY-SLIPS-DETAIL-02).
 *
 *   GET /v1/payroll/letterhead   the issuing organisation printed on salary slips
 *   PUT /v1/payroll/letterhead   set/replace it (payroll_admin / super_admin)
 *
 * A salary slip is a legal-looking document: the authority printed on it must
 * be the tenant's own, never a platform default. No row means the slip prints
 * no authority line (it never invents one). The write is CQRS: validate here,
 * publish the command, the consumer upserts + audits in one transaction.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

/** Same readers as the slip detail endpoint: anyone who can open a slip can see its letterhead. */
const READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer", "employee"];
const WRITER_ROLES = ["payroll_admin", "super_admin"];

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const letterheadBody = z.object({
  orgName: z.string().trim().min(1).max(160),
  department: optionalText(160),
  ddoName: optionalText(160),
  ddoCode: optionalText(32),
  address: optionalText(400),
  signatoryTitle: optionalText(120),
  showSignatureBlock: z.boolean().default(false),
}).strict();
export type LetterheadInput = z.infer<typeof letterheadBody>;

export type Letterhead = LetterheadInput & { version: number; updatedAt: string };

type Row = {
  org_name: string; department: string | null; ddo_name: string | null; ddo_code: string | null;
  address: string | null; signatory_title: string | null; show_signature_block: boolean;
  version: number; updated_at: Date | string;
};

export function serializeLetterhead(r: Row): Letterhead {
  return {
    orgName: r.org_name, department: r.department, ddoName: r.ddo_name, ddoCode: r.ddo_code,
    address: r.address, signatoryTitle: r.signatory_title, showSignatureBlock: r.show_signature_block,
    version: r.version, updatedAt: (r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at)).toISOString(),
  };
}

/** Shared with the payslip PDF so the HTML print and the PDF name the same issuer. */
export async function loadLetterhead(tenantId: string): Promise<Letterhead | null> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT org_name, department, ddo_name, ddo_code, address, signatory_title, show_signature_block, version, updated_at
      FROM payroll.payroll_letterhead WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `))) as unknown as Row[];
  return rows[0] ? serializeLetterhead(rows[0]) : null;
}

export async function requestLetterheadUpsert(ctx: RequestContext, body: LetterheadInput) {
  const id = randomUUID();
  await queue.publish(COMMANDS.letterheadUpsert, {
    messageId: id, type: COMMANDS.letterheadUpsert,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function letterheadRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/letterhead", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send({ data: await loadLetterhead(ctx.tenantId) });
  });

  app.put("/v1/payroll/letterhead", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const body = letterheadBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await requestLetterheadUpsert(ctx, body));
  });
}

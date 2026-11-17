/**
 * Section 8 NF-1: fund master routes. Every route answers 404 FUNDS_NOT_ENABLED unless gl.finance_settings.fund_accounting is
 * ON for the tenant, so a govt tenant sees no funds API at all (design contract #4). Registered by app.ts; nothing turns the
 * flag on before NF-8.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { DomainError } from "../approvals/domain.js";
import { loadPostingSettingsTx } from "../approvals/posting-settings.js";
import { funds, FUND_TYPES } from "./schema.js";
import { zIsoDate } from "@civitasone/schemas/validators";
import { postingDateWindow } from "./validators.js";
import { FUND_HEADS, assertFundHeadsPresentTx, fundBalanceTx, GENERAL_FUND_CODE } from "./funds.js";
import { createFundMove, type FundMoveKind } from "./fund-commands.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
const MAKER_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const ADMIN_ROLES = ["finance_admin", "super_admin"];

const createFundBody = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[A-Z0-9][A-Z0-9_-]*$/, "use upper-case letters, digits, - or _"),
  name: z.string().trim().min(1).max(200),
  type: z.enum(FUND_TYPES),
  fcra: z.boolean().default(false),
  sourceCondition: z.string().trim().max(1000).optional(),
});
const fundMoveBody = z.object({
  fromFundId: z.string().uuid(), toFundId: z.string().uuid(),
  amountMinor: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform((v) => BigInt(v)),
  postingDate: zIsoDate({ window: postingDateWindow, label: "posting date" }),
  narration: z.string().trim().max(500).optional(),
});

export async function fundRoutes(app: FastifyInstance): Promise<void> {
  const requireEnabled = async (tenantId: string): Promise<void> => {
    const ps = await scopedRead((tx) => loadPostingSettingsTx(tx, tenantId));
    if (!ps.fundAccounting) throw new HttpError(404, "FUNDS_NOT_ENABLED", "fund accounting is not enabled for this tenant");
  };

  app.get("/v1/finance/funds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    await requireEnabled(ctx.tenantId);
    const rows = await scopedRead((tx) => tx.select().from(funds).where(eq(funds.tenantId, ctx.tenantId)).orderBy(asc(funds.code)));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/funds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    await requireEnabled(ctx.tenantId);
    const body = createFundBody.parse(req.body);
    if (body.code === GENERAL_FUND_CODE) throw new HttpError(409, "FUND_CODE_RESERVED", "GENERAL is created automatically");
    const [row] = await db.transaction(async (tx) => {
      const inserted = await tx.insert(funds).values({
        tenantId: ctx.tenantId, code: body.code, name: body.name, type: body.type, fcra: body.fcra,
        sourceCondition: body.sourceCondition ?? null, createdBy: ctx.actorId, updatedBy: ctx.actorId,
      }).onConflictDoNothing({ target: [funds.tenantId, funds.code] }).returning();
      if (inserted.length > 0) {
        await enqueue(tx, {
          topic: "audit.event.record", eventType: "audit.event.record",
          tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
          payload: { service: "finance", action: "create_fund", resourceType: "fund", resourceId: inserted[0]!.id, outcome: "success", code: body.code, type: body.type, fcra: body.fcra },
        });
      }
      return inserted;
    });
    if (!row) throw new HttpError(409, "FUND_CODE_EXISTS", `a fund with code ${body.code} already exists`);
    return reply.code(201).send({ data: row });
  });

  app.get("/v1/finance/funds/:id/balance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    await requireEnabled(ctx.tenantId);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const out = await scopedRead(async (tx) => {
      const [f] = await tx.select().from(funds).where(and(eq(funds.tenantId, ctx.tenantId), eq(funds.id, id))).limit(1);
      return f ? { fund: f, balanceMinor: (await fundBalanceTx(tx, ctx.tenantId, id)).toString() } : null;
    });
    if (!out) throw new HttpError(404, "NOT_FOUND", "fund not found");
    return reply.send({ data: out });
  });

  const move = (path: string, kind: FundMoveKind, heads: readonly string[]) =>
    app.post(path, { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, MAKER_ROLES);
      await requireEnabled(ctx.tenantId);
      const body = fundMoveBody.parse(req.body);
      try {
        await scopedRead(async (tx) => {
          await assertFundHeadsPresentTx(tx, ctx.tenantId, [...heads, FUND_HEADS.dueTo, FUND_HEADS.dueFrom]);
          const found = await tx.select().from(funds).where(and(eq(funds.tenantId, ctx.tenantId)));
          const from = found.find((f) => f.id === body.fromFundId); const to = found.find((f) => f.id === body.toFundId);
          if (!from || !to) throw new DomainError("FUND_NOT_FOUND", "source or destination fund does not exist");
          if (from.status !== "active" || to.status !== "active") throw new DomainError("FUND_CLOSED", "both funds must be active");
          if (kind === "fund_release" && from.type !== "restricted") throw new DomainError("FUND_RELEASE_SOURCE", "only a restricted fund can be released from restriction");
          if (from.fcra !== to.fcra) throw new DomainError("FUND_FCRA_BOUNDARY", "foreign-contribution money cannot cross the FCRA boundary by transfer");
        });
        return sendAccepted(reply, acceptedResponseSchema, await createFundMove(ctx, kind, { ...body }));
      } catch (err) {
        if (err instanceof DomainError) throw new HttpError(422, err.code, err.message);
        throw err;
      }
    });
  move("/v1/finance/funds/transfers", "fund_transfer", [FUND_HEADS.transferOut, FUND_HEADS.transferIn]);
  move("/v1/finance/funds/releases", "fund_release", [FUND_HEADS.releaseOut, FUND_HEADS.releaseIn]);

  app.setErrorHandler(financeErrorHandler);
}

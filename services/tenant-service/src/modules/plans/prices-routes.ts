/**
 * M6 routes: a plan's catalogue modules, the price store, and a quote (GST shown separately).
 * Writes return 202 (command -> consumer). Reads are platform/tenant admin only, like the plan catalogue itself.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolvePlanModules, PlanModuleError } from "@civitasone/schemas/plan-modules";
import { quote, planPriceInsert, PriceError } from "@civitasone/schemas/plan-pricing";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as prices from "./prices.js";
import * as commands from "./commands.js";
import { planIdParam, setPriceBody, billingCycleValues } from "./validators.js";

const PLATFORM_ADMIN = ["platform_admin", "super_admin"];
const PLAN_READ = ["platform_admin", "super_admin", "tenant_admin"];

const priceListQuery = z.object({ kind: z.enum(["plan", "addon"]).optional(), key: z.string().min(1).max(64).optional() });
const quoteQuery = z.object({
  cycle: z.enum(billingCycleValues).default("annual"),
  addons: z.string().max(2000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const money = (n: bigint): string => n.toString();

export async function planPriceRoutes(app: FastifyInstance): Promise<void> {
  // The catalogue modules a plan is sold as, resolved with hard dependencies. Read-only: applying them is the
  // admin-service maker-checker flow (POST /v1/admin/composition/plan-applications).
  app.get("/v1/plans/:planId/modules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLAN_READ);
    const { planId } = planIdParam.parse(req.params);
    const plan = await repo.findByIdScoped(ctx.tenantId, planId);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "plan not found");
    try {
      const r = resolvePlanModules({ catalogueModules: plan.catalogueModules, enabledModules: plan.enabledModules });
      return reply.send({ planId: plan.id, planCode: plan.code, ...r });
    } catch (err) {
      if (err instanceof PlanModuleError) throw new HttpError(422, err.code, err.message);
      throw err;
    }
  });

  app.get("/v1/plans/prices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLAN_READ);
    const q = priceListQuery.parse(req.query);
    const rows = await prices.listPrices(ctx.tenantId, q);
    return reply.send({ currency: "INR", unit: "paise", gst: "separate", prices: rows.map((r) => ({ ...r, amountMinor: money(r.amountMinor) })) });
  });

  app.post("/v1/plans/prices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const body = setPriceBody.parse(req.body);
    if (body.subjectKind === "plan") {
      const all = await repo.findAllScoped(ctx.tenantId);
      if (!all.some((p) => p.code === body.subjectKey)) throw new HttpError(404, "NOT_FOUND", `plan ${body.subjectKey} not found`);
    }
    // Early, friendly rejection; the consumer re-checks against the stored rows inside its transaction.
    try {
      const existing = await prices.listPrices(ctx.tenantId, { kind: body.subjectKind, key: body.subjectKey });
      planPriceInsert(existing.filter((r) => r.billingCycle === body.billingCycle), {
        subjectKind: body.subjectKind, subjectKey: body.subjectKey, billingCycle: body.billingCycle,
        amountMinor: BigInt(body.amountMinor), gstRateBps: body.gstRateBps, effectiveFrom: body.effectiveFrom, effectiveTo: null,
      });
    } catch (err) {
      if (err instanceof PriceError) throw new HttpError(409, err.code, err.message);
      throw err;
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.priceSet(ctx, body));
  });

  app.get("/v1/plans/:planId/quote", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLAN_READ);
    const { planId } = planIdParam.parse(req.params);
    const q = quoteQuery.parse(req.query);
    const plan = await repo.findByIdScoped(ctx.tenantId, planId);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "plan not found");
    try {
      const mods = resolvePlanModules({ catalogueModules: plan.catalogueModules, enabledModules: plan.enabledModules });
      const rows = await prices.listPrices(ctx.tenantId);
      const out = quote({
        rows, planCode: plan.code, planModuleIds: mods.moduleIds,
        addonModuleIds: q.addons ? q.addons.split(",").map((s) => s.trim()).filter(Boolean) : [],
        billingCycle: q.cycle, onDate: q.date ?? new Date().toISOString().slice(0, 10),
      });
      const split = (s: { netMinor: bigint; gstMinor: bigint; grossMinor: bigint }) => ({ netMinor: money(s.netMinor), gstMinor: money(s.gstMinor), grossMinor: money(s.grossMinor) });
      return reply.send({
        currency: out.currency, unit: "paise", onDate: out.onDate, billingCycle: out.billingCycle, planCode: plan.code,
        lines: out.lines.map((l) => ({ kind: l.kind, key: l.key, gstRateBps: l.gstRateBps, effectiveFrom: l.effectiveFrom, ...split(l) })),
        totals: split(out.totals),
      });
    } catch (err) {
      if (err instanceof PriceError) throw new HttpError(err.code === "PRICE_NOT_FOUND" ? 404 : 409, err.code, err.message);
      if (err instanceof PlanModuleError) throw new HttpError(422, err.code, err.message);
      throw err;
    }
  });
}

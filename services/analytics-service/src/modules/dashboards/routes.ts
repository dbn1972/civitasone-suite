import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { registerErrorHandler } from "../../shared/errors.js";
import {
  dashboardsListSchema,
  dashboardDetailSchema,
  createDashboardBody,
  updateDashboardBody,
  addWidgetBody,
  shareDashboardBody,
  idParam,
} from "./validators.js";
import * as queries from "./queries.js";
import * as commands from "./commands.js";

const READ_ROLES = ["analytics_user", "analytics_admin", "report_admin", "report_viewer", "super_admin", "tenant_admin"];
const WRITE_ROLES = ["analytics_user", "analytics_admin", "report_admin", "super_admin", "tenant_admin"];

// SEC-013: EMBED_SECRET used to fall back unconditionally to a hardcoded,
// source-visible literal (the same value ecosystem.config.js uses as
// JWT_SECRET's own dev/test convenience default, see ecosystem.config.js /
// SEC-017) whenever JWT_SECRET was unset, in EVERY environment including
// production. The embed *route* has no real consumer today (nothing verifies
// an /embed/dashboards/:id token yet), but minting is live and reachable by
// any authenticated analytics reader -- and since ecosystem.config.js
// deliberately leaves JWT_SECRET undefined in real production (RS256/
// Keycloak is the real auth path; JWT_SECRET only matters for the HS256
// dev/test convenience path, see packages/auth SEC-017), a real production
// deployment hit the fallback literal on every call. If a verifying consumer
// is ever wired up, that's a token signed with a secret visible in the
// public source.
//
// Mirrors resolveCandSecret() (hrms-service candidate-public-auth-routes.ts,
// SEC-003) and isProduction() (packages/auth/src/index.ts, SEC-017):
// ALLOW-LIST, not deny-list -- only a process explicitly declared
// NODE_ENV=development or NODE_ENV=test gets the convenience fallback;
// everything else (unset, staging, uat, qa, a typo, real production) must
// have JWT_SECRET configured or this endpoint refuses the request.
//
// Deliberately NOT resolved at module load (unlike resolveCandSecret/
// resolveQrSecret): JWT_SECRET is intentionally absent in real production
// (ecosystem.config.js sets it to undefined there), so requiring it at
// analytics-service *startup* would take down the whole service in the
// normal, correctly-configured production case. The check instead runs when
// this specific route is actually invoked, so only a caller who exercises
// this currently-unused embed feature is affected.
//
// Follow-up (CI Secret Scan): the dev/test convenience value itself used to
// be a literal string sitting right here in committed source, which is
// exactly what .github/workflows/ci.yml's "Scan for known dev secrets in
// source" job greps for -- it flags a hardcoded secret's mere presence
// regardless of the ALLOW-LIST gate around it, which is correct scanner
// behavior (a real secret manager value should never be able to collide with
// a value sitting in public source). The value now lives only in
// ANALYTICS_EMBED_DEV_SECRET (documented in .env.example, which that job
// deliberately excludes from its search), never in application code.
const EMBED_SECRET_FALLBACK_ALLOWED_ENVS = new Set(["development", "test"]);

/** Exported for the SEC-013 regression test (dashboards-embed-secret.test.ts). */
export function resolveEmbedSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (configured && configured.length > 0) {
    return configured;
  }
  const nodeEnv = process.env.NODE_ENV;
  if (!EMBED_SECRET_FALLBACK_ALLOWED_ENVS.has(nodeEnv ?? "")) {
    throw new HttpError(
      500,
      "CONFIG_MISSING",
      `SEC-013: JWT_SECRET is required to mint dashboard embed tokens outside a declared ` +
        `development/test environment (NODE_ENV was ${JSON.stringify(nodeEnv ?? null)}). ` +
        `Inject it from the secret manager (do not hardcode).`,
    );
  }
  const devFallback = process.env.ANALYTICS_EMBED_DEV_SECRET;
  if (devFallback && devFallback.length > 0) {
    return devFallback;
  }
  throw new HttpError(
    500,
    "CONFIG_MISSING",
    `SEC-013: neither JWT_SECRET nor ANALYTICS_EMBED_DEV_SECRET is set. Set ` +
      `ANALYTICS_EMBED_DEV_SECRET in your local env (see .env.example) to exercise ` +
      `the embed route in development/test.`,
  );
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/analytics/dashboards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, dashboardsListSchema, await queries.listDashboards(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/analytics/dashboards/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getDashboardDetail(ctx, id);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "dashboard not found");
    sendValidated(reply, dashboardDetailSchema, detail);
  });

  app.post("/v1/analytics/dashboards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createDashboardBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.createDashboard(ctx, body));
  });

  app.patch("/v1/analytics/dashboards/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateDashboardBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.updateDashboard(ctx, id, body));
  });

  app.post("/v1/analytics/dashboards/:id/widgets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = addWidgetBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.addWidget(ctx, id, body));
  });

  app.post("/v1/analytics/dashboards/:id/shares", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = shareDashboardBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.shareDashboard(ctx, id, body));
  });


  app.delete("/v1/analytics/dashboards/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    sendAccepted(reply, acceptedResponseSchema, await commands.deleteDashboard(ctx, id));
  });

  app.get("/v1/analytics/dashboards/:id/embed", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getDashboardDetail(ctx, id);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "dashboard not found");
    const EMBED_SECRET = resolveEmbedSecret();
    const payload = { tenantId: ctx.tenantId, dashboardId: id, exp: Math.floor(Date.now() / 1000) + 3600 };
    const hdr = Buffer.from(JSON.stringify({ alg: "HS256", typ: "embed" })).toString("base64url");
    const pay = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", EMBED_SECRET).update(`${hdr}.${pay}`).digest("base64url");
    const token = `${hdr}.${pay}.${sig}`;
    return reply.send({ data: { embedUrl: "/embed/dashboards/" + id + "?token=" + token, expiresIn: 3600 } });
  });

  registerErrorHandler(app);
}

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import cors from "@fastify/cors";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { randomUUID } from "node:crypto";
import { resolveRoute } from "./registry.js";

const FORWARD_HEADERS = [
  "authorization",
  "content-type",
  "accept",
  "x-correlation-id",
  "x-device-id",
  "x-device-trust-token",
  "x-step-up-token",
  "x-tenant-id",
] as const;

async function proxyHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const pathname = req.url.split("?")[0] ?? "/";
  const resolved = resolveRoute(pathname);
  if (!resolved) {
    return reply.code(404).send({ code: "NOT_FOUND", message: "no upstream for path" });
  }

  const { route, remainder } = resolved;
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const basePath = route.upstreamPath ?? route.prefix.replace(/^\/api/, "");
  const targetUrl = `${route.upstream}${basePath}${remainder}${query}`;

  const headers: Record<string, string> = {};
  for (const h of FORWARD_HEADERS) {
    const v = req.headers[h];
    if (typeof v === "string") headers[h] = v;
  }
  if (!headers["x-correlation-id"]) headers["x-correlation-id"] = req.id;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const init: RequestInit = { method: req.method, headers };
  if (hasBody) init.body = JSON.stringify(req.body ?? {});
  const upstream = await fetch(targetUrl, init);

  reply.code(upstream.status);
  const ct = upstream.headers.get("content-type");
  if (ct) reply.header("content-type", ct);
  return reply.send(await upstream.text());
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, {
    origin: (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(","),
    credentials: true,
    allowedHeaders: ["content-type", "authorization", "x-correlation-id", "x-device-id", "x-device-trust-token", "x-step-up-token"],
  });

  registerOpsRoutes(app, { service: "gateway-service" });


  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.route({ method: ["GET", "POST", "PUT", "PATCH", "DELETE"], url: "/api/*", handler: proxyHandler });

  registerSchemaErrorHandler(app);

  return app;
}

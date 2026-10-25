/**
 * Helpers for the PUBLIC server-to-server payment-gateway webhooks
 * (POST /v1/billing/webhooks/{razorpay,payu,ccavenue}).
 *
 * These routes are `config.public` (no bearer token exists on a gateway callback), so the
 * provider-specific signature / hash check in each handler is the ONLY authentication.
 */
import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "../../shared/context.js";

/** Hard cap on an anonymous webhook body (matches the app-level bodyLimit of 1 MiB). */
export const WEBHOOK_MAX_BODY_BYTES = 1_048_576;

export type RawBodyRequest = FastifyRequest & { rawBody?: string };

/**
 * Fastify `preParsing` hook: buffer the request bytes exactly as received, keep them on
 * `req.rawBody` (HMAC signatures are computed over the raw bytes, never over a re-serialised
 * parse), then hand an identical stream on to the normal body parser.
 */
export async function captureRawBody(
  req: FastifyRequest,
  _reply: FastifyReply,
  payload: NodeJS.ReadableStream,
): Promise<NodeJS.ReadableStream> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > WEBHOOK_MAX_BODY_BYTES) {
    (payload as { destroy?: () => void }).destroy?.();
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "webhook body too large");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of payload) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    // Enforce the cap while streaming (chunked bodies have no content-length): never buffer past it.
    if (total > WEBHOOK_MAX_BODY_BYTES) {
      (payload as { destroy?: () => void }).destroy?.();
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "webhook body too large");
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks);
  (req as RawBodyRequest).rawBody = raw.toString("utf8");
  const replay = new Readable({ read() {} });
  replay.push(raw);
  replay.push(null);
  return replay;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tenant a (signature-verified) Razorpay payment event belongs to: the `notes.tenantId` we set when
 * the order was created. Falls back to "system" when absent / not a UUID. The queue consumer runs
 * inside the message tenant context, so a real tenant id here is what lets its FORCE-RLS writes land.
 */
export function razorpayEventTenant(payload: unknown): string {
  const entity = (((payload as Record<string, unknown> | null)?.["payload"] as Record<string, unknown> | undefined)
    ?.["payment"] as Record<string, unknown> | undefined)?.["entity"] as Record<string, unknown> | undefined;
  const t = (entity?.["notes"] as Record<string, unknown> | undefined)?.["tenantId"];
  return typeof t === "string" && UUID_RE.test(t) ? t : "system";
}

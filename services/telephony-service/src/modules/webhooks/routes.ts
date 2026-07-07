/**
 * Carrier webhook routes — receives inbound call notifications and status updates
 * from Twilio/Exotel and converts them into internal telephony commands.
 *
 * Authenticated via carrier-specific signature validation:
 *   - Twilio: X-Twilio-Signature HMAC-SHA1 over URL + sorted POST params
 *   - Exotel: X-Exotel-Token bearer token comparison
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { pino } from "pino";
import { validateTwilioSignature, validateExotelToken } from "./domain.js";
import { resolveTenant, DEFAULT_TENANT_ID } from "../did/domain.js";
import { loadActiveMappings } from "../did/queries.js";

const log = pino({ name: "telephony-webhooks" });

// Tenant resolution for inbound calls: resolve the dialed number to a tenant
// via DID mapping lookup. Falls back to DEFAULT_TENANT_ID if no mapping found.

// ── Webhook signature validation ──────────────────────────────────

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const EXOTEL_WEBHOOK_TOKEN = process.env.EXOTEL_WEBHOOK_TOKEN ?? "";

/**
 * Validate Twilio X-Twilio-Signature using the domain pure function.
 */
function checkTwilioSignature(req: FastifyRequest): boolean {
  const sig = req.headers["x-twilio-signature"] as string | undefined;
  if (!sig) return false;

  const url = `${process.env.CARRIER_WEBHOOK_BASE ?? "https://api.civitasone.in"}${req.url.split("?")[0]}`;
  const params = (req.body ?? {}) as Record<string, string>;
  return validateTwilioSignature(url, params, sig, TWILIO_AUTH_TOKEN);
}

/**
 * Validate Exotel webhook token using the domain pure function.
 */
function checkExotelSignature(req: FastifyRequest): boolean {
  const token = (req.headers["x-exotel-token"] ?? req.headers["authorization"]?.replace("Bearer ", "")) as string | undefined;
  if (!token) return false;
  return validateExotelToken(token, EXOTEL_WEBHOOK_TOKEN);
}

function rejectUnauthorized(reply: FastifyReply): void {
  reply.code(401).send({ code: "WEBHOOK_UNAUTHORIZED", message: "Invalid or missing webhook signature" });
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Resolve the tenant for an inbound call using DID mappings.
   * Loads active mappings from cache/DB and matches calleeNumber.
   */
  async function resolveCallTenant(calleeNumber: string): Promise<string> {
    const mappings = await loadActiveMappings();
    return resolveTenant(calleeNumber, mappings, DEFAULT_TENANT_ID);
  }

  /** Twilio inbound voice webhook — new incoming call */
  app.post("/v1/telephony/webhooks/twilio/inbound", { config: { public: true } }, async (req, reply) => {
    if (!checkTwilioSignature(req)) { rejectUnauthorized(reply); return; }
    const body = req.body as Record<string, string>;
    const callSid = body["CallSid"] ?? randomUUID();
    const from = body["From"] ?? "";
    const to = body["To"] ?? "";

    log.info({ callSid, from, to }, "twilio inbound call");

    // Resolve dialed number → tenant via DID mapping
    const tenantId = await resolveCallTenant(to);

    // Publish create-call command
    await queue.publish(COMMANDS.createCall, {
      messageId: callSid,
      type: COMMANDS.createCall,
      tenantId,
      actorId: "system",
      correlationId: callSid,
      schemaVersion: "1.0",
      payload: {
        id: randomUUID(),
        tenantId,
        direction: "inbound",
        callerNumber: from,
        calleeNumber: to,
        carrierCallId: callSid,
        carrier: "twilio",
      },
    });

    // Respond with TwiML to route call to queue
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Welcome to CivitasOne. Please hold while we connect you.</Say>
  <Enqueue>default</Enqueue>
</Response>`;
    return reply.header("Content-Type", "application/xml").send(twiml);
  });

  /** Twilio status callback — call status changes */
  app.post("/v1/telephony/webhooks/twilio/status", { config: { public: true } }, async (req, reply) => {
    if (!checkTwilioSignature(req)) { rejectUnauthorized(reply); return; }
    const body = req.body as Record<string, string>;
    const callSid = body["CallSid"] ?? "";
    const status = body["CallStatus"] ?? "";
    const duration = body["CallDuration"] ?? "0";
    const to = body["To"] ?? "";

    log.info({ callSid, status, duration }, "twilio status callback");

    if (status === "completed" || status === "busy" || status === "failed" || status === "no-answer") {
      // Resolve tenant from the dialed number on the callback
      const tenantId = to ? await resolveCallTenant(to) : DEFAULT_TENANT_ID;

      await queue.publish(COMMANDS.completeCall, {
        messageId: randomUUID(),
        type: COMMANDS.completeCall,
        tenantId,
        actorId: "system",
        correlationId: callSid,
        schemaVersion: "1.0",
        payload: {
          id: callSid, // Will be resolved by consumer via carrierCallId lookup
          tenantId,
          outcome: status === "completed" ? "completed" : "missed",
        },
      });
    }

    return reply.code(204).send();
  });

  /** Twilio recording callback — recording ready */
  app.post("/v1/telephony/webhooks/twilio/recording", { config: { public: true } }, async (req, reply) => {
    if (!checkTwilioSignature(req)) { rejectUnauthorized(reply); return; }
    const body = req.body as Record<string, string>;
    const callSid = body["CallSid"] ?? "";
    const recordingSid = body["RecordingSid"] ?? "";
    const recordingUrl = body["RecordingUrl"] ?? "";
    const duration = body["RecordingDuration"] ?? "0";
    const to = body["To"] ?? "";

    log.info({ callSid, recordingSid, duration }, "twilio recording ready");

    // Resolve tenant from the dialed number on the callback
    const tenantId = to ? await resolveCallTenant(to) : DEFAULT_TENANT_ID;

    await queue.publish(COMMANDS.attachRecording, {
      messageId: randomUUID(),
      type: COMMANDS.attachRecording,
      tenantId,
      actorId: "system",
      correlationId: callSid,
      schemaVersion: "1.0",
      payload: {
        id: callSid,
        tenantId,
        recordingId: recordingSid,
        recordingUrl: `${recordingUrl}.mp3`,
        durationSec: Number(duration),
        format: "mp3",
      },
    });

    return reply.code(204).send();
  });

  /** Exotel inbound webhook */
  app.post("/v1/telephony/webhooks/exotel/inbound", { config: { public: true } }, async (req, reply) => {
    if (!checkExotelSignature(req)) { rejectUnauthorized(reply); return; }
    const body = req.body as Record<string, string>;
    const callSid = body["CallSid"] ?? body["Sid"] ?? randomUUID();
    const from = body["From"] ?? body["CallFrom"] ?? "";
    const to = body["To"] ?? body["CallTo"] ?? "";

    log.info({ callSid, from, to }, "exotel inbound call");

    // Resolve dialed number → tenant via DID mapping
    const tenantId = await resolveCallTenant(to);

    await queue.publish(COMMANDS.createCall, {
      messageId: callSid,
      type: COMMANDS.createCall,
      tenantId,
      actorId: "system",
      correlationId: callSid,
      schemaVersion: "1.0",
      payload: {
        id: randomUUID(),
        tenantId,
        direction: "inbound",
        callerNumber: from,
        calleeNumber: to,
        carrierCallId: callSid,
        carrier: "exotel",
      },
    });

    // Exotel expects a JSON response for IVR routing
    return reply.send({ action: "connect", to: "default-queue" });
  });

  /** Exotel status callback */
  app.post("/v1/telephony/webhooks/exotel/status", { config: { public: true } }, async (req, reply) => {
    if (!checkExotelSignature(req)) { rejectUnauthorized(reply); return; }
    const body = req.body as Record<string, string>;
    const callSid = body["CallSid"] ?? body["Sid"] ?? "";
    const status = body["Status"] ?? body["CallStatus"] ?? "";
    const to = body["To"] ?? body["CallTo"] ?? "";

    log.info({ callSid, status }, "exotel status callback");

    if (["completed", "failed", "busy", "no-answer"].includes(status.toLowerCase())) {
      // Resolve tenant from the dialed number on the callback
      const tenantId = to ? await resolveCallTenant(to) : DEFAULT_TENANT_ID;

      await queue.publish(COMMANDS.completeCall, {
        messageId: randomUUID(),
        type: COMMANDS.completeCall,
        tenantId,
        actorId: "system",
        correlationId: callSid,
        schemaVersion: "1.0",
        payload: {
          id: callSid,
          tenantId,
          outcome: status.toLowerCase() === "completed" ? "completed" : "missed",
        },
      });
    }

    return reply.code(204).send();
  });
}

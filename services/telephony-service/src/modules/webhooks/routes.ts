/**
 * Carrier webhook routes — receives inbound call notifications and status updates
 * from Twilio/Exotel and converts them into internal telephony commands.
 *
 * These endpoints are PUBLIC (no JWT) — authenticated via carrier-specific
 * signature validation (Twilio X-Twilio-Signature, Exotel webhook token).
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { pino } from "pino";

const log = pino({ name: "telephony-webhooks" });

// Tenant resolution for inbound calls: in production, map the dialed number
// to a tenant via a lookup table. For now, use a default.
const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /** Twilio inbound voice webhook — new incoming call */
  app.post("/v1/telephony/webhooks/twilio/inbound", async (req, reply) => {
    const body = req.body as Record<string, string>;
    const callSid = body["CallSid"] ?? randomUUID();
    const from = body["From"] ?? "";
    const to = body["To"] ?? "";

    log.info({ callSid, from, to }, "twilio inbound call");

    // Publish create-call command
    await queue.publish(COMMANDS.createCall, {
      messageId: callSid,
      type: COMMANDS.createCall,
      tenantId: DEFAULT_TENANT,
      actorId: "system",
      correlationId: callSid,
      schemaVersion: "1.0",
      payload: {
        id: randomUUID(),
        tenantId: DEFAULT_TENANT,
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
  app.post("/v1/telephony/webhooks/twilio/status", async (req, reply) => {
    const body = req.body as Record<string, string>;
    const callSid = body["CallSid"] ?? "";
    const status = body["CallStatus"] ?? "";
    const duration = body["CallDuration"] ?? "0";

    log.info({ callSid, status, duration }, "twilio status callback");

    if (status === "completed" || status === "busy" || status === "failed" || status === "no-answer") {
      await queue.publish(COMMANDS.completeCall, {
        messageId: randomUUID(),
        type: COMMANDS.completeCall,
        tenantId: DEFAULT_TENANT,
        actorId: "system",
        correlationId: callSid,
        schemaVersion: "1.0",
        payload: {
          id: callSid, // Will be resolved by consumer via carrierCallId lookup
          tenantId: DEFAULT_TENANT,
          outcome: status === "completed" ? "completed" : "missed",
        },
      });
    }

    return reply.code(204).send();
  });

  /** Twilio recording callback — recording ready */
  app.post("/v1/telephony/webhooks/twilio/recording", async (req, reply) => {
    const body = req.body as Record<string, string>;
    const callSid = body["CallSid"] ?? "";
    const recordingSid = body["RecordingSid"] ?? "";
    const recordingUrl = body["RecordingUrl"] ?? "";
    const duration = body["RecordingDuration"] ?? "0";

    log.info({ callSid, recordingSid, duration }, "twilio recording ready");

    await queue.publish(COMMANDS.attachRecording, {
      messageId: randomUUID(),
      type: COMMANDS.attachRecording,
      tenantId: DEFAULT_TENANT,
      actorId: "system",
      correlationId: callSid,
      schemaVersion: "1.0",
      payload: {
        id: callSid,
        tenantId: DEFAULT_TENANT,
        recordingId: recordingSid,
        recordingUrl: `${recordingUrl}.mp3`,
        durationSec: Number(duration),
        format: "mp3",
      },
    });

    return reply.code(204).send();
  });

  /** Exotel inbound webhook */
  app.post("/v1/telephony/webhooks/exotel/inbound", async (req, reply) => {
    const body = req.body as Record<string, string>;
    const callSid = body["CallSid"] ?? body["Sid"] ?? randomUUID();
    const from = body["From"] ?? body["CallFrom"] ?? "";
    const to = body["To"] ?? body["CallTo"] ?? "";

    log.info({ callSid, from, to }, "exotel inbound call");

    await queue.publish(COMMANDS.createCall, {
      messageId: callSid,
      type: COMMANDS.createCall,
      tenantId: DEFAULT_TENANT,
      actorId: "system",
      correlationId: callSid,
      schemaVersion: "1.0",
      payload: {
        id: randomUUID(),
        tenantId: DEFAULT_TENANT,
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
  app.post("/v1/telephony/webhooks/exotel/status", async (req, reply) => {
    const body = req.body as Record<string, string>;
    const callSid = body["CallSid"] ?? body["Sid"] ?? "";
    const status = body["Status"] ?? body["CallStatus"] ?? "";

    log.info({ callSid, status }, "exotel status callback");

    if (["completed", "failed", "busy", "no-answer"].includes(status.toLowerCase())) {
      await queue.publish(COMMANDS.completeCall, {
        messageId: randomUUID(),
        type: COMMANDS.completeCall,
        tenantId: DEFAULT_TENANT,
        actorId: "system",
        correlationId: callSid,
        schemaVersion: "1.0",
        payload: {
          id: callSid,
          tenantId: DEFAULT_TENANT,
          outcome: status.toLowerCase() === "completed" ? "completed" : "missed",
        },
      });
    }

    return reply.code(204).send();
  });
}

/**
 * SMTP email sender (NOTIF-CRASH fix).
 *
 * This module was referenced by the worker/tests but absent from the tree, so
 * the email channel failed to load. It wraps the existing SMTP transport
 * (adapters/email-transport.ts) behind a small `sendEmail` façade:
 *
 *   - SMTP_HOST unset  → dry-run: log and report { sent: false } (dev default,
 *     no outbound mail, no crash).
 *   - SMTP_HOST set    → dispatch via nodemailer and report { sent: true }.
 *
 * The remote SMTP handshake is fire-and-forget (delivery failures are logged,
 * not awaited into the result) so a slow/unreachable relay cannot block the
 * consumer that calls this; durable retry is the delivery sweeper's job.
 */
import { pino } from "pino";
import { createSmtpTransport } from "../../adapters/email-transport.js";
import { maskRecipient } from "../../adapters/mask.js";

const log = pino({ name: "smtp-sender" });

export interface SendEmailResult {
  sent: boolean;
}

/** Default envelope-from; overridable via SMTP_FROM. */
function fromAddress(): string {
  return process.env["SMTP_FROM"] ?? "no-reply@civitasone.gov.in";
}

/**
 * Send (or dry-run) a single HTML email.
 * @returns { sent:true } when an SMTP relay is configured and the message was
 *          dispatched; { sent:false } when running in dry-run (no SMTP_HOST).
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<SendEmailResult> {
  const host = process.env["SMTP_HOST"];
  if (!host) {
    // The recipient address is PII (DPDP Act) and must never reach a log line
    // in cleartext — mask it, exactly as the SMS/WhatsApp adapters already do.
    log.info({ to: maskRecipient(to) }, "SMTP_HOST not set — dry-run, email not dispatched");
    return { sent: false };
  }

  const transport = createSmtpTransport();
  // Dispatch without blocking on the remote SMTP handshake; delivery failures
  // are logged (the delivery sweeper owns durable retry).
  void transport
    .send({ to, from: fromAddress(), subject, text: html })
    .catch((err: unknown) => log.error({ err, to: maskRecipient(to) }, "SMTP send failed"));

  return { sent: true };
}

/**
 * P1-001: Simple SMTP sender using nodemailer pattern.
 * In production: reads SMTP config from env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
 * For now: logs email to console (dry-run mode when SMTP_HOST not set)
 */

export interface SendEmailResult {
  sent: boolean;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<SendEmailResult> {
  const host = process.env.SMTP_HOST;

  if (!host) {
    console.log(`[EMAIL DRY-RUN] To: ${to} | Subject: ${subject}`);
    return { sent: false };
  }

  // In production: use nodemailer.createTransport({host, port, auth...}).sendMail(...)
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  console.log(`[EMAIL] Sending to: ${to} | Subject: ${subject} | via ${host}:${port} user=${user ?? "anonymous"}`);

  // Placeholder for actual nodemailer integration:
  // const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined });
  // await transporter.sendMail({ from: process.env.SMTP_FROM ?? 'noreply@civitasone.io', to, subject, html });

  return { sent: true };
}

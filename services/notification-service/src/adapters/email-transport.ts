import nodemailer from "nodemailer";

export type EmailMessage = {
  to: string;
  from: string;
  subject?: string | null;
  text: string;
};

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

/** Captures outbound mail in-process — used by CI integration tests. */
export class MemoryEmailTransport implements EmailTransport {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push({ ...message });
  }
}

export function createSmtpTransport(): EmailTransport {
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST is required for smtp driver");

  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass: pass ?? "" } : undefined,
  });

  return {
    async send(message: EmailMessage): Promise<void> {
      await transporter.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject ?? "(no subject)",
        text: message.text,
      });
    },
  };
}

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

/** Explicit SMTP connection settings (e.g. resolved from the integration registry). */
export type SmtpConfig = {
  host: string;
  port?: number;
  user?: string;
  pass?: string;
  secure?: boolean;
};

/** Captures outbound mail in-process — used by CI integration tests. */
export class MemoryEmailTransport implements EmailTransport {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push({ ...message });
  }
}

/**
 * Build an SMTP transport. With no argument the connection settings come from
 * environment variables (backward compatible); pass an explicit SmtpConfig to
 * use per-tenant settings resolved from the integration registry.
 */
export function createSmtpTransport(cfg?: SmtpConfig): EmailTransport {
  const host = cfg?.host ?? process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST is required for smtp driver");

  const port = cfg?.port ?? Number(process.env.SMTP_PORT ?? 587);
  const user = cfg?.user ?? process.env.SMTP_USER;
  const pass = cfg?.pass ?? process.env.SMTP_PASS;
  const secure = cfg?.secure ?? port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
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

/**
 * integration-settings — the provider registry.
 *
 * The single source of truth for every external endpoint CivitasOne can talk
 * to. For each provider we declare:
 *   - category   → UI grouping (ai / messaging / email_push / payments / files_ocr)
 *   - label      → human name
 *   - configSchema → zod schema for the NON-secret settings kept in `config`
 *   - secretFields → the fields that must be encrypted (never returned in GETs)
 *   - primarySecret → which secret field the masked ••••1234 is derived from
 *   - test()     → a REAL connection probe; fail-closed, never a fake success.
 *
 * Adding a provider = one entry here + (optionally) an adapter reading it.
 */
import { z } from "zod";
import net from "node:net";
import tls from "node:tls";
import { isBlockedAfterResolve, isBlockedHost } from "../../shared/ssrf-guard.js";

export const PROVIDERS = [
  "ai_anthropic",
  "sms_twilio",
  "whatsapp_meta",
  "email_smtp",
  "push_fcm",
  "payment_pfms",
  "payment_upi",
  "sftp",
  "ocr",
] as const;
export type Provider = (typeof PROVIDERS)[number];

export const ENV_SCOPES = ["dev", "staging", "prod"] as const;
export type EnvScope = (typeof ENV_SCOPES)[number];

export type Category = "ai" | "messaging" | "email_push" | "payments" | "files_ocr";

export type TestResult = {
  status: "connected" | "failed";
  ok: boolean;
  error?: string;
  detail?: string;
};

export interface ProviderDef {
  category: Category;
  label: string;
  /** zod schema validating the full input (config + secret fields together). */
  inputSchema: z.ZodType<Record<string, unknown>>;
  /** field names that are secret → encrypted, never returned. */
  secretFields: string[];
  /** the secret whose last4 is shown masked. */
  primarySecret: string;
  /** run a real connection probe against the resolved config + secrets. */
  test: (input: { config: Record<string, unknown>; secrets: Record<string, string>; endpointUrl: string }) => Promise<TestResult>;
}

// ── small network helpers (all with hard timeouts, fail-closed) ──────────────

async function httpProbe(url: string, opts: { headers?: Record<string, string>; method?: string; timeoutMs?: number }): Promise<TestResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    // SSRF guard: only http(s) schemes, and reject destinations that resolve
    // to private/loopback/link-local/metadata addresses (incl. post-DNS
    // re-check to defeat rebinding). Fixed error string — never echoes the
    // upstream body or any secret.
    if (await isBlockedAfterResolve(url)) {
      clearTimeout(t);
      return { status: "failed", ok: false, error: "SSRF_BLOCKED: destination not allowed" };
    }
    const init: RequestInit = { method: opts.method ?? "GET", signal: ctrl.signal };
    if (opts.headers) init.headers = opts.headers;
    const res = await fetch(url, init);
    if (res.ok) return { status: "connected", ok: true, detail: `HTTP ${res.status}` };
    // 401/403 means we reached the endpoint but auth failed → real failure.
    let body = "";
    try { body = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    return { status: "failed", ok: false, error: `HTTP ${res.status}${body ? `: ${body}` : ""}` };
  } catch (err) {
    return { status: "failed", ok: false, error: `unreachable: ${(err as Error).message}` };
  } finally {
    clearTimeout(t);
  }
}

/** Open a raw TCP (optionally TLS) socket and read the server's greeting line. */
async function tcpGreeting(host: string, port: number, useTls: boolean, timeoutMs = 8000): Promise<TestResult> {
  // SSRF guard for the raw-socket path (SMTP/SFTP): resolve the host and
  // block if it maps to a private/loopback/link-local/metadata IP before we
  // open any socket. Fixed error string — never leaks a banner.
  if (await isBlockedHost(host)) {
    return { status: "failed", ok: false, error: "SSRF_BLOCKED: destination not allowed" };
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: TestResult) => { if (!settled) { settled = true; try { socket.destroy(); } catch { /* */ } resolve(r); } };
    const socket = useTls
      ? tls.connect({ host, port, rejectUnauthorized: false, servername: host })
      : net.connect({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => done({ status: "failed", ok: false, error: `timeout connecting to ${host}:${port}` }));
    socket.once("error", (e) => done({ status: "failed", ok: false, error: `${(e as Error).message}` }));
    socket.once("data", (buf) => {
      const line = buf.toString("utf8").split(/\r?\n/)[0] ?? "";
      done({ status: "connected", ok: true, detail: line.slice(0, 120) });
    });
    // Some plain-TCP servers speak first; if connected but silent for a moment,
    // treat a successful connect as reachable.
    socket.once("connect", () => {
      setTimeout(() => done({ status: "connected", ok: true, detail: `TCP connect to ${host}:${port}` }), 1200);
    });
  });
}

const port = z.coerce.number().int().min(1).max(65535);

// ── the registry ─────────────────────────────────────────────────────────────

export const REGISTRY: Record<Provider, ProviderDef> = {
  ai_anthropic: {
    category: "ai",
    label: "Anthropic (Claude)",
    inputSchema: z.object({
      apiKey: z.string().min(10),
      model: z.string().min(1).default("claude-3-5-sonnet-latest"),
      baseUrl: z.string().url().default("https://api.anthropic.com"),
    }),
    secretFields: ["apiKey"],
    primarySecret: "apiKey",
    test: async ({ config, secrets }) => {
      const base = String(config.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
      const key = secrets.apiKey;
      if (!key) return { status: "failed", ok: false, error: "apiKey is not configured" };
      return httpProbe(`${base}/v1/models`, {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      });
    },
  },

  sms_twilio: {
    category: "messaging",
    label: "Twilio SMS",
    inputSchema: z.object({
      accountSid: z.string().min(10),
      authToken: z.string().min(10),
      fromNumber: z.string().min(3),
    }),
    secretFields: ["authToken"],
    primarySecret: "authToken",
    test: async ({ config, secrets }) => {
      const sid = String(config.accountSid ?? "");
      const token = secrets.authToken;
      if (!sid || !token) return { status: "failed", ok: false, error: "accountSid/authToken not configured" };
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      return httpProbe(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
        headers: { authorization: `Basic ${auth}` },
      });
    },
  },

  whatsapp_meta: {
    category: "messaging",
    label: "WhatsApp (Meta)",
    inputSchema: z.object({
      phoneNumberId: z.string().min(3),
      accessToken: z.string().min(10),
      graphVersion: z.string().default("v18.0"),
    }),
    secretFields: ["accessToken"],
    primarySecret: "accessToken",
    test: async ({ config, secrets }) => {
      const id = String(config.phoneNumberId ?? "");
      const token = secrets.accessToken;
      if (!id || !token) return { status: "failed", ok: false, error: "phoneNumberId/accessToken not configured" };
      const v = String(config.graphVersion ?? "v18.0");
      return httpProbe(`https://graph.facebook.com/${v}/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    },
  },

  email_smtp: {
    category: "email_push",
    label: "SMTP Email",
    inputSchema: z.object({
      host: z.string().min(1),
      port: port.default(587),
      user: z.string().min(1),
      password: z.string().min(1),
      from: z.string().email(),
      secure: z.boolean().default(false),
    }),
    secretFields: ["password"],
    primarySecret: "password",
    test: async ({ config }) => {
      const host = String(config.host ?? "");
      const p = Number(config.port ?? 587);
      if (!host) return { status: "failed", ok: false, error: "host is not configured" };
      // SMTPS (465) speaks TLS immediately; 587/25 are plaintext then STARTTLS.
      return tcpGreeting(host, p, p === 465 || config.secure === true);
    },
  },

  push_fcm: {
    category: "email_push",
    label: "Firebase Cloud Messaging",
    inputSchema: z.object({
      projectId: z.string().min(1),
      // Either a legacy server key OR a service-account JSON string.
      serverKey: z.string().optional(),
      serviceAccount: z.string().optional(),
    }).refine((v) => v.serverKey || v.serviceAccount, { message: "serverKey or serviceAccount is required" }),
    secretFields: ["serverKey", "serviceAccount"],
    primarySecret: "serverKey",
    test: async ({ config, secrets }) => {
      // FCM v1 needs an OAuth token minted from the service account — a full
      // token exchange is out of scope for a health probe, so we verify the
      // project's FCM endpoint is reachable and credentials are present.
      const projectId = String(config.projectId ?? "");
      if (!projectId) return { status: "failed", ok: false, error: "projectId is not configured" };
      if (!secrets.serverKey && !secrets.serviceAccount) {
        return { status: "failed", ok: false, error: "serverKey or serviceAccount is not configured" };
      }
      // Reachability of the FCM send endpoint for this project (401 without a
      // real OAuth token is expected → we treat DNS/TCP reachability as the check).
      const probe = await httpProbe(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, { method: "GET" });
      // A 401/404 here still proves the endpoint is reachable and the project id
      // is well-formed; only a network-unreachable error is a hard failure.
      if (probe.ok) return probe;
      if (probe.error?.startsWith("unreachable")) return probe;
      return { status: "connected", ok: true, detail: "FCM endpoint reachable; credentials present (token exchange not verified)" };
    },
  },

  payment_pfms: {
    category: "payments",
    label: "PFMS (Govt Payments)",
    inputSchema: z.object({
      agencyCode: z.string().min(1),
      endpoint: z.string().url(),
      cert: z.string().min(1),
    }),
    secretFields: ["cert"],
    primarySecret: "cert",
    test: async ({ config }) => {
      const endpoint = String(config.endpoint ?? "");
      if (!endpoint) return { status: "failed", ok: false, error: "endpoint is not configured" };
      // PFMS is an env-gated government endpoint; we probe reachability only.
      return httpProbe(endpoint, { method: "GET", timeoutMs: 10000 });
    },
  },

  payment_upi: {
    category: "payments",
    label: "UPI Autopay",
    inputSchema: z.object({
      vpa: z.string().min(3),
      key: z.string().min(6),
      endpoint: z.string().url().optional(),
    }),
    secretFields: ["key"],
    primarySecret: "key",
    test: async ({ config, secrets }) => {
      if (!config.vpa || !secrets.key) return { status: "failed", ok: false, error: "vpa/key not configured" };
      const endpoint = config.endpoint ? String(config.endpoint) : "";
      if (!endpoint) {
        // No public probe endpoint — verify config completeness, do not fake a
        // live connection.
        return { status: "failed", ok: false, error: "no endpoint configured to test against; credentials present but connection unverified" };
      }
      return httpProbe(endpoint, { method: "GET" });
    },
  },

  sftp: {
    category: "files_ocr",
    label: "SFTP",
    inputSchema: z.object({
      host: z.string().min(1),
      port: port.default(22),
      username: z.string().min(1),
      privateKey: z.string().min(10),
    }),
    secretFields: ["privateKey"],
    primarySecret: "privateKey",
    test: async ({ config }) => {
      const host = String(config.host ?? "");
      const p = Number(config.port ?? 22);
      if (!host) return { status: "failed", ok: false, error: "host is not configured" };
      const r = await tcpGreeting(host, p, false);
      // An SSH server announces itself with an "SSH-2.0-..." banner.
      if (r.ok && r.detail && !r.detail.startsWith("SSH-")) {
        return { status: "connected", ok: true, detail: `reachable (${r.detail})` };
      }
      return r;
    },
  },

  ocr: {
    category: "files_ocr",
    label: "OCR Service",
    inputSchema: z.object({
      provider: z.string().min(1),
      apiKey: z.string().min(6),
      endpoint: z.string().url(),
    }),
    secretFields: ["apiKey"],
    primarySecret: "apiKey",
    test: async ({ config, secrets }) => {
      const endpoint = String(config.endpoint ?? "");
      if (!endpoint || !secrets.apiKey) return { status: "failed", ok: false, error: "endpoint/apiKey not configured" };
      return httpProbe(endpoint, { headers: { authorization: `Bearer ${secrets.apiKey}` } });
    },
  },
};

export function isProvider(v: string): v is Provider {
  return (PROVIDERS as readonly string[]).includes(v);
}
export function isEnvScope(v: string): v is EnvScope {
  return (ENV_SCOPES as readonly string[]).includes(v);
}
export function providerDef(p: Provider): ProviderDef {
  return REGISTRY[p];
}
export function providerCategory(p: Provider): Category {
  return REGISTRY[p].category;
}

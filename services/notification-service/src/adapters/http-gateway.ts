/**
 * P0-1: minimal HTTP gateway helper shared by the SMS / push / WhatsApp adapters.
 * Performs a real outbound request and maps transport/HTTP errors to a SendResult.
 * Uses the global fetch (Node >= 18). Never fabricates success.
 */
import type { SendResult } from "./types.js";

export type GatewayRequest = {
  url: string;
  method?: "POST" | "GET";
  headers?: Record<string, string>;
  /** application/json body */
  json?: unknown;
  /** application/x-www-form-urlencoded body */
  form?: Record<string, string>;
  timeoutMs?: number;
};

export async function postToGateway(req: GatewayRequest): Promise<SendResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 10_000);
  try {
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    let body: string | undefined;
    if (req.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(req.json);
    } else if (req.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(req.form).toString();
    }
    const res = await fetch(req.url, {
      method: req.method ?? "POST",
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `gateway responded ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "gateway request failed";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

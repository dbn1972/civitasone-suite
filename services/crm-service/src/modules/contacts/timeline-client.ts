/**
 * G6 — Timeline Client: cross-service HTTP client for unified timeline.
 *
 * Fetches communications from notification-service and calls from telephony-service
 * with 10s timeout + graceful degradation. If a downstream service is unavailable,
 * logs WARN and returns an empty array — never fails the parent request.
 */
import { pino } from "pino";

const logger = pino({ name: "timeline-client" });

// ── Configuration ──
const NOTIFICATION_BASE = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3006";
const TELEPHONY_BASE = process.env.TELEPHONY_SERVICE_URL ?? "http://localhost:3026";
const FETCH_TIMEOUT_MS = 10_000;

// ── Types ──

export interface TimelineEntry {
  id: string;
  type: "activity" | "communication" | "call" | "deal" | "transition";
  channel?: string;
  subject?: string;
  direction?: "inbound" | "outbound";
  occurredAt: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

// ── Internal helpers ──

/**
 * Perform an HTTP GET with 10s AbortController timeout.
 * Returns parsed JSON array on success, null on any failure (timeout, 5xx, network error).
 */
async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
): Promise<unknown[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn({ url, status: res.status }, "cross-service fetch returned non-200");
      return null;
    }

    const body: unknown = await res.json();
    // Support { data: [...] } envelope or raw array
    if (Array.isArray(body)) return body;
    if (
      body &&
      typeof body === "object" &&
      "data" in body &&
      Array.isArray((body as Record<string, unknown>).data)
    ) {
      return (body as Record<string, unknown>).data as unknown[];
    }
    return [];
  } catch (err: unknown) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : "unknown error";
    logger.warn({ url, error: message }, "cross-service fetch failed (timeout or network)");
    return null;
  }
}

function normalizeDirection(raw: unknown): "inbound" | "outbound" | undefined {
  const s = String(raw ?? "");
  if (s === "inbound" || s === "outbound") return s;
  return undefined;
}

// ── Public API ──

/**
 * Fetch communications (delivery records) for a contact from notification-service.
 * Returns empty array on timeout/503 (graceful degradation).
 */
export async function fetchContactCommunications(
  contactId: string,
  tenantId: string,
  authHeader: string,
): Promise<TimelineEntry[]> {
  const url = `${NOTIFICATION_BASE}/notifications/deliveries?recipientId=${contactId}`;
  const headers: Record<string, string> = {
    authorization: authHeader,
    "x-tenant-id": tenantId,
    "content-type": "application/json",
  };

  const raw = await fetchWithTimeout(url, headers);
  if (!raw) return [];

  return raw.map((r: unknown) => {
    const d = r as Record<string, unknown>;
    const entry: TimelineEntry = {
      id: String(d.id ?? ""),
      type: "communication",
      channel: String(d.channel ?? "unknown"),
      occurredAt: String(d.sentAt ?? d.createdAt ?? ""),
      status: String(d.status ?? "sent"),
    };
    const dir = normalizeDirection(d.direction);
    if (dir) entry.direction = dir;
    if (d.subject) entry.subject = String(d.subject);
    if (Object.keys(d).length > 0) entry.metadata = d;
    return entry;
  });
}

/**
 * Fetch call log for a contact from telephony-service.
 * Returns empty array on timeout/503 (graceful degradation).
 */
export async function fetchContactCalls(
  contactId: string,
  tenantId: string,
  authHeader: string,
): Promise<TimelineEntry[]> {
  const url = `${TELEPHONY_BASE}/v1/telephony/calls?contactId=${contactId}`;
  const headers: Record<string, string> = {
    authorization: authHeader,
    "x-tenant-id": tenantId,
    "content-type": "application/json",
  };

  const raw = await fetchWithTimeout(url, headers);
  if (!raw) return [];

  return raw.map((r: unknown) => {
    const c = r as Record<string, unknown>;
    const entry: TimelineEntry = {
      id: String(c.id ?? ""),
      type: "call",
      occurredAt: String(c.startedAt ?? c.createdAt ?? ""),
      status: String(c.status ?? "completed"),
    };
    const dir = normalizeDirection(c.direction);
    if (dir) entry.direction = dir;
    if (c.channel) entry.channel = String(c.channel);
    if (typeof c.duration === "number" || typeof c.recordingAvailable === "boolean") {
      entry.metadata = {};
      if (typeof c.duration === "number") entry.metadata.duration = c.duration;
      if (typeof c.recordingAvailable === "boolean") entry.metadata.recordingAvailable = c.recordingAvailable;
    }
    return entry;
  });
}

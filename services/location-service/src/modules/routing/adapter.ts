/**
 * Routing adapter — env-gated integration for distance/time computation
 * between waypoints via MapmyIndia or Google Maps Directions API.
 *
 * Env-gated: fails closed when ROUTING_PROVIDER is not configured.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   ROUTING_PROVIDER — "mapmyindia" | "google" (required to enable)
 *   ROUTING_API_KEY  — API key for the configured provider
 *
 * No PII is logged — only correlation IDs, adapter name, and status codes.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import type { Waypoint, RoutingResult } from "./domain.js";

// ── Errors ────────────────────────────────────────────────────────

export class RoutingAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "RoutingAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const PROVIDER = (process.env.ROUTING_PROVIDER ?? "").toLowerCase() as "mapmyindia" | "google";
const API_KEY = process.env.ROUTING_API_KEY ?? "";
const TIMEOUT_MS = 10_000; // 10s timeout per requirement 17.7

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "routing",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): void {
  if (!PROVIDER || !API_KEY) {
    throw new RoutingAdapterError(
      "Routing integration is not available",
      "INTEGRATION_DISABLED",
    );
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Provider-specific implementations ─────────────────────────────

async function routeMapmyIndia(waypoints: Waypoint[]): Promise<RoutingResult> {
  // MapmyIndia Directions API: semicolon-separated lng,lat pairs
  const coords = waypoints.map((wp) => `${wp.lng},${wp.lat}`).join(";");
  const url = `https://apis.mapmyindia.com/advancedmaps/v1/${encodeURIComponent(API_KEY)}/route_adv/driving/${coords}?geometries=polyline&overview=full`;

  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new RoutingAdapterError(
      `Routing API returned ${res.status}`,
      "ROUTING_API_ERROR",
      res.status,
    );
  }

  const data = (await res.json()) as {
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: string;
    }>;
  };

  const route = data.routes?.[0];
  if (!route) {
    throw new RoutingAdapterError(
      "Routing returned no route",
      "ROUTING_NO_RESULT",
    );
  }

  return {
    distanceMeters: Math.round(route.distance ?? 0),
    durationSeconds: Math.round(route.duration ?? 0),
    polyline: route.geometry ?? "",
  };
}

async function routeGoogle(waypoints: Waypoint[]): Promise<RoutingResult> {
  const first = waypoints[0]!;
  const last = waypoints[waypoints.length - 1]!;
  const origin = `${first.lat},${first.lng}`;
  const destination = `${last.lat},${last.lng}`;

  // Intermediate waypoints (if any)
  const intermediates = waypoints.slice(1, -1);
  const waypointsParam = intermediates.length > 0
    ? `&waypoints=${intermediates.map((wp) => `${wp.lat},${wp.lng}`).join("|")}`
    : "";

  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}${waypointsParam}&key=${encodeURIComponent(API_KEY)}`;

  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new RoutingAdapterError(
      `Routing API returned ${res.status}`,
      "ROUTING_API_ERROR",
      res.status,
    );
  }

  const data = (await res.json()) as {
    routes?: Array<{
      legs?: Array<{ distance?: { value?: number }; duration?: { value?: number } }>;
      overview_polyline?: { points?: string };
    }>;
    status?: string;
  };

  const route = data.routes?.[0];
  if (!route || !route.legs?.length) {
    throw new RoutingAdapterError(
      "Routing returned no route",
      "ROUTING_NO_RESULT",
    );
  }

  // Sum legs for total distance/duration
  let totalDistance = 0;
  let totalDuration = 0;
  for (const leg of route.legs) {
    totalDistance += leg.distance?.value ?? 0;
    totalDuration += leg.duration?.value ?? 0;
  }

  return {
    distanceMeters: Math.round(totalDistance),
    durationSeconds: Math.round(totalDuration),
    polyline: route.overview_polyline?.points ?? "",
  };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Compute routing between 2–25 waypoints.
 *
 * Returns distance in meters, duration in seconds, and an encoded polyline.
 *
 * Throws RoutingAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function computeRoute(waypoints: Waypoint[]): Promise<RoutingResult> {
  assertEnabled();

  return breaker.call(async () => {
    if (PROVIDER === "google") {
      return routeGoogle(waypoints);
    }
    // Default to mapmyindia
    return routeMapmyIndia(waypoints);
  });
}

/** Returns the current state of the circuit breaker. */
export function getRoutingBreakerState(): "closed" | "open" | "half-open" {
  return breaker.state;
}

/** Returns true if the routing adapter is enabled and configured. */
export function isRoutingEnabled(): boolean {
  return PROVIDER.length > 0 && API_KEY.length > 0;
}

export { CircuitBreakerOpenError };

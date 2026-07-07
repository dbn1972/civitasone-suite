/**
 * Geocoding adapter — env-gated integration for forward and reverse geocoding
 * via MapmyIndia or Google Maps API.
 *
 * Env-gated: fails closed when GEOCODING_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   GEOCODING_ENABLED  — "true" to activate; anything else → fail-closed
 *   GEOCODING_PROVIDER — "mapmyindia" | "google"
 *   GEOCODING_API_KEY  — API key for the configured provider
 *
 * No PII is logged — only correlation IDs, adapter name, and status codes.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────

export interface GeocodeResult {
  lat: number;
  lng: number;
}

export interface ReverseGeocodeResult {
  address: string;
}

// ── Errors ────────────────────────────────────────────────────────

export class GeocodingAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "GeocodingAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const ENABLED = process.env.GEOCODING_ENABLED === "true";
const PROVIDER = (process.env.GEOCODING_PROVIDER ?? "").toLowerCase() as "mapmyindia" | "google";
const API_KEY = process.env.GEOCODING_API_KEY ?? "";
const TIMEOUT_MS = 10_000; // 10s timeout per requirement 17.5

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "geocoding",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): void {
  if (!ENABLED || !API_KEY) {
    throw new GeocodingAdapterError(
      "Geocoding integration is not available",
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

async function geocodeMapmyIndia(address: string): Promise<GeocodeResult> {
  const url = `https://atlas.mapmyindia.com/api/places/geocode?address=${encodeURIComponent(address)}`;
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    throw new GeocodingAdapterError(
      `Geocoding API returned ${res.status}`,
      "GEOCODING_API_ERROR",
      res.status,
    );
  }

  const data = await res.json() as {
    copResults?: { latitude?: string; longitude?: string };
  };

  const lat = parseFloat(data.copResults?.latitude ?? "");
  const lng = parseFloat(data.copResults?.longitude ?? "");

  if (isNaN(lat) || isNaN(lng)) {
    throw new GeocodingAdapterError(
      "Geocoding returned no valid coordinates",
      "GEOCODING_NO_RESULT",
    );
  }

  return { lat, lng };
}

async function geocodeGoogle(address: string): Promise<GeocodeResult> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(API_KEY)}`;
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    throw new GeocodingAdapterError(
      `Geocoding API returned ${res.status}`,
      "GEOCODING_API_ERROR",
      res.status,
    );
  }

  const data = await res.json() as {
    results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
    status?: string;
  };

  const location = data.results?.[0]?.geometry?.location;
  if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") {
    throw new GeocodingAdapterError(
      "Geocoding returned no valid coordinates",
      "GEOCODING_NO_RESULT",
    );
  }

  return { lat: location.lat, lng: location.lng };
}

async function reverseGeocodeMapmyIndia(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  const url = `https://apis.mapmyindia.com/advancedmaps/v1/${encodeURIComponent(API_KEY)}/rev_geocode?lat=${lat}&lng=${lng}`;
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    throw new GeocodingAdapterError(
      `Geocoding API returned ${res.status}`,
      "GEOCODING_API_ERROR",
      res.status,
    );
  }

  const data = await res.json() as {
    results?: Array<{ formatted_address?: string }>;
  };

  const address = data.results?.[0]?.formatted_address;
  if (!address) {
    throw new GeocodingAdapterError(
      "Reverse geocoding returned no address",
      "GEOCODING_NO_RESULT",
    );
  }

  return { address };
}

async function reverseGeocodeGoogle(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(API_KEY)}`;
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    throw new GeocodingAdapterError(
      `Geocoding API returned ${res.status}`,
      "GEOCODING_API_ERROR",
      res.status,
    );
  }

  const data = await res.json() as {
    results?: Array<{ formatted_address?: string }>;
    status?: string;
  };

  const address = data.results?.[0]?.formatted_address;
  if (!address) {
    throw new GeocodingAdapterError(
      "Reverse geocoding returned no address",
      "GEOCODING_NO_RESULT",
    );
  }

  return { address };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Forward geocode — convert address string to lat/lng coordinates.
 *
 * Throws GeocodingAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  assertEnabled();

  return breaker.call(async () => {
    if (PROVIDER === "google") {
      return geocodeGoogle(address);
    }
    // Default to mapmyindia
    return geocodeMapmyIndia(address);
  });
}

/**
 * Reverse geocode — convert lat/lng coordinates to a human-readable address.
 *
 * Throws GeocodingAdapterError with code "INTEGRATION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  assertEnabled();

  return breaker.call(async () => {
    if (PROVIDER === "google") {
      return reverseGeocodeGoogle(lat, lng);
    }
    // Default to mapmyindia
    return reverseGeocodeMapmyIndia(lat, lng);
  });
}

/** Returns the current state of the circuit breaker. */
export function getBreakerState(): "closed" | "open" | "half-open" {
  return breaker.state;
}

/** Returns true if the adapter is enabled and configured. */
export function isEnabled(): boolean {
  return ENABLED && API_KEY.length > 0;
}

export { CircuitBreakerOpenError };
